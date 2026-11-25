import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InspectCard } from './components/InspectCard';
import { LayerPanel } from './components/LayerPanel';
import { MapCanvas, type MapCanvasHandle } from './components/MapCanvas';
import { MapControls } from './components/MapControls';
import { ModeTabs } from './components/ModeTabs';
import { RadarTimeline } from './components/RadarTimeline';
import { ReleaseNotesModal } from './components/ReleaseNotesModal';
import { SearchBar } from './components/SearchBar';
import { SimulatorDock } from './components/SimulatorDock';
import { SolarTimeline } from './components/SolarTimeline';
import { TelemetryBar } from './components/TelemetryBar';
import { WeatherDetailCard } from './components/WeatherDetailCard';
import {
  WEATHER_MIN_ZOOM,
  getVisibleCities,
  hasCityNearPoint,
} from './services/cityIndex';
import { fetchElevation, reverseGeocode } from './services/geocoding';
import { clearMarineCache, fetchMarineData } from './services/marineService';
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
  applySimulationToCity,
  applySimulationToPeak,
  createSimWave,
  getBaselineTemp,
  stepSimulation,
} from './services/simulatorEngine';
import { getSunPositionForPoint } from './services/solarService';
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
  AppMode,
  SimFrontZone,
  SimHistoryPoint,
  SimScenario,
  SimSeason,
  SimSystemTool,
  SimWave,
  SimWaveKind,
} from './types/simulator';
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

  const [appMode, setAppMode] = useState<AppMode>('live');
  const [simSystemTool, setSimSystemTool] = useState<SimSystemTool>('cold');
  const [simMoisture, setSimMoisture] = useState(true);
  const [simShowHeatmap, setSimShowHeatmap] = useState(true);
  const [simIntensity, setSimIntensity] = useState(1.0);
  const [simWindDir, setSimWindDir] = useState<number | null>(90);
  const [simPlaying, setSimPlaying] = useState(true);
  const [simSpeed, setSimSpeed] = useState(1);
  const [simSeason, setSimSeason] = useState<SimSeason>('winter');
  const [simWaves, setSimWaves] = useState<SimWave[]>([]);
  const [simFronts, setSimFronts] = useState<SimFrontZone[]>([]);
  const [simBounds, setSimBounds] = useState<ViewportBounds | null>(null);
  const [simSnowMap, setSimSnowMap] = useState<Record<string, number>>({});
  const simSnowRef = useRef<Record<string, number>>({});
  const [simHistoryMap, setSimHistoryMap] = useState<
    Record<string, SimHistoryPoint[]>
  >({});

  const [activeLayer, setActiveLayer] = useState<BaseLayerId>('opentopomap');
  const [terrain3D, setTerrain3D] = useState(false);
  const [exaggeration, setExaggeration] = useState(1.6);
  const [hillshade, setHillshade] = useState(false);
  const [globeMode, setGlobeMode] = useState(false);
  const [countryMode, setCountryMode] = useState(false);
  const [countryLoading, setCountryLoading] = useState(false);

  const [rainEnabled, setRainEnabled] = useState(false);
  const [rainOpacity, setRainOpacity] = useState(0.75);
  const [radarFrames, setRadarFrames] = useState<RadarFrame[]>([]);
  const [radarIndex, setRadarIndex] = useState(0);
  const [radarPlaying, setRadarPlaying] = useState(false);
  const [rainLoading, setRainLoading] = useState(false);

  const [cloudsEnabled, setCloudsEnabled] = useState(false);
  const [cloudsOpacity, setCloudsOpacity] = useState(0.8);

  const [solarEnabled, setSolarEnabled] = useState(false);
  const [solarMinutes, setSolarMinutes] = useState(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  });
  const [solarPlaying, setSolarPlaying] = useState(false);

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

  // Solar date & sun position for active viewport center
  const solarDateMs = useMemo(() => {
    const d = new Date();
    d.setHours(Math.floor(solarMinutes / 60), solarMinutes % 60, 0, 0);
    return d.getTime();
  }, [solarMinutes]);

  const sunPosition = useMemo(() => {
    const lat = lastBoundsRef.current?.centerLat ?? 39.0;
    const lng = lastBoundsRef.current?.centerLng ?? 35.2;
    return getSunPositionForPoint(new Date(solarDateMs), lat, lng);
  }, [solarDateMs]);

  useEffect(() => {
    if (!solarEnabled) {
      setSolarPlaying(false);
      return;
    }
    if (!solarPlaying) return;
    const id = window.setInterval(() => {
      setSolarMinutes((prev) => (prev + 10) % 1440);
    }, 180);
    return () => window.clearInterval(id);
  }, [solarEnabled, solarPlaying]);

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
      setSimBounds(bounds);
      if (appMode !== 'live') return;

      if (weatherTimerRef.current !== null) {
        window.clearTimeout(weatherTimerRef.current);
      }
      weatherTimerRef.current = window.setTimeout(() => {
        void syncWeatherForBounds(bounds, weatherEnabled);
        void syncPeaksForBounds(bounds, peaksEnabled);
      }, 250);
    },
    [appMode, syncWeatherForBounds, syncPeaksForBounds, weatherEnabled, peaksEnabled]
  );

  // Separate Simulator loop (150ms ticks) - completely isolated from Live Mode
  useEffect(() => {
    if (appMode !== 'simulator' || !simPlaying || simWaves.length === 0) return;

    const dtSec = 0.15;
    const id = window.setInterval(() => {
      setSimWaves((prevWaves) => {
        if (prevWaves.length === 0) {
          setSimFronts([]);
          return prevWaves;
        }
        const { waves: nextWaves, fronts: nextFronts } = stepSimulation(
          prevWaves,
          dtSec,
          simWindDir,
          simSpeed
        );
        setSimFronts(nextFronts);

        // Update simulated snow accumulation/melting for visible peaks
        if (simBounds && peaksEnabled) {
          const visiblePeaks = selectNonOverlappingPeaks(
            getVisibleLocalPeaks(simBounds),
            simBounds.zoom,
            8
          );
          if (visiblePeaks.length > 0) {
            const nextSnow: Record<string, number> = { ...simSnowRef.current };
            let changed = false;
            for (const peak of visiblePeaks) {
              const curSnow =
                nextSnow[peak.id] ??
                (getBaselineTemp(peak.lat, peak.elevation, simSeason) <= -1
                  ? Math.round(Math.max(0, (peak.elevation - 2400) / 35))
                  : 0);
              const updated = applySimulationToPeak(
                {
                  peak,
                  weather: {
                    cityId: peak.id,
                    cityName: peak.name,
                    country: peak.country,
                    lat: peak.lat,
                    lng: peak.lng,
                    temperature: 0,
                    apparentTemperature: 0,
                    humidity: 55,
                    windSpeed: 15,
                    pressure: 750,
                    weatherCode: 0,
                    isDay: true,
                    snowDepthCm: curSnow,
                    fetchedAt: Date.now(),
                    source: 'live',
                  },
                },
                nextWaves,
                nextFronts,
                simSeason,
                dtSec * simSpeed,
                simWindDir
              );
              const val = updated.weather?.snowDepthCm ?? 0;
              if (val !== curSnow) {
                nextSnow[peak.id] = val;
                changed = true;
              }
            }
            if (changed) {
              simSnowRef.current = nextSnow;
              setSimSnowMap(nextSnow);
            }
          }
        }

        return nextWaves;
      });
    }, 150);

    return () => window.clearInterval(id);
  }, [
    appMode,
    simPlaying,
    simWaves.length,
    simWindDir,
    simSpeed,
    simBounds,
    peaksEnabled,
    simSeason,
  ]);

  const handleChangeMode = useCallback(
    (nextMode: AppMode) => {
      if (nextMode === 'simulator') {
        if (weatherTimerRef.current !== null) {
          window.clearTimeout(weatherTimerRef.current);
          weatherTimerRef.current = null;
        }
        weatherAbortRef.current?.abort();
        peaksAbortRef.current?.abort();
        inspectAbortRef.current?.abort();
      }
      setAppMode(nextMode);
      setSelectedWeather(null);
      setSelectedPeak(null);
      setInspectedPoint(null);
      if (nextMode === 'live' && lastBoundsRef.current) {
        void syncWeatherForBounds(lastBoundsRef.current, weatherEnabled);
        void syncPeaksForBounds(lastBoundsRef.current, peaksEnabled);
      }
    },
    [syncWeatherForBounds, syncPeaksForBounds, weatherEnabled, peaksEnabled]
  );

  const handleToggleSimSystem = useCallback(
    (kind: 'cold' | 'warm' | 'cyclone' | 'high_pressure') => {
      setSimSystemTool((prev) => {
        if (prev === kind) {
          return simMoisture && kind !== 'high_pressure' ? null : kind;
        }
        return kind;
      });
    },
    [simMoisture]
  );

  const handleToggleSimMoisture = useCallback(() => {
    setSimMoisture((prev) => {
      if (prev && simSystemTool === null) {
        return true;
      }
      return !prev;
    });
  }, [simSystemTool]);

  const handleLaunchSimWave = useCallback(
    (lng: number, lat: number) => {
      const waveKind: SimWaveKind = simSystemTool ?? 'moisture';
      const withMoist =
        waveKind === 'high_pressure' ? false : simMoisture;
      const wave = createSimWave(
        waveKind,
        lng,
        lat,
        simIntensity,
        withMoist
      );
      setSimWaves((prev) => {
        const nextWaves = [...prev.slice(-14), wave];
        const { fronts } = stepSimulation(nextWaves, 0.01, simWindDir, simSpeed);
        setSimFronts(fronts);
        return nextWaves;
      });
      setSimPlaying(true);
    },
    [simSystemTool, simMoisture, simIntensity, simWindDir, simSpeed]
  );

  const handleSelectScenario = useCallback((scenario: SimScenario) => {
    setSimSeason(scenario.season);
    setSimWindDir(scenario.windDirDeg);
    simSnowRef.current = {};
    setSimSnowMap({});
    setSimHistoryMap({});

    const spawned = scenario.waves.map((w) =>
      createSimWave(w.kind, w.lng, w.lat, w.strength, w.withMoisture)
    );
    const { waves: steppedWaves, fronts } = stepSimulation(
      spawned,
      0.5,
      scenario.windDirDeg,
      1
    );
    setSimWaves(steppedWaves);
    setSimFronts(fronts);
    setSimPlaying(true);

    setFlyTarget({
      lng: scenario.camera.lng,
      lat: scenario.camera.lat,
      zoom: scenario.camera.zoom,
      pitch: 0,
      bearing: 0,
      timestamp: Date.now(),
    });
  }, []);

  const handleClearSimWaves = useCallback(() => {
    setSimWaves([]);
    setSimFronts([]);
    simSnowRef.current = {};
    setSimSnowMap({});
    setSimHistoryMap({});
  }, []);

  // Compute displayed weather & peak badges for active mode
  const displayedWeatherItems = useMemo<WeatherData[]>(() => {
    if (appMode === 'live') return weatherItems;
    if (!weatherEnabled || !simBounds || simBounds.zoom < WEATHER_MIN_ZOOM) {
      return [];
    }
    const cities = getVisibleCities(simBounds, 10);
    return cities.map((c) =>
      applySimulationToCity(
        {
          cityId: c.id,
          cityName: c.name,
          country: c.country,
          lat: c.lat,
          lng: c.lng,
          temperature: 15,
          apparentTemperature: 15,
          humidity: 55,
          windSpeed: 10,
          pressure: 1013,
          weatherCode: 0,
          isDay: true,
          fetchedAt: Date.now(),
          source: 'live',
        },
        simWaves,
        simFronts,
        simSeason,
        simWindDir
      )
    );
  }, [
    appMode,
    weatherItems,
    weatherEnabled,
    simBounds,
    simWaves,
    simFronts,
    simSeason,
    simWindDir,
  ]);

  const displayedPeakItems = useMemo<PeakDisplayItem[]>(() => {
    if (appMode === 'live') return peakItems;
    if (!peaksEnabled || !simBounds || simBounds.zoom < PEAKS_MIN_ZOOM) {
      return [];
    }
    const peaks = selectNonOverlappingPeaks(
      getVisibleLocalPeaks(simBounds),
      simBounds.zoom,
      8
    );
    return peaks.map((peak) => {
      const initialSnow =
        simSnowMap[peak.id] ??
        (getBaselineTemp(peak.lat, peak.elevation, simSeason) <= -1
          ? Math.round(Math.max(0, (peak.elevation - 2400) / 35))
          : 0);
      return applySimulationToPeak(
        {
          peak,
          weather: {
            cityId: peak.id,
            cityName: peak.name,
            country: peak.country,
            lat: peak.lat,
            lng: peak.lng,
            temperature: 0,
            apparentTemperature: 0,
            humidity: 55,
            windSpeed: 15,
            pressure: 750,
            weatherCode: 0,
            isDay: true,
            snowDepthCm: initialSnow,
            fetchedAt: Date.now(),
            source: 'live',
          },
        },
        simWaves,
        simFronts,
        simSeason,
        0,
        simWindDir
      );
    });
  }, [
    appMode,
    peakItems,
    peaksEnabled,
    simBounds,
    simWaves,
    simFronts,
    simSeason,
    simSnowMap,
    simWindDir,
  ]);

  const activeSelectedWeather = useMemo(() => {
    if (!selectedWeather) return null;
    if (appMode === 'live') return selectedWeather;
    return (
      displayedWeatherItems.find((w) => w.cityId === selectedWeather.cityId) ??
      selectedWeather
    );
  }, [appMode, selectedWeather, displayedWeatherItems]);

  const activeSelectedPeak = useMemo(() => {
    if (!selectedPeak) return null;
    if (appMode === 'live') return selectedPeak;
    return (
      displayedPeakItems.find((p) => p.peak.id === selectedPeak.peak.id) ??
      selectedPeak
    );
  }, [appMode, selectedPeak, displayedPeakItems]);

  // Sample simulation history points for live sparklines (#8)
  const latestSimTargetRef = useRef<{
    id: string;
    tempC: number;
    snowDepthCm: number | null;
  } | null>(null);

  if (appMode === 'simulator') {
    if (activeSelectedPeak?.weather) {
      latestSimTargetRef.current = {
        id: activeSelectedPeak.peak.id,
        tempC: activeSelectedPeak.weather.temperature,
        snowDepthCm: activeSelectedPeak.weather.snowDepthCm ?? 0,
      };
    } else if (activeSelectedWeather) {
      latestSimTargetRef.current = {
        id: activeSelectedWeather.cityId,
        tempC: activeSelectedWeather.temperature,
        snowDepthCm: null,
      };
    } else {
      latestSimTargetRef.current = null;
    }
  } else {
    latestSimTargetRef.current = null;
  }

  const activeSimTargetId = latestSimTargetRef.current?.id ?? null;

  useEffect(() => {
    if (appMode !== 'simulator' || !activeSimTargetId) return;

    const pushSample = () => {
      const target = latestSimTargetRef.current;
      if (!target) return;
      setSimHistoryMap((prev) => {
        const list = prev[target.id] ?? [];
        const nextList: SimHistoryPoint[] = [
          ...list.slice(-35),
          {
            timestamp: Date.now(),
            tempC: target.tempC,
            snowDepthCm: target.snowDepthCm,
          },
        ];
        return { ...prev, [target.id]: nextList };
      });
    };

    pushSample();
    const id = window.setInterval(pushSample, 650);
    return () => window.clearInterval(id);
  }, [appMode, activeSimTargetId]);

  useEffect(() => {
    if (appMode === 'live' && lastBoundsRef.current) {
      void syncWeatherForBounds(lastBoundsRef.current, weatherEnabled);
    }
    if (!weatherEnabled) {
      setSelectedWeather(null);
    }
  }, [appMode, weatherEnabled, syncWeatherForBounds]);

  useEffect(() => {
    if (appMode === 'live' && lastBoundsRef.current) {
      void syncPeaksForBounds(lastBoundsRef.current, peaksEnabled);
    }
    if (!peaksEnabled) {
      setSelectedPeak(null);
    }
  }, [appMode, peaksEnabled, syncPeaksForBounds]);

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
        marine: null,
        loading: true,
      });

      try {
        const [placeName, elevation, marine] = await Promise.all([
          presetPlaceName
            ? Promise.resolve(presetPlaceName)
            : reverseGeocode(lat, lng, controller.signal),
          fetchElevation(lat, lng, controller.signal),
          fetchMarineData(lat, lng, controller.signal),
        ]);

        if (controller.signal.aborted) return;
        setInspectedPoint({
          lng,
          lat,
          elevation,
          placeName: placeName ?? 'Seçili Coğrafi Nokta',
          marine,
          loading: false,
        });
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setInspectedPoint({
          lng,
          lat,
          elevation: null,
          placeName: presetPlaceName ?? 'Seçili Coğrafi Nokta',
          marine: null,
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
    clearMarineCache();
    setWeatherCacheCount(0);
    if (appMode === 'live' && lastBoundsRef.current) {
      if (weatherEnabled) {
        void syncWeatherForBounds(lastBoundsRef.current, true);
      }
      if (peaksEnabled) {
        void syncPeaksForBounds(lastBoundsRef.current, true);
      }
    }
  }, [appMode, syncWeatherForBounds, syncPeaksForBounds, weatherEnabled, peaksEnabled]);

  const handleToggleSolar = useCallback(() => {
    setSolarEnabled((prev) => {
      const next = !prev;
      if (next && !hillshade) {
        setHillshade(true);
      }
      return next;
    });
  }, [hillshade]);

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
        appMode={appMode}
        simWaves={simWaves}
        simFronts={simFronts}
        simSeason={simSeason}
        simWindDirDeg={simWindDir}
        simShowHeatmap={simShowHeatmap}
        simPlaying={simPlaying}
        activeLayer={activeLayer}
        terrain3D={terrain3D}
        exaggeration={exaggeration}
        hillshade={hillshade}
        globeMode={globeMode}
        solarEnabled={solarEnabled}
        solarDateMs={solarDateMs}
        sunAzimuthDeg={sunPosition.azimuthDeg}
        sunElevationDeg={sunPosition.elevationDeg}
        cloudsEnabled={cloudsEnabled}
        cloudsOpacity={cloudsOpacity}
        rainEnabled={rainEnabled}
        rainOpacity={rainOpacity}
        radarFrames={radarFrames}
        activeRadarIndex={radarIndex}
        flyTarget={flyTarget}
        markerCoords={
          appMode === 'live' && inspectedPoint
            ? { lng: inspectedPoint.lng, lat: inspectedPoint.lat }
            : null
        }
        weatherItems={displayedWeatherItems}
        weatherBadgeOpacity={weatherBadgeOpacity}
        selectedWeatherCityId={activeSelectedWeather?.cityId ?? null}
        peakItems={displayedPeakItems}
        selectedPeakId={activeSelectedPeak?.peak.id ?? null}
        onTelemetryChange={setTelemetry}
        onInspectPoint={(lng, lat) => void handleInspectPoint(lng, lat)}
        onViewportChange={handleViewportChange}
        onSelectWeather={handleSelectWeather}
        onSelectPeak={handleSelectPeak}
        onLaunchSimWave={handleLaunchSimWave}
        countryMode={countryMode}
        onCountryLoadingChange={setCountryLoading}
      />

      <ModeTabs
        mode={appMode}
        activeWaveCount={simWaves.length}
        onChangeMode={handleChangeMode}
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
        solarEnabled={solarEnabled}
        weatherEnabled={weatherEnabled}
        weatherBadgeOpacity={weatherBadgeOpacity}
        weatherCacheCount={weatherCacheCount}
        peaksEnabled={peaksEnabled}
        rainEnabled={rainEnabled}
        rainOpacity={rainOpacity}
        rainLoading={rainLoading}
        cloudsEnabled={cloudsEnabled}
        cloudsOpacity={cloudsOpacity}
        countryMode={countryMode}
        countryLoading={countryLoading}
        onSelectLayer={setActiveLayer}
        onToggleTerrain3D={() => setTerrain3D((prev) => !prev)}
        onChangeExaggeration={setExaggeration}
        onToggleHillshade={() => setHillshade((prev) => !prev)}
        onToggleGlobeMode={() => setGlobeMode((prev) => !prev)}
        onToggleSolar={handleToggleSolar}
        onToggleWeather={() => setWeatherEnabled((prev) => !prev)}
        onChangeWeatherBadgeOpacity={setWeatherBadgeOpacity}
        onClearWeatherCache={handleClearWeatherCache}
        onTogglePeaks={() => setPeaksEnabled((prev) => !prev)}
        onToggleRain={() => setRainEnabled((prev) => !prev)}
        onChangeRainOpacity={setRainOpacity}
        onToggleClouds={() => setCloudsEnabled((prev) => !prev)}
        onChangeCloudsOpacity={setCloudsOpacity}
        onToggleCountryMode={() => setCountryMode((prev) => !prev)}
      />

      <MapControls
        onZoomIn={() => mapHandleRef.current?.zoomIn()}
        onZoomOut={() => mapHandleRef.current?.zoomOut()}
        onResetNorth={() => mapHandleRef.current?.resetNorthPitch()}
        onGeolocate={() => mapHandleRef.current?.geolocate()}
      />

      {appMode === 'simulator' ? (
        <SimulatorDock
          systemTool={simSystemTool}
          moistureActive={simMoisture}
          showHeatmap={simShowHeatmap}
          intensity={simIntensity}
          windDirDeg={simWindDir}
          playing={simPlaying}
          speed={simSpeed}
          season={simSeason}
          waveCount={simWaves.length}
          frontCount={simFronts.length}
          onToggleSystem={handleToggleSimSystem}
          onToggleMoisture={handleToggleSimMoisture}
          onToggleHeatmap={() => setSimShowHeatmap((prev) => !prev)}
          onSelectScenario={handleSelectScenario}
          onChangeIntensity={setSimIntensity}
          onChangeWindDir={setSimWindDir}
          onTogglePlay={() => setSimPlaying((prev) => !prev)}
          onChangeSpeed={setSimSpeed}
          onChangeSeason={(s) => {
            setSimSeason(s);
            simSnowRef.current = {};
            setSimSnowMap({});
            setSimHistoryMap({});
          }}
          onClearWaves={handleClearSimWaves}
        />
      ) : (
        (rainEnabled || solarEnabled) && (
          <div className="bottom-bars-stack">
            {solarEnabled && (
              <SolarTimeline
                minutesOfDay={solarMinutes}
                playing={solarPlaying}
                sunElevationDeg={sunPosition.elevationDeg}
                sunAzimuthDeg={sunPosition.azimuthDeg}
                onTogglePlay={() => setSolarPlaying((prev) => !prev)}
                onChangeMinutes={(min) => {
                  setSolarPlaying(false);
                  setSolarMinutes(min);
                }}
                onResetNow={() => {
                  setSolarPlaying(false);
                  const now = new Date();
                  setSolarMinutes(now.getHours() * 60 + now.getMinutes());
                }}
                onClose={() => setSolarEnabled(false)}
              />
            )}

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
          </div>
        )
      )}

      {activeSelectedPeak?.weather ? (
        <WeatherDetailCard
          weather={activeSelectedPeak.weather}
          elevationMeters={activeSelectedPeak.peak.elevation}
          isSimulated={appMode === 'simulator'}
          simHistory={
            appMode === 'simulator'
              ? simHistoryMap[activeSelectedPeak.peak.id]
              : undefined
          }
          refreshing={refreshingCity}
          onRefresh={(w) => void handleRefreshCityWeather(w)}
          onClose={() => setSelectedPeak(null)}
        />
      ) : activeSelectedWeather ? (
        <WeatherDetailCard
          weather={activeSelectedWeather}
          isSimulated={appMode === 'simulator'}
          simHistory={
            appMode === 'simulator'
              ? simHistoryMap[activeSelectedWeather.cityId]
              : undefined
          }
          refreshing={refreshingCity}
          onRefresh={(w) => void handleRefreshCityWeather(w)}
          onClose={() => setSelectedWeather(null)}
        />
      ) : appMode === 'live' && inspectedPoint ? (
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
        appMode={appMode}
        simWaveCount={simWaves.length}
        simFrontCount={simFronts.length}
        weatherEnabled={weatherEnabled}
        weatherSummary={weatherSummary}
      />

      {releaseNotesOpen && (
        <ReleaseNotesModal onClose={() => setReleaseNotesOpen(false)} />
      )}
    </main>
  );
}
