const { db, getSettings, updateSettings } = require('./db');
const { fetchLatestUploads } = require('./youtube');
const { getConfigKey } = require('./config');
const { randomUUID } = require('crypto');

const DEFAULT_SCHEDULE = Object.freeze({ intervalMinutes: 1, startHour: 0, startMinute: 0, endHour: 23, endMinute: 59 });
const DAILY_QUOTA_LIMIT = Number(process.env.YOUTUBE_DAILY_QUOTA_LIMIT) || 1000;
let paused = false;
let activeRuns = 0;
const idleWaiters = new Set();

function normalizeSchedule(schedule = {}) {
  const intervalMinutes = DEFAULT_SCHEDULE.intervalMinutes;
  const startHour = Number(schedule.startHour ?? DEFAULT_SCHEDULE.startHour);
  const startMinute = Number(schedule.startMinute ?? DEFAULT_SCHEDULE.startMinute);
  const endHour = Number(schedule.endHour ?? DEFAULT_SCHEDULE.endHour);
  const endMinute = Number(schedule.endMinute ?? DEFAULT_SCHEDULE.endMinute);
  if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23 || !Number.isInteger(endHour) || endHour < 0 || endHour > 23) throw new Error('Kontrol saatleri 00 ile 23 arasında olmalıdır.');
  if (!Number.isInteger(startMinute) || startMinute < 0 || startMinute > 59 || !Number.isInteger(endMinute) || endMinute < 0 || endMinute > 59) throw new Error('Kontrol dakikaları 00 ile 59 arasında olmalıdır.');
  return { intervalMinutes, startHour, startMinute, endHour, endMinute };
}

function getIstanbulMinuteOfDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const value = type => Number(parts.find(part => part.type === type)?.value);
  return value('hour') * 60 + value('minute');
}

function isWithinHours(schedule, now = new Date()) {
  const { startHour, startMinute, endHour, endMinute } = normalizeSchedule(schedule);
  const current = getIstanbulMinuteOfDay(now);
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  return start <= end ? current >= start && current <= end : current >= start || current <= end;
}

function isDue(schedule, lastCheckedAt, now = new Date()) {
  const { intervalMinutes } = normalizeSchedule(schedule);
  return !lastCheckedAt || now.getTime() - new Date(lastCheckedAt).getTime() >= intervalMinutes * 60_000;
}

function scheduleMinutes(schedule) {
  const { startHour, startMinute, endHour, endMinute } = normalizeSchedule(schedule);
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  return (end >= start ? end - start : 1440 - start + end) + 1;
}

function quotaSummary(channels = []) {
  const items = channels.map(channel => ({
    automationId: channel.automationId,
    channelId: channel.id,
    title: channel.title,
    requests: channel.enabled === false ? 0 : scheduleMinutes(channel.monitor?.schedule)
  }));
  const estimatedRequests = items.reduce((sum, item) => sum + item.requests, 0);
  return { estimatedRequests, limit: DAILY_QUOTA_LIMIT, remaining: DAILY_QUOTA_LIMIT - estimatedRequests, exceeded: estimatedRequests > DAILY_QUOTA_LIMIT, items };
}

async function enqueueEntries(entries, channel) {
  const configKey = getConfigKey();
  let inserted = 0;
  for (const entry of entries) {
    const result = await db().collection('video_events').updateOne(
      { configKey, automationId: channel.automationId, videoId: entry.videoId },
      {
        $setOnInsert: {
          ...entry,
          automationId: channel.automationId,
          channelTitle: channel.title,
          targetGroupId: channel.targetGroupId,
          targetGroupName: channel.targetGroupName,
          deliveryType: channel.deliveryType === 'message' ? 'message' : 'poll',
          configKey,
          videoUrl: `https://www.youtube.com/watch?v=${entry.videoId}`,
          status: 'pending',
          attemptCount: 0,
          receivedAt: new Date(),
          nextAttemptAt: new Date()
        }
      },
      { upsert: true }
    );
    if (result.upsertedCount) inserted += 1;
  }
  return inserted;
}

async function seedExistingVideos(channel) {
  const configKey = getConfigKey();
  const entries = await fetchLatestUploads(channel.id);
  if (!entries.length) return 0;
  const operations = entries.map(entry => ({
    updateOne: {
      filter: { configKey, automationId: channel.automationId, videoId: entry.videoId },
      update: {
        $setOnInsert: {
          ...entry,
          automationId: channel.automationId,
          channelTitle: channel.title,
          targetGroupId: channel.targetGroupId,
          targetGroupName: channel.targetGroupName,
          deliveryType: channel.deliveryType,
          configKey,
          videoUrl: `https://www.youtube.com/watch?v=${entry.videoId}`,
          status: 'ignored',
          reason: 'baseline',
          receivedAt: new Date()
        }
      },
      upsert: true
    }
  }));
  await db().collection('video_events').bulkWrite(operations, { ordered: false });
  return entries.length;
}

async function addChannel(channel, options) {
  const current = await getSettings();
  const channels = current?.channels || [];
  const item = { ...channel, automationId: randomUUID(), targetGroupId: options.targetGroupId, targetGroupName: options.targetGroupName, deliveryType: options.deliveryType, enabled: true, monitor: { startedAt: new Date(), lastError: null, schedule: normalizeSchedule(options.schedule) } };
  const next = [...channels, item];
  const quota = quotaSummary(next);
  const baselineCount = await seedExistingVideos(item);
  await updateSettings({ channels: next });
  return { channel: item, baselineCount, quota };
}

async function reconcileChannels() {
  if (paused) return { skipped: 'paused' };
  activeRuns += 1;
  try {
    const settings = await getSettings();
    const channels = settings?.channels || [];
    const now = new Date();
    let inserted = 0;
    let changed = false;
    for (const channel of channels) {
      const schedule = normalizeSchedule(channel.monitor?.schedule);
      if (channel.enabled === false || !channel.targetGroupId || !isWithinHours(schedule, now) || !isDue(schedule, channel.monitor?.lastCheckedAt, now)) continue;
      changed = true;
      try {
        const entries = await fetchLatestUploads(channel.id);
        inserted += await enqueueEntries(entries, channel);
        channel.monitor = { ...channel.monitor, schedule, lastCheckedAt: new Date(), lastCheckedCount: entries.length, lastError: null };
      } catch (error) {
        channel.monitor = { ...channel.monitor, schedule, lastCheckedAt: new Date(), lastError: error.message };
      }
    }
    if (changed) await updateSettings({ channels });
    return { checkedChannels: changed ? channels.length : 0, inserted, source: 'youtube-data-api' };
  } finally {
    activeRuns -= 1;
    if (activeRuns === 0) {
      for (const resolve of idleWaiters) resolve();
      idleWaiters.clear();
    }
  }
}

function pause() {
  paused = true;
}

function resume() {
  paused = false;
}

async function waitForIdle() {
  if (activeRuns === 0) return;
  await new Promise(resolve => idleWaiters.add(resolve));
}

module.exports = { addChannel, reconcileChannels, normalizeSchedule, isWithinHours, isDue, scheduleMinutes, quotaSummary, pause, resume, waitForIdle };
