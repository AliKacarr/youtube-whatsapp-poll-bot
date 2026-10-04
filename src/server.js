require('dotenv').config();

// Baileys/libsignal bazen yeniden bağlantı sırasında artık geçerli olmayan eski
// mesaj oturumlarını çözmeye çalışır ve uygulamanın çalışmasını etkilemeyen uzun
// Bad MAC stack trace'leri basar. Yalnızca bu bilinen gürültüyü sustururuz;
// diğer stdout/stderr hata ve uyarıları görünmeye devam eder.
const ignoredSignalLogFragments = [
  'Failed to decrypt message with any known session',
  'Session error:Error: Bad MAC',
  'Bad MAC Error: Bad MAC',
  'Closing open session',
  'Closing session: SessionEntry',
  'Object.verifyMAC',
  'SessionCipher.doDecryptWhisperMessage',
  'SessionCipher.decryptWithSessions',
  'libsignal\\src\\session_cipher.js',
  'libsignal/src/session_cipher.js'
];

for (const stream of [process.stdout, process.stderr]) {
  const originalWrite = stream.write.bind(stream);
  stream.write = (chunk, encoding, callback) => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
    if (ignoredSignalLogFragments.some(fragment => text.includes(fragment))) {
      if (typeof callback === 'function') callback();
      return true;
    }
    return originalWrite(chunk, encoding, callback);
  };
}

const path = require('path');
const express = require('express');
const schedule = require('node-schedule');
const { connectDatabase, closeDatabase, db, getSettings, updateSettings, resetSettings } = require('./db');
const { getConfigKey } = require('./config');
const youtube = require('./youtube');
const youtubeMonitor = require('./youtube-monitor');
const whatsapp = require('./whatsapp');
const delivery = require('./delivery');

const app = express();
const port = Number(process.env.PORT) || 3000;

app.disable('x-powered-by');
app.get('/api/health', (req, res) => res.json({ ok: true, uptime: Math.round(process.uptime()), timestamp: new Date().toISOString() }));

app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { etag: true, maxAge: 0 }));

app.get('/api/status', async (req, res) => {
  const settings = await getSettings();
  res.json({
    ok: true,
    whatsapp: whatsapp.getState(),
    settings
  });
});

app.post('/api/whatsapp/start', async (req, res, next) => {
  try { await whatsapp.start(false); res.json({ ok: true, whatsapp: whatsapp.getState() }); } catch (error) { next(error); }
});

app.post('/api/whatsapp/logout', async (req, res, next) => {
  delivery.pause();
  youtubeMonitor.pause();
  try {
    await whatsapp.logout();
    await youtubeMonitor.waitForIdle();
    const settings = await resetSettings();
    await delivery.cancelOutstanding();
    res.json({ ok: true, whatsapp: whatsapp.getState(), settings });
  } catch (error) { next(error); }
  finally {
    youtubeMonitor.resume();
    delivery.resume();
  }
});

app.get('/api/groups', async (req, res, next) => {
  try { const groups = await whatsapp.groups(); res.json({ ok: true, groups }); } catch (error) { next(error); }
});

app.get('/api/channel-thumbnail', async (req, res, next) => {
  try {
    const settings = await getSettings();
    if (!settings?.youtubeChannelThumbnail) return res.sendStatus(404);
    const thumbnailUrl = new URL(settings.youtubeChannelThumbnail);
    const allowedHosts = ['yt3.ggpht.com', 'yt3.googleusercontent.com'];
    if (thumbnailUrl.protocol !== 'https:' || !allowedHosts.includes(thumbnailUrl.hostname)) return res.sendStatus(404);
    const response = await fetch(thumbnailUrl, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Kanal görseli alınamadı (${response.status})`);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) throw new Error('Kanal görseli geçerli bir resim değil.');
    const image = Buffer.from(await response.arrayBuffer());
    if (image.length > 5 * 1024 * 1024) throw new Error('Kanal görseli çok büyük.');
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(image);
  } catch (error) { next(error); }
});

app.post('/api/youtube/resolve', async (req, res, next) => {
  try { res.json({ ok: true, channel: await youtube.resolveChannel(req.body.input) }); } catch (error) { next(error); }
});

app.put('/api/settings/channel', async (req, res, next) => {
  try {
    const settings = await getSettings();
    if (whatsapp.getState().status !== 'READY') throw new Error('Önce WhatsApp bağlantısını tamamlayın.');
    if (!settings?.targetGroupId) throw new Error('Önce hedef WhatsApp grubunu seçin.');
    const channel = await youtube.resolveChannel(req.body.input);
    const monitor = await youtubeMonitor.configureChannel(channel);
    res.json({ ok: true, channel, monitor });
  } catch (error) { next(error); }
});

app.put('/api/settings/group', async (req, res, next) => {
  try {
    if (whatsapp.getState().status !== 'READY') throw new Error('Önce WhatsApp bağlantısını tamamlayın.');
    const groupId = String(req.body.groupId || '').trim();
    if (!groupId.endsWith('@g.us')) throw new Error('Geçerli bir WhatsApp grup JID seçin.');
    const groups = await whatsapp.groups();
    const group = groups.find(item => item.id === groupId);
    if (!group) throw new Error('Seçilen grup bağlı WhatsApp hesabında bulunamadı.');
    res.json({ ok: true, settings: await updateSettings({ targetGroupId: group.id, targetGroupName: group.name }) });
  } catch (error) { next(error); }
});

app.put('/api/settings/delivery', async (req, res, next) => {
  try {
    const settings = await getSettings();
    if (whatsapp.getState().status !== 'READY') throw new Error('Önce WhatsApp bağlantısını tamamlayın.');
    if (!settings?.targetGroupId) throw new Error('Önce hedef WhatsApp grubunu seçin.');
    const deliveryType = String(req.body.deliveryType || '').trim();
    if (!['poll', 'message'].includes(deliveryType)) throw new Error('Gönderim biçimi anket veya mesaj olmalıdır.');
    res.json({ ok: true, settings: await updateSettings({ deliveryType }) });
  } catch (error) { next(error); }
});

app.put('/api/settings/monitor', async (req, res, next) => {
  try {
    const settings = await getSettings();
    if (whatsapp.getState().status !== 'READY') throw new Error('Önce WhatsApp bağlantısını tamamlayın.');
    if (!settings?.targetGroupId) throw new Error('Önce hedef WhatsApp grubunu seçin.');
    const schedule = youtubeMonitor.normalizeSchedule(req.body);
    const deliveryType = String(req.body.deliveryType || '').trim();
    if (!['poll', 'message'].includes(deliveryType)) throw new Error('Gönderim biçimi anket veya mesaj olmalıdır.');
    res.json({ ok: true, settings: await updateSettings({ 'monitor.schedule': schedule, deliveryType }) });
  } catch (error) { next(error); }
});

app.post('/api/test-delivery', async (req, res, next) => {
  try {
    const settings = await getSettings();
    if (whatsapp.getState().status !== 'READY' || !settings?.youtubeChannelId || !settings?.targetGroupId) throw new Error('Test için WhatsApp bağlantısı, YouTube kanalı ve hedef grup tamamlanmalıdır.');
    const videoUrl = String(req.body.videoUrl || 'https://www.youtube.com/watch?v=test').trim();
    const deliveryType = settings.deliveryType === 'message' ? 'message' : 'poll';
    const result = deliveryType === 'message'
      ? await whatsapp.sendVideoMessage({ title: req.body.title || 'Test video başlığı', videoUrl })
      : await whatsapp.sendVideoPoll({ videoUrl });
    res.json({ ok: true, deliveryType, result });
  } catch (error) { next(error); }
});

app.get('/api/events', async (req, res, next) => {
  try {
    const requestedPage = Number.parseInt(req.query.page, 10);
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 0;
    const filter = { configKey: getConfigKey() };
    const [events, total] = await Promise.all([
      db().collection('video_events').find(filter).sort({ receivedAt: -1 }).skip(page * 10).limit(10).toArray(),
      db().collection('video_events').countDocuments(filter)
    ]);
    res.json({ ok: true, events, total, page });
  } catch (error) { next(error); }
});

app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'Endpoint bulunamadı.' }));
app.use((error, req, res, next) => {
  console.error(error);
  res.status(400).json({ ok: false, error: error.message || 'Beklenmeyen hata.' });
});

function scheduleJobs() {
  if (process.env.PING_URL?.trim()) {
    schedule.scheduleJob('*/2 * * * *', async () => {
      try {
        const response = await fetch(process.env.PING_URL.trim());
        if (!response.ok) console.warn(`Health self-ping başarısız: ${response.status}`);
      } catch (error) { console.warn('Health self-ping hatası:', error.message); }
    });
  }
  // Zamanlayıcı her dakika çalışır; kayıtlı aralık ve saat penceresi
  // reconcileCurrentChannel içinde uygulanır. videoId unique indeksi tekrar gönderimi önler.
  schedule.scheduleJob('* * * * *', async () => {
    try {
      const result = await youtubeMonitor.reconcileCurrentChannel();
      if (result?.inserted) delivery.kick();
    } catch (error) { console.warn('YouTube video kontrolü hatası:', error.message); }
  });
}

async function main() {
  await connectDatabase();
  await delivery.start();
  whatsapp.start(true).catch(error => console.warn('WhatsApp otomatik başlatılamadı:', error.message));
  scheduleJobs();
  await new Promise(resolve => app.listen(port, '0.0.0.0', () => {
    console.log(`Sunucu 0.0.0.0:${port} üzerinde hazır.`);
    resolve();
  }));
  youtubeMonitor.reconcileCurrentChannel()
    .then(result => { if (result?.inserted) delivery.kick(); })
    .catch(error => console.warn('YouTube başlangıç kontrolü başarısız:', error.message));
}

async function shutdown() {
  await closeDatabase().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (require.main === module) main().catch(error => { console.error('Başlatma hatası:', error); process.exit(1); });

module.exports = { app, main };
