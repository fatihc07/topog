import type { ReactNode } from 'react';
import {
  CloudRain,
  Flame,
  Pause,
  Play,
  Snowflake,
  Trash2,
} from 'lucide-react';

type WaveTool = 'cold' | 'warm' | 'moisture';
type SimSeason = 'winter' | 'spring' | 'summer' | 'autumn';

export interface SimulatorDockProps {
  activeTool: WaveTool;
  intensity: number;
  windDirDeg: number | null;
  playing: boolean;
  speed: number;
  season: SimSeason;
  waveCount: number;
  frontCount: number;
  onSelectTool: (tool: WaveTool) => void;
  onChangeIntensity: (val: number) => void;
  onChangeWindDir: (deg: number | null) => void;
  onTogglePlay: () => void;
  onChangeSpeed: (speed: number) => void;
  onChangeSeason: (season: SimSeason) => void;
  onClearWaves: () => void;
}

const WAVE_TOOLS: Array<{
  id: WaveTool;
  label: string;
  icon: ReactNode;
}> = [
  {
    id: 'cold',
    label: 'Soğuk Dalga',
    icon: <Snowflake size={14} aria-hidden="true" />,
  },
  {
    id: 'warm',
    label: 'Sıcak Dalga',
    icon: <Flame size={14} aria-hidden="true" />,
  },
  {
    id: 'moisture',
    label: 'Nemli Kütle',
    icon: <CloudRain size={14} aria-hidden="true" />,
  },
];

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

export function SimulatorDock({
  activeTool,
  intensity,
  windDirDeg,
  playing,
  speed,
  season,
  waveCount,
  frontCount,
  onSelectTool,
  onChangeIntensity,
  onChangeWindDir,
  onTogglePlay,
  onChangeSpeed,
  onChangeSeason,
  onClearWaves,
}: SimulatorDockProps) {
  return (
    <div
      className="glass-panel sim-dock"
      role="region"
      aria-label="Hava Simülatörü Kontrol Paneli"
    >
      <div className="sim-dock-row sim-dock-top">
        <div className="sim-tools-group" role="group" aria-label="Dalga türleri">
          {WAVE_TOOLS.map((tool) => {
            const isActive = activeTool === tool.id;
            return (
              <button
                key={tool.id}
                type="button"
                className={`sim-tool-btn is-${tool.id} ${
                  isActive ? 'is-active' : ''
                }`}
                aria-pressed={isActive}
                onClick={() => onSelectTool(tool.id)}
              >
                {tool.icon}
                <span>{tool.label}</span>
              </button>
            );
          })}
        </div>

        <span className="sim-hint-pill">Haritaya tıklayarak dalga gönder</span>

        <div className="sim-status-group" aria-live="polite">
          <span className="sim-status-badge">{waveCount} dalga</span>
          <span className="sim-status-badge is-front">{frontCount} cephe</span>
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
