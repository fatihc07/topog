import type { LayerSpecification, SourceSpecification, StyleSpecification } from 'maplibre-gl';
import type { BaseLayerConfig, BaseLayerId, LandmarkPreset } from '../types/map';

export const BASE_LAYERS: BaseLayerConfig[] = [
  {
    id: 'opentopomap',
    name: 'Topoğrafik — OpenTopoMap',
    description: 'Eşyükselti eğrileri, kabartma gölgelendirme ve arazi detayları',
    category: 'Topoğrafik',
    tiles: [
      'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
      'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
      'https://c.tile.opentopomap.org/{z}/{x}/{y}.png',
    ],
    tileSize: 256,
    maxzoom: 17,
    attribution: '© OpenStreetMap katkıda bulunanlar, SRTM | Harita stili: © OpenTopoMap (CC-BY-SA)',
    previewGradient: 'linear-gradient(135deg, #d8e5c8 0%, #c6b89e 52%, #8fa876 100%)',
  },
  {
    id: 'esri-physical',
    name: 'Fiziksel Kabartma — Esri Physical',
    description: 'Doğal yer şekilleri, sıradağlar, ovalar ve okyanus tabanı',
    category: 'Fiziksel',
    tiles: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}',
    ],
    tileSize: 256,
    maxzoom: 8,
    attribution: '© Esri, US National Park Service',
    previewGradient: 'linear-gradient(135deg, #2d6a8e 0%, #7aa874 45%, #c8b282 100%)',
  },
  {
    id: 'esri-topo',
    name: 'Detaylı Topo — Esri Topo',
    description: 'Yüksek çözünürlüklü topoğrafik ve hidrografik harita',
    category: 'Topoğrafik',
    tiles: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    ],
    tileSize: 256,
    maxzoom: 19,
    attribution: '© Esri, HERE, Garmin, OpenStreetMap',
    previewGradient: 'linear-gradient(135deg, #e5e8df 0%, #b5c9a8 50%, #7ea7c4 100%)',
  },
  {
    id: 'osm-standard',
    name: 'OpenStreetMap Standart',
    description: 'Küresel yol ağı, yerleşimler ve coğrafi etiketler',
    category: 'Standart',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    tileSize: 256,
    maxzoom: 19,
    attribution: '© OpenStreetMap katkıda bulunanlar',
    previewGradient: 'linear-gradient(135deg, #f2efe9 0%, #aad3df 50%, #cdebb0 100%)',
  },
  {
    id: 'esri-imagery',
    name: 'Uydu Görüntüsü — Esri Imagery',
    description: 'Gerçek uydu ve hava fotoğrafı katmanı',
    category: 'Uydu',
    tiles: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    ],
    tileSize: 256,
    maxzoom: 19,
    attribution: '© Esri, Maxar, Earthstar Geographics',
    previewGradient: 'linear-gradient(135deg, #1b3448 0%, #2e5339 50%, #6b5b45 100%)',
  },
];

export const BASE_LAYER_MAP: Record<BaseLayerId, BaseLayerConfig> = BASE_LAYERS.reduce(
  (acc, layer) => {
    acc[layer.id] = layer;
    return acc;
  },
  {} as Record<BaseLayerId, BaseLayerConfig>
);

export const TERRARIUM_DEM_TILES = [
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
];

export const REALTIME_CLOUDS_TILES = ['cloud-ir://{z}/{x}/{y}'];

export const FEATURED_LANDMARKS: LandmarkPreset[] = [
  {
    id: 'world',
    name: 'Dünya Geneli',
    region: 'Küresel',
    lng: 20,
    lat: 24,
    zoom: 2.3,
    pitch: 0,
    bearing: 0,
  },
  {
    id: 'turkey',
    name: 'Türkiye',
    region: 'Anadolu',
    lng: 35.2,
    lat: 39.0,
    zoom: 5.6,
    pitch: 0,
    bearing: 0,
  },
  {
    id: 'agri',
    name: 'Ağrı Dağı',
    region: '5.137 m · Türkiye',
    lng: 44.298,
    lat: 39.702,
    zoom: 11.5,
    pitch: 60,
    bearing: -25,
  },
  {
    id: 'everest',
    name: 'Everest & Himalayalar',
    region: '8.849 m · Nepal/Çin',
    lng: 86.925,
    lat: 27.988,
    zoom: 11.2,
    pitch: 62,
    bearing: 20,
  },
  {
    id: 'alps',
    name: 'Alpler / Mont Blanc',
    region: '4.808 m · Avrupa',
    lng: 6.865,
    lat: 45.832,
    zoom: 11.5,
    pitch: 58,
    bearing: 35,
  },
  {
    id: 'grand-canyon',
    name: 'Büyük Kanyon',
    region: 'Arizona · ABD',
    lng: -112.113,
    lat: 36.107,
    zoom: 11.8,
    pitch: 60,
    bearing: -40,
  },
  {
    id: 'aconcagua',
    name: 'And Dağları / Aconcagua',
    region: '6.961 m · Arjantin',
    lng: -70.011,
    lat: -32.653,
    zoom: 11.2,
    pitch: 58,
    bearing: 15,
  },
];

export function buildInitialStyle(defaultLayer: BaseLayerId): StyleSpecification {
  const sources: Record<string, SourceSpecification> = {};
  const layers: LayerSpecification[] = [
    {
      id: 'background-ocean',
      type: 'background',
      paint: {
        'background-color': '#0b1622',
      },
    },
  ];

  for (const cfg of BASE_LAYERS) {
    sources[`source-${cfg.id}`] = {
      type: 'raster',
      tiles: cfg.tiles,
      tileSize: cfg.tileSize,
      maxzoom: cfg.maxzoom,
      attribution: cfg.attribution,
    };

    layers.push({
      id: cfg.id,
      type: 'raster',
      source: `source-${cfg.id}`,
      layout: {
        visibility: cfg.id === defaultLayer ? 'visible' : 'none',
      },
      paint: {
        'raster-fade-duration': 200,
      },
    });
  }

  // Two separate raster-dem sources avoid MapLibre shared-DEM artifacts
  sources['terrain-dem'] = {
    type: 'raster-dem',
    tiles: TERRARIUM_DEM_TILES,
    tileSize: 256,
    maxzoom: 15,
    encoding: 'terrarium',
  };

  sources['hillshade-dem'] = {
    type: 'raster-dem',
    tiles: TERRARIUM_DEM_TILES,
    tileSize: 256,
    maxzoom: 15,
    encoding: 'terrarium',
  };

  layers.push({
    id: 'hillshade-overlay',
    type: 'hillshade',
    source: 'hillshade-dem',
    layout: {
      visibility: 'none',
    },
    paint: {
      'hillshade-illumination-direction': 315,
      'hillshade-exaggeration': 0.55,
      'hillshade-shadow-color': '#0b1320',
      'hillshade-highlight-color': '#fff4dc',
      'hillshade-accent-color': '#1e2f42',
    },
  });

  sources['source-clouds-live'] = {
    type: 'raster',
    tiles: REALTIME_CLOUDS_TILES,
    tileSize: 256,
    maxzoom: 8,
    attribution: '© SSEC RealEarth (Global IR Uydu)',
  };

  layers.push({
    id: 'clouds-overlay',
    type: 'raster',
    source: 'source-clouds-live',
    layout: {
      visibility: 'none',
    },
    paint: {
      'raster-opacity': 0.8,
      'raster-fade-duration': 200,
    },
  });

  return {
    version: 8,
    sources,
    layers,
  };
}
