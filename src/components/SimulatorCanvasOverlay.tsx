import { useEffect, useRef } from 'react';
import type maplibregl from 'maplibre-gl';
import { evaluateSimulatedTempAt } from '../services/simulatorEngine';
import type { SimFrontZone, SimSeason, SimWave } from '../types/simulator';

export interface SimulatorCanvasOverlayProps {
  map: maplibregl.Map | null;
  active: boolean;
  waves: SimWave[];
  fronts: SimFrontZone[];
  season: SimSeason;
  windDirDeg: number | null;
  showHeatmap: boolean;
  playing: boolean;
}

interface PrecipParticle {
  active: boolean;
  lng: number;
  lat: number;
  dx: number;
  dy: number;
  vx: number;
  vy: number;
  age: number;
  maxAge: number;
  isSnow: boolean;
  size: number;
  phase: number;
}

interface LightningBolt {
  lng: number;
  lat: number;
  mainPath: Array<{ dx: number; dy: number }>;
  branches: Array<Array<{ dx: number; dy: number }>>;
  age: number;
  maxAge: number;
}

interface PrecipEmitter {
  lng: number;
  lat: number;
  radiusPx: number;
  cx: number;
  cy: number;
  isCyclone: boolean;
  isFront: boolean;
  strength: number;
}

const GRID_COLS = 34;
const GRID_ROWS = 20;
const PARTICLE_POOL_SIZE = 180;
const MAX_BOLTS = 4;

// Marching squares edge lookup tables per 4-bit case (tl=8, tr=4, br=2, bl=1)
// Edges: 0=top, 1=right, 2=bottom, 3=left
const MS_SEGMENTS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [], // 0
  [[3, 2]], // 1: bl
  [[2, 1]], // 2: br
  [[3, 1]], // 3: bl, br
  [[0, 1]], // 4: tr
  [
    [0, 3],
    [1, 2],
  ], // 5: saddle (tr, bl)
  [[0, 2]], // 6: tr, br
  [[0, 3]], // 7: tr, br, bl
  [[3, 0]], // 8: tl
  [[0, 2]], // 9: tl, bl
  [
    [0, 1],
    [2, 3],
  ], // 10: saddle (tl, br)
  [[0, 1]], // 11: tl, bl, br
  [[3, 1]], // 12: tl, tr
  [[2, 1]], // 13: tl, tr, bl
  [[3, 2]], // 14: tl, tr, br
  [], // 15
];

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function kmToPixels(radiusKm: number, lat: number, zoom: number): number {
  const clampedLat = clamp(lat, -85, 85);
  const metersPerPixel =
    (156543.03392 * Math.cos((clampedLat * Math.PI) / 180)) /
    Math.pow(2, zoom);
  return (radiusKm * 1000) / Math.max(0.001, metersPerPixel);
}

function getWaveLife(w: SimWave): number {
  const ageRatio = w.maxAgeSec > 0 ? clamp(w.ageSec / w.maxAgeSec, 0, 1) : 0;
  const fadeIn = clamp(w.ageSec / 0.7 + 0.3, 0, 1);
  const fadeOut = clamp(1 - Math.pow(ageRatio, 2.0), 0, 1);
  return fadeIn * fadeOut;
}

/**
 * Maps simulated temperature (°C) to RGBA bytes for the offscreen heatmap canvas.
 * <= -12°C: deep icy blue | 0°C: cyan-blue | 8..20°C: transparent | >= 28°C: warm amber/red
 */
function writeTempColor(
  t: number,
  out: Uint8ClampedArray,
  offset: number
): void {
  if (!Number.isFinite(t)) {
    out[offset] = 0;
    out[offset + 1] = 0;
    out[offset + 2] = 0;
    out[offset + 3] = 0;
    return;
  }

  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;

  if (t <= -12) {
    r = 29;
    g = 78;
    b = 216;
    a = 96;
  } else if (t <= 0) {
    const k = (t + 12) / 12; // 0 at -12, 1 at 0
    r = Math.round(lerp(29, 56, k));
    g = Math.round(lerp(78, 189, k));
    b = Math.round(lerp(216, 248, k));
    a = Math.round(lerp(96, 58, k));
  } else if (t < 8) {
    const k = t / 8; // 0 at 0, 1 at 8
    r = 56;
    g = 189;
    b = 248;
    a = Math.round(lerp(56, 0, k));
  } else if (t <= 20) {
    a = 0;
  } else if (t < 28) {
    const k = (t - 20) / 8;
    r = Math.round(lerp(251, 249, k));
    g = Math.round(lerp(191, 115, k));
    b = Math.round(lerp(36, 22, k));
    a = Math.round(lerp(0, 66, k));
  } else {
    const k = clamp((t - 28) / 12, 0, 1);
    r = Math.round(lerp(249, 220, k));
    g = Math.round(lerp(115, 38, k));
    b = Math.round(lerp(22, 38, k));
    a = Math.round(lerp(66, 94, k));
  }

  out[offset] = r;
  out[offset + 1] = g;
  out[offset + 2] = b;
  out[offset + 3] = a;
}

function interpolateEdgePoint(
  edge: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  tl: number,
  tr: number,
  br: number,
  bl: number
): [number, number] {
  const safeRatio = (v1: number, v2: number): number => {
    const denom = v1 - v2;
    if (Math.abs(denom) < 1e-5) return 0.5;
    return clamp(v1 / denom, 0, 1);
  };

  switch (edge) {
    case 0: // top: tl -> tr
      return [lerp(x0, x1, safeRatio(tl, tr)), y0];
    case 1: // right: tr -> br
      return [x1, lerp(y0, y1, safeRatio(tr, br))];
    case 2: // bottom: bl -> br
      return [lerp(x0, x1, safeRatio(bl, br)), y1];
    case 3: // left: tl -> bl
    default:
      return [x0, lerp(y0, y1, safeRatio(tl, bl))];
  }
}

function createEmptyParticle(): PrecipParticle {
  return {
    active: false,
    lng: 0,
    lat: 0,
    dx: 0,
    dy: 0,
    vx: 0,
    vy: 0,
    age: 0,
    maxAge: 1,
    isSnow: false,
    size: 2,
    phase: 0,
  };
}

function generateLightningBolt(
  lng: number,
  lat: number,
  scalePx: number
): LightningBolt {
  const boltLen = clamp(scalePx * 0.48, 34, 96);
  const steps = 6;
  const mainPath: Array<{ dx: number; dy: number }> = [{ dx: 0, dy: -boltLen * 0.45 }];
  const branches: Array<Array<{ dx: number; dy: number }>> = [];

  let curX = (Math.random() - 0.5) * 18;
  let curY = -boltLen * 0.45;

  for (let i = 1; i <= steps; i += 1) {
    curX += (Math.random() - 0.5) * 26;
    curY += boltLen / steps;
    mainPath.push({ dx: curX, dy: curY });

    if (i >= 2 && i <= steps - 1 && Math.random() < 0.65) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const b1x = curX + side * (10 + Math.random() * 14);
      const b1y = curY + 10 + Math.random() * 12;
      const b2x = b1x + side * (6 + Math.random() * 12);
      const b2y = b1y + 9 + Math.random() * 12;
      branches.push([
        { dx: curX, dy: curY },
        { dx: b1x, dy: b1y },
        { dx: b2x, dy: b2y },
      ]);
    }
  }

  return {
    lng,
    lat,
    mainPath,
    branches,
    age: 0,
    maxAge: 0.24 + Math.random() * 0.14,
  };
}

function drawPressureBadge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  label: 'L' | 'H',
  alpha: number
): void {
  const isLow = label === 'L';
  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);

  const r = 13;
  const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, r * 2.1);
  if (isLow) {
    glow.addColorStop(0, 'rgba(239, 68, 68, 0.45)');
    glow.addColorStop(0.55, 'rgba(192, 132, 252, 0.24)');
    glow.addColorStop(1, 'rgba(192, 132, 252, 0)');
  } else {
    glow.addColorStop(0, 'rgba(251, 191, 36, 0.48)');
    glow.addColorStop(0.55, 'rgba(245, 158, 11, 0.22)');
    glow.addColorStop(1, 'rgba(251, 191, 36, 0)');
  }
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 2.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.84)';
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = isLow ? 'rgba(248, 113, 113, 0.9)' : 'rgba(251, 191, 36, 0.92)';
  ctx.stroke();

  ctx.font = '700 13px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = isLow ? '#fecaca' : '#fef08a';
  ctx.fillText(label, cx, cy + 0.5);

  ctx.restore();
}

function drawCycloneSpirals(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radiusPx: number,
  rotationDeg: number,
  life: number,
  strength: number
): void {
  const armCount = 3;
  const maxR = Math.max(24, radiusPx * 0.78);
  const baseRot = (rotationDeg * Math.PI) / 180;
  const baseAlpha = clamp(0.32 * life * Math.min(1.3, strength), 0.08, 0.55);

  ctx.save();
  ctx.lineCap = 'round';

  for (let a = 0; a < armCount; a += 1) {
    const startAngle = baseRot + (a * Math.PI * 2) / armCount;
    ctx.beginPath();
    const steps = 22;
    for (let s = 0; s <= steps; s += 1) {
      const frac = s / steps;
      const r = 12 + frac * (maxR - 12);
      const theta = startAngle + frac * Math.PI * 1.45;
      const px = cx + Math.cos(theta) * r;
      const py = cy + Math.sin(theta) * r;
      if (s === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }

    const grad = ctx.createRadialGradient(cx, cy, 10, cx, cy, maxR);
    grad.addColorStop(0, `rgba(248, 113, 113, ${baseAlpha})`);
    grad.addColorStop(0.55, `rgba(192, 132, 252, ${baseAlpha * 0.85})`);
    grad.addColorStop(1, 'rgba(192, 132, 252, 0)');

    ctx.strokeStyle = grad;
    ctx.lineWidth = Math.max(1.8, radiusPx * 0.025);
    ctx.stroke();
  }

  ctx.restore();
}

function drawDekRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radiusPx: number,
  animTime: number,
  life: number
): void {
  const pulse = 0.5 + 0.5 * Math.sin(animTime * 4.2);
  const ringR = Math.max(18, radiusPx * (0.54 + pulse * 0.06));
  const alpha = clamp((0.28 + pulse * 0.25) * life, 0.08, 0.6);

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
  ctx.setLineDash([5, 5]);
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = `rgba(186, 230, 253, ${alpha})`;
  ctx.stroke();
  ctx.setLineDash([]);

  // Small DEK badge on top-right of the pulsing ring
  const bx = cx + ringR * 0.72;
  const by = cy - ringR * 0.72;
  ctx.fillStyle = `rgba(12, 74, 110, ${clamp(0.78 * life, 0.2, 0.85)})`;
  ctx.strokeStyle = `rgba(125, 211, 252, ${clamp(0.8 * life, 0.2, 0.85)})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(bx - 16, by - 9, 32, 18, 9);
  ctx.fill();
  ctx.stroke();

  ctx.font = '700 9.5px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = `rgba(224, 242, 254, ${clamp(0.95 * life, 0.2, 0.98)})`;
  ctx.fillText('DEK', bx, by + 0.5);
  ctx.restore();
}

export function SimulatorCanvasOverlay({
  map,
  active,
  waves,
  fronts,
  season,
  windDirDeg,
  showHeatmap,
  playing,
}: SimulatorCanvasOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const wavesRef = useRef(waves);
  const frontsRef = useRef(fronts);
  const seasonRef = useRef(season);
  const windDirRef = useRef(windDirDeg);
  const showHeatmapRef = useRef(showHeatmap);
  const playingRef = useRef(playing);

  wavesRef.current = waves;
  frontsRef.current = fronts;
  seasonRef.current = season;
  windDirRef.current = windDirDeg;
  showHeatmapRef.current = showHeatmap;
  playingRef.current = playing;

  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const offscreenImgRef = useRef<ImageData | null>(null);
  const tempGridRef = useRef<Float32Array>(
    new Float32Array(GRID_COLS * GRID_ROWS)
  );
  const particlesRef = useRef<PrecipParticle[]>(
    Array.from({ length: PARTICLE_POOL_SIZE }, createEmptyParticle)
  );
  const boltsRef = useRef<LightningBolt[]>([]);
  const animTimeRef = useRef(0);

  useEffect(() => {
    if (!active || !map) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!offscreenRef.current) {
      const off = document.createElement('canvas');
      off.width = GRID_COLS;
      off.height = GRID_ROWS;
      const offCtx = off.getContext('2d');
      offscreenRef.current = off;
      offscreenCtxRef.current = offCtx;
      if (offCtx) {
        offscreenImgRef.current = offCtx.createImageData(GRID_COLS, GRID_ROWS);
      }
    }

    let cssWidth = 1;
    let cssHeight = 1;
    let dpr = 1;

    const updateCanvasSize = () => {
      const container = map.getContainer();
      const rect = container.getBoundingClientRect();
      cssWidth = Math.max(1, Math.round(rect.width || container.clientWidth));
      cssHeight = Math.max(1, Math.round(rect.height || container.clientHeight));
      dpr = Math.min(window.devicePixelRatio || 1, 2);

      const targetW = Math.max(1, Math.round(cssWidth * dpr));
      const targetH = Math.max(1, Math.round(cssHeight * dpr));
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
    };

    updateCanvasSize();

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            updateCanvasSize();
            drawFrame(0);
          })
        : null;
    resizeObserver?.observe(map.getContainer());
    window.addEventListener('resize', updateCanvasSize);

    const drawLayerHeatmapAndIsotherm = (
      curWaves: SimWave[],
      curFronts: SimFrontZone[],
      curSeason: SimSeason,
      curWind: number | null
    ) => {
      if (!showHeatmapRef.current) return;
      const off = offscreenRef.current;
      const offCtx = offscreenCtxRef.current;
      const imgData = offscreenImgRef.current;
      if (!off || !offCtx || !imgData) return;

      const grid = tempGridRef.current;
      const pixels = imgData.data;

      for (let r = 0; r < GRID_ROWS; r += 1) {
        const y = (r / (GRID_ROWS - 1)) * cssHeight;
        for (let c = 0; c < GRID_COLS; c += 1) {
          const x = (c / (GRID_COLS - 1)) * cssWidth;
          const lngLat = map.unproject([x, y]);
          const temp = evaluateSimulatedTempAt(
            lngLat.lat,
            lngLat.lng,
            100,
            curWaves,
            curFronts,
            curSeason,
            curWind
          );
          const idx = r * GRID_COLS + c;
          grid[idx] = temp;
          writeTempColor(temp, pixels, idx * 4);
        }
      }

      offCtx.putImageData(imgData, 0, 0);

      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(off, 0, 0, cssWidth, cssHeight);
      ctx.restore();

      // Marching Squares for 0°C freezing isotherm
      const cellW = cssWidth / (GRID_COLS - 1);
      const cellH = cssHeight / (GRID_ROWS - 1);
      const segments: Array<[number, number, number, number]> = [];

      for (let r = 0; r < GRID_ROWS - 1; r += 1) {
        const y0 = r * cellH;
        const y1 = y0 + cellH;
        for (let c = 0; c < GRID_COLS - 1; c += 1) {
          const x0 = c * cellW;
          const x1 = x0 + cellW;

          const tl = grid[r * GRID_COLS + c];
          const tr = grid[r * GRID_COLS + c + 1];
          const br = grid[(r + 1) * GRID_COLS + c + 1];
          const bl = grid[(r + 1) * GRID_COLS + c];

          let mask =
            (tl <= 0 ? 8 : 0) |
            (tr <= 0 ? 4 : 0) |
            (br <= 0 ? 2 : 0) |
            (bl <= 0 ? 1 : 0);

          if (mask === 0 || mask === 15) continue;

          // Disambiguate saddle cases using bilinear center sign
          if (mask === 5 || mask === 10) {
            const centerVal = (tl + tr + br + bl) * 0.25;
            if (centerVal > 0 && mask === 5) mask = 10;
            else if (centerVal > 0 && mask === 10) mask = 5;
          }

          const pairs = MS_SEGMENTS[mask];
          for (let p = 0; p < pairs.length; p += 1) {
            const [eA, eB] = pairs[p];
            const [ax, ay] = interpolateEdgePoint(
              eA,
              x0,
              y0,
              x1,
              y1,
              tl,
              tr,
              br,
              bl
            );
            const [bx, by] = interpolateEdgePoint(
              eB,
              x0,
              y0,
              x1,
              y1,
              tl,
              tr,
              br,
              bl
            );
            segments.push([ax, ay, bx, by]);
          }
        }
      }

      if (segments.length > 0) {
        ctx.save();
        ctx.lineCap = 'round';
        ctx.setLineDash([7, 5]);

        ctx.beginPath();
        for (let i = 0; i < segments.length; i += 1) {
          const [ax, ay, bx, by] = segments[i];
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
        }

        // Soft cyan outer glow
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.34)';
        ctx.lineWidth = 4.6;
        ctx.stroke();

        // Crisp cyan-white dashed contour
        ctx.strokeStyle = 'rgba(224, 242, 254, 0.92)';
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.setLineDash([]);

        // Pick a well-centered segment inside safe margins for the "0°C" pill
        let labelSeg = segments[Math.floor(segments.length / 2)];
        const cxMid = cssWidth * 0.5;
        const cyMid = cssHeight * 0.48;
        let bestScore = Infinity;
        for (let i = 0; i < segments.length; i += 1) {
          const s = segments[i];
          const mx = (s[0] + s[2]) * 0.5;
          const my = (s[1] + s[3]) * 0.5;
          if (
            mx < 48 ||
            mx > cssWidth - 48 ||
            my < 64 ||
            my > cssHeight - 100
          ) {
            continue;
          }
          const dist = Math.hypot(mx - cxMid, my - cyMid);
          if (dist < bestScore) {
            bestScore = dist;
            labelSeg = s;
          }
        }

        const lx = clamp((labelSeg[0] + labelSeg[2]) * 0.5, 36, cssWidth - 36);
        const ly = clamp((labelSeg[1] + labelSeg[3]) * 0.5, 48, cssHeight - 48);

        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.strokeStyle = 'rgba(125, 211, 252, 0.78)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(lx - 18, ly - 9.5, 36, 19, 9.5);
        ctx.fill();
        ctx.stroke();

        ctx.font = '700 10.5px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#e0f2fe';
        ctx.fillText('0°C', lx, ly + 0.5);

        ctx.restore();
      }
    };

    const drawLayerAirMasses = (
      curWaves: SimWave[],
      curFronts: SimFrontZone[],
      zoom: number,
      animTime: number
    ) => {
      for (let i = 0; i < curWaves.length; i += 1) {
        const w = curWaves[i];
        const pt = map.project([w.lng, w.lat]);
        const radiusPx = kmToPixels(w.radiusKm, w.lat, zoom);
        if (
          pt.x + radiusPx < -120 ||
          pt.x - radiusPx > cssWidth + 120 ||
          pt.y + radiusPx < -120 ||
          pt.y - radiusPx > cssHeight + 120
        ) {
          continue;
        }

        const life = getWaveLife(w);
        const strengthFactor = clamp(w.strength, 0.4, 1.8);
        const coreAlpha = clamp(0.32 * life * Math.sqrt(strengthFactor), 0.05, 0.5);

        const grad = ctx.createRadialGradient(
          pt.x,
          pt.y,
          0,
          pt.x,
          pt.y,
          Math.max(8, radiusPx)
        );

        if (w.kind === 'cold') {
          grad.addColorStop(0, `rgba(56, 189, 248, ${coreAlpha})`);
          grad.addColorStop(0.45, `rgba(14, 165, 233, ${coreAlpha * 0.52})`);
          grad.addColorStop(0.78, `rgba(56, 189, 248, ${coreAlpha * 0.16})`);
          grad.addColorStop(1, 'rgba(56, 189, 248, 0)');
        } else if (w.kind === 'warm') {
          grad.addColorStop(0, `rgba(249, 115, 22, ${coreAlpha})`);
          grad.addColorStop(0.45, `rgba(234, 88, 12, ${coreAlpha * 0.52})`);
          grad.addColorStop(0.78, `rgba(251, 146, 60, ${coreAlpha * 0.16})`);
          grad.addColorStop(1, 'rgba(249, 115, 22, 0)');
        } else if (w.kind === 'moisture') {
          grad.addColorStop(0, `rgba(16, 185, 129, ${coreAlpha})`);
          grad.addColorStop(0.48, `rgba(20, 184, 166, ${coreAlpha * 0.48})`);
          grad.addColorStop(0.8, `rgba(16, 185, 129, ${coreAlpha * 0.14})`);
          grad.addColorStop(1, 'rgba(16, 185, 129, 0)');
        } else if (w.kind === 'cyclone') {
          grad.addColorStop(0, `rgba(239, 68, 68, ${coreAlpha * 0.95})`);
          grad.addColorStop(0.35, `rgba(192, 132, 252, ${coreAlpha * 0.68})`);
          grad.addColorStop(0.72, `rgba(168, 85, 247, ${coreAlpha * 0.24})`);
          grad.addColorStop(1, 'rgba(192, 132, 252, 0)');
        } else {
          // high_pressure
          grad.addColorStop(0, `rgba(251, 191, 36, ${coreAlpha * 0.9})`);
          grad.addColorStop(0.45, `rgba(245, 158, 11, ${coreAlpha * 0.44})`);
          grad.addColorStop(0.8, `rgba(251, 191, 36, ${coreAlpha * 0.12})`);
          grad.addColorStop(1, 'rgba(251, 191, 36, 0)');
        }

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, Math.max(8, radiusPx), 0, Math.PI * 2);
        ctx.fill();

        if (w.kind === 'cyclone') {
          drawCycloneSpirals(
            ctx,
            pt.x,
            pt.y,
            radiusPx,
            w.rotationDeg,
            life,
            w.strength
          );
          drawPressureBadge(ctx, pt.x, pt.y, 'L', life * 0.95);
        } else if (w.kind === 'high_pressure') {
          drawPressureBadge(ctx, pt.x, pt.y, 'H', life * 0.95);
        }

        if (w.lakeEffectActive) {
          drawDekRing(ctx, pt.x, pt.y, radiusPx, animTime, life);
        }
      }

      // Soft storm aura around fronts
      for (let i = 0; i < curFronts.length; i += 1) {
        const f = curFronts[i];
        const pt = map.project([f.lng, f.lat]);
        const radiusPx = kmToPixels(f.radiusKm, f.lat, zoom);
        if (
          pt.x + radiusPx < -80 ||
          pt.x - radiusPx > cssWidth + 80 ||
          pt.y + radiusPx < -80 ||
          pt.y - radiusPx > cssHeight + 80
        ) {
          continue;
        }
        const alpha = clamp(0.18 + f.intensity * 0.16, 0.12, 0.38);
        const grad = ctx.createRadialGradient(
          pt.x,
          pt.y,
          0,
          pt.x,
          pt.y,
          Math.max(10, radiusPx)
        );
        grad.addColorStop(0, `rgba(168, 85, 247, ${alpha})`);
        grad.addColorStop(0.55, `rgba(99, 102, 241, ${alpha * 0.45})`);
        grad.addColorStop(1, 'rgba(99, 102, 241, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, Math.max(10, radiusPx), 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const drawLayerClouds = (
      curWaves: SimWave[],
      curFronts: SimFrontZone[],
      zoom: number,
      animTime: number
    ) => {
      const drawCloudCluster = (
        cx: number,
        cy: number,
        radiusPx: number,
        seedNum: number,
        opacityBase: number,
        spinOffsetRad: number
      ) => {
        const lobeCount = 6;
        for (let l = 0; l < lobeCount; l += 1) {
          const isCenter = l === 0;
          const angle =
            spinOffsetRad +
            seedNum * 1.7 +
            (l / (lobeCount - 1)) * Math.PI * 2 +
            Math.sin(animTime * 0.35 + l + seedNum) * 0.14;
          const distFrac = isCenter ? 0.08 : 0.24 + ((l * 17) % 10) * 0.025;
          const driftX = Math.cos(animTime * 0.45 + l * 1.9 + seedNum) * 4;
          const driftY = Math.sin(animTime * 0.38 + l * 1.3 + seedNum) * 3;
          const lx = cx + Math.cos(angle) * radiusPx * distFrac + driftX;
          const ly = cy + Math.sin(angle) * radiusPx * distFrac + driftY;
          const lobeR = Math.max(
            14,
            radiusPx * (isCenter ? 0.54 : 0.34 + (l % 3) * 0.06)
          );

          const alpha = clamp(opacityBase * (isCenter ? 1 : 0.78), 0.04, 0.44);
          const grad = ctx.createRadialGradient(lx, ly, 0, lx, ly, lobeR);
          grad.addColorStop(0, `rgba(248, 250, 252, ${alpha})`);
          grad.addColorStop(0.52, `rgba(226, 232, 240, ${alpha * 0.5})`);
          grad.addColorStop(1, 'rgba(255, 255, 255, 0)');

          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(lx, ly, lobeR, 0, Math.PI * 2);
          ctx.fill();
        }
      };

      for (let i = 0; i < curWaves.length; i += 1) {
        const w = curWaves[i];
        if (w.kind === 'high_pressure') continue;
        const isMoist =
          w.moisture >= 0.28 ||
          w.withMoisture ||
          w.kind === 'cyclone' ||
          w.lakeEffectActive;
        if (!isMoist) continue;

        const pt = map.project([w.lng, w.lat]);
        const radiusPx = kmToPixels(w.radiusKm, w.lat, zoom);
        if (
          pt.x + radiusPx < -100 ||
          pt.x - radiusPx > cssWidth + 100 ||
          pt.y + radiusPx < -100 ||
          pt.y - radiusPx > cssHeight + 100
        ) {
          continue;
        }

        const life = getWaveLife(w);
        const moistureFactor = clamp(
          Math.max(w.moisture, w.kind === 'cyclone' ? 0.72 : 0.32) +
            w.orographicBoost * 0.25,
          0.25,
          1.1
        );
        const spinRad =
          w.kind === 'cyclone' ? (w.rotationDeg * Math.PI) / 180 : 0;

        drawCloudCluster(
          pt.x,
          pt.y,
          radiusPx,
          i + (w.originLng + w.originLat) * 0.1,
          0.28 * life * moistureFactor,
          spinRad
        );
      }

      for (let i = 0; i < curFronts.length; i += 1) {
        const f = curFronts[i];
        const pt = map.project([f.lng, f.lat]);
        const radiusPx = kmToPixels(f.radiusKm, f.lat, zoom);
        if (
          pt.x + radiusPx < -100 ||
          pt.x - radiusPx > cssWidth + 100 ||
          pt.y + radiusPx < -100 ||
          pt.y - radiusPx > cssHeight + 100
        ) {
          continue;
        }
        drawCloudCluster(
          pt.x,
          pt.y,
          radiusPx * 1.05,
          i * 3.1 + 7,
          clamp(0.24 + f.intensity * 0.14, 0.18, 0.42),
          animTime * 0.12
        );
      }
    };

    const drawLayerPrecipAndLightning = (
      curWaves: SimWave[],
      curFronts: SimFrontZone[],
      curSeason: SimSeason,
      curWind: number | null,
      zoom: number,
      dt: number,
      animTime: number
    ) => {
      const emitters: PrecipEmitter[] = [];

      for (let i = 0; i < curWaves.length; i += 1) {
        const w = curWaves[i];
        if (w.kind === 'high_pressure') continue;
        if (
          !(
            w.moisture >= 0.45 ||
            w.withMoisture ||
            w.kind === 'cyclone' ||
            w.lakeEffectActive
          )
        ) {
          continue;
        }
        const pt = map.project([w.lng, w.lat]);
        const radiusPx = kmToPixels(w.radiusKm, w.lat, zoom);
        if (
          pt.x + radiusPx < -60 ||
          pt.x - radiusPx > cssWidth + 60 ||
          pt.y + radiusPx < -60 ||
          pt.y - radiusPx > cssHeight + 60
        ) {
          continue;
        }
        emitters.push({
          lng: w.lng,
          lat: w.lat,
          radiusPx,
          cx: pt.x,
          cy: pt.y,
          isCyclone: w.kind === 'cyclone',
          isFront: false,
          strength: w.strength,
        });
      }

      for (let i = 0; i < curFronts.length; i += 1) {
        const f = curFronts[i];
        const pt = map.project([f.lng, f.lat]);
        const radiusPx = kmToPixels(f.radiusKm, f.lat, zoom);
        if (
          pt.x + radiusPx < -60 ||
          pt.x - radiusPx > cssWidth + 60 ||
          pt.y + radiusPx < -60 ||
          pt.y - radiusPx > cssHeight + 60
        ) {
          continue;
        }
        emitters.push({
          lng: f.lng,
          lat: f.lat,
          radiusPx,
          cx: pt.x,
          cy: pt.y,
          isCyclone: false,
          isFront: true,
          strength: f.intensity,
        });
      }

      const pool = particlesRef.current;
      const windRad = curWind !== null ? (curWind * Math.PI) / 180 : null;
      const windXBias = windRad !== null ? Math.sin(windRad) * 28 : 16;

      // Update & respawn particles
      for (let i = 0; i < pool.length; i += 1) {
        const p = pool[i];
        if (p.active && dt > 0) {
          p.age += dt;
          p.dx += p.vx * dt;
          p.dy += p.vy * dt;
          if (p.age >= p.maxAge) {
            p.active = false;
          }
        }

        if (!p.active && emitters.length > 0) {
          const em = emitters[Math.floor(Math.random() * emitters.length)];
          const r = Math.sqrt(Math.random()) * em.radiusPx * 0.74;
          const theta = Math.random() * Math.PI * 2;
          const sx = em.cx + Math.cos(theta) * r;
          const sy = em.cy + Math.sin(theta) * r;

          if (sx >= -10 && sx <= cssWidth + 10 && sy >= -10 && sy <= cssHeight + 10) {
            const lngLat = map.unproject([sx, sy]);
            const localTemp = evaluateSimulatedTempAt(
              lngLat.lat,
              lngLat.lng,
              100,
              curWaves,
              curFronts,
              curSeason,
              curWind
            );
            const isSnow = localTemp <= 0;
            p.active = true;
            p.lng = lngLat.lng;
            p.lat = lngLat.lat;
            p.dx = 0;
            p.dy = 0;
            p.isSnow = isSnow;
            p.age = Math.random() * 0.25;
            p.maxAge = isSnow ? 1.4 + Math.random() * 0.9 : 0.55 + Math.random() * 0.45;
            p.size = isSnow ? 1.8 + Math.random() * 1.9 : 8 + Math.random() * 6;
            p.vx = isSnow ? windXBias * 0.45 + (Math.random() - 0.5) * 14 : windXBias * 1.1;
            p.vy = isSnow ? 26 + Math.random() * 18 : 115 + Math.random() * 55;
            p.phase = Math.random() * Math.PI * 2;
          }
        }
      }

      // Draw active rain streaks & glowing snowflakes
      if (emitters.length > 0) {
        ctx.save();
        for (let i = 0; i < pool.length; i += 1) {
          const p = pool[i];
          if (!p.active) continue;

          const basePt = map.project([p.lng, p.lat]);
          const sway = p.isSnow ? Math.sin(animTime * 3.5 + p.phase) * 5 : 0;
          const x = basePt.x + p.dx + sway;
          const y = basePt.y + p.dy;

          if (x < -20 || x > cssWidth + 20 || y < -20 || y > cssHeight + 20) {
            continue;
          }

          const lifeRatio = clamp(p.age / p.maxAge, 0, 1);
          const alpha = Math.sin(lifeRatio * Math.PI);
          if (alpha <= 0.02) continue;

          if (p.isSnow) {
            const g = ctx.createRadialGradient(x, y, 0, x, y, p.size * 1.9);
            g.addColorStop(0, `rgba(240, 249, 255, ${0.95 * alpha})`);
            g.addColorStop(0.5, `rgba(186, 230, 253, ${0.55 * alpha})`);
            g.addColorStop(1, 'rgba(186, 230, 253, 0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(x, y, p.size * 1.9, 0, Math.PI * 2);
            ctx.fill();
          } else {
            const normLen = Math.hypot(p.vx, p.vy) || 1;
            const tx = (p.vx / normLen) * p.size;
            const ty = (p.vy / normLen) * p.size;
            ctx.strokeStyle = `rgba(96, 165, 250, ${0.72 * alpha})`;
            ctx.lineWidth = 1.25;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + tx, y + ty);
            ctx.stroke();
          }
        }
        ctx.restore();
      } else {
        for (let i = 0; i < pool.length; i += 1) {
          pool[i].active = false;
        }
      }

      // Lightning in fronts & strong cyclone cores (strength >= 0.9)
      const stormCores = emitters.filter(
        (em) => em.isFront || (em.isCyclone && em.strength >= 0.9)
      );
      const bolts = boltsRef.current;

      if (dt > 0 && stormCores.length > 0 && bolts.length < MAX_BOLTS) {
        const spawnProb = clamp(dt * stormCores.length * 1.9, 0, 0.35);
        if (Math.random() < spawnProb) {
          const core = stormCores[Math.floor(Math.random() * stormCores.length)];
          const jitterR = Math.random() * core.radiusPx * 0.35;
          const jitterA = Math.random() * Math.PI * 2;
          const bx = core.cx + Math.cos(jitterA) * jitterR;
          const by = core.cy + Math.sin(jitterA) * jitterR;
          const ll = map.unproject([bx, by]);
          bolts.push(generateLightningBolt(ll.lng, ll.lat, core.radiusPx));
        }
      }

      for (let i = bolts.length - 1; i >= 0; i -= 1) {
        const bolt = bolts[i];
        if (dt > 0) {
          bolt.age += dt;
          if (bolt.age >= bolt.maxAge) {
            bolts.splice(i, 1);
            continue;
          }
        }

        const pt = map.project([bolt.lng, bolt.lat]);
        const tNorm = clamp(bolt.age / bolt.maxAge, 0, 1);
        const flicker = Math.sin(tNorm * Math.PI) * (0.7 + 0.3 * Math.sin(tNorm * 28));
        if (flicker <= 0.02) continue;

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Ambient flash glow
        const flashGrad = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, 44);
        flashGrad.addColorStop(0, `rgba(253, 224, 71, ${0.32 * flicker})`);
        flashGrad.addColorStop(1, 'rgba(253, 224, 71, 0)');
        ctx.fillStyle = flashGrad;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 44, 0, Math.PI * 2);
        ctx.fill();

        const strokePath = (path: Array<{ dx: number; dy: number }>, width: number, color: string) => {
          if (path.length < 2) return;
          ctx.beginPath();
          ctx.moveTo(pt.x + path[0].dx, pt.y + path[0].dy);
          for (let k = 1; k < path.length; k += 1) {
            ctx.lineTo(pt.x + path[k].dx, pt.y + path[k].dy);
          }
          ctx.lineWidth = width;
          ctx.strokeStyle = color;
          ctx.stroke();
        };

        // Golden glow + crisp white-gold core
        strokePath(bolt.mainPath, 3.6, `rgba(253, 224, 71, ${0.65 * flicker})`);
        strokePath(bolt.mainPath, 1.4, `rgba(254, 249, 195, ${0.96 * flicker})`);

        for (let b = 0; b < bolt.branches.length; b += 1) {
          strokePath(bolt.branches[b], 2.2, `rgba(253, 224, 71, ${0.48 * flicker})`);
          strokePath(bolt.branches[b], 0.95, `rgba(254, 249, 195, ${0.85 * flicker})`);
        }

        ctx.restore();
      }
    };

    const drawFrame = (dt: number) => {
      if (playingRef.current && dt > 0) {
        animTimeRef.current += dt;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssWidth, cssHeight);

      const curWaves = wavesRef.current;
      const curFronts = frontsRef.current;
      const curSeason = seasonRef.current;
      const curWind = windDirRef.current;
      const zoom = map.getZoom();

      drawLayerHeatmapAndIsotherm(curWaves, curFronts, curSeason, curWind);
      drawLayerAirMasses(curWaves, curFronts, zoom, animTimeRef.current);
      drawLayerClouds(curWaves, curFronts, zoom, animTimeRef.current);
      drawLayerPrecipAndLightning(
        curWaves,
        curFronts,
        curSeason,
        curWind,
        zoom,
        playingRef.current ? dt : 0,
        animTimeRef.current
      );
    };

    const handleMapMove = () => {
      drawFrame(0);
    };

    map.on('move', handleMapMove);
    map.on('zoom', handleMapMove);

    let rafId = 0;
    let lastTs = performance.now();

    const loop = (now: number) => {
      const dt = Math.min(0.05, Math.max(0, (now - lastTs) / 1000));
      lastTs = now;
      drawFrame(dt);
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      map.off('move', handleMapMove);
      map.off('zoom', handleMapMove);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateCanvasSize);
    };
  }, [map, active]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      className="sim-canvas-overlay"
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    />
  );
}
