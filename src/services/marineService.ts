export interface MarineData {
  key: string;
  lat: number;
  lng: number;
  seaTempC: number | null;
  waveHeightM: number | null;
  wavePeriodS: number | null;
  waveDirectionDeg: number | null;
  fetchedAt: number;
  source: 'live' | 'cache';
}

export const MARINE_CACHE_TTL_MS = 15 * 60 * 1000; // 15 dakika

const MARINE_STORAGE_KEY = 'topog_marine_cache_v1';
const MAX_STORED_ENTRIES = 200;
const COMPASS_POINTS = ['K', 'KD', 'D', 'GD', 'G', 'GB', 'B', 'KB'] as const;

const memoryCache = new Map<string, MarineData>();
let hydrated = false;

interface OpenMeteoMarineCurrent {
  wave_height?: unknown;
  wave_direction?: unknown;
  wave_period?: unknown;
  sea_surface_temperature?: unknown;
}

interface OpenMeteoMarineResponse {
  current?: OpenMeteoMarineCurrent;
}

function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function makeMarineKey(lat: number, lng: number): string {
  return `marine:${lat.toFixed(2)},${lng.toFixed(2)}`;
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function hydrateFromStorage(now = Date.now()): void {
  if (hydrated) return;
  hydrated = true;
  if (!hasLocalStorage()) return;

  try {
    const raw = window.localStorage.getItem(MARINE_STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw) as MarineData[];
    if (!Array.isArray(parsed)) return;

    for (const item of parsed) {
      if (
        item &&
        typeof item.key === 'string' &&
        typeof item.lat === 'number' &&
        typeof item.lng === 'number' &&
        typeof item.fetchedAt === 'number' &&
        now - item.fetchedAt < MARINE_CACHE_TTL_MS
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
    const fresh: MarineData[] = [];
    for (const [key, entry] of memoryCache.entries()) {
      if (now - entry.fetchedAt < MARINE_CACHE_TTL_MS) {
        fresh.push(entry);
      } else {
        memoryCache.delete(key);
      }
    }

    fresh.sort((a, b) => b.fetchedAt - a.fetchedAt);
    const capped = fresh.slice(0, MAX_STORED_ENTRIES);
    window.localStorage.setItem(MARINE_STORAGE_KEY, JSON.stringify(capped));
  } catch {
    // Storage quota exceeded or unavailable
  }
}

export function formatWaveDirection(deg: number): string {
  if (!Number.isFinite(deg)) return '—';
  const normalized = ((deg % 360) + 360) % 360;
  const index = Math.round(normalized / 45) % COMPASS_POINTS.length;
  return COMPASS_POINTS[index];
}

export function getMarineCacheCount(): number {
  const now = Date.now();
  hydrateFromStorage(now);
  let count = 0;
  for (const [key, entry] of memoryCache.entries()) {
    if (now - entry.fetchedAt < MARINE_CACHE_TTL_MS) {
      count += 1;
    } else {
      memoryCache.delete(key);
    }
  }
  return count;
}

export function clearMarineCache(): void {
  hydrated = true;
  memoryCache.clear();
  if (hasLocalStorage()) {
    try {
      window.localStorage.removeItem(MARINE_STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
}

export async function fetchMarineData(
  lat: number,
  lng: number,
  signal?: AbortSignal
): Promise<MarineData | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  const now = Date.now();
  hydrateFromStorage(now);

  const key = makeMarineKey(lat, lng);
  const cached = memoryCache.get(key);
  if (cached) {
    if (now - cached.fetchedAt < MARINE_CACHE_TTL_MS) {
      return {
        ...cached,
        source: 'cache',
      };
    }
    memoryCache.delete(key);
    persistToStorage(now);
  }

  const url =
    `https://marine-api.open-meteo.com/v1/marine` +
    `?latitude=${lat.toFixed(4)}` +
    `&longitude=${lng.toFixed(4)}` +
    `&current=wave_height,wave_direction,wave_period,sea_surface_temperature`;

  const response = await fetch(url, {
    signal,
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Open-Meteo Marine HTTP ${response.status}`);
  }

  const raw = (await response.json()) as OpenMeteoMarineResponse;
  const current = raw?.current;

  const seaTempC = toFiniteNumber(current?.sea_surface_temperature);
  const waveHeightM = toFiniteNumber(current?.wave_height);
  const wavePeriodS = toFiniteNumber(current?.wave_period);
  const waveDirectionDeg = toFiniteNumber(current?.wave_direction);

  // Strict rule: never fabricate marine data for inland/non-marine coordinates.
  if (seaTempC === null && waveHeightM === null) {
    return null;
  }

  const fetchedAt = Date.now();
  const entry: MarineData = {
    key,
    lat,
    lng,
    seaTempC,
    waveHeightM,
    wavePeriodS,
    waveDirectionDeg,
    fetchedAt,
    source: 'live',
  };

  memoryCache.set(key, entry);
  persistToStorage(fetchedAt);

  return entry;
}

export async function fetchMarineBatch(
  points: Array<{ id: string; lat: number; lng: number }>,
  options?: { forceRefresh?: boolean; signal?: AbortSignal }
): Promise<{
  results: Map<string, MarineData>;
  fromCacheCount: number;
  fetchedCount: number;
}> {
  const results = new Map<string, MarineData>();
  if (points.length === 0) {
    return { results, fromCacheCount: 0, fetchedCount: 0 };
  }

  const now = Date.now();
  hydrateFromStorage(now);

  const forceRefresh = options?.forceRefresh ?? false;
  const missing: Array<{ id: string; lat: number; lng: number; key: string }> = [];
  let fromCacheCount = 0;
  let evictedAny = false;

  for (const point of points) {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
      continue;
    }

    const key = makeMarineKey(point.lat, point.lng);
    if (!forceRefresh) {
      const cached = memoryCache.get(key);
      if (cached) {
        if (now - cached.fetchedAt < MARINE_CACHE_TTL_MS) {
          results.set(point.id, {
            ...cached,
            source: 'cache',
          });
          fromCacheCount += 1;
          continue;
        }
        memoryCache.delete(key);
        evictedAny = true;
      }
    }

    missing.push({ ...point, key });
  }

  let fetchedCount = 0;

  if (missing.length > 0) {
    try {
      const lats = missing.map((p) => p.lat.toFixed(4)).join(',');
      const lngs = missing.map((p) => p.lng.toFixed(4)).join(',');
      const url =
        `https://marine-api.open-meteo.com/v1/marine` +
        `?latitude=${lats}` +
        `&longitude=${lngs}` +
        `&current=wave_height,wave_direction,wave_period,sea_surface_temperature`;

      const response = await fetch(url, {
        signal: options?.signal,
        headers: { Accept: 'application/json' },
      });

      if (response.ok) {
        const raw = (await response.json()) as
          | OpenMeteoMarineResponse
          | OpenMeteoMarineResponse[];
        // Open-Meteo returns an object for 1 coordinate and an array for 2+ coordinates
        const list = Array.isArray(raw) ? raw : [raw];
        const fetchedAt = Date.now();
        let wroteAny = false;

        for (let i = 0; i < missing.length; i++) {
          const point = missing[i];
          const current = list[i]?.current;

          const seaTempC = toFiniteNumber(current?.sea_surface_temperature);
          const waveHeightM = toFiniteNumber(current?.wave_height);
          const wavePeriodS = toFiniteNumber(current?.wave_period);
          const waveDirectionDeg = toFiniteNumber(current?.wave_direction);

          // Strict rule: never fabricate marine data for inland/non-marine coordinates.
          if (seaTempC === null && waveHeightM === null) {
            continue;
          }

          const entry: MarineData = {
            key: point.key,
            lat: point.lat,
            lng: point.lng,
            seaTempC,
            waveHeightM,
            wavePeriodS,
            waveDirectionDeg,
            fetchedAt,
            source: 'live',
          };

          memoryCache.set(point.key, entry);
          results.set(point.id, entry);
          fetchedCount += 1;
          wroteAny = true;
        }

        if (wroteAny || evictedAny) {
          persistToStorage(fetchedAt);
        }
      } else if (evictedAny) {
        persistToStorage(now);
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      if (evictedAny) {
        persistToStorage(now);
      }
      // On transient failure, return any cached results without fabricating data
    }
  } else if (evictedAny) {
    persistToStorage(now);
  }

  return {
    results,
    fromCacheCount,
    fetchedCount,
  };
}
