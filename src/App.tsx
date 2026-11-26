import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CompareCard } from './components/CompareCard';
import { CountryDetailCard } from './components/CountryDetailCard';
import { InspectCard } from './components/InspectCard';
import { LayerPanel } from './components/LayerPanel';
import { MapCanvas, type MapCanvasHandle } from './components/MapCanvas';
import { MapControls } from './components/MapControls';
import { OverviewMap } from './components/OverviewMap';
import { RadarTimeline } from './components/RadarTimeline';
import { ReleaseNotesModal } from './components/ReleaseNotesModal';
import { SearchBar } from './components/SearchBar';
import { SolarTimeline } from './components/SolarTimeline';
import { TelemetryBar } from './components/TelemetryBar';
import { WeatherDetailCard } from './components/WeatherDetailCard';
import { useCountrySelection } from './hooks/useCountrySelection';
import { useViewportDataSync } from './hooks/useViewportDataSync';
import {
  clearAllAppCaches,
  getAllCacheStats,
  type CacheBreakdown,
} from './services/cacheStats';
import type { CountryHoverInfo } from './services/countryService';
import {
  isFavoritePlace,
  loadFavorites,
  removeFavoritePlace,
  toggleFavoritePlace,
  type FavoritePlace,
} from './services/favoritesService';
import { fetchElevation, reverseGeocode } from './services/geocoding';
import { fetchMarineData } from './services/marineService';
import {
  fetchPeakWeatherBatch,
  getPeakCacheId,
} from './services/peakService';
import { fetchRainViewerFrames } from './services/radarService';
import type { SeaDisplayItem } from './services/seaIndex';
import { getSunPositionForPoint } from './services/solarService';
import { invalidateCityWeather } from './services/weatherCache';
import { fetchWeatherForCities } from './services/weatherService';
import type { CompareTarget } from './types/compare';
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
  WeatherData,
} from './types/weather';

export default function App() {
  const mapHandleRef = useRef<MapCanvasHandle | null>(null);
  const inspectAbortRef = useRef<AbortController | null>(null);

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
  const [selectedWeather, setSelectedWeather] = useState<WeatherData | null>(
    null
  );
  const [peaksEnabled, setPeaksEnabled] = useState(true);
  const [selectedPeak, setSelectedPeak] = useState<PeakDisplayItem | null>(
    null
  );
  const [seasEnabled, setSeasEnabled] = useState(false);
  const [selectedSeaId, setSelectedSeaId] = useState<string | null>(null);
  const [compareFirst, setCompareFirst] = useState<CompareTarget | null>(null);
  const [compareSecond, setCompareSecond] = useState<CompareTarget | null>(
    null
  );
  const [refreshingCity, setRefreshingCity] = useState(false);
  const [cacheStats, setCacheStats] = useState<CacheBreakdown>(() =>
    getAllCacheStats()
  );
  const [favorites, setFavorites] = useState<FavoritePlace[]>(() =>
    loadFavorites()
  );

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

  const refreshCacheStats = useCallback(() => {
    setCacheStats(getAllCacheStats());
  }, []);

  const {
    viewportBounds,
    lastBoundsRef,
    weatherItems,
    setWeatherItems,
    peakItems,
    setPeakItems,
    seaItems,
    weatherSummary,
    handleViewportChange,
    resyncAllActive,
  } = useViewportDataSync({
    weatherEnabled,
    peaksEnabled,
    seasEnabled,
    onCacheUpdated: refreshCacheStats,
    onWeatherCleared: () => setSelectedWeather(null),
    onPeaksCleared: () => setSelectedPeak(null),
    onSeasCleared: () => setSelectedSeaId(null),
  });

  const {
    selectedCountry,
    selectedCountryBbox,
    countryDetail,
    countryDetailLoading,
    selectCountry,
    clearCountrySelection,
  } = useCountrySelection({
    countryMode,
    onCacheUpdated: refreshCacheStats,
  });

  // Keep selectedWeather / selectedPeak live-synced when viewport items refresh
  useEffect(() => {
    setSelectedWeather((prev) => {
      if (!prev) return null;
      return weatherItems.find((w) => w.cityId === prev.cityId) ?? prev;
    });
  }, [weatherItems]);

  useEffect(() => {
    setSelectedPeak((prev) => {
      if (!prev) return null;
      return peakItems.find((p) => p.peak.id === prev.peak.id) ?? prev;
    });
  }, [peakItems]);

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
  }, [solarDateMs, lastBoundsRef]);

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

  useEffect(() => {
    return () => {
      inspectAbortRef.current?.abort();
    };
  }, []);

  const handleInspectPoint = useCallback(
    async (lng: number, lat: number, presetPlaceName?: string) => {
      clearCountrySelection();
      setSelectedWeather(null);
      setSelectedPeak(null);
      setSelectedSeaId(null);
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
        refreshCacheStats();
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
    [clearCountrySelection, refreshCacheStats]
  );

  const handleSelectWeather = useCallback(
    (item: WeatherData) => {
      if (compareFirst && !compareSecond) {
        if (item.cityId !== compareFirst.id) {
          setCompareSecond({
            id: item.cityId,
            kind: 'city',
            weather: item,
          });
        }
        return;
      }

      inspectAbortRef.current?.abort();
      clearCountrySelection();
      setInspectedPoint(null);
      setSelectedSeaId(null);
      setSelectedPeak(null);
      setCompareFirst(null);
      setCompareSecond(null);
      setSelectedWeather(item);
    },
    [compareFirst, compareSecond, clearCountrySelection]
  );

  const handleSelectPeak = useCallback(
    (item: PeakDisplayItem) => {
      if (compareFirst && !compareSecond) {
        if (item.weather) {
          const peakTargetId = getPeakCacheId(item.peak.id);
          if (peakTargetId !== compareFirst.id) {
            setCompareSecond({
              id: peakTargetId,
              kind: 'peak',
              weather: item.weather,
              elevationMeters: item.peak.elevation,
            });
          }
        }
        return;
      }

      inspectAbortRef.current?.abort();
      clearCountrySelection();
      setSelectedWeather(null);
      setSelectedSeaId(null);
      setCompareFirst(null);
      setCompareSecond(null);
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
    },
    [compareFirst, compareSecond, clearCountrySelection]
  );

  const handleSelectCountry = useCallback(
    (
      info: CountryHoverInfo,
      bbox: [number, number, number, number] | null
    ) => {
      inspectAbortRef.current?.abort();
      setSelectedWeather(null);
      setSelectedPeak(null);
      setInspectedPoint(null);
      setSelectedSeaId(null);
      setCompareFirst(null);
      setCompareSecond(null);

      if (bbox) {
        mapHandleRef.current?.fitCountryBounds(bbox);
      }
      selectCountry(info, bbox);
    },
    [selectCountry]
  );

  const handleSelectSea = useCallback(
    (item: SeaDisplayItem) => {
      inspectAbortRef.current?.abort();
      clearCountrySelection();
      setSelectedWeather(null);
      setSelectedPeak(null);
      setCompareFirst(null);
      setCompareSecond(null);
      setSelectedSeaId(item.sea.id);
      setInspectedPoint({
        lng: item.sea.lng,
        lat: item.sea.lat,
        elevation: 0,
        placeName: `${item.sea.name} (${item.sea.region})`,
        marine: item.marine,
        loading: false,
      });
    },
    [clearCountrySelection]
  );

  const handleStartCompare = useCallback(
    (target: CompareTarget) => {
      inspectAbortRef.current?.abort();
      clearCountrySelection();
      setSelectedWeather(null);
      setSelectedPeak(null);
      setInspectedPoint(null);
      setSelectedSeaId(null);
      setCompareFirst(target);
      setCompareSecond(null);
    },
    [clearCountrySelection]
  );

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
            refreshCacheStats();
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
          refreshCacheStats();
        }
      } catch {
        // Keep existing weather item on transient error
      } finally {
        setRefreshingCity(false);
      }
    },
    [selectedPeak, setPeakItems, setWeatherItems, refreshCacheStats]
  );

  const handleClearAllCaches = useCallback(() => {
    clearAllAppCaches();
    refreshCacheStats();
    resyncAllActive();
  }, [refreshCacheStats, resyncAllActive]);

  const handleToggleFavorite = useCallback(
    (place: Omit<FavoritePlace, 'savedAt'>) => {
      setFavorites(toggleFavoritePlace(place));
    },
    []
  );

  const handleRemoveFavorite = useCallback((id: string) => {
    setFavorites(removeFavoritePlace(id));
  }, []);

  const handleSelectFavorite = useCallback(
    (fav: FavoritePlace) => {
      setCompareFirst(null);
      setCompareSecond(null);
      setFlyTarget({
        lng: fav.lng,
        lat: fav.lat,
        zoom: fav.zoom ?? 11,
        pitch: terrain3D ? 45 : 0,
        bearing: 0,
        timestamp: Date.now(),
      });
      void handleInspectPoint(
        fav.lng,
        fav.lat,
        fav.subtitle ? `${fav.name} · ${fav.subtitle}` : fav.name
      );
    },
    [terrain3D, handleInspectPoint]
  );

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

  const countryFavId = selectedCountry
    ? `fav:country:${selectedCountry.iso || selectedCountry.nameEn}`
    : '';
  const countryBboxLat = selectedCountryBbox
    ? (selectedCountryBbox[1] + selectedCountryBbox[3]) / 2
    : null;
  const countryBboxLng = selectedCountryBbox
    ? (selectedCountryBbox[0] + selectedCountryBbox[2]) / 2
    : null;

  const peakFavId = selectedPeak?.weather
    ? `fav:peak:${selectedPeak.weather.cityId}`
    : '';
  const weatherFavId = selectedWeather
    ? `fav:city:${selectedWeather.cityId}`
    : '';
  const inspectFavId = inspectedPoint
    ? `fav:${
        selectedSeaId
          ? `sea:${selectedSeaId}`
          : `pt:${inspectedPoint.lat.toFixed(3)},${inspectedPoint.lng.toFixed(3)}`
      }`
    : '';

  return (
    <main className="app-shell">
      <MapCanvas
        ref={mapHandleRef}
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
          inspectedPoint
            ? { lng: inspectedPoint.lng, lat: inspectedPoint.lat }
            : null
        }
        weatherItems={weatherItems}
        weatherBadgeOpacity={weatherBadgeOpacity}
        selectedWeatherCityId={selectedWeather?.cityId ?? null}
        peakItems={peakItems}
        selectedPeakId={selectedPeak?.peak.id ?? null}
        seaItems={seaItems}
        selectedSeaId={inspectedPoint ? selectedSeaId : null}
        onTelemetryChange={setTelemetry}
        onInspectPoint={(lng, lat) => void handleInspectPoint(lng, lat)}
        onViewportChange={handleViewportChange}
        onSelectWeather={handleSelectWeather}
        onSelectPeak={handleSelectPeak}
        onSelectSea={handleSelectSea}
        countryMode={countryMode}
        selectedCountryId={selectedCountry?.id ?? null}
        onSelectCountry={handleSelectCountry}
        onCountryLoadingChange={setCountryLoading}
      />

      <SearchBar
        onSelectLandmark={handleSelectLandmark}
        onSelectSearchResult={handleSelectSearchResult}
        onOpenReleaseNotes={() => setReleaseNotesOpen(true)}
        favorites={favorites}
        onSelectFavorite={handleSelectFavorite}
        onRemoveFavorite={handleRemoveFavorite}
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
        cacheStats={cacheStats}
        peaksEnabled={peaksEnabled}
        seasEnabled={seasEnabled}
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
        onClearWeatherCache={handleClearAllCaches}
        onTogglePeaks={() => setPeaksEnabled((prev) => !prev)}
        onToggleSeas={() => setSeasEnabled((prev) => !prev)}
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

      <OverviewMap
        bounds={viewportBounds}
        onNavigate={(lng, lat) =>
          setFlyTarget({
            lng,
            lat,
            zoom: Math.max(viewportBounds?.zoom ?? 6, 5),
            pitch: 0,
            bearing: 0,
            timestamp: Date.now(),
          })
        }
      />

      {(rainEnabled || solarEnabled) && (
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
      )}

      {compareFirst ? (
        <CompareCard
          first={compareFirst}
          second={compareSecond}
          onSwap={() => {
            if (!compareSecond) return;
            const prevFirst = compareFirst;
            setCompareFirst(compareSecond);
            setCompareSecond(prevFirst);
          }}
          onClearSecond={() => setCompareSecond(null)}
          onClose={() => {
            setCompareFirst(null);
            setCompareSecond(null);
          }}
        />
      ) : selectedCountry ? (
        <CountryDetailCard
          country={selectedCountry}
          detail={countryDetail}
          loading={countryDetailLoading}
          onFocusCountry={() => {
            if (selectedCountryBbox) {
              mapHandleRef.current?.fitCountryBounds(selectedCountryBbox);
            }
          }}
          onClose={clearCountrySelection}
          isFavorite={isFavoritePlace(countryFavId, favorites)}
          onToggleFavorite={() =>
            handleToggleFavorite({
              id: countryFavId,
              name: selectedCountry.nameTr,
              subtitle: selectedCountry.continent || undefined,
              kind: 'country',
              lat:
                countryDetail?.capitalLat ??
                countryBboxLat ??
                lastBoundsRef.current?.centerLat ??
                0,
              lng:
                countryDetail?.capitalLng ??
                countryBboxLng ??
                lastBoundsRef.current?.centerLng ??
                0,
              zoom: 5,
            })
          }
        />
      ) : selectedPeak?.weather ? (
        <WeatherDetailCard
          weather={selectedPeak.weather}
          elevationMeters={selectedPeak.peak.elevation}
          refreshing={refreshingCity}
          onRefresh={(w) => void handleRefreshCityWeather(w)}
          onStartCompare={() => {
            if (!selectedPeak.weather) return;
            handleStartCompare({
              id: getPeakCacheId(selectedPeak.peak.id),
              kind: 'peak',
              weather: selectedPeak.weather,
              elevationMeters: selectedPeak.peak.elevation,
            });
          }}
          onClose={() => setSelectedPeak(null)}
          isFavorite={isFavoritePlace(peakFavId, favorites)}
          onToggleFavorite={() => {
            if (!selectedPeak.weather) return;
            handleToggleFavorite({
              id: peakFavId,
              name: selectedPeak.peak.name,
              subtitle: `${selectedPeak.peak.elevation.toLocaleString('tr-TR')} m`,
              kind: 'peak',
              lat: selectedPeak.peak.lat,
              lng: selectedPeak.peak.lng,
              zoom: 11,
            });
          }}
          onForecastSynced={refreshCacheStats}
        />
      ) : selectedWeather ? (
        <WeatherDetailCard
          weather={selectedWeather}
          refreshing={refreshingCity}
          onRefresh={(w) => void handleRefreshCityWeather(w)}
          onStartCompare={() =>
            handleStartCompare({
              id: selectedWeather.cityId,
              kind: 'city',
              weather: selectedWeather,
            })
          }
          onClose={() => setSelectedWeather(null)}
          isFavorite={isFavoritePlace(weatherFavId, favorites)}
          onToggleFavorite={() =>
            handleToggleFavorite({
              id: weatherFavId,
              name: selectedWeather.cityName,
              subtitle: selectedWeather.country || undefined,
              kind: 'city',
              lat: selectedWeather.lat,
              lng: selectedWeather.lng,
              zoom: 10,
            })
          }
          onForecastSynced={refreshCacheStats}
        />
      ) : inspectedPoint ? (
        <InspectCard
          point={inspectedPoint}
          onZoom3D={handleZoom3D}
          onClose={() => {
            inspectAbortRef.current?.abort();
            setInspectedPoint(null);
            setSelectedSeaId(null);
          }}
          isFavorite={isFavoritePlace(inspectFavId, favorites)}
          onToggleFavorite={() =>
            handleToggleFavorite({
              id: inspectFavId,
              name: inspectedPoint.placeName || 'Seçili Coğrafi Nokta',
              subtitle:
                typeof inspectedPoint.elevation === 'number' && !selectedSeaId
                  ? `${Math.round(inspectedPoint.elevation).toLocaleString('tr-TR')} m`
                  : undefined,
              kind: selectedSeaId ? 'sea' : 'point',
              lat: inspectedPoint.lat,
              lng: inspectedPoint.lng,
              zoom: selectedSeaId ? 8 : 11,
            })
          }
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
