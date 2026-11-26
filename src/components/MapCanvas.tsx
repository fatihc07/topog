import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  forwardRef,
} from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { BASE_LAYERS, buildInitialStyle } from '../config/layers';
import { registerCloudProtocol } from '../services/cloudProtocol';
import {
  isoToFlagEmoji,
  loadCountriesGeoJson,
  type CountryHoverInfo,
} from '../services/countryService';
import type { SeaDisplayItem } from '../services/seaIndex';
import { buildNightPolygonGeoJson } from '../services/solarService';
import { getWeatherMeta } from '../services/weatherService';
import type { BaseLayerId, FlyTarget, TelemetryState } from '../types/map';
import type {
  PeakDisplayItem,
  RadarFrame,
  ViewportBounds,
  WeatherData,
} from '../types/weather';
import { getAnimatedWeatherSvg } from './WeatherIcon';

function extractCountryHoverInfo(
  id: number,
  properties: Record<string, unknown> | undefined
): CountryHoverInfo {
  const props = properties ?? {};
  const iso = typeof props.iso === 'string' ? props.iso : '';
  const nameTr = typeof props.nameTr === 'string' ? props.nameTr : '';
  const nameEn = typeof props.nameEn === 'string' ? props.nameEn : '';
  const continent = typeof props.continent === 'string' ? props.continent : '';
  return {
    id,
    iso,
    nameTr,
    nameEn,
    continent,
    flag: isoToFlagEmoji(iso),
  };
}

function computeFeatureBbox(
  geoJson: GeoJSON.FeatureCollection | null,
  featureId: number
): [number, number, number, number] | null {
  if (!geoJson) return null;
  const feature = geoJson.features.find((f) => f.id === featureId);
  if (!feature?.geometry) return null;

  const rings: GeoJSON.Position[][] = [];
  if (feature.geometry.type === 'Polygon') {
    if (feature.geometry.coordinates[0]) {
      rings.push(feature.geometry.coordinates[0]);
    }
  } else if (feature.geometry.type === 'MultiPolygon') {
    for (const poly of feature.geometry.coordinates) {
      if (poly[0]) rings.push(poly[0]);
    }
  }
  if (rings.length === 0) return null;

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  let wMinLng = Infinity;
  let wMaxLng = -Infinity;

  let bestRingBbox: [number, number, number, number] | null = null;
  let bestRingArea = -1;

  for (const ring of rings) {
    let rMinLng = Infinity;
    let rMinLat = Infinity;
    let rMaxLng = -Infinity;
    let rMaxLat = -Infinity;

    for (const pt of ring) {
      const lng = pt[0];
      const lat = pt[1];
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;

      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;

      const wrappedLng = lng < 0 ? lng + 360 : lng;
      if (wrappedLng < wMinLng) wMinLng = wrappedLng;
      if (wrappedLng > wMaxLng) wMaxLng = wrappedLng;

      if (lng < rMinLng) rMinLng = lng;
      if (lng > rMaxLng) rMaxLng = lng;
      if (lat < rMinLat) rMinLat = lat;
      if (lat > rMaxLat) rMaxLat = lat;
    }

    if (Number.isFinite(rMinLng) && rMaxLng - rMinLng <= 180) {
      const area = (rMaxLng - rMinLng) * (rMaxLat - rMinLat);
      if (area > bestRingArea) {
        bestRingArea = area;
        bestRingBbox = [rMinLng, rMinLat, rMaxLng, rMaxLat];
      }
    }
  }

  if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) return null;

  if (maxLng - minLng <= 180) {
    return [minLng, minLat, maxLng, maxLat];
  }

  // Antimeridian-spanning countries (e.g. Russia, USA, Fiji): prefer wrapped [0..360] span if <= 180°
  if (wMaxLng - wMinLng <= 180) {
    return [wMinLng, minLat, wMaxLng, maxLat];
  }

  // Global-territory countries (e.g. France): fall back to primary mainland ring
  return bestRingBbox ?? [minLng, minLat, maxLng, maxLat];
}

export interface MapCanvasHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  resetNorthPitch: () => void;
  geolocate: () => void;
  fitCountryBounds: (bbox: [number, number, number, number]) => void;
}

interface MapCanvasProps {
  activeLayer: BaseLayerId;
  terrain3D: boolean;
  exaggeration: number;
  hillshade: boolean;
  globeMode: boolean;
  solarEnabled: boolean;
  solarDateMs: number;
  sunAzimuthDeg: number;
  sunElevationDeg: number;
  cloudsEnabled: boolean;
  cloudsOpacity: number;
  rainEnabled: boolean;
  rainOpacity: number;
  radarFrames: RadarFrame[];
  activeRadarIndex: number;
  flyTarget: FlyTarget | null;
  markerCoords: { lng: number; lat: number } | null;
  weatherItems: WeatherData[];
  weatherBadgeOpacity: number;
  selectedWeatherCityId: string | null;
  peakItems: PeakDisplayItem[];
  selectedPeakId: string | null;
  seaItems: SeaDisplayItem[];
  selectedSeaId: string | null;
  onTelemetryChange: (telemetry: TelemetryState) => void;
  onInspectPoint: (lng: number, lat: number) => void;
  onViewportChange: (bounds: ViewportBounds) => void;
  onSelectWeather: (item: WeatherData) => void;
  onSelectPeak: (item: PeakDisplayItem) => void;
  onSelectSea: (item: SeaDisplayItem) => void;
  countryMode: boolean;
  selectedCountryId: number | null;
  onSelectCountry: (
    info: CountryHoverInfo,
    bbox: [number, number, number, number] | null
  ) => void;
  onCountryLoadingChange?: (loading: boolean) => void;
}

export const MapCanvas = forwardRef<MapCanvasHandle, MapCanvasProps>(
  function MapCanvas(
    {
      activeLayer,
      terrain3D,
      exaggeration,
      hillshade,
      globeMode,
      solarEnabled,
      solarDateMs,
      sunAzimuthDeg,
      sunElevationDeg,
      cloudsEnabled,
      cloudsOpacity,
      rainEnabled,
      rainOpacity,
      radarFrames,
      activeRadarIndex,
      flyTarget,
      markerCoords,
      weatherItems,
      weatherBadgeOpacity,
      selectedWeatherCityId,
      peakItems,
      selectedPeakId,
      seaItems,
      selectedSeaId,
      onTelemetryChange,
      onInspectPoint,
      onViewportChange,
      onSelectWeather,
      onSelectPeak,
      onSelectSea,
      countryMode,
      selectedCountryId,
      onSelectCountry,
      onCountryLoadingChange,
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);
    const markerRef = useRef<maplibregl.Marker | null>(null);
    const weatherMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
    const peakMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
    const seaMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
    const mountedRadarIdsRef = useRef<Set<string>>(new Set());
    const isLoadedRef = useRef(false);
    const terrainRef = useRef(terrain3D);
    const countryModeRef = useRef(countryMode);
    const countriesLoadedRef = useRef(false);
    const countriesGeoJsonRef = useRef<GeoJSON.FeatureCollection | null>(null);
    const hoveredCountryIdRef = useRef<number | null>(null);
    const selectedCountryIdRef = useRef<number | null>(null);
    const countryTooltipRef = useRef<HTMLDivElement | null>(null);
    const tooltipPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const [hoveredCountry, setHoveredCountry] =
      useState<CountryHoverInfo | null>(null);
    const onTelemetryRef = useRef(onTelemetryChange);
    const onInspectRef = useRef(onInspectPoint);
    const onViewportRef = useRef(onViewportChange);
    const onSelectWeatherRef = useRef(onSelectWeather);
    const onSelectPeakRef = useRef(onSelectPeak);
    const onSelectSeaRef = useRef(onSelectSea);
    const onSelectCountryRef = useRef(onSelectCountry);
    const onCountryLoadingRef = useRef(onCountryLoadingChange);

    terrainRef.current = terrain3D;
    countryModeRef.current = countryMode;
    onTelemetryRef.current = onTelemetryChange;
    onInspectRef.current = onInspectPoint;
    onViewportRef.current = onViewportChange;
    onSelectWeatherRef.current = onSelectWeather;
    onSelectPeakRef.current = onSelectPeak;
    onSelectSeaRef.current = onSelectSea;
    onSelectCountryRef.current = onSelectCountry;
    onCountryLoadingRef.current = onCountryLoadingChange;

    const clearCountryHover = () => {
      const map = mapRef.current;
      if (
        map &&
        hoveredCountryIdRef.current !== null &&
        map.getSource('countries-source')
      ) {
        map.setFeatureState(
          { source: 'countries-source', id: hoveredCountryIdRef.current },
          { hover: false }
        );
      }
      hoveredCountryIdRef.current = null;
      setHoveredCountry(null);
    };

    const positionCountryTooltip = (x: number, y: number) => {
      tooltipPosRef.current = { x, y };
      const el = countryTooltipRef.current;
      const container = containerRef.current;
      if (!el || !container) return;
      const cw = container.clientWidth || window.innerWidth;
      const tx = Math.min(Math.max(12, x + 16), Math.max(12, cw - 252));
      const ty = y > 68 ? y - 54 : y + 18;
      el.style.transform = `translate3d(${Math.round(tx)}px, ${Math.round(ty)}px, 0)`;
    };

    useLayoutEffect(() => {
      if (hoveredCountry) {
        positionCountryTooltip(
          tooltipPosRef.current.x,
          tooltipPosRef.current.y
        );
      }
    }, [hoveredCountry]);

    useImperativeHandle(ref, () => ({
      zoomIn: () => {
        mapRef.current?.zoomIn({ duration: 300 });
      },
      zoomOut: () => {
        mapRef.current?.zoomOut({ duration: 300 });
      },
      resetNorthPitch: () => {
        mapRef.current?.easeTo({ bearing: 0, pitch: 0, duration: 550 });
      },
      geolocate: () => {
        if (!navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const { longitude, latitude } = pos.coords;
            mapRef.current?.flyTo({
              center: [longitude, latitude],
              zoom: 12,
              pitch: terrainRef.current ? 45 : 0,
              duration: 1400,
            });
            onInspectRef.current(longitude, latitude);
          },
          () => {
            // Geolocation permission denied or unavailable
          },
          { enableHighAccuracy: true, timeout: 8000 }
        );
      },
      fitCountryBounds: (bbox) => {
        const map = mapRef.current;
        if (!map) return;
        let west = bbox[0];
        const south = bbox[1];
        let east = bbox[2];
        const north = bbox[3];
        if (east - west > 180) {
          const wWest = west < 0 ? west + 360 : west;
          const wEast = east < 0 ? east + 360 : east;
          if (Math.abs(wEast - wWest) <= 180) {
            west = Math.min(wWest, wEast);
            east = Math.max(wWest, wEast);
          }
        }
        const cw = containerRef.current?.clientWidth ?? window.innerWidth;
        const ch = containerRef.current?.clientHeight ?? window.innerHeight;
        const isNarrow = cw < 820 || ch < 480;
        const padding = isNarrow
          ? 48
          : { top: 70, bottom: 70, left: 370, right: 350 };
        map.fitBounds(
          [
            [west, south],
            [east, north],
          ],
          {
            padding,
            maxZoom: 6.5,
            duration: 1100,
          }
        );
      },
    }));

    // Initialize MapLibre GL JS instance once
    useEffect(() => {
      if (!containerRef.current || mapRef.current) return;

      registerCloudProtocol();

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: buildInitialStyle(activeLayer),
        center: [20, 24],
        zoom: 2.4,
        pitch: 0,
        bearing: 0,
        maxPitch: 85,
        attributionControl: false,
      });

      map.addControl(
        new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }),
        'bottom-left'
      );
      map.addControl(
        new maplibregl.AttributionControl({ compact: true }),
        'bottom-right'
      );

      let rafId: number | null = null;
      let lastCursor: { lng: number; lat: number } | null = null;

      const emitTelemetry = () => {
        rafId = null;
        if (!mapRef.current) return;
        let elevation: number | null = null;
        if (lastCursor && terrainRef.current) {
          try {
            const queried = map.queryTerrainElevation(lastCursor);
            if (typeof queried === 'number' && Number.isFinite(queried)) {
              elevation = Math.round(queried);
            }
          } catch {
            elevation = null;
          }
        }
        onTelemetryRef.current({
          lng: lastCursor?.lng ?? null,
          lat: lastCursor?.lat ?? null,
          elevation,
          zoom: map.getZoom(),
          pitch: map.getPitch(),
          bearing: map.getBearing(),
        });
      };

      const scheduleTelemetry = () => {
        if (rafId === null) {
          rafId = requestAnimationFrame(emitTelemetry);
        }
      };

      const emitViewport = () => {
        const b = map.getBounds();
        const center = map.getCenter();
        onViewportRef.current({
          west: b.getWest(),
          south: b.getSouth(),
          east: b.getEast(),
          north: b.getNorth(),
          centerLng: center.lng,
          centerLat: center.lat,
          zoom: map.getZoom(),
        });
      };

      map.on('load', () => {
        isLoadedRef.current = true;
        setMapInstance(map);
        if (map.getLayer('clouds-overlay')) {
          map.setLayoutProperty(
            'clouds-overlay',
            'visibility',
            cloudsEnabled ? 'visible' : 'none'
          );
          map.setPaintProperty('clouds-overlay', 'raster-opacity', cloudsOpacity);
        }
        scheduleTelemetry();
        emitViewport();
      });

      map.on('mousemove', (e) => {
        lastCursor = { lng: e.lngLat.lng, lat: e.lngLat.lat };
        scheduleTelemetry();

        if (
          countryModeRef.current &&
          countriesLoadedRef.current &&
          map.getLayer('countries-fill')
        ) {
          const features = map.queryRenderedFeatures(e.point, {
            layers: ['countries-fill'],
          });
          const top = features[0];
          if (top && typeof top.id === 'number') {
            positionCountryTooltip(e.point.x, e.point.y);
            if (hoveredCountryIdRef.current !== top.id) {
              clearCountryHover();
              map.setFeatureState(
                { source: 'countries-source', id: top.id },
                { hover: true }
              );
              hoveredCountryIdRef.current = top.id;
              setHoveredCountry(
                extractCountryHoverInfo(
                  top.id,
                  top.properties as Record<string, unknown> | undefined
                )
              );
            }
            map.getCanvas().style.cursor = 'pointer';
          } else {
            if (hoveredCountryIdRef.current !== null) {
              clearCountryHover();
            }
            map.getCanvas().style.cursor = '';
          }
        }
      });

      const handleCanvasMouseLeave = () => {
        if (hoveredCountryIdRef.current !== null) {
          clearCountryHover();
        }
        map.getCanvas().style.cursor = '';
      };

      const canvasEl = map.getCanvas();
      canvasEl.addEventListener('mouseleave', handleCanvasMouseLeave);

      map.on('move', () => {
        scheduleTelemetry();
      });

      map.on('moveend', () => {
        emitViewport();
      });

      map.on('click', (e) => {
        if (
          countryModeRef.current &&
          countriesLoadedRef.current &&
          map.getLayer('countries-fill')
        ) {
          const features = map.queryRenderedFeatures(e.point, {
            layers: ['countries-fill'],
          });
          const top = features[0];
          if (top && typeof top.id === 'number') {
            const info = extractCountryHoverInfo(
              top.id,
              top.properties as Record<string, unknown> | undefined
            );
            const bbox = computeFeatureBbox(countriesGeoJsonRef.current, top.id);
            onSelectCountryRef.current(info, bbox);
            return;
          }
        }
        onInspectRef.current(e.lngLat.lng, e.lngLat.lat);
      });

      mapRef.current = map;

      return () => {
        canvasEl.removeEventListener('mouseleave', handleCanvasMouseLeave);
        if (rafId !== null) cancelAnimationFrame(rafId);
        hoveredCountryIdRef.current = null;
        selectedCountryIdRef.current = null;
        countriesLoadedRef.current = false;
        countriesGeoJsonRef.current = null;
        markerRef.current?.remove();
        markerRef.current = null;
        for (const m of weatherMarkersRef.current.values()) {
          m.remove();
        }
        weatherMarkersRef.current.clear();
        for (const m of peakMarkersRef.current.values()) {
          m.remove();
        }
        peakMarkersRef.current.clear();
        for (const m of seaMarkersRef.current.values()) {
          m.remove();
        }
        seaMarkersRef.current.clear();
        mountedRadarIdsRef.current.clear();
        setMapInstance(null);
        map.remove();
        mapRef.current = null;
        isLoadedRef.current = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Sync active base layer visibility without calling setStyle
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !isLoadedRef.current) return;
      for (const cfg of BASE_LAYERS) {
        if (map.getLayer(cfg.id)) {
          map.setLayoutProperty(
            cfg.id,
            'visibility',
            cfg.id === activeLayer ? 'visible' : 'none'
          );
        }
      }
    }, [activeLayer]);

    // Sync 3D Terrain & Exaggeration
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !isLoadedRef.current) return;
      if (terrain3D) {
        map.setTerrain({ source: 'terrain-dem', exaggeration });
        if (map.getPitch() < 30) {
          map.easeTo({ pitch: 50, duration: 750 });
        }
      } else {
        map.setTerrain(null);
        if (map.getPitch() > 0) {
          map.easeTo({ pitch: 0, duration: 600 });
        }
      }
    }, [terrain3D, exaggeration]);

    // Sync Hillshade overlay & Solar azimuth illumination
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !isLoadedRef.current) return;
      if (map.getLayer('hillshade-overlay')) {
        map.setLayoutProperty(
          'hillshade-overlay',
          'visibility',
          hillshade ? 'visible' : 'none'
        );
        const dir = solarEnabled
          ? Math.round(((sunAzimuthDeg % 360) + 360) % 360)
          : 315;
        const exag = solarEnabled
          ? sunElevationDeg < 0
            ? 0.25
            : Math.min(0.85, 0.35 + (1 - Math.min(1, sunElevationDeg / 65)) * 0.45)
          : 0.55;
        map.setPaintProperty(
          'hillshade-overlay',
          'hillshade-illumination-direction',
          dir
        );
        map.setPaintProperty('hillshade-overlay', 'hillshade-exaggeration', exag);
      }
    }, [hillshade, solarEnabled, sunAzimuthDeg, sunElevationDeg]);

    // Sync Solar Day/Night Terminator overlay
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !isLoadedRef.current) return;

      const vis = solarEnabled ? 'visible' : 'none';
      if (map.getLayer('solar-night-fill')) {
        map.setLayoutProperty('solar-night-fill', 'visibility', vis);
      }
      if (map.getLayer('solar-terminator-line')) {
        map.setLayoutProperty('solar-terminator-line', 'visibility', vis);
      }

      if (!solarEnabled) return;
      const { nightPolygon, terminatorLine } = buildNightPolygonGeoJson(
        new Date(solarDateMs)
      );
      const nightSource = map.getSource('solar-night') as
        | maplibregl.GeoJSONSource
        | undefined;
      const lineSource = map.getSource('solar-terminator') as
        | maplibregl.GeoJSONSource
        | undefined;
      nightSource?.setData(nightPolygon);
      lineSource?.setData(terminatorLine);
    }, [solarEnabled, solarDateMs]);

    // Sync Globe / Mercator projection
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !isLoadedRef.current) return;
      try {
        (map as unknown as { setProjection?: (p: { type: string }) => void }).setProjection?.({
          type: globeMode ? 'globe' : 'mercator',
        });
      } catch {
        // Projection API unavailable or unsupported in current WebGL context
      }
    }, [globeMode]);

    // Sync Country Mode (lazy-load countries GeoJSON + layer visibility)
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !isLoadedRef.current) return;

      const layerIds = [
        'countries-fill',
        'countries-outline-glow',
        'countries-outline',
      ];

      if (!countryMode) {
        for (const id of layerIds) {
          if (map.getLayer(id)) {
            map.setLayoutProperty(id, 'visibility', 'none');
          }
        }
        clearCountryHover();
        onCountryLoadingRef.current?.(false);
        map.getCanvas().style.cursor = '';
        return;
      }

      let cancelled = false;
      if (!countriesLoadedRef.current) {
        onCountryLoadingRef.current?.(true);
        loadCountriesGeoJson()
          .then((data) => {
            if (cancelled || !mapRef.current) return;
            countriesGeoJsonRef.current = data;
            const src = map.getSource('countries-source') as
              | maplibregl.GeoJSONSource
              | undefined;
            src?.setData(data);
            countriesLoadedRef.current = true;
            for (const id of layerIds) {
              if (map.getLayer(id)) {
                map.setLayoutProperty(id, 'visibility', 'visible');
              }
            }
          })
          .catch(() => {
            // Transient fetch failure; next toggle will retry
          })
          .finally(() => {
            onCountryLoadingRef.current?.(false);
          });
      } else {
        for (const id of layerIds) {
          if (map.getLayer(id)) {
            map.setLayoutProperty(id, 'visibility', 'visible');
          }
        }
      }

      return () => {
        cancelled = true;
      };
    }, [countryMode, mapInstance]);

    // Sync selected country feature-state highlight
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !map.getSource('countries-source')) return;

      const prevId = selectedCountryIdRef.current;
      if (prevId !== null && (prevId !== selectedCountryId || !countryMode)) {
        map.setFeatureState(
          { source: 'countries-source', id: prevId },
          { selected: false }
        );
        selectedCountryIdRef.current = null;
      }

      if (countryMode && selectedCountryId !== null) {
        map.setFeatureState(
          { source: 'countries-source', id: selectedCountryId },
          { selected: true }
        );
        selectedCountryIdRef.current = selectedCountryId;
      }
    }, [selectedCountryId, countryMode, mapInstance]);

    // Sync NASA GIBS / SSEC RealEarth Cloud Cover overlay
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !isLoadedRef.current) return;
      if (map.getLayer('clouds-overlay')) {
        map.setLayoutProperty(
          'clouds-overlay',
          'visibility',
          cloudsEnabled ? 'visible' : 'none'
        );
        map.setPaintProperty('clouds-overlay', 'raster-opacity', cloudsOpacity);
      }
    }, [cloudsEnabled, cloudsOpacity]);

    // Sync RainViewer Radar overlay & 2h animation frames without flicker
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !isLoadedRef.current) return;

      const mountedIds = mountedRadarIdsRef.current;

      if (!rainEnabled || radarFrames.length === 0) {
        for (const id of mountedIds) {
          if (map.getLayer(id)) {
            map.setLayoutProperty(id, 'visibility', 'none');
            map.setPaintProperty(id, 'raster-opacity', 0);
          }
        }
        return;
      }

      const incomingIds = new Set(
        radarFrames.map((frame) => `rain-radar-${frame.time}`)
      );

      for (const oldId of Array.from(mountedIds)) {
        if (!incomingIds.has(oldId)) {
          if (map.getLayer(oldId)) map.removeLayer(oldId);
          if (map.getSource(oldId)) map.removeSource(oldId);
          mountedIds.delete(oldId);
        }
      }

      const safeIndex = Math.min(
        Math.max(0, activeRadarIndex),
        radarFrames.length - 1
      );
      const activeId = `rain-radar-${radarFrames[safeIndex].time}`;

      for (const frame of radarFrames) {
        const id = `rain-radar-${frame.time}`;
        if (!mountedIds.has(id)) {
          if (!map.getSource(id)) {
            map.addSource(id, {
              type: 'raster',
              tiles: [frame.tileUrl],
              tileSize: 256,
              maxzoom: 12,
              attribution: '© RainViewer',
            });
          }
          if (!map.getLayer(id)) {
            map.addLayer({
              id,
              type: 'raster',
              source: id,
              layout: { visibility: 'visible' },
              paint: {
                'raster-opacity': id === activeId ? rainOpacity : 0,
                'raster-fade-duration': 0,
              },
            });
          }
          mountedIds.add(id);
        } else if (map.getLayer(id)) {
          map.setLayoutProperty(id, 'visibility', 'visible');
          map.setPaintProperty(
            id,
            'raster-opacity',
            id === activeId ? rainOpacity : 0
          );
        }
      }
    }, [rainEnabled, rainOpacity, radarFrames, activeRadarIndex]);

    // Handle flyTo requests
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !flyTarget) return;
      map.flyTo({
        center: [flyTarget.lng, flyTarget.lat],
        zoom: flyTarget.zoom ?? 11,
        pitch: flyTarget.pitch ?? (terrainRef.current ? 52 : 0),
        bearing: flyTarget.bearing ?? 0,
        duration: 1600,
        essential: true,
      });
    }, [flyTarget]);

    // Sync inspect marker
    useEffect(() => {
      const map = mapRef.current;
      if (!map) return;
      if (!markerCoords) {
        markerRef.current?.remove();
        markerRef.current = null;
        return;
      }

      if (!markerRef.current) {
        const el = document.createElement('div');
        el.className = 'inspect-marker';
        markerRef.current = new maplibregl.Marker({ element: el })
          .setLngLat([markerCoords.lng, markerCoords.lat])
          .addTo(map);
      } else {
        markerRef.current.setLngLat([markerCoords.lng, markerCoords.lat]);
      }
    }, [markerCoords]);

    // Sync weather badge layer opacity via CSS variable on map container
    useEffect(() => {
      if (containerRef.current) {
        containerRef.current.style.setProperty(
          '--weather-badge-opacity',
          String(weatherBadgeOpacity)
        );
      }
    }, [weatherBadgeOpacity]);

    // Reconcile weather pill markers
    useEffect(() => {
      const map = mapRef.current;
      if (!map) return;

      const markers = weatherMarkersRef.current;
      const incomingIds = new Set(weatherItems.map((w) => w.cityId));

      for (const [id, existingMarker] of markers.entries()) {
        if (!incomingIds.has(id)) {
          existingMarker.remove();
          markers.delete(id);
        }
      }

      for (const item of weatherItems) {
        const meta = getWeatherMeta(item.weatherCode, item.isDay);
        const isSelected = item.cityId === selectedWeatherCityId;
        const existing = markers.get(item.cityId);

        const buildBadgeContent = (btn: HTMLButtonElement) => {
          btn.className = `weather-badge${isSelected ? ' selected' : ''}`;
          const sourceLabel = item.source === 'cache' ? 'Bellekten' : 'Canlı';
          const feelsLike = Number.isFinite(item.apparentTemperature)
            ? Math.round(item.apparentTemperature)
            : null;
          btn.title =
            feelsLike !== null
              ? `${item.cityName}: ${Math.round(item.temperature)}°C · Hissedilen: ${feelsLike}°C · ${meta.label} (${sourceLabel})`
              : `${item.cityName}: ${Math.round(item.temperature)}°C · ${meta.label} (${sourceLabel})`;
          btn.innerHTML = '';

          const iconSpan = document.createElement('span');
          iconSpan.className = 'weather-badge-icon';
          iconSpan.innerHTML = getAnimatedWeatherSvg(
            item.weatherCode,
            item.isDay,
            20
          );

          const nameSpan = document.createElement('span');
          nameSpan.className = 'weather-badge-city';
          nameSpan.textContent = item.cityName;

          const tempSpan = document.createElement('span');
          tempSpan.className = 'weather-badge-temp';
          tempSpan.textContent = `${Math.round(item.temperature)}°`;

          btn.append(iconSpan, nameSpan, tempSpan);
          if (feelsLike !== null) {
            const feelsSpan = document.createElement('span');
            feelsSpan.className = 'weather-badge-feels';
            feelsSpan.textContent = `H ${feelsLike}°`;
            feelsSpan.title = `Hissedilen sıcaklık: ${feelsLike}°C`;
            btn.append(feelsSpan);
          }
          const dotSpan = document.createElement('span');
          dotSpan.className = `cache-dot ${
            item.source === 'cache' ? 'cached' : 'live'
          }`;
          btn.append(dotSpan);
          btn.onclick = (ev) => {
            ev.stopPropagation();
            onSelectWeatherRef.current(item);
          };
        };

        if (existing) {
          existing.setLngLat([item.lng, item.lat]);
          const btn = existing.getElement().firstElementChild as HTMLButtonElement | null;
          if (btn) buildBadgeContent(btn);
        } else {
          const wrapper = document.createElement('div');
          wrapper.className = 'weather-marker-anchor';

          const btn = document.createElement('button');
          btn.type = 'button';
          buildBadgeContent(btn);

          const pin = document.createElement('span');
          pin.className = 'weather-marker-pin';

          wrapper.append(btn, pin);

          const marker = new maplibregl.Marker({
            element: wrapper,
            anchor: 'bottom',
          })
            .setLngLat([item.lng, item.lat])
            .addTo(map);
          markers.set(item.cityId, marker);
        }
      }
    }, [weatherItems, selectedWeatherCityId]);

    // Reconcile mountain peak markers (name + elevation + real summit temp if available)
    useEffect(() => {
      const map = mapRef.current;
      if (!map) return;

      const markers = peakMarkersRef.current;
      const incomingIds = new Set(peakItems.map((p) => p.peak.id));

      for (const [id, existingMarker] of markers.entries()) {
        if (!incomingIds.has(id)) {
          existingMarker.remove();
          markers.delete(id);
        }
      }

      for (const item of peakItems) {
        const { peak, weather } = item;
        const isSelected = peak.id === selectedPeakId;
        const existing = markers.get(peak.id);

        const buildPeakContent = (btn: HTMLButtonElement) => {
          btn.className = `peak-badge${isSelected ? ' selected' : ''}`;
          const eleLabel = `${peak.elevation.toLocaleString('tr-TR')} m`;

          if (weather) {
            const meta = getWeatherMeta(weather.weatherCode, weather.isDay);
            const snowTip =
              typeof weather.snowDepthCm === 'number' && weather.snowDepthCm > 0
                ? ` · Kar: ${weather.snowDepthCm.toLocaleString('tr-TR')} cm`
                : '';
            const sourceLabel =
              weather.source === 'cache' ? 'Bellekten' : 'Canlı';
            btn.title = `${peak.name} (${eleLabel}): ${Math.round(
              weather.temperature
            )}°C · ${meta.label}${snowTip} (${sourceLabel})`;
          } else {
            btn.title = `${peak.name} · ${eleLabel}`;
          }

          btn.innerHTML = '';

          const triSpan = document.createElement('span');
          triSpan.className = 'peak-badge-tri';
          triSpan.textContent = '▲';

          const nameSpan = document.createElement('span');
          nameSpan.className = 'peak-badge-name';
          nameSpan.textContent = peak.name;

          const eleSpan = document.createElement('span');
          eleSpan.className = 'peak-badge-ele';
          eleSpan.textContent = eleLabel;

          btn.append(triSpan, nameSpan, eleSpan);

          // Only show temperature & weather icon when real weather data exists
          if (weather) {
            const iconSpan = document.createElement('span');
            iconSpan.className = 'weather-badge-icon';
            iconSpan.innerHTML = getAnimatedWeatherSvg(
              weather.weatherCode,
              weather.isDay,
              18
            );

            const tempSpan = document.createElement('span');
            tempSpan.className = 'peak-badge-temp';
            tempSpan.textContent = `${Math.round(weather.temperature)}°`;

            btn.append(iconSpan, tempSpan);

            if (typeof weather.snowDepthCm === 'number' && weather.snowDepthCm > 0) {
              const snowSpan = document.createElement('span');
              snowSpan.className = 'peak-badge-snow';
              snowSpan.textContent = `❄ ${weather.snowDepthCm.toLocaleString('tr-TR')} cm`;
              btn.append(snowSpan);
            }

            const dotSpan = document.createElement('span');
            dotSpan.className = `cache-dot ${
              weather.source === 'cache' ? 'cached' : 'live'
            }`;

            btn.append(dotSpan);
          }

          btn.onclick = (ev) => {
            ev.stopPropagation();
            onSelectPeakRef.current(item);
          };
        };

        if (existing) {
          existing.setLngLat([peak.lng, peak.lat]);
          const btn = existing.getElement().firstElementChild as HTMLButtonElement | null;
          if (btn) buildPeakContent(btn);
        } else {
          const wrapper = document.createElement('div');
          wrapper.className = 'weather-marker-anchor';

          const btn = document.createElement('button');
          btn.type = 'button';
          buildPeakContent(btn);

          const pin = document.createElement('span');
          pin.className = 'peak-marker-pin';

          wrapper.append(btn, pin);

          const marker = new maplibregl.Marker({
            element: wrapper,
            anchor: 'bottom',
          })
            .setLngLat([peak.lng, peak.lat])
            .addTo(map);
          markers.set(peak.id, marker);
        }
      }
    }, [peakItems, selectedPeakId]);

    // Reconcile sea temperature & wave height markers
    useEffect(() => {
      const map = mapRef.current;
      if (!map) return;

      const markers = seaMarkersRef.current;
      const incomingIds = new Set(seaItems.map((s) => s.sea.id));

      for (const [id, existingMarker] of markers.entries()) {
        if (!incomingIds.has(id)) {
          existingMarker.remove();
          markers.delete(id);
        }
      }

      for (const item of seaItems) {
        const { sea, marine } = item;
        const isSelected = sea.id === selectedSeaId;
        const existing = markers.get(sea.id);

        const buildSeaContent = (btn: HTMLButtonElement) => {
          btn.className = `sea-badge${isSelected ? ' selected' : ''}`;
          const parts = [`${sea.name} (${sea.region})`];
          if (typeof marine.seaTempC === 'number') {
            parts.push(`Su: ${Math.round(marine.seaTempC)}°C`);
          }
          if (typeof marine.waveHeightM === 'number') {
            parts.push(`Dalga: ${marine.waveHeightM.toFixed(1)} m`);
          }
          const sourceLabel = marine.source === 'cache' ? 'Bellekten' : 'Canlı';
          btn.title = `${parts.join(' · ')} (${sourceLabel})`;
          btn.innerHTML = '';

          const iconSpan = document.createElement('span');
          iconSpan.className = 'sea-badge-icon';
          iconSpan.setAttribute('aria-hidden', 'true');
          iconSpan.textContent = '🌊';

          const nameSpan = document.createElement('span');
          nameSpan.className = 'sea-badge-name';
          nameSpan.textContent = sea.name;

          btn.append(iconSpan, nameSpan);

          if (typeof marine.seaTempC === 'number') {
            const tempSpan = document.createElement('span');
            tempSpan.className = 'sea-badge-temp';
            tempSpan.textContent = `${Math.round(marine.seaTempC)}°`;
            btn.append(tempSpan);
          }

          if (typeof marine.waveHeightM === 'number') {
            const waveSpan = document.createElement('span');
            waveSpan.className = 'sea-badge-wave';
            waveSpan.textContent = `${marine.waveHeightM.toFixed(1)} m`;
            btn.append(waveSpan);
          }

          const dotSpan = document.createElement('span');
          dotSpan.className = `cache-dot ${
            marine.source === 'cache' ? 'cached' : 'live'
          }`;
          btn.append(dotSpan);

          btn.onclick = (ev) => {
            ev.stopPropagation();
            onSelectSeaRef.current(item);
          };
        };

        if (existing) {
          existing.setLngLat([sea.lng, sea.lat]);
          const btn = existing.getElement().firstElementChild as HTMLButtonElement | null;
          if (btn) buildSeaContent(btn);
        } else {
          const wrapper = document.createElement('div');
          wrapper.className = 'weather-marker-anchor';

          const btn = document.createElement('button');
          btn.type = 'button';
          buildSeaContent(btn);

          const pin = document.createElement('span');
          pin.className = 'sea-marker-pin';

          wrapper.append(btn, pin);

          const marker = new maplibregl.Marker({
            element: wrapper,
            anchor: 'bottom',
          })
            .setLngLat([sea.lng, sea.lat])
            .addTo(map);
          markers.set(sea.id, marker);
        }
      }
    }, [seaItems, selectedSeaId]);

    return (
      <>
        <div ref={containerRef} className="map-container" />
        {countryMode && hoveredCountry && (
          <div
            ref={countryTooltipRef}
            className="country-hover-tooltip"
            aria-live="polite"
          >
            <div className="country-hover-title-row">
              {hoveredCountry.flag && (
                <span className="country-hover-flag" aria-hidden="true">
                  {hoveredCountry.flag}
                </span>
              )}
              <span>{hoveredCountry.nameTr}</span>
            </div>
            {(hoveredCountry.iso || hoveredCountry.continent) && (
              <div className="country-hover-meta">
                {hoveredCountry.iso && (
                  <span className="country-hover-iso">{hoveredCountry.iso}</span>
                )}
                {hoveredCountry.continent && (
                  <span>{hoveredCountry.continent}</span>
                )}
              </div>
            )}
          </div>
        )}
      </>
    );
  }
);
