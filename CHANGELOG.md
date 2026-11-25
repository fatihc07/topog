# Topog Sürüm Notları ve Değişiklik Raporu

Sürüm numaralandırma kuralı: **`T <Büyük>.<Küçük>`**
- Küçük güncellemelerde ikinci sayı artar (`T 1.1`, `T 1.2`, ...).
- Büyük güncellemelerde birinci sayı artar (`T 2.0`, `T 3.0`, ...).
- Her sürümde **Eklenenler**, **Yapılanlar / İyileştirmeler** ve **Çıkarılanlar** başlıkları altında rapor tutulur ve `src/config/version.ts` ile senkronize edilir.

---

## [T 2.0] — 2026-11-25
**Büyük Sürüm — Gece/Gündüz Sınırı & 3D Güneş Gölgesi, Canlı Deniz & Dalga Verisi, Sinematik 3D Drone Uçuşu**

### Eklenenler
- **Gece/Gündüz Sınırı (Terminator) & 3D Güneş Gölgesi Simülatörü** (`src/services/solarService.ts`, `src/components/SolarTimeline.tsx`, `MapCanvas.tsx`): Dünya üzerindeki anlık gece-gündüz sınırı, 24 saatlik oynatılabilir zaman çizelgesi, `Gündüz / Altın Saat / Gece` fazı göstergesi ve güneş azimutuna göre dinamik dağ gölge yönü (`hillshade-illumination-direction`).
- **Canlı Deniz Suyu Sıcaklığı & Dalga Yüksekliği** (`src/services/marineService.ts`, `src/components/MarineSection.tsx`, `InspectCard.tsx`): Deniz/kıyı noktalarına tıklandığında Open-Meteo Marine API üzerinden gerçek deniz suyu sıcaklığı (`°C`), dalga yüksekliği (`m`), dalga periyodu (`sn`) ve dalga yönü (15 dakikalık RAM + `localStorage` önbellekle; kara noktalarında uydurma veri üretilmez).
- **Sinematik 3D Drone Uçuş Modu** (`src/services/flyoverPresets.ts`, `src/components/FlyoverBar.tsx`, `MapCanvas.tsx`): 6 ikonik manzara durağı (*Ağrı Dağı, Kaçkarlar, Erciyes Dağı, Everest & Himalayalar, Alpler / Mont Blanc, Büyük Kanyon*) + haritadaki herhangi bir şehir, dağ veya noktadan başlatılabilen 3D arazi üzerinde otomatik yörünge uçuşu (`0.5x`/`1x`/`2x` hız ve `55°`/`65°`/`75°` kamera açısı).

### Yapılanlar / İyileştirmeler
- Katman paneline `Güneş & Gece Sınırı` ve `3B Drone Uçuşu` anahtarları eklendi (`LayerPanel.tsx`).
- İnceleme ve hava durumu detay kartlarına doğrudan `Drone Uçuşu` başlatma düğmeleri eklendi (`InspectCard.tsx`, `WeatherDetailCard.tsx`).
- Çoklu alt kontrol çubukları `.bottom-bars-stack` ile çakışmasız ve düzenli hizalandı (`App.tsx`, `index.css`).

### Çıkarılanlar
- Bu sürümde kaldırılan bir özellik yoktur.

---

## [T 1.4] — 2026-11-25
**Dağ ve Zirvelerde Gerçek Anlık Kar Kalınlığı**

### Eklenenler
- Dağ/zirve Open-Meteo sorgusuna gerçek anlık kar kalınlığı (`snow_depth`) ve taze kar yağışı (`snowfall`) verileri eklendi (`src/services/peakService.ts`, `src/types/weather.ts`).
- Zirvede gerçek kar kalınlığı (`>= 1 cm`) varsa harita etiketlerinde `❄ XX cm` göstergesi (`MapCanvas.tsx`) ve detay kartında `Kar Kalınlığı` kutusu (`WeatherDetailCard.tsx`, `index.css`) görüntülenir.

### Yapılanlar / İyileştirmeler
- Kar olmayan veya kar kalınlığı verisi bulunmayan dağlarda kar göstergesi kesinlikle gösterilmez.
- 15 dakikalık RAM + `localStorage` önbellek kuralı kar kalınlığı verisi için de geçerlidir.

### Çıkarılanlar
- Bu sürümde kaldırılan bir özellik yoktur.

---

## [T 1.3] — 2026-11-25
**Dağlar & Zirveler Katmanı ve Gerçek Zirve Sıcaklığı**

### Eklenenler
- 113 küresel zirve ve 34 Türkiye dağı içeren veri seti (`src/data/worldPeaks.json`) eklendi.
- `z5.0+` seviyesinde dağların adı, rakımı ve Open-Meteo `elevation` parametreli gerçek zirve sıcaklığı servisi (`src/services/peakService.ts`) eklendi.
- `z9.5+` seviyesinde OpenStreetMap Overpass API üzerinden ilave zirve keşfi eklendi.
- Şehirlerle aynı 15 dakikalık RAM + `localStorage` önbellek kuralı zirve verileri için uygulandı.
- Harita üzerinde altın üçgenli zirve rozetleri (`MapCanvas.tsx`), detay kartında zirve rakımı etiketi (`WeatherDetailCard.tsx`) ve katman panelinde `Dağlar & Zirveler` anahtarı (`LayerPanel.tsx`) eklendi.

### Yapılanlar / İyileştirmeler
- Gerçek zirve sıcaklığı alınamayan durumlarda uydurma veya tahmini sıcaklık gösterilmez; yalnızca dağ adı ve rakımı gösterilir.
- Etiket arka plan şeffaflığı (`%0–%100`) dağ etiketlerinde de geçerli hale getirildi.

### Çıkarılanlar
- Bu sürümde kaldırılan bir özellik yoktur.

---

## [T 1.2] — 2026-11-25
**Canlı Küresel Jeostasyoner Uydu IR Bulut Katmanı**

### Eklenenler
- SSEC RealEarth küresel jeostasyoner uydu IR bulut katmanı eklendi (`z8` seviyesine kadar yüksek çözünürlük).
- Açık gökyüzünü tamamen şeffaflaştırıp yalnızca doğal beyaz bulutları çizen özel `cloud-ir://` MapLibre protokolü (`src/services/cloudProtocol.ts`) eklendi.

### Yapılanlar / İyileştirmeler
- Bulut katmanı varsayılan şeffaflığı `%80` yapıldı (`src/App.tsx`, `src/config/layers.ts`).
- Katman panelindeki etiket `Canlı Bulut Örtüsü (Uydu IR)` ve alt açıklama `SSEC RealEarth küresel jeostasyoner bulutlar` olarak güncellendi (`src/components/LayerPanel.tsx`, `src/components/MapCanvas.tsx`).

### Çıkarılanlar
- Düşük çözünürlüklü ve bloklu görünüme sahip NASA GIBS `MODIS_Terra_Cloud_Fraction_Day` bulut katmanı kaldırıldı.

---

## [T 1.1] — 2026-11-25
**Şehir Etiketlerinde Yalnızca Arka Plan Şeffaflığı**

### Eklenenler
- Etiket arka plan şeffaflığı `%0` değerine kadar indirilebilir hale getirildi.
- Tam şeffaf arka planda okunabilirlik için şehir adı, sıcaklık ve ikona yumuşak kontrast gölgesi eklendi.

### Yapılanlar / İyileştirmeler
- Şehir hava durumu etiket şeffaflığı artık yalnızca koyu arka plan katmanını (zemin, kenarlık ve bulanıklık) etkiler; şehir adı, sıcaklık ve canlı hava durumu ikonu her zaman `%100` net kalır.

### Çıkarılanlar
- Etiketin tüm içeriğini soluklaştıran genel `opacity` kuralı kaldırıldı.

---

## [T 1.0] — 2026-11-25
**İlk Tam Sürüm — Fiziksel Dünya Haritası, Canlı Hava Durumu ve Atmosfer Katmanları**

### Eklenenler
- MapLibre GL JS tabanlı tam ekran etkileşimli dünya fiziksel ve topoğrafik haritası (5 ücretsiz altlık: OpenTopoMap, Esri Physical, Esri Topo, OSM Standart, Esri Imagery).
- 3D Arazi (AWS Terrarium DEM + 1.0x–3.0x yükseklik abartısı), Gölgeli Kabartma (Hillshade) ve Küre Görünümü (Globe) projeksiyonu.
- Nominatim yer arama, öne çıkan yer şekilleri hızlı odak çubuğu, tıklayınca ters coğrafi kodlama ve Open-Meteo rakım ölçümü.
- 4.964 küresel şehir ve 83 Türkiye yerleşimi içeren bölgeye duyarlı canlı hava durumu sistemi, `z10+` yakınlaştırmada yerel ilçe keşfi ve 15 dakikalık kalıcı önbellek (RAM + `localStorage`).
- Harita üzerinde tam şehir koordinatına sabitlenen şeffaflığı ayarlanabilir (%15–%100) canlı animasyonlu SVG hava durumu rozetleri ve detaylı hava durumu kartı.
- RainViewer canlı yağmur radarı (%20–%100 şeffaflık + 2 saatlik Oynat/Duraklat animasyon çubuğu) ve NASA GIBS (MODIS Terra) küresel bulut örtüsü katmanı.
- macOS için tek tıkla başlatma betiği (`Topog.command`).

### Yapılanlar / İyileştirmeler
- Harita katmanı geçişleri stil sıfırlamadan görünürlük değişimiyle kesintisiz hale getirildi.
- Şehir hava durumu rozetleri dış kapsayıcıya alınarak tam koordinat hizalaması ve işaret noktası eklendi.
- Sürüm takibi ve uygulama içi Sürüm Notları raporu (`T 1.0`) sisteme dahil edildi.

### Çıkarılanlar
- Statik emoji hava durumu ikonları kaldırılarak yerine canlı animasyonlu SVG ikonlar getirildi.
