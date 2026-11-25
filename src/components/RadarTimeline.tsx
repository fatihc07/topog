import { Loader2, Pause, Play } from 'lucide-react';
import type { RadarFrame } from '../types/weather';

interface RadarTimelineProps {
  frames: RadarFrame[];
  activeIndex: number;
  playing: boolean;
  loading: boolean;
  onTogglePlay: () => void;
  onSelectIndex: (index: number) => void;
}

export function RadarTimeline({
  frames,
  activeIndex,
  playing,
  loading,
  onTogglePlay,
  onSelectIndex,
}: RadarTimelineProps) {
  const safeIndex =
    frames.length > 0 ? Math.min(Math.max(0, activeIndex), frames.length - 1) : 0;
  const activeFrame = frames[safeIndex];
  const latestFrame = frames[frames.length - 1];
  const isLiveFrame =
    frames.length > 0 && safeIndex === frames.length - 1;

  const formattedTime = activeFrame
    ? new Date(activeFrame.time * 1000).toLocaleTimeString('tr-TR', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '--:--';

  const diffMin =
    activeFrame && latestFrame
      ? Math.max(0, Math.round((latestFrame.time - activeFrame.time) / 60))
      : 0;

  return (
    <div
      className="glass-panel radar-timeline"
      role="region"
      aria-label="Yağmur Radarı 2 Saatlik Animasyon"
    >
      <button
        type="button"
        className="radar-play-btn"
        onClick={onTogglePlay}
        disabled={loading || frames.length < 2}
        title={playing ? 'Duraklat' : 'Oynat'}
        aria-label={playing ? 'Duraklat' : 'Oynat'}
      >
        {loading ? (
          <Loader2 size={15} className="spin" />
        ) : playing ? (
          <Pause size={15} />
        ) : (
          <Play size={15} />
        )}
      </button>

      <div className="radar-track-wrap">
        <div className="radar-track-header">
          <span className="radar-title">Yağmur Radarı (Son 2 Saat)</span>
          <div className="radar-time-group">
            <span className="radar-time-mono">{formattedTime}</span>
            <span
              className={`radar-time-badge ${isLiveFrame ? 'is-live' : ''}`}
            >
              {loading
                ? 'Yükleniyor'
                : isLiveFrame
                ? 'Canlı'
                : `-${diffMin} dk`}
            </span>
          </div>
        </div>

        <input
          type="range"
          min={0}
          max={Math.max(0, frames.length - 1)}
          step={1}
          value={safeIndex}
          disabled={frames.length <= 1}
          onChange={(e) => onSelectIndex(parseInt(e.target.value, 10))}
          className="range-input radar-scrubber"
          aria-label="Radar zaman çizelgesi"
        />
      </div>

      <div className="radar-legend" title="Yağış şiddeti: Hafif → Orta → Şiddetli">
        <span className="radar-legend-label">Hafif</span>
        <span className="radar-legend-bar" />
        <span className="radar-legend-label">Şiddetli</span>
      </div>
    </div>
  );
}
