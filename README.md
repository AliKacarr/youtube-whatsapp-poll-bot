# YouTube → WhatsApp Anket Botu

Seçilen YouTube kanalının uploads playlist'ini her dakika, Türkiye saatine göre belirlediğiniz saat penceresinde kontrol eder. Yeni video bulunduğunda seçilen WhatsApp grubuna başlığı video URL'si olan `İzledim / İzlemedim` anketi gönderir.

## Nasıl çalışır?

1. Yönetim panelinden WhatsApp QR bağlantısı kurulur.
2. YouTube kanal URL'si, `@handle` veya kanal ID seçilir.
3. Hedef WhatsApp grubu seçilir.
4. Kanal ayarından kontrol saatleri seçilir. Uygulama YouTube Data API `playlistItems.list` metodunu bu pencere içinde her dakika çağırır.
5. Yeni `videoId`, MongoDB'deki benzersiz indeks sayesinde yalnızca bir kez kuyruğa alınır.
6. Baileys seçilen gruba tek seçimli anket gönderir.

Bir `playlistItems.list` çağrısı 1 kota birimidir. Dakikada bir ve gün boyu kontrol yaklaşık 1.440 birim/gün kullanır.

## Yerel kurulum

1. `.env.example` dosyasını `.env` olarak kopyalayın ve değerleri doldurun.
2. `npm install`
3. `npm start`
4. Paneli `http://localhost:3000` adresinden açın.

## Render

- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/api/health`
- `PING_URL`: `https://proje-adiniz.onrender.com/api/health`

WhatsApp oturumu MongoDB koleksiyonunda tutulur; yeniden deploy veya restart sonrasında yerel diske bağlı değildir. `CONFIG_KEY=user23` için oturum otomatik olarak `baileys_auth_user23` koleksiyonunda saklanır. Ayarlar ve video olayları da `CONFIG_KEY` ile filtrelenir; böylece aynı veritabanını kullanan farklı botlar birbirine karışmaz.

## Temel env değerleri

- `MONGO_URI`,
- `DB_NAME`,
- `YOUTUBE_API_KEY`, 
- `YOUTUBE_CHANNEL_ID`,
- `CONFIG_KEY`,
- `PING_URL`
