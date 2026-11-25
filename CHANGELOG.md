# Topog Sürüm Notları ve Değişiklik Raporu

Sürüm numaralandırma kuralı: **`T <Büyük>.<Küçük>`**
- Küçük güncellemelerde ikinci sayı artar (`T 1.1`, `T 1.2`, ...).
- Büyük güncellemelerde birinci sayı artar (`T 2.0`, `T 3.0`, ...).
- Her sürümde **Eklenenler**, **Yapılanlar / İyileştirmeler** ve **Çıkarılanlar** başlıkları altında rapor tutulur ve `src/config/version.ts` ile senkronize edilir.

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
