import { reverseGeocode } from './geocoding';
import {
  getCachedLocalPlace,
  getFreshWeather,
  setCachedLocalPlace,
  setWeatherEntries,
} from './weatherCache';
import type { CityRecord, WeatherData } from '../types/weather';

interface OpenMeteoCurrentBlock {
  temperature_2m?: number;
  apparent_temperature?: number;
  relative_humidity_2m?: number;
  weather_code?: number;
  wind_speed_10m?: number;
  surface_pressure?: number;
  is_day?: number;
}

interface OpenMeteoForecastResponse {
  current?: OpenMeteoCurrentBlock;
}

export function getWeatherMeta(
  code: number,
  isDay: boolean
): { label: string; emoji: string } {
  if (code === 0) {
    return {
      label: isDay ? 'Açık ve Güneşli' : 'Açık Gece',
      emoji: isDay ? '☀️' : '🌙',
    };
  }
  if (code === 1) {
    return { label: 'Az Bulutlu', emoji: isDay ? '🌤️' : '🌙' };
  }
  if (code === 2) {
    return { label: 'Parçalı Bulutlu', emoji: isDay ? '⛅' : '☁️' };
  }
  if (code === 3) {
    return { label: 'Çok Bulutlu', emoji: '☁️' };
  }
  if (code === 45 || code === 48) {
    return { label: 'Sisli / Puslu', emoji: '🌫️' };
  }
  if (code >= 51 && code <= 57) {
    return { label: 'Çiseleyen Yağmur', emoji: '🌦️' };
  }
  if (code >= 61 && code <= 67) {
    return { label: 'Yağmurlu', emoji: '🌧️' };
  }
  if (code >= 71 && code <= 77) {
    return { label: 'Kar Yağışlı', emoji: '❄️' };
  }
  if (code >= 80 && code <= 82) {
    return { label: 'Sağanak Yağışlı', emoji: '🌧️' };
  }
  if (code === 85 || code === 86) {
    return { label: 'Kar Sağanağı', emoji: '🌨️' };
  }
  if (code >= 95) {
    return { label: 'Gök Gürültülü Fırtına', emoji: '⛈️' };
  }
  return { label: 'Değişken', emoji: '🌡️' };
}

export async function fetchWeatherForCities(
  cities: CityRecord[],
  options?: { forceRefresh?: boolean; signal?: AbortSignal }
): Promise<{
  items: WeatherData[];
  fromCacheCount: number;
  fetchedCount: number;
}> {
  if (cities.length === 0) {
    return { items: [], fromCacheCount: 0, fetchedCount: 0 };
  }

  const now = Date.now();
  const forceRefresh = options?.forceRefresh ?? false;
  const cachedById = new Map<string, WeatherData>();
  const missing: CityRecord[] = [];

  for (const city of cities) {
    if (!forceRefresh) {
      const cached = getFreshWeather(city.id, now);
      if (cached) {
        cachedById.set(city.id, cached);
        continue;
      }
    }
    missing.push(city);
  }

  let fetchedById = new Map<string, WeatherData>();

  if (missing.length > 0) {
    const latitudes = missing.map((c) => c.lat.toFixed(4)).join(',');
    const longitudes = missing.map((c) => c.lng.toFixed(4)).join(',');
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${latitudes}&longitude=${longitudes}` +
      `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,surface_pressure,is_day`;

    const response = await fetch(url, {
      signal: options?.signal,
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Open-Meteo HTTP ${response.status}`);
    }

    const raw = (await response.json()) as
      | OpenMeteoForecastResponse
      | OpenMeteoForecastResponse[];
    // Open-Meteo returns an object for 1 point and an array for 2+ points
    const list = Array.isArray(raw) ? raw : [raw];
    const fetchedAt = Date.now();
    const freshItems: WeatherData[] = [];

    for (let i = 0; i < missing.length; i++) {
      const city = missing[i];
      const cur = list[i]?.current;
      if (!cur || typeof cur.temperature_2m !== 'number') continue;

      const weatherItem: WeatherData = {
        cityId: city.id,
        cityName: city.name,
        country: city.country,
        lat: city.lat,
        lng: city.lng,
        temperature: cur.temperature_2m,
        apparentTemperature:
          typeof cur.apparent_temperature === 'number'
            ? cur.apparent_temperature
            : cur.temperature_2m,
        humidity:
          typeof cur.relative_humidity_2m === 'number'
            ? cur.relative_humidity_2m
            : 0,
        windSpeed:
          typeof cur.wind_speed_10m === 'number' ? cur.wind_speed_10m : 0,
        pressure:
          typeof cur.surface_pressure === 'number'
            ? Math.round(cur.surface_pressure)
            : null,
        weatherCode: typeof cur.weather_code === 'number' ? cur.weather_code : 0,
        isDay: cur.is_day !== 0,
        fetchedAt,
        source: 'live',
      };

      freshItems.push(weatherItem);
      fetchedById.set(city.id, weatherItem);
    }

    if (freshItems.length > 0) {
      setWeatherEntries(freshItems, fetchedAt);
    }
  }

  const ordered: WeatherData[] = [];
  for (const city of cities) {
    const item = cachedById.get(city.id) ?? fetchedById.get(city.id);
    if (item) ordered.push(item);
  }

  return {
    items: ordered,
    fromCacheCount: cachedById.size,
    fetchedCount: fetchedById.size,
  };
}

export async function resolveLocalCityAtCenter(
  lat: number,
  lng: number,
  signal?: AbortSignal
): Promise<CityRecord> {
  const roundedLat = Math.round(lat * 100) / 100;
  const roundedLng = Math.round(lng * 100) / 100;
  const cityId = `local:${roundedLat.toFixed(2)},${roundedLng.toFixed(2)}`;

  let name = getCachedLocalPlace(cityId);
  if (!name) {
    const full = await reverseGeocode(roundedLat, roundedLng, signal);
    if (full) {
      name = full.split(',')[0].trim();
    } else {
      name = `${roundedLat.toFixed(2)}°, ${roundedLng.toFixed(2)}°`;
    }
    setCachedLocalPlace(cityId, name);
  }

  return {
    id: cityId,
    name,
    country: '',
    lat: roundedLat,
    lng: roundedLng,
    pop: 1,
    isLocal: true,
  };
}
