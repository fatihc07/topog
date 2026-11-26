import rawSeas from '../data/worldSeas.json';
import type { ViewportBounds } from '../types/weather';
import type { MarineData } from './marineService';

export interface SeaPointRecord {
  id: string;
  name: string;
  region: string;
  lat: number;
  lng: number;
  priority: number;
}

export interface SeaDisplayItem {
  sea: SeaPointRecord;
  marine: MarineData;
}

export const SEAS_MIN_ZOOM = 4.0;

const SEAS: SeaPointRecord[] = [...(rawSeas as SeaPointRecord[])].sort(
  (a, b) => a.priority - b.priority
);

function isLngInBounds(lng: number, west: number, east: number): boolean {
  if (west <= east) {
    return lng >= west && lng <= east;
  }
  // Antimeridian crossing (e.g. 170 to -170)
  return lng >= west || lng <= east;
}

export function getVisibleSeaPoints(
  bounds: ViewportBounds,
  maxCount = 8
): SeaPointRecord[] {
  if (bounds.zoom < SEAS_MIN_ZOOM || maxCount <= 0) return [];

  const minDistDeg = 32 / Math.pow(2, bounds.zoom);
  const minDistSq = minDistDeg * minDistDeg;
  const selected: SeaPointRecord[] = [];

  for (const sea of SEAS) {
    if (sea.lat < bounds.south || sea.lat > bounds.north) continue;
    if (!isLngInBounds(sea.lng, bounds.west, bounds.east)) continue;

    let tooClose = false;
    for (const existing of selected) {
      const dLat = sea.lat - existing.lat;
      const rawDLng = Math.abs(sea.lng - existing.lng);
      const dLng = rawDLng > 180 ? 360 - rawDLng : rawDLng;
      if (dLat * dLat + dLng * dLng < minDistSq) {
        tooClose = true;
        break;
      }
    }

    if (!tooClose) {
      selected.push(sea);
      if (selected.length >= maxCount) break;
    }
  }

  return selected;
}
