import { clearWeatherCache, getWeatherCacheCount } from './weatherCache';
import { clearMarineCache, getMarineCacheCount } from './marineService';
import {
  clearCountryDetailCache,
  getCountryDetailCacheCount,
} from './countryDetailService';
import { clearForecastCache, getForecastCacheCount } from './forecastService';
import {
  clearAnomalyCache,
  getAnomalyCacheCount,
} from './seasonalAnomalyService';

export interface CacheBreakdown {
  weather: number;
  marine: number;
  country: number;
  forecast: number;
  anomaly: number;
  total: number;
}

export function getAllCacheStats(): CacheBreakdown {
  const weather = getWeatherCacheCount();
  const marine = getMarineCacheCount();
  const country = getCountryDetailCacheCount();
  const forecast = getForecastCacheCount();
  const anomaly = getAnomalyCacheCount();

  return {
    weather,
    marine,
    country,
    forecast,
    anomaly,
    total: weather + marine + country + forecast + anomaly,
  };
}

export function clearAllAppCaches(): void {
  clearWeatherCache();
  clearMarineCache();
  clearCountryDetailCache();
  clearForecastCache();
  clearAnomalyCache();
}
