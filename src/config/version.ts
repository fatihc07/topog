export interface ReleaseEntry {
  version: string;
  date: string;
  title: string;
  added: string[];
  changed: string[];
  removed: string[];
}

export const APP_VERSION = 'T 1.4';

export const RELEASE_NOTES: ReleaseEntry[] = [
  {
    version: 'T 1.4',
    date: '2026-11-25',
    title: 'Dağ ve Zirvelerde Gerçek Anlık Kar Kalınlığı',
    added: [
      'Dağ/zirve Open-Meteo sorgusuna gerçek anlık kar kalınlığı (snow_depth) ve taze kar yağışı (snowfall) verileri eklendi (src/services/peakService.ts, src/types/weather.ts).',
      'Zirvede gerçek kar kalınlığı (>= 1 cm) varsa harita etiketlerinde ❄ XX cm göstergesi (MapCanvas.tsx) ve detay kartında Kar Kalınlığı kutusu (WeatherDetailCard.tsx, index.css) görüntülenir.',
    ],
    changed: [
      'Kar olmayan veya kar kalınlığı verisi bulunmayan dağlarda kar göstergesi kesinlikle gösterilmez.',
      '15 dakikalık RAM + localStorage önbellek kuralı kar kalınlığı verisi için de geçerli hale getirildi.',
    ],
    removed: [],
  },
  {
    version: 'T 1.3',
    date: '2026-11-25',
    title: 'Dağlar & Zirveler Katmanı ve Gerçek Zirve Sıcaklığı',
    added: [
      '113 küresel zirve ve 34 Türkiye dağı içeren veri seti (src/data/worldPeaks.json) eklendi.',
      'z5.0+ seviyesinde dağların adı, rakımı ve Open-Meteo elevation parametreli gerçek zirve sıcaklığı servisi (src/services/peakService.ts) eklendi.',
      'z9.5+ yakınlaştırmada OpenStreetMap Overpass API üzerinden ilave zirve keşfi eklendi.',
      'Şehirlerle aynı 15 dakikalık RAM + localStorage önbellek kuralı zirve hava durumu için de uygulandı.',
      'Harita üzerinde altın üçgenli zirve rozetleri, detay kartında zirve rakımı etiketi ve katman panelinde "Dağlar & Zirveler" anahtarı eklendi.',
    ],
    changed: [
      'Gerçek zirve sıcaklığı alınamayan durumlarda uydurma veya tahmini sıcaklık gösterilmez; yalnızca dağ adı ve rakımı gösterilir.',
      'Etiket arka plan şeffaflığı (%0–%100) dağ ve zirve rozetlerinde de geçerli hale getirildi.',
    ],
    removed: [],
  },
  {
    version: 'T 1.2',
    date: '2026-11-25',
    title: 'Canlı Küresel Jeostasyoner Uydu IR Bulut Katmanı',
    added: [
      'SSEC RealEarth küresel jeostasyoner uydu IR bulut katmanı eklendi (z8 seviyesine kadar yüksek çözünürlük).',
      'Açık gökyüzünü tamamen şeffaflaştırıp yalnızca doğal beyaz bulutları çizen özel cloud-ir:// MapLibre protokolü (src/services/cloudProtocol.ts) eklendi.',
    ],
    changed: [
      'Bulut katmanı varsayılan şeffaflığı %80 olarak ayarlandı.',
      'Katman panelindeki başlık ve alt etiket "Canlı Bulut Örtüsü (Uydu IR)" / "SSEC RealEarth küresel jeostasyoner bulutlar" olarak güncellendi.',
    ],
    removed: [
      'Düşük çözünürlüklü ve bloklu görünüme sahip NASA GIBS MODIS_Terra_Cloud_Fraction_Day bulut katmanı kaldırıldı.',
    ],
  },
  {
    version: 'T 1.1',
    date: '2026-11-25',
    title: 'Şehir Etiketlerinde Yalnızca Arka Plan Şeffaflığı',
    added: [
      'Etiket arka plan şeffaflığı %0 değerine kadar indirilebilir hale getirildi.',
      'Tam şeffaf arka planda okunabilirlik için şehir adı, sıcaklık ve ikona yumuşak kontrast gölgesi eklendi.',
    ],
    changed: [
      'Şehir hava durumu etiket şeffaflığı artık yalnızca koyu arka plan katmanını (zemin, kenarlık ve bulanıklık) etkiler; şehir adı, sıcaklık ve canlı hava durumu ikonu her zaman %100 net kalır.',
    ],
    removed: [
      'Etiketin tüm içeriğini soluklaştıran genel opacity kuralı kaldırıldı.',
    ],
  },
  {
    version: 'T 1.0',
    date: '2026-11-25',
    title: 'İlk Tam Sürüm — Fiziksel Dünya Haritası, Canlı Hava Durumu ve Atmosfer Katmanları',
    added: [
      'MapLibre GL JS tabanlı tam ekran etkileşimli dünya fiziksel ve topoğrafik haritası (5 ücretsiz altlık: OpenTopoMap, Esri Physical, Esri Topo, OSM Standart, Esri Imagery).',
      '3D Arazi (AWS Terrarium DEM + 1.0x–3.0x yükseklik abartısı), Gölgeli Kabartma (Hillshade) ve Küre Görünümü (Globe) projeksiyonu.',
      'Nominatim yer arama, öne çıkan yer şekilleri hızlı odak çubuğu, tıklayınca ters coğrafi kodlama ve Open-Meteo rakım ölçümü.',
      '4.964 küresel şehir ve 83 Türkiye yerleşimi içeren bölgeye duyarlı canlı hava durumu sistemi, z10+ yakınlaştırmada yerel ilçe keşfi ve 15 dakikalık kalıcı önbellek (RAM + localStorage).',
      'Harita üzerinde tam şehir koordinatına sabitlenen şeffaflığı ayarlanabilir (%15–%100) canlı animasyonlu SVG hava durumu rozetleri ve detaylı hava durumu kartı.',
      'RainViewer canlı yağmur radarı (%20–%100 şeffaflık + 2 saatlik Oynat/Duraklat animasyon çubuğu) ve NASA GIBS (MODIS Terra) küresel bulut örtüsü katmanı.',
      'macOS için tek tıkla başlatma betiği (Topog.command).',
    ],
    changed: [
      'Harita katmanı geçişleri stil sıfırlamadan görünürlük değişimiyle kesintisiz hale getirildi.',
      'Şehir hava durumu rozetleri dış kapsayıcıya alınarak tam koordinat hizalaması ve işaret noktası eklendi.',
      'Sürüm takibi ve uygulama içi Sürüm Notları raporu (T 1.0) sisteme dahil edildi.',
    ],
    removed: [
      'Statik emoji hava durumu ikonları kaldırılarak yerine canlı animasyonlu SVG ikonlar getirildi.',
    ],
  },
];
