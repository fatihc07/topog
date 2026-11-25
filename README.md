# Topog — Dünya Fiziksel Haritası & Canlı Atmosfer Atlası

**Aktif Sürüm:** `T 4.3` · **Sürüm Geçmişi:** [CHANGELOG.md](./CHANGELOG.md)

Topog; tamamen ücretsiz, API anahtarı gerektirmeyen açık coğrafi ve meteorolojik veri kaynaklarıyla çalışan etkileşimli 2B/3B dünya fiziksel harita, canlı hava durumu, yağmur radarı ve uydu bulut örtüsü uygulamasıdır.

---

## Özellikler

### Harita ve 3D Arazi
- **5 Ücretsiz Altlık Harita Katmanı** (harita stilini sıfırlamadan anlık geçiş):
  - **OpenTopoMap** (Eşyükselti eğrileri ve kabartma)
  - **Esri World Physical** (Doğal yer şekilleri ve okyanus tabanı)
  - **Esri World Topo** (Detaylı topoğrafik ve hidrografik harita)
  - **OpenStreetMap Standart** (Küresel yol ağı ve yerleşimler)
  - **Esri World Imagery** (Gerçek uydu görüntüleri)
- **3D Arazi (DEM):** AWS Terrarium yükseklik karoları ile 3 boyutlu yeryüzü ve `1.0x – 3.0x` yükseklik abartısı kaydırıcısı.
- **Gölgeli Kabartma (Hillshade)** ve **Küre Görünümü (Globe)** projeksiyonu.
- **Ülke Modu:** Natural Earth `ne_50m_admin_0_countries` tabanlı 242 ülke/bölge sınır verisi ([`public/data/countries.geojson`](./public/data/countries.geojson)); fareyle üzerine gelindiğinde parlak cam mavisi sınır vurgusu ve imleç yanında bayraklı Türkçe ülke adı/kıta kartı.
- **Arama, Odak ve Nokta İnceleme:**
  - Nominatim ile canlı yer/dağ/şehir arama.
  - Hızlı yer şekli odak çipleri (*Türkiye, Ağrı Dağı, Everest, Mont Blanc, Büyük Kanyon, Aconcagua*).
  - Haritada herhangi bir noktaya tıklayınca ters coğrafi kodlama ve Open-Meteo Elevation API üzerinden gerçek rakım (m) ölçümü.
  - **Canlı Deniz & Dalga Durumu:** Deniz/kıyı noktalarına tıklandığında Open-Meteo Marine API üzerinden gerçek deniz suyu sıcaklığı (`°C`), dalga yüksekliği (`m`), dalga periyodu (`sn`) ve dalga yönü (15 dakikalık önbellekli).

### Bölgeye Duyarlı Canlı Hava Durumu & 15 Dakikalık Önbellek
- **Küresel + Türkiye Kapsamı:** 4.964 küresel şehir/başkent ve 83 Türkiye yerleşimi ([`src/data/worldCities.json`](./src/data/worldCities.json)); `z10+` yakınlaştırmada ise merkezdeki ilçe/kasaba otomatik keşfedilir.
- **Dağlar & Zirveler Katmanı:** 113 küresel zirve ve 34 Türkiye dağı ([`src/data/worldPeaks.json`](./src/data/worldPeaks.json)); `z5.0+` seviyesinde dağ adı, rakım, Open-Meteo `elevation` parametreli gerçek zirve sıcaklığı ve gerçek anlık kar kalınlığı (`❄ XX cm`), `z9.5+` seviyesinde OpenStreetMap Overpass ilave zirve keşfi ve altın üçgenli zirve rozetleri.
- **15 Dakikalık Kalıcı Önbellek (RAM + `localStorage`):** Aynı bölgeye 15 dakika içinde dönüldüğünde API isteği atılmadan bellekten gösterilir; 15 dakika dolduğunda otomatik olarak güncel veri çekilir.
- **Canlı Animasyonlu SVG İkonlar & Tam Konum Sabitleme:** Güneş, ay/yıldız, sürüklenen bulut, yağmur damlaları, kar taneleri, sis ve şimşek animasyonları haritada tam şehir koordinatına sabitlenir; Canlı Atlas rozetlerinde kompakt **`H XX°`** hissedilen sıcaklık göstergesi de yer alır.
- **Arka Plan Şeffaflık Kontrolü (`%0 – %100`):** Yalnızca etiketin koyu arka planını saydamlaştırır; şehir/zirve adı, sıcaklık ve ikon her zaman `%100` net kalır.
- **Detaylı Hava Durumu Kartı:** Sıcaklık, hissedilen sıcaklık, nem, rüzgar, basınç, zirve rakımı ve kar kalınlığı/taze kar bilgisi, önbellekte kalan geçerlilik süresi ve **Şimdi Yenile** düğmesi.

### Atmosfer Katmanları
- **Güneş & Gece Sınırı (Terminator):** Dünya üzerindeki anlık gece-gündüz sınırı, 24 saatlik oynatılabilir zaman çizelgesi, `Gündüz / Altın Saat / Gece` fazı ve güneş azimutuna göre dinamik 3D dağ gölge yönü.
- **Yağmur Radarı (RainViewer):** Canlı yağış radarı, `%20 – %100` şeffaflık ayarı ve son 2 saat için **Oynat / Duraklat** animasyon çubuğu.
- **Canlı Bulut Örtüsü (Uydu IR):** SSEC RealEarth küresel jeostasyoner uydu IR bulut katmanı (`z8`'e kadar yüksek çözünürlük, özel `cloud-ir://` şeffaf bulut protokolü) ve `%20 – %100` şeffaflık ayarı.

### Sürüm Takibi
- Uygulama içi sol üstteki **`T 4.3`** rozetine tıklayarak tüm sürüm notlarını (*Eklenenler / Yapılanlar / Çıkarılanlar*) görüntüleyebilirsiniz.
- Proje kuralları ve uzman alt ajan rehberi [`AGENTS.md`](./AGENTS.md) ve [`.agents/agents/`](./.agents/agents/) içinde tutulur.

---

## Hızlı Başlangıç

### macOS Tek Tıkla Başlatma
Klasördeki **`Topog.command`** dosyasına çift tıklayın; sunucuyu otomatik başlatıp tarayıcıda `http://localhost:5173` adresini açar.

### Terminal Üzerinden
```bash
npm install
npm run dev
```

Üretim derlemesi için:
```bash
npm run build
```

---

## Teknoloji Yığını
- **Arayüz:** React 19, TypeScript, Vite, Lucide React
- **Harita Motoru:** MapLibre GL JS
- **Açık Veri Kaynakları:** OpenStreetMap, OpenTopoMap, Esri ArcGIS Online, AWS Terrain Tiles (Terrarium), Nominatim, Open-Meteo, RainViewer, SSEC RealEarth, Natural Earth

---

## Sürüm Kuralı
Sürümler `T <Büyük>.<Küçük>` formatında ilerler (`T 1.0`, `T 1.1`, ..., `T 2.0`). Her güncellemenin raporu [`CHANGELOG.md`](./CHANGELOG.md) ve [`src/config/version.ts`](./src/config/version.ts) içinde tutulur.
