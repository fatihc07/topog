import { useEffect, useState } from 'react';
import { Crosshair, Droplets, Loader2, Star, Wind, X } from 'lucide-react';
import {
  computeLocalTimeFromUtcOffset,
  type CountryDetailData,
} from '../services/countryDetailService';
import type { CountryHoverInfo } from '../services/countryService';
import { getWeatherMeta } from '../services/weatherService';
import { WeatherIcon } from './WeatherIcon';

export interface CountryDetailCardProps {
  country: CountryHoverInfo;
  detail: CountryDetailData | null;
  loading: boolean;
  onFocusCountry: () => void;
  onClose: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
}

interface StatItem {
  label: string;
  value: string;
  fullWidth?: boolean;
}

export function CountryDetailCard({
  country,
  detail,
  loading,
  onFocusCountry,
  onClose,
  isFavorite,
  onToggleFavorite,
}: CountryDetailCardProps) {
  const utcOffsetLabel = detail?.utcOffsetLabel ?? null;
  const [liveLocalTime, setLiveLocalTime] = useState<string | null>(() =>
    utcOffsetLabel
      ? computeLocalTimeFromUtcOffset(utcOffsetLabel)
      : (detail?.localTimeStr ?? null)
  );

  useEffect(() => {
    if (!utcOffsetLabel) {
      setLiveLocalTime(detail?.localTimeStr ?? null);
      return;
    }
    setLiveLocalTime(computeLocalTimeFromUtcOffset(utcOffsetLabel));
    const timer = window.setInterval(() => {
      setLiveLocalTime(computeLocalTimeFromUtcOffset(utcOffsetLabel));
    }, 30000);
    return () => window.clearInterval(timer);
  }, [utcOffsetLabel, detail?.localTimeStr]);

  const flag = detail?.flag || country.flag;
  const iso = (detail?.iso || country.iso || '').trim().toUpperCase();
  const continent = (detail?.continent || country.continent || '').trim();
  const subregion = (detail?.subregion || '').trim();
  const subtitleParts: string[] = [];
  if (continent) subtitleParts.push(continent);
  if (subregion && subregion.toLowerCase() !== continent.toLowerCase()) {
    subtitleParts.push(subregion);
  }
  const subtitle = subtitleParts.join(' · ');

  const stats: StatItem[] = [];
  if (!loading && detail) {
    if (detail.capital) {
      stats.push({ label: 'Başkent', value: detail.capital });
    }
    if (typeof detail.population === 'number' && Number.isFinite(detail.population)) {
      stats.push({
        label: 'Nüfus',
        value: detail.population.toLocaleString('tr-TR'),
      });
    }
    if (typeof detail.areaKm2 === 'number' && Number.isFinite(detail.areaKm2)) {
      stats.push({
        label: 'Yüzölçümü',
        value: `${Math.round(detail.areaKm2).toLocaleString('tr-TR')} km²`,
      });
    }
    const timeDisplay = liveLocalTime ?? detail.localTimeStr;
    if (timeDisplay) {
      stats.push({
        label: 'Yerel Saat',
        value: detail.utcOffsetLabel
          ? `${timeDisplay} (${detail.utcOffsetLabel})`
          : timeDisplay,
      });
    }
    if (detail.currencies.length > 0) {
      stats.push({
        label: 'Para Birimi',
        value: detail.currencies[0],
        fullWidth: stats.length % 2 === 0,
      });
    }
  }

  const capitalWeather = !loading ? (detail?.capitalWeather ?? null) : null;
  const weatherMeta = capitalWeather
    ? getWeatherMeta(capitalWeather.weatherCode, capitalWeather.isDay)
    : null;

  return (
    <div
      className="glass-panel country-detail-card"
      role="region"
      aria-label="Ülke Bilgisi"
    >
      <div className="inspect-header country-card-header">
        <div className="inspect-title-wrap">
          {flag ? (
            <span className="country-card-flag" aria-hidden="true">
              {flag}
            </span>
          ) : null}
          <div className="country-title-block">
            <div className="weather-city-title">
              <span>{country.nameTr}</span>
              {iso ? <span className="weather-country-tag">{iso}</span> : null}
            </div>
            {subtitle ? <div className="country-subtitle">{subtitle}</div> : null}
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

      {loading ? (
        <div className="country-loading-row">
          <Loader2 size={14} className="spin" />
          <span>Ülke bilgileri yükleniyor...</span>
        </div>
      ) : stats.length > 0 ? (
        <div className="inspect-grid">
          {stats.map((item) => (
            <div
              key={item.label}
              className="inspect-stat"
              style={item.fullWidth ? { gridColumn: '1 / -1' } : undefined}
            >
              <div className="inspect-stat-label">{item.label}</div>
              <div className="inspect-stat-value">{item.value}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="country-empty-note">
          Ek ülke istatistik verisi bulunmuyor
        </div>
      )}

      {capitalWeather && weatherMeta ? (
        <div className="country-capital-weather">
          <div className="country-capital-weather-head">
            <span className="country-capital-weather-title">
              {detail?.capital || capitalWeather.cityName} · Canlı Hava
            </span>
            <span className="country-capital-weather-cond">
              {weatherMeta.label}
            </span>
          </div>

          <div className="country-capital-weather-body">
            <div className="country-capital-weather-main">
              <WeatherIcon
                code={capitalWeather.weatherCode}
                isDay={capitalWeather.isDay}
                size={24}
              />
              <span className="country-capital-weather-temp">
                {Math.round(capitalWeather.temperature)}°C
              </span>
              <span className="country-capital-weather-feels">
                Hissedilen {Math.round(capitalWeather.apparentTemperature)}°C
              </span>
            </div>

            <div className="country-capital-weather-meta">
              <span className="country-weather-pill">
                <Droplets size={12} />
                <span>%{Math.round(capitalWeather.humidity)}</span>
              </span>
              <span className="country-weather-pill">
                <Wind size={12} />
                <span>{Math.round(capitalWeather.windSpeed)} km/sa</span>
              </span>
            </div>
          </div>
        </div>
      ) : null}

      <div className="inspect-actions">
        <button
          type="button"
          className="btn-accent"
          onClick={onFocusCountry}
        >
          <Crosshair size={14} />
          <span>Ülkeye Odaklan</span>
        </button>
      </div>
    </div>
  );
}
