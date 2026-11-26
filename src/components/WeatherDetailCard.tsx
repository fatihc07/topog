import { useEffect, useState } from 'react';
import { ArrowLeftRight, RefreshCw, Star, X } from 'lucide-react';
import { WEATHER_CACHE_TTL_MS } from '../services/weatherCache';
import { getWeatherMeta } from '../services/weatherService';
import type { WeatherData } from '../types/weather';
import { ForecastSection } from './ForecastSection';
import { WeatherIcon } from './WeatherIcon';

interface WeatherDetailCardProps {
  weather: WeatherData;
  elevationMeters?: number;
  refreshing: boolean;
  onRefresh: (weather: WeatherData) => void;
  onClose: () => void;
  onStartCompare?: () => void;
  isCompareSource?: boolean;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  onForecastSynced?: () => void;
}

export function WeatherDetailCard({
  weather,
  elevationMeters,
  refreshing,
  onRefresh,
  onClose,
  onStartCompare,
  isCompareSource,
  isFavorite,
  onToggleFavorite,
  onForecastSynced,
}: WeatherDetailCardProps) {
  const [now, setNow] = useState(() => Date.now());
  const [forecastRefreshToken, setForecastRefreshToken] = useState(0);

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, [weather.cityId, weather.fetchedAt]);

  useEffect(() => {
    if (!onForecastSynced) return;
    const timer = window.setTimeout(() => {
      onForecastSynced();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [weather.lat, weather.lng, elevationMeters, forecastRefreshToken, onForecastSynced]);

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

      <ForecastSection
        lat={weather.lat}
        lng={weather.lng}
        elevationMeters={elevationMeters}
        refreshToken={forecastRefreshToken}
      />

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
          onClick={() => {
            setForecastRefreshToken((t) => t + 1);
            onRefresh(weather);
            onForecastSynced?.();
          }}
          disabled={refreshing}
        >
          <RefreshCw size={14} className={refreshing ? 'spin' : undefined} />
          <span>{refreshing ? 'Güncelleniyor...' : 'Şimdi Yenile'}</span>
        </button>
        {onStartCompare && (
          <button
            type="button"
            className={`btn-compare${isCompareSource ? ' active' : ''}`}
            onClick={onStartCompare}
          >
            <ArrowLeftRight size={14} />
            <span>Karşılaştır</span>
          </button>
        )}
      </div>
    </div>
  );
}
