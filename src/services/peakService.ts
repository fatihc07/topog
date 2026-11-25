import rawPeaks from '../data/worldPeaks.json';
import {
  WEATHER_CACHE_TTL_MS,
  getFreshWeather,
  setWeatherEntries,
} from './weatherCache';
import type {
  PeakDisplayItem,
  PeakRecord,
  ViewportBounds,
  WeatherData,
} from '../types/weather';

type PeakTuple = [string, string, string, number, number, number];

export const PEAKS_MIN_ZOOM = 5.0;
export const OVERPASS_PEAKS_MIN_ZOOM = 9.5;

const LOCAL_PEAKS: PeakRecord[] = (rawPeaks as PeakTuple[])
  .map(([id, name, country, lat, lng, elevation]) => ({
    id,
    name,
    country,
    lat,
    lng,
    elevation,
  }))
  .sort((a, b) => b.elevation - a.elevation);

const overpassTileCache = new Map<
  string,
  { fetchedAt: number; peaks: PeakRecord[] }
>();

function isLngInBounds(lng: number, west: number, east: number): boolean {
  if (west <= east) return lng >= west && lng <= east;
  return lng >= west || lng <= east;
}

export function getVisibleLocalPeaks(bounds: ViewportBounds): PeakRecord[] {
  if (bounds.zoom < PEAKS_MIN_ZOOM) return [];

  return LOCAL_PEAKS.filter(
    (p) =>
      p.lat >= bounds.south &&
      p.lat <= bounds.north &&
      isLngInBounds(p.lng, bounds.west, bounds.east)
  );
}

export async function fetchOverpassPeaks(
  bounds: ViewportBounds,
  signal?: AbortSignal
): Promise<PeakRecord[]> {
  if (bounds.zoom < OVERPASS_PEAKS_MIN_ZOOM) return [];
  const latSpan = bounds.north - bounds.south;
  const lngSpan =
    bounds.west <= bounds.east
      ? bounds.east - bounds.west
      : 360 - bounds.west + bounds.east;
  if (latSpan > 2.5 || lngSpan > 3.5) return [];

  const tileKey = [
    Math.round(bounds.south * 4),
    Math.round(bounds.west * 4),
    Math.round(bounds.north * 4),
    Math.round(bounds.east * 4),
  ].join(':');

  const now = Date.now();
  const cached = overpassTileCache.get(tileKey);
  if (cached && now - cached.fetchedAt < WEATHER_CACHE_TTL_MS) {
    return cached.peaks;
  }

  try {
    const query = `[out:json][timeout:4];node["natural"="peak"]["name"]["ele"](${bounds.south.toFixed(
      4
    )},${bounds.west.toFixed(4)},${bounds.north.toFixed(
      4
    )},${bounds.east.toFixed(4)});out body 40;`;

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: `data=${encodeURIComponent(query)}`,
    });

    if (!response.ok) return [];
    const data = (await response.json()) as {
      elements?: Array<{
        id: number;
        lat: number;
        lon: number;
        tags?: Record<string, string>;
      }>;
    };

    const parsed: PeakRecord[] = [];
    for (const el of data.elements || []) {
      const name = el.tags?.name?.trim();
      const rawEle = el.tags?.ele?.replace(',', '.');
      if (!name || !rawEle) continue;
      const match = rawEle.match(/-?\d+(\.\d+)?/);
      if (!match) continue;
      const ele = Math.round(parseFloat(match[0]));
      if (!Number.isFinite(ele) || ele < 300 || ele > 9000) continue;

      parsed.push({
        id: `osm-${el.id}`,
        name,
        country: '',
        lat: Math.round(el.lat * 1000) / 1000,
        lng: Math.round(el.lon * 1000) / 1000,
        elevation: ele,
      });
    }

    parsed.sort((a, b) => b.elevation - a.elevation);
    overpassTileCache.set(tileKey, { fetchedAt: now, peaks: parsed });
    return parsed;
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    return [];
  }
}

export function selectNonOverlappingPeaks(
  candidates: PeakRecord[],
  zoom: number,
  maxCount = 8
): PeakRecord[] {
  const sorted = [...candidates].sort((a, b) => b.elevation - a.elevation);
  const dedupSq = 0.015 * 0.015;
  const minDistDeg = 28 / Math.pow(2, zoom);
  const minDistSq = Math.max(dedupSq, minDistDeg * minDistDeg);

  const selected: PeakRecord[] = [];
  for (const peak of sorted) {
    let tooClose = false;
    for (const existing of selected) {
      const dLat = peak.lat - existing.lat;
      const dLng = peak.lng - existing.lng;
      if (dLat * dLat + dLng * dLng < minDistSq) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) {
      selected.push(peak);
      if (selected.length >= maxCount) break;
    }
  }
  return selected;
}

interface OpenMeteoCurrentBlock {
  temperature_2m?: number;
  apparent_temperature?: number;
  relative_humidity_2m?: number;
  weather_code?: number;
  wind_speed_10m?: number;
  surface_pressure?: number;
  is_day?: number;
  snow_depth?: number;
  snowfall?: number;
}

interface OpenMeteoForecastResponse {
  current?: OpenMeteoCurrentBlock;
}

export function getPeakCacheId(peakId: string): string {
  return `peak:${peakId}`;
}

export async function fetchPeakWeatherBatch(
  peaks: PeakRecord[],
  options?: { forceRefresh?: boolean; signal?: AbortSignal }
): Promise<{
  items: PeakDisplayItem[];
  fromCacheCount: number;
  fetchedCount: number;
}> {
  if (peaks.length === 0) {
    return { items: [], fromCacheCount: 0, fetchedCount: 0 };
  }

  const now = Date.now();
  const forceRefresh = options?.forceRefresh ?? false;
  const weatherByPeakId = new Map<string, WeatherData>();
  const missing: PeakRecord[] = [];
  let fromCacheCount = 0;

  for (const peak of peaks) {
    const cacheId = getPeakCacheId(peak.id);
    if (!forceRefresh) {
      const cached = getFreshWeather(cacheId, now);
      if (cached && cached.snowDepthCm !== undefined) {
        weatherByPeakId.set(peak.id, cached);
        fromCacheCount += 1;
        continue;
      }
    }
    missing.push(peak);
  }

  let fetchedCount = 0;

  if (missing.length > 0) {
    try {
      const lats = missing.map((p) => p.lat.toFixed(4)).join(',');
      const lngs = missing.map((p) => p.lng.toFixed(4)).join(',');
      const eles = missing.map((p) => Math.round(p.elevation)).join(',');

      const url =
        `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${lats}&longitude=${lngs}&elevation=${eles}` +
        `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,surface_pressure,is_day,snow_depth,snowfall`;

      const response = await fetch(url, {
        signal: options?.signal,
        headers: { Accept: 'application/json' },
      });

      if (response.ok) {
        const raw = (await response.json()) as
          | OpenMeteoForecastResponse
          | OpenMeteoForecastResponse[];
        const list = Array.isArray(raw) ? raw : [raw];
        const fetchedAt = Date.now();
        const freshEntries: WeatherData[] = [];

        for (let i = 0; i < missing.length; i++) {
          const peak = missing[i];
          const cur = list[i]?.current;
          // Only record real temperature_2m; never fabricate missing data
          if (!cur || typeof cur.temperature_2m !== 'number' || !Number.isFinite(cur.temperature_2m)) {
            continue;
          }

          const snowDepthCm =
            typeof cur.snow_depth === 'number' &&
            Number.isFinite(cur.snow_depth) &&
            cur.snow_depth >= 0.01
              ? Math.round(cur.snow_depth * 100)
              : null;

          const snowfallCm =
            typeof cur.snowfall === 'number' &&
            Number.isFinite(cur.snowfall) &&
            cur.snowfall > 0
              ? Math.round(cur.snowfall * 10) / 10
              : null;

          const entry: WeatherData = {
            cityId: getPeakCacheId(peak.id),
            cityName: peak.name,
            country: peak.country,
            lat: peak.lat,
            lng: peak.lng,
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
            snowDepthCm,
            snowfallCm,
            fetchedAt,
            source: 'live',
          };

          freshEntries.push(entry);
          weatherByPeakId.set(peak.id, entry);
          fetchedCount += 1;
        }

        if (freshEntries.length > 0) {
          setWeatherEntries(freshEntries, fetchedAt);
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      // On transient failure, leave weatherByPeakId entries absent -> weather: null (no fake temps)
    }
  }

  return {
    items: peaks.map((peak) => ({
      peak,
      weather: weatherByPeakId.get(peak.id) ?? null,
    })),
    fromCacheCount,
    fetchedCount,
  };
}
