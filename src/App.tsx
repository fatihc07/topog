import { useCallback, useEffect, useRef, useState } from 'react';
import { InspectCard } from './components/InspectCard';
import { LayerPanel } from './components/LayerPanel';
import { MapCanvas, type MapCanvasHandle } from './components/MapCanvas';
import { MapControls } from './components/MapControls';
import { RadarTimeline } from './components/RadarTimeline';
import { ReleaseNotesModal } from './components/ReleaseNotesModal';
import { SearchBar } from './components/SearchBar';
import { TelemetryBar } from './components/TelemetryBar';
import { WeatherDetailCard } from './components/WeatherDetailCard';
import {
  WEATHER_MIN_ZOOM,
  getVisibleCities,
  hasCityNearPoint,
} from './services/cityIndex';
import { fetchElevation, reverseGeocode } from './services/geocoding';
import {
  PEAKS_MIN_ZOOM,
  fetchOverpassPeaks,
  fetchPeakWeatherBatch,
  getPeakCacheId,
  getVisibleLocalPeaks,
  selectNonOverlappingPeaks,
} from './services/peakService';
import { fetchRainViewerFrames } from './services/radarService';
import {
  clearWeatherCache,
  getWeatherCacheCount,
  invalidateCityWeather,
} from './services/weatherCache';
import {
  fetchWeatherForCities,
  resolveLocalCityAtCenter,
} from './services/weatherService';
import type {
  BaseLayerId,
  FlyTarget,
  InspectedPoint,
  LandmarkPreset,
  SearchResult,
  TelemetryState,
} from './types/map';
import type {
  CityRecord,
  PeakDisplayItem,
  RadarFrame,
  ViewportBounds,
  WeatherData,
  WeatherSyncSummary,
} from './types/weather';

export default function App() {
  const mapHandleRef = useRef<MapCanvasHandle | null>(null);
  const inspectAbortRef = useRef<AbortController | null>(null);
  const weatherAbortRef = useRef<AbortController | null>(null);
  const peaksAbortRef = useRef<AbortController | null>(null);
  const weatherTimerRef = useRef<number | null>(null);
  const lastBoundsRef = useRef<ViewportBounds | null>(null);

  const [activeLayer, setActiveLayer] = useState<BaseLayerId>('opentopomap');
  const [terrain3D, setTerrain3D] = useState(false);
  const [exaggeration, setExaggeration] = useState(1.6);
  const [hillshade, setHillshade] = useState(false);
  const [globeMode, setGlobeMode] = useState(false);

  const [rainEnabled, setRainEnabled] = useState(false);
  const [rainOpacity, setRainOpacity] = useState(0.75);
  const [radarFrames, setRadarFrames] = useState<RadarFrame[]>([]);
  const [radarIndex, setRadarIndex] = useState(0);
  const [radarPlaying, setRadarPlaying] = useState(false);
  const [rainLoading, setRainLoading] = useState(false);

  const [cloudsEnabled, setCloudsEnabled] = useState(false);
  const [cloudsOpacity, setCloudsOpacity] = useState(0.8);

  const [weatherEnabled, setWeatherEnabled] = useState(true);
  const [weatherBadgeOpacity, setWeatherBadgeOpacity] = useState(0.92);
  const [weatherItems, setWeatherItems] = useState<WeatherData[]>([]);
  const [selectedWeather, setSelectedWeather] = useState<WeatherData | null>(
    null
  );
  const [peaksEnabled, setPeaksEnabled] = useState(true);
  const [peakItems, setPeakItems] = useState<PeakDisplayItem[]>([]);
  const [selectedPeak, setSelectedPeak] = useState<PeakDisplayItem | null>(
    null
  );
  const [refreshingCity, setRefreshingCity] = useState(false);
  const [weatherCacheCount, setWeatherCacheCount] = useState(() =>
    getWeatherCacheCount()
  );
  const [weatherSummary, setWeatherSummary] = useState<WeatherSyncSummary>({
    visibleCount: 0,
    fromCacheCount: 0,
    fetchedCount: 0,
    loading: false,
  });

  const [telemetry, setTelemetry] = useState<TelemetryState>({
    lng: null,
    lat: null,
    elevation: null,
    zoom: 2.4,
    pitch: 0,
    bearing: 0,
  });

  const [inspectedPoint, setInspectedPoint] = useState<InspectedPoint | null>(
    null
  );
  const [flyTarget, setFlyTarget] = useState<FlyTarget | null>(null);
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);

  // Fetch RainViewer frames when Rain Radar is enabled + refresh every 10 min
  useEffect(() => {
    if (!rainEnabled) {
      setRadarPlaying(false);
      return;
    }

    const controller = new AbortController();
    let mounted = true;

    const loadFrames = async () => {
      setRainLoading(true);
      try {
        const frames = await fetchRainViewerFrames(controller.signal);
        if (!mounted || controller.signal.aborted) return;
        setRadarFrames(frames);
        if (frames.length > 0) {
          setRadarIndex(frames.length - 1);
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError' && mounted) {
          setRadarFrames([]);
        }
      } finally {
        if (mounted && !controller.signal.aborted) {
          setRainLoading(false);
        }
      }
    };

    void loadFrames();
    const refreshId = window.setInterval(() => {
      void loadFrames();
    }, 10 * 60 * 1000);

    return () => {
      mounted = false;
      controller.abort();
      window.clearInterval(refreshId);
    };
  }, [rainEnabled]);

  // 2-hour animation loop for RainViewer frames
  useEffect(() => {
    if (!radarPlaying || !rainEnabled || radarFrames.length <= 1) return;
    const id = window.setInterval(() => {
      setRadarIndex((prev) => (prev + 1) % radarFrames.length);
    }, 650);
    return () => window.clearInterval(id);
  }, [radarPlaying, rainEnabled, radarFrames.length]);

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
            if ((err as Error).name === 'AbortError') return;
          }
        }

        if (controller.signal.aborted) return;

        const result = await fetchWeatherForCities(cities, {
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;

        setWeatherItems(result.items);
        setWeatherCacheCount(getWeatherCacheCount());
        setWeatherSummary({
          visibleCount: result.items.length,
          fromCacheCount: result.fromCacheCount,
          fetchedCount: result.fetchedCount,
          loading: false,
        });

        setSelectedWeather((prev) => {
          if (!prev) return null;
          return result.items.find((w) => w.cityId === prev.cityId) ?? prev;
        });
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
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
          setWeatherCacheCount(getWeatherCacheCount());
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
        setWeatherCacheCount(getWeatherCacheCount());
        setSelectedPeak((prev) => {
          if (!prev) return null;
          return fullBatch.items.find((p) => p.peak.id === prev.peak.id) ?? prev;
        });
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
      }
    },
    []
  );

  const handleViewportChange = useCallback(
    (bounds: ViewportBounds) => {
      lastBoundsRef.current = bounds;
      if (weatherTimerRef.current !== null) {
        window.clearTimeout(weatherTimerRef.current);
      }
      weatherTimerRef.current = window.setTimeout(() => {
        void syncWeatherForBounds(bounds, weatherEnabled);
        void syncPeaksForBounds(bounds, peaksEnabled);
      }, 250);
    },
    [syncWeatherForBounds, syncPeaksForBounds, weatherEnabled, peaksEnabled]
  );

  useEffect(() => {
    if (lastBoundsRef.current) {
      void syncWeatherForBounds(lastBoundsRef.current, weatherEnabled);
    }
    if (!weatherEnabled) {
      setSelectedWeather(null);
    }
  }, [weatherEnabled, syncWeatherForBounds]);

  useEffect(() => {
    if (lastBoundsRef.current) {
      void syncPeaksForBounds(lastBoundsRef.current, peaksEnabled);
    }
    if (!peaksEnabled) {
      setSelectedPeak(null);
    }
  }, [peaksEnabled, syncPeaksForBounds]);

  useEffect(() => {
    return () => {
      if (weatherTimerRef.current !== null) {
        window.clearTimeout(weatherTimerRef.current);
      }
      weatherAbortRef.current?.abort();
      peaksAbortRef.current?.abort();
      inspectAbortRef.current?.abort();
    };
  }, []);

  const handleInspectPoint = useCallback(
    async (lng: number, lat: number, presetPlaceName?: string) => {
      setSelectedWeather(null);
      setSelectedPeak(null);
      inspectAbortRef.current?.abort();
      const controller = new AbortController();
      inspectAbortRef.current = controller;

      setInspectedPoint({
        lng,
        lat,
        elevation: null,
        placeName: presetPlaceName ?? null,
        loading: true,
      });

      try {
        const [placeName, elevation] = await Promise.all([
          presetPlaceName
            ? Promise.resolve(presetPlaceName)
            : reverseGeocode(lat, lng, controller.signal),
          fetchElevation(lat, lng, controller.signal),
        ]);

        if (controller.signal.aborted) return;
        setInspectedPoint({
          lng,
          lat,
          elevation,
          placeName: placeName ?? 'Seçili Coğrafi Nokta',
          loading: false,
        });
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setInspectedPoint({
          lng,
          lat,
          elevation: null,
          placeName: presetPlaceName ?? 'Seçili Coğrafi Nokta',
          loading: false,
        });
      }
    },
    []
  );

  const handleSelectWeather = useCallback((item: WeatherData) => {
    inspectAbortRef.current?.abort();
    setInspectedPoint(null);
    setSelectedPeak(null);
    setSelectedWeather(item);
  }, []);

  const handleSelectPeak = useCallback((item: PeakDisplayItem) => {
    inspectAbortRef.current?.abort();
    setSelectedWeather(null);
    if (item.weather) {
      setInspectedPoint(null);
      setSelectedPeak(item);
    } else {
      setSelectedPeak(null);
      setInspectedPoint({
        lng: item.peak.lng,
        lat: item.peak.lat,
        elevation: item.peak.elevation,
        placeName: `${item.peak.name} (Zirve)`,
        loading: false,
      });
    }
  }, []);

  const handleRefreshCityWeather = useCallback(
    async (target: WeatherData) => {
      setRefreshingCity(true);
      try {
        invalidateCityWeather(target.cityId);

        if (selectedPeak && getPeakCacheId(selectedPeak.peak.id) === target.cityId) {
          const batch = await fetchPeakWeatherBatch([selectedPeak.peak], {
            forceRefresh: true,
          });
          const updatedItem = batch.items[0];
          if (updatedItem) {
            setSelectedPeak(updatedItem);
            setPeakItems((prev) =>
              prev.map((p) =>
                p.peak.id === updatedItem.peak.id ? updatedItem : p
              )
            );
            setWeatherCacheCount(getWeatherCacheCount());
          }
          return;
        }

        const city: CityRecord = {
          id: target.cityId,
          name: target.cityName,
          country: target.country,
          lat: target.lat,
          lng: target.lng,
          pop: 1,
        };
        const result = await fetchWeatherForCities([city], {
          forceRefresh: true,
        });
        const updated = result.items[0];
        if (updated) {
          setSelectedWeather(updated);
          setWeatherItems((prev) =>
            prev.map((w) => (w.cityId === updated.cityId ? updated : w))
          );
          setWeatherCacheCount(getWeatherCacheCount());
        }
      } catch {
        // Keep existing weather item on transient error
      } finally {
        setRefreshingCity(false);
      }
    },
    [selectedPeak]
  );

  const handleClearWeatherCache = useCallback(() => {
    clearWeatherCache();
    setWeatherCacheCount(0);
    if (lastBoundsRef.current) {
      if (weatherEnabled) {
        void syncWeatherForBounds(lastBoundsRef.current, true);
      }
      if (peaksEnabled) {
        void syncPeaksForBounds(lastBoundsRef.current, true);
      }
    }
  }, [syncWeatherForBounds, syncPeaksForBounds, weatherEnabled, peaksEnabled]);

  const handleSelectLandmark = useCallback(
    (landmark: LandmarkPreset) => {
      if (landmark.pitch >= 45 && !terrain3D) {
        setTerrain3D(true);
      }
      setFlyTarget({
        lng: landmark.lng,
        lat: landmark.lat,
        zoom: landmark.zoom,
        pitch: landmark.pitch,
        bearing: landmark.bearing,
        timestamp: Date.now(),
      });
      if (landmark.id !== 'world') {
        void handleInspectPoint(
          landmark.lng,
          landmark.lat,
          `${landmark.name} (${landmark.region})`
        );
      } else {
        setInspectedPoint(null);
      }
    },
    [terrain3D, handleInspectPoint]
  );

  const handleSelectSearchResult = useCallback(
    (result: SearchResult) => {
      const lng = parseFloat(result.lon);
      const lat = parseFloat(result.lat);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

      setFlyTarget({
        lng,
        lat,
        zoom: 11.5,
        pitch: terrain3D ? 52 : 0,
        bearing: 0,
        timestamp: Date.now(),
      });
      void handleInspectPoint(lng, lat, result.display_name);
    },
    [terrain3D, handleInspectPoint]
  );

  const handleZoom3D = useCallback(
    (lng: number, lat: number) => {
      if (!terrain3D) setTerrain3D(true);
      setFlyTarget({
        lng,
        lat,
        zoom: 12.2,
        pitch: 60,
        bearing: -20,
        timestamp: Date.now(),
      });
    },
    [terrain3D]
  );

  return (
    <main className="app-shell">
      <MapCanvas
        ref={mapHandleRef}
        activeLayer={activeLayer}
        terrain3D={terrain3D}
        exaggeration={exaggeration}
        hillshade={hillshade}
        globeMode={globeMode}
        cloudsEnabled={cloudsEnabled}
        cloudsOpacity={cloudsOpacity}
        rainEnabled={rainEnabled}
        rainOpacity={rainOpacity}
        radarFrames={radarFrames}
        activeRadarIndex={radarIndex}
        flyTarget={flyTarget}
        markerCoords={
          inspectedPoint
            ? { lng: inspectedPoint.lng, lat: inspectedPoint.lat }
            : null
        }
        weatherItems={weatherItems}
        weatherBadgeOpacity={weatherBadgeOpacity}
        selectedWeatherCityId={selectedWeather?.cityId ?? null}
        peakItems={peakItems}
        selectedPeakId={selectedPeak?.peak.id ?? null}
        onTelemetryChange={setTelemetry}
        onInspectPoint={(lng, lat) => void handleInspectPoint(lng, lat)}
        onViewportChange={handleViewportChange}
        onSelectWeather={handleSelectWeather}
        onSelectPeak={handleSelectPeak}
      />

      <SearchBar
        onSelectLandmark={handleSelectLandmark}
        onSelectSearchResult={handleSelectSearchResult}
        onOpenReleaseNotes={() => setReleaseNotesOpen(true)}
      />

      <LayerPanel
        activeLayer={activeLayer}
        terrain3D={terrain3D}
        exaggeration={exaggeration}
        hillshade={hillshade}
        globeMode={globeMode}
        weatherEnabled={weatherEnabled}
        weatherBadgeOpacity={weatherBadgeOpacity}
        weatherCacheCount={weatherCacheCount}
        peaksEnabled={peaksEnabled}
        rainEnabled={rainEnabled}
        rainOpacity={rainOpacity}
        rainLoading={rainLoading}
        cloudsEnabled={cloudsEnabled}
        cloudsOpacity={cloudsOpacity}
        onSelectLayer={setActiveLayer}
        onToggleTerrain3D={() => setTerrain3D((prev) => !prev)}
        onChangeExaggeration={setExaggeration}
        onToggleHillshade={() => setHillshade((prev) => !prev)}
        onToggleGlobeMode={() => setGlobeMode((prev) => !prev)}
        onToggleWeather={() => setWeatherEnabled((prev) => !prev)}
        onChangeWeatherBadgeOpacity={setWeatherBadgeOpacity}
        onClearWeatherCache={handleClearWeatherCache}
        onTogglePeaks={() => setPeaksEnabled((prev) => !prev)}
        onToggleRain={() => setRainEnabled((prev) => !prev)}
        onChangeRainOpacity={setRainOpacity}
        onToggleClouds={() => setCloudsEnabled((prev) => !prev)}
        onChangeCloudsOpacity={setCloudsOpacity}
      />

      <MapControls
        onZoomIn={() => mapHandleRef.current?.zoomIn()}
        onZoomOut={() => mapHandleRef.current?.zoomOut()}
        onResetNorth={() => mapHandleRef.current?.resetNorthPitch()}
        onGeolocate={() => mapHandleRef.current?.geolocate()}
      />

      {rainEnabled && (
        <RadarTimeline
          frames={radarFrames}
          activeIndex={radarIndex}
          playing={radarPlaying}
          loading={rainLoading}
          onTogglePlay={() => setRadarPlaying((prev) => !prev)}
          onSelectIndex={(idx) => {
            setRadarPlaying(false);
            setRadarIndex(idx);
          }}
        />
      )}

      {selectedPeak?.weather ? (
        <WeatherDetailCard
          weather={selectedPeak.weather}
          elevationMeters={selectedPeak.peak.elevation}
          refreshing={refreshingCity}
          onRefresh={(w) => void handleRefreshCityWeather(w)}
          onClose={() => setSelectedPeak(null)}
        />
      ) : selectedWeather ? (
        <WeatherDetailCard
          weather={selectedWeather}
          refreshing={refreshingCity}
          onRefresh={(w) => void handleRefreshCityWeather(w)}
          onClose={() => setSelectedWeather(null)}
        />
      ) : inspectedPoint ? (
        <InspectCard
          point={inspectedPoint}
          onZoom3D={handleZoom3D}
          onClose={() => {
            inspectAbortRef.current?.abort();
            setInspectedPoint(null);
          }}
        />
      ) : null}

      <TelemetryBar
        telemetry={telemetry}
        activeLayer={activeLayer}
        terrain3D={terrain3D}
        weatherEnabled={weatherEnabled}
        weatherSummary={weatherSummary}
      />

      {releaseNotesOpen && (
        <ReleaseNotesModal onClose={() => setReleaseNotesOpen(false)} />
      )}
    </main>
  );
}
