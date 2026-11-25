const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const J2000_EPOCH_JD = 2451545.0;
const UNIX_EPOCH_JD = 2440587.5;
const MS_PER_DAY = 86_400_000;

export interface SubsolarPoint {
  lat: number;
  lng: number;
}

export interface NightTerminatorGeoJson {
  nightPolygon: GeoJSON.FeatureCollection;
  terminatorLine: GeoJSON.FeatureCollection;
}

export interface SunPosition {
  azimuthDeg: number;
  elevationDeg: number;
}

function normalizeDeg360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function normalizeDeg180(deg: number): number {
  const wrapped = normalizeDeg360(deg);
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface SolarEphemeris {
  declinationDeg: number;
  equationOfTimeMin: number;
}

/**
 * Computes solar declination and equation of time using J2000 low-precision
 * apparent solar coordinates (USNO Astronomical Almanac).
 */
function computeSolarEphemeris(date: Date): SolarEphemeris {
  const jd = date.getTime() / MS_PER_DAY + UNIX_EPOCH_JD;
  const d = jd - J2000_EPOCH_JD;

  // Mean anomaly and mean longitude of the Sun (degrees)
  const gDeg = normalizeDeg360(357.529 + 0.98560028 * d);
  const qDeg = normalizeDeg360(280.459 + 0.98564736 * d);
  const gRad = gDeg * DEG_TO_RAD;

  // Geocentric apparent ecliptic longitude and mean obliquity (degrees)
  const eclipticLngDeg = normalizeDeg360(
    qDeg + 1.915 * Math.sin(gRad) + 0.02 * Math.sin(2 * gRad),
  );
  const obliquityDeg = 23.439 - 0.00000036 * d;

  const eclipticLngRad = eclipticLngDeg * DEG_TO_RAD;
  const obliquityRad = obliquityDeg * DEG_TO_RAD;

  const sinDec = clamp(
    Math.sin(obliquityRad) * Math.sin(eclipticLngRad),
    -1,
    1,
  );
  const declinationDeg = Math.asin(sinDec) * RAD_TO_DEG;

  const raRad = Math.atan2(
    Math.cos(obliquityRad) * Math.sin(eclipticLngRad),
    Math.cos(eclipticLngRad),
  );
  const raDeg = normalizeDeg360(raRad * RAD_TO_DEG);

  // Equation of time in minutes: difference between mean and apparent solar longitude
  const eotDeg = normalizeDeg180(qDeg - raDeg);
  const equationOfTimeMin = eotDeg * 4;

  return { declinationDeg, equationOfTimeMin };
}

/**
 * Computes the subsolar latitude (solar declination) and longitude
 * from UTC time plus the equation of time.
 */
export function getSubsolarPoint(date: Date): { lat: number; lng: number } {
  const { declinationDeg, equationOfTimeMin } = computeSolarEphemeris(date);

  const utcMinutes =
    date.getUTCHours() * 60 +
    date.getUTCMinutes() +
    date.getUTCSeconds() / 60 +
    date.getUTCMilliseconds() / 60_000;

  // True solar noon occurs at 720 min; Earth rotates 0.25°/min westward
  const lng = normalizeDeg180((720 - utcMinutes - equationOfTimeMin) * 0.25);

  return { lat: declinationDeg, lng };
}

/**
 * Builds GeoJSON collections for the night hemisphere polygon and solar
 * terminator line across longitudes -180..+180 (step 3°), closed cleanly
 * toward +89.9° or -89.9° based on solar declination sign.
 */
export function buildNightPolygonGeoJson(date: Date): {
  nightPolygon: GeoJSON.FeatureCollection;
  terminatorLine: GeoJSON.FeatureCollection;
} {
  const { lat: declDeg, lng: subsolarLng } = getSubsolarPoint(date);

  // Guard against exact equinox (declination ≈ 0) where tan(decl) -> 0
  const safeDeclDeg =
    Math.abs(declDeg) < 0.05 ? (declDeg >= 0 ? 0.05 : -0.05) : declDeg;
  const tanDecl = Math.tan(safeDeclDeg * DEG_TO_RAD);

  const terminatorCoords: GeoJSON.Position[] = [];
  for (let lng = -180; lng <= 180; lng += 3) {
    const deltaLngRad = (lng - subsolarLng) * DEG_TO_RAD;
    const rawLat = Math.atan(-Math.cos(deltaLngRad) / tanDecl) * RAD_TO_DEG;
    // Keep strictly inside (-89.9, +89.9) so the ring never touches the pole edge
    const lat = clamp(rawLat, -89.85, 89.85);
    terminatorCoords.push([lng, lat]);
  }

  // Positive declination illuminates the North Pole -> night covers South (-89.9°)
  // Negative declination illuminates the South Pole -> night covers North (+89.9°)
  const poleLat = declDeg >= 0 ? -89.9 : 89.9;

  // Construct a counter-clockwise exterior ring without self-intersection
  const ring: GeoJSON.Position[] =
    poleLat < 0
      ? [
          [-180, poleLat],
          [180, poleLat],
          ...[...terminatorCoords].reverse(),
          [-180, poleLat],
        ]
      : [
          ...terminatorCoords,
          [180, poleLat],
          [-180, poleLat],
          terminatorCoords[0],
        ];

  const nightPolygon: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [ring],
        },
      },
    ],
  };

  const terminatorLine: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: terminatorCoords,
        },
      },
    ],
  };

  return { nightPolygon, terminatorLine };
}

/**
 * Computes local sun azimuth (0..360°, north=0, clockwise) and solar elevation
 * (-90..+90°) for an observer at (lat, lng) at the given date/time.
 */
export function getSunPositionForPoint(
  date: Date,
  lat: number,
  lng: number,
): { azimuthDeg: number; elevationDeg: number } {
  const { lat: declDeg, lng: subsolarLng } = getSubsolarPoint(date);

  const latRad = clamp(lat, -90, 90) * DEG_TO_RAD;
  const declRad = declDeg * DEG_TO_RAD;
  const hourAngleRad = normalizeDeg180(lng - subsolarLng) * DEG_TO_RAD;

  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const sinDecl = Math.sin(declRad);
  const cosDecl = Math.cos(declRad);
  const cosH = Math.cos(hourAngleRad);
  const sinH = Math.sin(hourAngleRad);

  const sinElev = clamp(sinLat * sinDecl + cosLat * cosDecl * cosH, -1, 1);
  const elevationDeg = Math.asin(sinElev) * RAD_TO_DEG;

  // Local ENU horizontal components toward the Sun: East (e) and North (n)
  const east = -cosDecl * sinH;
  const north = cosLat * sinDecl - sinLat * cosDecl * cosH;
  const azimuthDeg = normalizeDeg360(Math.atan2(east, north) * RAD_TO_DEG);

  return { azimuthDeg, elevationDeg };
}
