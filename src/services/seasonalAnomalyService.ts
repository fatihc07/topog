import type { ViewportBounds } from '../types/weather';

export interface SeasonalAnomalyData {
  key: string;
  lat: number;
  lng: number;
  todayMean: number;
  seasonalNormal: number;
  anomaly: number;
  fetchedAt: number;
  source: 'live' | 'cache';
}

export interface AnomalyGridResult {
  bounds: [number, number, number, number]; // [west, south, east, north]
  imageUrl: string;
  pointCount: number;
  fromCacheCount: number;
  fetchedCount: number;
  extraAnomalies: Record<string, SeasonalAnomalyData>;
}

export const ANOMALY_CACHE_TTL_MS = 15 * 60 * 1000; // 15 dakika

const ANOMALY_STORAGE_KEY = 'topog_anomaly_cache_v1';
const MAX_STORED_ENTRIES = 300;
const BASELINE_YEARS = [1996, 2004, 2012, 2020] as const;
const WINDOW_HALF_DAYS = 5;
const MAX_POINTS_PER_BATCH = 50;
const ARCHIVE_SPACING_MS = 200;
const ARCHIVE_RETRY_DELAY_MS = 900;

const memoryCache = new Map<string, SeasonalAnomalyData>();
let hydrated = false;
let archiveQueueTail: Promise<void> = Promise.resolve();
let lastArchiveStartMs = 0;

interface OpenMeteoDailyMeanResponse {
  daily?: {
    time?: string[];
    temperature_2m_mean?: Array<number | null>;
  };
}

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
    const raw = window.localStorage.getItem(ANOMALY_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as SeasonalAnomalyData[];
    if (!Array.isArray(parsed)) return;

    for (const item of parsed) {
      if (
        item &&
        typeof item.key === 'string' &&
        typeof item.todayMean === 'number' &&
        typeof item.seasonalNormal === 'number' &&
        typeof item.anomaly === 'number' &&
        typeof item.fetchedAt === 'number' &&
        now - item.fetchedAt < ANOMALY_CACHE_TTL_MS
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
    const fresh: SeasonalAnomalyData[] = [];
    for (const [k, entry] of memoryCache.entries()) {
      if (now - entry.fetchedAt < ANOMALY_CACHE_TTL_MS) {
        fresh.push(entry);
      } else {
        memoryCache.delete(k);
      }
    }
    fresh.sort((a, b) => b.fetchedAt - a.fetchedAt);
    window.localStorage.setItem(
      ANOMALY_STORAGE_KEY,
      JSON.stringify(fresh.slice(0, MAX_STORED_ENTRIES))
    );
  } catch {
    // Storage quota exceeded or unavailable
  }
}

function formatDateIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function makeAnomalyCacheKey(
  lat: number,
  lng: number,
  dateStr = formatDateIso(new Date())
): string {
  return `${lat.toFixed(2)},${lng.toFixed(2)},${dateStr}`;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function getHistoricalWindowForYear(
  year: number,
  refDate: Date
): { startDate: string; endDate: string } {
  const month = refDate.getMonth();
  const rawDay = refDate.getDate();
  const safeDay = month === 1 && rawDay === 29 && !isLeapYear(year) ? 28 : rawDay;

  const center = new Date(Date.UTC(year, month, safeDay));
  const start = new Date(center);
  start.setUTCDate(start.getUTCDate() - WINDOW_HALF_DAYS);
  const end = new Date(center);
  end.setUTCDate(end.getUTCDate() + WINDOW_HALF_DAYS);

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

export function getAnomalyCacheCount(now = Date.now()): number {
  hydrateFromStorage(now);
  let count = 0;
  for (const [k, entry] of memoryCache.entries()) {
    if (now - entry.fetchedAt < ANOMALY_CACHE_TTL_MS) {
      count += 1;
    } else {
      memoryCache.delete(k);
    }
  }
  return count;
}

export function clearAnomalyCache(): void {
  hydrated = true;
  memoryCache.clear();
  if (hasLocalStorage()) {
    try {
      window.localStorage.removeItem(ANOMALY_STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
}

export function getFreshAnomaly(
  lat: number,
  lng: number,
  dateStr = formatDateIso(new Date()),
  now = Date.now()
): SeasonalAnomalyData | null {
  hydrateFromStorage(now);
  const key = makeAnomalyCacheKey(lat, lng, dateStr);
  const entry = memoryCache.get(key);
  if (!entry) return null;

  if (now - entry.fetchedAt < ANOMALY_CACHE_TTL_MS) {
    return { ...entry, source: 'cache' };
  }

  memoryCache.delete(key);
  persistToStorage(now);
  return null;
}

function unwrapBatchResponse(
  raw: OpenMeteoDailyMeanResponse | OpenMeteoDailyMeanResponse[]
): OpenMeteoDailyMeanResponse[] {
  return Array.isArray(raw) ? raw : [raw];
}

function waitMs(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function fetchArchiveWithRateLimit(
  url: string,
  signal?: AbortSignal
): Promise<OpenMeteoDailyMeanResponse[]> {
  const run = async (): Promise<OpenMeteoDailyMeanResponse[]> => {
    const now = Date.now();
    const waitNeeded = ARCHIVE_SPACING_MS - (now - lastArchiveStartMs);
    if (waitNeeded > 0) {
      await waitMs(waitNeeded, signal);
    }
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    lastArchiveStartMs = Date.now();

    let res = await fetch(url, {
      signal,
      headers: { Accept: 'application/json' },
    });

    if (res.status === 429) {
      await waitMs(ARCHIVE_RETRY_DELAY_MS, signal);
      lastArchiveStartMs = Date.now();
      res = await fetch(url, {
        signal,
        headers: { Accept: 'application/json' },
      });
    }

    if (!res.ok) {
      throw new Error(`Open-Meteo Archive HTTP ${res.status}`);
    }

    const json = (await res.json()) as
      | OpenMeteoDailyMeanResponse
      | OpenMeteoDailyMeanResponse[];
    return unwrapBatchResponse(json);
  };

  const task = archiveQueueTail.then(run, run);
  archiveQueueTail = task.then(
    () => undefined,
    () => undefined
  );
  return task;
}

async function fetchAnomalyBatch(
  batch: Array<{ key: string; lat: number; lng: number }>,
  refDate: Date,
  signal?: AbortSignal
): Promise<SeasonalAnomalyData[]> {
  if (batch.length === 0) return [];

  const latitudes = batch.map((p) => p.lat.toFixed(4)).join(',');
  const longitudes = batch.map((p) => p.lng.toFixed(4)).join(',');

  const forecastUrl =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${latitudes}&longitude=${longitudes}` +
    `&daily=temperature_2m_mean&forecast_days=1&timezone=auto`;

  const archivePromises = BASELINE_YEARS.map((year) => {
    const { startDate, endDate } = getHistoricalWindowForYear(year, refDate);
    const url =
      `https://archive-api.open-meteo.com/v1/archive` +
      `?latitude=${latitudes}&longitude=${longitudes}` +
      `&start_date=${startDate}&end_date=${endDate}&daily=temperature_2m_mean`;
    return fetchArchiveWithRateLimit(url, signal);
  });

  const forecastPromise = (async () => {
    const res = await fetch(forecastUrl, {
      signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`Open-Meteo Forecast HTTP ${res.status}`);
    }
    const json = (await res.json()) as
      | OpenMeteoDailyMeanResponse
      | OpenMeteoDailyMeanResponse[];
    return unwrapBatchResponse(json);
  })();

  const [forecastList, archiveSettled] = await Promise.all([
    forecastPromise,
    Promise.allSettled(archivePromises),
  ]);

  if (signal?.aborted) return [];

  const archiveYearsLists: OpenMeteoDailyMeanResponse[][] = [];
  for (const outcome of archiveSettled) {
    if (outcome.status === 'fulfilled') {
      archiveYearsLists.push(outcome.value);
    }
  }

  if (archiveYearsLists.length === 0) {
    return [];
  }

  const fetchedAt = Date.now();
  const results: SeasonalAnomalyData[] = [];

  for (let i = 0; i < batch.length; i++) {
    const pt = batch[i];
    const todayVal = forecastList[i]?.daily?.temperature_2m_mean?.[0];
    if (typeof todayVal !== 'number' || !Number.isFinite(todayVal)) {
      continue;
    }

    let sum = 0;
    let count = 0;
    for (const yearList of archiveYearsLists) {
      const vals = yearList[i]?.daily?.temperature_2m_mean;
      if (!Array.isArray(vals)) continue;
      for (const v of vals) {
        if (typeof v === 'number' && Number.isFinite(v)) {
          sum += v;
          count += 1;
        }
      }
    }

    if (count < 10) {
      continue;
    }

    const seasonalNormal = Math.round((sum / count) * 10) / 10;
    const todayMean = Math.round(todayVal * 10) / 10;
    const anomaly = Math.round((todayMean - seasonalNormal) * 10) / 10;

    results.push({
      key: pt.key,
      lat: pt.lat,
      lng: pt.lng,
      todayMean,
      seasonalNormal,
      anomaly,
      fetchedAt,
      source: 'live',
    });
  }

  return results;
}

export async function fetchSeasonalAnomalies(
  points: Array<{ id?: string; lat: number; lng: number }>,
  options?: { forceRefresh?: boolean; signal?: AbortSignal }
): Promise<{
  map: Map<string, SeasonalAnomalyData>;
  fromCacheCount: number;
  fetchedCount: number;
}> {
  const resultMap = new Map<string, SeasonalAnomalyData>();
  if (points.length === 0) {
    return { map: resultMap, fromCacheCount: 0, fetchedCount: 0 };
  }

  const now = Date.now();
  const refDate = new Date(now);
  const dateStr = formatDateIso(refDate);
  const forceRefresh = options?.forceRefresh ?? false;

  const missingMap = new Map<string, { key: string; lat: number; lng: number }>();
  const idToCacheKey = new Map<string, string>();
  let fromCacheCount = 0;

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    const outKey = pt.id ?? makeAnomalyCacheKey(pt.lat, pt.lng, dateStr);
    const cacheKey = makeAnomalyCacheKey(pt.lat, pt.lng, dateStr);
    idToCacheKey.set(outKey, cacheKey);

    if (!forceRefresh) {
      const cached = getFreshAnomaly(pt.lat, pt.lng, dateStr, now);
      if (cached) {
        resultMap.set(outKey, cached);
        fromCacheCount += 1;
        continue;
      }
    }

    if (!missingMap.has(cacheKey)) {
      missingMap.set(cacheKey, { key: cacheKey, lat: pt.lat, lng: pt.lng });
    }
  }

  const missingList = Array.from(missingMap.values());
  const freshlyFetched = new Map<string, SeasonalAnomalyData>();

  for (let start = 0; start < missingList.length; start += MAX_POINTS_PER_BATCH) {
    if (options?.signal?.aborted) break;
    const chunk = missingList.slice(start, start + MAX_POINTS_PER_BATCH);
    const chunkItems = await fetchAnomalyBatch(chunk, refDate, options?.signal);
    for (const item of chunkItems) {
      memoryCache.set(item.key, item);
      freshlyFetched.set(item.key, item);
    }
  }

  if (freshlyFetched.size > 0) {
    persistToStorage(Date.now());
  }

  for (const [outKey, cacheKey] of idToCacheKey.entries()) {
    if (resultMap.has(outKey)) continue;
    const fetchedItem = freshlyFetched.get(cacheKey);
    if (fetchedItem) {
      resultMap.set(outKey, fetchedItem);
    }
  }

  return {
    map: resultMap,
    fromCacheCount,
    fetchedCount: freshlyFetched.size,
  };
}

const ANOMALY_COLOR_STOPS: ReadonlyArray<{
  val: number;
  rgb: [number, number, number];
}> = [
  { val: -8, rgb: [8, 48, 168] },
  { val: -6, rgb: [21, 101, 216] },
  { val: -4, rgb: [31, 162, 240] },
  { val: -2, rgb: [95, 217, 245] },
  { val: 0, rgb: [40, 184, 107] },
  { val: 2, rgb: [244, 208, 63] },
  { val: 4, rgb: [245, 138, 31] },
  { val: 6, rgb: [229, 57, 53] },
  { val: 8, rgb: [155, 17, 30] },
];

export function getAnomalyColorRgb(anomaly: number): [number, number, number] {
  if (!Number.isFinite(anomaly)) return [40, 184, 107];
  if (anomaly <= ANOMALY_COLOR_STOPS[0].val) {
    return ANOMALY_COLOR_STOPS[0].rgb;
  }
  const last = ANOMALY_COLOR_STOPS[ANOMALY_COLOR_STOPS.length - 1];
  if (anomaly >= last.val) {
    return last.rgb;
  }

  for (let i = 0; i < ANOMALY_COLOR_STOPS.length - 1; i++) {
    const a = ANOMALY_COLOR_STOPS[i];
    const b = ANOMALY_COLOR_STOPS[i + 1];
    if (anomaly >= a.val && anomaly <= b.val) {
      const t = (anomaly - a.val) / (b.val - a.val);
      return [
        Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * t),
        Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * t),
        Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * t),
      ];
    }
  }
  return [40, 184, 107];
}

export function getAnomalyBadgePalette(anomaly: number): {
  bg: string;
  border: string;
  text: string;
  label: string;
} {
  if (anomaly <= -4) {
    return {
      bg: '#1554c7',
      border: '#60a5fa',
      text: '#ffffff',
      label: 'Normalin Çok Altında',
    };
  }
  if (anomaly < -1) {
    return {
      bg: '#1d7be0',
      border: '#7dd3fc',
      text: '#ffffff',
      label: 'Normalin Altında',
    };
  }
  if (anomaly <= 1) {
    return {
      bg: '#159457',
      border: '#6ee7b7',
      text: '#ffffff',
      label: 'Mevsim Normalinde',
    };
  }
  if (anomaly < 4) {
    return {
      bg: '#d97706',
      border: '#fcd34d',
      text: '#ffffff',
      label: 'Normalin Üstünde',
    };
  }
  return {
    bg: '#dc2626',
    border: '#fca5a5',
    text: '#ffffff',
    label: 'Normalin Çok Üstünde',
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export async function fetchViewportAnomalyGrid(
  bounds: ViewportBounds,
  signal?: AbortSignal,
  extraPoints?: Array<{ id: string; lat: number; lng: number }>
): Promise<AnomalyGridResult | null> {
  const rawLatSpan = Math.max(2, bounds.north - bounds.south);
  const padLat = Math.min(4, rawLatSpan * 0.14);
  const south = clamp(bounds.south - padLat, -80, 76);
  const north = clamp(bounds.north + padLat, -76, 80);
  if (north - south < 0.5) return null;

  const rawLngSpan = Math.max(2, Math.min(156, bounds.east - bounds.west));
  const padLng = Math.min(6, rawLngSpan * 0.14);
  const halfLngSpan = Math.min(79, (rawLngSpan + padLng * 2) * 0.5);

  let centerLng = bounds.centerLng;
  while (centerLng > 180) centerLng -= 360;
  while (centerLng < -180) centerLng += 360;

  let west = centerLng - halfLngSpan;
  let east = centerLng + halfLngSpan;
  if (west < -179) {
    east += -179 - west;
    west = -179;
  }
  if (east > 179) {
    west -= east - 179;
    east = 179;
  }
  west = clamp(west, -179, 177);
  east = clamp(east, -177, 179);

  const COLS = 7;
  const ROWS = 5;
  const gridPoints: Array<{ id: string; row: number; col: number; lat: number; lng: number }> =
    [];

  for (let r = 0; r < ROWS; r++) {
    // Row 0 is north, row ROWS-1 is south to align directly with canvas top->bottom Y
    const lat = north - (r / (ROWS - 1)) * (north - south);
    for (let c = 0; c < COLS; c++) {
      const lng = west + (c / (COLS - 1)) * (east - west);
      gridPoints.push({
        id: `grid:${r}:${c}`,
        row: r,
        col: c,
        lat,
        lng,
      });
    }
  }

  const combinedInput: Array<{ id: string; lat: number; lng: number }> = gridPoints.map(
    (g) => ({ id: g.id, lat: g.lat, lng: g.lng })
  );
  if (extraPoints && extraPoints.length > 0) {
    for (const ep of extraPoints.slice(0, 15)) {
      combinedInput.push({ id: `extra:${ep.id}`, lat: ep.lat, lng: ep.lng });
    }
  }

  const fetched = await fetchSeasonalAnomalies(combinedInput, { signal });
  if (signal?.aborted) return null;

  const extraAnomalies: Record<string, SeasonalAnomalyData> = {};
  if (extraPoints && extraPoints.length > 0) {
    for (const ep of extraPoints.slice(0, 15)) {
      const hit = fetched.map.get(`extra:${ep.id}`);
      if (hit) extraAnomalies[ep.id] = hit;
    }
  }

  const validVals: Array<number | null> = new Array(ROWS * COLS).fill(null);
  let validCount = 0;
  for (const g of gridPoints) {
    const item = fetched.map.get(g.id);
    if (item && Number.isFinite(item.anomaly)) {
      validVals[g.row * COLS + g.col] = item.anomaly;
      validCount += 1;
    }
  }

  if (validCount < 10) return null;

  // Fill any sparse missing cell with nearest valid neighbor so bilinear interpolation never produces black holes
  const grid: number[][] = Array.from({ length: ROWS }, () =>
    new Array<number>(COLS).fill(0)
  );
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const direct = validVals[r * COLS + c];
      if (direct !== null) {
        grid[r][c] = direct;
        continue;
      }
      let bestDist = Infinity;
      let bestVal = 0;
      for (let rr = 0; rr < ROWS; rr++) {
        for (let cc = 0; cc < COLS; cc++) {
          const candidate = validVals[rr * COLS + cc];
          if (candidate === null) continue;
          const d = (rr - r) * (rr - r) + (cc - c) * (cc - c);
          if (d < bestDist) {
            bestDist = d;
            bestVal = candidate;
          }
        }
      }
      grid[r][c] = bestVal;
    }
  }

  if (typeof document === 'undefined') return null;

  const W = 256;
  const H = 160;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const imgData = ctx.createImageData(W, H);
  const data = imgData.data;

  for (let py = 0; py < H; py++) {
    const gy = (py / (H - 1)) * (ROWS - 1);
    const r0 = Math.min(ROWS - 2, Math.floor(gy));
    const ty = gy - r0;

    for (let px = 0; px < W; px++) {
      const gx = (px / (W - 1)) * (COLS - 1);
      const c0 = Math.min(COLS - 2, Math.floor(gx));
      const tx = gx - c0;

      const v00 = grid[r0][c0];
      const v10 = grid[r0][c0 + 1];
      const v01 = grid[r0 + 1][c0];
      const v11 = grid[r0 + 1][c0 + 1];

      const smoothVal =
        v00 * (1 - tx) * (1 - ty) +
        v10 * tx * (1 - ty) +
        v01 * (1 - tx) * ty +
        v11 * tx * ty;

      // Blend smooth gradient with subtle 2°C isotherm bands for clear TV-style weather map readability
      const steppedVal = Math.round(smoothVal / 2) * 2;
      const blendedVal = smoothVal * 0.7 + steppedVal * 0.3;

      const [r, g, b] = getAnomalyColorRgb(blendedVal);
      const idx = (py * W + px) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 215;
    }
  }

  ctx.putImageData(imgData, 0, 0);

  return {
    bounds: [west, south, east, north],
    imageUrl: canvas.toDataURL('image/png'),
    pointCount: validCount,
    fromCacheCount: fetched.fromCacheCount,
    fetchedCount: fetched.fetchedCount,
    extraAnomalies,
  };
}
