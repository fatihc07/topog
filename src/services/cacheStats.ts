import { clearWeatherCache, getWeatherCacheCount } from './weatherCache';
import { clearMarineCache, getMarineCacheCount } from './marineService';
import {
  clearCountryDetailCache,
  getCountryDetailCacheCount,
} from './countryDetailService';
import { clearForecastCache, getForecastCacheCount } from './forecastService';

export interface CacheBreakdown {
  weather: number;
  marine: number;
  country: number;
  forecast: number;
  total: number;
}

export function getAllCacheStats(): CacheBreakdown {
  const weather = getWeatherCacheCount();
  const marine = getMarineCacheCount();
  const country = getCountryDetailCacheCount();
  const forecast = getForecastCacheCount();

  return {
    weather,
    marine,
    country,
    forecast,
    total: weather + marine + country + forecast,
  };
}

export function clearAllAppCaches(): void {
  clearWeatherCache();
  clearMarineCache();
  clearCountryDetailCache();
  clearForecastCache();
}
