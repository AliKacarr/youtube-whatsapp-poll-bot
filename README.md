# YouTube → WhatsApp Anket Botu

YouTube kanalında yayınlanan yeni videoları otomatik olarak tespit eden ve seçilen WhatsApp grubuna **İzledim / İzlemedim** seçenekli anket gönderen, web paneliyle yönetilebilen Node.js uygulaması.

> [!IMPORTANT]
> Bu proje WhatsApp'ın resmî Business API'sini değil, Baileys üzerinden bağlı cihaz oturumunu kullanır. Kullanım sorumluluğu size aittir; WhatsApp kullanım koşullarını ve mesaj gönderdiğiniz grubun kurallarını gözetin.

## Öne çıkan özellikler

- YouTube kanalını URL, `@handle`, kullanıcı adı veya kanal kimliğiyle tanımlama
- Kanalın yüklemeler listesini Türkiye saatine göre seçilen saat aralığında her dakika kontrol etme
- Yeni video için WhatsApp grubuna tek seçimli anket gönderme
- QR kodla WhatsApp bağlantısı ve bağlı grupları panelden listeleme
- WhatsApp oturumunu MongoDB'de saklama
- Aynı videonun tekrar gönderilmesini önleyen benzersiz MongoDB indeksi
- Başarısız gönderimler için 1, 5, 20, 60 ve 180 dakikalık kademeli yeniden deneme
- Kesintiye uğrayan teslimatları uygulama yeniden başladığında kurtarma
- Son video olaylarını ve gönderim durumlarını panelde görüntüleme
- Aynı veritabanında birden fazla botu `CONFIG_KEY` ile birbirinden ayırma
- Render ve benzeri Node.js barındırma ortamlarına hazır yapı
- Sağlık kontrolü için `/api/health` endpoint'i

## Çalışma akışı

1. Yönetim panelinden WhatsApp bağlantısı başlatılır ve QR kod okutulur.
2. İzlenecek YouTube kanalı seçilir.
3. Kontrolün çalışacağı başlangıç ve bitiş saatleri belirlenir.
4. Hedef WhatsApp grubu seçilir.
5. İsteğe bağlı olarak test anketi gönderilir.
6. Uygulama, belirlenen saat aralığında kanalın son videolarını her dakika kontrol eder.
7. Yeni bir video bulunduğunda olay MongoDB kuyruğuna eklenir.
8. Video bağlantısı anket başlığı olacak şekilde hedef gruba gönderilir.

Kanal ilk kez kaydedildiğinde mevcut son videolar başlangıç kaydı olarak işaretlenir ve gruba gönderilmez. Böylece yalnızca yapılandırmadan sonra yayınlanan yeni videolar otomasyona dahil edilir.

## Teknoloji yığını

- **Çalışma ortamı:** Node.js 20+
- **Web sunucusu:** Express
- **WhatsApp bağlantısı:** Baileys
- **Veritabanı ve oturum saklama:** MongoDB
- **YouTube entegrasyonu:** YouTube Data API v3
- **Zamanlama:** node-schedule
- **Arayüz:** HTML, CSS ve saf JavaScript

## Gereksinimler

Kuruluma başlamadan önce aşağıdakilere ihtiyacınız vardır:

- Node.js 20 veya üzeri
- Bir MongoDB veritabanı
- YouTube Data API v3 etkinleştirilmiş Google Cloud projesi ve API anahtarı
- QR kod okutabileceğiniz bir WhatsApp hesabı

## Yerel kurulum

Projeyi klonlayın:

```bash
git clone https://github.com/AliKacarr/youtube-whatsapp-poll-bot.git
cd youtube-whatsapp-poll-bot
```

Bağımlılıkları yükleyin:

```bash
npm install
```

Örnek ortam dosyasını kopyalayın:

```bash
cp .env.example .env
```

Windows PowerShell kullanıyorsanız:

```powershell
Copy-Item .env.example .env
```

`.env` değerlerini doldurduktan sonra uygulamayı başlatın:

```bash
npm start
```

Yönetim panelini açın:

```text
http://localhost:3000
```

Geliştirme sırasında dosya değişikliklerinde otomatik yeniden başlatma için:

```bash
npm run dev
```

## Ortam değişkenleri

| Değişken | Zorunlu | Varsayılan | Açıklama |
|---|:---:|---|---|
| `MONGO_URI` | Evet | — | MongoDB bağlantı adresi |
| `DB_NAME` | Evet | — | Kullanılacak MongoDB veritabanının adı |
| `CONFIG_KEY` | Evet | — | Bu bot kurulumunu diğerlerinden ayıran benzersiz anahtar |
| `YOUTUBE_API_KEY` | Evet | — | YouTube Data API v3 anahtarı |
| `PORT` | Hayır | `3000` | HTTP sunucusunun dinleyeceği port; Render otomatik sağlar |
| `NODE_ENV` | Hayır | — | Üretim ortamında `production` olarak ayarlanabilir |
| `YOUTUBE_CHANNEL_ID` | Hayır | — | İlk açılışta kullanılabilecek kanal kimliği; kanal panelden de seçilebilir |
| `PING_URL` | Hayır | — | Tanımlanırsa uygulamanın iki dakikada bir çağıracağı sağlık kontrolü adresi |
| `AUTH_COLLECTION` | Hayır | — | Eski bir Baileys oturum koleksiyonundan tek seferlik geçiş için kaynak koleksiyon |

Örnek:

```env
NODE_ENV=development
PORT=3000

MONGO_URI=mongodb+srv://kullanici:parola@cluster.example.mongodb.net
DB_NAME=youtube_whatsapp_bot
CONFIG_KEY=user23

YOUTUBE_API_KEY=your_youtube_api_key_here
YOUTUBE_CHANNEL_ID=UCxxxxxxxxxxxxxxxxxxxxxx

PING_URL=
```

`CONFIG_KEY` yalnızca harf, rakam, tire ve alt çizgi içerebilir; uzunluğu en fazla 64 karakterdir.

> [!WARNING]
> Gerçek `.env` dosyanızı, MongoDB bağlantı adresinizi veya API anahtarınızı GitHub'a yüklemeyin. Projedeki `.gitignore`, `.env` dosyasını sürüm kontrolü dışında bırakır.

## YouTube API yapılandırması

1. [Google Cloud Console](https://console.cloud.google.com/) üzerinden bir proje oluşturun veya mevcut projenizi seçin.
2. **YouTube Data API v3** hizmetini etkinleştirin.
3. Bir API anahtarı oluşturun.
4. Anahtarı `YOUTUBE_API_KEY` olarak tanımlayın.
5. Mümkünse anahtarı yalnızca YouTube Data API v3 ile sınırlandırın.

Uygulama kanal bilgilerini çözümlemek için `channels.list`, son yüklemeleri almak için `playlistItems.list` çağrılarını kullanır. Kontrol her dakika ve yalnızca panelde belirlenen saat aralığında yapılır.

## Yönetim paneli

Paneldeki kurulum sırası şöyledir:

1. **WhatsApp bağlantısı:** QR kod üretin ve bağlı cihaz olarak okutun.
2. **YouTube kanalı:** Kanal URL'si, `@handle` veya kanal kimliği girin.
3. **Kontrol saatleri:** Başlangıç ve bitiş saatini Türkiye saatine göre seçin.
4. **Hedef grup:** Bağlı WhatsApp hesabındaki gruplardan birini seçin.
5. **Test anketi:** Seçilen gruba test gönderimi yapın.
6. **Otomasyon durumu:** Hedef grup, kontrol planı ve son kontrol zamanını izleyin.
7. **Son video olayları:** Kuyruk ve teslimat durumlarını görüntüleyin.

Gece yarısını aşan saat aralıkları desteklenir. Örneğin `22:00–03:00`, aynı gün 22.00'den gece yarısına ve ertesi gün 03.59'a kadar aktif kabul edilir.

## Anket biçimi

Yeni bir video tespit edildiğinde gönderilen WhatsApp anketi:

- **Başlık:** YouTube video bağlantısı
- **Seçenekler:** `İzledim`, `İzlemedim`
- **Seçilebilir seçenek sayısı:** 1

## Teslimat güvenilirliği

Yeni videolar `video_events` koleksiyonunda kuyruğa alınır. Her kayıt, `CONFIG_KEY + channelId + videoId` birleşimiyle benzersizdir.

Gönderim başarısız olursa olay silinmez. Uygulama aşağıdaki aralıklarla tekrar dener:

```text
1 dakika → 5 dakika → 20 dakika → 60 dakika → 180 dakika
```

Uygulama çalışırken kuyruk yaklaşık 15 saniyede bir işlenir. Beş dakikadan uzun süredir `sending` durumunda kalan kesintiye uğramış kayıtlar yeniden `pending` durumuna alınır.

### Olay durumları

| Durum | Açıklama |
|---|---|
| `ignored` | Kanal seçilirken başlangıç kaydı olarak alınan eski video |
| `pending` | Gönderim kuyruğunda bekliyor |
| `sending` | WhatsApp'a gönderiliyor |
| `sent` | Başarıyla gönderildi |
| `failed` | Gönderilemedi; yeniden deneme zamanı bekleniyor |

## MongoDB koleksiyonları

| Koleksiyon | Amaç |
|---|---|
| `app_settings` | Kanal, hedef grup, kontrol planı ve son kontrol bilgileri |
| `video_events` | Video olayları, kuyruk durumu ve gönderim geçmişi |
| `baileys_auth_<CONFIG_KEY>` | WhatsApp oturum bilgileri ve şifreleme anahtarları |

Ayarlar ve video olayları `CONFIG_KEY` ile ayrılır. Bu sayede aynı MongoDB veritabanı birden fazla bot kurulumu tarafından kullanılabilir.

## Render üzerinde yayınlama

Render'da **Static Site** yerine **Web Service** oluşturun.

| Ayar | Değer |
|---|---|
| Branch | `main` |
| Runtime | `Node` |
| Root Directory | Boş bırakın |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |

Render servisinin **Environment** bölümünde en az şu değerleri tanımlayın:

```env
NODE_ENV=production
MONGO_URI=...
DB_NAME=youtube_whatsapp_bot
CONFIG_KEY=user23
YOUTUBE_API_KEY=...
```

`PORT` değişkenini Render'da elle tanımlamanız gerekmez. Render bu değeri çalışma anında sağlar.

İsteğe bağlı sağlık kontrolü:

```env
PING_URL=https://servis-adiniz.onrender.com/api/health
```

WhatsApp oturumu MongoDB'de tutulduğu için normal yeniden başlatmalarda yerel diske bağlı değildir. Oturumu panelden sıfırlarsanız ilgili `baileys_auth_<CONFIG_KEY>` koleksiyonundaki oturum verileri silinir ve yeni QR kod üretilir.

## API özeti

| Metot | Endpoint | Açıklama |
|---|---|---|
| `GET` | `/api/health` | Uygulama sağlık ve çalışma süresi bilgisi |
| `GET` | `/api/status` | WhatsApp durumu ve uygulama ayarları |
| `POST` | `/api/whatsapp/start` | WhatsApp bağlantısını başlatır |
| `POST` | `/api/whatsapp/logout` | Oturumu siler ve yeni bağlantı sürecini başlatır |
| `GET` | `/api/groups` | Bağlı hesabın WhatsApp gruplarını listeler |
| `POST` | `/api/youtube/resolve` | Kanal girdisini doğrular ve kanal bilgisini çözümler |
| `PUT` | `/api/settings/channel` | İzlenecek kanalı kaydeder |
| `PUT` | `/api/settings/group` | Hedef WhatsApp grubunu kaydeder |
| `PUT` | `/api/settings/monitor` | Kontrol saatlerini günceller |
| `POST` | `/api/test-poll` | Test anketi gönderir |
| `GET` | `/api/events?page=0` | Sayfalanmış video olaylarını listeler |

## Proje yapısı

```text
.
├── public/
│   ├── app.js              # Yönetim paneli davranışları
│   ├── index.html          # Yönetim paneli
│   └── styles.css          # Arayüz stilleri
├── src/
│   ├── config.js           # Ortam değişkeni doğrulama
│   ├── db.js               # MongoDB bağlantısı ve ayarlar
│   ├── delivery.js         # Teslimat kuyruğu ve yeniden deneme
│   ├── server.js           # Express sunucusu ve zamanlanmış görevler
│   ├── whatsapp.js         # Baileys bağlantısı ve anket gönderimi
│   ├── youtube-monitor.js  # Kanal izleme ve yeni video tespiti
│   └── youtube.js          # YouTube Data API istemcisi
├── test/
│   └── youtube.test.js     # Kanal girdisi ve zamanlama testleri
├── .env.example
├── package.json
└── README.md
```

## Komutlar

| Komut | Açıklama |
|---|---|
| `npm start` | Uygulamayı başlatır |
| `npm run dev` | Node.js watch modunda geliştirme sunucusunu başlatır |
| `npm test` | Testleri çalıştırır |

## Testler

```bash
npm test
```

Test paketi şu davranışları doğrular:

- YouTube `@handle` URL'lerinin ayrıştırılması
- Kanal kimliklerinin ayrıştırılması
- `/channel/UC...` URL'lerinin ayrıştırılması
- Kontrol sıklığının bir dakika olması
- Türkiye saatine göre kontrol penceresi
- Gece yarısını aşan saat aralıkları

## Güvenlik notları

- `.env` dosyasını sürüm kontrolüne eklemeyin.
- MongoDB kullanıcısına yalnızca gereken veritabanı izinlerini verin.
- YouTube API anahtarını mümkün olduğunca API ve kullanım alanı bazında sınırlandırın.
- Yönetim panelini herkese açık bir adreste çalıştırıyorsanız erişim kontrolünü ters proxy veya barındırma katmanında sağlayın.
- WhatsApp oturum koleksiyonu hassas kimlik doğrulama verileri içerir; veritabanı erişimini sınırlandırın.

## Sorun giderme

### QR kod görünmüyor

- `MONGO_URI`, `DB_NAME` ve `CONFIG_KEY` değerlerini kontrol edin.
- Uygulama loglarında MongoDB bağlantı hatası olup olmadığına bakın.
- Panelde **WhatsApp bağlantısını başlat** düğmesine basın.

### Grup listesi yüklenmiyor

- WhatsApp durumunun **Bağlı** olduğundan emin olun.
- Bağlanan hesabın en az bir WhatsApp grubunda bulunduğunu kontrol edin.
- Oturum sorunluysa panelden bağlantıyı sıfırlayıp QR kodu yeniden okutun.

### Kanal bulunamıyor

- `YOUTUBE_API_KEY` değerini ve YouTube Data API v3 hizmetinin etkin olduğunu doğrulayın.
- Kanalın `@handle`, `/channel/UC...` adresini veya kanal kimliğini kullanın.
- Google Cloud Console'daki API anahtarı kısıtlamalarını kontrol edin.

### Yeni video gönderilmiyor

- Geçerli saatin paneldeki kontrol aralığında olduğunu doğrulayın.
- Hedef grubun seçili ve WhatsApp bağlantısının açık olduğunu kontrol edin.
- Paneldeki **Son video olayları** tablosunda olay ve hata durumunu inceleyin.
- YouTube API kotasının tükenmediğini kontrol edin.

## Geliştirici

**Ali Kaçar**

[![Instagram](https://img.shields.io/badge/Instagram-E4405F?logo=instagram&logoColor=white)](https://www.instagram.com/alikacar23/)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0077B5?logo=linkedin&logoColor=white)](https://www.linkedin.com/in/alikacar23/)
[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/AliKacarr)
[![YouTube](https://img.shields.io/badge/YouTube-FF0000?logo=youtube&logoColor=white)](https://www.youtube.com/@alikacardev)

[alikacardev@gmail.com](mailto:alikacardev@gmail.com)

---

## Lisans

Bu proje [APACHE Lisansı](LICENSE.txt) ile lisanslanmıştır.