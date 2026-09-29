const { MongoClient } = require('mongodb');
const { getConfigKey } = require('./config');

let client;
let database;

async function connectDatabase() {
  const uri = process.env.MONGO_URI?.trim();
  const dbName = process.env.DB_NAME?.trim();
  if (!uri || !dbName) throw new Error('MONGO_URI ve DB_NAME zorunludur.');

  client = new MongoClient(uri);
  await client.connect();
  database = client.db(dbName);
  const configKey = getConfigKey();

  const oldIndex = await database.collection('video_events').indexExists('unique_channel_video');
  if (oldIndex) await database.collection('video_events').dropIndex('unique_channel_video');

  // Önceki tek-kullanıcılı sürümün kayıtlarını ilk çalıştırmada bu bota bağla.
  const settings = database.collection('app_settings');
  if (!(await settings.findOne({ _id: configKey }))) {
    const legacySettings = await settings.findOne({ _id: 'main' });
    if (legacySettings) {
      const { _id, ...fields } = legacySettings;
      await settings.insertOne({ _id: configKey, ...fields, configKey, updatedAt: new Date() });
      await settings.deleteOne({ _id: 'main' });
    }
  }
  await database.collection('video_events').updateMany(
    { configKey: { $exists: false } },
    { $set: { configKey } }
  );

  await Promise.all([
    database.collection('video_events').createIndex(
      { configKey: 1, channelId: 1, videoId: 1 },
      { unique: true, name: 'unique_config_channel_video' }
    ),
    database.collection('video_events').createIndex({ status: 1, nextAttemptAt: 1 }),
    database.collection('app_settings').createIndex({ updatedAt: 1 })
  ]);

  await database.collection('app_settings').updateOne(
    { _id: configKey },
    {
      $setOnInsert: {
        youtubeChannelId: process.env.YOUTUBE_CHANNEL_ID?.trim() || null,
        configKey,
        youtubeChannelTitle: null,
        youtubeChannelThumbnail: null,
        youtubeInput: process.env.YOUTUBE_CHANNEL_ID?.trim() || null,
        targetGroupId: null,
        targetGroupName: null,
        monitor: { enabled: true, schedule: { intervalMinutes: 1, startHour: 0, endHour: 23 } },
        createdAt: new Date()
      },
      $set: { updatedAt: new Date() }
    },
    { upsert: true }
  );

  console.log(`MongoDB bağlantısı hazır: ${dbName}`);
  return database;
}

function db() {
  if (!database) throw new Error('Veritabanı henüz hazır değil.');
  return database;
}

async function getSettings() {
  return db().collection('app_settings').findOne({ _id: getConfigKey() });
}

async function updateSettings(update) {
  await db().collection('app_settings').updateOne(
    { _id: getConfigKey() },
    { $set: { ...update, updatedAt: new Date() } },
    { upsert: true }
  );
  return getSettings();
}

async function closeDatabase() {
  if (client) await client.close();
}

module.exports = { connectDatabase, closeDatabase, db, getSettings, updateSettings };
