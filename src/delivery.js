const { db, getSettings } = require('./db');
const whatsapp = require('./whatsapp');
const { getConfigKey } = require('./config');

let running = false;
let timer;

async function recoverInterrupted() {
  await db().collection('video_events').updateMany(
    { configKey: getConfigKey(), status: 'sending', processingStartedAt: { $lt: new Date(Date.now() - 5 * 60 * 1000) } },
    { $set: { status: 'pending', nextAttemptAt: new Date() }, $unset: { processingStartedAt: '' } }
  );
}

async function processNext() {
  if (running) return;
  running = true;
  try {
    const event = await db().collection('video_events').findOneAndUpdate(
      { configKey: getConfigKey(), status: { $in: ['pending', 'failed'] }, nextAttemptAt: { $lte: new Date() } },
      { $set: { status: 'sending', processingStartedAt: new Date() } },
      { sort: { receivedAt: 1 }, returnDocument: 'after' }
    );
    if (!event) return;
    const settings = await getSettings();
    if (!settings?.targetGroupId) throw new Error('Hedef WhatsApp grubu seçilmedi.');

    try {
      const sent = await whatsapp.sendVideoPoll({ groupId: settings.targetGroupId, videoUrl: event.videoUrl });
      await db().collection('video_events').updateOne(
        { _id: event._id },
        { $set: { status: 'sent', sentAt: new Date(), targetGroupId: sent.groupId, pollMessageId: sent.messageId }, $unset: { lastError: '', nextAttemptAt: '', processingStartedAt: '' } }
      );
    } catch (error) {
      const attemptCount = (event.attemptCount || 0) + 1;
      const delays = [1, 5, 20, 60, 180];
      const delayMinutes = delays[Math.min(attemptCount - 1, delays.length - 1)];
      await db().collection('video_events').updateOne(
        { _id: event._id },
        { $set: { status: 'failed', attemptCount, lastError: error.message, nextAttemptAt: new Date(Date.now() + delayMinutes * 60000) }, $unset: { processingStartedAt: '' } }
      );
    }
  } finally {
    running = false;
  }
}

async function start() {
  await recoverInterrupted();
  timer = setInterval(() => processNext().catch(error => console.error('Teslimat worker hatası:', error)), 15000);
  timer.unref?.();
  processNext().catch(error => console.error('Teslimat worker başlangıç hatası:', error));
}

function kick() {
  setImmediate(() => processNext().catch(error => console.error('Teslimat worker hatası:', error)));
}

module.exports = { start, kick, processNext };
