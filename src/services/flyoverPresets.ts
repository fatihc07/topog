export interface FlyoverPreset {
  id: string;
  name: string;
  subtitle: string;
  lng: number;
  lat: number;
  zoom: number;
  pitch: number;
  speed: number;
}

export const FLYOVER_PRESETS: FlyoverPreset[] = [
  {
    id: 'agri-dagi',
    name: 'Ağrı Dağı',
    subtitle: '5.137 m · Türkiye',
    lng: 44.298,
    lat: 39.702,
    zoom: 11.8,
    pitch: 62,
    speed: 1,
  },
  {
    id: 'kackarlar',
    name: 'Kaçkarlar',
    subtitle: '3.932 m · Doğu Karadeniz',
    lng: 41.161,
    lat: 40.836,
    zoom: 12.0,
    pitch: 64,
    speed: 1,
  },
  {
    id: 'erciyes-dagi',
    name: 'Erciyes Dağı',
    subtitle: '3.917 m · Kayseri',
    lng: 35.447,
    lat: 38.532,
    zoom: 12.0,
    pitch: 62,
    speed: 1,
  },
  {
    id: 'everest-himalayalar',
    name: 'Everest & Himalayalar',
    subtitle: '8.849 m · Nepal/Çin',
    lng: 86.925,
    lat: 27.988,
    zoom: 11.5,
    pitch: 65,
    speed: 1,
  },
  {
    id: 'alpler-mont-blanc',
    name: 'Alpler / Mont Blanc',
    subtitle: '4.808 m · Fransa/İtalya',
    lng: 6.865,
    lat: 45.833,
    zoom: 11.8,
    pitch: 62,
    speed: 1,
  },
  {
    id: 'buyuk-kanyon',
    name: 'Büyük Kanyon',
    subtitle: 'Arizona · ABD',
    lng: -112.113,
    lat: 36.107,
    zoom: 12.2,
    pitch: 64,
    speed: 1,
  },
];
