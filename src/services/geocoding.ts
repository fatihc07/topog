import type { SearchResult } from '../types/map';

export async function searchPlaces(
  query: string,
  signal?: AbortSignal
): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  try {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('q', trimmed);
    url.searchParams.set('limit', '6');
    url.searchParams.set('accept-language', 'tr,en');

    const response = await fetch(url.toString(), {
      signal,
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) return [];
    const data = (await response.json()) as SearchResult[];
    return Array.isArray(data) ? data : [];
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    return [];
  }
}

export async function reverseGeocode(
  lat: number,
  lng: number,
  signal?: AbortSignal
): Promise<string | null> {
  try {
    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('lat', lat.toFixed(6));
    url.searchParams.set('lon', lng.toFixed(6));
    url.searchParams.set('zoom', '10');
    url.searchParams.set('accept-language', 'tr,en');

    const response = await fetch(url.toString(), {
      signal,
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) return null;
    const data = (await response.json()) as {
      display_name?: string;
      name?: string;
      address?: Record<string, string>;
    };

    if (data.name && data.address?.country) {
      return `${data.name}, ${data.address.country}`;
    }
    return data.display_name || null;
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    return null;
  }
}

export async function fetchElevation(
  lat: number,
  lng: number,
  signal?: AbortSignal
): Promise<number | null> {
  try {
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lat.toFixed(5)}&longitude=${lng.toFixed(5)}`;
    const response = await fetch(url, {
      signal,
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) return null;
    const data = (await response.json()) as { elevation?: number[] };
    const value = data.elevation?.[0];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    return null;
  }
}
