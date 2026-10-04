const test = require('node:test');
const assert = require('node:assert/strict');

process.env.CONFIG_KEY ||= 'test';

function loadDelivery({ settings, event = null }) {
  const dbPath = require.resolve('../src/db');
  const whatsappPath = require.resolve('../src/whatsapp');
  const deliveryPath = require.resolve('../src/delivery');
  const updateOneCalls = [];
  const updateManyCalls = [];
  let nextEvent = event;
  const collection = {
    findOneAndUpdate: async () => {
      const result = nextEvent;
      nextEvent = null;
      return result;
    },
    updateOne: async (...args) => { updateOneCalls.push(args); },
    updateMany: async (...args) => { updateManyCalls.push(args); }
  };

  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: { db: () => ({ collection: () => collection }), getSettings: async () => settings }
  };
  require.cache[whatsappPath] = {
    id: whatsappPath,
    filename: whatsappPath,
    loaded: true,
    exports: {
      sendVideoPoll: async () => ({ groupId: settings?.targetGroupId, messageId: 'message-1' }),
      sendVideoMessage: async () => ({ groupId: settings?.targetGroupId, messageId: 'message-1' })
    }
  };
  delete require.cache[deliveryPath];

  return { delivery: require(deliveryPath), updateOneCalls, updateManyCalls };
}

test('hedef grup yoksa alınan olay yeniden denenecek şekilde failed yapılır', async () => {
  const { delivery, updateOneCalls } = loadDelivery({
    settings: { targetGroupId: null },
    event: { _id: 'event-1', attemptCount: 0, videoUrl: 'https://youtube.com/watch?v=test' }
  });

  await delivery.processNext();

  assert.equal(updateOneCalls.length, 1);
  assert.equal(updateOneCalls[0][1].$set.status, 'failed');
  assert.match(updateOneCalls[0][1].$set.lastError, /Hedef WhatsApp grubu/);
  assert.equal(updateOneCalls[0][1].$unset.processingStartedAt, '');
});

test('ayarlar sıfırlanırken bekleyen teslimatlar silinmeden iptal edilir', async () => {
  const { delivery, updateManyCalls } = loadDelivery({ settings: {} });

  await delivery.cancelOutstanding();

  assert.equal(updateManyCalls.length, 1);
  assert.deepEqual(updateManyCalls[0][0].status.$in, ['pending', 'failed', 'sending']);
  assert.equal(updateManyCalls[0][1].$set.status, 'cancelled');
  assert.equal(updateManyCalls[0][1].$set.reason, 'settings-reset');
});
