import { Pause, Play, Video, X } from 'lucide-react';
import { FLYOVER_PRESETS, type FlyoverPreset } from '../services/flyoverPresets';

export interface FlyoverBarProps {
  activeName: string;
  playing: boolean;
  speed: number;
  pitch: number;
  onTogglePlay: () => void;
  onChangeSpeed: (speed: number) => void;
  onChangePitch: (pitch: number) => void;
  onSelectPreset: (preset: FlyoverPreset) => void;
  onClose: () => void;
}

const SPEED_OPTIONS = [
  { label: '0.5x', value: 0.5 },
  { label: '1x', value: 1 },
  { label: '2x', value: 2 },
] as const;

const PITCH_OPTIONS = [55, 65, 75] as const;

export function FlyoverBar({
  activeName,
  playing,
  speed,
  pitch,
  onTogglePlay,
  onChangeSpeed,
  onChangePitch,
  onSelectPreset,
  onClose,
}: FlyoverBarProps) {
  return (
    <div
      className="glass-panel flyover-bar"
      role="region"
      aria-label="3B Drone Uçuş Kontrolü"
    >
      <div className="flyover-top-row">
        <div className="flyover-header">
          <span className="flyover-icon-badge" aria-hidden="true">
            <Video size={15} />
          </span>
          <div className="flyover-title-group">
            <span className="flyover-kicker">3B Drone Uçuşu</span>
            <span className="flyover-active-name" title={activeName}>
              {activeName}
            </span>
          </div>
        </div>

        <div className="flyover-controls-row">
          <button
            type="button"
            className="flyover-play-btn"
            onClick={onTogglePlay}
            title={playing ? 'Yörüngeyi Duraklat' : 'Yörüngeyi Başlat'}
            aria-label={playing ? 'Yörüngeyi Duraklat' : 'Yörüngeyi Başlat'}
            aria-pressed={playing}
          >
            {playing ? <Pause size={14} /> : <Play size={14} />}
            <span>{playing ? 'Duraklat' : 'Oynat'}</span>
          </button>

          <div
            className="flyover-pill-group"
            role="group"
            aria-label="Uçuş hızı"
          >
            <span className="flyover-pill-label">Hız</span>
            {SPEED_OPTIONS.map((opt) => {
              const active = Math.abs(speed - opt.value) < 0.01;
              return (
                <button
                  key={opt.value}
                  type="button"
                  className={`flyover-pill ${active ? 'is-active' : ''}`}
                  onClick={() => onChangeSpeed(opt.value)}
                  aria-pressed={active}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          <div
            className="flyover-pill-group"
            role="group"
            aria-label="Kamera eğimi"
          >
            <span className="flyover-pill-label">Açı</span>
            {PITCH_OPTIONS.map((deg) => {
              const active = Math.round(pitch) === deg;
              return (
                <button
                  key={deg}
                  type="button"
                  className={`flyover-pill ${active ? 'is-active' : ''}`}
                  onClick={() => onChangePitch(deg)}
                  aria-pressed={active}
                >
                  {deg}°
                </button>
              );
            })}
          </div>

          <button
            type="button"
            className="flyover-close-btn"
            onClick={onClose}
            title="Uçuşu Bitir"
            aria-label="Uçuşu Bitir"
          >
            <X size={14} />
            <span>Uçuşu Bitir</span>
          </button>
        </div>
      </div>

      <div
        className="flyover-presets-scroll"
        role="list"
        aria-label="Manzara durakları"
      >
        {FLYOVER_PRESETS.map((preset) => {
          const isActive = activeName === preset.name;
          return (
            <button
              key={preset.id}
              type="button"
              role="listitem"
              className={`flyover-preset-pill ${isActive ? 'is-active' : ''}`}
              onClick={() => onSelectPreset(preset)}
              title={`${preset.name} (${preset.subtitle})`}
              aria-pressed={isActive}
            >
              <span className="flyover-preset-name">{preset.name}</span>
              <span className="flyover-preset-sub">{preset.subtitle}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
