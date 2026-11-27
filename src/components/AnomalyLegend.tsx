import { Thermometer } from 'lucide-react';

interface AnomalyLegendProps {
  loading: boolean;
}

export function AnomalyLegend({ loading }: AnomalyLegendProps) {
  return (
    <div
      className="glass-panel anomaly-legend"
      role="region"
      aria-label="Mevsim Normalleri Sıcaklık Farkı Skalası"
    >
      <div className="anomaly-legend-header">
        <span className="anomaly-legend-title">
          <Thermometer size={14} color="#f59e0b" />
          <span>Mevsim Normallerine Göre Fark</span>
        </span>
        {loading && <span className="anomaly-legend-status">Hesaplanıyor...</span>}
      </div>

      <div className="anomaly-legend-bar" />

      <div className="anomaly-legend-ticks">
        <span>-8°</span>
        <span>-4°</span>
        <span>-2°</span>
        <span className="tick-normal">0° Normal</span>
        <span>+2°</span>
        <span>+4°</span>
        <span>+8°C</span>
      </div>

      <div className="anomaly-legend-source">
        Open-Meteo ERA5 (1996–2020 ort.) · 15 dk önbellek
      </div>
    </div>
  );
}
