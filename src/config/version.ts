export interface ReleaseEntry {
  version: string;
  date: string;
  title: string;
  added: string[];
  changed: string[];
  removed: string[];
}

export const APP_VERSION = 'T 4.3';

export const RELEASE_NOTES: ReleaseEntry[] = [
  {
    version: 'T 4.3',
    date: '2026-11-25',
    title: 'Arayüz Sadeleştirmesi — Hava Simülatörü Modu Kaldırıldı',
    added: [],
    changed: [
      'Uygulama yalnızca gerçek zamanlı Canlı Atlas, Ülke Modu ve Hissedilen Sıcaklık (H XX°) özellikleriyle sadeleştirildi.',
    ],
    removed: [
      'Hava Simülatörü modu tamamen kaldırıldı: src/components/ModeTabs.tsx, SimulatorDock.tsx, SimulatorCanvasOverlay.tsx, SimHistoryChart.tsx, src/services/simulatorEngine.ts, simulatorScenarios.ts ve src/types/simulator.ts dosyaları silindi.',
      'src/App.tsx, MapCanvas.tsx, WeatherDetailCard.tsx, TelemetryBar.tsx, src/config/layers.ts ve src/index.css içindeki tüm simülatör durumları, döngüleri, MapLibre GeoJSON katmanları ve stilleri temizlendi.',
    ],
  },
  {
    version: 'T 4.2',
    date: '2026-11-25',
    title: 'Canlı Şehir Rozetlerinde Hissedilen Sıcaklık (H XX°)',
    added: [
      'Canlı Atlas modundaki küçük şehir hava durumu rozetlerine gerçek apparentTemperature verisi mevcutken kompakt "H XX°" hissedilen sıcaklık göstergesi (.weather-badge-feels) ve ipucu (tooltip) metni eklendi (src/components/MapCanvas.tsx, src/index.css).',
    ],
    changed: [
      'Hissedilen sıcaklık göstergesi yalnızca gerçek API/önbellek verisi bulunan Canlı Atlas modunda görüntülenir; Simülatör modu izole bırakıldı.',
    ],
    removed: [],
  },
  {
    version: 'T 4.1',
    date: '2026-11-25',
    title: 'Ülke Modu — Etkileşimli Ülke Sınırları, Parlak Vurgu ve Bayraklı Türkçe Ülke Kartı',
    added: [
      'Katman panelinin ("Harita Katmanları & Arazi") son sırasına Ülke Modu anahtarı eklendi (src/components/LayerPanel.tsx, src/App.tsx).',
      'Natural Earth ne_50m_admin_0_countries tabanlı optimize edilmiş yerel sınır verisi (public/data/countries.geojson: 242 ülke/bölge, sayısal feature.id, Türkçe ülke adları, kıta bilgisi ve ISO kodu) ve tembel/önbellekli yükleme servisi (src/services/countryService.ts) eklendi.',
      'Harita üzerinde fareyle bir ülkenin üzerine gelindiğinde MapLibre feature-state ile sınırların parlak cam mavisi çizilmesi (countries-fill, countries-outline-glow, countries-outline) ve imleç yanında bayraklı Türkçe ülke adı/kıta kartı gösterilmesi eklendi (src/config/layers.ts, src/components/MapCanvas.tsx, src/index.css).',
    ],
    changed: [
      'qa-verifier denetimi sonrası countryLoading hızlı aç-kapa yarışı, countriesLoadedRef cleanup ve tooltip sağ kenar kırpma payı iyileştirildi.',
    ],
    removed: [],
  },
  {
    version: 'T 4.0',
    date: '2026-11-25',
    title: 'Simülatör Modu 2.0 — 60 FPS Canvas Atmosfer, DEK, Fön Etkisi, Siklon & Yüksek Basınç ve İzoterm Haritası',
    added: [
      '60 FPS Canvas atmosfer motoru eklendi (src/components/SimulatorCanvasOverlay.tsx): organik çok duraklı radyal hava kütleleri, sürüklenen bulut lobları, sıcaklığa duyarlı yağmur/kar parçacıkları ve cephe/siklon şimşekleri.',
      'Canlı sıcaklık ısı haritası ve Marching Squares 0°C donma sınırı izoterm konturu eklendi.',
      'Dönen Siklon (L) ve Yüksek Basınç (H) sistem araçları (is-high-pressure UI vurgusu dahil) eklendi (src/components/SimulatorDock.tsx, src/services/simulatorEngine.ts).',
      'Deniz Etkili Kar (DEK / Lake-Effect Snow): Deniz üzerinden nem toplayan soğuk hava dalgalarının karaya çıktığında kar patlaması oluşturması eklendi.',
      'Dağ Yağmur Gölgesi ve Fön Etkisi: >= 2000m zirvelerde rüzgar yönüne göre rüzgar üstü yoğuşma ve rüzgar altı ısınma/kuruma simülasyonu eklendi.',
      '1-tıkla hazır atmosfer senaryoları eklendi (src/services/simulatorScenarios.ts: Sibirya DEK Karı, Sahra Sıcağı, Akdeniz Siklonu, Balkan Cephesi).',
      'Seçili şehir ve dağ kartında canlı sıcaklık ve kar kalınlığı (cm) zaman serisi grafiği eklendi (src/components/SimHistoryChart.tsx, src/components/WeatherDetailCard.tsx).',
    ],
    changed: [
      'qa-verifier denetimi sonrası .is-high-pressure CSS seçicisi ve SimulatorCanvasOverlay Globe NaN renk koruması düzeltildi.',
    ],
    removed: [],
  },
  {
    version: 'T 3.1',
    date: '2026-11-25',
    title: 'Simülatörde Soğuk/Sıcak + Nemli Kombinasyonu ve 0°C Kar/Yağmur Ayrımı',
    added: [
      'Simülatör araç çubuğunda Soğuk Dalga / Sıcak Dalga ile + Nemli Kütle anahtarının aynı anda aktif edilebilmesi eklendi (src/components/SimulatorDock.tsx, src/types/simulator.ts, src/App.tsx): Soğuk + Nemli, Sıcak + Nemli, Kuru Soğuk, Kuru Sıcak veya Sadece Nemli tek tıkla gönderilebilir.',
      'Sıcaklığa duyarlı <= 0°C Kar / > 0°C Yağmur ayrımı eklendi (src/services/simulatorEngine.ts, src/components/MapCanvas.tsx): Soğuk+nemli kütlenin 0°C altına düşürdüğü yerlerde ve yüksek dağ zirvelerinde kar bölgesi çizilip kar yağışı (WMO 71/73) tetiklenir ve dağlardaki kar kalınlığı (cm) artar; 0°C üstünde ise yağmur (WMO 61/63) oluşur.',
    ],
    changed: [
      'Kuru soğuk/sıcak dalgaların başlangıç nemi gerçekçi şekilde düşürülerek yalnızca + Nemli Kütle seçiliyken veya denizden nem toplandığında yoğun yağış üretmesi sağlandı; dağ zirvesi kar birikimi hızlandırıldı.',
    ],
    removed: [],
  },
  {
    version: 'T 3.0',
    date: '2026-11-25',
    title: 'Etkileşimli Hava Simülatörü (Dalgalar, Cephe Fırtınaları, Oroğrafik Yağış & Kar Birikimi)',
    added: [
      'Canlı moddan tamamen izole Hava Simülatörü sekmesi eklendi (src/components/ModeTabs.tsx: Canlı Atlas | Hava Simülatörü).',
      'Tıklayarak dairesel hava dalgaları başlatan fizik motoru eklendi (src/types/simulator.ts, src/services/simulatorEngine.ts): Soğuk Dalga (❄️), Sıcak Dalga (🔥) ve Nemli Kütle (🌧️), rüzgar yönü sürüklenmesi, deniz üzerinden geçerken nem toplama, yüksek dağ sıralarında orografik yağış/kar yoğunlaşması ve soğuk+sıcak dalga çarpışmalarında cephe fırtınası oluşumu.',
      'Simülatör araç çubuğu (src/components/SimulatorDock.tsx: oynat/duraklat, 0.5x/1x/2x hız, şiddet, mevsim, 8 yönlü rüzgar + durgun, temizle) ve harita üzerinde canlı GeoJSON dalga/bulut/yağış/fırtına katmanları (src/config/layers.ts, src/components/MapCanvas.tsx) eklendi.',
      'Simülatör sekmesinde şehir sıcaklıkları, animasyonlu hava ikonları, dağ zirve sıcaklıkları ve dinamik kar birikimi/erimesi (cm) anlık güncellenir; Canlı Atlas verisi ve 15 dk önbellekleri kesinlikle etkilenmez.',
    ],
    changed: [
      'qa-verifier denetiminde tespit edilen radar katman sızıntısı, simülatör modunda canlı ağ çağrısı/zamanlayıcı iptali ve simülatör etiket tooltip ayrımı (MapCanvas.tsx, App.tsx) giderildi.',
      'Telemetri çubuğu ve detay kartı simülatör verisini canlı veriden ayırt edecek şekilde güncellendi (TelemetryBar.tsx, WeatherDetailCard.tsx).',
    ],
    removed: [],
  },
  {
    version: 'T 2.2',
    date: '2026-11-25',
    title: 'Proje Kuralları ve Uzman Alt Ajan Sistemi',
    added: [
      'Proje içi 4 uzman alt ajan tanım dosyası eklendi (.agents/agents/qa-verifier.md, ui-visual-auditor.md, gis-perf.md, refactor-architect.md).',
      'Proje kuralları ve alt ajan kullanım rehberi (AGENTS.md) eklendi.',
    ],
    changed: [
      'Yayın öncesi kalite kapısı (qa-verifier), görsel UX denetimi (ui-visual-auditor), WebGL/bundle performansı (gis-perf) ve modüler refaktör (refactor-architect) standartlaştırıldı.',
    ],
    removed: [],
  },
  {
    version: 'T 2.1',
    date: '2026-11-25',
    title: 'Arayüz Sadeleştirmesi — Drone Uçuş Modu Kaldırıldı',
    added: [],
    changed: [
      'Arayüz ve harita kontrolleri sadeleştirildi; Güneş & Gece Sınırı ve Yağmur Radarı zaman çizelgeleri alt alanda çakışmasız şekilde korundu.',
    ],
    removed: [
      'Sinematik 3D Drone Uçuş Modu (src/components/FlyoverBar.tsx ve src/services/flyoverPresets.ts) tamamen kaldırıldı.',
      'Katman panelindeki 3B Drone Uçuşu anahtarı, inceleme ve hava durumu kartlarındaki Drone Uçuşu / 3D Uçuş butonları, MapCanvas yörünge animasyon döngüsü ve ilgili CSS kuralları temizlendi.',
    ],
  },
  {
    version: 'T 2.0',
    date: '2026-11-25',
    title: 'Gece/Gündüz Sınırı & 3D Güneş Gölgesi, Canlı Deniz & Dalga Verisi, Sinematik 3D Drone Uçuşu',
    added: [
      'Gece/Gündüz Sınırı (Terminator) & 3D Güneş Gölgesi Simülatörü (src/services/solarService.ts, src/components/SolarTimeline.tsx, MapCanvas.tsx): Anlık gece-gündüz sınırı, 24 saatlik oynatılabilir zaman çizelgesi, Altın Saat/Gündüz/Gece fazı ve güneş azimutuna göre dinamik dağ gölge yönü (hillshade-illumination-direction).',
      'Canlı Deniz Suyu Sıcaklığı & Dalga Yüksekliği (src/services/marineService.ts, src/components/MarineSection.tsx, InspectCard.tsx): Deniz ve kıyı noktalarına tıklandığında Open-Meteo Marine API üzerinden gerçek deniz suyu sıcaklığı (°C), dalga yüksekliği (m), dalga periyodu (sn) ve dalga yönü (15 dakikalık RAM + localStorage önbellekle; kara noktalarında uydurma veri üretilmez).',
      'Sinematik 3D Drone Uçuş Modu (src/services/flyoverPresets.ts, src/components/FlyoverBar.tsx, MapCanvas.tsx): 6 ikonik manzara durağı ve haritadaki herhangi bir şehir, dağ veya noktadan başlatılabilen 3D arazi üzerinde otomatik yörünge uçuşu (0.5x/1x/2x hız ve 55°/65°/75° kamera açısı).',
    ],
    changed: [
      'Katman paneline "Güneş & Gece Sınırı" ile "3B Drone Uçuşu" anahtarları eklendi (LayerPanel.tsx).',
      'Nokta inceleme ve hava durumu detay kartlarına hızlı "Drone Uçuşu" başlatma düğmeleri eklendi (InspectCard.tsx, WeatherDetailCard.tsx).',
      'Çoklu alt kontrol çubukları (Yağmur Radarı, Güneş Zaman Çizelgesi, Drone Uçuşu) .bottom-bars-stack kapsayıcısı ile çakışmasız hizalandı (App.tsx, index.css).',
    ],
    removed: [],
  },
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
