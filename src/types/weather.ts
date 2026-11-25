export interface CityRecord {
  id: string;
  name: string;
  country: string;
  lat: number;
  lng: number;
  pop: number;
  isLocal?: boolean;
}

export interface WeatherData {
  cityId: string;
  cityName: string;
  country: string;
  lat: number;
  lng: number;
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  windSpeed: number;
  pressure: number | null;
  weatherCode: number;
  isDay: boolean;
  fetchedAt: number;
  source: 'live' | 'cache';
}

export interface ViewportBounds {
  west: number;
  south: number;
  east: number;
  north: number;
  centerLng: number;
  centerLat: number;
  zoom: number;
}

export interface WeatherSyncSummary {
  visibleCount: number;
  fromCacheCount: number;
  fetchedCount: number;
  loading: boolean;
}

export interface RadarFrame {
  time: number;
  path: string;
  tileUrl: string;
}

export interface PeakRecord {
  id: string;
  name: string;
  country: string;
  lat: number;
  lng: number;
  elevation: number;
}

export interface PeakDisplayItem {
  peak: PeakRecord;
  weather: WeatherData | null;
}


