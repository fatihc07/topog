import { Radio, Sparkles } from 'lucide-react';

export interface ModeTabsProps {
  mode: 'live' | 'simulator';
  activeWaveCount: number;
  onChangeMode: (mode: 'live' | 'simulator') => void;
}

export function ModeTabs({
  mode,
  activeWaveCount,
  onChangeMode,
}: ModeTabsProps) {
  return (
    <div
      className="glass-panel mode-tabs"
      role="tablist"
      aria-label="Harita çalışma modu"
    >
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'live'}
        className={`mode-tab-btn ${mode === 'live' ? 'is-active' : ''}`}
        onClick={() => onChangeMode('live')}
      >
        <Radio size={14} aria-hidden="true" />
        <span>Canlı Atlas</span>
      </button>

      <button
        type="button"
        role="tab"
        aria-selected={mode === 'simulator'}
        className={`mode-tab-btn is-simulator ${
          mode === 'simulator' ? 'is-active' : ''
        }`}
        onClick={() => onChangeMode('simulator')}
      >
        <Sparkles size={14} aria-hidden="true" />
        <span>Hava Simülatörü</span>
        {activeWaveCount > 0 && (
          <span
            className="mode-tab-badge"
            aria-label={`${activeWaveCount} aktif dalga`}
          >
            {activeWaveCount}
          </span>
        )}
      </button>
    </div>
  );
}
