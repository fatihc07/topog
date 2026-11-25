export type AppMode = 'live' | 'simulator';

export type SimWaveKind = 'cold' | 'warm' | 'moisture';

export type SimSeason = 'winter' | 'spring' | 'summer' | 'autumn';

export interface SimWave {
  id: string;
  kind: SimWaveKind;
  lng: number;
  lat: number;
  originLng: number;
  originLat: number;
  radiusKm: number;
  maxRadiusKm: number;
  strength: number;
  moisture: number;
  ageSec: number;
  maxAgeSec: number;
  overSea: boolean;
  orographicBoost: number;
}

export interface SimFrontZone {
  id: string;
  lng: number;
  lat: number;
  radiusKm: number;
  intensity: number;
  isSnow: boolean;
}

export interface SimStateSnapshot {
  waves: SimWave[];
  fronts: SimFrontZone[];
  simHoursElapsed: number;
}
