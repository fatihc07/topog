export type FavoriteKind = 'city' | 'peak' | 'sea' | 'country' | 'point';

export interface FavoritePlace {
  id: string;
  name: string;
  subtitle?: string;
  kind: FavoriteKind;
  lat: number;
  lng: number;
  zoom?: number;
  savedAt: number;
}

const STORAGE_KEY = 'topog_favorites_v1';
const MAX_FAVORITES = 20;

const VALID_KINDS: ReadonlySet<FavoriteKind> = new Set([
  'city',
  'peak',
  'sea',
  'country',
  'point',
]);

function isValidFavorite(value: unknown): value is FavoritePlace {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<FavoritePlace>;
  return (
    typeof item.id === 'string' &&
    item.id.length > 0 &&
    typeof item.name === 'string' &&
    item.name.length > 0 &&
    typeof item.kind === 'string' &&
    VALID_KINDS.has(item.kind as FavoriteKind) &&
    typeof item.lat === 'number' &&
    Number.isFinite(item.lat) &&
    typeof item.lng === 'number' &&
    Number.isFinite(item.lng) &&
    typeof item.savedAt === 'number' &&
    Number.isFinite(item.savedAt)
  );
}

function saveFavorites(list: FavoritePlace[]): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Ignore storage quota or private mode errors
  }
}

export function loadFavorites(): FavoritePlace[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isValidFavorite)
      .sort((a, b) => b.savedAt - a.savedAt)
      .slice(0, MAX_FAVORITES);
  } catch {
    return [];
  }
}

export function isFavoritePlace(id: string, list?: FavoritePlace[]): boolean {
  const source = list ?? loadFavorites();
  return source.some((item) => item.id === id);
}

export function toggleFavoritePlace(
  place: Omit<FavoritePlace, 'savedAt'>,
): FavoritePlace[] {
  const current = loadFavorites();
  const exists = current.some((item) => item.id === place.id);
  const next = exists
    ? current.filter((item) => item.id !== place.id)
    : [{ ...place, savedAt: Date.now() }, ...current].slice(0, MAX_FAVORITES);
  saveFavorites(next);
  return next;
}

export function removeFavoritePlace(id: string): FavoritePlace[] {
  const current = loadFavorites();
  const next = current.filter((item) => item.id !== id);
  saveFavorites(next);
  return next;
}
