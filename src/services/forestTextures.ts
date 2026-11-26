import * as THREE from 'three';

export interface ForestTextureSet {
  barkMap: THREE.CanvasTexture;
  leafClusterMap: THREE.CanvasTexture;
  fernFrondMap: THREE.CanvasTexture;
  grassTuftMap: THREE.CanvasTexture;
  groundDetailMap: THREE.CanvasTexture;
  dispose: () => void;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function periodicHash(ix: number, iy: number, px: number, py: number, seed: number): number {
  const wx = ((ix % px) + px) % px;
  const wy = ((iy % py) + py) % py;
  const n = Math.sin(wx * 127.1 + wy * 311.7 + seed * 74.7) * 43758.5453123;
  return n - Math.floor(n);
}

function periodicNoise(
  u: number,
  v: number,
  px: number,
  py: number,
  seed: number
): number {
  const x = u * px;
  const y = v * py;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;

  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);

  const n00 = periodicHash(ix, iy, px, py, seed);
  const n10 = periodicHash(ix + 1, iy, px, py, seed);
  const n01 = periodicHash(ix, iy + 1, px, py, seed);
  const n11 = periodicHash(ix + 1, iy + 1, px, py, seed);

  return lerp(lerp(n00, n10, ux), lerp(n01, n11, ux), uy);
}

function periodicFbm(
  u: number,
  v: number,
  basePx: number,
  basePy: number,
  octaves: number,
  seed: number
): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let mult = 1;

  for (let i = 0; i < octaves; i++) {
    sum += periodicNoise(u, v, basePx * mult, basePy * mult, seed + i * 19.3) * amp;
    norm += amp;
    amp *= 0.5;
    mult *= 2;
  }
  return norm > 0 ? sum / norm : 0.5;
}

function makeCanvas(width: number, height: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to create 2D canvas context for procedural forest texture');
  }
  return { canvas, ctx };
}

function configureTexture(
  canvas: HTMLCanvasElement,
  wrapMode: THREE.Wrapping
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = wrapMode;
  tex.wrapT = wrapMode;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Dilates RGB from opaque/semi-opaque pixels into neighboring alpha=0 pixels
 * so WebGL mipmapping never blends foreground foliage against black (0,0,0,0).
 */
function dilateAlphaEdgeColors(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const img = ctx.getImageData(0, 0, width, height);
  const data = img.data;
  const src = new Uint8ClampedArray(data);

  for (let pass = 0; pass < 3; pass++) {
    src.set(data);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        if (src[idx + 3] > 8) continue;

        let rSum = 0;
        let gSum = 0;
        let bSum = 0;
        let count = 0;

        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            const nIdx = (ny * width + nx) * 4;
            if (src[nIdx + 3] > 24) {
              rSum += src[nIdx];
              gSum += src[nIdx + 1];
              bSum += src[nIdx + 2];
              count++;
            }
          }
        }

        if (count > 0) {
          data[idx] = Math.round(rSum / count);
          data[idx + 1] = Math.round(gSum / count);
          data[idx + 2] = Math.round(bSum / count);
        }
      }
    }
  }

  ctx.putImageData(img, 0, 0);
}

/**
 * Draws on a tileable canvas with wrap-around across all 9 toroidal offsets
 * whenever needed so strokes seamlessly cross 0..size boundaries.
 */
function drawWrapped(
  size: number,
  drawFn: (ox: number, oy: number) => void
): void {
  for (let dy = -size; dy <= size; dy += size) {
    for (let dx = -size; dx <= size; dx += size) {
      drawFn(dx, dy);
    }
  }
}

function createBarkTexture(): THREE.CanvasTexture {
  const size = 512;
  const { canvas, ctx } = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);
  const data = img.data;

  const twoPi = Math.PI * 2;

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;

      // Seamless domain warp so vertical bark ridges weave organically.
      const warpX = periodicFbm(u, v, 6, 3, 3, 1.7) - 0.5;
      const warpY = periodicFbm(u, v, 4, 6, 2, 4.3) - 0.5;
      const uWarped = u + warpX * 0.055;
      const vWarped = v + warpY * 0.03;

      // Multi-scale vertical bark ridges & deep dark crevices.
      const ridgeWaveA = Math.sin(uWarped * twoPi * 12 + periodicFbm(u, v, 8, 4, 2, 9.1) * 2.4);
      const ridgeWaveB = Math.sin(uWarped * twoPi * 24 + periodicFbm(u, v, 16, 6, 2, 13.5) * 1.6);
      const plateA = Math.pow(Math.abs(ridgeWaveA), 0.58);
      const plateB = Math.pow(Math.abs(ridgeWaveB), 0.72);
      const fineFiber = periodicFbm(uWarped, vWarped, 48, 10, 3, 21.4);

      const ridgeHeight = clamp(plateA * 0.62 + plateB * 0.24 + fineFiber * 0.22 - 0.08, 0, 1);
      const crevice = 1 - smoothstep(0.06, 0.36, ridgeHeight);

      // Subtle horizontal lenticels (birch/beech bark markings).
      const lenticelBand = periodicFbm(u, v, 6, 36, 2, 31.2);
      const lenticelDash = Math.sin(u * twoPi * 14 + lenticelBand * 5.0);
      const lenticelMask =
        smoothstep(0.66, 0.84, lenticelBand) * smoothstep(0.4, 0.92, lenticelDash) * (1 - crevice);

      // Base warm grey-brown oak/birch bark palette.
      let r = lerp(40, 128, ridgeHeight);
      let g = lerp(31, 114, ridgeHeight);
      let b = lerp(24, 98, ridgeHeight);

      // Warm chestnut mid-tone modulation.
      const warmPatch = periodicFbm(u + 0.21, v + 0.47, 5, 5, 3, 41.8);
      r += (warmPatch - 0.5) * 22;
      g += (warmPatch - 0.5) * 14;
      b += (warmPatch - 0.5) * 6;

      // Deep dark crevices.
      r = lerp(r, 25, crevice * 0.88);
      g = lerp(g, 19, crevice * 0.88);
      b = lerp(b, 15, crevice * 0.88);

      // Darken & slightly silver lenticel streaks.
      r = lerp(r, 46, lenticelMask * 0.45);
      g = lerp(g, 38, lenticelMask * 0.45);
      b = lerp(b, 32, lenticelMask * 0.45);

      // Velvety woodland green moss nestled in crevices and sheltered patches.
      const mossField = periodicFbm(u + 0.37, v + 0.63, 4, 4, 3, 55.1);
      const mossMicro = periodicFbm(u, v, 24, 24, 2, 61.3);
      const mossMask = smoothstep(0.57, 0.78, mossField + crevice * 0.16 + (mossMicro - 0.5) * 0.14);
      const mossR = lerp(42, 74, mossMicro);
      const mossG = lerp(74, 108, mossMicro);
      const mossB = lerp(28, 44, mossMicro);
      r = lerp(r, mossR, mossMask * 0.85);
      g = lerp(g, mossG, mossMask * 0.85);
      b = lerp(b, mossB, mossMask * 0.85);

      // Pale sage-grey lichen flecks on higher outer bark ridges.
      const lichenField = periodicFbm(u + 0.14, v + 0.82, 16, 16, 3, 73.9);
      const lichenMask =
        smoothstep(0.73, 0.85, lichenField) * smoothstep(0.45, 0.75, ridgeHeight) * (1 - mossMask * 0.7);
      r = lerp(r, 158, lichenMask * 0.72);
      g = lerp(g, 168, lichenMask * 0.72);
      b = lerp(b, 142, lichenMask * 0.72);

      const idx = (y * size + x) * 4;
      data[idx] = clamp(Math.round(r), 0, 255);
      data[idx + 1] = clamp(Math.round(g), 0, 255);
      data[idx + 2] = clamp(Math.round(b), 0, 255);
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return configureTexture(canvas, THREE.RepeatWrapping);
}

function drawDeciduousLeaf(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  length: number,
  width: number,
  tone: number,
  rng: () => number
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  // Subtle petiole stem connecting to twig.
  ctx.strokeStyle = '#3d2f1c';
  ctx.lineWidth = Math.max(1.2, length * 0.045);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 2);
  ctx.lineTo(0, -length * 0.12);
  ctx.stroke();

  // Organic serrated deciduous leaf silhouette.
  const lobes = 5;
  const startY = -length * 0.08;
  const tipY = -length;

  ctx.beginPath();
  ctx.moveTo(0, startY);

  // Right margin from base to tip with subtle serrated teeth.
  for (let i = 1; i <= lobes; i++) {
    const t = i / (lobes + 1);
    const yPos = lerp(startY, tipY, t);
    const profile = Math.sin(Math.pow(t, 0.78) * Math.PI);
    const halfW = width * 0.5 * profile;
    const prevT = (i - 0.5) / (lobes + 1);
    const midY = lerp(startY, tipY, prevT);
    const midHalfW = width * 0.5 * Math.sin(Math.pow(prevT, 0.78) * Math.PI) * 1.09;
    ctx.quadraticCurveTo(midHalfW, midY, halfW * 0.9, yPos);
  }
  ctx.quadraticCurveTo(width * 0.14, tipY + length * 0.1, 0, tipY);

  // Left margin from tip back to base.
  for (let i = lobes; i >= 1; i--) {
    const t = i / (lobes + 1);
    const yPos = lerp(startY, tipY, t);
    const profile = Math.sin(Math.pow(t, 0.78) * Math.PI);
    const halfW = width * 0.5 * profile;
    const nextT = (i + 0.5) / (lobes + 1);
    const midY = lerp(startY, tipY, nextT);
    const midHalfW = width * 0.5 * Math.sin(Math.pow(nextT, 0.78) * Math.PI) * 1.09;
    ctx.quadraticCurveTo(-midHalfW, midY, -halfW * 0.9, yPos);
  }
  ctx.quadraticCurveTo(-width * 0.22, startY - length * 0.06, 0, startY);
  ctx.closePath();

  // Rich forest emerald, olive, and sunlit moss green palette.
  const rBase = Math.round(lerp(28, 78, tone) + (rng() - 0.5) * 12);
  const gBase = Math.round(lerp(72, 126, tone) + (rng() - 0.5) * 14);
  const bBase = Math.round(lerp(24, 42, tone) + (rng() - 0.5) * 8);

  const grad = ctx.createLinearGradient(0, startY, 0, tipY);
  grad.addColorStop(0, `rgb(${clamp(rBase - 10, 12, 255)}, ${clamp(gBase - 18, 28, 255)}, ${clamp(bBase - 6, 10, 255)})`);
  grad.addColorStop(0.55, `rgb(${clamp(rBase + 6, 12, 255)}, ${clamp(gBase + 10, 28, 255)}, ${clamp(bBase + 4, 10, 255)})`);
  grad.addColorStop(1, `rgb(${clamp(rBase + 22, 12, 255)}, ${clamp(gBase + 26, 28, 255)}, ${clamp(bBase + 10, 10, 255)})`);

  ctx.fillStyle = grad;
  ctx.fill();

  // Subtle darker edge crispness for alpha-cutout definition.
  ctx.strokeStyle = `rgba(${clamp(rBase - 14, 10, 255)}, ${clamp(gBase - 24, 20, 255)}, ${clamp(bBase - 8, 8, 255)}, 0.75)`;
  ctx.lineWidth = 1.0;
  ctx.stroke();

  // Delicate central midrib and arching lateral veins.
  ctx.strokeStyle = `rgba(${clamp(rBase + 52, 40, 255)}, ${clamp(gBase + 58, 60, 255)}, ${clamp(bBase + 28, 20, 255)}, 0.45)`;
  ctx.lineWidth = Math.max(0.8, length * 0.02);
  ctx.beginPath();
  ctx.moveTo(0, startY - 2);
  ctx.lineTo(0, tipY + length * 0.08);
  for (let v = 1; v <= 4; v++) {
    const vt = v * 0.19;
    const vy = lerp(startY, tipY, vt);
    const span = width * 0.36 * Math.sin(vt * Math.PI);
    ctx.moveTo(0, vy);
    ctx.quadraticCurveTo(span * 0.5, vy - length * 0.03, span, vy - length * 0.09);
    ctx.moveTo(0, vy);
    ctx.quadraticCurveTo(-span * 0.5, vy - length * 0.03, -span, vy - length * 0.09);
  }
  ctx.stroke();

  ctx.restore();
}

function createLeafClusterTexture(): THREE.CanvasTexture {
  const size = 512;
  const { canvas, ctx } = makeCanvas(size, size);
  const rng = createRng(91247);

  ctx.clearRect(0, 0, size, size);

  interface TwigNode {
    x: number;
    y: number;
    angle: number;
  }
  const leafAnchors: TwigNode[] = [];

  // Draw branching dark woody twig from bottom-center outward.
  const drawBranch = (
    x0: number,
    y0: number,
    angle: number,
    len: number,
    width0: number,
    depth: number
  ): void => {
    const x1 = x0 + Math.sin(angle) * len;
    const y1 = y0 - Math.cos(angle) * len;
    const cx = (x0 + x1) * 0.5 + (rng() - 0.5) * len * 0.22;
    const cy = (y0 + y1) * 0.5 + (rng() - 0.5) * len * 0.14;

    ctx.strokeStyle = depth === 0 ? '#3a281a' : '#4a3523';
    ctx.lineWidth = width0;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(cx, cy, x1, y1);
    ctx.stroke();

    // Collect leaf attachment points along outer twigs & upper main stem.
    const samples = depth === 0 ? 4 : depth === 1 ? 6 : 5;
    for (let i = 1; i <= samples; i++) {
      const t = i / samples;
      const omt = 1 - t;
      const px = omt * omt * x0 + 2 * omt * t * cx + t * t * x1;
      const py = omt * omt * y0 + 2 * omt * t * cy + t * t * y1;
      if (depth > 0 || t > 0.35) {
        leafAnchors.push({ x: px, y: py, angle });
      }
    }

    if (depth < 2) {
      const sideCount = depth === 0 ? 5 : 2;
      for (let i = 0; i < sideCount; i++) {
        const t = depth === 0 ? 0.24 + (i / (sideCount - 1)) * 0.72 : 0.42 + i * 0.48;
        const omt = 1 - t;
        const bx = omt * omt * x0 + 2 * omt * t * cx + t * t * x1;
        const by = omt * omt * y0 + 2 * omt * t * cy + t * t * y1;
        const side = i % 2 === 0 ? -1 : 1;
        const spread = depth === 0 ? 0.55 + rng() * 0.35 : 0.45 + rng() * 0.3;
        drawBranch(
          bx,
          by,
          angle + side * spread,
          len * (depth === 0 ? 0.46 + rng() * 0.14 : 0.58),
          Math.max(1.3, width0 * 0.58),
          depth + 1
        );
      }
    }
  };

  drawBranch(256, 498, -0.02, 330, 5.2, 0);

  // Build ~62 leaves distributed across twig anchors in back-to-front layers
  // (darker inner leaves first, brighter sunlit outer leaves on top).
  interface LeafSpec {
    x: number;
    y: number;
    angle: number;
    length: number;
    width: number;
    tone: number;
  }
  const leaves: LeafSpec[] = [];

  for (let i = 0; i < 62; i++) {
    const anchor = leafAnchors[i % leafAnchors.length];
    const side = i % 2 === 0 ? -1 : 1;
    const radialOffset = 4 + rng() * 26;
    const leafAngle = anchor.angle + side * (0.45 + rng() * 0.95) + (rng() - 0.5) * 0.35;
    const lx = clamp(anchor.x + Math.sin(leafAngle) * radialOffset, 56, size - 56);
    const ly = clamp(anchor.y - Math.cos(leafAngle) * radialOffset, 58, size - 48);
    const length = 46 + rng() * 34;
    const width = length * (0.46 + rng() * 0.16);
    const distFromCenter = Math.hypot(lx - 256, ly - 240) / 220;
    const tone = clamp(0.18 + distFromCenter * 0.52 + rng() * 0.32, 0, 1);
    leaves.push({ x: lx, y: ly, angle: leafAngle, length, width, tone });
  }

  // Paint darker inner leaves first, sunlit outer moss-green leaves last.
  leaves.sort((a, b) => a.tone - b.tone);
  for (const leaf of leaves) {
    drawDeciduousLeaf(ctx, leaf.x, leaf.y, leaf.angle, leaf.length, leaf.width, leaf.tone, rng);
  }

  dilateAlphaEdgeColors(ctx, size, size);
  return configureTexture(canvas, THREE.ClampToEdgeWrapping);
}

function drawPinna(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  side: -1 | 1,
  angle: number,
  length: number,
  width: number,
  tone: number
): void {
  ctx.save();
  ctx.translate(x0, y0);
  ctx.rotate(angle * side);

  const lobeCount = Math.max(4, Math.round(length / 15));
  const tipX = side * length;

  ctx.beginPath();
  ctx.moveTo(0, width * 0.35);

  // Lower scalloped margin from rachis out to pinna tip.
  for (let i = 1; i <= lobeCount; i++) {
    const t = i / (lobeCount + 1);
    const px = side * length * t;
    const env = Math.pow(1 - t, 0.72);
    const midT = (i - 0.5) / (lobeCount + 1);
    const midX = side * length * midT;
    const lobeDip = width * 0.52 * Math.pow(1 - midT, 0.65);
    ctx.quadraticCurveTo(midX, lobeDip, px, width * 0.22 * env);
  }
  ctx.lineTo(tipX, 0);

  // Upper scalloped margin from tip back to rachis.
  for (let i = lobeCount; i >= 1; i--) {
    const t = i / (lobeCount + 1);
    const px = side * length * t;
    const env = Math.pow(1 - t, 0.72);
    const midT = (i + 0.45) / (lobeCount + 1);
    const midX = side * length * midT;
    const lobeRise = -width * 0.56 * Math.pow(1 - midT, 0.65);
    ctx.quadraticCurveTo(midX, lobeRise, px, -width * 0.24 * env);
  }
  ctx.quadraticCurveTo(side * length * 0.06, -width * 0.45, 0, -width * 0.32);
  ctx.closePath();

  const r0 = Math.round(lerp(34, 52, tone));
  const g0 = Math.round(lerp(78, 108, tone));
  const b0 = Math.round(lerp(22, 34, tone));
  const r1 = Math.round(lerp(76, 114, tone));
  const g1 = Math.round(lerp(132, 168, tone));
  const b1 = Math.round(lerp(36, 56, tone));

  const grad = ctx.createLinearGradient(0, 0, tipX, 0);
  grad.addColorStop(0, `rgb(${r0}, ${g0}, ${b0})`);
  grad.addColorStop(0.65, `rgb(${Math.round((r0 + r1) * 0.5)}, ${Math.round((g0 + g1) * 0.5)}, ${Math.round((b0 + b1) * 0.5)})`);
  grad.addColorStop(1, `rgb(${r1}, ${g1}, ${b1})`);

  ctx.fillStyle = grad;
  ctx.fill();

  // Central pinna costae vein.
  ctx.strokeStyle = `rgba(${r1 + 26}, ${g1 + 24}, ${b1 + 14}, 0.55)`;
  ctx.lineWidth = Math.max(0.7, width * 0.065);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(tipX * 0.92, 0);
  ctx.stroke();

  ctx.restore();
}

function createFernFrondTexture(): THREE.CanvasTexture {
  const size = 512;
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.clearRect(0, 0, size, size);

  const startY = 505;
  const endY = 12;
  const rachisAt = (t: number): { x: number; y: number } => {
    const y = lerp(startY, endY, t);
    const x = 256 + Math.sin(t * Math.PI * 1.15) * 6.5;
    return { x, y };
  };

  // Draw 18 opposite pairs of detailed tapering pinnate leaflets.
  const pairs = 18;
  for (let i = 0; i < pairs; i++) {
    const t = 0.1 + (i / (pairs - 1)) * 0.84;
    const pos = rachisAt(t);

    // Classic fern silhouette: narrower near base, widest around 30%, tapering cleanly to tip.
    const widthEnvelope =
      Math.sin(Math.pow(clamp((t - 0.04) / 0.94, 0, 1), 0.62) * Math.PI) *
      (1 - t * 0.25);
    const pinnaLength = clamp(32 + widthEnvelope * 145, 16, 172);
    const pinnaWidth = clamp(10 + widthEnvelope * 22, 7, 28);
    const upwardAngle = lerp(-0.24, -0.68, t);
    const tone = clamp(t * 0.7 + (i % 3) * 0.1, 0, 1);

    drawPinna(ctx, pos.x, pos.y, -1, upwardAngle, pinnaLength, pinnaWidth, tone);
    drawPinna(ctx, pos.x, pos.y + 2, 1, upwardAngle + 0.04, pinnaLength * 0.97, pinnaWidth, tone);
  }

  // Delicate terminal apex leaflet.
  const apex = rachisAt(0.95);
  ctx.fillStyle = '#6da83d';
  ctx.beginPath();
  ctx.moveTo(apex.x - 5, apex.y + 4);
  ctx.quadraticCurveTo(apex.x, endY - 4, apex.x + 5, apex.y + 4);
  ctx.closePath();
  ctx.fill();

  // Draw tapered central rachis on top of leaflet bases.
  const steps = 40;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const p0 = rachisAt(t0);
    const p1 = rachisAt(t1);
    const r = Math.round(lerp(74, 102, t0));
    const g = Math.round(lerp(90, 150, t0));
    const b = Math.round(lerp(34, 48, t0));

    ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.lineWidth = lerp(4.6, 0.9, t0);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }

  dilateAlphaEdgeColors(ctx, size, size);
  return configureTexture(canvas, THREE.ClampToEdgeWrapping);
}

function createGrassTuftTexture(): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = makeCanvas(size, size);
  const rng = createRng(48219);
  ctx.clearRect(0, 0, size, size);

  const bladeCount = 16;
  interface BladeSpec {
    baseX: number;
    height: number;
    lean: number;
    baseWidth: number;
    shade: number;
  }
  const blades: BladeSpec[] = [];

  for (let i = 0; i < bladeCount; i++) {
    const spread = i / (bladeCount - 1) - 0.5;
    const baseX = 128 + spread * 108 + (rng() - 0.5) * 10;
    const height = 132 + (1 - Math.abs(spread) * 0.6) * 86 + (rng() - 0.5) * 32;
    const lean = spread * 58 + (rng() - 0.5) * 28;
    const baseWidth = 5.5 + rng() * 3.8;
    const shade = rng();
    blades.push({ baseX, height, lean, baseWidth, shade });
  }

  // Paint darker background blades first, brighter foreground blades last.
  blades.sort((a, b) => a.shade - b.shade);

  for (const b of blades) {
    const baseY = size;
    const tipX = clamp(b.baseX + b.lean, 10, size - 10);
    const tipY = clamp(baseY - b.height, 8, size - 40);
    const ctrlX = b.baseX + b.lean * 0.32;
    const ctrlY = baseY - b.height * 0.56;

    const halfW = b.baseWidth * 0.5;
    const midHalfW = halfW * 0.48;

    ctx.beginPath();
    ctx.moveTo(b.baseX - halfW, baseY);
    ctx.quadraticCurveTo(ctrlX - midHalfW, ctrlY, tipX, tipY);
    ctx.quadraticCurveTo(ctrlX + midHalfW, ctrlY, b.baseX + halfW, baseY);
    ctx.closePath();

    const r0 = Math.round(lerp(28, 44, b.shade));
    const g0 = Math.round(lerp(60, 86, b.shade));
    const b0 = Math.round(lerp(20, 28, b.shade));
    const r1 = Math.round(lerp(88, 138, b.shade));
    const g1 = Math.round(lerp(136, 174, b.shade));
    const b1 = Math.round(lerp(42, 58, b.shade));

    const grad = ctx.createLinearGradient(b.baseX, baseY, tipX, tipY);
    grad.addColorStop(0, `rgb(${r0}, ${g0}, ${b0})`);
    grad.addColorStop(0.55, `rgb(${Math.round((r0 + r1) * 0.5)}, ${Math.round((g0 + g1) * 0.5)}, ${Math.round((b0 + b1) * 0.5)})`);
    grad.addColorStop(1, `rgb(${r1}, ${g1}, ${b1})`);

    ctx.fillStyle = grad;
    ctx.fill();

    // Fine bright sedge blade rib.
    ctx.strokeStyle = `rgba(${clamp(r1 + 25, 0, 255)}, ${clamp(g1 + 25, 0, 255)}, ${clamp(b1 + 10, 0, 255)}, 0.35)`;
    ctx.lineWidth = 0.85;
    ctx.beginPath();
    ctx.moveTo(b.baseX, baseY);
    ctx.quadraticCurveTo(ctrlX, ctrlY, tipX, tipY);
    ctx.stroke();
  }

  dilateAlphaEdgeColors(ctx, size, size);
  return configureTexture(canvas, THREE.ClampToEdgeWrapping);
}

function createGroundDetailTexture(): THREE.CanvasTexture {
  const size = 512;
  const { canvas, ctx } = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);
  const data = img.data;

  // Step 1: seamless per-pixel forest humus grain & damp mossy speckles.
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;

      const macro = periodicFbm(u, v, 6, 6, 3, 102.3);
      const grain = periodicFbm(u, v, 36, 36, 3, 207.9);
      const grit = periodicNoise(u, v, 128, 128, 311.1);
      const mossPatch = periodicFbm(u + 0.41, v + 0.27, 8, 8, 3, 419.7);

      // Rich woodland loam & organic humus tones.
      let r = lerp(48, 88, macro * 0.65 + grain * 0.35);
      let g = lerp(37, 68, macro * 0.65 + grain * 0.35);
      let b = lerp(24, 44, macro * 0.65 + grain * 0.35);

      // Fine mineral grit flecks.
      const gritBoost = (grit - 0.5) * 26;
      r += gritBoost;
      g += gritBoost * 0.92;
      b += gritBoost * 0.78;

      // Damp mossy ground speckles.
      const mossMask = smoothstep(0.55, 0.77, mossPatch + (grain - 0.5) * 0.16);
      r = lerp(r, lerp(38, 66, grain), mossMask * 0.75);
      g = lerp(g, lerp(64, 96, grain), mossMask * 0.75);
      b = lerp(b, lerp(24, 38, grain), mossMask * 0.75);

      const idx = (y * size + x) * 4;
      data[idx] = clamp(Math.round(r), 0, 255);
      data[idx + 1] = clamp(Math.round(g), 0, 255);
      data[idx + 2] = clamp(Math.round(b), 0, 255);
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const rng = createRng(63911);

  // Step 2: wrapped fallen autumn/forest leaves in warm brown, ochre, and faded olive.
  const leafPalette = [
    '#6e4726',
    '#85582b',
    '#9a6b31',
    '#57391f',
    '#7c662e',
    '#5f6b32',
    '#a37538',
  ];

  for (let i = 0; i < 135; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const angle = rng() * Math.PI * 2;
    const len = 6 + rng() * 9;
    const wid = len * (0.42 + rng() * 0.22);
    const fill = leafPalette[Math.floor(rng() * leafPalette.length)];

    drawWrapped(size, (ox, oy) => {
      const px = x + ox;
      const py = y + oy;
      if (px < -24 || px > size + 24 || py < -24 || py > size + 24) return;

      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(angle);

      // Soft ambient contact shadow under fallen leaf.
      ctx.fillStyle = 'rgba(20, 14, 9, 0.32)';
      ctx.beginPath();
      ctx.ellipse(1.2, 1.2, len * 0.52, wid * 0.52, 0, 0, Math.PI * 2);
      ctx.fill();

      // Teardrop fallen leaf body.
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(-len * 0.5, 0);
      ctx.quadraticCurveTo(0, -wid * 0.72, len * 0.5, 0);
      ctx.quadraticCurveTo(0, wid * 0.72, -len * 0.5, 0);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = 'rgba(245, 220, 175, 0.16)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(-len * 0.42, 0);
      ctx.lineTo(len * 0.38, 0);
      ctx.stroke();

      ctx.restore();
    });
  }

  // Step 3: wrapped tiny broken woodland twig bits & bark chips.
  for (let i = 0; i < 72; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const angle = rng() * Math.PI * 2;
    const len = 8 + rng() * 18;
    const bend = (rng() - 0.5) * 5;
    const width = 1.0 + rng() * 1.4;
    const color = rng() > 0.4 ? '#4d3a28' : '#63513e';

    drawWrapped(size, (ox, oy) => {
      const px = x + ox;
      const py = y + oy;
      if (px < -30 || px > size + 30 || py < -30 || py > size + 30) return;

      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(angle);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-len * 0.5, 0);
      ctx.quadraticCurveTo(0, bend, len * 0.5, 0);
      ctx.stroke();
      ctx.restore();
    });
  }

  // Step 4: crisp damp mossy speckles.
  for (let i = 0; i < 160; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const radius = 1.1 + rng() * 2.4;
    const color = rng() > 0.45 ? 'rgba(68, 102, 42, 0.55)' : 'rgba(92, 126, 52, 0.42)';

    drawWrapped(size, (ox, oy) => {
      const px = x + ox;
      const py = y + oy;
      if (px < -8 || px > size + 8 || py < -8 || py > size + 8) return;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  return configureTexture(canvas, THREE.RepeatWrapping);
}

export function createForestTextures(): ForestTextureSet {
  const barkMap = createBarkTexture();
  const leafClusterMap = createLeafClusterTexture();
  const fernFrondMap = createFernFrondTexture();
  const grassTuftMap = createGrassTuftTexture();
  const groundDetailMap = createGroundDetailTexture();

  return {
    barkMap,
    leafClusterMap,
    fernFrondMap,
    grassTuftMap,
    groundDetailMap,
    dispose: () => {
      barkMap.dispose();
      leafClusterMap.dispose();
      fernFrondMap.dispose();
      grassTuftMap.dispose();
      groundDetailMap.dispose();
    },
  };
}
