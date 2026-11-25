import rawPeaks from '../data/worldPeaks.json';
import type {
  SimFrontZone,
  SimSeason,
  SimWave,
  SimWaveKind,
} from '../types/simulator';
import type { PeakDisplayItem, WeatherData } from '../types/weather';

type PeakTuple = [string, string, string, number, number, number];

interface HighPeak {
  lat: number;
  lng: number;
  elevation: number;
}

const EARTH_RADIUS_KM = 6371;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const WAVE_DRIFT_KM_PER_SEC = 22;
const DEFAULT_MAX_AGE_SEC = 52;
const INITIAL_RADIUS_KM = 95;
const CYCLONE_SPIN_DEG_PER_SEC = 55;
const FOEHN_SEARCH_RADIUS_KM = 220;

const HIGH_PEAKS: HighPeak[] = (rawPeaks as PeakTuple[])
  .filter(([, , , , , elevation]) => elevation >= 2000)
  .map(([, , , lat, lng, elevation]) => ({ lat, lng, elevation }));

let waveCounter = 0;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function normalizeLng(lng: number): number {
  let normalized = (((lng + 180) % 360) + 360) % 360 - 180;
  if (normalized === -180 && lng > 0) normalized = 180;
  return normalized;
}

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLng = (lng2 - lng1) * DEG_TO_RAD;
  const rLat1 = lat1 * DEG_TO_RAD;
  const rLat2 = lat2 * DEG_TO_RAD;

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const a =
    sinLat * sinLat + Math.cos(rLat1) * Math.cos(rLat2) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDeg(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number
): number {
  const lat1 = fromLat * DEG_TO_RAD;
  const lat2 = toLat * DEG_TO_RAD;
  const dLng = (toLng - fromLng) * DEG_TO_RAD;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (((Math.atan2(y, x) * RAD_TO_DEG) % 360) + 360) % 360;
}

function angularDiffDeg(a: number, b: number): number {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180);
}

function inBox(
  lat: number,
  lng: number,
  minLat: number,
  maxLat: number,
  minLng: number,
  maxLng: number
): boolean {
  return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng;
}

/**
 * Heuristic check for whether coordinates lie over a major sea or open ocean
 * so simulated air masses pick up moisture over water.
 */
export function isLikelyOverSea(lat: number, lng: number): boolean {
  const nLng = normalizeLng(lng);

  // Polar oceans
  if (lat >= 74 || lat <= -62) return true;

  // Regional & enclosed seas
  // Sea of Marmara
  if (inBox(lat, nLng, 40.3, 41.1, 27.0, 29.9)) return true;
  // Aegean Sea
  if (inBox(lat, nLng, 35.0, 40.8, 22.8, 26.8)) return true;
  // Black Sea
  if (inBox(lat, nLng, 41.2, 46.6, 27.8, 41.7)) return true;
  // Caspian Sea
  if (inBox(lat, nLng, 36.6, 46.9, 46.8, 54.0)) return true;
  // Red Sea
  if (inBox(lat, nLng, 12.6, 28.2, 32.5, 43.4)) return true;
  // Persian Gulf
  if (inBox(lat, nLng, 24.0, 30.2, 48.0, 56.5)) return true;

  // Mediterranean basins (western, central/Ionian, eastern/Levantine, Adriatic)
  if (
    inBox(lat, nLng, 35.4, 41.5, -5.5, 9.2) || // Alboran / Balearic / Sardinia
    inBox(lat, nLng, 31.2, 39.8, 10.2, 22.8) || // Central Med & Ionian
    inBox(lat, nLng, 31.2, 36.7, 22.8, 35.9) || // Eastern Med / Levantine
    inBox(lat, nLng, 40.2, 45.6, 12.3, 19.3) // Adriatic
  ) {
    return true;
  }

  // North Sea & Baltic Sea
  if (inBox(lat, nLng, 51.4, 61.0, -2.5, 9.2)) return true;
  if (inBox(lat, nLng, 53.8, 65.8, 10.2, 29.8)) return true;

  // Gulf of Mexico & Caribbean Sea
  if (inBox(lat, nLng, 18.5, 29.5, -97.0, -81.0)) return true;
  if (inBox(lat, nLng, 9.5, 22.0, -87.0, -60.0)) return true;

  // Sea of Japan, Yellow/East China Sea, South China Sea
  if (inBox(lat, nLng, 33.5, 46.5, 128.5, 141.0)) return true;
  if (inBox(lat, nLng, 24.0, 39.5, 119.0, 129.0)) return true;
  if (inBox(lat, nLng, 2.0, 22.5, 105.0, 120.5)) return true;

  // Major continental landmass bounding exclusions (approximate)
  const onLand =
    // North America
    inBox(lat, nLng, 24.0, 71.0, -165.0, -55.0) ||
    inBox(lat, nLng, 14.0, 24.0, -106.0, -83.0) ||
    // Greenland
    inBox(lat, nLng, 60.0, 83.0, -58.0, -18.0) ||
    // South America
    inBox(lat, nLng, -10.0, 12.0, -81.0, -35.0) ||
    inBox(lat, nLng, -54.0, -10.0, -75.0, -39.0) ||
    // Europe (west, central, east)
    inBox(lat, nLng, 36.5, 43.8, -9.5, -0.5) || // Iberia
    inBox(lat, nLng, 43.0, 58.0, -5.0, 28.0) || // Western/Central Europe
    inBox(lat, nLng, 44.0, 70.0, 20.0, 60.0) || // Eastern Europe & Urals
    // Anatolia & Middle East
    inBox(lat, nLng, 36.6, 41.3, 26.8, 44.8) ||
    inBox(lat, nLng, 13.0, 37.0, 34.5, 60.0) ||
    // Africa
    inBox(lat, nLng, 5.0, 36.0, -17.0, 42.0) ||
    inBox(lat, nLng, -35.0, 5.0, 11.5, 51.0) ||
    // Asia (Siberia, Central, South, East)
    inBox(lat, nLng, 42.0, 74.0, 60.0, 140.0) ||
    inBox(lat, nLng, 54.0, 71.0, 140.0, 172.0) ||
    inBox(lat, nLng, 22.0, 42.0, 60.0, 122.0) ||
    inBox(lat, nLng, 8.0, 28.0, 68.0, 108.0) ||
    // Australia
    inBox(lat, nLng, -39.0, -11.0, 113.0, 154.0);

  return !onLand;
}

/**
 * Returns `'L'` for low-pressure cyclone systems, `'H'` for high-pressure ridges,
 * or `null` for thermal/moisture waves.
 */
export function getActivePressureCenterLabel(
  kind: SimWaveKind
): 'L' | 'H' | null {
  if (kind === 'cyclone') return 'L';
  if (kind === 'high_pressure') return 'H';
  return null;
}

/**
 * Creates a new simulated atmospheric air mass / pressure system at the given coordinates.
 */
export function createSimWave(
  kind: SimWaveKind,
  lng: number,
  lat: number,
  strength = 1,
  withMoisture = false
): SimWave {
  const clampedStrength = clamp(strength, 0.2, 2.5);
  const clampedLat = clamp(lat, -85, 85);
  const normLng = normalizeLng(lng);

  let effectiveWithMoisture = false;
  let initialMoisture = 0.14;
  let maxRadiusKm = 650 + clampedStrength * 240;

  if (kind === 'cyclone') {
    effectiveWithMoisture = true;
    initialMoisture = 0.88;
    maxRadiusKm = 700 + clampedStrength * 240;
  } else if (kind === 'high_pressure') {
    effectiveWithMoisture = false;
    initialMoisture = 0.05;
    maxRadiusKm = 680 + clampedStrength * 220;
  } else if (kind === 'moisture' || withMoisture) {
    effectiveWithMoisture = true;
    initialMoisture = 0.9;
  } else if (kind === 'cold') {
    effectiveWithMoisture = false;
    initialMoisture = 0.22;
  } else {
    effectiveWithMoisture = false;
    initialMoisture = 0.14;
  }

  waveCounter += 1;

  return {
    id: `sim-wave-${Date.now()}-${waveCounter}`,
    kind,
    withMoisture: effectiveWithMoisture,
    lng: normLng,
    lat: clampedLat,
    originLng: normLng,
    originLat: clampedLat,
    radiusKm: INITIAL_RADIUS_KM,
    maxRadiusKm,
    strength: clampedStrength,
    moisture: initialMoisture,
    seaMoistureCharge: 0,
    lakeEffectActive: false,
    rotationDeg: 0,
    ageSec: 0,
    maxAgeSec: DEFAULT_MAX_AGE_SEC,
    overSea: isLikelyOverSea(clampedLat, normLng),
    orographicBoost: 0,
  };
}

function computeOrographicProximity(
  lat: number,
  lng: number,
  radiusKm: number
): number {
  let maxBoost = 0;
  for (let i = 0; i < HIGH_PEAKS.length; i += 1) {
    const peak = HIGH_PEAKS[i];
    if (Math.abs(peak.lat - lat) > radiusKm / 100) continue;
    const distKm = haversineKm(lat, lng, peak.lat, peak.lng);
    if (distKm <= radiusKm) {
      const proximity = 1 - distKm / radiusKm;
      const elevFactor = clamp((peak.elevation - 1800) / 4500, 0.25, 1);
      const boost = proximity * elevFactor;
      if (boost > maxBoost) maxBoost = boost;
    }
  }
  return clamp(maxBoost, 0, 1);
}

function weightedMidpoint(
  lat1: number,
  lng1: number,
  w1: number,
  lat2: number,
  lng2: number,
  w2: number
): { lat: number; lng: number } {
  const total = w1 + w2 || 1;
  const f1 = w1 / total;
  const f2 = w2 / total;

  // Shortest-path longitude interpolation across antimeridian
  let dLng = lng2 - lng1;
  if (dLng > 180) dLng -= 360;
  if (dLng < -180) dLng += 360;

  return {
    lat: clamp(lat1 * f1 + lat2 * f2, -85, 85),
    lng: normalizeLng(lng1 + dLng * f2),
  };
}

/**
 * Advances all active waves by dtSec * speedMultiplier, applies wind drift,
 * cyclone rotation, DEK lake-effect charging/discharge, high-pressure suppression,
 * orographic mountain lift, and colliding cold/warm fronts.
 */
export function stepSimulation(
  waves: SimWave[],
  dtSec: number,
  windDirDeg: number | null,
  speedMultiplier: number
): { waves: SimWave[]; fronts: SimFrontZone[] } {
  const effectiveDt = Math.max(0, dtSec) * Math.max(0, speedMultiplier);

  const nextWaves: SimWave[] = [];
  for (let i = 0; i < waves.length; i += 1) {
    const w = waves[i];
    const nextAge = w.ageSec + effectiveDt;
    if (nextAge >= w.maxAgeSec) continue;

    // Asymptotic radial expansion reaching ~98% of maxRadiusKm by maxAgeSec
    const expandFactor = 1 - Math.exp(-0.08 * effectiveDt);
    const nextRadius = Math.min(
      w.maxRadiusKm,
      w.radiusKm + (w.maxRadiusKm - w.radiusKm) * expandFactor
    );

    let nextLat = w.lat;
    let nextLng = w.lng;
    if (windDirDeg !== null && effectiveDt > 0) {
      const distKm = WAVE_DRIFT_KM_PER_SEC * effectiveDt;
      const rad = windDirDeg * DEG_TO_RAD;
      const dLat = (distKm * Math.cos(rad)) / 111.32;
      const cosLat = Math.max(0.2, Math.cos(w.lat * DEG_TO_RAD));
      const dLng = (distKm * Math.sin(rad)) / (111.32 * cosLat);
      nextLat = clamp(w.lat + dLat, -85, 85);
      nextLng = normalizeLng(w.lng + dLng);
    }

    const overSea = isLikelyOverSea(nextLat, nextLng);
    let nextMoisture = w.moisture;
    let nextSeaCharge = w.seaMoistureCharge ?? 0;
    let nextLakeEffect = false;
    let nextRotationDeg = w.rotationDeg ?? 0;

    if (w.kind === 'cyclone') {
      // Cyclones spin counterclockwise in northern hemisphere, clockwise in southern
      const spinSign = nextLat >= 0 ? -1 : 1;
      nextRotationDeg =
        (nextRotationDeg + spinSign * CYCLONE_SPIN_DEG_PER_SEC * effectiveDt) %
        360;
      if (overSea) {
        nextMoisture = Math.min(1, w.moisture + 0.065 * effectiveDt);
      } else {
        nextMoisture = Math.max(0.32, w.moisture - 0.012 * effectiveDt);
      }
    } else if (w.kind === 'high_pressure') {
      nextMoisture = Math.max(0.02, w.moisture - 0.08 * effectiveDt);
      nextSeaCharge = 0;
    } else {
      if (overSea) {
        nextMoisture = Math.min(1, w.moisture + 0.045 * effectiveDt);
      } else {
        nextMoisture = Math.max(0.08, w.moisture - 0.008 * effectiveDt);
      }

      // DEK / Lake-Effect Snow: strong cold air charging over sea and dumping onto land
      if (w.kind === 'cold' && w.strength >= 0.8) {
        if (overSea) {
          nextSeaCharge = Math.min(1, nextSeaCharge + 0.12 * effectiveDt);
          nextLakeEffect = false;
        } else if (nextSeaCharge >= 0.32) {
          nextLakeEffect = true;
          if (nextMoisture < 0.92) {
            nextMoisture = Math.min(0.92, nextMoisture + 0.18 * effectiveDt);
          }
          nextSeaCharge = Math.max(0, nextSeaCharge - 0.04 * effectiveDt);
        } else {
          nextLakeEffect = false;
        }
      } else {
        nextSeaCharge = 0;
      }
    }

    const mountainProximity =
      w.kind === 'high_pressure'
        ? 0
        : computeOrographicProximity(nextLat, nextLng, nextRadius);
    const nextOrographic = clamp(
      mountainProximity > w.orographicBoost
        ? w.orographicBoost +
            (mountainProximity - w.orographicBoost) *
              Math.min(1, 0.45 * effectiveDt + 0.2)
        : w.orographicBoost - 0.06 * effectiveDt,
      0,
      1
    );

    nextWaves.push({
      ...w,
      lat: nextLat,
      lng: nextLng,
      radiusKm: nextRadius,
      moisture: nextMoisture,
      seaMoistureCharge: nextSeaCharge,
      lakeEffectActive: nextLakeEffect,
      rotationDeg: nextRotationDeg,
      ageSec: nextAge,
      overSea,
      orographicBoost: nextOrographic,
    });
  }

  // Detect colliding cold + warm pairs to spawn front zones
  const fronts: SimFrontZone[] = [];
  const coldWaves = nextWaves.filter((w) => w.kind === 'cold');
  const warmWaves = nextWaves.filter((w) => w.kind === 'warm');
  const highPressureWaves = nextWaves.filter(
    (w) => w.kind === 'high_pressure'
  );

  for (let c = 0; c < coldWaves.length; c += 1) {
    const cold = coldWaves[c];
    for (let m = 0; m < warmWaves.length; m += 1) {
      const warm = warmWaves[m];
      const distKm = haversineKm(cold.lat, cold.lng, warm.lat, warm.lng);
      const thresholdKm = (cold.radiusKm + warm.radiusKm) * 0.85;
      if (distKm >= thresholdKm) continue;

      const overlapRatio = clamp(1 - distKm / thresholdKm, 0.15, 1);
      const coldLife = clamp(1 - cold.ageSec / cold.maxAgeSec, 0.1, 1);
      const warmLife = clamp(1 - warm.ageSec / warm.maxAgeSec, 0.1, 1);
      const mid = weightedMidpoint(
        cold.lat,
        cold.lng,
        cold.strength,
        warm.lat,
        warm.lng,
        warm.strength
      );

      let intensity = clamp(
        (cold.strength + warm.strength) *
          0.5 *
          (0.45 + overlapRatio * 0.75) *
          Math.min(coldLife, warmLife),
        0.15,
        1.5
      );
      let radiusKm = Math.max(
        80,
        Math.min(cold.radiusKm, warm.radiusKm) * 0.72
      );

      // High-pressure systems inside/overlapping a front weaken or dissipate it
      for (let h = 0; h < highPressureWaves.length; h += 1) {
        const hp = highPressureWaves[h];
        const hpDist = haversineKm(mid.lat, mid.lng, hp.lat, hp.lng);
        if (hpDist < hp.radiusKm) {
          const hpProx = 1 - hpDist / hp.radiusKm;
          const hpLife = clamp(1 - hp.ageSec / hp.maxAgeSec, 0.1, 1);
          const suppression = clamp(
            hpProx * hpLife * hp.strength * 0.85,
            0,
            0.94
          );
          intensity *= 1 - suppression;
          radiusKm = Math.max(40, radiusKm * (1 - suppression * 0.45));
        }
      }

      if (intensity < 0.14) continue;

      const absLat = Math.abs(mid.lat);
      const isSnow =
        (absLat >= 44 && cold.strength >= warm.strength * 0.8) ||
        (absLat >= 32 && cold.strength >= warm.strength * 1.15) ||
        (absLat >= 25 &&
          cold.strength >= 1.35 &&
          cold.strength > warm.strength);

      fronts.push({
        id: `front-${cold.id}-${warm.id}`,
        lng: mid.lng,
        lat: mid.lat,
        radiusKm,
        intensity,
        isSnow,
      });
    }
  }

  return { waves: nextWaves, fronts };
}

/**
 * Computes physical baseline temperature (°C) from latitude, elevation (m),
 * and meteorological season using the standard 6.5°C/km lapse rate.
 */
export function getBaselineTemp(
  lat: number,
  elevationM: number,
  season: SimSeason
): number {
  const clampedLat = clamp(lat, -90, 90);
  const absLat = Math.abs(clampedLat);
  const sinLat = Math.sin(absLat * DEG_TO_RAD);
  const sin2 = sinLat * sinLat;
  const sin4 = sin2 * sin2;

  const annualSeaLevelTemp = 28 - 22 * sin2 - 18 * sin4;
  const hemisphereSign = clampedLat >= 0 ? 1 : -1;
  const seasonFactor =
    season === 'summer'
      ? 1
      : season === 'winter'
        ? -1
        : season === 'spring'
          ? -0.05
          : 0.05;
  const seasonalSwing = 12 * sinLat * seasonFactor * hemisphereSign;
  const lapseDrop = 0.0065 * Math.max(0, elevationM);

  return round1(annualSeaLevelTemp + seasonalSwing - lapseDrop);
}

interface LocalFieldSample {
  tempDelta: number;
  moistureScore: number;
  oroScore: number;
  windBoost: number;
  frontFactor: number;
  frontSnowBias: boolean;
  cycloneInfluence: number;
  highPressureInfluence: number;
}

function sampleTerrainWindEffect(
  lat: number,
  lng: number,
  windDirDeg: number | null
): {
  foehnWarmingC: number;
  foehnDryFraction: number;
  windwardOroBoost: number;
} {
  if (windDirDeg === null) {
    return { foehnWarmingC: 0, foehnDryFraction: 0, windwardOroBoost: 0 };
  }

  const upwindDir = (windDirDeg + 180) % 360;
  let maxFoehnWarming = 0;
  let maxFoehnDry = 0;
  let maxWindwardOro = 0;

  for (let i = 0; i < HIGH_PEAKS.length; i += 1) {
    const peak = HIGH_PEAKS[i];
    if (Math.abs(peak.lat - lat) > 2.2) continue;

    const distKm = haversineKm(peak.lat, peak.lng, lat, lng);
    if (distKm > FOEHN_SEARCH_RADIUS_KM || distKm < 10) continue;

    const vecDeg = bearingDeg(peak.lat, peak.lng, lat, lng);
    const elevFactor = clamp((peak.elevation - 2000) / 3000, 0.35, 1);

    // Downwind / leeward side (25–210 km behind the mountain within ±50° of windDirDeg)
    if (distKm >= 25 && distKm <= 210) {
      const leeDiff = angularDiffDeg(vecDeg, windDirDeg);
      if (leeDiff <= 50) {
        const alignFactor = 1 - (leeDiff / 50) * 0.45;
        const distFactor =
          distKm < 55
            ? clamp((distKm - 25) / 30, 0.25, 1)
            : clamp(1 - (distKm - 55) / 170, 0.2, 1);
        const foehnStrength = clamp(
          alignFactor * distFactor * (0.65 + 0.35 * elevFactor),
          0,
          1
        );
        const warming = 2.5 + 3.0 * foehnStrength;
        const dryFrac = 0.4 * foehnStrength;

        if (warming > maxFoehnWarming) maxFoehnWarming = warming;
        if (dryFrac > maxFoehnDry) maxFoehnDry = dryFrac;
      }
    }

    // Upwind / windward side (10–130 km before the mountain)
    if (distKm >= 10 && distKm <= 130) {
      const windwardDiff = angularDiffDeg(vecDeg, upwindDir);
      if (windwardDiff <= 50) {
        const alignFactor = 1 - (windwardDiff / 50) * 0.4;
        const distFactor = clamp(1 - (distKm - 10) / 130, 0.25, 1);
        const boost = 0.35 * alignFactor * distFactor * (0.6 + 0.4 * elevFactor);
        if (boost > maxWindwardOro) maxWindwardOro = boost;
      }
    }
  }

  return {
    foehnWarmingC: maxFoehnWarming,
    foehnDryFraction: maxFoehnDry,
    windwardOroBoost: maxWindwardOro,
  };
}

function sampleFieldAtPoint(
  lat: number,
  lng: number,
  waves: SimWave[],
  fronts: SimFrontZone[],
  windDirDeg: number | null = null
): LocalFieldSample {
  let coldDelta = 0;
  let warmDelta = 0;
  let moistureScore = 0;
  let moistureSuppression = 0;
  let oroScore = 0;
  let windBoost = 0;
  let cycloneInfluence = 0;
  let highPressureInfluence = 0;

  for (let i = 0; i < waves.length; i += 1) {
    const w = waves[i];
    const distKm = haversineKm(lat, lng, w.lat, w.lng);
    if (distKm >= w.radiusKm) continue;

    const radial = Math.pow(1 - distKm / w.radiusKm, 0.85);
    const life = clamp(1 - Math.pow(w.ageSec / w.maxAgeSec, 2.2), 0, 1);
    const influence = radial * life;

    if (w.kind === 'cold') {
      coldDelta += 18 * w.strength * influence;
      windBoost += (10 + w.strength * 14) * influence;
    } else if (w.kind === 'warm') {
      warmDelta += 16 * w.strength * influence;
      windBoost += (10 + w.strength * 14) * influence;
    } else if (w.kind === 'cyclone') {
      cycloneInfluence = Math.max(
        cycloneInfluence,
        clamp(influence * w.strength, 0, 1.5)
      );
      windBoost += 38 * influence * clamp(w.strength, 0.6, 1.5);
    } else if (w.kind === 'high_pressure') {
      highPressureInfluence = Math.max(
        highPressureInfluence,
        clamp(influence * w.strength, 0, 1.5)
      );
      moistureSuppression += 0.65 * influence * clamp(w.strength, 0.7, 1.5);
      warmDelta += 1.2 * influence;
    } else {
      windBoost += (10 + w.strength * 12) * influence;
    }

    if (w.kind !== 'high_pressure') {
      const moistWeight =
        w.kind === 'moisture' || w.kind === 'cyclone' || w.lakeEffectActive
          ? 1.15
          : 0.75;
      const moistureContribution =
        w.moisture *
        influence *
        moistWeight *
        (0.75 + w.strength * 0.25);
      moistureScore =
        Math.max(moistureScore, moistureContribution) +
        Math.min(moistureScore, moistureContribution) * 0.35;

      const dekOroBoost = w.lakeEffectActive ? 0.25 : 0;
      oroScore = Math.max(
        oroScore,
        (w.orographicBoost + dekOroBoost) * influence
      );
    }
  }

  let frontFactor = 0;
  let frontSnowBias = false;
  for (let i = 0; i < fronts.length; i += 1) {
    const f = fronts[i];
    const distKm = haversineKm(lat, lng, f.lat, f.lng);
    if (distKm >= f.radiusKm) continue;

    const radial = Math.pow(1 - distKm / f.radiusKm, 0.75);
    const contribution = radial * f.intensity;
    if (contribution > frontFactor) {
      frontFactor = contribution;
      frontSnowBias = f.isSnow;
    }
    windBoost += 18 * contribution;
  }

  // High pressure suppresses moisture and front activity
  if (highPressureInfluence > 0) {
    frontFactor *= Math.max(0, 1 - highPressureInfluence * 0.9);
  }
  moistureScore = Math.max(0, moistureScore - moistureSuppression);

  // Mountain Rain Shadow / Foehn Effect
  const terrain = sampleTerrainWindEffect(lat, lng, windDirDeg);
  if (terrain.foehnDryFraction > 0) {
    moistureScore *= 1 - terrain.foehnDryFraction;
  }
  oroScore = clamp(oroScore + terrain.windwardOroBoost, 0, 1);

  const cappedCold = Math.min(26, coldDelta);
  const cappedWarm = Math.min(24, warmDelta);

  return {
    tempDelta:
      cappedWarm - cappedCold - frontFactor * 2.5 + terrain.foehnWarmingC,
    moistureScore: clamp(moistureScore, 0, 1.5),
    oroScore,
    windBoost: Math.min(85, windBoost),
    frontFactor: clamp(frontFactor, 0, 1.5),
    frontSnowBias,
    cycloneInfluence,
    highPressureInfluence,
  };
}

/**
 * Evaluates simulated temperature (°C) at an arbitrary coordinate and elevation.
 */
export function evaluateSimulatedTempAt(
  lat: number,
  lng: number,
  elevationM: number,
  waves: SimWave[],
  fronts: SimFrontZone[],
  season: SimSeason,
  windDirDeg: number | null = null
): number {
  const sample = sampleFieldAtPoint(lat, lng, waves, fronts, windDirDeg);
  return round1(getBaselineTemp(lat, elevationM, season) + sample.tempDelta);
}

function computeApparentTemp(
  tempC: number,
  humidity: number,
  windSpeedKmh: number
): number {
  if (tempC <= 10 && windSpeedKmh >= 4.8) {
    const vPow = Math.pow(windSpeedKmh, 0.16);
    return round1(
      13.12 + 0.6215 * tempC - 11.37 * vPow + 0.3965 * tempC * vPow
    );
  }
  if (tempC >= 26 && humidity >= 40) {
    const heat = 0.04 * (tempC - 24) * ((humidity - 35) / 20);
    return round1(tempC + heat);
  }
  return round1(tempC - windSpeedKmh * 0.04 + (humidity - 50) * 0.015);
}

function resolveSimulatedWmoCode(
  tempC: number,
  sample: LocalFieldSample,
  elevationBoost = 0
): number {
  if (
    sample.highPressureInfluence >= 0.35 &&
    sample.cycloneInfluence < 0.35
  ) {
    return 0;
  }

  const effectiveWetness =
    sample.moistureScore +
    sample.oroScore * 0.4 +
    sample.frontFactor * 0.55 +
    elevationBoost;

  if (sample.cycloneInfluence >= 0.38) {
    if (tempC <= 0) return 73;
    return 95;
  }

  if (
    sample.frontFactor >= 0.48 ||
    (sample.frontFactor >= 0.28 && effectiveWetness >= 0.85)
  ) {
    return 95;
  }

  if (effectiveWetness >= 0.48) {
    if (tempC <= 0) {
      return effectiveWetness >= 0.82 ? 73 : 71;
    }
    return effectiveWetness >= 0.82 ? 63 : 61;
  }

  if (effectiveWetness >= 0.3) return 3;
  if (effectiveWetness >= 0.2) return 2;
  return 0;
}

/**
 * Computes simulated weather for a city without mutating caches or the input object.
 */
export function applySimulationToCity(
  city: WeatherData,
  waves: SimWave[],
  fronts: SimFrontZone[],
  season: SimSeason,
  windDirDeg: number | null = null
): WeatherData {
  const sample = sampleFieldAtPoint(
    city.lat,
    city.lng,
    waves,
    fronts,
    windDirDeg
  );
  const baseTemp = getBaselineTemp(city.lat, 50, season);
  const temperature = round1(baseTemp + sample.tempDelta);

  const seasonalHumidity =
    season === 'winter' ? 62 : season === 'summer' ? 44 : 54;
  const humidity = Math.round(
    clamp(
      seasonalHumidity +
        sample.moistureScore * 42 +
        sample.oroScore * 16 +
        sample.frontFactor * 26 -
        sample.highPressureInfluence * 28,
      15,
      100
    )
  );

  const windSpeed = round1(
    Math.max(4, 10 + sample.windBoost - sample.highPressureInfluence * 4)
  );
  const apparentTemperature = computeApparentTemp(
    temperature,
    humidity,
    windSpeed
  );
  const weatherCode = resolveSimulatedWmoCode(temperature, sample);

  const cycloneDrop =
    sample.cycloneInfluence > 0
      ? clamp(sample.cycloneInfluence * 26, 0, 30)
      : 0;
  const highPressureRise =
    sample.highPressureInfluence > 0
      ? clamp(12 + sample.highPressureInfluence * 10, 0, 22)
      : 0;
  const rawPressure =
    1014 -
    sample.frontFactor * 16 -
    sample.moistureScore * 6 -
    cycloneDrop +
    highPressureRise +
    (sample.tempDelta < -4 ? 4 : 0);

  const pressure = Math.round(
    sample.cycloneInfluence >= 0.38
      ? clamp(rawPressure, 978, 995)
      : sample.highPressureInfluence >= 0.35
        ? clamp(rawPressure, 1026, 1036)
        : clamp(rawPressure, 976, 1040)
  );

  return {
    ...city,
    temperature,
    apparentTemperature,
    humidity,
    windSpeed,
    pressure,
    weatherCode,
  };
}

/**
 * Computes simulated summit weather for a mountain peak, dynamically accumulating
 * or melting snowDepthCm based on summit temperature and moisture.
 */
export function applySimulationToPeak(
  item: PeakDisplayItem,
  waves: SimWave[],
  fronts: SimFrontZone[],
  season: SimSeason,
  dtSec: number,
  windDirDeg: number | null = null
): PeakDisplayItem {
  const { peak, weather } = item;
  const sample = sampleFieldAtPoint(
    peak.lat,
    peak.lng,
    waves,
    fronts,
    windDirDeg
  );
  const baseTemp = getBaselineTemp(peak.lat, peak.elevation, season);
  const temperature = round1(baseTemp + sample.tempDelta);

  const elevationCondensation = clamp((peak.elevation - 1800) / 8000, 0, 0.32);
  const humidity = Math.round(
    clamp(
      52 +
        elevationCondensation * 40 +
        sample.moistureScore * 42 +
        sample.oroScore * 20 +
        sample.frontFactor * 25 -
        sample.highPressureInfluence * 28,
      18,
      100
    )
  );

  const windSpeed = round1(
    Math.max(
      6,
      16 +
        (peak.elevation / 1000) * 3.5 +
        sample.windBoost * 1.15 -
        sample.highPressureInfluence * 5
    )
  );
  const apparentTemperature = computeApparentTemp(
    temperature,
    humidity,
    windSpeed
  );
  const weatherCode = resolveSimulatedWmoCode(
    temperature,
    sample,
    elevationCondensation
  );

  const prevSnowCm = weather?.snowDepthCm ?? 0;
  const dt = Math.max(0, dtSec);
  const isSnowing =
    temperature <= 0 &&
    (weatherCode === 71 || weatherCode === 73 || weatherCode === 95);

  let nextSnowCm = prevSnowCm;
  let snowfallCm = 0;

  if (isSnowing) {
    const rateCmPerSec = weatherCode === 73 || weatherCode === 95 ? 3.4 : 1.9;
    const added =
      rateCmPerSec *
      dt *
      (0.7 + sample.moistureScore * 0.65 + sample.oroScore * 0.5);
    nextSnowCm = round1(prevSnowCm + added);
    snowfallCm = round1(added);
  } else if (temperature > 1 && prevSnowCm > 0) {
    const meltCm = Math.min(prevSnowCm, (temperature - 1) * 0.32 * dt);
    nextSnowCm = round1(Math.max(0, prevSnowCm - meltCm));
  }

  const pressure = Math.round(
    1013 * Math.pow(1 - 2.25577e-5 * peak.elevation, 5.25588) -
      sample.frontFactor * 12 -
      sample.cycloneInfluence * 18 +
      sample.highPressureInfluence * 14
  );

  const nextWeather: WeatherData = weather
    ? {
        ...weather,
        temperature,
        apparentTemperature,
        humidity,
        windSpeed,
        pressure,
        weatherCode,
        snowDepthCm: nextSnowCm,
        snowfallCm,
      }
    : {
        cityId: peak.id,
        cityName: peak.name,
        country: peak.country,
        lat: peak.lat,
        lng: peak.lng,
        temperature,
        apparentTemperature,
        humidity,
        windSpeed,
        pressure,
        weatherCode,
        isDay: true,
        snowDepthCm: nextSnowCm,
        snowfallCm,
        fetchedAt: Date.now(),
        source: 'live',
      };

  return {
    peak,
    weather: nextWeather,
  };
}

/**
 * Generates a closed 32-vertex geodesic circle polygon on the WGS84 sphere.
 */
function buildGeodesicCircleRing(
  centerLng: number,
  centerLat: number,
  radiusKm: number,
  steps = 32
): GeoJSON.Position[] {
  const lat1 = centerLat * DEG_TO_RAD;
  const lng1 = centerLng * DEG_TO_RAD;
  const angularDist = radiusKm / EARTH_RADIUS_KM;
  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const sinAd = Math.sin(angularDist);
  const cosAd = Math.cos(angularDist);

  const coords: GeoJSON.Position[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const bearing = ((i % steps) / steps) * 2 * Math.PI;
    const lat2 = Math.asin(
      sinLat1 * cosAd + cosLat1 * sinAd * Math.cos(bearing)
    );
    const lng2 =
      lng1 +
      Math.atan2(
        Math.sin(bearing) * sinAd * cosLat1,
        cosAd - sinLat1 * Math.sin(lat2)
      );

    let degLng = lng2 * RAD_TO_DEG;
    // Unwrap relative to centerLng to avoid antimeridian polygon tearing
    while (degLng - centerLng > 180) degLng -= 360;
    while (degLng - centerLng < -180) degLng += 360;

    coords.push([degLng, clamp(lat2 * RAD_TO_DEG, -85, 85)]);
  }
  return coords;
}

function offsetCenter(
  lat: number,
  lng: number,
  bearingDegVal: number,
  distKm: number
): { lat: number; lng: number } {
  const rad = bearingDegVal * DEG_TO_RAD;
  const dLat = (distKm * Math.cos(rad)) / 111.32;
  const cosLat = Math.max(0.2, Math.cos(lat * DEG_TO_RAD));
  const dLng = (distKm * Math.sin(rad)) / (111.32 * cosLat);
  return {
    lat: clamp(lat + dLat, -85, 85),
    lng: normalizeLng(lng + dLng),
  };
}

/**
 * Builds GeoJSON polygon collections for active air-mass waves, cloud decks,
 * and precipitation/storm zones for MapLibre rendering.
 */
export function buildSimulatorGeoJson(
  waves: SimWave[],
  fronts: SimFrontZone[],
  season: SimSeason = 'winter',
  windDirDeg: number | null = null
): {
  wavesGeoJson: GeoJSON.FeatureCollection;
  cloudsGeoJson: GeoJSON.FeatureCollection;
  precipGeoJson: GeoJSON.FeatureCollection;
} {
  const waveFeatures: GeoJSON.Feature[] = [];
  const cloudFeatures: GeoJSON.Feature[] = [];
  const precipFeatures: GeoJSON.Feature[] = [];

  const getLocalSimTemp = (lat: number, lng: number, elevM = 100): number => {
    return evaluateSimulatedTempAt(
      lat,
      lng,
      elevM,
      waves,
      fronts,
      season,
      windDirDeg
    );
  };

  for (let i = 0; i < waves.length; i += 1) {
    const w = waves[i];
    const life = clamp(1 - Math.pow(w.ageSec / w.maxAgeSec, 1.8), 0.08, 1);
    const waveOpacity = round1(
      clamp(0.18 + life * 0.34 * Math.min(1.4, w.strength), 0.08, 0.62)
    );

    waveFeatures.push({
      type: 'Feature',
      properties: {
        id: w.id,
        kind: w.kind,
        opacity: waveOpacity,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [buildGeodesicCircleRing(w.lng, w.lat, w.radiusKm, 32)],
      },
    });

    if (w.kind === 'high_pressure') continue;

    // Cloud clusters driven by moisture + orographic lift
    const cloudStrength = clamp(
      (w.moisture * 0.85 + w.orographicBoost * 0.55) * life,
      0,
      1.2
    );
    if (cloudStrength >= 0.26) {
      const clusterOffsets = [
        { bearing: 0, distFrac: 0, radFrac: 0.68, opMul: 1.0 },
        { bearing: 45, distFrac: 0.32, radFrac: 0.46, opMul: 0.78 },
        { bearing: 215, distFrac: 0.28, radFrac: 0.42, opMul: 0.72 },
      ];
      for (let k = 0; k < clusterOffsets.length; k += 1) {
        const c = clusterOffsets[k];
        const center =
          c.distFrac === 0
            ? { lat: w.lat, lng: w.lng }
            : offsetCenter(w.lat, w.lng, c.bearing, w.radiusKm * c.distFrac);
        cloudFeatures.push({
          type: 'Feature',
          properties: {
            id: `${w.id}-cloud-${k}`,
            opacity: round1(
              clamp(cloudStrength * 0.46 * c.opMul, 0.1, 0.65)
            ),
          },
          geometry: {
            type: 'Polygon',
            coordinates: [
              buildGeodesicCircleRing(
                center.lng,
                center.lat,
                w.radiusKm * c.radFrac,
                32
              ),
            ],
          },
        });
      }
    }

    // Precipitation zones split by local simulated temperature: <= 0°C -> snow, > 0°C -> rain
    const precipIntensity = clamp(
      (w.moisture + w.orographicBoost * 0.45) * life,
      0,
      1.4
    );
    if (
      w.withMoisture ||
      w.moisture >= 0.46 ||
      w.kind === 'cyclone' ||
      w.lakeEffectActive ||
      precipIntensity >= 0.65
    ) {
      const subPatches = [
        { bearing: 0, distFrac: 0, radFrac: 0.42, opMul: 1.0 },
        { bearing: 0, distFrac: 0.42, radFrac: 0.36, opMul: 0.88 },
        { bearing: 90, distFrac: 0.42, radFrac: 0.36, opMul: 0.88 },
        { bearing: 180, distFrac: 0.42, radFrac: 0.36, opMul: 0.88 },
        { bearing: 270, distFrac: 0.42, radFrac: 0.36, opMul: 0.88 },
      ];

      for (let s = 0; s < subPatches.length; s += 1) {
        const p = subPatches[s];
        const pt =
          p.distFrac === 0
            ? { lat: w.lat, lng: w.lng }
            : offsetCenter(w.lat, w.lng, p.bearing, w.radiusKm * p.distFrac);
        const localTemp = getLocalSimTemp(pt.lat, pt.lng, 120);
        const precipKind: 'snow' | 'rain' | 'storm' =
          w.kind === 'cyclone' && localTemp > 0
            ? 'storm'
            : localTemp <= 0
              ? 'snow'
              : 'rain';

        precipFeatures.push({
          type: 'Feature',
          properties: {
            id: `${w.id}-precip-${s}`,
            precipKind,
            opacity: round1(
              clamp(precipIntensity * 0.38 * p.opMul, 0.14, 0.58)
            ),
          },
          geometry: {
            type: 'Polygon',
            coordinates: [
              buildGeodesicCircleRing(
                pt.lng,
                pt.lat,
                w.radiusKm * p.radFrac,
                24
              ),
            ],
          },
        });
      }

      // Localized orographic snow caps over high peaks inside moist waves when summit <= 0°C
      for (let m = 0; m < HIGH_PEAKS.length; m += 1) {
        const peak = HIGH_PEAKS[m];
        if (Math.abs(peak.lat - w.lat) > w.radiusKm / 100) continue;
        const distKm = haversineKm(w.lat, w.lng, peak.lat, peak.lng);
        if (distKm > w.radiusKm * 0.92) continue;
        const summitTemp = getLocalSimTemp(peak.lat, peak.lng, peak.elevation);
        if (summitTemp <= 0) {
          precipFeatures.push({
            type: 'Feature',
            properties: {
              id: `${w.id}-oro-snow-${m}`,
              precipKind: 'snow',
              opacity: round1(clamp(precipIntensity * 0.52, 0.25, 0.72)),
            },
            geometry: {
              type: 'Polygon',
              coordinates: [
                buildGeodesicCircleRing(peak.lng, peak.lat, 55, 20),
              ],
            },
          });
        }
      }
    }
  }

  // Front collision clouds and storm / rain / snow zones
  for (let i = 0; i < fronts.length; i += 1) {
    const f = fronts[i];
    cloudFeatures.push({
      type: 'Feature',
      properties: {
        id: `${f.id}-cloud`,
        opacity: round1(clamp(0.32 + f.intensity * 0.25, 0.25, 0.72)),
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          buildGeodesicCircleRing(f.lng, f.lat, f.radiusKm * 1.15, 32),
        ],
      },
    });

    const frontTemp = getLocalSimTemp(f.lat, f.lng, 150);
    const precipKind: 'rain' | 'snow' | 'storm' =
      f.intensity >= 0.58 ? 'storm' : frontTemp <= 0 || f.isSnow ? 'snow' : 'rain';

    precipFeatures.push({
      type: 'Feature',
      properties: {
        id: `${f.id}-precip`,
        precipKind,
        opacity: round1(clamp(0.28 + f.intensity * 0.34, 0.22, 0.78)),
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          buildGeodesicCircleRing(f.lng, f.lat, f.radiusKm * 0.85, 32),
        ],
      },
    });
  }

  return {
    wavesGeoJson: {
      type: 'FeatureCollection',
      features: waveFeatures,
    },
    cloudsGeoJson: {
      type: 'FeatureCollection',
      features: cloudFeatures,
    },
    precipGeoJson: {
      type: 'FeatureCollection',
      features: precipFeatures,
    },
  };
}
