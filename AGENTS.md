# Topog — Proje Kuralları ve Uzman Alt Ajan Rehberi

**Topog**, MapLibre GL JS + React 19 + TypeScript + Vite tabanlı, ücretsiz ve API anahtarı gerektirmeyen kaynaklarla çalışan etkileşimli dünya fiziksel harita ve canlı atmosfer atlasıdır.

## Uzman Alt Ajanlar (`.agents/agents/`)

Aşağıdaki 4 uzman alt ajan gerektiğinde (veya `/swarm` akışı içinde) ilgili görevler için çağrılmalıdır:

| Ajan | Dosya | Ne Zaman Kullanılır? |
| :--- | :--- | :--- |
| **`qa-verifier`** | [`.agents/agents/qa-verifier.md`](./.agents/agents/qa-verifier.md) | Her yeni özellik/düzeltme sonrası **yayın (`releaser`) öncesi** tip, build, 15 dk önbellek ve MapLibre hata denetimi için. |
| **`ui-visual-auditor`** | [`.agents/agents/ui-visual-auditor.md`](./.agents/agents/ui-visual-auditor.md) | Yeni UI bileşeni, katman, kart veya CSS değişikliği sonrası masaüstü/mobil düzen ve tarayıcı konsolu denetimi için. |
| **`gis-perf`** | [`.agents/agents/gis-perf.md`](./.agents/agents/gis-perf.md) | Bundle boyutu büyüdüğünde, yeni karo/GeoJSON/Canvas katmanı eklendiğinde veya harita FPS optimizasyonu gerektiğinde. |
| **`refactor-architect`** | [`.agents/agents/refactor-architect.md`](./.agents/agents/refactor-architect.md) | `src/App.tsx`, `src/components/MapCanvas.tsx` veya `src/index.css` büyüyüp karmaşıklaştığında hook ve modül ayrıştırması için. |

## Değişmez Proje Kuralları

1. **Sıfır Uydurma Veri:** Hava durumu, dağ sıcaklığı, kar kalınlığı veya deniz suyu/dalga verisi gerçek API'den gelmediyse asla tahmini değer üretme; alanı gizle veya `null` döndür.
2. **15 Dakikalık Önbellek (TTL):** Tüm şehir, dağ ve deniz sorguları RAM + `localStorage` üzerinde 15 dakika süreyle saklanır; süre dolmadan tekrar ağ isteği atılmaz, dolunca yenilenir.
3. **MapLibre Güvenliği:** Altlık değiştirirken `map.setStyle()` çağırma (katman `visibility` kullan); `terrain-dem` ve `hillshade-dem` için ayrı kaynaklar kullan; marker kök elemanının sınıfını veya `transform` özelliğini ezme.
4. **Sürümleme ve GitHub Yayın Akışı (`T <Büyük>.<Küçük>`):**
   - Her güncellemede sürümü artır (`src/config/version.ts`, `CHANGELOG.md`, `README.md`, `package.json`).
   - `npm run build` doğrulamasından sonra GitHub (`https://github.com/fatihc07/topog`) reposuna commit, etiket (`T-x.y`) ve Release notu yayınla (aktif swarm'da `releaser` ajanı üzerinden).
