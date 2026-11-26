import { Loader2, MapPin, Mountain, Star, X } from 'lucide-react';
import type { InspectedPoint } from '../types/map';
import { MarineSection } from './MarineSection';

interface InspectCardProps {
  point: InspectedPoint;
  onZoom3D: (lng: number, lat: number) => void;
  onClose: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
}

function formatCoord(value: number, posLabel: string, negLabel: string): string {
  const dir = value >= 0 ? posLabel : negLabel;
  return `${Math.abs(value).toFixed(4)}° ${dir}`;
}

export function InspectCard({
  point,
  onZoom3D,
  onClose,
  isFavorite,
  onToggleFavorite,
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
        <div className="card-header-actions">
          {onToggleFavorite && (
            <button
              type="button"
              className={`icon-btn-inline favorite-star-btn ${isFavorite ? 'is-fav' : ''}`}
              onClick={onToggleFavorite}
              title={isFavorite ? 'Favorilerden çıkar' : 'Favorilere ekle'}
              aria-label={isFavorite ? 'Favorilerden çıkar' : 'Favorilere ekle'}
            >
              <Star size={15} fill={isFavorite ? '#fbbf24' : 'none'} />
            </button>
          )}
          <button
            type="button"
            className="icon-btn-inline"
            onClick={onClose}
            aria-label="Kapat"
          >
            <X size={15} />
          </button>
        </div>
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
      </div>
    </div>
  );
}
