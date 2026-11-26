import type {
  ActivePrecipKind,
  LivingWorldControls,
  LivingWorldPreset,
  LivingWorldSimState,
} from '../types/livingWorld';

const MAX_SNOW_DEPTH_CM = 80;
const BASE_FOREST_WETNESS = 0.08;

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function quinticFade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Deterministic 2D pseudo-random hash in [0, 1).
 */
export function hash2D(x: number, z: number): number {
  const raw = Math.sin(x * 127.1 + z * 311.7 + 74.7) * 43758.5453123;
  const frac = raw - Math.floor(raw);
  return frac >= 1 ? 0 : frac;
}

/**
 * Smooth 2D value noise in [0, 1].
 */
export function noise2D(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;

  const ux = quinticFade(fx);
  const uz = quinticFade(fz);

  const n00 = hash2D(ix, iz);
  const n10 = hash2D(ix + 1, iz);
  const n01 = hash2D(ix, iz + 1);
  const n11 = hash2D(ix + 1, iz + 1);

  const nx0 = lerp(n00, n10, ux);
  const nx1 = lerp(n01, n11, ux);
  return clamp(lerp(nx0, nx1, uz), 0, 1);
}

/**
 * Fractal Brownian Motion (FBM) 2D noise normalized to [0, 1].
 */
export function fbm2D(x: number, z: number, octaves = 4): number {
  const count = Math.max(1, Math.floor(octaves));
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1.0;
  let norm = 0;

  for (let i = 0; i < count; i++) {
    // Slight coordinate offset per octave breaks grid alignment.
    sum += noise2D(x * frequency + i * 17.3, z * frequency - i * 11.7) * amplitude;
    norm += amplitude;
    frequency *= 2.03;
    amplitude *= 0.5;
  }

  return norm > 0 ? clamp(sum / norm, 0, 1) : 0.5;
}

/**
 * Winding forest footpath X center coordinate for a given Z coordinate.
 */
export function getTrailCenterX(z: number): number {
  return Math.sin(z * 0.075) * 3.6 + Math.sin(z * 0.028 + 0.8) * 2.1;
}

/**
 * Smooth 0..1 mask for the winding dirt trail: 1.0 inside ~1.1 m core,
 * tapering smoothly to 0.0 by ~2.5 m edge with natural FBM bank irregularity.
 */
export function getTrailFactor(x: number, z: number): number {
  const centerX = getTrailCenterX(z);
  // Perpendicular scale from the trail curve's local slope dx/dz.
  const dxdz =
    3.6 * 0.075 * Math.cos(z * 0.075) + 2.1 * 0.028 * Math.cos(z * 0.028 + 0.8);
  const perpScale = 1 / Math.sqrt(1 + dxdz * dxdz);
  const edgeMod = (fbm2D(x * 0.35 + 7.1, z * 0.35 - 3.4, 2) - 0.5) * 0.55;
  const dist = Math.abs(x - centerX) * perpScale + edgeMod;
  return 1 - smoothstep(1.1, 2.5, dist);
}

/**
 * Rolling woodland terrain height (m) across the 260x260 m scene,
 * with a gently flattened central mossy glade near (0, 0) within ~18 m radius
 * and a slightly recessed winding dirt footpath between mossy banks.
 */
export function getTerrainHeight(x: number, z: number): number {
  const broad = fbm2D(x * 0.014 + 3.7, z * 0.014 - 2.1, 4);
  const ridgeSample = fbm2D(x * 0.024 - 5.3, z * 0.024 + 4.8, 3);
  const ridge = Math.abs(ridgeSample - 0.5) * 2.0;
  const detail = noise2D(x * 0.075, z * 0.075);

  const distFromOrigin = Math.sqrt(x * x + z * z);
  const amphitheaterLift = smoothstep(28, 120, distFromOrigin) * 2.1;

  const hillHeight =
    (broad - 0.43) * 17.5 +
    (ridge - 0.3) * 4.2 +
    (detail - 0.5) * 1.1 +
    amphitheaterLift;

  const gladeBase = 0.35 + (detail - 0.5) * 0.3;
  const gladeBlend = smoothstep(6, 22, distFromOrigin);

  return lerp(gladeBase, hillHeight, gladeBlend) - 0.22 * getTrailFactor(x, z);
}

export function createInitialForestSimState(): LivingWorldSimState {
  return {
    snowDepthCm: 0,
    snowCoverage: 0,
    canopySnow: 0,
    wetness: BASE_FOREST_WETNESS,
    activePrecipKind: 'none',
    snowRateCmPerMin: 0,
    meltRateCmPerMin: 0,
  };
}

function resolvePrecipKind(controls: LivingWorldControls): ActivePrecipKind {
  if (controls.precipIntensity <= 0.03 || controls.precipMode === 'clear') {
    return 'none';
  }
  if (controls.precipMode === 'auto') {
    return controls.tempC <= 0.5 ? 'snow' : 'rain';
  }
  return controls.precipMode;
}

function getSolarDayFactor(timeOfDayHours: number): number {
  const wrapped = ((timeOfDayHours % 24) + 24) % 24;
  // Peak around 13:00; strong between 10:00 and 16:00.
  const angle = ((wrapped - 13) / 6) * (Math.PI * 0.5);
  return wrapped >= 7 && wrapped <= 19 ? Math.max(0, Math.cos(angle)) : 0;
}

export function stepForestWeather(
  state: LivingWorldSimState,
  controls: LivingWorldControls,
  dtSec: number
): LivingWorldSimState {
  const dt = clamp(dtSec, 0, 0.1);
  const precipIntensity = clamp(controls.precipIntensity, 0, 1);
  const windStrength = clamp(controls.windStrength, 0, 1);
  const activePrecipKind = resolvePrecipKind(controls);

  // Snow accumulation: only when snowing and tempC <= 1.5°C.
  let sticking = 0;
  let snowRateCmPerMin = 0;
  if (activePrecipKind === 'snow' && controls.tempC <= 1.5) {
    // Scales smoothly from 0.15 at +1.5°C up to 1.0 at -2.0°C and colder.
    const tStick = smoothstep(1.5, -2.0, controls.tempC);
    sticking = 0.15 + 0.85 * tStick;
    snowRateCmPerMin = 18.5 * precipIntensity * sticking;
  }

  // Thermodynamic melting: only when snow exists and (tempC > 0 or raining).
  const solarFactor = getSolarDayFactor(controls.timeOfDayHours);
  let meltRateCmPerMin = 0;
  if (state.snowDepthCm > 0 && (controls.tempC > 0 || activePrecipKind === 'rain')) {
    const tempAboveZero = Math.max(0, controls.tempC);
    const baseTempMelt = tempAboveZero * 1.35;
    const cloudSuppression =
      activePrecipKind === 'none' ? 1.0 : 1.0 - 0.65 * precipIntensity;
    const sunMelt =
      controls.tempC > 0
        ? solarFactor * 5.2 * cloudSuppression * clamp(controls.tempC / 6, 0.25, 1.2)
        : 0;
    const windConvection = 1 + windStrength * 0.22;

    const rainWarmBoost = 1 + tempAboveZero * 0.12;
    const rainOnSnowMelt =
      activePrecipKind === 'rain' ? (6.5 + 11.0 * precipIntensity) * rainWarmBoost : 0;

    meltRateCmPerMin = (baseTempMelt + sunMelt) * windConvection + rainOnSnowMelt;
  }

  const netDepthDelta = ((snowRateCmPerMin - meltRateCmPerMin) * dt) / 60;
  const snowDepthCm = clamp(state.snowDepthCm + netDepthDelta, 0, MAX_SNOW_DEPTH_CM);
  const snowCoverage = clamp(1 - Math.exp(-snowDepthCm / 7.5), 0, 1);

  // Canopy snow builds with snowfall and sheds under warmth, wind, or rain.
  const canopyBuildRate =
    activePrecipKind === 'snow' && controls.tempC <= 1.5
      ? 0.095 * precipIntensity * sticking * (1 - 0.35 * windStrength)
      : 0;
  const warmShed = controls.tempC > 0 ? 0.045 + controls.tempC * 0.016 : 0;
  const windShed =
    windStrength > 0.35
      ? (windStrength - 0.35) * (controls.tempC > -1 ? 0.14 : 0.045)
      : 0;
  const rainShed =
    activePrecipKind === 'rain' ? 0.28 + 0.35 * precipIntensity : 0;
  const bareGroundSettle =
    snowDepthCm <= 0.05 && canopyBuildRate === 0 ? 0.25 : 0;

  const totalCanopyShed = warmShed + windShed + rainShed + bareGroundSettle;
  const canopySnow = clamp(
    state.canopySnow + (canopyBuildRate - state.canopySnow * totalCanopyShed) * dt,
    0,
    1
  );

  // Surface wetness rises on rain or active melting, dries in warm/windy clear air.
  let wetness = state.wetness;
  const isActivelyMelting = state.snowDepthCm > 0.05 && meltRateCmPerMin > 0.05;
  if (activePrecipKind === 'rain') {
    const targetWet = 0.65 + 0.35 * precipIntensity;
    const riseRate = 0.22 + 0.35 * precipIntensity;
    wetness = lerp(wetness, targetWet, clamp(riseRate * dt, 0, 1));
  } else if (isActivelyMelting) {
    const targetMeltWet = clamp(0.42 + meltRateCmPerMin * 0.025, 0.35, 0.9);
    const meltWetRate = 0.16 + 0.015 * meltRateCmPerMin;
    wetness = lerp(wetness, targetMeltWet, clamp(meltWetRate * dt, 0, 1));
  } else if (activePrecipKind === 'snow' && controls.tempC <= 0.5) {
    // Sub-freezing snowfall freezes moisture gently without drying out quickly.
    wetness = lerp(wetness, BASE_FOREST_WETNESS, clamp(0.03 * dt, 0, 1));
  } else {
    const warmthDry = clamp(Math.max(0, controls.tempC) / 18, 0.08, 1.2);
    const dryRate =
      (0.035 + 0.075 * warmthDry) * (1 + 0.65 * windStrength + 0.35 * solarFactor);
    wetness = lerp(wetness, BASE_FOREST_WETNESS, clamp(dryRate * dt, 0, 1));
  }

  return {
    snowDepthCm,
    snowCoverage,
    canopySnow,
    wetness: clamp(wetness, 0, 1),
    activePrecipKind,
    snowRateCmPerMin:
      snowDepthCm >= MAX_SNOW_DEPTH_CM && snowRateCmPerMin > meltRateCmPerMin
        ? 0
        : snowRateCmPerMin,
    meltRateCmPerMin,
  };
}

export const LIVING_WORLD_PRESETS: LivingWorldPreset[] = [
  {
    id: 'sunny',
    label: 'Güneşli Orman',
    emoji: '☀️',
    description: 'Ilık öğleden sonra güneşi altında yemyeşil yosunlu orman açıklığı',
    controls: {
      tempC: 16,
      precipMode: 'clear',
      precipIntensity: 0,
      windStrength: 0.25,
      timeOfDayHours: 14.2,
    },
    resetSnowToCm: 0,
  },
  {
    id: 'rain',
    label: 'Orman Yağmuru',
    emoji: '🌧️',
    description: 'Serin ikindi sağanağı altında ıslanan yapraklar ve parlayan kayalar',
    controls: {
      tempC: 11,
      precipMode: 'rain',
      precipIntensity: 0.78,
      windStrength: 0.55,
      timeOfDayHours: 16.0,
    },
  },
  {
    id: 'blizzard',
    label: 'Kar Fırtınası',
    emoji: '❄️',
    description: 'Dondurucu rüzgârla hızla biriken yoğun kar örtüsü ve beyazlayan dallar',
    controls: {
      tempC: -6,
      precipMode: 'snow',
      precipIntensity: 0.9,
      windStrength: 0.65,
      timeOfDayHours: 15.2,
    },
  },
  {
    id: 'melt',
    label: 'Bahar Erimesi',
    emoji: '🌤️',
    description: 'Öğle güneşi ve ılık havayla 28 cm kar örtüsünün suya dönüşen erimesi',
    controls: {
      tempC: 9,
      precipMode: 'clear',
      precipIntensity: 0,
      windStrength: 0.35,
      timeOfDayHours: 12.5,
    },
    resetSnowToCm: 28,
  },
];
