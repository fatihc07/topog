import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import {
  WEATHER_MIN_ZOOM,
  getVisibleCities,
  hasCityNearPoint,
} from '../services/cityIndex';
import { fetchMarineBatch } from '../services/marineService';
import {
  PEAKS_MIN_ZOOM,
  fetchOverpassPeaks,
  fetchPeakWeatherBatch,
  getVisibleLocalPeaks,
  selectNonOverlappingPeaks,
} from '../services/peakService';
import {
  SEAS_MIN_ZOOM,
  getVisibleSeaPoints,
  type SeaDisplayItem,
} from '../services/seaIndex';
import {
  fetchWeatherForCities,
  resolveLocalCityAtCenter,
} from '../services/weatherService';
import type {
  CityRecord,
  PeakDisplayItem,
  ViewportBounds,
  WeatherData,
  WeatherSyncSummary,
} from '../types/weather';

export interface UseViewportDataSyncOptions {
  weatherEnabled: boolean;
  peaksEnabled: boolean;
  seasEnabled: boolean;
  onCacheUpdated: () => void;
  onWeatherCleared?: () => void;
  onPeaksCleared?: () => void;
  onSeasCleared?: () => void;
}

export interface UseViewportDataSyncResult {
  viewportBounds: ViewportBounds | null;
  lastBoundsRef: MutableRefObject<ViewportBounds | null>;
  weatherItems: WeatherData[];
  setWeatherItems: Dispatch<SetStateAction<WeatherData[]>>;
  peakItems: PeakDisplayItem[];
  setPeakItems: Dispatch<SetStateAction<PeakDisplayItem[]>>;
  seaItems: SeaDisplayItem[];
  setSeaItems: Dispatch<SetStateAction<SeaDisplayItem[]>>;
  weatherSummary: WeatherSyncSummary;
  syncWeatherForBounds: (
    bounds: ViewportBounds,
    enabled: boolean
  ) => Promise<void>;
  syncPeaksForBounds: (
    bounds: ViewportBounds,
    enabled: boolean
  ) => Promise<void>;
  syncSeasForBounds: (
    bounds: ViewportBounds,
    enabled: boolean
  ) => Promise<void>;
  handleViewportChange: (bounds: ViewportBounds) => void;
  resyncAllActive: () => void;
}

const VIEWPORT_SYNC_DEBOUNCE_MS = 250;

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (typeof err === 'object' &&
      err !== null &&
      'name' in err &&
      (err as { name?: unknown }).name === 'AbortError')
  );
}

export function useViewportDataSync(
  options: UseViewportDataSyncOptions
): UseViewportDataSyncResult {
  const {
    weatherEnabled,
    peaksEnabled,
    seasEnabled,
    onCacheUpdated,
    onWeatherCleared,
    onPeaksCleared,
    onSeasCleared,
  } = options;

  const weatherAbortRef = useRef<AbortController | null>(null);
  const peaksAbortRef = useRef<AbortController | null>(null);
  const seasAbortRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const lastBoundsRef = useRef<ViewportBounds | null>(null);

  const onCacheUpdatedRef = useRef(onCacheUpdated);
  const onWeatherClearedRef = useRef(onWeatherCleared);
  const onPeaksClearedRef = useRef(onPeaksCleared);
  const onSeasClearedRef = useRef(onSeasCleared);
  const weatherEnabledRef = useRef(weatherEnabled);
  const peaksEnabledRef = useRef(peaksEnabled);
  const seasEnabledRef = useRef(seasEnabled);

  onCacheUpdatedRef.current = onCacheUpdated;
  onWeatherClearedRef.current = onWeatherCleared;
  onPeaksClearedRef.current = onPeaksCleared;
  onSeasClearedRef.current = onSeasCleared;
  weatherEnabledRef.current = weatherEnabled;
  peaksEnabledRef.current = peaksEnabled;
  seasEnabledRef.current = seasEnabled;

  const [viewportBounds, setViewportBounds] = useState<ViewportBounds | null>(
    null
  );
  const [weatherItems, setWeatherItems] = useState<WeatherData[]>([]);
  const [peakItems, setPeakItems] = useState<PeakDisplayItem[]>([]);
  const [seaItems, setSeaItems] = useState<SeaDisplayItem[]>([]);
  const [weatherSummary, setWeatherSummary] = useState<WeatherSyncSummary>({
    visibleCount: 0,
    fromCacheCount: 0,
    fetchedCount: 0,
    loading: false,
  });

  const syncWeatherForBounds = useCallback(
    async (bounds: ViewportBounds, enabled: boolean) => {
      weatherAbortRef.current?.abort();

      if (!enabled || bounds.zoom < WEATHER_MIN_ZOOM) {
        setWeatherItems([]);
        setWeatherSummary({
          visibleCount: 0,
          fromCacheCount: 0,
          fetchedCount: 0,
          loading: false,
        });
        return;
      }

      const controller = new AbortController();
      weatherAbortRef.current = controller;

      setWeatherSummary((prev) => ({ ...prev, loading: true }));

      try {
        const cities: CityRecord[] = getVisibleCities(bounds, 10);

        if (
          bounds.zoom >= 10 &&
          !hasCityNearPoint(cities, bounds.centerLat, bounds.centerLng)
        ) {
          try {
            const localCity = await resolveLocalCityAtCenter(
              bounds.centerLat,
              bounds.centerLng,
              controller.signal
            );
            if (!controller.signal.aborted) {
              cities.unshift(localCity);
            }
          } catch (err) {
            if (isAbortError(err)) return;
          }
        }

        if (controller.signal.aborted) return;

        const result = await fetchWeatherForCities(cities, {
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;

        setWeatherItems(result.items);
        onCacheUpdatedRef.current();
        setWeatherSummary({
          visibleCount: result.items.length,
          fromCacheCount: result.fromCacheCount,
          fetchedCount: result.fetchedCount,
          loading: false,
        });
      } catch (err) {
        if (isAbortError(err)) return;
        setWeatherSummary((prev) => ({ ...prev, loading: false }));
      }
    },
    []
  );

  const syncPeaksForBounds = useCallback(
    async (bounds: ViewportBounds, enabled: boolean) => {
      peaksAbortRef.current?.abort();

      if (!enabled || bounds.zoom < PEAKS_MIN_ZOOM) {
        setPeakItems([]);
        return;
      }

      const controller = new AbortController();
      peaksAbortRef.current = controller;

      try {
        const localPeaks = getVisibleLocalPeaks(bounds);
        const initialSelected = selectNonOverlappingPeaks(
          localPeaks,
          bounds.zoom,
          8
        );

        // Show known mountains immediately with real cached/fetched summit temperature
        if (initialSelected.length > 0) {
          const initialBatch = await fetchPeakWeatherBatch(initialSelected, {
            signal: controller.signal,
          });
          if (controller.signal.aborted) return;
          setPeakItems(initialBatch.items);
          onCacheUpdatedRef.current();
        } else {
          setPeakItems([]);
        }

        // At high zoom (z9.5+), also discover additional OSM peaks in the region
        const osmPeaks = await fetchOverpassPeaks(bounds, controller.signal);
        if (controller.signal.aborted || osmPeaks.length === 0) return;

        const merged = selectNonOverlappingPeaks(
          [...localPeaks, ...osmPeaks],
          bounds.zoom,
          8
        );
        const fullBatch = await fetchPeakWeatherBatch(merged, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;

        setPeakItems(fullBatch.items);
        onCacheUpdatedRef.current();
      } catch (err) {
        if (isAbortError(err)) return;
      }
    },
    []
  );

  const syncSeasForBounds = useCallback(
    async (bounds: ViewportBounds, enabled: boolean) => {
      seasAbortRef.current?.abort();

      if (!enabled || bounds.zoom < SEAS_MIN_ZOOM) {
        setSeaItems([]);
        return;
      }

      const controller = new AbortController();
      seasAbortRef.current = controller;

      try {
        const visibleSeas = getVisibleSeaPoints(bounds, 8);
        if (visibleSeas.length === 0) {
          setSeaItems([]);
          return;
        }

        const batch = await fetchMarineBatch(visibleSeas, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;

        const items: SeaDisplayItem[] = [];
        for (const sea of visibleSeas) {
          const marine = batch.results.get(sea.id);
          if (marine) {
            items.push({ sea, marine });
          }
        }
        setSeaItems(items);
        onCacheUpdatedRef.current();
      } catch (err) {
        if (isAbortError(err)) return;
      }
    },
    []
  );

  const handleViewportChange = useCallback(
    (bounds: ViewportBounds) => {
      lastBoundsRef.current = bounds;
      setViewportBounds(bounds);

      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = window.setTimeout(() => {
        debounceTimerRef.current = null;
        void syncWeatherForBounds(bounds, weatherEnabledRef.current);
        void syncPeaksForBounds(bounds, peaksEnabledRef.current);
        void syncSeasForBounds(bounds, seasEnabledRef.current);
      }, VIEWPORT_SYNC_DEBOUNCE_MS);
    },
    [syncWeatherForBounds, syncPeaksForBounds, syncSeasForBounds]
  );

  const resyncAllActive = useCallback(() => {
    const bounds = lastBoundsRef.current;
    if (!bounds) return;

    if (weatherEnabledRef.current) {
      void syncWeatherForBounds(bounds, true);
    }
    if (peaksEnabledRef.current) {
      void syncPeaksForBounds(bounds, true);
    }
    if (seasEnabledRef.current) {
      void syncSeasForBounds(bounds, true);
    }
  }, [syncWeatherForBounds, syncPeaksForBounds, syncSeasForBounds]);

  useEffect(() => {
    if (!weatherEnabled) {
      weatherAbortRef.current?.abort();
      setWeatherItems([]);
      setWeatherSummary({
        visibleCount: 0,
        fromCacheCount: 0,
        fetchedCount: 0,
        loading: false,
      });
      onWeatherClearedRef.current?.();
      return;
    }
    if (lastBoundsRef.current) {
      void syncWeatherForBounds(lastBoundsRef.current, true);
    }
  }, [weatherEnabled, syncWeatherForBounds]);

  useEffect(() => {
    if (!peaksEnabled) {
      peaksAbortRef.current?.abort();
      setPeakItems([]);
      onPeaksClearedRef.current?.();
      return;
    }
    if (lastBoundsRef.current) {
      void syncPeaksForBounds(lastBoundsRef.current, true);
    }
  }, [peaksEnabled, syncPeaksForBounds]);

  useEffect(() => {
    if (!seasEnabled) {
      seasAbortRef.current?.abort();
      setSeaItems([]);
      onSeasClearedRef.current?.();
      return;
    }
    if (lastBoundsRef.current) {
      void syncSeasForBounds(lastBoundsRef.current, true);
    }
  }, [seasEnabled, syncSeasForBounds]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      weatherAbortRef.current?.abort();
      peaksAbortRef.current?.abort();
      seasAbortRef.current?.abort();
    };
  }, []);

  return {
    viewportBounds,
    lastBoundsRef,
    weatherItems,
    setWeatherItems,
    peakItems,
    setPeakItems,
    seaItems,
    setSeaItems,
    weatherSummary,
    syncWeatherForBounds,
    syncPeaksForBounds,
    syncSeasForBounds,
    handleViewportChange,
    resyncAllActive,
  };
}
