export interface CountryHoverInfo {
  id: number;
  iso: string;
  nameTr: string;
  nameEn: string;
  continent: string;
  flag: string;
}

let cachedGeoJson: GeoJSON.FeatureCollection | null = null;
let inflightPromise: Promise<GeoJSON.FeatureCollection> | null = null;

export function isoToFlagEmoji(iso: string): string {
  if (!/^[A-Z]{2}$/.test(iso)) return '';
  const base = 0x1f1e6 - 65;
  return String.fromCodePoint(
    base + iso.charCodeAt(0),
    base + iso.charCodeAt(1)
  );
}

export async function loadCountriesGeoJson(): Promise<GeoJSON.FeatureCollection> {
  if (cachedGeoJson) return cachedGeoJson;
  if (inflightPromise) return inflightPromise;

  const url = `${import.meta.env.BASE_URL}data/countries.geojson`;
  inflightPromise = fetch(url)
    .then(async (res) => {
      if (!res.ok) {
        throw new Error(`Failed to load countries GeoJSON (${res.status})`);
      }
      const data = (await res.json()) as GeoJSON.FeatureCollection;
      cachedGeoJson = data;
      return data;
    })
    .finally(() => {
      inflightPromise = null;
    });

  return inflightPromise;
}
