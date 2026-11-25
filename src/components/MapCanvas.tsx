import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { BASE_LAYERS, buildInitialStyle } from '../config/layers';
import { registerCloudProtocol } from '../services/cloudProtocol';
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

export interface MapCanvasHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  resetNorthPitch: () => void;
  geolocate: () => void;
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
  flyoverActive: boolean;
  flyoverPlaying: boolean;
  flyoverSpeed: number;
  flyoverPitch: number;
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
  onTelemetryChange: (telemetry: TelemetryState) => void;
  onInspectPoint: (lng: number, lat: number) => void;
  onViewportChange: (bounds: ViewportBounds) => void;
  onSelectWeather: (item: WeatherData) => void;
  onSelectPeak: (item: PeakDisplayItem) => void;
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
      flyoverActive,
      flyoverPlaying,
      flyoverSpeed,
      flyoverPitch,
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
      onTelemetryChange,
      onInspectPoint,
      onViewportChange,
      onSelectWeather,
      onSelectPeak,
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const markerRef = useRef<maplibregl.Marker | null>(null);
    const weatherMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
    const peakMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
    const mountedRadarIdsRef = useRef<Set<string>>(new Set());
    const isLoadedRef = useRef(false);
    const terrainRef = useRef(terrain3D);
    const onTelemetryRef = useRef(onTelemetryChange);
    const onInspectRef = useRef(onInspectPoint);
    const onViewportRef = useRef(onViewportChange);
    const onSelectWeatherRef = useRef(onSelectWeather);
    const onSelectPeakRef = useRef(onSelectPeak);

    terrainRef.current = terrain3D;
    onTelemetryRef.current = onTelemetryChange;
    onInspectRef.current = onInspectPoint;
    onViewportRef.current = onViewportChange;
    onSelectWeatherRef.current = onSelectWeather;
    onSelectPeakRef.current = onSelectPeak;

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
      });

      map.on('move', () => {
        scheduleTelemetry();
      });

      map.on('moveend', () => {
        emitViewport();
      });

      map.on('click', (e) => {
        onInspectRef.current(e.lngLat.lng, e.lngLat.lat);
      });

      mapRef.current = map;

      return () => {
        if (rafId !== null) cancelAnimationFrame(rafId);
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
        mountedRadarIdsRef.current.clear();
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

    // Sync Cinematic 3D Drone Flyover orbit
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !flyoverActive) return;

      if (Math.abs(map.getPitch() - flyoverPitch) > 2) {
        map.easeTo({ pitch: flyoverPitch, duration: 500 });
      }

      if (!flyoverPlaying) return;

      let rafId = 0;
      let lastTime = performance.now();

      const step = (now: number) => {
        const dt = Math.min(0.1, (now - lastTime) / 1000);
        lastTime = now;
        const currentBearing = map.getBearing();
        map.setBearing((currentBearing + dt * 14 * flyoverSpeed) % 360);
        rafId = requestAnimationFrame(step);
      };

      rafId = requestAnimationFrame(step);
      return () => cancelAnimationFrame(rafId);
    }, [flyoverActive, flyoverPlaying, flyoverSpeed, flyoverPitch]);

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

    // Sync NASA GIBS Cloud Cover overlay
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
          btn.title = `${item.cityName}: ${Math.round(item.temperature)}°C · ${meta.label} (${
            item.source === 'cache' ? 'Bellekten' : 'Canlı'
          })`;
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

          const dotSpan = document.createElement('span');
          dotSpan.className = `cache-dot ${
            item.source === 'cache' ? 'cached' : 'live'
          }`;

          btn.append(iconSpan, nameSpan, tempSpan, dotSpan);
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
            btn.title = `${peak.name} (${eleLabel}): ${Math.round(
              weather.temperature
            )}°C · ${meta.label}${snowTip} (${
              weather.source === 'cache' ? 'Bellekten' : 'Canlı'
            })`;
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

    return <div ref={containerRef} className="map-container" />;
  }
);
