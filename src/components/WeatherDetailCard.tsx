import { useEffect, useState } from 'react';
import { RefreshCw, Video, X } from 'lucide-react';
import { WEATHER_CACHE_TTL_MS } from '../services/weatherCache';
import { getWeatherMeta } from '../services/weatherService';
import type { WeatherData } from '../types/weather';
import { WeatherIcon } from './WeatherIcon';

interface WeatherDetailCardProps {
  weather: WeatherData;
  elevationMeters?: number;
  refreshing: boolean;
  onRefresh: (weather: WeatherData) => void;
  onStartFlyover?: (lng: number, lat: number, name: string) => void;
  onClose: () => void;
}

export function WeatherDetailCard({
  weather,
  elevationMeters,
  refreshing,
  onRefresh,
  onStartFlyover,
  onClose,
}: WeatherDetailCardProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, [weather.cityId, weather.fetchedAt]);

  const meta = getWeatherMeta(weather.weatherCode, weather.isDay);
  const elapsedMs = Math.max(0, now - weather.fetchedAt);
  const elapsedMin = Math.floor(elapsedMs / 60000);
  const remainingMin = Math.max(
    0,
    Math.ceil((WEATHER_CACHE_TTL_MS - elapsedMs) / 60000)
  );

  const cacheStatusText =
    weather.source === 'cache'
      ? `Bellekten · ${elapsedMin === 0 ? 'Az önce' : `${elapsedMin} dk önce`} (${remainingMin} dk geçerli)`
      : 'Canlı veri · Az önce güncellendi';

  return (
    <div
      className="glass-panel weather-card"
      role="region"
      aria-label="Şehir Hava Durumu"
    >
      <div className="weather-card-header">
        <div className="weather-city-block">
          <div className="weather-city-title">
            {weather.cityName}
            {typeof elevationMeters === 'number' && (
              <span className="peak-country-tag">
                ▲ {elevationMeters.toLocaleString('tr-TR')} m
              </span>
            )}
            {weather.country ? (
              <span className="weather-country-tag">{weather.country}</span>
            ) : null}
          </div>
          <div className="weather-condition-text">
            <WeatherIcon code={weather.weatherCode} isDay={weather.isDay} size={26} />
            <span>{meta.label}</span>
          </div>
        </div>

        <div className="weather-temp-right">
          <span className="weather-temp-big">
            {Math.round(weather.temperature)}°C
          </span>
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

      <div className="weather-metrics-grid">
        <div className="inspect-stat">
          <div className="inspect-stat-label">Hissedilen</div>
          <div className="inspect-stat-value">
            {Math.round(weather.apparentTemperature)}°C
          </div>
        </div>
        <div className="inspect-stat">
          <div className="inspect-stat-label">Nem</div>
          <div className="inspect-stat-value">%{Math.round(weather.humidity)}</div>
        </div>
        <div className="inspect-stat">
          <div className="inspect-stat-label">Rüzgar</div>
          <div className="inspect-stat-value">
            {Math.round(weather.windSpeed)} km/sa
          </div>
        </div>
        <div className="inspect-stat">
          <div className="inspect-stat-label">Basınç</div>
          <div className="inspect-stat-value">
            {weather.pressure !== null ? `${weather.pressure} hPa` : '—'}
          </div>
        </div>
        {typeof weather.snowDepthCm === 'number' && weather.snowDepthCm > 0 && (
          <div className="inspect-stat" style={{ gridColumn: '1 / -1' }}>
            <div className="inspect-stat-label">Kar Kalınlığı</div>
            <div className="inspect-stat-value snow">
              ❄ {weather.snowDepthCm.toLocaleString('tr-TR')} cm
              {typeof weather.snowfallCm === 'number' && weather.snowfallCm > 0
                ? ` · +${weather.snowfallCm} cm taze kar`
                : ''}
            </div>
          </div>
        )}
      </div>

      <div
        className={`weather-cache-banner ${
          weather.source === 'cache' ? 'is-cache' : 'is-live'
        }`}
      >
        <span
          className={`cache-dot ${
            weather.source === 'cache' ? 'cached' : 'live'
          }`}
        />
        <span>{cacheStatusText}</span>
      </div>

      <div className="inspect-actions">
        <button
          type="button"
          className="btn-accent"
          onClick={() => onRefresh(weather)}
          disabled={refreshing}
        >
          <RefreshCw size={14} className={refreshing ? 'spin' : undefined} />
          <span>{refreshing ? 'Güncelleniyor...' : 'Şimdi Yenile'}</span>
        </button>
        {onStartFlyover && (
          <button
            type="button"
            className="btn-accent"
            onClick={() =>
              onStartFlyover(weather.lng, weather.lat, weather.cityName)
            }
          >
            <Video size={14} />
            <span>3D Uçuş</span>
          </button>
        )}
      </div>
    </div>
  );
}
