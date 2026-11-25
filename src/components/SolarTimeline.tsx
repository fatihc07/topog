import { Pause, Play, RotateCcw, Sun, X } from 'lucide-react';

export interface SolarTimelineProps {
  minutesOfDay: number;
  playing: boolean;
  sunElevationDeg: number;
  sunAzimuthDeg: number;
  onTogglePlay: () => void;
  onChangeMinutes: (min: number) => void;
  onResetNow: () => void;
  onClose: () => void;
}

type SunPhase = 'day' | 'golden' | 'night';

function getSunPhase(elevationDeg: number): {
  kind: SunPhase;
  label: string;
} {
  if (elevationDeg < -4) {
    return { kind: 'night', label: 'Gece' };
  }
  if (elevationDeg <= 6) {
    return { kind: 'golden', label: 'Altın Saat' };
  }
  return { kind: 'day', label: 'Gündüz' };
}

function formatMinutesOfDay(minutesOfDay: number): string {
  const clamped = Math.min(1439, Math.max(0, Math.round(minutesOfDay)));
  const hours = Math.floor(clamped / 60);
  const minutes = clamped % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function SolarTimeline({
  minutesOfDay,
  playing,
  sunElevationDeg,
  sunAzimuthDeg,
  onTogglePlay,
  onChangeMinutes,
  onResetNow,
  onClose,
}: SolarTimelineProps) {
  const clampedMinutes = Math.min(1439, Math.max(0, Math.round(minutesOfDay)));
  const formattedTime = formatMinutesOfDay(clampedMinutes);
  const phase = getSunPhase(sunElevationDeg);
  const normalizedAzimuth = Math.round(((sunAzimuthDeg % 360) + 360) % 360);

  return (
    <div
      className="glass-panel solar-timeline"
      role="region"
      aria-label="Güneş ve Gölge Simülatörü"
    >
      <button
        type="button"
        className="solar-play-btn"
        onClick={onTogglePlay}
        title={playing ? 'Duraklat' : 'Oynat'}
        aria-label={playing ? 'Duraklat' : 'Oynat'}
      >
        {playing ? <Pause size={15} /> : <Play size={15} />}
      </button>

      <div className="solar-track-wrap">
        <div className="solar-track-header">
          <span className="solar-title">
            <Sun size={13} />
            <span>Güneş &amp; Gölge</span>
          </span>

          <div className="solar-time-group">
            <span className="solar-time-mono">{formattedTime}</span>
            <span className={`solar-phase-badge is-${phase.kind}`}>
              {phase.label}
            </span>
            <span
              className="solar-sun-readout"
              title="Güneş azimut açısı ve yüksekliği"
            >
              Azm {normalizedAzimuth}° · Yük {sunElevationDeg.toFixed(1)}°
            </span>
          </div>
        </div>

        <input
          type="range"
          min={0}
          max={1439}
          step={5}
          value={clampedMinutes}
          onChange={(e) => onChangeMinutes(parseInt(e.target.value, 10))}
          className="range-input solar-scrubber"
          aria-label="Gün içi saat seçimi"
        />
      </div>

      <div className="solar-actions">
        <button
          type="button"
          className="solar-reset-btn"
          onClick={onResetNow}
          title="Şu anki zamana sıfırla"
          aria-label="Şimdi"
        >
          <RotateCcw size={12} />
          <span>Şimdi</span>
        </button>

        <button
          type="button"
          className="icon-btn-inline"
          onClick={onClose}
          title="Kapat"
          aria-label="Güneş zaman çizelgesini kapat"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
