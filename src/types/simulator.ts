export type AppMode = 'live' | 'simulator';

export type SimWaveKind =
  | 'cold'
  | 'warm'
  | 'moisture'
  | 'cyclone'
  | 'high_pressure';

export type SimSystemTool = 'cold' | 'warm' | 'cyclone' | 'high_pressure' | null;

export type SimSeason = 'winter' | 'spring' | 'summer' | 'autumn';

export interface SimToolSelection {
  thermal: 'cold' | 'warm' | null;
  moisture: boolean;
}

export interface SimWave {
  id: string;
  kind: SimWaveKind;
  withMoisture: boolean;
  lng: number;
  lat: number;
  originLng: number;
  originLat: number;
  radiusKm: number;
  maxRadiusKm: number;
  strength: number;
  moisture: number;
  seaMoistureCharge: number;
  lakeEffectActive: boolean;
  rotationDeg: number;
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

export interface SimHistoryPoint {
  timestamp: number;
  tempC: number;
  snowDepthCm: number | null;
}

export interface SimScenario {
  id: string;
  name: string;
  badge: string;
  description: string;
  season: SimSeason;
  windDirDeg: number | null;
  camera: { lng: number; lat: number; zoom: number };
  waves: Array<{
    kind: SimWaveKind;
    lng: number;
    lat: number;
    strength: number;
    withMoisture: boolean;
  }>;
}

export interface SimStateSnapshot {
  waves: SimWave[];
  fronts: SimFrontZone[];
  simHoursElapsed: number;
}
