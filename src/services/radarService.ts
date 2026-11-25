import type { RadarFrame } from '../types/weather';

interface RainViewerResponse {
  host?: string;
  radar?: {
    past?: Array<{ time: number; path: string }>;
  };
}

export async function fetchRainViewerFrames(
  signal?: AbortSignal
): Promise<RadarFrame[]> {
  try {
    const response = await fetch(
      'https://api.rainviewer.com/public/weather-maps.json',
      {
        signal,
        headers: { Accept: 'application/json' },
      }
    );

    if (!response.ok) return [];
    const data = (await response.json()) as RainViewerResponse;
    const host = data.host || 'https://tilecache.rainviewer.com';
    const past = data.radar?.past;
    if (!Array.isArray(past)) return [];

    return past
      .filter(
        (item): item is { time: number; path: string } =>
          typeof item?.time === 'number' && typeof item?.path === 'string'
      )
      .map((item) => ({
        time: item.time,
        path: item.path,
        tileUrl: `${host}${item.path}/256/{z}/{x}/{y}/2/1_1.png`,
      }));
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    return [];
  }
}
