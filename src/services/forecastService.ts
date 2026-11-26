export interface HourlyForecastPoint {
  timeIso: string;
  hourLabel: string; // e.g. "14:00"
  temperature: number;
  precipProb: number | null;
  weatherCode: number | null;
}

export interface DailyForecastPoint {
  dateIso: string;
  dayLabel: string; // "Bugün", "Yarın", or Turkish short weekday ("Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz")
  tempMax: number;
  tempMin: number;
  precipProbMax: number | null;
  snowfallCm: number | null;
  weatherCode: number;
}

export interface WeatherForecastData {
  key: string;
  lat: number;
  lng: number;
  elevationMeters: number | null;
  hourly: HourlyForecastPoint[];
  daily: DailyForecastPoint[];
  fetchedAt: number;
  source: 'live' | 'cache';
}

export const FORECAST_CACHE_TTL_MS = 15 * 60 * 1000;

const FORECAST_STORAGE_KEY = 'topog_forecast_cache_v1';
const MAX_STORED_ENTRIES = 80;
const TURKISH_WEEKDAYS = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'] as const;

interface OpenMeteoForecastPayload {
  utc_offset_seconds?: number;
  hourly?: {
    time?: string[];
    temperature_2m?: Array<number | null>;
    precipitation_probability?: Array<number | null>;
    weather_code?: Array<number | null>;
  };
  daily?: {
    time?: string[];
    weather_code?: Array<number | null>;
    temperature_2m_max?: Array<number | null>;
    temperature_2m_min?: Array<number | null>;
    precipitation_probability_max?: Array<number | null>;
    snowfall_sum?: Array<number | null>;
  };
}

const memoryCache = new Map<string, WeatherForecastData>();
let hydrated = false;

function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function makeForecastKey(lat: number, lng: number, elevationMeters?: number): string {
  const elevSuffix =
    typeof elevationMeters === 'number' && Number.isFinite(elevationMeters)
      ? `:e${Math.round(elevationMeters)}`
      : '';
  return `fc:${lat.toFixed(2)},${lng.toFixed(2)}${elevSuffix}`;
}

function hydrateFromStorage(now = Date.now()): void {
  if (hydrated) return;
  hydrated = true;
  if (!hasLocalStorage()) return;

  try {
    const raw = window.localStorage.getItem(FORECAST_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as WeatherForecastData[];
    if (!Array.isArray(parsed)) return;

    for (const item of parsed) {
      if (
        item &&
        typeof item.key === 'string' &&
        typeof item.fetchedAt === 'number' &&
        Array.isArray(item.hourly) &&
        Array.isArray(item.daily) &&
        now - item.fetchedAt < FORECAST_CACHE_TTL_MS
      ) {
        memoryCache.set(item.key, item);
      }
    }
  } catch {
    // Ignore malformed storage
  }
}

function persistToStorage(now = Date.now()): void {
  if (!hasLocalStorage()) return;

  try {
    const fresh: WeatherForecastData[] = [];
    for (const [key, entry] of memoryCache.entries()) {
      if (now - entry.fetchedAt < FORECAST_CACHE_TTL_MS) {
        fresh.push(entry);
      } else {
        memoryCache.delete(key);
      }
    }

    fresh.sort((a, b) => b.fetchedAt - a.fetchedAt);
    const capped = fresh.slice(0, MAX_STORED_ENTRIES);

    if (memoryCache.size > MAX_STORED_ENTRIES) {
      const keepKeys = new Set(capped.map((e) => e.key));
      for (const key of memoryCache.keys()) {
        if (!keepKeys.has(key)) {
          memoryCache.delete(key);
        }
      }
    }

    window.localStorage.setItem(FORECAST_STORAGE_KEY, JSON.stringify(capped));
  } catch {
    // Storage quota exceeded or unavailable
  }
}

function getFreshForecast(key: string, now = Date.now()): WeatherForecastData | null {
  hydrateFromStorage(now);
  const entry = memoryCache.get(key);
  if (!entry) return null;

  if (now - entry.fetchedAt < FORECAST_CACHE_TTL_MS) {
    return {
      ...entry,
      source: 'cache',
    };
  }

  memoryCache.delete(key);
  persistToStorage(now);
  return null;
}

export function getForecastCacheCount(now = Date.now()): number {
  hydrateFromStorage(now);
  let count = 0;
  for (const [key, entry] of memoryCache.entries()) {
    if (now - entry.fetchedAt < FORECAST_CACHE_TTL_MS) {
      count += 1;
    } else {
      memoryCache.delete(key);
    }
  }
  return count;
}

export function clearForecastCache(): void {
  hydrated = true;
  memoryCache.clear();
  if (hasLocalStorage()) {
    try {
      window.localStorage.removeItem(FORECAST_STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
}

export function invalidateForecast(
  lat: number,
  lng: number,
  elevationMeters?: number
): void {
  hydrateFromStorage();
  const key = makeForecastKey(lat, lng, elevationMeters);
  if (memoryCache.delete(key)) {
    persistToStorage();
  }
}

function formatCurrentLocalHourIso(utcOffsetSeconds: number, nowMs = Date.now()): string {
  const localDate = new Date(nowMs + utcOffsetSeconds * 1000);
  const yyyy = localDate.getUTCFullYear();
  const mm = String(localDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(localDate.getUTCDate()).padStart(2, '0');
  const hh = String(localDate.getUTCHours()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:00`;
}

function formatDayLabel(dateIso: string, index: number): string {
  if (index === 0) return 'Bugün';
  if (index === 1) return 'Yarın';

  const parsed = new Date(`${dateIso}T12:00:00Z`);
  if (!Number.isNaN(parsed.getTime())) {
    return TURKISH_WEEKDAYS[parsed.getUTCDay()];
  }
  return dateIso.slice(5);
}

function parseHourlyPoints(
  payload: OpenMeteoForecastPayload,
  nowMs: number
): HourlyForecastPoint[] {
  const hourly = payload.hourly;
  if (!hourly || !Array.isArray(hourly.time) || !Array.isArray(hourly.temperature_2m)) {
    return [];
  }

  const times = hourly.time;
  const temps = hourly.temperature_2m;
  const precipProbs = hourly.precipitation_probability ?? [];
  const weatherCodes = hourly.weather_code ?? [];

  const utcOffsetSeconds =
    typeof payload.utc_offset_seconds === 'number' &&
    Number.isFinite(payload.utc_offset_seconds)
      ? payload.utc_offset_seconds
      : 0;

  const currentLocalIso = formatCurrentLocalHourIso(utcOffsetSeconds, nowMs);
  let startIdx = times.findIndex((t) => typeof t === 'string' && t >= currentLocalIso);
  if (startIdx < 0) {
    startIdx = 0;
  }

  const points: HourlyForecastPoint[] = [];
  const maxEnd = Math.min(times.length, startIdx + 24);

  for (let i = startIdx; i < maxEnd; i++) {
    const timeIso = times[i];
    const temp = temps[i];
    if (typeof timeIso !== 'string' || typeof temp !== 'number' || !Number.isFinite(temp)) {
      continue;
    }

    const hourPart = timeIso.length >= 16 ? timeIso.slice(11, 16) : timeIso;
    const rawProb = precipProbs[i];
    const rawCode = weatherCodes[i];

    points.push({
      timeIso,
      hourLabel: hourPart,
      temperature: temp,
      precipProb:
        typeof rawProb === 'number' && Number.isFinite(rawProb)
          ? Math.round(rawProb)
          : null,
      weatherCode:
        typeof rawCode === 'number' && Number.isFinite(rawCode) ? rawCode : null,
    });
  }

  return points;
}

function parseDailyPoints(payload: OpenMeteoForecastPayload): DailyForecastPoint[] {
  const daily = payload.daily;
  if (
    !daily ||
    !Array.isArray(daily.time) ||
    !Array.isArray(daily.temperature_2m_max) ||
    !Array.isArray(daily.temperature_2m_min) ||
    !Array.isArray(daily.weather_code)
  ) {
    return [];
  }

  const times = daily.time;
  const maxTemps = daily.temperature_2m_max;
  const minTemps = daily.temperature_2m_min;
  const codes = daily.weather_code;
  const precipMax = daily.precipitation_probability_max ?? [];
  const snowfall = daily.snowfall_sum ?? [];

  const points: DailyForecastPoint[] = [];
  const count = Math.min(times.length, 7);

  for (let i = 0; i < count; i++) {
    const dateIso = times[i];
    const tempMax = maxTemps[i];
    const tempMin = minTemps[i];
    const code = codes[i];

    if (
      typeof dateIso !== 'string' ||
      typeof tempMax !== 'number' ||
      !Number.isFinite(tempMax) ||
      typeof tempMin !== 'number' ||
      !Number.isFinite(tempMin) ||
      typeof code !== 'number' ||
      !Number.isFinite(code)
    ) {
      continue;
    }

    const rawProb = precipMax[i];
    const rawSnow = snowfall[i];

    points.push({
      dateIso,
      dayLabel: formatDayLabel(dateIso, i),
      tempMax,
      tempMin,
      precipProbMax:
        typeof rawProb === 'number' && Number.isFinite(rawProb)
          ? Math.round(rawProb)
          : null,
      snowfallCm:
        typeof rawSnow === 'number' && Number.isFinite(rawSnow)
          ? Math.round(rawSnow * 10) / 10
          : null,
      weatherCode: code,
    });
  }

  return points;
}

export async function fetchWeatherForecast(
  lat: number,
  lng: number,
  options?: { elevationMeters?: number; forceRefresh?: boolean; signal?: AbortSignal }
): Promise<WeatherForecastData | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  const elevationMeters =
    typeof options?.elevationMeters === 'number' &&
    Number.isFinite(options.elevationMeters)
      ? Math.round(options.elevationMeters)
      : null;

  const key = makeForecastKey(lat, lng, elevationMeters ?? undefined);
  const now = Date.now();

  if (!options?.forceRefresh) {
    const cached = getFreshForecast(key, now);
    if (cached) {
      return cached;
    }
  }

  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
    `&hourly=temperature_2m,precipitation_probability,weather_code` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,snowfall_sum` +
    `&timezone=auto&forecast_days=7` +
    (elevationMeters !== null ? `&elevation=${elevationMeters}` : '');

  try {
    const response = await fetch(url, {
      signal: options?.signal,
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      return null;
    }

    const raw = (await response.json()) as OpenMeteoForecastPayload;
    const fetchedAt = Date.now();
    const hourly = parseHourlyPoints(raw, fetchedAt);
    const daily = parseDailyPoints(raw);

    if (hourly.length === 0 && daily.length === 0) {
      return null;
    }

    const data: WeatherForecastData = {
      key,
      lat,
      lng,
      elevationMeters,
      hourly,
      daily,
      fetchedAt,
      source: 'live',
    };

    hydrateFromStorage(fetchedAt);
    memoryCache.set(key, data);
    persistToStorage(fetchedAt);

    return data;
  } catch (err) {
    if (
      options?.signal?.aborted ||
      (err instanceof DOMException && err.name === 'AbortError')
    ) {
      throw err;
    }
    return null;
  }
}
