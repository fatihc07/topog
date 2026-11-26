import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type {
  CloudStyle,
  ForestSceneStats,
  LivingWorldControls,
  LivingWorldSimState,
} from '../types/livingWorld';
import { createForestTextures } from './forestTextures';
import {
  evaluateSunCloudTransmission,
  fbm2D,
  getTerrainHeight,
  getTrailCenterX,
  getTrailFactor,
} from './forestWeatherPhysics';
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
  createSunbeamMaterial,
  createTerrainMaterial,
  createVolumetricMistMaterial,
} from './forestShaders';

export interface ForestSceneController {
  update: (dtSec: number, controls: LivingWorldControls, simState: LivingWorldSimState) => void;
  resize: (width: number, height: number) => void;
  resetCamera: () => void;
  getStats: () => ForestSceneStats;
  getSunVisibility: () => number;
  dispose: () => void;
}

const WORLD_SIZE = 260;
const HALF_WORLD = WORLD_SIZE * 0.5;
const OAK_COUNT = 800;
const BIRCH_COUNT = 650;
const OLD_GROWTH_COUNT = 450;
const GRASS_COUNT = 26000;
const FERN_COUNT = 4200;
const ROCK_COUNT = 180;
const MIST_PLANE_COUNT = 32;
const SUNBEAM_COUNT = 18;
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

interface LimbSpec {
  points: THREE.Vector3[];
  rStart: number;
  rEnd: number;
  radialSegs: number;
  ringSegs: number;
  rootFlare?: number;
  buttressPhase?: number;
}

function buildTaperedCurvedLimb(spec: LimbSpec): THREE.BufferGeometry {
  const {
    points,
    rStart,
    rEnd,
    radialSegs,
    ringSegs,
    rootFlare = 0,
    buttressPhase = 0.4,
  } = spec;

  const curve = new THREE.CatmullRomCurve3(points);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const tangent0 = curve.getTangentAt(0).normalize();
  const ref =
    Math.abs(tangent0.y) < 0.92
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0);
  const normalDir = new THREE.Vector3().crossVectors(ref, tangent0).normalize();
  const binormalDir = new THREE.Vector3();
  const prevTangent = tangent0.clone();
  const rotQuat = new THREE.Quaternion();
  const radVec = new THREE.Vector3();

  for (let i = 0; i <= ringSegs; i++) {
    const t = i / ringSegs;
    const center = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();

    if (i > 0) {
      rotQuat.setFromUnitVectors(prevTangent, tangent);
      normalDir.applyQuaternion(rotQuat).normalize();
      prevTangent.copy(tangent);
    }
    binormalDir.crossVectors(tangent, normalDir).normalize();

    const baseR = rStart * Math.pow(1 - t, 0.82) + rEnd * t;
    const flareFactor = rootFlare > 0 && t < 0.22 ? Math.pow(1 - t / 0.22, 2) : 0;

    for (let j = 0; j <= radialSegs; j++) {
      const u = j / radialSegs;
      const theta = u * Math.PI * 2;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      const buttress =
        flareFactor > 0
          ? 1 + rootFlare * flareFactor * (0.72 + 0.28 * Math.cos(theta * 4 + buttressPhase))
          : 1;
      const r = baseR * buttress;

      radVec
        .set(0, 0, 0)
        .addScaledVector(normalDir, cosT)
        .addScaledVector(binormalDir, sinT)
        .normalize();

      positions.push(center.x + radVec.x * r, center.y + radVec.y * r, center.z + radVec.z * r);
      normals.push(radVec.x, radVec.y, radVec.z);
      uvs.push(u, t);
    }
  }

  const stride = radialSegs + 1;
  for (let i = 0; i < ringSegs; i++) {
    for (let j = 0; j < radialSegs; j++) {
      const r0 = i * stride + j;
      const r1 = (i + 1) * stride + j;
      indices.push(r0, r0 + 1, r1, r0 + 1, r1 + 1, r1);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  return geom;
}

interface FoliageAnchor {
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  scale: number;
}

function buildLeafCardClusterGeometry(
  anchors: FoliageAnchor[],
  cardCount: number,
  crownCenterY: number,
  rng: () => number
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const crownCenter = new THREE.Vector3(0, crownCenterY, 0);
  const up = new THREE.Vector3(0, 1, 0);
  const cardRight = new THREE.Vector3();
  const cardUp = new THREE.Vector3();
  const cardNormal = new THREE.Vector3();
  const outward = new THREE.Vector3();
  const vPos = new THREE.Vector3();
  const vNorm = new THREE.Vector3();

  let vertexOffset = 0;

  for (let c = 0; c < cardCount; c++) {
    const anchor = anchors[c % anchors.length];
    const spreadR = (0.35 + rng() * 0.95) * anchor.scale;
    const az = rng() * Math.PI * 2;
    const elev = (rng() - 0.35) * 1.1;

    const basePos = anchor.pos
      .clone()
      .add(
        new THREE.Vector3(
          Math.cos(az) * spreadR,
          elev * anchor.scale * 0.75,
          Math.sin(az) * spreadR
        )
      );

    // Orient card outward from crown & angled variably so leaves read volumetrically from all views
    outward.copy(basePos).sub(crownCenter);
    if (outward.lengthSq() < 1e-4) {
      outward.set(Math.cos(az), 0.5, Math.sin(az));
    }
    outward.normalize();

    const yaw = Math.atan2(outward.x, outward.z) + (rng() - 0.5) * 1.6;
    const pitch = 0.35 + rng() * 0.85;
    const roll = (rng() - 0.5) * 1.25;

    const euler = new THREE.Euler(pitch, yaw, roll, 'YXZ');
    cardRight.set(1, 0, 0).applyEuler(euler);
    cardUp.set(0, 1, 0).applyEuler(euler);
    cardNormal.crossVectors(cardRight, cardUp).normalize();

    const width = (1.85 + rng() * 1.15) * anchor.scale;
    const height = (1.85 + rng() * 1.15) * anchor.scale;
    const archCup = 0.22 * width;

    // 2x2 grid per foliage card for subtle 3D cup curvature (9 verts, 8 tris)
    for (let iy = 0; iy <= 2; iy++) {
      const v = iy / 2;
      for (let ix = 0; ix <= 2; ix++) {
        const u = ix / 2;
        const xOff = (u - 0.5) * width;
        const yOff = (v - 0.08) * height;
        const cup = -(Math.pow(u - 0.5, 2) + Math.pow(v - 0.5, 2)) * archCup;

        vPos
          .copy(basePos)
          .addScaledVector(cardRight, xOff)
          .addScaledVector(cardUp, yOff)
          .addScaledVector(cardNormal, cup);

        vNorm
          .copy(vPos)
          .sub(crownCenter)
          .normalize()
          .lerp(up, 0.28)
          .normalize();

        positions.push(vPos.x, vPos.y, vPos.z);
        normals.push(vNorm.x, vNorm.y, vNorm.z);
        uvs.push(u, v);
      }
    }

    for (let iy = 0; iy < 2; iy++) {
      for (let ix = 0; ix < 2; ix++) {
        const r0 = vertexOffset + iy * 3 + ix;
        const r1 = r0 + 3;
        indices.push(r0, r0 + 1, r1, r0 + 1, r1 + 1, r1);
      }
    }
    vertexOffset += 9;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  return geom;
}

interface TreeArchetype {
  trunk: THREE.BufferGeometry;
  crown: THREE.BufferGeometry;
}

function buildOakArchetype(): TreeArchetype {
  const rng = createSeededRng(41001);
  const trunkParts: THREE.BufferGeometry[] = [];
  const anchors: FoliageAnchor[] = [];

  // Sturdy tall woodland oak/beech curved trunk with root flare
  const trunkPoints = [
    new THREE.Vector3(0, -0.25, 0),
    new THREE.Vector3(0.14, 3.2, -0.08),
    new THREE.Vector3(-0.08, 6.8, 0.10),
    new THREE.Vector3(0.05, 10.6, 0.04),
  ];
  const trunkCurve = new THREE.CatmullRomCurve3(trunkPoints);

  trunkParts.push(
    buildTaperedCurvedLimb({
      points: trunkPoints,
      rStart: 0.34,
      rEnd: 0.07,
      radialSegs: 12,
      ringSegs: 10,
      rootFlare: 0.56,
      buttressPhase: 0.3,
    })
  );

  const limbAngles = [0.2, 1.45, 2.75, 4.05, 5.25];
  for (let i = 0; i < limbAngles.length; i++) {
    const a = limbAngles[i];
    const tStart = 0.56 + (i / (limbAngles.length - 1)) * 0.32;
    const p0 = trunkCurve.getPointAt(tStart);
    const reach = 2.4 + (i % 2) * 0.55;
    const rise = 3.2 + (i % 3) * 0.55;
    const dx = Math.cos(a) * reach;
    const dz = Math.sin(a) * reach;

    const p1 = new THREE.Vector3(p0.x + dx * 0.45, p0.y + rise * 0.48, p0.z + dz * 0.45);
    const p2 = new THREE.Vector3(p0.x + dx, p0.y + rise, p0.z + dz);

    trunkParts.push(
      buildTaperedCurvedLimb({
        points: [p0, p1, p2],
        rStart: 0.115,
        rEnd: 0.018,
        radialSegs: 8,
        ringSegs: 6,
      })
    );

    anchors.push({ pos: p1.clone().lerp(p2, 0.55), dir: new THREE.Vector3(dx, 1.5, dz).normalize(), scale: 1.05 });
    anchors.push({ pos: p2, dir: new THREE.Vector3(dx, 2.0, dz).normalize(), scale: 1.15 });
  }

  // Crown apex anchors
  const apex = trunkCurve.getPointAt(1.0);
  anchors.push({ pos: new THREE.Vector3(apex.x, apex.y + 0.9, apex.z), dir: new THREE.Vector3(0, 1, 0), scale: 1.2 });
  anchors.push({ pos: new THREE.Vector3(apex.x - 0.55, apex.y + 1.6, apex.z + 0.45), dir: new THREE.Vector3(-0.3, 1, 0.2), scale: 1.08 });

  return {
    trunk: normalizeAndMerge(trunkParts),
    crown: buildLeafCardClusterGeometry(anchors, 42, 10.2, rng),
  };
}

function buildBirchArchetype(): TreeArchetype {
  const rng = createSeededRng(42002);
  const trunkParts: THREE.BufferGeometry[] = [];
  const anchors: FoliageAnchor[] = [];

  // Tall slender leaning silver birch / woodland sapling
  const trunkPoints = [
    new THREE.Vector3(0, -0.2, 0),
    new THREE.Vector3(0.20, 3.4, 0.09),
    new THREE.Vector3(0.50, 7.6, 0.22),
    new THREE.Vector3(0.72, 11.8, 0.32),
  ];
  const trunkCurve = new THREE.CatmullRomCurve3(trunkPoints);

  trunkParts.push(
    buildTaperedCurvedLimb({
      points: trunkPoints,
      rStart: 0.18,
      rEnd: 0.036,
      radialSegs: 10,
      ringSegs: 10,
      rootFlare: 0.24,
      buttressPhase: 1.1,
    })
  );

  const limbAngles = [0.4, 1.9, 3.3, 4.8];
  for (let i = 0; i < limbAngles.length; i++) {
    const a = limbAngles[i];
    const tStart = 0.58 + (i / (limbAngles.length - 1)) * 0.30;
    const p0 = trunkCurve.getPointAt(tStart);
    const reach = 1.75 + (i % 2) * 0.35;
    const rise = 2.6 + (i % 2) * 0.35;
    const dx = Math.cos(a) * reach;
    const dz = Math.sin(a) * reach;

    const p1 = new THREE.Vector3(p0.x + dx * 0.48, p0.y + rise * 0.5, p0.z + dz * 0.48);
    const p2 = new THREE.Vector3(p0.x + dx, p0.y + rise, p0.z + dz);

    trunkParts.push(
      buildTaperedCurvedLimb({
        points: [p0, p1, p2],
        rStart: 0.068,
        rEnd: 0.016,
        radialSegs: 8,
        ringSegs: 5,
      })
    );

    anchors.push({ pos: p1.clone().lerp(p2, 0.45), dir: new THREE.Vector3(dx, 1.6, dz).normalize(), scale: 0.85 });
    anchors.push({ pos: p2, dir: new THREE.Vector3(dx, 2.0, dz).normalize(), scale: 0.92 });
  }

  const apex = trunkCurve.getPointAt(1.0);
  anchors.push({ pos: new THREE.Vector3(apex.x, apex.y + 0.3, apex.z), dir: new THREE.Vector3(0.15, 1, 0.08), scale: 0.95 });

  return {
    trunk: normalizeAndMerge(trunkParts),
    crown: buildLeafCardClusterGeometry(anchors, 32, 10.0, rng),
  };
}

function buildOldGrowthArchetype(): TreeArchetype {
  const rng = createSeededRng(43003);
  const trunkParts: THREE.BufferGeometry[] = [];
  const anchors: FoliageAnchor[] = [];

  // Broad gnarled leaning old-growth woodland tree
  const trunkPoints = [
    new THREE.Vector3(0, -0.3, 0),
    new THREE.Vector3(0.28, 2.6, -0.14),
    new THREE.Vector3(0.72, 6.2, -0.22),
    new THREE.Vector3(1.02, 10.0, -0.10),
  ];
  const trunkCurve = new THREE.CatmullRomCurve3(trunkPoints);

  trunkParts.push(
    buildTaperedCurvedLimb({
      points: trunkPoints,
      rStart: 0.45,
      rEnd: 0.09,
      radialSegs: 12,
      ringSegs: 11,
      rootFlare: 0.80,
      buttressPhase: 0.8,
    })
  );

  const limbSpecs = [
    { a: 0.15, tStart: 0.55, reach: 3.4, rise: 3.1 },
    { a: 1.18, tStart: 0.62, reach: 3.1, rise: 3.5 },
    { a: 2.35, tStart: 0.68, reach: 3.2, rise: 3.3 },
    { a: 3.45, tStart: 0.75, reach: 2.9, rise: 3.6 },
    { a: 4.55, tStart: 0.82, reach: 2.8, rise: 3.4 },
    { a: 5.55, tStart: 0.88, reach: 2.5, rise: 3.5 },
  ];

  for (let i = 0; i < limbSpecs.length; i++) {
    const l = limbSpecs[i];
    const p0 = trunkCurve.getPointAt(l.tStart);
    const dx = Math.cos(l.a) * l.reach;
    const dz = Math.sin(l.a) * l.reach;

    const p1 = new THREE.Vector3(p0.x + dx * 0.48, p0.y + l.rise * 0.48, p0.z + dz * 0.48);
    const p2 = new THREE.Vector3(p0.x + dx, p0.y + l.rise, p0.z + dz);

    trunkParts.push(
      buildTaperedCurvedLimb({
        points: [p0, p1, p2],
        rStart: 0.125,
        rEnd: 0.020,
        radialSegs: 8,
        ringSegs: 6,
      })
    );

    anchors.push({ pos: p1.clone().lerp(p2, 0.5), dir: new THREE.Vector3(dx, 1.4, dz).normalize(), scale: 1.12 });
    anchors.push({ pos: p2, dir: new THREE.Vector3(dx, 1.8, dz).normalize(), scale: 1.24 });
  }

  const apex = trunkCurve.getPointAt(1.0);
  anchors.push({ pos: new THREE.Vector3(apex.x, apex.y + 0.7, apex.z), dir: new THREE.Vector3(0.2, 1, 0), scale: 1.25 });

  return {
    trunk: normalizeAndMerge(trunkParts),
    crown: buildLeafCardClusterGeometry(anchors, 46, 9.2, rng),
  };
}

function buildGrassTuftGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const quadCount = 3;
  const segments = 3;
  let vertexOffset = 0;

  for (let q = 0; q < quadCount; q++) {
    const angle = (q / quadCount) * Math.PI + (q === 1 ? 0.16 : 0);
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const offsetX = (q - 1) * 0.03;
    const offsetZ = ((q % 2) - 0.5) * 0.03;
    const lean = 0.08 + q * 0.025;
    const height = 0.48 + (q === 1 ? 0.09 : 0);
    const halfWidth = 0.25;

    for (let s = 0; s <= segments; s++) {
      const t = s / segments;
      const y = t * height;
      const curve = t * t * lean;

      const cx = offsetX - sinA * curve;
      const cz = offsetZ + cosA * curve;

      const lx = cx - cosA * halfWidth;
      const lz = cz - sinA * halfWidth;
      const rx = cx + cosA * halfWidth;
      const rz = cz + sinA * halfWidth;

      positions.push(lx, y, lz, rx, y, rz);

      const nx = -sinA * 0.45;
      const ny = 0.89;
      const nz = cosA * 0.45;
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

  // 7 curving arched frond quads extruded along a smooth arc with UV 0..1
  const frondCount = 7;
  const segments = 5;
  let vertexOffset = 0;

  for (let f = 0; f < frondCount; f++) {
    const angle = (f / frondCount) * Math.PI * 2 + (f % 2) * 0.15;
    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);
    const sideX = -dirZ;
    const sideZ = dirX;
    const reach = 0.84 + (f % 3) * 0.11;
    const archH = 0.46 + (f % 2) * 0.08;
    const halfWidth = 0.36;

    for (let s = 0; s <= segments; s++) {
      const t = s / segments;
      const dist = t * reach;
      const y = Math.sin(t * Math.PI * 0.78) * archH + 0.03;
      const cupDroop = 0.025 * Math.sin(t * Math.PI);

      const cx = dirX * dist;
      const cz = dirZ * dist;
      positions.push(
        cx - sideX * halfWidth,
        y - cupDroop,
        cz - sideZ * halfWidth,
        cx + sideX * halfWidth,
        y - cupDroop,
        cz + sideZ * halfWidth
      );

      const slopeNy = Math.max(0.45, 1.0 - t * 0.55);
      const slopeHoriz = Math.sqrt(Math.max(0, 1 - slopeNy * slopeNy));
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
  // Smooth high-subdivision boulder (detail = 3) displaced gently with fbm2D
  const rock = new THREE.IcosahedronGeometry(1, 3);
  const pos = rock.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    const vz = pos.getZ(i);
    const n1 = fbm2D(vx * 1.45 + vy * 0.85 + 3.1, vz * 1.45 - vy * 0.75 + 7.4, 3);
    const n2 = fbm2D(vz * 2.3 - vx * 0.7 + 11.2, vy * 1.9 + vx * 1.1 - 2.3, 2);
    const disp = 0.76 + 0.34 * n1 + 0.12 * n2;
    const flatBottom = vy < -0.25 ? 0.82 : 1.0;
    pos.setXYZ(i, vx * disp, vy * disp * 0.66 * flatBottom, vz * disp);
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

const CLOUD_STYLE_INDEX: Record<CloudStyle, number> = {
  cumulus: 0,
  partly: 1,
  cirrus: 2,
  storm: 3,
};

interface AtmosphereColors {
  sunDir: THREE.Vector3;
  moonDir: THREE.Vector3;
  sunColor: THREE.Color;
  zenith: THREE.Color;
  horizon: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  fog: THREE.Color;
  fogDensity: number;
  mistGlow: number;
  dappleStrength: number;
  mistOpacity: number;
  sunbeamOpacity: number;
  overcast: number;
  stars: number;
  fireflies: number;
}

function computeAtmosphere(
  controls: LivingWorldControls,
  simState: LivingWorldSimState,
  effectiveCoverage: number,
  out: AtmosphereColors
): void {
  const hours = ((controls.timeOfDayHours % 24) + 24) % 24;
  const sunAngle = ((hours - 6) / 12) * Math.PI;
  const sinElev = Math.sin(sunAngle);
  const cosAzim = Math.cos(sunAngle);

  // Position sun forward down the misty trail so canopy backlighting and sunbeams shine toward camera
  const rawSunY = sinElev;
  const sunDirY = rawSunY > -0.06 ? Math.max(rawSunY, 0.05) : rawSunY;
  out.sunDir.set(cosAzim * 0.62 - 0.18, sunDirY, -0.74).normalize();

  const moonDirY = rawSunY < 0.06 ? Math.max(-rawSunY * 0.85, 0.09) : -0.25;
  out.moonDir.set(-cosAzim * 0.52 + 0.16, moonDirY, -0.78).normalize();

  const dayFactor = THREE.MathUtils.smoothstep(sinElev, -0.18, 0.35);
  const goldenFactor =
    Math.exp(-Math.pow((hours - 6.4) / 1.2, 2)) + Math.exp(-Math.pow((hours - 18.2) / 1.3, 2));
  const clampedGolden = Math.min(1, goldenFactor);

  // Misty daylight woodland palette (#cdd6c5 mist + sage sky) -> golden hour -> deep indigo night
  const nightZenith = new THREE.Color(0x070d1d);
  const dayZenith = new THREE.Color(0x5b829c);
  const goldenZenith = new THREE.Color(0x4b5c7d);

  const nightHorizon = new THREE.Color(0x0f1a2e);
  const dayHorizon = new THREE.Color(0xcdd6c5);
  const goldenHorizon = new THREE.Color(0xdcc29e);

  out.zenith.copy(nightZenith).lerp(dayZenith, dayFactor).lerp(goldenZenith, clampedGolden * 0.55);
  out.horizon.copy(nightHorizon).lerp(dayHorizon, dayFactor).lerp(goldenHorizon, clampedGolden * 0.72);

  const nightSun = new THREE.Color(0x496699);
  const daySun = new THREE.Color(0xfff1d4);
  const goldenSun = new THREE.Color(0xffa45b);
  out.sunColor.copy(nightSun).lerp(daySun, dayFactor).lerp(goldenSun, clampedGolden * 0.85);

  // Overcast & weather mood (driven by precipitation and heavy storm cloud decks)
  const isPrecip = simState.activePrecipKind !== 'none';
  const precipOvercast = isPrecip ? Math.min(0.95, 0.35 + controls.precipIntensity * 0.6) : 0;
  const cloudMood = controls.cloudStyle === 'storm' ? effectiveCoverage * 0.48 : effectiveCoverage * 0.12;
  const overcast = Math.max(precipOvercast, cloudMood);
  out.overcast = overcast;

  if (overcast > 0.01) {
    const stormSky =
      simState.activePrecipKind === 'snow'
        ? new THREE.Color(0xa9bac9).multiplyScalar(0.28 + 0.72 * dayFactor)
        : new THREE.Color(0x5b6b64).multiplyScalar(0.25 + 0.75 * dayFactor);
    const stormHorizon =
      simState.activePrecipKind === 'snow'
        ? new THREE.Color(0xc4d4e3).multiplyScalar(0.30 + 0.70 * dayFactor)
        : new THREE.Color(0x74867c).multiplyScalar(0.28 + 0.72 * dayFactor);

    out.zenith.lerp(stormSky, overcast * 0.85);
    out.horizon.lerp(stormHorizon, overcast * 0.90);
    out.sunColor.multiplyScalar(1 - overcast * 0.55);
  }

  out.hemiSky.copy(out.horizon).lerp(out.zenith, 0.35);
  const snowBounce = simState.snowCoverage * dayFactor;
  out.hemiGround
    .setRGB(0.11 + 0.11 * dayFactor, 0.15 + 0.13 * dayFactor, 0.09 + 0.08 * dayFactor)
    .lerp(new THREE.Color(0x6e849c), snowBounce * 0.64);

  out.fog.copy(out.horizon);
  const baseFog = 0.0112 + (1 - dayFactor) * 0.0024 + clampedGolden * 0.0018;
  const precipFog =
    simState.activePrecipKind === 'snow'
      ? controls.precipIntensity * 0.0078
      : simState.activePrecipKind === 'rain'
        ? controls.precipIntensity * 0.0048
        : 0;
  out.fogDensity = baseFog + precipFog;

  out.mistGlow = dayFactor * (1 - overcast * 0.72);
  out.dappleStrength = THREE.MathUtils.clamp(dayFactor * (1 - precipOvercast * 0.85), 0, 1);
  out.mistOpacity = THREE.MathUtils.clamp(
    (0.18 + clampedGolden * 0.08 + overcast * 0.08) * (0.25 + 0.75 * dayFactor),
    0.04,
    0.34
  );
  const morningSunbeamBoost = 1 + Math.exp(-Math.pow((hours - 9.2) / 2.6, 2)) * 0.55;
  out.sunbeamOpacity = THREE.MathUtils.clamp(
    dayFactor * (1 - precipOvercast * 0.90) * 0.11 * morningSunbeamBoost,
    0,
    0.22
  );

  out.stars = THREE.MathUtils.clamp((1 - dayFactor) * (1 - precipOvercast * 0.85), 0, 1);
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
  renderer.toneMappingExposure = 1.06;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(50, width / height, 0.2, 420);
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.06;
  orbit.maxPolarAngle = Math.PI * 0.495;
  orbit.minDistance = 2;
  orbit.maxDistance = 95;
  orbit.panSpeed = 0.75;

  const setInitialCamera = () => {
    const camX = getTrailCenterX(18) - 0.3;
    const camY = getTerrainHeight(camX, 18) + 1.85;
    const lookX = getTrailCenterX(-12);
    const lookY = getTerrainHeight(lookX, -12) + 3.1;
    camera.position.set(camX, camY, 18);
    orbit.target.set(lookX, lookY, -12);
    orbit.update();
  };
  setInitialCamera();

  // Procedural canvas textures & shared GLSL materials
  const textures = createForestTextures();
  const skyMat = createSkyDomeMaterial();
  const terrainMat = createTerrainMaterial(textures.groundDetailMap);
  const barkMat = createBarkMaterial(textures.barkMap);
  const canopyMat = createCanopyMaterial(textures.leafClusterMap);
  const grassMat = createGrassMaterial(textures.grassTuftMap);
  const fernMat = createFernMaterial(textures.fernFrondMap);
  const rockMat = createRockMaterial();
  const mistMat = createVolumetricMistMaterial();
  const sunbeamMat = createSunbeamMaterial();
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

  // Terrain (260x260 m, 160x160 segments)
  const terrainGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 160, 160);
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
  const startCamX = getTrailCenterX(18) - 0.3;

  const isNearCameraStart = (x: number, z: number, minRadius = 2.4): boolean => {
    const dx = x - startCamX;
    const dz = z - 18;
    return dx * dx + dz * dz < minRadius * minRadius;
  };

  const sampleWoodlandCoord = (
    maxTrailFactor: number,
    trailCorridorWeight: number,
    margin: number
  ): { x: number; z: number } => {
    const usable = HALF_WORLD - margin;

    if (rng() < trailCorridorWeight) {
      for (let attempt = 0; attempt < 16; attempt++) {
        const z = -68 + rng() * 98;
        const side = rng() < 0.5 ? -1 : 1;
        const offset = 3.2 + rng() * 14.0;
        const x = THREE.MathUtils.clamp(getTrailCenterX(z) + side * offset, -usable, usable);
        if (getTrailFactor(x, z) < maxTrailFactor && !isNearCameraStart(x, z, 3.8)) {
          return { x, z };
        }
      }
    }

    for (let attempt = 0; attempt < 24; attempt++) {
      const x = (rng() * 2 - 1) * usable;
      const z = (rng() * 2 - 1) * usable;
      if (getTrailFactor(x, z) < maxTrailFactor && !isNearCameraStart(x, z, 3.8)) {
        return { x, z };
      }
    }

    const fallbackZ = (rng() * 2 - 1) * usable;
    const side = rng() < 0.5 ? -1 : 1;
    const fallbackX = THREE.MathUtils.clamp(getTrailCenterX(fallbackZ) + side * 6.5, -usable, usable);
    return { x: fallbackX, z: fallbackZ };
  };

  // 1. Three Realistic Deciduous Tree Archetypes (1,900 trees total)
  const oakGeo = buildOakArchetype();
  const oakTrunks = new THREE.InstancedMesh(oakGeo.trunk, barkMat, OAK_COUNT);
  const oakCrowns = new THREE.InstancedMesh(oakGeo.crown, canopyMat, OAK_COUNT);

  for (let i = 0; i < OAK_COUNT; i++) {
    const { x, z } = sampleWoodlandCoord(0.04, 0.22, 6);
    const y = getTerrainHeight(x, z) - 0.14;
    const scaleH = 0.80 + rng() * 0.50;
    const scaleW = scaleH * (0.88 + rng() * 0.24);

    dummy.position.set(x, y, z);
    dummy.rotation.set((rng() - 0.5) * 0.08, rng() * Math.PI * 2, (rng() - 0.5) * 0.08);
    dummy.scale.set(scaleW, scaleH, scaleW);
    dummy.updateMatrix();

    oakTrunks.setMatrixAt(i, dummy.matrix);
    oakCrowns.setMatrixAt(i, dummy.matrix);

    const barkTone = 0.88 + rng() * 0.22;
    tmpColor.setRGB(barkTone * 1.04, barkTone * 0.98, barkTone * 0.90);
    oakTrunks.setColorAt(i, tmpColor);

    const hue = 0.23 + rng() * 0.09;
    const sat = 0.38 + rng() * 0.24;
    const light = 0.44 + rng() * 0.18;
    tmpColor.setHSL(hue, sat, light);
    oakCrowns.setColorAt(i, tmpColor);
  }
  oakTrunks.instanceMatrix.needsUpdate = true;
  oakCrowns.instanceMatrix.needsUpdate = true;
  if (oakTrunks.instanceColor) oakTrunks.instanceColor.needsUpdate = true;
  if (oakCrowns.instanceColor) oakCrowns.instanceColor.needsUpdate = true;
  scene.add(oakTrunks, oakCrowns);

  const birchGeo = buildBirchArchetype();
  const birchTrunks = new THREE.InstancedMesh(birchGeo.trunk, barkMat, BIRCH_COUNT);
  const birchCrowns = new THREE.InstancedMesh(birchGeo.crown, canopyMat, BIRCH_COUNT);

  for (let i = 0; i < BIRCH_COUNT; i++) {
    const { x, z } = sampleWoodlandCoord(0.04, 0.26, 6);
    const y = getTerrainHeight(x, z) - 0.12;
    const scaleH = 0.78 + rng() * 0.48;
    const scaleW = scaleH * (0.85 + rng() * 0.25);

    dummy.position.set(x, y, z);
    dummy.rotation.set((rng() - 0.5) * 0.10, rng() * Math.PI * 2, (rng() - 0.5) * 0.10);
    dummy.scale.set(scaleW, scaleH, scaleW);
    dummy.updateMatrix();

    birchTrunks.setMatrixAt(i, dummy.matrix);
    birchCrowns.setMatrixAt(i, dummy.matrix);

    // Lighter grey/silver birch bark via instanceColor (>1.15 triggers papery silver-white bark shader)
    const silver = 1.68 + rng() * 0.30;
    tmpColor.setRGB(silver, silver * 0.99, silver * 0.97);
    birchTrunks.setColorAt(i, tmpColor);

    const variant = rng();
    if (variant < 0.78) {
      tmpColor.setHSL(0.22 + rng() * 0.08, 0.44 + rng() * 0.22, 0.50 + rng() * 0.18);
    } else {
      // Sunlit golden-lime birch canopy accent
      tmpColor.setHSL(0.15 + rng() * 0.05, 0.52 + rng() * 0.20, 0.54 + rng() * 0.16);
    }
    birchCrowns.setColorAt(i, tmpColor);
  }
  birchTrunks.instanceMatrix.needsUpdate = true;
  birchCrowns.instanceMatrix.needsUpdate = true;
  if (birchTrunks.instanceColor) birchTrunks.instanceColor.needsUpdate = true;
  if (birchCrowns.instanceColor) birchCrowns.instanceColor.needsUpdate = true;
  scene.add(birchTrunks, birchCrowns);

  const oldGrowthGeo = buildOldGrowthArchetype();
  const oldGrowthTrunks = new THREE.InstancedMesh(oldGrowthGeo.trunk, barkMat, OLD_GROWTH_COUNT);
  const oldGrowthCrowns = new THREE.InstancedMesh(oldGrowthGeo.crown, canopyMat, OLD_GROWTH_COUNT);

  // Curated picturesque leaning trees flanking both sides of the winding trail corridor
  const heroTrailTrees: { z: number; side: -1 | 1; dist: number; yawOffset: number; scale: number }[] = [
    { z: 12.2, side: -1, dist: 3.45, yawOffset: 0.18, scale: 1.08 },
    { z: 7.4, side: 1, dist: 3.55, yawOffset: Math.PI - 0.22, scale: 1.14 },
    { z: 1.5, side: -1, dist: 3.60, yawOffset: 0.12, scale: 1.05 },
    { z: -5.2, side: 1, dist: 3.50, yawOffset: Math.PI + 0.15, scale: 1.18 },
    { z: -13.0, side: -1, dist: 3.65, yawOffset: -0.15, scale: 1.12 },
    { z: -21.5, side: 1, dist: 3.70, yawOffset: Math.PI - 0.10, scale: 1.22 },
  ];

  for (let i = 0; i < OLD_GROWTH_COUNT; i++) {
    let x = 0;
    let z = 0;
    let scaleH = 0.85 + rng() * 0.48;
    let yaw = rng() * Math.PI * 2;

    if (i < heroTrailTrees.length) {
      const h = heroTrailTrees[i];
      z = h.z;
      let dist = h.dist;
      x = getTrailCenterX(z) + h.side * dist;
      while (getTrailFactor(x, z) >= 0.04) {
        dist += 0.35;
        x = getTrailCenterX(z) + h.side * dist;
      }
      scaleH = h.scale;
      yaw = h.yawOffset;
    } else {
      const sampled = sampleWoodlandCoord(0.04, 0.30, 7);
      x = sampled.x;
      z = sampled.z;
    }

    const y = getTerrainHeight(x, z) - 0.18;
    const scaleW = scaleH * (0.92 + rng() * 0.22);

    dummy.position.set(x, y, z);
    dummy.rotation.set((rng() - 0.5) * 0.08, yaw, (rng() - 0.5) * 0.08);
    dummy.scale.set(scaleW, scaleH, scaleW);
    dummy.updateMatrix();

    oldGrowthTrunks.setMatrixAt(i, dummy.matrix);
    oldGrowthCrowns.setMatrixAt(i, dummy.matrix);

    const tone = 0.78 + rng() * 0.20;
    tmpColor.setRGB(tone * 0.96, tone * 0.94, tone * 0.88);
    oldGrowthTrunks.setColorAt(i, tmpColor);

    tmpColor.setHSL(0.25 + rng() * 0.09, 0.42 + rng() * 0.22, 0.40 + rng() * 0.18);
    oldGrowthCrowns.setColorAt(i, tmpColor);
  }
  oldGrowthTrunks.instanceMatrix.needsUpdate = true;
  oldGrowthCrowns.instanceMatrix.needsUpdate = true;
  if (oldGrowthTrunks.instanceColor) oldGrowthTrunks.instanceColor.needsUpdate = true;
  if (oldGrowthCrowns.instanceColor) oldGrowthCrowns.instanceColor.needsUpdate = true;
  scene.add(oldGrowthTrunks, oldGrowthCrowns);

  // 2. Arched Pinnate Fern Carpet (4,200 rosettes, lush along trail banks)
  const fernGeo = buildFernRosetteGeometry();
  const fernMesh = new THREE.InstancedMesh(fernGeo, fernMat, FERN_COUNT);

  for (let i = 0; i < FERN_COUNT; i++) {
    let x = 0;
    let z = 0;

    if (i < FERN_COUNT * 0.58) {
      // Lush mossy trail-bank carpet
      for (let attempt = 0; attempt < 12; attempt++) {
        z = -72 + rng() * 100;
        const side = rng() < 0.5 ? -1 : 1;
        const dist = 1.9 + Math.pow(rng(), 1.45) * 8.5;
        x = THREE.MathUtils.clamp(getTrailCenterX(z) + side * dist, -HALF_WORLD + 5, HALF_WORLD - 5);
        if (getTrailFactor(x, z) < 0.34) break;
      }
    } else {
      const rBias = rng() < 0.3 ? 42 : HALF_WORLD - 6;
      for (let attempt = 0; attempt < 8; attempt++) {
        x = (rng() * 2 - 1) * rBias;
        z = (rng() * 2 - 1) * rBias;
        if (getTrailFactor(x, z) < 0.36) break;
      }
    }

    const y = getTerrainHeight(x, z) - 0.02;
    const s = 0.72 + rng() * 0.78;

    dummy.position.set(x, y, z);
    dummy.rotation.set((rng() - 0.5) * 0.12, rng() * Math.PI * 2, (rng() - 0.5) * 0.12);
    dummy.scale.set(s, s * (0.85 + rng() * 0.30), s);
    dummy.updateMatrix();
    fernMesh.setMatrixAt(i, dummy.matrix);

    tmpColor.setHSL(0.25 + rng() * 0.08, 0.30 + rng() * 0.22, 0.62 + rng() * 0.28);
    fernMesh.setColorAt(i, tmpColor);
  }
  fernMesh.instanceMatrix.needsUpdate = true;
  if (fernMesh.instanceColor) fernMesh.instanceColor.needsUpdate = true;
  scene.add(fernMesh);

  // 3. Fine Grass Meadows (26,000 tufts, omitted from dirt trail center: getTrailFactor < 0.45)
  const grassGeo = buildGrassTuftGeometry();
  const grassMesh = new THREE.InstancedMesh(grassGeo, grassMat, GRASS_COUNT);

  for (let i = 0; i < GRASS_COUNT; i++) {
    let x = 0;
    let z = 0;
    const bankBias = rng();

    if (bankBias < 0.40) {
      // Dense grass meadow bordering the trail corridor
      for (let attempt = 0; attempt < 10; attempt++) {
        z = -68 + rng() * 98;
        const side = rng() < 0.5 ? -1 : 1;
        const offset = 1.7 + Math.pow(rng(), 1.35) * 14.0;
        x = THREE.MathUtils.clamp(getTrailCenterX(z) + side * offset, -HALF_WORLD + 5, HALF_WORLD - 5);
        if (getTrailFactor(x, z) < 0.45) break;
      }
    } else {
      const rBias = rng() < 0.35 ? 48 : HALF_WORLD - 5;
      for (let attempt = 0; attempt < 8; attempt++) {
        x = (rng() * 2 - 1) * rBias;
        z = (rng() * 2 - 1) * rBias;
        if (getTrailFactor(x, z) < 0.45) break;
      }
      if (getTrailFactor(x, z) >= 0.45) {
        x = getTrailCenterX(z) + (rng() < 0.5 ? -3.4 : 3.4);
      }
    }

    const y = getTerrainHeight(x, z) - 0.025;
    const sx = 0.72 + rng() * 0.72;
    const sy = 0.68 + rng() * 0.88;

    dummy.position.set(x, y, z);
    dummy.rotation.set((rng() - 0.5) * 0.14, rng() * Math.PI * 2, (rng() - 0.5) * 0.14);
    dummy.scale.set(sx, sy, sx);
    dummy.updateMatrix();
    grassMesh.setMatrixAt(i, dummy.matrix);

    tmpColor.setHSL(0.22 + rng() * 0.09, 0.28 + rng() * 0.24, 0.64 + rng() * 0.28);
    grassMesh.setColorAt(i, tmpColor);
  }
  grassMesh.instanceMatrix.needsUpdate = true;
  if (grassMesh.instanceColor) grassMesh.instanceColor.needsUpdate = true;
  scene.add(grassMesh);

  // 4. Smooth High-Subdivision Mossy Boulders (180 instances, including foreground hero bank rocks)
  const rockGeo = buildRockGeometry();
  const rockMesh = new THREE.InstancedMesh(rockGeo, rockMat, ROCK_COUNT);

  const heroRocks = [
    { z: 12.6, side: 1, dist: 2.35, sx: 1.05, sy: 0.72, sz: 0.95 },
    { z: 8.8, side: -1, dist: 2.45, sx: 1.25, sy: 0.86, sz: 1.15 },
    { z: 3.2, side: 1, dist: 2.65, sx: 0.92, sy: 0.64, sz: 0.88 },
  ];

  for (let i = 0; i < ROCK_COUNT; i++) {
    let x = 0;
    let z = 0;
    let sx = 0.55 + rng() * 1.35;
    let sy = 0.45 + rng() * 0.95;
    let sz = 0.55 + rng() * 1.35;

    if (i < heroRocks.length) {
      const hr = heroRocks[i];
      z = hr.z;
      x = getTrailCenterX(z) + hr.side * hr.dist;
      sx = hr.sx;
      sy = hr.sy;
      sz = hr.sz;
    } else {
      const sampled = sampleWoodlandCoord(0.24, 0.34, 8);
      x = sampled.x;
      z = sampled.z;
    }

    const y = getTerrainHeight(x, z) - sy * 0.28;
    dummy.position.set(x, y, z);
    dummy.rotation.set((rng() - 0.5) * 0.28, rng() * Math.PI * 2, (rng() - 0.5) * 0.28);
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    rockMesh.setMatrixAt(i, dummy.matrix);

    const tone = 0.36 + rng() * 0.16;
    tmpColor.setRGB(tone * 0.96, tone * 0.98, tone * 1.02);
    rockMesh.setColorAt(i, tmpColor);
  }
  rockMesh.instanceMatrix.needsUpdate = true;
  if (rockMesh.instanceColor) rockMesh.instanceColor.needsUpdate = true;
  scene.add(rockMesh);

  // 5. Subtle Volumetric Mist Ribbons & Canopy Sunbeams
  const mistGeo = new THREE.PlaneGeometry(24, 9.5);
  const mistMesh = new THREE.InstancedMesh(mistGeo, mistMat, MIST_PLANE_COUNT);
  mistMesh.frustumCulled = false;

  for (let i = 0; i < MIST_PLANE_COUNT; i++) {
    const z = -65 + (i / MIST_PLANE_COUNT) * 78 + (rng() - 0.5) * 8;
    const x = getTrailCenterX(z) + (rng() - 0.5) * 34;
    const y = getTerrainHeight(x, z) + 2.2 + rng() * 3.8;
    const scale = 0.85 + rng() * 0.9;

    dummy.position.set(x, y, z);
    dummy.rotation.set((rng() - 0.5) * 0.14, (rng() - 0.5) * 0.7, 0);
    dummy.scale.set(scale, scale, 1);
    dummy.updateMatrix();
    mistMesh.setMatrixAt(i, dummy.matrix);
  }
  mistMesh.instanceMatrix.needsUpdate = true;
  scene.add(mistMesh);

  const sunbeamPlaneA = new THREE.PlaneGeometry(5.5, 22);
  const sunbeamPlaneB = new THREE.PlaneGeometry(5.5, 22);
  sunbeamPlaneB.rotateY(Math.PI * 0.45);
  const sunbeamGeo = normalizeAndMerge([sunbeamPlaneA, sunbeamPlaneB]);
  const sunbeamMesh = new THREE.InstancedMesh(sunbeamGeo, sunbeamMat, SUNBEAM_COUNT);
  sunbeamMesh.frustumCulled = false;
  scene.add(sunbeamMesh);

  const sunbeamAnchors: { x: number; y: number; z: number; yaw: number; scale: number }[] = [];
  for (let i = 0; i < SUNBEAM_COUNT; i++) {
    const z = -56 + (i / SUNBEAM_COUNT) * 66 + (rng() - 0.5) * 4;
    const x = getTrailCenterX(z) + (rng() - 0.5) * 14;
    const y = getTerrainHeight(x, z) + 7.5;
    sunbeamAnchors.push({
      x,
      y,
      z,
      yaw: (rng() - 0.5) * 0.9,
      scale: 0.75 + rng() * 0.65,
    });
  }

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
    moonDir: new THREE.Vector3(),
    sunColor: new THREE.Color(),
    zenith: new THREE.Color(),
    horizon: new THREE.Color(),
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    fog: new THREE.Color(),
    fogDensity: 0.0112,
    mistGlow: 0.65,
    dappleStrength: 0.85,
    mistOpacity: 0.22,
    sunbeamOpacity: 0.12,
    overcast: 0,
    stars: 0,
    fireflies: 0,
  };

  const lightingMaterials = [terrainMat, barkMat, canopyMat, grassMat, fernMat, rockMat];
  const dappleMaterials = [terrainMat, grassMat, fernMat, rockMat];
  const forestLightDir = new THREE.Vector3();
  let elapsedTime = 0;
  let cloudTime = 0;
  let smoothedSunTransmission = 1;

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
        const speed = pressedKeys.has('shift') ? 18 : 9.5;
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

    const minGroundY = getTerrainHeight(camera.position.x, camera.position.z) + 1.35;
    if (camera.position.y < minGroundY) {
      camera.position.y = minGroundY;
    }
    skyMesh.position.copy(camera.position);
  };

  const updateSunbeamsOrientation = () => {
    const beamVisible = atmosphere.sunbeamOpacity > 0.005;
    sunbeamMesh.visible = beamVisible;
    if (!beamVisible) return;

    const tiltZ = -atmosphere.sunDir.x * 0.45;
    const tiltX = atmosphere.sunDir.z * 0.25;
    for (let i = 0; i < sunbeamAnchors.length; i++) {
      const a = sunbeamAnchors[i];
      dummy.position.set(a.x, a.y, a.z);
      dummy.rotation.set(tiltX, a.yaw, tiltZ);
      dummy.scale.set(a.scale, 1, 1);
      dummy.updateMatrix();
      sunbeamMesh.setMatrixAt(i, dummy.matrix);
    }
    sunbeamMesh.instanceMatrix.needsUpdate = true;
  };

  const update = (dtSec: number, controls: LivingWorldControls, simState: LivingWorldSimState) => {
    const safeDt = Math.min(0.1, Math.max(0, dtSec));
    elapsedTime += safeDt;
    cloudTime += safeDt * (0.45 + controls.windStrength * 1.85);

    const effectiveCoverage = THREE.MathUtils.clamp(
      Math.max(controls.cloudCoverage, simState.activePrecipKind === 'none' ? 0 : 0.78),
      0,
      1
    );
    const styleIndex = CLOUD_STYLE_INDEX[controls.cloudStyle];

    updateCameraWalk(safeDt);
    computeAtmosphere(controls, simState, effectiveCoverage, atmosphere);

    const rawTransmission = evaluateSunCloudTransmission(
      atmosphere.sunDir.x,
      atmosphere.sunDir.y,
      atmosphere.sunDir.z,
      camera.position.x,
      camera.position.z,
      cloudTime,
      effectiveCoverage,
      controls.cloudStyle
    );
    const transLerp = 1 - Math.exp(-safeDt * 2.5);
    smoothedSunTransmission = THREE.MathUtils.lerp(
      smoothedSunTransmission,
      rawTransmission,
      transLerp
    );

    // Modulate sun intensity, canopy dapple, mist forward-scatter, and crepuscular god-rays
    atmosphere.sunColor.multiplyScalar(0.38 + 0.62 * smoothedSunTransmission);
    atmosphere.dappleStrength *= smoothedSunTransmission;
    atmosphere.mistGlow *= 0.25 + 0.75 * smoothedSunTransmission;

    const crepuscularSurge =
      1 +
      0.85 *
        Math.sin(
          THREE.MathUtils.clamp((smoothedSunTransmission - 0.25) / 0.72, 0, 1) * Math.PI
        );
    const overcastBeamFade = THREE.MathUtils.smoothstep(smoothedSunTransmission, 0.12, 0.42);
    atmosphere.sunbeamOpacity = THREE.MathUtils.clamp(
      atmosphere.sunbeamOpacity * crepuscularSurge * overcastBeamFade,
      0,
      0.24
    );

    const dayLightBlend = THREE.MathUtils.smoothstep(atmosphere.sunDir.y, -0.02, 0.06);
    forestLightDir.copy(atmosphere.moonDir).lerp(atmosphere.sunDir, dayLightBlend).normalize();

    for (const mat of lightingMaterials) {
      mat.uniforms.uSunDir.value.copy(forestLightDir);
      mat.uniforms.uSunColor.value.copy(atmosphere.sunColor);
      mat.uniforms.uHemisphereSky.value.copy(atmosphere.hemiSky);
      mat.uniforms.uHemisphereGround.value.copy(atmosphere.hemiGround);
      mat.uniforms.uFogColor.value.copy(atmosphere.fog);
      mat.uniforms.uFogDensity.value = atmosphere.fogDensity;
      mat.uniforms.uMistGlow.value = atmosphere.mistGlow;
      mat.uniforms.uTime.value = elapsedTime;
      mat.uniforms.uWetness.value = simState.wetness;
      mat.uniforms.uCloudTime.value = cloudTime;
      mat.uniforms.uCloudCoverage.value = effectiveCoverage;
      mat.uniforms.uCloudStyle.value = styleIndex;
      mat.uniforms.uSunTransmission.value = smoothedSunTransmission;
    }

    for (const mat of dappleMaterials) {
      mat.uniforms.uDappleStrength.value = atmosphere.dappleStrength;
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

    mistMat.uniforms.uMistColor.value.copy(atmosphere.fog);
    mistMat.uniforms.uSunColor.value.copy(atmosphere.sunColor);
    mistMat.uniforms.uSunDir.value.copy(forestLightDir);
    mistMat.uniforms.uOpacity.value = atmosphere.mistOpacity;
    mistMat.uniforms.uTime.value = elapsedTime;

    sunbeamMat.uniforms.uSunColor.value.copy(atmosphere.sunColor);
    sunbeamMat.uniforms.uOpacity.value = atmosphere.sunbeamOpacity;
    sunbeamMat.uniforms.uTime.value = elapsedTime;
    updateSunbeamsOrientation();

    skyMat.uniforms.uSunDir.value.copy(atmosphere.sunDir);
    skyMat.uniforms.uMoonDir.value.copy(atmosphere.moonDir);
    skyMat.uniforms.uSunColor.value.copy(atmosphere.sunColor);
    skyMat.uniforms.uZenithColor.value.copy(atmosphere.zenith);
    skyMat.uniforms.uHorizonColor.value.copy(atmosphere.horizon);
    skyMat.uniforms.uOvercast.value = atmosphere.overcast;
    skyMat.uniforms.uStarsIntensity.value = atmosphere.stars;
    skyMat.uniforms.uTime.value = elapsedTime;
    skyMat.uniforms.uCloudTime.value = cloudTime;
    skyMat.uniforms.uCloudCoverage.value = effectiveCoverage;
    skyMat.uniforms.uCloudStyle.value = styleIndex;
    skyMat.uniforms.uSunTransmission.value = smoothedSunTransmission;

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
    trees: OAK_COUNT + BIRCH_COUNT + OLD_GROWTH_COUNT,
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

    textures.dispose();

    if (renderer.domElement.parentElement === container) {
      container.removeChild(renderer.domElement);
    }
    renderer.dispose();
  };

  const getSunVisibility = (): number =>
    atmosphere.sunDir.y > 0.02 ? smoothedSunTransmission : 0;

  return {
    update,
    resize,
    resetCamera: setInitialCamera,
    getStats,
    getSunVisibility,
    dispose,
  };
}
