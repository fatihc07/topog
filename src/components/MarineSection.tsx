import { Waves } from 'lucide-react';
import { formatWaveDirection, type MarineData } from '../services/marineService';

export interface MarineSectionProps {
  marine: MarineData;
}

function formatDirectionValue(deg: number | null): string {
  if (deg === null || !Number.isFinite(deg)) return '—';
  const normalizedDeg = Math.round(((deg % 360) + 360) % 360);
  return `${formatWaveDirection(deg)} · ${normalizedDeg}°`;
}

export function MarineSection({ marine }: MarineSectionProps) {
  const isCache = marine.source === 'cache';

  return (
    <section
      className="marine-section"
      aria-label="Deniz ve Dalga Durumu"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        paddingTop: 10,
        borderTop: '1px solid var(--border-glass)',
      }}
    >
      <div
        className="marine-section-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}
        >
          <Waves size={14} color="#38bdf8" style={{ flexShrink: 0 }} />
          <span>Deniz &amp; Dalga Durumu</span>
        </div>

        <div
          className="marine-status-badge"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            fontSize: 10.5,
            fontWeight: 500,
            color: 'var(--text-secondary)',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-glass)',
            borderRadius: 999,
            padding: '2px 8px',
          }}
        >
          <span className={`cache-dot ${isCache ? 'cached' : 'live'}`} />
          <span>{isCache ? 'Bellekten' : 'Canlı'}</span>
        </div>
      </div>

      <div className="inspect-grid">
        <div className="inspect-stat">
          <div className="inspect-stat-label">Deniz Suyu</div>
          <div className="inspect-stat-value">
            {marine.seaTempC !== null ? `${marine.seaTempC.toFixed(1)} °C` : '—'}
          </div>
        </div>

        <div className="inspect-stat">
          <div className="inspect-stat-label">Dalga Yüksekliği</div>
          <div className="inspect-stat-value">
            {marine.waveHeightM !== null ? `${marine.waveHeightM.toFixed(2)} m` : '—'}
          </div>
        </div>

        <div className="inspect-stat">
          <div className="inspect-stat-label">Dalga Periyodu</div>
          <div className="inspect-stat-value">
            {marine.wavePeriodS !== null ? `${marine.wavePeriodS.toFixed(1)} sn` : '—'}
          </div>
        </div>

        <div className="inspect-stat">
          <div className="inspect-stat-label">Dalga Yönü</div>
          <div className="inspect-stat-value">
            {formatDirectionValue(marine.waveDirectionDeg)}
          </div>
        </div>
      </div>
    </section>
  );
}
