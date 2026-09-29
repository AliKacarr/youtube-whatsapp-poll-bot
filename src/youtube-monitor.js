const { db, getSettings, updateSettings } = require('./db');
const { fetchLatestUploads } = require('./youtube');
const { getConfigKey } = require('./config');

const DEFAULT_SCHEDULE = Object.freeze({ intervalMinutes: 1, startHour: 0, endHour: 23 });

function normalizeSchedule(schedule = {}) {
  const intervalMinutes = DEFAULT_SCHEDULE.intervalMinutes;
  const startHour = Number(schedule.startHour ?? DEFAULT_SCHEDULE.startHour);
  const endHour = Number(schedule.endHour ?? DEFAULT_SCHEDULE.endHour);
  if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23 || !Number.isInteger(endHour) || endHour < 0 || endHour > 23) throw new Error('Kontrol saatleri 00 ile 23 arasında olmalıdır.');
  return { intervalMinutes, startHour, endHour };
}

function getIstanbulHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Istanbul', hour: '2-digit', hourCycle: 'h23' }).format(now));
}

function isWithinHours(schedule, now = new Date()) {
  const { startHour, endHour } = normalizeSchedule(schedule);
  const hour = getIstanbulHour(now);
  return startHour <= endHour ? hour >= startHour && hour <= endHour : hour >= startHour || hour <= endHour;
}

function isDue(schedule, lastCheckedAt, now = new Date()) {
  const { intervalMinutes } = normalizeSchedule(schedule);
  return !lastCheckedAt || now.getTime() - new Date(lastCheckedAt).getTime() >= intervalMinutes * 60_000;
}

async function enqueueEntries(entries) {
  const configKey = getConfigKey();
  let inserted = 0;
  for (const entry of entries) {
    const result = await db().collection('video_events').updateOne(
      { configKey, channelId: entry.channelId, videoId: entry.videoId },
      {
        $setOnInsert: {
          ...entry,
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

async function seedExistingVideos(channelId) {
  const configKey = getConfigKey();
  const entries = await fetchLatestUploads(channelId);
  if (!entries.length) return 0;
  const operations = entries.map(entry => ({
    updateOne: {
      filter: { configKey, channelId: entry.channelId, videoId: entry.videoId },
      update: {
        $setOnInsert: {
          ...entry,
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

async function configureChannel(channel) {
  const current = await getSettings();
  const alreadyMonitoring = current?.youtubeChannelId === channel.id && (
    current?.monitor?.enabled === true || current?.subscription?.status === 'active'
  );

  let baselineCount = 0;
  if (!alreadyMonitoring) baselineCount = await seedExistingVideos(channel.id);

  const startedAt = alreadyMonitoring
    ? current?.monitor?.startedAt || current?.subscription?.verifiedAt || new Date()
    : new Date();

  await updateSettings({
    youtubeChannelId: channel.id,
    youtubeChannelTitle: channel.title,
    youtubeChannelThumbnail: channel.thumbnail || null,
    youtubeInput: channel.input,
    monitor: { enabled: true, startedAt, lastError: null, schedule: normalizeSchedule(current?.monitor?.schedule) }
  });

  return { enabled: true, schedule: normalizeSchedule(current?.monitor?.schedule), baselineCount };
}

async function reconcileCurrentChannel() {
  const settings = await getSettings();
  if (!settings?.youtubeChannelId || settings?.monitor?.enabled === false) return null;
  const schedule = normalizeSchedule(settings.monitor?.schedule);
  const now = new Date();
  if (!isWithinHours(schedule, now)) return { skipped: 'outside-hours' };
  if (!isDue(schedule, settings.monitor?.lastCheckedAt, now)) return { skipped: 'not-due' };

  try {
    const entries = await fetchLatestUploads(settings.youtubeChannelId);
    const inserted = await enqueueEntries(entries);
    await updateSettings({
      'monitor.enabled': true,
      'monitor.schedule': schedule,
      'monitor.lastCheckedAt': new Date(),
      'monitor.lastCheckedCount': entries.length,
      'monitor.lastError': null
    });
    return { checked: entries.length, inserted, source: 'youtube-data-api' };
  } catch (error) {
    await updateSettings({
      'monitor.lastCheckedAt': new Date(),
      'monitor.lastError': error.message
    });
    throw error;
  }
}

module.exports = { configureChannel, reconcileCurrentChannel, normalizeSchedule, isWithinHours, isDue };
