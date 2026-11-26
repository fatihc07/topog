import type { SearchResult } from '../types/map';

export interface SearchHistoryItem extends SearchResult {
  searchedAt: number;
}

const STORAGE_KEY = 'topog_search_history_v1';
const MAX_HISTORY = 8;

function isValidHistoryItem(value: unknown): value is SearchHistoryItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<SearchHistoryItem>;
  return (
    typeof item.place_id === 'number' &&
    Number.isFinite(item.place_id) &&
    typeof item.display_name === 'string' &&
    item.display_name.length > 0 &&
    typeof item.lat === 'string' &&
    typeof item.lon === 'string' &&
    typeof item.type === 'string' &&
    typeof item.class === 'string' &&
    typeof item.searchedAt === 'number' &&
    Number.isFinite(item.searchedAt)
  );
}

function saveSearchHistory(items: SearchHistoryItem[]): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage quota or private mode errors
  }
}

export function loadSearchHistory(): SearchHistoryItem[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isValidHistoryItem)
      .sort((a, b) => b.searchedAt - a.searchedAt)
      .slice(0, MAX_HISTORY);
  } catch {
    return [];
  }
}

export function addSearchHistory(result: SearchResult): SearchHistoryItem[] {
  const current = loadSearchHistory();
  const entry: SearchHistoryItem = {
    place_id: result.place_id,
    display_name: result.display_name,
    lat: result.lat,
    lon: result.lon,
    type: result.type,
    class: result.class,
    searchedAt: Date.now(),
  };
  const next = [
    entry,
    ...current.filter((item) => item.place_id !== result.place_id),
  ].slice(0, MAX_HISTORY);
  saveSearchHistory(next);
  return next;
}

export function removeSearchHistoryItem(placeId: number): SearchHistoryItem[] {
  const current = loadSearchHistory();
  const next = current.filter((item) => item.place_id !== placeId);
  saveSearchHistory(next);
  return next;
}

export function clearSearchHistory(): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}
