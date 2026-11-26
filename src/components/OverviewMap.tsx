import { useEffect, useRef, useState } from 'react';
import type { JSX, MouseEvent } from 'react';
import { ChevronDown, ChevronUp, Map } from 'lucide-react';
import { loadCountriesGeoJson } from '../services/countryService';
import type { ViewportBounds } from '../types/weather';

export interface OverviewMapProps {
  bounds: ViewportBounds | null;
  onNavigate: (lng: number, lat: number) => void;
}

const CANVAS_WIDTH = 188;
const CANVAS_HEIGHT = 96;
const MIN_ZOOM_VISIBLE = 4.5;
const MAX_LAT = 85;
const MIN_BOX_WIDTH = 6;
const MIN_BOX_HEIGHT = 4;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

function projectX(lng: number, width: number): number {
  return ((lng + 180) / 360) * width;
}

function projectY(lat: number, height: number): number {
  const clamped = clamp(lat, -MAX_LAT, MAX_LAT);
  return ((MAX_LAT - clamped) / (MAX_LAT * 2)) * height;
}

function formatLat(lat: number): string {
  const dir = lat >= 0 ? 'K' : 'G';
  return `${Math.abs(lat).toFixed(2)}°${dir}`;
}

function formatLng(lng: number): string {
  const norm = normalizeLng(lng);
  const dir = norm >= 0 ? 'D' : 'B';
  return `${Math.abs(norm).toFixed(2)}°${dir}`;
}

function tracePolygonRings(
  ctx: CanvasRenderingContext2D,
  rings: GeoJSON.Position[][],
  width: number,
  height: number
): void {
  for (const ring of rings) {
    if (ring.length < 2) continue;
    for (let i = 0; i < ring.length; i += 1) {
      const [lng, lat] = ring[i];
      const x = projectX(lng, width);
      const y = projectY(lat, height);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.closePath();
  }
}

function traceGeometry(
  ctx: CanvasRenderingContext2D,
  geometry: GeoJSON.Geometry | null,
  width: number,
  height: number
): void {
  if (!geometry) return;
  if (geometry.type === 'Polygon') {
    tracePolygonRings(ctx, geometry.coordinates, width, height);
  } else if (geometry.type === 'MultiPolygon') {
    for (const polygon of geometry.coordinates) {
      tracePolygonRings(ctx, polygon, width, height);
    }
  } else if (geometry.type === 'GeometryCollection') {
    for (const child of geometry.geometries) {
      traceGeometry(ctx, child, width, height);
    }
  }
}

function renderBaseLayer(
  canvas: HTMLCanvasElement,
  geoJson: GeoJSON.FeatureCollection | null,
  dpr: number
): void {
  canvas.width = Math.round(CANVAS_WIDTH * dpr);
  canvas.height = Math.round(CANVAS_HEIGHT * dpr);

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // 1. Dark ocean background + subtle graticule (equator + prime meridian)
  ctx.fillStyle = '#091321';
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, CANVAS_HEIGHT / 2);
  ctx.lineTo(CANVAS_WIDTH, CANVAS_HEIGHT / 2);
  ctx.moveTo(CANVAS_WIDTH / 2, 0);
  ctx.lineTo(CANVAS_WIDTH / 2, CANVAS_HEIGHT);
  ctx.stroke();

  // 2. Land polygons
  if (!geoJson) return;

  ctx.fillStyle = 'rgba(51, 65, 85, 0.85)';
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (const feature of geoJson.features) {
    traceGeometry(ctx, feature.geometry, CANVAS_WIDTH, CANVAS_HEIGHT);
  }
  ctx.fill();
  ctx.stroke();
}

function drawViewportRects(
  ctx: CanvasRenderingContext2D,
  bounds: ViewportBounds
): void {
  const yTopRaw = projectY(bounds.north, CANVAS_HEIGHT);
  const yBottomRaw = projectY(bounds.south, CANVAS_HEIGHT);
  const rawHeight = Math.max(0, yBottomRaw - yTopRaw);

  let boxY = yTopRaw;
  let boxH = rawHeight;
  if (boxH < MIN_BOX_HEIGHT) {
    const midY = (yTopRaw + yBottomRaw) / 2;
    boxH = MIN_BOX_HEIGHT;
    boxY = clamp(midY - boxH / 2, 0, CANVAS_HEIGHT - boxH);
  }

  const rects: Array<{ x: number; w: number }> = [];
  const rawSpan = bounds.east - bounds.west;

  if (rawSpan >= 360) {
    rects.push({ x: 0, w: CANVAS_WIDTH });
  } else {
    const westNorm = normalizeLng(bounds.west);
    const eastNorm = normalizeLng(bounds.east);
    const crossesAntimeridian = bounds.west > bounds.east || westNorm > eastNorm;

    if (crossesAntimeridian) {
      const leftEdgeX = projectX(westNorm, CANVAS_WIDTH);
      const rightEdgeW = CANVAS_WIDTH - leftEdgeX;
      const wrapRightW = projectX(eastNorm, CANVAS_WIDTH);

      const minPartW = MIN_BOX_WIDTH / 2;
      const w1 = Math.max(rightEdgeW, minPartW);
      const x1 = clamp(CANVAS_WIDTH - w1, 0, CANVAS_WIDTH);
      const w2 = Math.max(wrapRightW, minPartW);

      rects.push({ x: x1, w: CANVAS_WIDTH - x1 });
      rects.push({ x: 0, w: Math.min(w2, CANVAS_WIDTH) });
    } else {
      const xLeft = projectX(westNorm, CANVAS_WIDTH);
      const xRight = projectX(eastNorm, CANVAS_WIDTH);
      const rawWidth = Math.max(0, xRight - xLeft);

      if (rawWidth < MIN_BOX_WIDTH) {
        const midX = (xLeft + xRight) / 2;
        const clampedX = clamp(midX - MIN_BOX_WIDTH / 2, 0, CANVAS_WIDTH - MIN_BOX_WIDTH);
        rects.push({ x: clampedX, w: MIN_BOX_WIDTH });
      } else {
        rects.push({ x: xLeft, w: rawWidth });
      }
    }
  }

  ctx.fillStyle = 'rgba(56, 189, 248, 0.22)';
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 1.25;

  for (const rect of rects) {
    ctx.fillRect(rect.x, boxY, rect.w, boxH);
    ctx.strokeRect(rect.x, boxY, rect.w, boxH);
  }
}

export function OverviewMap({ bounds, onNavigate }: OverviewMapProps): JSX.Element | null {
  const [collapsed, setCollapsed] = useState(false);
  const [worldGeoJson, setWorldGeoJson] = useState<GeoJSON.FeatureCollection | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const isVisible = bounds !== null && bounds.zoom >= MIN_ZOOM_VISIBLE;

  // Lazily load world polygons once the overview map is first needed
  useEffect(() => {
    if (!isVisible || worldGeoJson) return;
    let cancelled = false;

    loadCountriesGeoJson()
      .then((data) => {
        if (!cancelled) {
          setWorldGeoJson(data);
        }
      })
      .catch(() => {
        // Keep rendering ocean + graticule + viewport even if GeoJSON fetch fails
      });

    return () => {
      cancelled = true;
    };
  }, [isVisible, worldGeoJson]);

  // Pre-render ocean, graticule, and land polygons onto an offscreen canvas
  useEffect(() => {
    if (!isVisible) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (!baseCanvasRef.current) {
      baseCanvasRef.current = document.createElement('canvas');
    }
    renderBaseLayer(baseCanvasRef.current, worldGeoJson, dpr);
  }, [isVisible, worldGeoJson]);

  // Composite base map + live viewport rectangle + center dot on bounds updates
  useEffect(() => {
    if (!isVisible || collapsed || !bounds) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetW = Math.round(CANVAS_WIDTH * dpr);
    const targetH = Math.round(CANVAS_HEIGHT * dpr);

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    if (!baseCanvasRef.current) {
      baseCanvasRef.current = document.createElement('canvas');
      renderBaseLayer(baseCanvasRef.current, worldGeoJson, dpr);
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(baseCanvasRef.current, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // 3. Current viewport rectangle
    drawViewportRects(ctx, bounds);

    // 4. Bright center dot with subtle glow
    const cx = projectX(normalizeLng(bounds.centerLng), CANVAS_WIDTH);
    const cy = projectY(bounds.centerLat, CANVAS_HEIGHT);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(251, 191, 36, 0.28)';
    ctx.fill();

    ctx.shadowColor = 'rgba(251, 191, 36, 0.9)';
    ctx.shadowBlur = 5;
    ctx.beginPath();
    ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = '#fbbf24';
    ctx.fill();
    ctx.restore();
  }, [isVisible, collapsed, bounds, worldGeoJson]);

  if (!isVisible || !bounds) {
    return null;
  }

  const handleCanvasClick = (event: MouseEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width || CANVAS_WIDTH;
    const height = rect.height || CANVAS_HEIGHT;

    const x = clamp(event.clientX - rect.left, 0, width);
    const y = clamp(event.clientY - rect.top, 0, height);

    const lng = clamp((x / width) * 360 - 180, -180, 180);
    const lat = clamp(MAX_LAT - (y / height) * (MAX_LAT * 2), -MAX_LAT, MAX_LAT);
    onNavigate(lng, lat);
  };

  return (
    <aside
      className={`overview-map-dock${collapsed ? ' is-collapsed' : ''}`}
      aria-label="Mini konum haritası"
    >
      <div className="overview-map-header">
        <button
          type="button"
          className="overview-map-toggle"
          onClick={() => setCollapsed((prev) => !prev)}
          aria-expanded={!collapsed}
          title={collapsed ? 'Mini haritayı göster' : 'Mini haritayı gizle'}
        >
          <span className="overview-map-title">
            <Map size={12} aria-hidden="true" />
            <span>Mini Harita</span>
          </span>
          {collapsed ? (
            <ChevronUp size={13} aria-hidden="true" />
          ) : (
            <ChevronDown size={13} aria-hidden="true" />
          )}
        </button>
      </div>

      {!collapsed && (
        <>
          <canvas
            ref={canvasRef}
            className="overview-map-canvas"
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            style={{ width: `${CANVAS_WIDTH}px`, height: `${CANVAS_HEIGHT}px` }}
            onClick={handleCanvasClick}
            title="Haritada gitmek istediğiniz konuma tıklayın"
          />
          <div className="overview-map-coords">
            <span>{formatLat(bounds.centerLat)}</span>
            <span>{formatLng(bounds.centerLng)}</span>
          </div>
        </>
      )}
    </aside>
  );
}
