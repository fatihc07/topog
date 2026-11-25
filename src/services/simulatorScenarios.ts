import type { SimScenario } from '../types/simulator';

/**
 * Curated Turkish and regional atmospheric preset scenarios for one-click
 * sandbox experiments in simulator mode.
 */
export const SIMULATOR_SCENARIOS: SimScenario[] = [
  {
    id: 'siberian-dek',
    name: 'Sibirya DEK Karı',
    badge: '❄️ DEK',
    description:
      'Karadeniz üzerinden nem yüklenen güçlü Sibirya soğuk dalgaları Kuzey Anadolu kıyılarına yoğun deniz etkili kar (DEK) yağışı bırakır.',
    season: 'winter',
    windDirDeg: 180,
    camera: { lng: 33.5, lat: 41.0, zoom: 5.6 },
    waves: [
      {
        kind: 'cold',
        lng: 33.2,
        lat: 43.2,
        strength: 1.35,
        withMoisture: false,
      },
      {
        kind: 'cold',
        lng: 38.5,
        lat: 42.6,
        strength: 1.25,
        withMoisture: false,
      },
      {
        kind: 'cold',
        lng: 29.5,
        lat: 42.2,
        strength: 1.15,
        withMoisture: true,
      },
    ],
  },
  {
    id: 'sahara-heat',
    name: 'Sahra Sıcağı',
    badge: '🔥 Sıcak',
    description:
      'Libya ve Mısır üzerinden kuzeydoğuya taşınan güçlü kuru sıcak hava dalgaları Anadolu’da aşırı sıcaklık ve düşük nem oluşturur.',
    season: 'summer',
    windDirDeg: 25,
    camera: { lng: 32.0, lat: 36.5, zoom: 5.0 },
    waves: [
      {
        kind: 'warm',
        lng: 21.5,
        lat: 29.8,
        strength: 1.45,
        withMoisture: false,
      },
      {
        kind: 'warm',
        lng: 29.5,
        lat: 29.2,
        strength: 1.35,
        withMoisture: false,
      },
      {
        kind: 'warm',
        lng: 31.8,
        lat: 33.5,
        strength: 1.2,
        withMoisture: false,
      },
    ],
  },
  {
    id: 'medicane',
    name: 'Akdeniz Siklonu',
    badge: '🌀 Siklon',
    description:
      'Doğu Akdeniz’de derinleşen alçak basınç siklonu (L) ve nemli kütle, güney kıyılara kuvvetli rüzgar ve sağanak/fırtına taşır.',
    season: 'autumn',
    windDirDeg: 45,
    camera: { lng: 31.2, lat: 36.2, zoom: 5.8 },
    waves: [
      {
        kind: 'cyclone',
        lng: 28.8,
        lat: 34.8,
        strength: 1.35,
        withMoisture: true,
      },
      {
        kind: 'moisture',
        lng: 32.6,
        lat: 34.4,
        strength: 1.15,
        withMoisture: true,
      },
    ],
  },
  {
    id: 'balkan-front',
    name: 'Balkan Cephesi',
    badge: '⛈️ Cephe',
    description:
      'Balkanlar’dan güneydoğuya inen soğuk ve nemli kütle, Batı Anadolu’daki sıcak hava ile çarpışarak şiddetli cephe fırtınası üretir.',
    season: 'spring',
    windDirDeg: 135,
    camera: { lng: 28.5, lat: 40.0, zoom: 5.8 },
    waves: [
      {
        kind: 'cold',
        lng: 25.2,
        lat: 42.1,
        strength: 1.25,
        withMoisture: true,
      },
      {
        kind: 'warm',
        lng: 29.0,
        lat: 38.6,
        strength: 1.2,
        withMoisture: false,
      },
    ],
  },
];
