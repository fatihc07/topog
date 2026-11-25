import { useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Cloud,
  CloudRain,
  CloudSun,
  Globe,
  Layers,
  Mountain,
  Sun,
  Sunset,
  Trash2,
  Video,
} from 'lucide-react';
import { BASE_LAYERS } from '../config/layers';
import type { BaseLayerId } from '../types/map';

interface LayerPanelProps {
  activeLayer: BaseLayerId;
  terrain3D: boolean;
  exaggeration: number;
  hillshade: boolean;
  globeMode: boolean;
  solarEnabled: boolean;
  flyoverActive: boolean;
  weatherEnabled: boolean;
  weatherBadgeOpacity: number;
  weatherCacheCount: number;
  peaksEnabled: boolean;
  rainEnabled: boolean;
  rainOpacity: number;
  rainLoading: boolean;
  cloudsEnabled: boolean;
  cloudsOpacity: number;
  onSelectLayer: (id: BaseLayerId) => void;
  onToggleTerrain3D: () => void;
  onChangeExaggeration: (value: number) => void;
  onToggleHillshade: () => void;
  onToggleGlobeMode: () => void;
  onToggleSolar: () => void;
  onToggleFlyover: () => void;
  onToggleWeather: () => void;
  onChangeWeatherBadgeOpacity: (value: number) => void;
  onClearWeatherCache: () => void;
  onTogglePeaks: () => void;
  onToggleRain: () => void;
  onChangeRainOpacity: (value: number) => void;
  onToggleClouds: () => void;
  onChangeCloudsOpacity: (value: number) => void;
}

export function LayerPanel({
  activeLayer,
  terrain3D,
  exaggeration,
  hillshade,
  globeMode,
  solarEnabled,
  flyoverActive,
  weatherEnabled,
  weatherBadgeOpacity,
  weatherCacheCount,
  peaksEnabled,
  rainEnabled,
  rainOpacity,
  rainLoading,
  cloudsEnabled,
  cloudsOpacity,
  onSelectLayer,
  onToggleTerrain3D,
  onChangeExaggeration,
  onToggleHillshade,
  onToggleGlobeMode,
  onToggleSolar,
  onToggleFlyover,
  onToggleWeather,
  onChangeWeatherBadgeOpacity,
  onClearWeatherCache,
  onTogglePeaks,
  onToggleRain,
  onChangeRainOpacity,
  onToggleClouds,
  onChangeCloudsOpacity,
}: LayerPanelProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="layer-panel-dock">
      <button
        type="button"
        className="layer-toggle-btn"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <Layers size={16} color="#38bdf8" />
        <span>Harita Katmanları & Arazi</span>
        {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
      </button>

      {expanded && (
        <div className="glass-panel layer-panel-body">
          <div>
            <div className="panel-section-title">Altlık Harita Katmanı</div>
            <div className="layer-list">
              {BASE_LAYERS.map((layer) => {
                const isActive = layer.id === activeLayer;
                return (
                  <button
                    key={layer.id}
                    type="button"
                    className={`layer-card ${isActive ? 'active' : ''}`}
                    onClick={() => onSelectLayer(layer.id)}
                  >
                    <span
                      className="layer-swatch"
                      style={{ background: layer.previewGradient }}
                    />
                    <div className="layer-info">
                      <div className="layer-name">
                        <span>{layer.name}</span>
                        {isActive && <Check size={14} color="#38bdf8" />}
                      </div>
                      <div className="layer-desc">{layer.description}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="panel-divider" />

          <div>
            <div className="panel-section-title">Kabartma & Projeksiyon</div>

            <div className="toggle-row">
              <div className="toggle-label-group">
                <Mountain size={16} color="#38bdf8" />
                <div>
                  <div className="toggle-label-title">3D Arazi (DEM)</div>
                  <div className="toggle-label-sub">SRTM / Terrarium yükseklik modeli</div>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={terrain3D}
                className={`switch-btn ${terrain3D ? 'on' : ''}`}
                onClick={onToggleTerrain3D}
              >
                <span className="switch-thumb" />
              </button>
            </div>

            {terrain3D && (
              <div className="slider-group">
                <div className="slider-header">
                  <span>Yükseklik Abartısı</span>
                  <strong>{exaggeration.toFixed(1)}x</strong>
                </div>
                <input
                  type="range"
                  min={1.0}
                  max={3.0}
                  step={0.1}
                  value={exaggeration}
                  onChange={(e) => onChangeExaggeration(parseFloat(e.target.value))}
                  className="range-input"
                  aria-label="Yükseklik Abartısı"
                />
              </div>
            )}

            <div className="toggle-row">
              <div className="toggle-label-group">
                <Sun size={16} color="#fbbf24" />
                <div>
                  <div className="toggle-label-title">Gölgeli Kabartma (Hillshade)</div>
                  <div className="toggle-label-sub">Dinamik güneş açısı rölyefi</div>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={hillshade}
                className={`switch-btn ${hillshade ? 'on' : ''}`}
                onClick={onToggleHillshade}
              >
                <span className="switch-thumb" />
              </button>
            </div>

            <div className="toggle-row">
              <div className="toggle-label-group">
                <Globe size={16} color="#34d399" />
                <div>
                  <div className="toggle-label-title">Küre Görünümü (Globe)</div>
                  <div className="toggle-label-sub">3B küresel yeryüzü projeksiyonu</div>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={globeMode}
                className={`switch-btn ${globeMode ? 'on' : ''}`}
                onClick={onToggleGlobeMode}
              >
                <span className="switch-thumb" />
              </button>
            </div>

            <div className="toggle-row">
              <div className="toggle-label-group">
                <Sunset size={16} color="#fbbf24" />
                <div>
                  <div className="toggle-label-title">Güneş &amp; Gece Sınırı</div>
                  <div className="toggle-label-sub">Terminator ve dinamik dağ gölgesi</div>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={solarEnabled}
                className={`switch-btn ${solarEnabled ? 'on' : ''}`}
                onClick={onToggleSolar}
              >
                <span className="switch-thumb" />
              </button>
            </div>

            <div className="toggle-row">
              <div className="toggle-label-group">
                <Video size={16} color="#38bdf8" />
                <div>
                  <div className="toggle-label-title">3B Drone Uçuşu</div>
                  <div className="toggle-label-sub">Zirveler üzerinde sinematik yörünge</div>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={flyoverActive}
                className={`switch-btn ${flyoverActive ? 'on' : ''}`}
                onClick={onToggleFlyover}
              >
                <span className="switch-thumb" />
              </button>
            </div>
          </div>

          <div className="panel-divider" />

          <div>
            <div className="panel-section-title">Atmosfer & Hava Katmanları</div>

            <div className="toggle-row">
              <div className="toggle-label-group">
                <CloudRain size={16} color="#38bdf8" />
                <div>
                  <div className="toggle-label-title">Yağmur Radarı (RainViewer)</div>
                  <div className="toggle-label-sub">
                    {rainLoading
                      ? 'Radar kareleri çekiliyor...'
                      : 'Canlı yağış ve 2 saatlik animasyon'}
                  </div>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={rainEnabled}
                className={`switch-btn ${rainEnabled ? 'on' : ''}`}
                onClick={onToggleRain}
              >
                <span className="switch-thumb" />
              </button>
            </div>

            {rainEnabled && (
              <div className="slider-group">
                <div className="slider-header">
                  <span>Radar Şeffaflığı</span>
                  <strong>%{Math.round(rainOpacity * 100)}</strong>
                </div>
                <input
                  type="range"
                  min={0.2}
                  max={1.0}
                  step={0.05}
                  value={rainOpacity}
                  onChange={(e) => onChangeRainOpacity(parseFloat(e.target.value))}
                  className="range-input"
                  aria-label="Yağmur Radarı Şeffaflığı"
                />
              </div>
            )}

            <div className="toggle-row">
              <div className="toggle-label-group">
                <Cloud size={16} color="#e2e8f0" />
                <div>
                  <div className="toggle-label-title">Canlı Bulut Örtüsü (Uydu IR)</div>
                  <div className="toggle-label-sub">SSEC RealEarth küresel jeostasyoner bulutlar</div>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={cloudsEnabled}
                className={`switch-btn ${cloudsEnabled ? 'on' : ''}`}
                onClick={onToggleClouds}
              >
                <span className="switch-thumb" />
              </button>
            </div>

            {cloudsEnabled && (
              <div className="slider-group">
                <div className="slider-header">
                  <span>Bulut Şeffaflığı</span>
                  <strong>%{Math.round(cloudsOpacity * 100)}</strong>
                </div>
                <input
                  type="range"
                  min={0.2}
                  max={1.0}
                  step={0.05}
                  value={cloudsOpacity}
                  onChange={(e) => onChangeCloudsOpacity(parseFloat(e.target.value))}
                  className="range-input"
                  aria-label="Bulut Örtüsü Şeffaflığı"
                />
              </div>
            )}

            <div className="toggle-row">
              <div className="toggle-label-group">
                <CloudSun size={16} color="#38bdf8" />
                <div>
                  <div className="toggle-label-title">Şehir Hava Durumu</div>
                  <div className="toggle-label-sub">
                    {weatherCacheCount} şehir bellekte · 15 dk TTL
                  </div>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={weatherEnabled}
                className={`switch-btn ${weatherEnabled ? 'on' : ''}`}
                onClick={onToggleWeather}
              >
                <span className="switch-thumb" />
              </button>
            </div>

            {weatherEnabled && (
              <div className="slider-group">
                <div className="slider-header">
                  <span>Etiket Arka Plan Şeffaflığı</span>
                  <strong>%{Math.round(weatherBadgeOpacity * 100)}</strong>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1.0}
                  step={0.05}
                  value={weatherBadgeOpacity}
                  onChange={(e) =>
                    onChangeWeatherBadgeOpacity(parseFloat(e.target.value))
                  }
                  className="range-input"
                  aria-label="Etiket Arka Plan Şeffaflığı"
                />
              </div>
            )}

            {weatherCacheCount > 0 && (
              <button
                type="button"
                className="btn-subtle"
                onClick={onClearWeatherCache}
              >
                <Trash2 size={13} />
                <span>Önbelleği Temizle ({weatherCacheCount})</span>
              </button>
            )}

            <div className="toggle-row" style={{ marginTop: 4 }}>
              <div className="toggle-label-group">
                <Mountain size={16} color="#fbbf24" />
                <div>
                  <div className="toggle-label-title">Dağlar &amp; Zirveler</div>
                  <div className="toggle-label-sub">
                    Dağ adı, rakım ve gerçek zirve sıcaklığı · 15 dk TTL
                  </div>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={peaksEnabled}
                className={`switch-btn ${peaksEnabled ? 'on' : ''}`}
                onClick={onTogglePeaks}
              >
                <span className="switch-thumb" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
