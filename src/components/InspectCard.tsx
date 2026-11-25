import { Loader2, MapPin, Mountain, Video, X } from 'lucide-react';
import type { InspectedPoint } from '../types/map';
import { MarineSection } from './MarineSection';

interface InspectCardProps {
  point: InspectedPoint;
  onZoom3D: (lng: number, lat: number) => void;
  onStartFlyover?: (lng: number, lat: number, name: string) => void;
  onClose: () => void;
}

function formatCoord(value: number, posLabel: string, negLabel: string): string {
  const dir = value >= 0 ? posLabel : negLabel;
  return `${Math.abs(value).toFixed(4)}° ${dir}`;
}

export function InspectCard({
  point,
  onZoom3D,
  onStartFlyover,
  onClose,
}: InspectCardProps) {
  const latStr = formatCoord(point.lat, 'K', 'G');
  const lngStr = formatCoord(point.lng, 'D', 'B');

  return (
    <div className="glass-panel inspect-card" role="region" aria-label="Nokta İnceleme">
      <div className="inspect-header">
        <div className="inspect-title-wrap">
          <MapPin
            size={16}
            color="#38bdf8"
            style={{ marginTop: 2, flexShrink: 0 }}
          />
          <div className="inspect-title">
            {point.loading && !point.placeName
              ? 'Konum sorgulanıyor...'
              : point.placeName || 'Seçili Coğrafi Nokta'}
          </div>
        </div>
        <button
          type="button"
          className="icon-btn-inline"
          onClick={onClose}
          aria-label="Kapat"
        >
          <X size={15} />
        </button>
      </div>

      <div className="inspect-grid">
        <div className="inspect-stat">
          <div className="inspect-stat-label">Koordinat</div>
          <div className="inspect-stat-value">
            {latStr}
            <br />
            {lngStr}
          </div>
        </div>
        <div className="inspect-stat">
          <div className="inspect-stat-label">Rakım / Yükseklik</div>
          <div className="inspect-stat-value elevation">
            {point.loading && point.elevation === null ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Loader2 size={13} className="spin" /> Ölçülüyor
              </span>
            ) : point.elevation !== null ? (
              `${Math.round(point.elevation).toLocaleString('tr-TR')} m`
            ) : (
              'Veri yok'
            )}
          </div>
        </div>
      </div>

      {point.marine ? <MarineSection marine={point.marine} /> : null}

      <div className="inspect-actions">
        <button
          type="button"
          className="btn-accent"
          onClick={() => onZoom3D(point.lng, point.lat)}
        >
          <Mountain size={14} />
          <span>3D Yakınlaş</span>
        </button>
        {onStartFlyover && (
          <button
            type="button"
            className="btn-accent"
            onClick={() =>
              onStartFlyover(
                point.lng,
                point.lat,
                point.placeName || 'Seçili Nokta'
              )
            }
          >
            <Video size={14} />
            <span>Drone Uçuşu</span>
          </button>
        )}
      </div>
    </div>
  );
}
