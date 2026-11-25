import type { WeatherData } from '../types/weather';

export const WEATHER_CACHE_TTL_MS = 15 * 60 * 1000; // 15 dakika

const WEATHER_STORAGE_KEY = 'topog_weather_cache_v1';
const LOCAL_PLACE_STORAGE_KEY = 'topog_local_place_cache_v1';
const MAX_STORED_ENTRIES = 400;

const memoryCache = new Map<string, WeatherData>();
const localPlaceCache = new Map<string, string>();

let hydrated = false;

function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function hydrateFromStorage(now = Date.now()): void {
  if (hydrated) return;
  hydrated = true;
  if (!hasLocalStorage()) return;

  try {
    const rawWeather = window.localStorage.getItem(WEATHER_STORAGE_KEY);
    if (rawWeather) {
      const parsed = JSON.parse(rawWeather) as WeatherData[];
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (
            item &&
            typeof item.cityId === 'string' &&
            typeof item.fetchedAt === 'number' &&
            now - item.fetchedAt < WEATHER_CACHE_TTL_MS
          ) {
            memoryCache.set(item.cityId, item);
          }
        }
      }
    }
  } catch {
    // Ignore malformed storage
  }

  try {
    const rawPlaces = window.localStorage.getItem(LOCAL_PLACE_STORAGE_KEY);
    if (rawPlaces) {
      const parsed = JSON.parse(rawPlaces) as Record<string, string>;
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'string') localPlaceCache.set(k, v);
        }
      }
    }
  } catch {
    // Ignore malformed storage
  }
}

function persistWeatherToStorage(now = Date.now()): void {
  if (!hasLocalStorage()) return;

  try {
    const fresh: WeatherData[] = [];
    for (const [key, entry] of memoryCache.entries()) {
      if (now - entry.fetchedAt < WEATHER_CACHE_TTL_MS) {
        fresh.push(entry);
      } else {
        memoryCache.delete(key);
      }
    }

    fresh.sort((a, b) => b.fetchedAt - a.fetchedAt);
    const capped = fresh.slice(0, MAX_STORED_ENTRIES);
    window.localStorage.setItem(WEATHER_STORAGE_KEY, JSON.stringify(capped));
  } catch {
    // Storage quota exceeded or unavailable
  }
}

export function getFreshWeather(
  cityId: string,
  now = Date.now()
): WeatherData | null {
  hydrateFromStorage(now);
  const entry = memoryCache.get(cityId);
  if (!entry) return null;

  if (now - entry.fetchedAt < WEATHER_CACHE_TTL_MS) {
    return {
      ...entry,
      source: 'cache',
    };
  }

  // Süresi dolmuş veriyi bellekten temizle
  memoryCache.delete(cityId);
  persistWeatherToStorage(now);
  return null;
}

export function setWeatherEntries(
  entries: WeatherData[],
  now = Date.now()
): void {
  hydrateFromStorage(now);
  for (const entry of entries) {
    memoryCache.set(entry.cityId, entry);
  }
  persistWeatherToStorage(now);
}

export function invalidateCityWeather(cityId: string): void {
  hydrateFromStorage();
  if (memoryCache.delete(cityId)) {
    persistWeatherToStorage();
  }
}

export function clearWeatherCache(): void {
  hydrated = true;
  memoryCache.clear();
  if (hasLocalStorage()) {
    try {
      window.localStorage.removeItem(WEATHER_STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
}

export function getWeatherCacheCount(now = Date.now()): number {
  hydrateFromStorage(now);
  let count = 0;
  for (const [key, entry] of memoryCache.entries()) {
    if (now - entry.fetchedAt < WEATHER_CACHE_TTL_MS) {
      count += 1;
    } else {
      memoryCache.delete(key);
    }
  }
  return count;
}

export function getCachedLocalPlace(key: string): string | null {
  hydrateFromStorage();
  return localPlaceCache.get(key) ?? null;
}

export function setCachedLocalPlace(key: string, name: string): void {
  hydrateFromStorage();
  localPlaceCache.set(key, name);
  if (!hasLocalStorage()) return;

  try {
    const entries = Array.from(localPlaceCache.entries()).slice(-200);
    window.localStorage.setItem(
      LOCAL_PLACE_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(entries))
    );
  } catch {
    // Ignore
  }
}
