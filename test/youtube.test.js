const test = require('node:test');
const assert = require('node:assert/strict');
const { parseChannelInput } = require('../src/youtube');
const { normalizeSchedule, isWithinHours, isDue, scheduleMinutes, quotaSummary } = require('../src/youtube-monitor');

test('YouTube handle URL ayrıştırılır', () => {
  assert.deepEqual(parseChannelInput('https://www.youtube.com/@hisarkapisi'), { type: 'handle', value: '@hisarkapisi' });
});

test('kanal ID ayrıştırılır', () => {
  assert.deepEqual(parseChannelInput('UCb2NNTeDSPr2sFHrI2AwHTQ'), { type: 'id', value: 'UCb2NNTeDSPr2sFHrI2AwHTQ' });
});

test('YouTube channel URL ayrıştırılır', () => {
  assert.deepEqual(
    parseChannelInput('https://www.youtube.com/channel/UCb2NNTeDSPr2sFHrI2AwHTQ'),
    { type: 'id', value: 'UCb2NNTeDSPr2sFHrI2AwHTQ' }
  );
});

test('kontrol planı her zaman bir dakikalık sıklık, saat ve dakika sınırlarını kullanır', () => {
  assert.deepEqual(normalizeSchedule({ intervalMinutes: '5', startHour: '9', startMinute: '15', endHour: '18', endMinute: '45' }), { intervalMinutes: 1, startHour: 9, startMinute: 15, endHour: 18, endMinute: 45 });
  assert.throws(() => normalizeSchedule({ startHour: 24 }), /00 ile 23/);
  assert.throws(() => normalizeSchedule({ startMinute: 60 }), /00 ile 59/);
});

test('kontrol saat aralığı Türkiye saatine göre, gece yarısını aşacak şekilde uygulanır', () => {
  const schedule = { intervalMinutes: 1, startHour: 22, endHour: 2 };
  assert.equal(isWithinHours(schedule, new Date('2025-01-01T20:30:00Z')), true); // 23:30 TRT
  assert.equal(isWithinHours(schedule, new Date('2025-01-01T12:30:00Z')), false); // 15:30 TRT
});

test('kontrol her dakika yapılır', () => {
  const now = new Date('2025-01-01T10:05:00Z');
  assert.equal(isDue({ intervalMinutes: 5, startHour: 0, endHour: 23 }, new Date('2025-01-01T10:04:00Z'), now), true);
  assert.equal(isDue({ intervalMinutes: 5, startHour: 0, endHour: 23 }, new Date('2025-01-01T10:04:01Z'), now), false);
});

test('günlük istek tahmini gece yarısını aşan aralıkları doğru hesaplar', () => {
  assert.equal(scheduleMinutes({ startHour: 8, endHour: 20 }), 780);
  assert.equal(scheduleMinutes({ startHour: 22, endHour: 2 }), 300);
  assert.equal(scheduleMinutes({ startHour: 8, startMinute: 30, endHour: 9, endMinute: 15 }), 46);
});

test('kontrol penceresi dakika hassasiyetinde uygulanır', () => {
  const schedule = { startHour: 13, startMinute: 30, endHour: 13, endMinute: 45 };
  assert.equal(isWithinHours(schedule, new Date('2025-01-01T10:29:00Z')), false);
  assert.equal(isWithinHours(schedule, new Date('2025-01-01T10:30:00Z')), true);
  assert.equal(isWithinHours(schedule, new Date('2025-01-01T10:46:00Z')), false);
});

test('kota özeti etkin kanalları toplar, duraklatılan kanalı saymaz', () => {
  const quota = quotaSummary([
    { id: 'one', monitor: { schedule: { startHour: 8, endHour: 14 } } },
    { id: 'two', enabled: false, monitor: { schedule: { startHour: 0, endHour: 23 } } }
  ]);
  assert.equal(quota.estimatedRequests, 420);
  assert.equal(quota.limit, 1000);
  assert.equal(quota.exceeded, false);
});
