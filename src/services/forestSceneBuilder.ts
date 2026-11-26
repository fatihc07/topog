import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type {
  ForestSceneStats,
  LivingWorldControls,
  LivingWorldSimState,
} from '../types/livingWorld';
import { getTerrainHeight, hash2D } from './forestWeatherPhysics';
import {
  createBarkMaterial,
  createCanopyMaterial,
  createFernMaterial,
  createFireflyParticleMaterial,
  createGrassMaterial,
  createRainParticleMaterial,
  createRockMaterial,
  createSkyDomeMaterial,
  createSnowParticleMaterial,
  createTerrainMaterial,
} from './forestShaders';

export interface ForestSceneController {
  update: (dtSec: number, controls: LivingWorldControls, simState: LivingWorldSimState) => void;
  resize: (width: number, height: number) => void;
  resetCamera: () => void;
  getStats: () => ForestSceneStats;
  dispose: () => void;
}

const WORLD_SIZE = 260;
const HALF_WORLD = WORLD_SIZE * 0.5;
const CONIFER_COUNT = 1650;
const BROADLEAF_COUNT = 550;
const GRASS_COUNT = 22000;
const FERN_COUNT = 3200;
const ROCK_COUNT = 220;
const SNOW_PARTICLE_COUNT = 4500;
const RAIN_PARTICLE_COUNT = 5000;
const FIREFLY_COUNT = 140;

function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizeAndMerge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const nonIndexed = parts.map((g) => {
    const out = g.index ? g.toNonIndexed() : g.clone();
    if (!out.getAttribute('normal')) {
      out.computeVertexNormals();
    }
    if (!out.getAttribute('uv')) {
      const count = out.getAttribute('position').count;
      out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    g.dispose();
    return out;
  });

  const merged = mergeGeometries(nonIndexed, false);
  for (const g of nonIndexed) {
    g.dispose();
  }
  return merged;
}

function buildConiferGeometries(): {
  trunk: THREE.BufferGeometry;
  crown: THREE.BufferGeometry;
} {
  const trunk = new THREE.CylinderGeometry(0.10, 0.28, 7.6, 7, 2);
  trunk.translate(0, 3.8, 0);

  const tiers = [
    { r: 2.35, h: 3.1, y: 3.6, segs: 8 },
    { r: 1.95, h: 2.9, y: 5.2, segs: 8 },
    { r: 1.48, h: 2.6, y: 6.7, segs: 7 },
    { r: 0.95, h: 2.3, y: 8.1, segs: 7 },
  ];

  const crownParts = tiers.map((tier) => {
    const cone = new THREE.ConeGeometry(tier.r, tier.h, tier.segs, 1, false);
    cone.translate(0, tier.y, 0);
    return cone;
  });

  return {
    trunk,
    crown: normalizeAndMerge(crownParts),
  };
}

function buildBroadleafGeometries(): {
  trunk: THREE.BufferGeometry;
  crown: THREE.BufferGeometry;
} {
  const mainTrunk = new THREE.CylinderGeometry(0.17, 0.36, 4.6, 7, 2);
  mainTrunk.translate(0, 2.3, 0);

  const forkA = new THREE.CylinderGeometry(0.08, 0.14, 2.5, 6, 1);
  forkA.rotateZ(0.45);
  forkA.translate(-0.55, 4.6, 0.15);

  const forkB = new THREE.CylinderGeometry(0.08, 0.13, 2.3, 6, 1);
  forkB.rotateZ(-0.48);
  forkB.rotateY(0.7);
  forkB.translate(0.5, 4.5, -0.2);

  const trunk = normalizeAndMerge([mainTrunk, forkA, forkB]);

  const clusters = [
    { r: 2.1, x: 0.0, y: 6.1, z: 0.0 },
    { r: 1.55, x: -1.15, y: 5.5, z: 0.45 },
    { r: 1.6, x: 1.1, y: 5.4, z: -0.45 },
    { r: 1.4, x: 0.25, y: 5.7, z: 1.1 },
    { r: 1.35, x: -0.3, y: 6.9, z: -0.7 },
  ];

  const crownParts = clusters.map((c, idx) => {
    const ico = new THREE.IcosahedronGeometry(c.r, 1);
    const pos = ico.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      const vz = pos.getZ(i);
      const jitter = 0.86 + 0.28 * hash2D(vx * 3.7 + idx * 11, vz * 4.1 + vy * 2.3);
      pos.setXYZ(i, vx * jitter, vy * (0.82 + 0.18 * jitter), vz * jitter);
    }
    ico.computeVertexNormals();
    ico.translate(c.x, c.y, c.z);
    return ico;
  });

  return {
    trunk,
    crown: normalizeAndMerge(crownParts),
  };
}

function buildGrassTuftGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const bladeCount = 3;
  const segments = 3;
  let vertexOffset = 0;

  for (let b = 0; b < bladeCount; b++) {
    const angle = (b / bladeCount) * Math.PI + (b === 1 ? 0.18 : 0);
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const offsetX = (b - 1) * 0.04;
    const offsetZ = ((b % 2) - 0.5) * 0.04;
    const lean = 0.09 + b * 0.025;
    const height = 0.42 + (b === 1 ? 0.1 : 0);
    const halfBaseWidth = 0.036;

    for (let s = 0; s <= segments; s++) {
      const t = s / segments;
      const w = halfBaseWidth * (1 - t * 0.92);
      const y = t * height;
      const curve = t * t * lean;

      const cx = offsetX + cosA * curve * 0.4 - sinA * curve;
      const cz = offsetZ + sinA * curve * 0.4 + cosA * curve;

      const lx = cx - cosA * w;
      const lz = cz - sinA * w;
      const rx = cx + cosA * w;
      const rz = cz + sinA * w;

      positions.push(lx, y, lz, rx, y, rz);

      const nx = -sinA * 0.55;
      const ny = 0.83;
      const nz = cosA * 0.55;
      normals.push(nx, ny, nz, nx, ny, nz);
      uvs.push(0, t, 1, t);
    }

    for (let s = 0; s < segments; s++) {
      const row0 = vertexOffset + s * 2;
      const row1 = row0 + 2;
      indices.push(row0, row0 + 1, row1, row0 + 1, row1 + 1, row1);
    }
    vertexOffset += (segments + 1) * 2;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  return geom;
}

function buildFernRosetteGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const frondCount = 5;
  const segments = 4;
  let vertexOffset = 0;

  for (let f = 0; f < frondCount; f++) {
    const angle = (f / frondCount) * Math.PI * 2 + (f % 2) * 0.14;
    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);
    const sideX = -dirZ;
    const sideZ = dirX;
    const reach = 0.72 + (f % 2) * 0.12;
    const archH = 0.42 + (f % 3) * 0.05;

    for (let s = 0; s <= segments; s++) {
      const t = s / segments;
      const width = Math.sin(Math.pow(t, 0.7) * Math.PI) * 0.17 + (1 - t) * 0.025;
      const dist = t * reach;
      const y = Math.sin(t * Math.PI * 0.82) * archH + 0.02;

      const cx = dirX * dist;
      const cz = dirZ * dist;
      positions.push(
        cx - sideX * width,
        y - 0.015,
        cz - sideZ * width,
        cx + sideX * width,
        y - 0.015,
        cz + sideZ * width
      );

      const slopeNy = Math.max(0.35, 1.0 - t * 0.65);
      const slopeHoriz = 1.0 - slopeNy;
      normals.push(
        dirX * slopeHoriz,
        slopeNy,
        dirZ * slopeHoriz,
        dirX * slopeHoriz,
        slopeNy,
        dirZ * slopeHoriz
      );
      uvs.push(0, t, 1, t);
    }

    for (let s = 0; s < segments; s++) {
      const r0 = vertexOffset + s * 2;
      const r1 = r0 + 2;
      indices.push(r0, r0 + 1, r1, r0 + 1, r1 + 1, r1);
    }
    vertexOffset += (segments + 1) * 2;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  return geom;
}

function buildRockGeometry(): THREE.BufferGeometry {
  const rock = new THREE.IcosahedronGeometry(1, 1);
  const pos = rock.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    const vz = pos.getZ(i);
    const n = 0.78 + 0.38 * hash2D(vx * 5.3 + vy * 2.1, vz * 4.7 - vy * 1.9);
    pos.setXYZ(i, vx * n, vy * n * 0.68, vz * n);
  }
  rock.computeVertexNormals();
  return rock;
}

function buildWeatherPointsGeometry(
  count: number,
  boxSize: THREE.Vector3,
  minSize: number,
  maxSize: number,
  seedOffset: number
): THREE.BufferGeometry {
  const rng = createSeededRng(seedOffset);
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    positions[i * 3] = (rng() - 0.5) * boxSize.x;
    positions[i * 3 + 1] = (rng() - 0.5) * boxSize.y;
    positions[i * 3 + 2] = (rng() - 0.5) * boxSize.z;
    seeds[i] = rng();
    sizes[i] = minSize + rng() * (maxSize - minSize);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geom.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  return geom;
}

interface AtmosphereColors {
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  zenith: THREE.Color;
  horizon: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  fog: THREE.Color;
  fogDensity: number;
  overcast: number;
  stars: number;
  fireflies: number;
}

function computeAtmosphere(
  controls: LivingWorldControls,
  simState: LivingWorldSimState,
  out: AtmosphereColors
): void {
  const hours = ((controls.timeOfDayHours % 24) + 24) % 24;
  const sunAngle = ((hours - 6) / 12) * Math.PI;
  const sinElev = Math.sin(sunAngle);
  const cosAzim = Math.cos(sunAngle);

  // Position sun toward northern/forward horizon so camera gets rich rim/backlight
  const rawSunY = sinElev;
  const sunDirY = rawSunY > -0.05 ? Math.max(rawSunY, 0.06) : Math.max(-rawSunY * 0.6, 0.14);
  out.sunDir.set(cosAzim * 0.78, sunDirY, -0.58).normalize();

  const dayFactor = THREE.MathUtils.smoothstep(sinElev, -0.18, 0.35);
  const goldenFactor =
    Math.exp(-Math.pow((hours - 6.3) / 1.15, 2)) + Math.exp(-Math.pow((hours - 18.2) / 1.25, 2));
  const clampedGolden = Math.min(1, goldenFactor);

  // Base day / golden / night palettes
  const nightZenith = new THREE.Color(0x060b18);
  const dayZenith = new THREE.Color(0x2d69ab);
  const goldenZenith = new THREE.Color(0x3a4d7d);

  const nightHorizon = new THREE.Color(0x101c33);
  const dayHorizon = new THREE.Color(0xa6c5df);
  const goldenHorizon = new THREE.Color(0xe69866);

  out.zenith.copy(nightZenith).lerp(dayZenith, dayFactor).lerp(goldenZenith, clampedGolden * 0.6);
  out.horizon.copy(nightHorizon).lerp(dayHorizon, dayFactor).lerp(goldenHorizon, clampedGolden * 0.8);

  const nightSun = new THREE.Color(0x47659e);
  const daySun = new THREE.Color(0xfff2dc);
  const goldenSun = new THREE.Color(0xff9b54);
  out.sunColor.copy(nightSun).lerp(daySun, dayFactor).lerp(goldenSun, clampedGolden * 0.85);

  // Overcast & weather mood
  const isPrecip = simState.activePrecipKind !== 'none';
  const overcast = isPrecip ? Math.min(0.95, 0.35 + controls.precipIntensity * 0.6) : 0;
  out.overcast = overcast;

  if (overcast > 0.01) {
    const stormSky =
      simState.activePrecipKind === 'snow'
        ? new THREE.Color(0x9cb0c4).multiplyScalar(0.28 + 0.72 * dayFactor)
        : new THREE.Color(0x5b6c7d).multiplyScalar(0.25 + 0.75 * dayFactor);
    const stormHorizon =
      simState.activePrecipKind === 'snow'
        ? new THREE.Color(0xb8c7d6).multiplyScalar(0.3 + 0.7 * dayFactor)
        : new THREE.Color(0x6d7f8f).multiplyScalar(0.28 + 0.72 * dayFactor);

    out.zenith.lerp(stormSky, overcast * 0.85);
    out.horizon.lerp(stormHorizon, overcast * 0.88);
    out.sunColor.multiplyScalar(1 - overcast * 0.65);
  }

  out.hemiSky.copy(out.horizon).lerp(out.zenith, 0.38);
  const snowBounce = simState.snowCoverage * dayFactor;
  out.hemiGround
    .setRGB(0.11 + 0.1 * dayFactor, 0.15 + 0.12 * dayFactor, 0.09 + 0.08 * dayFactor)
    .lerp(new THREE.Color(0x6c829b), snowBounce * 0.62);

  out.fog.copy(out.horizon);
  const baseFog = 0.0078 + (1 - dayFactor) * 0.0022;
  const precipFog =
    simState.activePrecipKind === 'snow'
      ? controls.precipIntensity * 0.0082
      : simState.activePrecipKind === 'rain'
        ? controls.precipIntensity * 0.0052
        : 0;
  out.fogDensity = baseFog + precipFog;

  out.stars = THREE.MathUtils.clamp((1 - dayFactor) * (1 - overcast), 0, 1);
  const duskMask = Math.max(
    Math.exp(-Math.pow((hours - 20.3) / 1.9, 2)),
    Math.exp(-Math.pow((hours - 5.1) / 1.4, 2)),
    1 - dayFactor
  );
  const weatherSuppress =
    simState.activePrecipKind === 'snow'
      ? 0
      : simState.activePrecipKind === 'rain'
        ? Math.max(0, 1 - controls.precipIntensity * 1.4)
        : 1;
  out.fireflies = THREE.MathUtils.clamp(duskMask * weatherSuppress, 0, 1);
}

export function createForestScene(container: HTMLElement): ForestSceneController {
  const width = Math.max(container.clientWidth, 1);
  const height = Math.max(container.clientHeight, 1);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(56, width / height, 0.2, 420);
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.06;
  orbit.maxPolarAngle = Math.PI * 0.495;
  orbit.minDistance = 2;
  orbit.maxDistance = 95;
  orbit.panSpeed = 0.75;

  const setInitialCamera = () => {
    const startY = getTerrainHeight(0, 14) + 3.6;
    const lookY = getTerrainHeight(0, -10) + 4.5;
    camera.position.set(0, startY, 14);
    orbit.target.set(0, lookY, -10);
    orbit.update();
  };
  setInitialCamera();

  // Shared materials
  const skyMat = createSkyDomeMaterial();
  const terrainMat = createTerrainMaterial();
  const barkMat = createBarkMaterial();
  const canopyMat = createCanopyMaterial();
  const grassMat = createGrassMaterial();
  const fernMat = createFernMaterial();
  const rockMat = createRockMaterial();
  const snowMat = createSnowParticleMaterial();
  const rainMat = createRainParticleMaterial();
  const fireflyMat = createFireflyParticleMaterial();

  snowMat.uniforms.uPixelRatio.value = pixelRatio;
  rainMat.uniforms.uPixelRatio.value = pixelRatio;
  fireflyMat.uniforms.uPixelRatio.value = pixelRatio;

  // Sky Dome
  const skyGeo = new THREE.SphereGeometry(320, 32, 20);
  const skyMesh = new THREE.Mesh(skyGeo, skyMat);
  skyMesh.frustumCulled = false;
  scene.add(skyMesh);

  // Terrain (260x260, 140x140 segments)
  const terrainGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 140, 140);
  terrainGeo.rotateX(-Math.PI / 2);
  const tPos = terrainGeo.getAttribute('position');
  for (let i = 0; i < tPos.count; i++) {
    const x = tPos.getX(i);
    const z = tPos.getZ(i);
    tPos.setY(i, getTerrainHeight(x, z));
  }
  terrainGeo.computeVertexNormals();
  const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
  scene.add(terrainMesh);

  // Deterministic placement helpers
  const rng = createSeededRng(20261126);
  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();

  const sampleForestCoord = (
    minClearingRadius: number,
    ringWeight: number,
    margin: number
  ): { x: number; z: number } => {
    const usable = HALF_WORLD - margin;
    // Slight hero-ring clustering just outside central clearing
    if (rng() < ringWeight) {
      const angle = rng() * Math.PI * 2;
      const r = minClearingRadius + rng() * 10.5;
      return { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
    }
    let x = 0;
    let z = 0;
    for (let attempt = 0; attempt < 8; attempt++) {
      x = (rng() * 2 - 1) * usable;
      z = (rng() * 2 - 1) * usable;
      if (x * x + z * z >= minClearingRadius * minClearingRadius) {
        break;
      }
    }
    if (x * x + z * z < minClearingRadius * minClearingRadius) {
      const a = rng() * Math.PI * 2;
      x = Math.cos(a) * (minClearingRadius + 1.5);
      z = Math.sin(a) * (minClearingRadius + 1.5);
    }
    return { x, z };
  };

  // 1. Conifer / Pine forest (1,650 trees)
  const coniferGeo = buildConiferGeometries();
  const coniferTrunks = new THREE.InstancedMesh(coniferGeo.trunk, barkMat, CONIFER_COUNT);
  const coniferCrowns = new THREE.InstancedMesh(coniferGeo.crown, canopyMat, CONIFER_COUNT);

  for (let i = 0; i < CONIFER_COUNT; i++) {
    const { x, z } = sampleForestCoord(10.5, 0.04, 6);
    const y = getTerrainHeight(x, z) - 0.15;
    const scaleH = 0.72 + rng() * 0.85;
    const scaleW = scaleH * (0.86 + rng() * 0.28);

    dummy.position.set(x, y, z);
    dummy.rotation.set((rng() - 0.5) * 0.06, rng() * Math.PI * 2, (rng() - 0.5) * 0.06);
    dummy.scale.set(scaleW, scaleH, scaleW);
    dummy.updateMatrix();

    coniferTrunks.setMatrixAt(i, dummy.matrix);
    coniferCrowns.setMatrixAt(i, dummy.matrix);

    // Rich pine green & spruce blue-green variation
    const hue = 0.30 + rng() * 0.10; // forest green to blue-spruce
    const sat = 0.34 + rng() * 0.22;
    const light = 0.15 + rng() * 0.11;
    tmpColor.setHSL(hue, sat, light);
    coniferCrowns.setColorAt(i, tmpColor);
  }
  coniferTrunks.instanceMatrix.needsUpdate = true;
  coniferCrowns.instanceMatrix.needsUpdate = true;
  if (coniferCrowns.instanceColor) coniferCrowns.instanceColor.needsUpdate = true;
  scene.add(coniferTrunks, coniferCrowns);

  // 2. Broadleaf woodland trees (550 trees)
  const broadleafGeo = buildBroadleafGeometries();
  const broadleafTrunks = new THREE.InstancedMesh(broadleafGeo.trunk, barkMat, BROADLEAF_COUNT);
  const broadleafCrowns = new THREE.InstancedMesh(broadleafGeo.crown, canopyMat, BROADLEAF_COUNT);

  for (let i = 0; i < BROADLEAF_COUNT; i++) {
    const { x, z } = sampleForestCoord(11.5, 0.05, 6);
    const y = getTerrainHeight(x, z) - 0.15;
    const scale = 0.78 + rng() * 0.72;

    dummy.position.set(x, y, z);
    dummy.rotation.set((rng() - 0.5) * 0.07, rng() * Math.PI * 2, (rng() - 0.5) * 0.07);
    dummy.scale.set(scale * (0.9 + rng() * 0.2), scale, scale * (0.9 + rng() * 0.2));
    dummy.updateMatrix();

    broadleafTrunks.setMatrixAt(i, dummy.matrix);
    broadleafCrowns.setMatrixAt(i, dummy.matrix);

    // Emerald, olive, and subtle golden-moss variation
    const variant = rng();
    if (variant < 0.72) {
      tmpColor.setHSL(0.24 + rng() * 0.09, 0.40 + rng() * 0.22, 0.20 + rng() * 0.12);
    } else if (variant < 0.9) {
      tmpColor.setHSL(0.18 + rng() * 0.05, 0.42 + rng() * 0.18, 0.24 + rng() * 0.10);
    } else {
      // Occasional birch/autumn-moss accent
      tmpColor.setHSL(0.11 + rng() * 0.05, 0.52 + rng() * 0.20, 0.30 + rng() * 0.10);
    }
    broadleafCrowns.setColorAt(i, tmpColor);
  }
  broadleafTrunks.instanceMatrix.needsUpdate = true;
  broadleafCrowns.instanceMatrix.needsUpdate = true;
  if (broadleafCrowns.instanceColor) broadleafCrowns.instanceColor.needsUpdate = true;
  scene.add(broadleafTrunks, broadleafCrowns);

  // 3. Dense Grass Tufts (22,000 instances)
  const grassGeo = buildGrassTuftGeometry();
  const grassMesh = new THREE.InstancedMesh(grassGeo, grassMat, GRASS_COUNT);
  for (let i = 0; i < GRASS_COUNT; i++) {
    const rBias = rng() < 0.18 ? 28 : HALF_WORLD - 5;
    const x = (rng() * 2 - 1) * rBias;
    const z = (rng() * 2 - 1) * rBias;
    const y = getTerrainHeight(x, z) - 0.03;
    const sx = 0.7 + rng() * 0.75;
    const sy = 0.65 + rng() * 0.95;

    dummy.position.set(x, y, z);
    dummy.rotation.set((rng() - 0.5) * 0.15, rng() * Math.PI * 2, (rng() - 0.5) * 0.15);
    dummy.scale.set(sx, sy, sx);
    dummy.updateMatrix();
    grassMesh.setMatrixAt(i, dummy.matrix);

    tmpColor.setHSL(0.23 + rng() * 0.09, 0.42 + rng() * 0.24, 0.24 + rng() * 0.15);
    grassMesh.setColorAt(i, tmpColor);
  }
  grassMesh.instanceMatrix.needsUpdate = true;
  if (grassMesh.instanceColor) grassMesh.instanceColor.needsUpdate = true;
  scene.add(grassMesh);

  // 4. Woodland Ferns (3,200 instances)
  const fernGeo = buildFernRosetteGeometry();
  const fernMesh = new THREE.InstancedMesh(fernGeo, fernMat, FERN_COUNT);
  for (let i = 0; i < FERN_COUNT; i++) {
    const rBias = rng() < 0.16 ? 26 : HALF_WORLD - 6;
    const x = (rng() * 2 - 1) * rBias;
    const z = (rng() * 2 - 1) * rBias;
    const y = getTerrainHeight(x, z) - 0.02;
    const s = 0.68 + rng() * 0.85;

    dummy.position.set(x, y, z);
    dummy.rotation.set((rng() - 0.5) * 0.12, rng() * Math.PI * 2, (rng() - 0.5) * 0.12);
    dummy.scale.set(s, s * (0.85 + rng() * 0.3), s);
    dummy.updateMatrix();
    fernMesh.setMatrixAt(i, dummy.matrix);

    tmpColor.setHSL(0.26 + rng() * 0.08, 0.46 + rng() * 0.22, 0.21 + rng() * 0.13);
    fernMesh.setColorAt(i, tmpColor);
  }
  fernMesh.instanceMatrix.needsUpdate = true;
  if (fernMesh.instanceColor) fernMesh.instanceColor.needsUpdate = true;
  scene.add(fernMesh);

  // 5. Mossy Rocks (220 instances)
  const rockGeo = buildRockGeometry();
  const rockMesh = new THREE.InstancedMesh(rockGeo, rockMat, ROCK_COUNT);
  for (let i = 0; i < ROCK_COUNT; i++) {
    const { x, z } = sampleForestCoord(7.5, 0.08, 8);
    const y = getTerrainHeight(x, z) - 0.18;
    const sx = 0.55 + rng() * 1.45;
    const sy = 0.45 + rng() * 1.05;
    const sz = 0.55 + rng() * 1.45;

    dummy.position.set(x, y, z);
    dummy.rotation.set(rng() * 0.5, rng() * Math.PI * 2, rng() * 0.5);
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    rockMesh.setMatrixAt(i, dummy.matrix);

    const tone = 0.34 + rng() * 0.18;
    tmpColor.setRGB(tone * 0.96, tone * 0.99, tone * 1.04);
    rockMesh.setColorAt(i, tmpColor);
  }
  rockMesh.instanceMatrix.needsUpdate = true;
  if (rockMesh.instanceColor) rockMesh.instanceColor.needsUpdate = true;
  scene.add(rockMesh);

  // 6. GPU Volume-Wrapped Weather Particles & Fireflies
  const snowBox = snowMat.uniforms.uBoxSize.value as THREE.Vector3;
  const snowGeo = buildWeatherPointsGeometry(SNOW_PARTICLE_COUNT, snowBox, 0.75, 2.1, 101);
  const snowPoints = new THREE.Points(snowGeo, snowMat);
  snowPoints.frustumCulled = false;
  scene.add(snowPoints);

  const rainBox = rainMat.uniforms.uBoxSize.value as THREE.Vector3;
  const rainGeo = buildWeatherPointsGeometry(RAIN_PARTICLE_COUNT, rainBox, 0.8, 1.8, 202);
  const rainPoints = new THREE.Points(rainGeo, rainMat);
  rainPoints.frustumCulled = false;
  scene.add(rainPoints);

  const fireflyBox = fireflyMat.uniforms.uBoxSize.value as THREE.Vector3;
  const fireflyGeo = buildWeatherPointsGeometry(FIREFLY_COUNT, fireflyBox, 0.9, 1.4, 303);
  const fireflyPoints = new THREE.Points(fireflyGeo, fireflyMat);
  fireflyPoints.frustumCulled = false;
  scene.add(fireflyPoints);

  // Keyboard movement (WASD + Arrow keys)
  const pressedKeys = new Set<string>();
  const onKeyDown = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const key = e.key.toLowerCase();
    if (
      key === 'w' ||
      key === 'a' ||
      key === 's' ||
      key === 'd' ||
      key === 'arrowup' ||
      key === 'arrowdown' ||
      key === 'arrowleft' ||
      key === 'arrowright' ||
      key === 'shift'
    ) {
      pressedKeys.add(key);
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    pressedKeys.delete(e.key.toLowerCase());
  };
  const onBlur = () => {
    pressedKeys.clear();
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  const forwardVec = new THREE.Vector3();
  const rightVec = new THREE.Vector3();
  const moveDelta = new THREE.Vector3();
  const upAxis = new THREE.Vector3(0, 1, 0);

  const atmosphere: AtmosphereColors = {
    sunDir: new THREE.Vector3(),
    sunColor: new THREE.Color(),
    zenith: new THREE.Color(),
    horizon: new THREE.Color(),
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    fog: new THREE.Color(),
    fogDensity: 0.0085,
    overcast: 0,
    stars: 0,
    fireflies: 0,
  };

  const lightingMaterials = [terrainMat, barkMat, canopyMat, grassMat, fernMat, rockMat];
  let elapsedTime = 0;

  const updateCameraWalk = (dtSec: number) => {
    const moveFwd =
      (pressedKeys.has('w') || pressedKeys.has('arrowup') ? 1 : 0) -
      (pressedKeys.has('s') || pressedKeys.has('arrowdown') ? 1 : 0);
    const moveRight =
      (pressedKeys.has('d') || pressedKeys.has('arrowright') ? 1 : 0) -
      (pressedKeys.has('a') || pressedKeys.has('arrowleft') ? 1 : 0);

    if (moveFwd !== 0 || moveRight !== 0) {
      camera.getWorldDirection(forwardVec);
      forwardVec.y = 0;
      if (forwardVec.lengthSq() > 1e-6) {
        forwardVec.normalize();
      } else {
        forwardVec.set(0, 0, -1);
      }
      rightVec.crossVectors(forwardVec, upAxis).normalize();

      moveDelta
        .set(0, 0, 0)
        .addScaledVector(forwardVec, moveFwd)
        .addScaledVector(rightVec, moveRight);

      if (moveDelta.lengthSq() > 1e-6) {
        const speed = pressedKeys.has('shift') ? 18 : 10.5;
        const prevGround = getTerrainHeight(camera.position.x, camera.position.z);
        moveDelta.normalize().multiplyScalar(speed * dtSec);

        const nextX = THREE.MathUtils.clamp(camera.position.x + moveDelta.x, -118, 118);
        const nextZ = THREE.MathUtils.clamp(camera.position.z + moveDelta.z, -118, 118);
        const appliedX = nextX - camera.position.x;
        const appliedZ = nextZ - camera.position.z;
        const nextGround = getTerrainHeight(nextX, nextZ);
        const dy = nextGround - prevGround;

        camera.position.x = nextX;
        camera.position.z = nextZ;
        camera.position.y += dy;
        orbit.target.x += appliedX;
        orbit.target.z += appliedZ;
        orbit.target.y += dy;
      }
    }

    orbit.update();

    const minGroundY = getTerrainHeight(camera.position.x, camera.position.z) + 1.5;
    if (camera.position.y < minGroundY) {
      camera.position.y = minGroundY;
    }
    skyMesh.position.copy(camera.position);
  };

  const update = (dtSec: number, controls: LivingWorldControls, simState: LivingWorldSimState) => {
    const safeDt = Math.min(0.1, Math.max(0, dtSec));
    elapsedTime += safeDt;

    updateCameraWalk(safeDt);
    computeAtmosphere(controls, simState, atmosphere);

    // Sync shared directional, hemisphere & fog uniforms
    for (const mat of lightingMaterials) {
      mat.uniforms.uSunDir.value.copy(atmosphere.sunDir);
      mat.uniforms.uSunColor.value.copy(atmosphere.sunColor);
      mat.uniforms.uHemisphereSky.value.copy(atmosphere.hemiSky);
      mat.uniforms.uHemisphereGround.value.copy(atmosphere.hemiGround);
      mat.uniforms.uFogColor.value.copy(atmosphere.fog);
      mat.uniforms.uFogDensity.value = atmosphere.fogDensity;
      mat.uniforms.uTime.value = elapsedTime;
      mat.uniforms.uWetness.value = simState.wetness;
    }

    terrainMat.uniforms.uSnowDepth.value = simState.snowDepthCm;
    terrainMat.uniforms.uSnowCoverage.value = simState.snowCoverage;

    barkMat.uniforms.uWindStrength.value = controls.windStrength;
    barkMat.uniforms.uCanopySnow.value = simState.canopySnow;

    canopyMat.uniforms.uWindStrength.value = controls.windStrength;
    canopyMat.uniforms.uCanopySnow.value = simState.canopySnow;

    grassMat.uniforms.uWindStrength.value = controls.windStrength;
    grassMat.uniforms.uSnowCoverage.value = simState.snowCoverage;
    grassMat.uniforms.uSnowDepth.value = simState.snowDepthCm;

    fernMat.uniforms.uWindStrength.value = controls.windStrength;
    fernMat.uniforms.uSnowCoverage.value = simState.snowCoverage;
    fernMat.uniforms.uCanopySnow.value = simState.canopySnow;

    rockMat.uniforms.uSnowCoverage.value = simState.snowCoverage;

    skyMat.uniforms.uSunDir.value.copy(atmosphere.sunDir);
    skyMat.uniforms.uSunColor.value.copy(atmosphere.sunColor);
    skyMat.uniforms.uZenithColor.value.copy(atmosphere.zenith);
    skyMat.uniforms.uHorizonColor.value.copy(atmosphere.horizon);
    skyMat.uniforms.uOvercast.value = atmosphere.overcast;
    skyMat.uniforms.uStarsIntensity.value = atmosphere.stars;
    skyMat.uniforms.uTime.value = elapsedTime;

    const snowOpacity =
      simState.activePrecipKind === 'snow' ? Math.min(1, controls.precipIntensity * 1.15) : 0;
    snowMat.uniforms.uCamPos.value.copy(camera.position);
    snowMat.uniforms.uTime.value = elapsedTime;
    snowMat.uniforms.uWindStrength.value = controls.windStrength;
    snowMat.uniforms.uOpacity.value = snowOpacity;

    const rainOpacity =
      simState.activePrecipKind === 'rain' ? Math.min(1, controls.precipIntensity * 1.1) : 0;
    rainMat.uniforms.uCamPos.value.copy(camera.position);
    rainMat.uniforms.uTime.value = elapsedTime;
    rainMat.uniforms.uWindStrength.value = controls.windStrength;
    rainMat.uniforms.uOpacity.value = rainOpacity;

    fireflyMat.uniforms.uCamPos.value.copy(camera.position);
    fireflyMat.uniforms.uTime.value = elapsedTime;
    fireflyMat.uniforms.uOpacity.value = atmosphere.fireflies;

    renderer.render(scene, camera);
  };

  const resize = (nextWidth: number, nextHeight: number) => {
    const w = Math.max(nextWidth, 1);
    const h = Math.max(nextHeight, 1);
    const pr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    snowMat.uniforms.uPixelRatio.value = pr;
    rainMat.uniforms.uPixelRatio.value = pr;
    fireflyMat.uniforms.uPixelRatio.value = pr;
  };

  const getStats = (): ForestSceneStats => ({
    trees: CONIFER_COUNT + BROADLEAF_COUNT,
    grassBlades: GRASS_COUNT,
    ferns: FERN_COUNT,
    rocks: ROCK_COUNT,
    particles: SNOW_PARTICLE_COUNT + RAIN_PARTICLE_COUNT + FIREFLY_COUNT,
  });

  const dispose = () => {
    orbit.dispose();
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);

    scene.traverse((obj) => {
      if (
        obj instanceof THREE.Mesh ||
        obj instanceof THREE.InstancedMesh ||
        obj instanceof THREE.Points
      ) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          for (const mat of obj.material) {
            mat.dispose();
          }
        } else {
          obj.material.dispose();
        }
      }
    });

    if (renderer.domElement.parentElement === container) {
      container.removeChild(renderer.domElement);
    }
    renderer.dispose();
  };

  return {
    update,
    resize,
    resetCamera: setInitialCamera,
    getStats,
    dispose,
  };
}
