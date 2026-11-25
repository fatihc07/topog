import { BASE_LAYER_MAP } from '../config/layers';
import { WEATHER_MIN_ZOOM } from '../services/cityIndex';
import type { BaseLayerId, TelemetryState } from '../types/map';
import type { AppMode } from '../types/simulator';
import type { WeatherSyncSummary } from '../types/weather';

interface TelemetryBarProps {
  telemetry: TelemetryState;
  activeLayer: BaseLayerId;
  terrain3D: boolean;
  appMode: AppMode;
  simWaveCount: number;
  simFrontCount: number;
  weatherEnabled: boolean;
  weatherSummary: WeatherSyncSummary;
}

function formatAxis(val: number | null, pos: string, neg: string): string {
  if (val === null) return '—';
  const dir = val >= 0 ? pos : neg;
  return `${Math.abs(val).toFixed(4)}° ${dir}`;
}

export function TelemetryBar({
  telemetry,
  activeLayer,
  terrain3D,
  appMode,
  simWaveCount,
  simFrontCount,
  weatherEnabled,
  weatherSummary,
}: TelemetryBarProps) {
  const layerCfg = BASE_LAYER_MAP[activeLayer];

  let weatherStatus = 'Hava: Kapalı';
  if (appMode === 'simulator') {
    weatherStatus = `Simülatör: ${simWaveCount} dalga · ${simFrontCount} cephe`;
  } else if (weatherEnabled) {
    if (telemetry.zoom < WEATHER_MIN_ZOOM) {
      weatherStatus = `Hava durumu için yaklaşın (z${WEATHER_MIN_ZOOM}+)`;
    } else if (weatherSummary.loading) {
      weatherStatus = 'Hava durumu çekiliyor...';
    } else {
      weatherStatus = `Hava: ${weatherSummary.visibleCount} şehir (${weatherSummary.fromCacheCount} bellekten, ${weatherSummary.fetchedCount} canlı)`;
    }
  }

  return (
    <footer className="telemetry-bar">
      <div className="telemetry-group">
        <div className="telemetry-item">
          <span>Enlem:</span>
          <span className="telemetry-mono">
            {formatAxis(telemetry.lat, 'K', 'G')}
          </span>
        </div>
        <div className="telemetry-item">
          <span>Boylam:</span>
          <span className="telemetry-mono">
            {formatAxis(telemetry.lng, 'D', 'B')}
          </span>
        </div>
        {terrain3D && (
          <div className="telemetry-item telemetry-hide-sm">
            <span>Rakım:</span>
            <span className="telemetry-elev">
              {telemetry.elevation !== null
                ? `${telemetry.elevation.toLocaleString('tr-TR')} m`
                : '—'}
            </span>
          </div>
        )}
        <div className="telemetry-item telemetry-hide-sm">
          <span className="telemetry-weather-status">{weatherStatus}</span>
        </div>
      </div>

      <div className="telemetry-group">
        <div className="telemetry-item telemetry-hide-sm">
          <span>Katman:</span>
          <span className="telemetry-mono">{layerCfg.name}</span>
        </div>
        <div className="telemetry-item">
          <span>Yakınlaştırma:</span>
          <span className="telemetry-mono">z{telemetry.zoom.toFixed(1)}</span>
        </div>
        <div className="telemetry-item telemetry-hide-sm">
          <span>Eğim:</span>
          <span className="telemetry-mono">{Math.round(telemetry.pitch)}°</span>
        </div>
        <div className="telemetry-item telemetry-hide-sm">
          <span>Yön:</span>
          <span className="telemetry-mono">
            {Math.round(((telemetry.bearing % 360) + 360) % 360)}°
          </span>
        </div>
      </div>
    </footer>
  );
}
