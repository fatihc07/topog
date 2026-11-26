import type { WeatherData } from './weather';

export interface CompareTarget {
  id: string;
  kind: 'city' | 'peak';
  weather: WeatherData;
  elevationMeters?: number;
}
