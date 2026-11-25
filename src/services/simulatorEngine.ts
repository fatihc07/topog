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
  let normalized = ((lng + 180) % 360 + 360) % 360 - 180;
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
 * Creates a new simulated atmospheric air mass / wave at the given coordinates.
 */
export function createSimWave(
  kind: SimWaveKind,
  lng: number,
  lat: number,
  strength = 1
): SimWave {
  const clampedStrength = clamp(strength, 0.2, 2.5);
  const clampedLat = clamp(lat, -85, 85);
  const normLng = normalizeLng(lng);
  const initialMoisture =
    kind === 'moisture' ? 0.85 : kind === 'cold' ? 0.35 : 0.2;

  waveCounter += 1;

  return {
    id: `sim-wave-${Date.now()}-${waveCounter}`,
    kind,
    lng: normLng,
    lat: clampedLat,
    originLng: normLng,
    originLat: clampedLat,
    radiusKm: INITIAL_RADIUS_KM,
    maxRadiusKm: 650 + clampedStrength * 240,
    strength: clampedStrength,
    moisture: initialMoisture,
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
 * ocean moisture pickup, orographic mountain lift, and detects cold/warm fronts.
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
    if (overSea) {
      nextMoisture = Math.min(1, w.moisture + 0.045 * effectiveDt);
    } else {
      nextMoisture = Math.max(0.08, w.moisture - 0.008 * effectiveDt);
    }

    const mountainProximity = computeOrographicProximity(
      nextLat,
      nextLng,
      nextRadius
    );
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
      ageSec: nextAge,
      overSea,
      orographicBoost: nextOrographic,
    });
  }

  // Detect colliding cold + warm pairs to spawn front zones
  const fronts: SimFrontZone[] = [];
  const coldWaves = nextWaves.filter((w) => w.kind === 'cold');
  const warmWaves = nextWaves.filter((w) => w.kind === 'warm');

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

      const intensity = clamp(
        ((cold.strength + warm.strength) * 0.5) *
          (0.45 + overlapRatio * 0.75) *
          Math.min(coldLife, warmLife),
        0.15,
        1.5
      );
      const radiusKm = Math.max(
        80,
        Math.min(cold.radiusKm, warm.radiusKm) * 0.72
      );

      const absLat = Math.abs(mid.lat);
      const isSnow =
        (absLat >= 44 && cold.strength >= warm.strength * 0.8) ||
        (absLat >= 32 && cold.strength >= warm.strength * 1.15) ||
        (absLat >= 25 && cold.strength >= 1.35 && cold.strength > warm.strength);

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
}

function sampleFieldAtPoint(
  lat: number,
  lng: number,
  waves: SimWave[],
  fronts: SimFrontZone[]
): LocalFieldSample {
  let coldDelta = 0;
  let warmDelta = 0;
  let moistureScore = 0;
  let oroScore = 0;
  let windBoost = 0;

  for (let i = 0; i < waves.length; i += 1) {
    const w = waves[i];
    const distKm = haversineKm(lat, lng, w.lat, w.lng);
    if (distKm >= w.radiusKm) continue;

    const radial = Math.pow(1 - distKm / w.radiusKm, 0.85);
    const life = clamp(1 - Math.pow(w.ageSec / w.maxAgeSec, 2.2), 0, 1);
    const influence = radial * life;

    if (w.kind === 'cold') {
      coldDelta += 18 * w.strength * influence;
    } else if (w.kind === 'warm') {
      warmDelta += 16 * w.strength * influence;
    }

    const moistureContribution =
      w.moisture * influence * (w.kind === 'moisture' ? 1.15 : 0.75) *
      (0.75 + w.strength * 0.25);
    moistureScore = Math.max(
      moistureScore,
      moistureContribution
    ) + Math.min(moistureScore, moistureContribution) * 0.35;

    oroScore = Math.max(oroScore, w.orographicBoost * influence);
    windBoost += (10 + w.strength * 14) * influence;
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

  const cappedCold = Math.min(26, coldDelta);
  const cappedWarm = Math.min(24, warmDelta);

  return {
    tempDelta: cappedWarm - cappedCold - frontFactor * 2.5,
    moistureScore: clamp(moistureScore, 0, 1.5),
    oroScore: clamp(oroScore, 0, 1),
    windBoost: Math.min(65, windBoost),
    frontFactor: clamp(frontFactor, 0, 1.5),
    frontSnowBias,
  };
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
  const effectiveWetness =
    sample.moistureScore +
    sample.oroScore * 0.4 +
    sample.frontFactor * 0.55 +
    elevationBoost;

  if (
    sample.frontFactor >= 0.48 ||
    (sample.frontFactor >= 0.28 && effectiveWetness >= 0.85)
  ) {
    return 95;
  }

  if (effectiveWetness >= 0.56) {
    if (tempC <= 1) {
      return effectiveWetness >= 0.85 ? 73 : 71;
    }
    return effectiveWetness >= 0.85 ? 63 : 61;
  }

  if (effectiveWetness >= 0.34) return 3;
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
  season: SimSeason
): WeatherData {
  const sample = sampleFieldAtPoint(city.lat, city.lng, waves, fronts);
  const baseTemp = getBaselineTemp(city.lat, 50, season);
  const temperature = round1(baseTemp + sample.tempDelta);

  const seasonalHumidity =
    season === 'winter'
      ? 62
      : season === 'summer'
        ? 44
        : 54;
  const humidity = Math.round(
    clamp(
      seasonalHumidity +
        sample.moistureScore * 42 +
        sample.oroScore * 16 +
        sample.frontFactor * 26,
      15,
      100
    )
  );

  const windSpeed = round1(10 + sample.windBoost);
  const apparentTemperature = computeApparentTemp(
    temperature,
    humidity,
    windSpeed
  );
  const weatherCode = resolveSimulatedWmoCode(temperature, sample);
  const pressure = Math.round(
    1014 -
      sample.frontFactor * 18 -
      sample.moistureScore * 8 +
      (sample.tempDelta < -4 ? 6 : 0)
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
  dtSec: number
): PeakDisplayItem {
  const { peak, weather } = item;
  const sample = sampleFieldAtPoint(peak.lat, peak.lng, waves, fronts);
  const baseTemp = getBaselineTemp(peak.lat, peak.elevation, season);
  const temperature = round1(baseTemp + sample.tempDelta);

  const elevationCondensation = clamp((peak.elevation - 1800) / 8000, 0, 0.32);
  const humidity = Math.round(
    clamp(
      52 +
        elevationCondensation * 40 +
        sample.moistureScore * 42 +
        sample.oroScore * 20 +
        sample.frontFactor * 25,
      18,
      100
    )
  );

  const windSpeed = round1(
    16 + (peak.elevation / 1000) * 3.5 + sample.windBoost * 1.15
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
    temperature <= 1 && (weatherCode === 71 || weatherCode === 73 || weatherCode === 95);

  let nextSnowCm = prevSnowCm;
  let snowfallCm = 0;

  if (isSnowing) {
    const rateCmPerSec = weatherCode === 73 || weatherCode === 95 ? 1.4 : 0.75;
    const added = rateCmPerSec * dt * (0.7 + sample.moistureScore * 0.6);
    nextSnowCm = round1(prevSnowCm + added);
    snowfallCm = round1(added);
  } else if (temperature > 2 && prevSnowCm > 0) {
    const meltCm = Math.min(prevSnowCm, (temperature - 2) * 0.25 * dt);
    nextSnowCm = round1(Math.max(0, prevSnowCm - meltCm));
  }

  const pressure = Math.round(
    1013 * Math.pow(1 - (2.25577e-5 * peak.elevation), 5.25588) -
      sample.frontFactor * 12
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
  bearingDeg: number,
  distKm: number
): { lat: number; lng: number } {
  const rad = bearingDeg * DEG_TO_RAD;
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
  fronts: SimFrontZone[]
): {
  wavesGeoJson: GeoJSON.FeatureCollection;
  cloudsGeoJson: GeoJSON.FeatureCollection;
  precipGeoJson: GeoJSON.FeatureCollection;
} {
  const waveFeatures: GeoJSON.Feature[] = [];
  const cloudFeatures: GeoJSON.Feature[] = [];
  const precipFeatures: GeoJSON.Feature[] = [];

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

    // Precipitation zones from wet air masses or mountain-forced condensation
    const precipIntensity = clamp(
      (w.moisture + w.orographicBoost * 0.45) * life,
      0,
      1.4
    );
    if (
      (w.kind === 'moisture' && precipIntensity >= 0.45) ||
      precipIntensity >= 0.72
    ) {
      const isColdSnow =
        w.kind === 'cold' ||
        (Math.abs(w.lat) >= 48 && w.kind !== 'warm') ||
        (w.orographicBoost >= 0.45 && Math.abs(w.lat) >= 34);
      precipFeatures.push({
        type: 'Feature',
        properties: {
          id: `${w.id}-precip`,
          precipKind: isColdSnow ? 'snow' : 'rain',
          opacity: round1(clamp(precipIntensity * 0.42, 0.14, 0.62)),
        },
        geometry: {
          type: 'Polygon',
          coordinates: [
            buildGeodesicCircleRing(w.lng, w.lat, w.radiusKm * 0.56, 32),
          ],
        },
      });
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

    const precipKind: 'rain' | 'snow' | 'storm' =
      f.intensity >= 0.58 ? 'storm' : f.isSnow ? 'snow' : 'rain';

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
