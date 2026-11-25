import rawCities from '../data/worldCities.json';
import type { CityRecord, ViewportBounds } from '../types/weather';

type CityTuple = [string, string, string, number, number, number];

export const WEATHER_MIN_ZOOM = 4.0;

const CITIES: CityRecord[] = (rawCities as CityTuple[]).map(
  ([id, name, country, lat, lng, pop]) => ({
    id,
    name,
    country,
    lat,
    lng,
    pop,
  })
);

function isLngInBounds(lng: number, west: number, east: number): boolean {
  if (west <= east) {
    return lng >= west && lng <= east;
  }
  // Antimeridian crossing (e.g. 170 to -170)
  return lng >= west || lng <= east;
}

export function getVisibleCities(
  bounds: ViewportBounds,
  maxCount = 10
): CityRecord[] {
  if (bounds.zoom < WEATHER_MIN_ZOOM) return [];

  const minDistDeg = 34 / Math.pow(2, bounds.zoom);
  const minDistSq = minDistDeg * minDistDeg;
  const selected: CityRecord[] = [];

  // CITIES is sorted descending by population so larger cities take priority
  for (const city of CITIES) {
    if (city.lat < bounds.south || city.lat > bounds.north) continue;
    if (!isLngInBounds(city.lng, bounds.west, bounds.east)) continue;

    let tooClose = false;
    for (const existing of selected) {
      const dLat = city.lat - existing.lat;
      const dLng = city.lng - existing.lng;
      if (dLat * dLat + dLng * dLng < minDistSq) {
        tooClose = true;
        break;
      }
    }

    if (!tooClose) {
      selected.push(city);
      if (selected.length >= maxCount) break;
    }
  }

  return selected;
}

export function hasCityNearPoint(
  cities: CityRecord[],
  lat: number,
  lng: number,
  thresholdDeg = 0.14
): boolean {
  const threshSq = thresholdDeg * thresholdDeg;
  for (const c of cities) {
    const dLat = c.lat - lat;
    const dLng = c.lng - lng;
    if (dLat * dLat + dLng * dLng <= threshSq) return true;
  }
  return false;
}
