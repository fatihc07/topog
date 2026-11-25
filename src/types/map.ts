import type { MarineData } from '../services/marineService';

export type BaseLayerId =
  | 'opentopomap'
  | 'esri-physical'
  | 'esri-topo'
  | 'osm-standard'
  | 'esri-imagery';

export interface BaseLayerConfig {
  id: BaseLayerId;
  name: string;
  description: string;
  category: 'Fiziksel' | 'Topoğrafik' | 'Standart' | 'Uydu';
  tiles: string[];
  tileSize: number;
  maxzoom: number;
  attribution: string;
  previewGradient: string;
}

export interface LandmarkPreset {
  id: string;
  name: string;
  region: string;
  lng: number;
  lat: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

export interface SearchResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  type: string;
  class: string;
}

export interface TelemetryState {
  lng: number | null;
  lat: number | null;
  elevation: number | null;
  zoom: number;
  pitch: number;
  bearing: number;
}

export interface InspectedPoint {
  lng: number;
  lat: number;
  elevation: number | null;
  placeName: string | null;
  marine?: MarineData | null;
  loading: boolean;
}

export interface FlyTarget {
  lng: number;
  lat: number;
  zoom?: number;
  pitch?: number;
  bearing?: number;
  inspect?: boolean;
  placeName?: string;
  timestamp: number;
}
