export type PrecipMode = 'clear' | 'rain' | 'snow' | 'auto';
export type ActivePrecipKind = 'none' | 'rain' | 'snow';
export type CloudStyle = 'cumulus' | 'partly' | 'cirrus' | 'storm';

export interface LivingWorldControls {
  tempC: number;
  precipMode: PrecipMode;
  precipIntensity: number; // 0..1
  windStrength: number; // 0..1
  timeOfDayHours: number; // 0..24
  cloudStyle: CloudStyle;
  cloudCoverage: number; // 0..1
}

export interface LivingWorldSimState {
  snowDepthCm: number; // 0..80
  snowCoverage: number; // 0..1
  canopySnow: number; // 0..1
  wetness: number; // 0..1
  activePrecipKind: ActivePrecipKind;
  snowRateCmPerMin: number;
  meltRateCmPerMin: number;
}

export interface LivingWorldPreset {
  id: string;
  label: string;
  emoji: string;
  description: string;
  controls: LivingWorldControls;
  resetSnowToCm?: number;
}

export interface ForestSceneStats {
  trees: number;
  grassBlades: number;
  ferns: number;
  rocks: number;
  particles: number;
}
