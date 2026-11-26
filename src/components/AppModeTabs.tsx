import type { JSX } from 'react';
import { Globe, Trees } from 'lucide-react';

export interface AppModeTabsProps {
  mode: 'atlas' | 'world';
  onChangeMode: (mode: 'atlas' | 'world') => void;
}

export function AppModeTabs({
  mode,
  onChangeMode,
}: AppModeTabsProps): JSX.Element {
  return (
    <div
      className="glass-panel app-mode-tabs"
      role="tablist"
      aria-label="Uygulama modu"
    >
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'atlas'}
        className={`app-mode-tab-btn${mode === 'atlas' ? ' is-active' : ''}`}
        onClick={() => onChangeMode('atlas')}
      >
        <Globe size={14} />
        <span>Canlı Atlas</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'world'}
        className={`app-mode-tab-btn is-world${mode === 'world' ? ' is-active' : ''}`}
        onClick={() => onChangeMode('world')}
      >
        <Trees size={14} />
        <span>Canlı Dünya</span>
      </button>
    </div>
  );
}
