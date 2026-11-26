import { isoToFlagEmoji, type CountryHoverInfo } from './countryService';
import { fetchWeatherForCities } from './weatherService';
import type { WeatherData } from '../types/weather';

export interface CountryDetailData {
  iso: string;
  nameTr: string;
  nameEn: string;
  continent: string;
  flag: string;
  capital: string | null;
  capitalLat: number | null;
  capitalLng: number | null;
  population: number | null;
  areaKm2: number | null;
  subregion: string | null;
  currencies: string[];
  languages: string[];
  utcOffsetLabel: string | null;
  localTimeStr: string | null;
  capitalWeather: WeatherData | null;
  fetchedAt: number;
  source: 'live' | 'cache';
}

export const COUNTRY_CACHE_TTL_MS = 15 * 60 * 1000;

const COUNTRY_STORAGE_KEY = 'topog_country_cache_v1';
const MAX_STORED_ENTRIES = 250;

const memoryCache = new Map<string, CountryDetailData>();
let hydrated = false;

interface RestCountriesCurrency {
  name?: unknown;
  symbol?: unknown;
}

interface RestCountriesResponse {
  capital?: unknown;
  capitalInfo?: {
    latlng?: unknown;
  };
  population?: unknown;
  area?: unknown;
  subregion?: unknown;
  timezones?: unknown;
  currencies?: Record<string, RestCountriesCurrency>;
  languages?: Record<string, unknown>;
}

function hasLocalStorage(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof window.localStorage !== 'undefined'
    );
  } catch {
    return false;
  }
}

function normalizeIso(iso: string): string {
  return iso.trim().toUpperCase();
}

function makeCacheKey(iso: string, nameEn: string, nameTr: string): string {
  const normalized = normalizeIso(iso);
  if (/^[A-Z]{2}$/.test(normalized)) {
    return `iso:${normalized}`;
  }
  const fallback = (nameEn || nameTr).trim().toLowerCase();
  return `name:${fallback}`;
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (typeof err === 'object' &&
      err !== null &&
      'name' in err &&
      (err as { name?: unknown }).name === 'AbortError')
  );
}

function hydrateFromStorage(now = Date.now()): void {
  if (hydrated) return;
  hydrated = true;
  if (!hasLocalStorage()) return;

  try {
    const raw = window.localStorage.getItem(COUNTRY_STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw) as CountryDetailData[];
    if (!Array.isArray(parsed)) return;

    for (const item of parsed) {
      if (
        item &&
        typeof item.iso === 'string' &&
        typeof item.nameTr === 'string' &&
        typeof item.nameEn === 'string' &&
        typeof item.fetchedAt === 'number' &&
        now - item.fetchedAt < COUNTRY_CACHE_TTL_MS
      ) {
        const key = makeCacheKey(item.iso, item.nameEn, item.nameTr);
        memoryCache.set(key, item);
      }
    }
  } catch {
    // Ignore malformed storage
  }
}

function persistToStorage(now = Date.now()): void {
  if (!hasLocalStorage()) return;

  try {
    const fresh: CountryDetailData[] = [];
    for (const [key, entry] of memoryCache.entries()) {
      if (now - entry.fetchedAt < COUNTRY_CACHE_TTL_MS) {
        fresh.push(entry);
      } else {
        memoryCache.delete(key);
      }
    }

    fresh.sort((a, b) => b.fetchedAt - a.fetchedAt);
    const capped = fresh.slice(0, MAX_STORED_ENTRIES);
    window.localStorage.setItem(COUNTRY_STORAGE_KEY, JSON.stringify(capped));
  } catch {
    // Storage quota exceeded or unavailable
  }
}

function formatUtcTimeWithOffsetMinutes(offsetMinutes: number): string {
  const shifted = new Date(Date.now() + offsetMinutes * 60 * 1000);
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function computeLocalTimeFromUtcOffset(
  utcOffset: string | null
): string | null {
  if (!utcOffset || typeof utcOffset !== 'string') return null;
  const trimmed = utcOffset.trim().toUpperCase();
  if (trimmed === 'UTC' || trimmed === 'GMT') {
    return formatUtcTimeWithOffsetMinutes(0);
  }

  const match = /^UTC\s*([+\-\u2212])\s*(\d{1,2})(?::?(\d{2}))?$/.exec(trimmed);
  if (!match) return null;

  const sign = match[1] === '+' ? 1 : -1;
  const hours = Number.parseInt(match[2], 10);
  const minutes = match[3] ? Number.parseInt(match[3], 10) : 0;

  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    hours > 14 ||
    minutes >= 60
  ) {
    return null;
  }

  return formatUtcTimeWithOffsetMinutes(sign * (hours * 60 + minutes));
}

export function clearCountryDetailCache(): void {
  hydrated = true;
  memoryCache.clear();
  if (hasLocalStorage()) {
    try {
      window.localStorage.removeItem(COUNTRY_STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
}

function buildEmptyDetail(
  info: CountryHoverInfo,
  normalizedIso: string,
  fetchedAt: number
): CountryDetailData {
  return {
    iso: normalizedIso,
    nameTr: info.nameTr,
    nameEn: info.nameEn,
    continent: info.continent,
    flag: info.flag || isoToFlagEmoji(normalizedIso),
    capital: null,
    capitalLat: null,
    capitalLng: null,
    population: null,
    areaKm2: null,
    subregion: null,
    currencies: [],
    languages: [],
    utcOffsetLabel: null,
    localTimeStr: null,
    capitalWeather: null,
    fetchedAt,
    source: 'live',
  };
}

export async function fetchCountryDetail(
  info: CountryHoverInfo,
  signal?: AbortSignal
): Promise<CountryDetailData> {
  const now = Date.now();
  hydrateFromStorage(now);

  const normalizedIso = normalizeIso(info.iso);
  const key = makeCacheKey(normalizedIso, info.nameEn, info.nameTr);

  const cached = memoryCache.get(key);
  if (cached) {
    if (now - cached.fetchedAt < COUNTRY_CACHE_TTL_MS) {
      return {
        ...cached,
        nameTr: info.nameTr || cached.nameTr,
        nameEn: info.nameEn || cached.nameEn,
        continent: info.continent || cached.continent,
        flag: info.flag || cached.flag,
        localTimeStr: computeLocalTimeFromUtcOffset(cached.utcOffsetLabel),
        capitalWeather: cached.capitalWeather
          ? { ...cached.capitalWeather, source: 'cache' }
          : null,
        source: 'cache',
      };
    }
    memoryCache.delete(key);
    persistToStorage(now);
  }

  if (!/^[A-Z]{2}$/.test(normalizedIso)) {
    const emptyDetail = buildEmptyDetail(info, normalizedIso, Date.now());
    memoryCache.set(key, emptyDetail);
    persistToStorage(emptyDetail.fetchedAt);
    return emptyDetail;
  }

  const url =
    `https://restcountries.com/v3.1/alpha/${encodeURIComponent(normalizedIso)}` +
    `?fields=name,capital,capitalInfo,population,area,timezones,currencies,subregion,languages`;

  let raw: RestCountriesResponse | undefined;
  try {
    const response = await fetch(url, {
      signal,
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      return buildEmptyDetail(info, normalizedIso, Date.now());
    }

    const payload = (await response.json()) as unknown;
    const candidate = Array.isArray(payload) ? payload[0] : payload;
    if (candidate && typeof candidate === 'object') {
      raw = candidate as RestCountriesResponse;
    }
  } catch (err) {
    if (isAbortError(err)) {
      throw err;
    }
    return buildEmptyDetail(info, normalizedIso, Date.now());
  }

  if (!raw) {
    return buildEmptyDetail(info, normalizedIso, Date.now());
  }

  const capital =
    Array.isArray(raw.capital) &&
    typeof raw.capital[0] === 'string' &&
    raw.capital[0].trim().length > 0
      ? raw.capital[0].trim()
      : null;

  let capitalLat: number | null = null;
  let capitalLng: number | null = null;
  const latlng = raw.capitalInfo?.latlng;
  if (
    Array.isArray(latlng) &&
    latlng.length >= 2 &&
    typeof latlng[0] === 'number' &&
    Number.isFinite(latlng[0]) &&
    typeof latlng[1] === 'number' &&
    Number.isFinite(latlng[1]) &&
    latlng[0] >= -90 &&
    latlng[0] <= 90 &&
    latlng[1] >= -180 &&
    latlng[1] <= 180
  ) {
    capitalLat = latlng[0];
    capitalLng = latlng[1];
  }

  const population =
    typeof raw.population === 'number' &&
    Number.isFinite(raw.population) &&
    raw.population >= 0
      ? raw.population
      : null;

  const areaKm2 =
    typeof raw.area === 'number' &&
    Number.isFinite(raw.area) &&
    raw.area > 0
      ? raw.area
      : null;

  const subregion =
    typeof raw.subregion === 'string' && raw.subregion.trim().length > 0
      ? raw.subregion.trim()
      : null;

  const currencies: string[] = [];
  if (
    raw.currencies &&
    typeof raw.currencies === 'object' &&
    !Array.isArray(raw.currencies)
  ) {
    for (const entry of Object.values(raw.currencies)) {
      if (!entry || typeof entry !== 'object') continue;
      const currName = typeof entry.name === 'string' ? entry.name.trim() : '';
      const currSymbol =
        typeof entry.symbol === 'string' ? entry.symbol.trim() : '';
      if (!currName) continue;
      currencies.push(currSymbol ? `${currName} (${currSymbol})` : currName);
    }
  }

  const languages: string[] = [];
  if (
    raw.languages &&
    typeof raw.languages === 'object' &&
    !Array.isArray(raw.languages)
  ) {
    for (const lang of Object.values(raw.languages)) {
      if (typeof lang === 'string' && lang.trim().length > 0) {
        languages.push(lang.trim());
      }
    }
  }

  const utcOffsetLabel =
    Array.isArray(raw.timezones) &&
    typeof raw.timezones[0] === 'string' &&
    raw.timezones[0].trim().length > 0
      ? raw.timezones[0].trim()
      : null;

  const localTimeStr = computeLocalTimeFromUtcOffset(utcOffsetLabel);

  let capitalWeather: WeatherData | null = null;
  if (capitalLat !== null && capitalLng !== null) {
    try {
      const weatherResult = await fetchWeatherForCities(
        [
          {
            id: `capital:${normalizedIso || info.nameEn}`,
            name: capital ?? info.nameTr,
            country: normalizedIso,
            lat: capitalLat,
            lng: capitalLng,
            pop: 1,
          },
        ],
        { signal }
      );
      capitalWeather = weatherResult.items[0] ?? null;
    } catch (err) {
      if (isAbortError(err)) {
        throw err;
      }
      capitalWeather = null;
    }
  }

  const fetchedAt = Date.now();
  const detail: CountryDetailData = {
    iso: normalizedIso,
    nameTr: info.nameTr,
    nameEn: info.nameEn,
    continent: info.continent,
    flag: info.flag || isoToFlagEmoji(normalizedIso),
    capital,
    capitalLat,
    capitalLng,
    population,
    areaKm2,
    subregion,
    currencies,
    languages,
    utcOffsetLabel,
    localTimeStr,
    capitalWeather,
    fetchedAt,
    source: 'live',
  };

  memoryCache.set(key, detail);
  persistToStorage(fetchedAt);

  return detail;
}
