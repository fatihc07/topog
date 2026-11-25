import {
  CloudRain,
  Flame,
  Orbit,
  Pause,
  Play,
  Snowflake,
  Sun,
  Thermometer,
  Trash2,
} from 'lucide-react';
import { SIMULATOR_SCENARIOS } from '../services/simulatorScenarios';
import type {
  SimScenario,
  SimSeason,
  SimSystemTool,
} from '../types/simulator';

export interface SimulatorDockProps {
  systemTool: SimSystemTool;
  moistureActive: boolean;
  showHeatmap: boolean;
  intensity: number;
  windDirDeg: number | null;
  playing: boolean;
  speed: number;
  season: SimSeason;
  waveCount: number;
  frontCount: number;
  onToggleSystem: (kind: 'cold' | 'warm' | 'cyclone' | 'high_pressure') => void;
  onToggleMoisture: () => void;
  onToggleHeatmap: () => void;
  onSelectScenario: (scenario: SimScenario) => void;
  onChangeIntensity: (val: number) => void;
  onChangeWindDir: (deg: number | null) => void;
  onTogglePlay: () => void;
  onChangeSpeed: (speed: number) => void;
  onChangeSeason: (season: SimSeason) => void;
  onClearWaves: () => void;
}

const SPEED_OPTIONS = [0.5, 1, 2] as const;

const SEASON_OPTIONS: Array<{ id: SimSeason; label: string }> = [
  { id: 'winter', label: 'Kış' },
  { id: 'spring', label: 'Bahar' },
  { id: 'summer', label: 'Yaz' },
  { id: 'autumn', label: 'Güz' },
];

const WIND_DIR_OPTIONS: Array<{ deg: number | null; label: string }> = [
  { deg: null, label: 'Durgun' },
  { deg: 0, label: 'K' },
  { deg: 45, label: 'KD' },
  { deg: 90, label: 'D' },
  { deg: 135, label: 'GD' },
  { deg: 180, label: 'G' },
  { deg: 225, label: 'GB' },
  { deg: 270, label: 'B' },
  { deg: 315, label: 'KB' },
];

function getActiveComboHint(
  systemTool: SimSystemTool,
  moistureActive: boolean
): string {
  if (systemTool === 'high_pressure') {
    return '☀️ Yüksek Basınç (H) Açık Hava';
  }
  if (systemTool === 'cyclone') {
    return moistureActive
      ? '🌀+🌧️ Güçlü Siklon (L) Fırtına'
      : '🌀 Siklon (L) Fırtına';
  }
  if (systemTool === 'cold' && moistureActive) {
    return '❄️+🌧️ ≤0°C Kar · >0°C Yağmur';
  }
  if (systemTool === 'warm' && moistureActive) {
    return '🔥+🌧️ Sıcak Yağış Kütlesi';
  }
  if (systemTool === 'cold') return '❄️ Kuru Soğuk Dalga';
  if (systemTool === 'warm') return '🔥 Kuru Sıcak Dalga';
  if (moistureActive) return '🌧️ Nemli Yağış Kütlesi';
  return 'Haritaya tıkla veya senaryo seç';
}

export function SimulatorDock({
  systemTool,
  moistureActive,
  showHeatmap,
  intensity,
  windDirDeg,
  playing,
  speed,
  season,
  waveCount,
  frontCount,
  onToggleSystem,
  onToggleMoisture,
  onToggleHeatmap,
  onSelectScenario,
  onChangeIntensity,
  onChangeWindDir,
  onTogglePlay,
  onChangeSpeed,
  onChangeSeason,
  onClearWaves,
}: SimulatorDockProps) {
  const isHighPressure = systemTool === 'high_pressure';
  const effectiveMoisture = moistureActive && !isHighPressure;
  const comboHint = getActiveComboHint(systemTool, moistureActive);

  return (
    <div
      className="glass-panel sim-dock"
      role="region"
      aria-label="Hava Simülatörü Kontrol Paneli"
    >
      <div className="sim-dock-row sim-dock-top">
        <div
          className="sim-tools-group"
          role="group"
          aria-label="Hava sistemi araçları"
        >
          <button
            type="button"
            className={`sim-tool-btn is-cold ${
              systemTool === 'cold' ? 'is-active' : ''
            }`}
            aria-pressed={systemTool === 'cold'}
            onClick={() => onToggleSystem('cold')}
          >
            <Snowflake size={14} aria-hidden="true" />
            <span>Soğuk</span>
          </button>

          <button
            type="button"
            className={`sim-tool-btn is-warm ${
              systemTool === 'warm' ? 'is-active' : ''
            }`}
            aria-pressed={systemTool === 'warm'}
            onClick={() => onToggleSystem('warm')}
          >
            <Flame size={14} aria-hidden="true" />
            <span>Sıcak</span>
          </button>

          <button
            type="button"
            className={`sim-tool-btn is-cyclone ${
              systemTool === 'cyclone' ? 'is-active' : ''
            }`}
            aria-pressed={systemTool === 'cyclone'}
            onClick={() => onToggleSystem('cyclone')}
            title="Alçak basınç siklon fırtına merkezi"
          >
            <Orbit size={14} aria-hidden="true" />
            <span>Siklon (L)</span>
          </button>

          <button
            type="button"
            className={`sim-tool-btn is-high-pressure ${
              systemTool === 'high_pressure' ? 'is-active' : ''
            }`}
            aria-pressed={systemTool === 'high_pressure'}
            onClick={() => onToggleSystem('high_pressure')}
            title="Yüksek basınç açık hava kubbesi (nem ve cepheleri bastırır)"
          >
            <Sun size={14} aria-hidden="true" />
            <span>Y. Basınç (H)</span>
          </button>

          <button
            type="button"
            className={`sim-tool-btn is-moisture ${
              effectiveMoisture ? 'is-active' : ''
            } ${isHighPressure ? 'is-dimmed' : ''}`}
            aria-pressed={effectiveMoisture}
            disabled={isHighPressure}
            onClick={onToggleMoisture}
            title={
              isHighPressure
                ? 'Yüksek basınçta nem otomatik olarak bastırılır'
                : 'Seçili sistemle aynı anda nemli yağış göndermek için açın'
            }
          >
            <CloudRain size={14} aria-hidden="true" />
            <span>+ Nemli</span>
          </button>

          <button
            type="button"
            className={`sim-tool-btn is-heatmap ${
              showHeatmap ? 'is-active' : ''
            }`}
            aria-pressed={showHeatmap}
            onClick={onToggleHeatmap}
            title="Sıcaklık ısı haritası ve 0°C donma sınırı katmanını aç/kapat"
          >
            <Thermometer size={14} aria-hidden="true" />
            <span>0°C / Isı</span>
          </button>
        </div>

        <span className="sim-hint-pill">{comboHint}</span>

        <div className="sim-status-group" aria-live="polite">
          <span className="sim-status-badge">{waveCount} dalga</span>
          <span className="sim-status-badge is-front">{frontCount} cephe</span>
        </div>
      </div>

      <div className="sim-dock-row sim-scenarios-row">
        <span className="sim-control-label sim-scenarios-label">
          Senaryolar:
        </span>
        <div
          className="sim-scenarios-list"
          role="group"
          aria-label="Hazır hava senaryoları"
        >
          {SIMULATOR_SCENARIOS.map((scenario: SimScenario) => (
            <button
              key={scenario.id}
              type="button"
              className="sim-scenario-pill"
              title={scenario.description}
              onClick={() => onSelectScenario(scenario)}
            >
              {scenario.badge} {scenario.name}
            </button>
          ))}
        </div>
      </div>

      <div className="sim-dock-row sim-dock-bottom">
        <button
          type="button"
          className="sim-play-btn"
          onClick={onTogglePlay}
          title={playing ? 'Duraklat' : 'Oynat'}
          aria-label={playing ? 'Simülasyonu duraklat' : 'Simülasyonu oynat'}
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>

        <div className="sim-control-block" aria-label="Simülasyon hızı">
          <span className="sim-control-label">Hız</span>
          <div className="sim-pill-group">
            {SPEED_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                className={`sim-pill-btn ${speed === opt ? 'is-active' : ''}`}
                aria-pressed={speed === opt}
                onClick={() => onChangeSpeed(opt)}
              >
                {opt}x
              </button>
            ))}
          </div>
        </div>

        <label className="sim-control-block sim-intensity-block">
          <span className="sim-control-label">
            Güç <strong>{intensity.toFixed(1)}x</strong>
          </span>
          <input
            type="range"
            min={0.6}
            max={1.6}
            step={0.1}
            value={intensity}
            onChange={(e) => onChangeIntensity(parseFloat(e.target.value))}
            className="range-input sim-intensity-slider"
            aria-label="Dalga şiddeti"
          />
        </label>

        <div className="sim-control-block" aria-label="Mevsim seçimi">
          <span className="sim-control-label">Mevsim</span>
          <div className="sim-pill-group">
            {SEASON_OPTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`sim-pill-btn ${
                  season === item.id ? 'is-active' : ''
                }`}
                aria-pressed={season === item.id}
                onClick={() => onChangeSeason(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="sim-control-block" aria-label="Rüzgar yönü">
          <span className="sim-control-label">Rüzgar</span>
          <div className="sim-pill-group">
            {WIND_DIR_OPTIONS.map((dir) => (
              <button
                key={dir.label}
                type="button"
                className={`sim-pill-btn ${
                  windDirDeg === dir.deg ? 'is-active' : ''
                }`}
                aria-pressed={windDirDeg === dir.deg}
                onClick={() => onChangeWindDir(dir.deg)}
              >
                {dir.label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          className="sim-clear-btn"
          onClick={onClearWaves}
          disabled={waveCount === 0 && frontCount === 0}
          title="Tüm dalgaları temizle"
        >
          <Trash2 size={13} aria-hidden="true" />
          <span>Temizle</span>
        </button>
      </div>
    </div>
  );
}
