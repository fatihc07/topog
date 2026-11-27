import * as THREE from 'three';

const GLSL_NOISE_AND_FOG = /* glsl */ `
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm4(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    v += a * noise2(p);
    p = rot * p * 2.03 + vec2(17.1, 31.7);
    a *= 0.5;
  }
  return v;
}

vec3 safeNormalize(vec3 v, vec3 fallback) {
  float lenSq = dot(v, v);
  return lenSq > 1e-6 ? v * inversesqrt(lenSq) : fallback;
}

float computeDappledSun(vec2 xz, float time, float trailBias, float dappleStrength) {
  vec2 driftA = vec2(time * 0.032, time * 0.018);
  vec2 driftB = vec2(-time * 0.045, time * 0.026);
  float macroCanopy = fbm4(xz * 0.11 + driftA);
  float leafBreakup = noise2(xz * 0.52 + driftB);
  float combined = macroCanopy * 0.72 + leafBreakup * 0.28 + trailBias * 0.24;
  float patchLight = smoothstep(0.38, 0.74, combined);
  return mix(1.0, 0.30 + 0.82 * patchLight, clamp(dappleStrength, 0.0, 1.0));
}

vec3 applyWoodlandMist(
  vec3 color,
  vec3 worldPos,
  vec3 fogColor,
  float fogDensity,
  vec3 sunDir,
  vec3 sunColor,
  float mistGlow
) {
  vec3 toFrag = worldPos - cameraPosition;
  float dist = length(toFrag);
  vec3 viewDir = dist > 1e-4 ? toFrag / dist : vec3(0.0, 0.0, -1.0);

  // Subtle low-lying woodland mist layer denser near forest floor hollows
  float heightMist = exp(-max(worldPos.y - 0.8, 0.0) * 0.075) * 0.24;
  float effDensity = fogDensity * (1.0 + heightMist);
  float fogFactor = 1.0 - exp(-effDensity * effDensity * dist * dist);
  fogFactor = clamp(fogFactor, 0.0, 1.0);

  // Mie-like forward sun scatter inside the misty forest air
  float forwardScatter = pow(clamp(dot(viewDir, sunDir), 0.0, 1.0), 4.0);
  vec3 scatteredMist = mix(fogColor, sunColor * 0.92 + fogColor * 0.25, forwardScatter * mistGlow * 0.42);

  return mix(color, scatteredMist, fogFactor);
}

// Synchronized 1:1 with evaluateCloudDensityAt in forestWeatherPhysics.ts
float sampleWorldCloudLayer(
  vec2 xz,
  float cloudTime,
  float coverage,
  float cloudStyle,
  out float cirrusOut
) {
  float cov = clamp(coverage, 0.0, 1.0);
  if (cov <= 0.005) {
    cirrusOut = 0.0;
    return 0.0;
  }
  float covFade = smoothstep(0.0, 0.06, cov);

  vec2 mainUV = (xz + vec2(cloudTime * 4.5, cloudTime * 2.1)) * 0.0042;
  float baseNoise = fbm4(mainUV);
  float detailNoise = fbm4(mainUV * 2.15 + vec2(11.4, -7.3));

  vec2 cirrusUV = vec2(
    (xz.x + cloudTime * 6.2) * 0.0022 * 0.65,
    (xz.y + cloudTime * 1.4) * 0.0022 * 1.8
  );
  float cirrusWarp = fbm4(cirrusUV * 0.6 + vec2(3.2, -5.1));
  float cirrusNoise = fbm4(cirrusUV + vec2(cirrusWarp * 0.45, -cirrusWarp * 0.25));
  float cirrusThresh = mix(0.72, 0.24, cov);
  float cirrusAlpha = smoothstep(cirrusThresh - 0.08, cirrusThresh + 0.18, cirrusNoise) * covFade;
  cirrusOut = cirrusAlpha;

  if (cloudStyle > 1.5 && cloudStyle < 2.5) {
    // 'cirrus' (2)
    return 0.0;
  }

  if (cloudStyle >= 2.5) {
    // 'storm' (3)
    float stormShape = baseNoise * 0.65 + detailNoise * 0.35;
    float thresh = mix(0.68, 0.14, cov);
    float mainDensity = smoothstep(thresh - 0.10, thresh + 0.16, stormShape) * (0.86 + 0.14 * cov) * covFade;
    return clamp(mainDensity, 0.0, 1.0);
  }

  float mainShape = baseNoise * 0.72 + detailNoise * 0.28;
  if (cloudStyle >= 0.5) {
    // 'partly' (1)
    float thresh = mix(0.79, 0.30, cov);
    float mainDensity = smoothstep(thresh - 0.06, thresh + 0.16, mainShape) * 0.88 * covFade;
    return clamp(mainDensity, 0.0, 1.0);
  }

  // 'cumulus' (0)
  float thresh = mix(0.75, 0.22, cov);
  float mainDensity = smoothstep(thresh - 0.07, thresh + 0.14, mainShape) * covFade;
  return clamp(mainDensity, 0.0, 1.0);
}

float computeCloudDirectMask(
  vec2 worldXZ,
  vec3 L,
  float cloudTime,
  float coverage,
  float cloudStyle,
  float sunTransmission
) {
  vec2 shadowXZ = worldXZ + (L.xz / max(L.y, 0.20)) * 180.0;
  float cirrusShadow = 0.0;
  float mainShadow = sampleWorldCloudLayer(shadowXZ, cloudTime, coverage, cloudStyle, cirrusShadow);
  float cirrusWeight = cloudStyle > 1.5 && cloudStyle < 2.5
    ? 0.48
    : (cloudStyle >= 2.5 ? 0.0 : (cloudStyle >= 0.5 ? 0.24 : 0.12));
  float cloudShadow = clamp(mainShadow + cirrusShadow * cirrusWeight * (1.0 - mainShadow), 0.0, 1.0);
  return mix(1.0, 0.22, clamp(cloudShadow * 1.15, 0.0, 1.0)) * mix(0.42, 1.0, clamp(sunTransmission, 0.0, 1.0));
}
`;

const GLSL_NOISE_AND_COLSPACE = /* glsl */ `
vec3 srgbToLinear(vec3 c) {
  return pow(max(c, vec3(0.0)), vec3(2.2));
}
`;

export interface PbrMaterialHandle<T extends THREE.Material = THREE.MeshStandardMaterial> {
  material: T;
  uniforms: Record<string, THREE.IUniform>;
}

export interface TerrainTextureInputs {
  groundDetailMap: THREE.Texture;
  groundNormalMap: THREE.Texture;
  groundRoughnessMap: THREE.Texture;
}

export interface BarkMaterialInputs {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap?: THREE.Texture;
  isBirch?: boolean;
}

export function createPbrTerrainMaterial(textures: TerrainTextureInputs): PbrMaterialHandle {
  textures.groundNormalMap.repeat.set(64, 64);
  textures.groundRoughnessMap.repeat.set(64, 64);

  const uniforms: Record<string, THREE.IUniform> = {
    uGroundDetailMap: { value: textures.groundDetailMap },
    uSunDir: { value: new THREE.Vector3(0.45, 0.72, -0.52).normalize() },
    uDappleStrength: { value: 0.65 },
    uSnowDepth: { value: 0 },
    uSnowCoverage: { value: 0 },
    uWetness: { value: 0.08 },
    uTime: { value: 0 },
    uCloudTime: { value: 0 },
    uCloudCoverage: { value: 0.48 },
    uCloudStyle: { value: 0 },
    uSunTransmission: { value: 1 },
  };

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    normalMap: textures.groundNormalMap,
    normalScale: new THREE.Vector2(1.25, 1.25),
    roughnessMap: textures.groundRoughnessMap,
    roughness: 0.92,
    metalness: 0.0,
    envMapIntensity: 0.75,
  });

  material.customProgramCacheKey = () => 'topog-pbr-terrain-v1';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform float uSnowDepth;
        varying vec3 vCustomWorldPos;
        varying vec3 vCustomWorldNormal;
        `
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        vec3 baseWorldNormal = normalize(mat3(modelMatrix) * normal);
        float snowFlat = smoothstep(0.32, 0.92, baseWorldNormal.y);
        transformed.y += min(uSnowDepth * 0.0055, 0.35) * snowFlat;
        `
      )
      .replace(
        '#include <project_vertex>',
        /* glsl */ `
        #include <project_vertex>
        vec4 cWorldPos = modelMatrix * vec4(transformed, 1.0);
        vCustomWorldPos = cWorldPos.xyz;
        vCustomWorldNormal = baseWorldNormal;
        `
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        ${GLSL_NOISE_AND_FOG}
        ${GLSL_NOISE_AND_COLSPACE}
        uniform sampler2D uGroundDetailMap;
        uniform vec3 uSunDir;
        uniform float uDappleStrength;
        uniform float uSnowDepth;
        uniform float uSnowCoverage;
        uniform float uWetness;
        uniform float uTime;
        uniform float uCloudTime;
        uniform float uCloudCoverage;
        uniform float uCloudStyle;
        uniform float uSunTransmission;
        varying vec3 vCustomWorldPos;
        varying vec3 vCustomWorldNormal;
        `
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        #include <map_fragment>
        vec2 tXZ = vCustomWorldPos.xz;
        vec3 geoN = safeNormalize(vCustomWorldNormal, vec3(0.0, 1.0, 0.0));
        float tMacro = fbm4(tXZ * 0.055);
        float tMid = fbm4(tXZ * 0.24 + vec2(11.3, 4.7));
        float tMicro = noise2(tXZ * 2.2);

        // Multi-scale soil, bark mulch, fallen leaf & moss detail (already linear via sRGB texture upload)
        vec3 gTexA = texture2D(uGroundDetailMap, tXZ * 0.26).rgb;
        vec3 gTexB = texture2D(uGroundDetailMap, tXZ * 0.68 + vec2(0.37, 0.71)).rgb;
        vec3 gDetail = mix(gTexA, gTexB, 0.42);
        vec3 detailBoost = clamp((gDetail - vec3(0.08)) * 1.9 + vec3(0.88), vec3(0.55), vec3(1.55));

        // Winding dirt footpath matching getTrailCenterX / getTrailFactor
        float trailCenterX = sin(tXZ.y * 0.075) * 3.6 + sin(tXZ.y * 0.028 + 0.8) * 2.1;
        float dxdz = 3.6 * 0.075 * cos(tXZ.y * 0.075) + 2.1 * 0.028 * cos(tXZ.y * 0.028 + 0.8);
        float perpScale = inversesqrt(1.0 + dxdz * dxdz);
        float trailEdgeNoise = (fbm4(tXZ * 0.35 + vec2(7.1, -3.4)) - 0.5) * 0.55;
        float trailDist = abs(tXZ.x - trailCenterX) * perpScale + trailEdgeNoise;
        float trailMask = 1.0 - smoothstep(1.1, 2.5, trailDist);
        float trailCore = 1.0 - smoothstep(0.35, 1.35, trailDist);

        // Linear woodland floor palette
        vec3 mossDeep = srgbToLinear(vec3(0.14, 0.25, 0.11));
        vec3 mossEmerald = srgbToLinear(vec3(0.24, 0.39, 0.16));
        vec3 mossCol = mix(mossDeep, mossEmerald, smoothstep(0.25, 0.78, tMid));

        vec3 humus = srgbToLinear(vec3(0.25, 0.17, 0.11));
        float humusMask = smoothstep(0.45, 0.75, tMacro + (tMicro - 0.5) * 0.22);
        vec3 woodlandFloor = mix(mossCol, humus, humusMask * 0.62) * detailBoost;

        vec3 trailCenterCol = srgbToLinear(vec3(0.52, 0.38, 0.23));
        vec3 trailShoulderCol = srgbToLinear(vec3(0.34, 0.25, 0.15));
        vec3 trailDirt = mix(trailShoulderCol, trailCenterCol, trailCore * 0.85 + 0.15 * tMid);
        trailDirt *= clamp(gDetail * 2.4 + vec3(0.65), vec3(0.75), vec3(1.30));
        float pebble = hash21(floor(tXZ * 9.5));
        trailDirt *= mix(0.90, 1.14, smoothstep(0.75, 0.98, pebble));

        vec3 floorCol = mix(woodlandFloor, trailDirt, trailMask);

        float slope = 1.0 - smoothstep(0.58, 0.88, geoN.y);
        vec3 rockBase = srgbToLinear(vec3(0.33, 0.35, 0.37)) * (0.78 + 0.42 * tMid);
        vec3 groundAlbedo = mix(floorCol, rockBase, clamp(slope * 1.12, 0.0, 1.0));

        // Rain puddle & damp dark soil
        float puddleNoise = smoothstep(0.44, 0.78, tMid) * (1.0 - slope * 0.75);
        float trailPuddle = trailCore * smoothstep(0.40, 0.72, noise2(tXZ * 0.65));
        float wetAmount = clamp(uWetness * (0.62 + 0.48 * puddleNoise + 0.32 * trailPuddle), 0.0, 1.0);
        groundAlbedo *= mix(1.0, 0.52, wetAmount);

        // Snow accumulation blanket
        float snowNoise = fbm4(tXZ * 0.085 + vec2(3.1, 8.9)) * 0.65 + tMicro * 0.35;
        float cliffResistance = (1.0 - smoothstep(0.42, 0.86, geoN.y)) * 0.48;
        float depthFactor = clamp(uSnowDepth / 18.0, 0.0, 1.0);
        float warmHollow = (1.0 - smoothstep(-1.5, 4.5, vCustomWorldPos.y)) * 0.08 * (1.0 - depthFactor * 0.6);
        float snowField = uSnowCoverage * 1.18 - snowNoise * 0.34 - cliffResistance - warmHollow;
        float snowMask = smoothstep(0.02, 0.24, snowField) * smoothstep(0.0, 0.06, uSnowCoverage);

        vec3 snowAlbedo = mix(srgbToLinear(vec3(0.82, 0.89, 0.98)), srgbToLinear(vec3(0.95, 0.97, 1.0)), smoothstep(0.35, 0.85, geoN.y));
        diffuseColor.rgb = mix(groundAlbedo, snowAlbedo, snowMask);
        `
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
        #include <roughnessmap_fragment>
        // Drop roughness dramatically in rainwater puddles; crystalline satin in snow
        float puddleMask = smoothstep(0.48, 0.82, fbm4(vCustomWorldPos.xz * 0.24 + vec2(11.3, 4.7)));
        float puddleRough = mix(0.34, 0.08, puddleMask) * clamp(uWetness, 0.0, 1.0);
        roughnessFactor = mix(roughnessFactor, 0.14, clamp(uWetness * (0.55 + 0.45 * puddleMask), 0.0, 0.92));
        roughnessFactor = mix(roughnessFactor, 0.58, snowMask);
        roughnessFactor = clamp(min(roughnessFactor, mix(1.0, puddleRough + 0.06, clamp(uWetness, 0.0, 1.0) * (1.0 - snowMask))), 0.06, 0.98);
        `
      )
      .replace(
        '#include <lights_fragment_end>',
        /* glsl */ `
        #include <lights_fragment_end>
        vec3 sunDirL = safeNormalize(uSunDir, vec3(0.0, 1.0, 0.0));
        float cloudMask = computeCloudDirectMask(vCustomWorldPos.xz, sunDirL, uCloudTime, uCloudCoverage, uCloudStyle, uSunTransmission);
        float dapple = computeDappledSun(vCustomWorldPos.xz, uTime, trailMask, uDappleStrength);
        reflectedLight.directDiffuse *= cloudMask * dapple;
        reflectedLight.directSpecular *= cloudMask * dapple;
        reflectedLight.indirectDiffuse *= mix(1.22, 1.0, cloudMask);
        `
      );
  };

  return { material, uniforms };
}

export function createPbrBarkMaterial(inputs: BarkMaterialInputs): PbrMaterialHandle {
  const { map, normalMap, roughnessMap, isBirch = false } = inputs;
  map.repeat.set(2, 4.5);
  normalMap.repeat.set(2, 4.5);
  if (roughnessMap) {
    roughnessMap.repeat.set(2, 4.5);
  }

  const uniforms: Record<string, THREE.IUniform> = {
    uSunDir: { value: new THREE.Vector3(0.45, 0.72, -0.52).normalize() },
    uTime: { value: 0 },
    uWindStrength: { value: 0.25 },
    uCanopySnow: { value: 0 },
    uWetness: { value: 0.08 },
    uCloudTime: { value: 0 },
    uCloudCoverage: { value: 0.48 },
    uCloudStyle: { value: 0 },
    uSunTransmission: { value: 1 },
  };

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map,
    normalMap,
    normalScale: new THREE.Vector2(isBirch ? 1.25 : 1.7, isBirch ? 1.25 : 1.7),
    roughnessMap: roughnessMap ?? null,
    roughness: isBirch ? 0.72 : 0.92,
    metalness: 0.0,
    envMapIntensity: isBirch ? 0.85 : 0.72,
  });

  material.customProgramCacheKey = () =>
    isBirch ? 'topog-pbr-birch-bark-v1' : 'topog-pbr-oak-bark-v1';

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform float uTime;
        uniform float uWindStrength;
        varying vec3 vCustomWorldPos;
        varying vec3 vCustomWorldNormal;
        varying float vLocalHeight;
        `
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        vLocalHeight = max(position.y, 0.0);
        #ifdef USE_INSTANCING
          vec4 barkInstPos = instanceMatrix * vec4(transformed, 1.0);
          vec3 barkBasePos = instanceMatrix[3].xyz;
          float barkH = max(barkInstPos.y - barkBasePos.y, 0.0);
          float barkPhase = barkBasePos.x * 0.23 + barkBasePos.z * 0.19;
          float barkSway = (barkH * barkH * 0.0014) * uWindStrength;
          vec3 worldOffset = vec3(
            barkSway * (sin(uTime * 1.25 + barkPhase) + 0.35 * sin(uTime * 2.6 + barkPhase * 1.7)),
            0.0,
            barkSway * 0.65 * cos(uTime * 1.05 + barkPhase * 1.3)
          );
          transformed += mat3(inverse(instanceMatrix)) * worldOffset;
        #endif
        `
      )
      .replace(
        '#include <project_vertex>',
        /* glsl */ `
        #include <project_vertex>
        vec4 cWorldPos = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          cWorldPos = instanceMatrix * cWorldPos;
        #endif
        cWorldPos = modelMatrix * cWorldPos;
        vCustomWorldPos = cWorldPos.xyz;
        vec3 cObjNorm = vec3(normal);
        #ifdef USE_INSTANCING
          cObjNorm = mat3(instanceMatrix) * cObjNorm;
        #endif
        vCustomWorldNormal = normalize(mat3(modelMatrix) * cObjNorm);
        `
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        ${GLSL_NOISE_AND_FOG}
        ${GLSL_NOISE_AND_COLSPACE}
        uniform vec3 uSunDir;
        uniform float uCanopySnow;
        uniform float uWetness;
        uniform float uCloudTime;
        uniform float uCloudCoverage;
        uniform float uCloudStyle;
        uniform float uSunTransmission;
        varying vec3 vCustomWorldPos;
        varying vec3 vCustomWorldNormal;
        varying float vLocalHeight;
        `
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        #include <color_fragment>
        vec3 barkGeoN = safeNormalize(vCustomWorldNormal, vec3(0.0, 1.0, 0.0));
        // Subtle woodland moss creeping up root collar
        float mossNoise = fbm4(vCustomWorldPos.xz * 1.9 + vCustomWorldPos.y * 1.4);
        float rootMoss = smoothstep(2.3, 0.15, vLocalHeight + (mossNoise - 0.5) * 1.1) *
          smoothstep(-0.2, 0.55, barkGeoN.y + 0.25);
        vec3 mossCol = srgbToLinear(vec3(0.16, 0.29, 0.12)) * (0.75 + 0.45 * mossNoise);
        diffuseColor.rgb = mix(diffuseColor.rgb, mossCol, clamp(rootMoss * 0.62, 0.0, 0.72));

        // Wet bark darkening
        diffuseColor.rgb *= mix(1.0, 0.56, clamp(uWetness, 0.0, 1.0));

        // Windward & upward frost/snow dusting
        float windward = clamp(barkGeoN.x * 0.45 + barkGeoN.z * 0.35 + 0.2, 0.0, 1.0);
        float barkSnowDust = smoothstep(0.15, 0.85, barkGeoN.y * 0.75 + windward * 0.55) * uCanopySnow * 0.78;
        diffuseColor.rgb = mix(diffuseColor.rgb, srgbToLinear(vec3(0.88, 0.93, 0.99)), barkSnowDust);
        `
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
        #include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.32, clamp(uWetness, 0.0, 1.0) * (1.0 - barkSnowDust));
        roughnessFactor = mix(roughnessFactor, 0.62, barkSnowDust);
        `
      )
      .replace(
        '#include <lights_fragment_end>',
        /* glsl */ `
        #include <lights_fragment_end>
        vec3 barkSunL = safeNormalize(uSunDir, vec3(0.0, 1.0, 0.0));
        float barkCloudMask = computeCloudDirectMask(vCustomWorldPos.xz, barkSunL, uCloudTime, uCloudCoverage, uCloudStyle, uSunTransmission);
        reflectedLight.directDiffuse *= barkCloudMask;
        reflectedLight.directSpecular *= barkCloudMask;
        reflectedLight.indirectDiffuse *= mix(1.22, 1.0, barkCloudMask);
        `
      );
  };

  return { material, uniforms };
}

export function createBarkDepthMaterial(): PbrMaterialHandle<THREE.MeshDepthMaterial> {
  const uniforms: Record<string, THREE.IUniform> = {
    uTime: { value: 0 },
    uWindStrength: { value: 0.25 },
  };

  const material = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
  });

  material.customProgramCacheKey = () => 'topog-depth-bark-v1';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform float uTime;
        uniform float uWindStrength;
        `
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        #ifdef USE_INSTANCING
          vec4 barkInstPos = instanceMatrix * vec4(transformed, 1.0);
          vec3 barkBasePos = instanceMatrix[3].xyz;
          float barkH = max(barkInstPos.y - barkBasePos.y, 0.0);
          float barkPhase = barkBasePos.x * 0.23 + barkBasePos.z * 0.19;
          float barkSway = (barkH * barkH * 0.0014) * uWindStrength;
          vec3 worldOffset = vec3(
            barkSway * (sin(uTime * 1.25 + barkPhase) + 0.35 * sin(uTime * 2.6 + barkPhase * 1.7)),
            0.0,
            barkSway * 0.65 * cos(uTime * 1.05 + barkPhase * 1.3)
          );
          transformed += mat3(inverse(instanceMatrix)) * worldOffset;
        #endif
        `
      );
  };

  return { material, uniforms };
}

function injectCanopyWindVertex(vertexShader: string): string {
  return vertexShader
    .replace(
      '#include <common>',
      /* glsl */ `
      #include <common>
      uniform float uTime;
      uniform float uWindStrength;
      `
    )
    .replace(
      '#include <begin_vertex>',
      /* glsl */ `
      #include <begin_vertex>
      #ifdef USE_INSTANCING
        vec4 canInstPos = instanceMatrix * vec4(transformed, 1.0);
        vec3 canBasePos = instanceMatrix[3].xyz;
      #else
        vec4 canInstPos = vec4(transformed, 1.0);
        vec3 canBasePos = vec3(0.0);
      #endif
      float canH = max(canInstPos.y - canBasePos.y, 0.0);
      float canPhase = canBasePos.x * 0.23 + canBasePos.z * 0.19;
      float canSway = (canH * canH * 0.0014) * uWindStrength;
      vec3 canopyOffset = vec3(
        canSway * (sin(uTime * 1.25 + canPhase) + 0.35 * sin(uTime * 2.6 + canPhase * 1.7)),
        0.0,
        canSway * 0.65 * cos(uTime * 1.05 + canPhase * 1.3)
      );
      float flutterPhase = canInstPos.x * 1.45 + canInstPos.z * 1.25 + canInstPos.y * 0.95;
      float flutter = (0.018 + uWindStrength * 0.08) * (0.5 + 0.5 * uv.y);
      canopyOffset.x += sin(uTime * 3.4 + flutterPhase) * flutter;
      canopyOffset.y += cos(uTime * 3.9 + flutterPhase * 1.18) * flutter * 0.55;
      #ifdef USE_INSTANCING
        transformed += mat3(inverse(instanceMatrix)) * canopyOffset;
      #else
        transformed += canopyOffset;
      #endif
      `
    );
}

export function createPbrCanopyMaterial(leafClusterMap: THREE.Texture): PbrMaterialHandle {
  const uniforms: Record<string, THREE.IUniform> = {
    uSunDir: { value: new THREE.Vector3(0.45, 0.72, -0.52).normalize() },
    uSunColor: { value: new THREE.Color(0xfff1d6) },
    uTime: { value: 0 },
    uWindStrength: { value: 0.25 },
    uCanopySnow: { value: 0 },
    uWetness: { value: 0.08 },
    uCloudTime: { value: 0 },
    uCloudCoverage: { value: 0.48 },
    uCloudStyle: { value: 0 },
    uSunTransmission: { value: 1 },
  };

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: leafClusterMap,
    alphaTest: 0.36,
    side: THREE.DoubleSide,
    roughness: 0.68,
    metalness: 0.0,
    envMapIntensity: 0.85,
  });

  material.customProgramCacheKey = () => 'topog-pbr-canopy-v1';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = injectCanopyWindVertex(shader.vertexShader)
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        varying vec3 vCustomWorldPos;
        varying vec3 vCustomWorldNormal;
        varying float vCrownHeight;
        `
      )
      .replace(
        '#include <project_vertex>',
        /* glsl */ `
        #include <project_vertex>
        vCrownHeight = clamp((position.y - 3.5) / 9.5, 0.0, 1.0);
        vec4 cWorldPos = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          cWorldPos = instanceMatrix * cWorldPos;
        #endif
        cWorldPos = modelMatrix * cWorldPos;
        vCustomWorldPos = cWorldPos.xyz;
        vec3 cObjNorm = vec3(normal);
        #ifdef USE_INSTANCING
          cObjNorm = mat3(instanceMatrix) * cObjNorm;
        #endif
        vCustomWorldNormal = normalize(mat3(modelMatrix) * cObjNorm);
        `
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        ${GLSL_NOISE_AND_FOG}
        ${GLSL_NOISE_AND_COLSPACE}
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform float uCanopySnow;
        uniform float uWetness;
        uniform float uCloudTime;
        uniform float uCloudCoverage;
        uniform float uCloudStyle;
        uniform float uSunTransmission;
        varying vec3 vCustomWorldPos;
        varying vec3 vCustomWorldNormal;
        varying float vCrownHeight;
        `
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        #include <color_fragment>
        vec3 foliageBase = diffuseColor.rgb;
        vec3 canN = safeNormalize(vCustomWorldNormal, vec3(0.0, 1.0, 0.0));
        if (!gl_FrontFacing) canN = -canN;
        vec3 canSoftN = safeNormalize(mix(canN, vec3(0.0, 1.0, 0.0), 0.35), vec3(0.0, 1.0, 0.0));

        // Inner canopy ambient darkening -> bright sunward crown tips
        foliageBase *= mix(0.62, 1.12, vCrownHeight * 0.55 + 0.45 * clamp(canSoftN.y * 0.5 + 0.5, 0.0, 1.0));
        foliageBase *= mix(1.0, 0.78, clamp(uWetness, 0.0, 1.0));

        float canSnowNoise = noise2(vCustomWorldPos.xz * 1.7 + vCustomWorldPos.y);
        float canSnowCap = smoothstep(0.16, 0.72, canSoftN.y + (canSnowNoise - 0.5) * 0.25) * uCanopySnow;
        canSnowCap = clamp(canSnowCap * (0.72 + 0.48 * vCrownHeight), 0.0, 0.92);
        diffuseColor.rgb = mix(foliageBase, srgbToLinear(vec3(0.90, 0.95, 1.0)), canSnowCap);
        `
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
        #include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.28, clamp(uWetness, 0.0, 1.0) * (1.0 - canSnowCap));
        roughnessFactor = mix(roughnessFactor, 0.60, canSnowCap);
        `
      )
      .replace(
        '#include <normal_fragment_begin>',
        /* glsl */ `
        #include <normal_fragment_begin>
        normal = normalize(mix(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz), 0.28));
        `
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `
        #include <emissivemap_fragment>
        vec3 canSunL = safeNormalize(uSunDir, vec3(0.0, 1.0, 0.0));
        vec3 canViewV = safeNormalize(cameraPosition - vCustomWorldPos, vec3(0.0, 0.0, 1.0));
        float canCloudMask = computeCloudDirectMask(vCustomWorldPos.xz, canSunL, uCloudTime, uCloudCoverage, uCloudStyle, uSunTransmission);
        float backLight = pow(clamp(dot(-canViewV, canSunL), 0.0, 1.0), 2.8) * max(canSunL.y + 0.2, 0.0) * (1.0 - canSnowCap * 0.85);
        totalEmissiveRadiance += foliageBase * vec3(1.25, 1.48, 0.55) * uSunColor * backLight * canCloudMask * 0.55;
        `
      )
      .replace(
        '#include <lights_fragment_end>',
        /* glsl */ `
        #include <lights_fragment_end>
        reflectedLight.directDiffuse *= canCloudMask;
        reflectedLight.directSpecular *= canCloudMask;
        reflectedLight.indirectDiffuse *= mix(1.24, 1.0, canCloudMask);
        `
      );
  };

  return { material, uniforms };
}

export function createCanopyDepthMaterial(
  leafClusterMap: THREE.Texture
): PbrMaterialHandle<THREE.MeshDepthMaterial> {
  const uniforms: Record<string, THREE.IUniform> = {
    uTime: { value: 0 },
    uWindStrength: { value: 0.25 },
  };

  const material = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: leafClusterMap,
    alphaTest: 0.36,
    side: THREE.DoubleSide,
  });

  material.customProgramCacheKey = () => 'topog-depth-canopy-v1';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = injectCanopyWindVertex(shader.vertexShader);
  };

  return { material, uniforms };
}

export function createPbrGrassMaterial(grassTuftMap: THREE.Texture): PbrMaterialHandle {
  const uniforms: Record<string, THREE.IUniform> = {
    uSunDir: { value: new THREE.Vector3(0.45, 0.72, -0.52).normalize() },
    uSunColor: { value: new THREE.Color(0xfff1d6) },
    uDappleStrength: { value: 0.85 },
    uTime: { value: 0 },
    uWindStrength: { value: 0.25 },
    uSnowCoverage: { value: 0 },
    uSnowDepth: { value: 0 },
    uWetness: { value: 0.08 },
    uCloudTime: { value: 0 },
    uCloudCoverage: { value: 0.48 },
    uCloudStyle: { value: 0 },
    uSunTransmission: { value: 1 },
  };

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: grassTuftMap,
    alphaTest: 0.28,
    side: THREE.DoubleSide,
    roughness: 0.62,
    metalness: 0.0,
    envMapIntensity: 0.82,
  });

  material.customProgramCacheKey = () => 'topog-pbr-grass-v1';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform float uTime;
        uniform float uWindStrength;
        uniform float uSnowCoverage;
        uniform float uSnowDepth;
        varying vec3 vCustomWorldPos;
        varying float vLodFade;
        `
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 gBaseWorld = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
        #else
          vec3 gBaseWorld = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        #endif
        float gCamDist = length(cameraPosition - gBaseWorld);
        float gLodScale = 1.0 - smoothstep(46.0, 92.0, gCamDist);
        vLodFade = gLodScale;
        transformed *= gLodScale;

        float gTip = uv.y * uv.y;
        float gGust = sin(gBaseWorld.x * 0.16 + gBaseWorld.z * 0.11 - uTime * (1.7 + uWindStrength * 2.6)) * 0.5 + 0.5;
        float gRustle = sin(uTime * 4.2 + gBaseWorld.x * 1.9 + gBaseWorld.z * 2.3);
        float gBend = (0.06 + uWindStrength * 0.42) * (0.35 + 0.65 * gGust) + gRustle * 0.04 * uWindStrength;
        float gSnowDroop = uSnowCoverage * 0.45;
        float gBuryDrop = min(uSnowDepth * 0.008, 0.24) * (1.0 - uv.y * 0.35);

        vec3 gWorldOffset = vec3(
          gBend * gTip * gLodScale,
          -(gSnowDroop * 0.26 * uv.y + gBuryDrop) * gLodScale,
          (gBend * 0.55 + gSnowDroop * 0.25) * gTip * gLodScale
        );
        #ifdef USE_INSTANCING
          transformed += mat3(inverse(instanceMatrix)) * gWorldOffset;
        #else
          transformed += gWorldOffset;
        #endif
        `
      )
      .replace(
        '#include <project_vertex>',
        /* glsl */ `
        #include <project_vertex>
        vec4 gWorldPos = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          gWorldPos = instanceMatrix * gWorldPos;
        #endif
        gWorldPos = modelMatrix * gWorldPos;
        vCustomWorldPos = gWorldPos.xyz;
        `
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        ${GLSL_NOISE_AND_FOG}
        ${GLSL_NOISE_AND_COLSPACE}
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform float uDappleStrength;
        uniform float uTime;
        uniform float uSnowCoverage;
        uniform float uWetness;
        uniform float uCloudTime;
        uniform float uCloudCoverage;
        uniform float uCloudStyle;
        uniform float uSunTransmission;
        varying vec3 vCustomWorldPos;
        varying float vLodFade;
        `
      )
      .replace(
        '#include <alphatest_fragment>',
        /* glsl */ `
        if (vLodFade < 0.02) discard;
        #include <alphatest_fragment>
        `
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        #include <color_fragment>
        vec3 bladeBase = diffuseColor.rgb;
        bladeBase *= mix(0.45, 1.12, smoothstep(0.0, 0.68, vMapUv.y));
        bladeBase *= mix(1.0, 0.74, clamp(uWetness, 0.0, 1.0));

        float gFrostNoise = noise2(vCustomWorldPos.xz * 1.4);
        float gSnowCoat = smoothstep(0.08, 0.85, uSnowCoverage * (0.75 + 0.45 * vMapUv.y) - gFrostNoise * 0.22);
        diffuseColor.rgb = mix(bladeBase, srgbToLinear(vec3(0.90, 0.95, 1.0)), gSnowCoat * 0.92);
        `
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
        #include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.26, clamp(uWetness, 0.0, 1.0) * (1.0 - gSnowCoat));
        roughnessFactor = mix(roughnessFactor, 0.58, gSnowCoat);
        `
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `
        #include <emissivemap_fragment>
        vec3 gSunL = safeNormalize(uSunDir, vec3(0.0, 1.0, 0.0));
        vec3 gViewV = safeNormalize(cameraPosition - vCustomWorldPos, vec3(0.0, 0.0, 1.0));
        float gDapple = computeDappledSun(vCustomWorldPos.xz, uTime, 0.0, uDappleStrength);
        float gCloudMask = computeCloudDirectMask(vCustomWorldPos.xz, gSunL, uCloudTime, uCloudCoverage, uCloudStyle, uSunTransmission);
        float gTrans = pow(clamp(dot(-gViewV, gSunL), 0.0, 1.0), 2.5) * vMapUv.y * (1.0 - gSnowCoat * 0.8) * 0.45;
        totalEmissiveRadiance += bladeBase * uSunColor * gTrans * gDapple * gCloudMask;
        `
      )
      .replace(
        '#include <lights_fragment_end>',
        /* glsl */ `
        #include <lights_fragment_end>
        reflectedLight.directDiffuse *= gDapple * gCloudMask;
        reflectedLight.directSpecular *= gDapple * gCloudMask;
        reflectedLight.indirectDiffuse *= mix(1.24, 1.0, gCloudMask);
        `
      );
  };

  return { material, uniforms };
}

export function createPbrFernMaterial(fernFrondMap: THREE.Texture): PbrMaterialHandle {
  const uniforms: Record<string, THREE.IUniform> = {
    uSunDir: { value: new THREE.Vector3(0.45, 0.72, -0.52).normalize() },
    uSunColor: { value: new THREE.Color(0xfff1d6) },
    uDappleStrength: { value: 0.85 },
    uTime: { value: 0 },
    uWindStrength: { value: 0.25 },
    uSnowCoverage: { value: 0 },
    uCanopySnow: { value: 0 },
    uWetness: { value: 0.08 },
    uCloudTime: { value: 0 },
    uCloudCoverage: { value: 0.48 },
    uCloudStyle: { value: 0 },
    uSunTransmission: { value: 1 },
  };

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: fernFrondMap,
    alphaTest: 0.30,
    side: THREE.DoubleSide,
    roughness: 0.65,
    metalness: 0.0,
    envMapIntensity: 0.82,
  });

  material.customProgramCacheKey = () => 'topog-pbr-fern-v1';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform float uTime;
        uniform float uWindStrength;
        uniform float uSnowCoverage;
        varying vec3 vCustomWorldPos;
        varying vec3 vCustomWorldNormal;
        varying float vLodFade;
        `
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 fBaseWorld = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
        #else
          vec3 fBaseWorld = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        #endif
        float fCamDist = length(cameraPosition - fBaseWorld);
        vLodFade = 1.0 - smoothstep(64.0, 118.0, fCamDist);
        transformed *= vLodFade;

        float fTip = uv.y;
        float fPhase = fBaseWorld.x * 0.75 + fBaseWorld.z * 0.92;
        float fSway = sin(uTime * 2.4 + fPhase) * (0.025 + uWindStrength * 0.14) * fTip * fTip;
        transformed.y += fSway * 0.55 - uSnowCoverage * 0.16 * fTip;
        transformed.x += fSway;
        `
      )
      .replace(
        '#include <project_vertex>',
        /* glsl */ `
        #include <project_vertex>
        vec4 fWorldPos = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          fWorldPos = instanceMatrix * fWorldPos;
        #endif
        fWorldPos = modelMatrix * fWorldPos;
        vCustomWorldPos = fWorldPos.xyz;
        vec3 fObjNorm = vec3(normal);
        #ifdef USE_INSTANCING
          fObjNorm = mat3(instanceMatrix) * fObjNorm;
        #endif
        vCustomWorldNormal = normalize(mat3(modelMatrix) * fObjNorm);
        `
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        ${GLSL_NOISE_AND_FOG}
        ${GLSL_NOISE_AND_COLSPACE}
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform float uDappleStrength;
        uniform float uTime;
        uniform float uSnowCoverage;
        uniform float uCanopySnow;
        uniform float uWetness;
        uniform float uCloudTime;
        uniform float uCloudCoverage;
        uniform float uCloudStyle;
        uniform float uSunTransmission;
        varying vec3 vCustomWorldPos;
        varying vec3 vCustomWorldNormal;
        varying float vLodFade;
        `
      )
      .replace(
        '#include <alphatest_fragment>',
        /* glsl */ `
        if (vLodFade < 0.02) discard;
        #include <alphatest_fragment>
        `
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        #include <color_fragment>
        vec3 fernBase = diffuseColor.rgb * mix(0.68, 1.14, vMapUv.y);
        fernBase *= mix(1.0, 0.74, clamp(uWetness, 0.0, 1.0));
        vec3 fGeoN = safeNormalize(vCustomWorldNormal, vec3(0.0, 1.0, 0.0));
        if (!gl_FrontFacing) fGeoN = -fGeoN;

        float fSnowAmt = max(uSnowCoverage, uCanopySnow * 0.9);
        float fSnowMask = smoothstep(0.12, 0.75, fSnowAmt * (0.55 + 0.55 * max(fGeoN.y, 0.0)));
        diffuseColor.rgb = mix(fernBase, srgbToLinear(vec3(0.90, 0.95, 1.0)), fSnowMask * 0.90);
        `
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
        #include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.28, clamp(uWetness, 0.0, 1.0) * (1.0 - fSnowMask));
        roughnessFactor = mix(roughnessFactor, 0.58, fSnowMask);
        `
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `
        #include <emissivemap_fragment>
        vec3 fSunL = safeNormalize(uSunDir, vec3(0.0, 1.0, 0.0));
        vec3 fViewV = safeNormalize(cameraPosition - vCustomWorldPos, vec3(0.0, 0.0, 1.0));
        float fDapple = computeDappledSun(vCustomWorldPos.xz, uTime, 0.0, uDappleStrength);
        float fCloudMask = computeCloudDirectMask(vCustomWorldPos.xz, fSunL, uCloudTime, uCloudCoverage, uCloudStyle, uSunTransmission);
        float fSss = pow(clamp(dot(-fViewV, fSunL), 0.0, 1.0), 2.4) * (1.0 - fSnowMask * 0.85) * 0.42;
        totalEmissiveRadiance += fernBase * uSunColor * fSss * fDapple * fCloudMask;
        `
      )
      .replace(
        '#include <lights_fragment_end>',
        /* glsl */ `
        #include <lights_fragment_end>
        reflectedLight.directDiffuse *= fDapple * fCloudMask;
        reflectedLight.directSpecular *= fDapple * fCloudMask;
        reflectedLight.indirectDiffuse *= mix(1.24, 1.0, fCloudMask);
        `
      );
  };

  return { material, uniforms };
}

export function createPbrRockMaterial(
  rockMap: THREE.Texture,
  rockNormalMap: THREE.Texture
): PbrMaterialHandle {
  rockMap.repeat.set(2, 2);
  rockNormalMap.repeat.set(2, 2);

  const uniforms: Record<string, THREE.IUniform> = {
    uSunDir: { value: new THREE.Vector3(0.45, 0.72, -0.52).normalize() },
    uDappleStrength: { value: 0.85 },
    uTime: { value: 0 },
    uSnowCoverage: { value: 0 },
    uWetness: { value: 0.08 },
    uCloudTime: { value: 0 },
    uCloudCoverage: { value: 0.48 },
    uCloudStyle: { value: 0 },
    uSunTransmission: { value: 1 },
  };

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: rockMap,
    normalMap: rockNormalMap,
    normalScale: new THREE.Vector2(1.5, 1.5),
    roughness: 0.86,
    metalness: 0.0,
    envMapIntensity: 0.78,
  });

  material.customProgramCacheKey = () => 'topog-pbr-rock-v1';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        varying vec3 vCustomWorldPos;
        varying vec3 vCustomWorldNormal;
        `
      )
      .replace(
        '#include <project_vertex>',
        /* glsl */ `
        #include <project_vertex>
        vec4 rWorldPos = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          rWorldPos = instanceMatrix * rWorldPos;
        #endif
        rWorldPos = modelMatrix * rWorldPos;
        vCustomWorldPos = rWorldPos.xyz;
        vec3 rObjNorm = vec3(normal);
        #ifdef USE_INSTANCING
          rObjNorm = mat3(instanceMatrix) * rObjNorm;
        #endif
        vCustomWorldNormal = normalize(mat3(modelMatrix) * rObjNorm);
        `
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        ${GLSL_NOISE_AND_FOG}
        ${GLSL_NOISE_AND_COLSPACE}
        uniform vec3 uSunDir;
        uniform float uDappleStrength;
        uniform float uTime;
        uniform float uSnowCoverage;
        uniform float uWetness;
        uniform float uCloudTime;
        uniform float uCloudCoverage;
        uniform float uCloudStyle;
        uniform float uSunTransmission;
        varying vec3 vCustomWorldPos;
        varying vec3 vCustomWorldNormal;
        `
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        #include <color_fragment>
        vec3 rGeoN = safeNormalize(vCustomWorldNormal, vec3(0.0, 1.0, 0.0));
        float rGrain = fbm4(vCustomWorldPos.xz * 2.5 + vCustomWorldPos.y * 1.9);
        vec3 stoneCol = diffuseColor.rgb * (0.82 + 0.34 * rGrain);

        // Velvety forest moss pillow on boulder top faces
        float rMossNoise = fbm4(vCustomWorldPos.xz * 2.8 + vec2(4.2, 9.1));
        float rMossMask = smoothstep(0.28, 0.72, rGeoN.y + (rMossNoise - 0.5) * 0.34);
        vec3 rMossCol = mix(
          srgbToLinear(vec3(0.13, 0.25, 0.10)),
          srgbToLinear(vec3(0.27, 0.45, 0.17)),
          0.4 + 0.6 * rMossNoise
        );
        vec3 rockBase = mix(stoneCol, rMossCol, rMossMask * 0.90);
        rockBase *= mix(1.0, 0.56, clamp(uWetness, 0.0, 1.0));

        float rSnowCap = smoothstep(0.22, 0.72, rGeoN.y + (rGrain - 0.5) * 0.18) * smoothstep(0.02, 0.72, uSnowCoverage);
        diffuseColor.rgb = mix(rockBase, srgbToLinear(vec3(0.93, 0.965, 1.0)), rSnowCap);
        `
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
        #include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.92, rMossMask * 0.85 * (1.0 - rSnowCap));
        roughnessFactor = mix(roughnessFactor, 0.20, clamp(uWetness, 0.0, 1.0) * (1.0 - rSnowCap));
        roughnessFactor = mix(roughnessFactor, 0.58, rSnowCap);
        `
      )
      .replace(
        '#include <lights_fragment_end>',
        /* glsl */ `
        #include <lights_fragment_end>
        vec3 rSunL = safeNormalize(uSunDir, vec3(0.0, 1.0, 0.0));
        float rDapple = computeDappledSun(vCustomWorldPos.xz, uTime, 0.12, uDappleStrength);
        float rCloudMask = computeCloudDirectMask(vCustomWorldPos.xz, rSunL, uCloudTime, uCloudCoverage, uCloudStyle, uSunTransmission);
        reflectedLight.directDiffuse *= rDapple * rCloudMask;
        reflectedLight.directSpecular *= rDapple * rCloudMask;
        reflectedLight.indirectDiffuse *= mix(1.24, 1.0, rCloudMask);
        `
      );
  };

  return { material, uniforms };
}

export function createVolumetricMistMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    uniforms: {
      uMistColor: { value: new THREE.Color(0xcdd6c5) },
      uSunColor: { value: new THREE.Color(0xfff1d6) },
      uSunDir: { value: new THREE.Vector3(0.45, 0.72, -0.52).normalize() },
      uOpacity: { value: 0.24 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldPos;

      void main() {
        #ifdef USE_INSTANCING
          vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
        #else
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
        #endif
        vUv = uv;
        vWorldPos = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uMistColor;
      uniform vec3 uSunColor;
      uniform vec3 uSunDir;
      uniform float uOpacity;
      uniform float uTime;

      varying vec2 vUv;
      varying vec3 vWorldPos;

      ${GLSL_NOISE_AND_FOG}

      void main() {
        if (uOpacity <= 0.005) discard;

        vec2 centered = vUv * 2.0 - 1.0;
        float edgeFade = smoothstep(1.0, 0.18, abs(centered.x)) * smoothstep(1.0, 0.15, abs(centered.y));
        if (edgeFade <= 0.005) discard;

        float dist = length(cameraPosition - vWorldPos);
        float nearFade = smoothstep(4.5, 13.0, dist);
        float farFade = 1.0 - smoothstep(55.0, 115.0, dist);

        vec2 flowUv = vUv * vec2(2.6, 1.5) + vec2(uTime * 0.018, -uTime * 0.008) + vWorldPos.xz * 0.04;
        float wisp = fbm4(flowUv);
        float alpha = edgeFade * nearFade * farFade * smoothstep(0.24, 0.84, wisp) * uOpacity;
        if (alpha <= 0.004) discard;

        vec3 toFrag = vWorldPos - cameraPosition;
        vec3 viewDir = dist > 1e-4 ? toFrag / dist : vec3(0.0, 0.0, -1.0);
        float sunScatter = pow(max(dot(viewDir, safeNormalize(uSunDir, vec3(0.0, 1.0, 0.0))), 0.0), 3.0);
        vec3 col = mix(uMistColor, uSunColor * 0.85 + uMistColor * 0.3, sunScatter * 0.45);

        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

export function createSunbeamMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uSunColor: { value: new THREE.Color(0xfff1d6) },
      uOpacity: { value: 0.14 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldPos;

      void main() {
        #ifdef USE_INSTANCING
          vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
        #else
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
        #endif
        vUv = uv;
        vWorldPos = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunColor;
      uniform float uOpacity;
      uniform float uTime;

      varying vec2 vUv;
      varying vec3 vWorldPos;

      ${GLSL_NOISE_AND_FOG}

      void main() {
        if (uOpacity <= 0.004) discard;

        float horiz = sin(clamp(vUv.x, 0.0, 1.0) * 3.14159265);
        horiz = horiz * horiz;
        float vert = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.22, vUv.y);

        float dist = length(cameraPosition - vWorldPos);
        float nearFade = smoothstep(4.0, 12.0, dist);
        float farFade = 1.0 - smoothstep(45.0, 95.0, dist);

        float shimmer = 0.7 + 0.3 * noise2(vec2(vUv.x * 5.5 + uTime * 0.05, vUv.y * 2.0 + vWorldPos.x * 0.1));
        float alpha = horiz * vert * nearFade * farFade * shimmer * uOpacity;
        if (alpha <= 0.003) discard;

        gl_FragColor = vec4(uSunColor, alpha);
      }
    `,
  });
}

export function createSkyDomeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uSunDir: { value: new THREE.Vector3(0.45, 0.72, -0.52).normalize() },
      uMoonDir: { value: new THREE.Vector3(-0.32, 0.48, -0.78).normalize() },
      uSunColor: { value: new THREE.Color(0xfff1d6) },
      uZenithColor: { value: new THREE.Color(0x527fa3) },
      uHorizonColor: { value: new THREE.Color(0xcdd6c5) },
      uOvercast: { value: 0 },
      uStarsIntensity: { value: 0 },
      uTime: { value: 0 },
      uCloudTime: { value: 0 },
      uCloudCoverage: { value: 0.48 },
      uCloudStyle: { value: 0 },
      uSunTransmission: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      uniform vec3 uMoonDir;
      uniform vec3 uSunColor;
      uniform vec3 uZenithColor;
      uniform vec3 uHorizonColor;
      uniform float uOvercast;
      uniform float uStarsIntensity;
      uniform float uTime;
      uniform float uCloudTime;
      uniform float uCloudCoverage;
      uniform float uCloudStyle;
      uniform float uSunTransmission;

      varying vec3 vDir;

      ${GLSL_NOISE_AND_FOG}

      void main() {
        vec3 dir = safeNormalize(vDir, vec3(0.0, 1.0, 0.0));
        vec3 L = safeNormalize(uSunDir, vec3(0.0, 1.0, 0.0));
        vec3 M = safeNormalize(uMoonDir, vec3(-0.32, 0.48, -0.78));
        float up = clamp(dir.y, 0.0, 1.0);

        // Physically-inspired Rayleigh + Mie sky gradient
        vec3 sky = mix(uHorizonColor, uZenithColor, pow(up, 0.50));

        // Warm horizon scattering band near sun azimuth
        vec2 dirHoriz = safeNormalize(vec3(dir.x, 0.0, dir.z), vec3(0.0, 0.0, -1.0)).xz;
        vec2 sunHoriz = safeNormalize(vec3(L.x, 0.0, L.z), vec3(0.0, 0.0, -1.0)).xz;
        float azimAlign = clamp(dot(dirHoriz, sunHoriz), 0.0, 1.0);
        float horizonBand = exp(-up * 6.0) * smoothstep(-0.18, 0.35, L.y);
        vec3 warmScatter = mix(uHorizonColor, uSunColor * 1.05 + vec3(0.18, 0.08, 0.02), 0.58);
        sky = mix(
          sky,
          warmScatter,
          horizonBand * (0.22 + 0.55 * pow(azimAlign, 2.5)) * (1.0 - uOvercast * 0.72)
        );

        float sunDot = clamp(dot(dir, L), 0.0, 1.0);
        float sunAbove = smoothstep(-0.04, 0.08, L.y);
        float dayMask = (1.0 - clamp(uStarsIntensity, 0.0, 1.0) * 0.95) * sunAbove;

        // Broad atmospheric Mie glow in clear sky
        sky += uSunColor * pow(sunDot, 5.0) * 0.22 * dayMask * (1.0 - uOvercast * 0.65);

        // Multi-layer world-space cloud projection (420m high cirrus, 180m main cumulus/storm)
        float horizonFade = smoothstep(0.015, 0.24, up);
        vec2 cirrusXZ = cameraPosition.xz + dir.xz * (420.0 / max(dir.y, 0.06));
        vec2 mainXZ = cameraPosition.xz + dir.xz * (180.0 / max(dir.y, 0.06));

        float cirrusRaw = 0.0;
        sampleWorldCloudLayer(cirrusXZ, uCloudTime, uCloudCoverage, uCloudStyle, cirrusRaw);
        float cirrusWeight = uCloudStyle > 1.5 && uCloudStyle < 2.5
          ? 0.58
          : (uCloudStyle >= 2.5 ? 0.0 : (uCloudStyle >= 0.5 ? 0.30 : 0.16));
        float cirrusDensity = clamp(cirrusRaw * cirrusWeight, 0.0, 1.0) * horizonFade;

        float unusedCirrus = 0.0;
        float mainDensity = sampleWorldCloudLayer(mainXZ, uCloudTime, uCloudCoverage, uCloudStyle, unusedCirrus) * horizonFade;
        float maxCloud = clamp(max(mainDensity, cirrusDensity * 0.75), 0.0, 1.0);

        // Twinkling stars at dusk/night in clear gaps
        if (uStarsIntensity > 0.01 && dir.y > 0.03) {
          vec2 starGrid = floor(dir.xz / (dir.y + 0.35) * 195.0);
          float starVal = hash21(starGrid);
          float twinkle = 0.62 + 0.38 * sin(uTime * 2.6 + starVal * 43.0);
          float star = step(0.9962, starVal) * twinkle * smoothstep(0.03, 0.28, dir.y) * (1.0 - maxCloud);
          sky += vec3(0.86, 0.93, 1.0) * star * uStarsIntensity * 1.15;
        }

        // Crisp crescent/soft Moon glow at night behind clouds
        float moonAbove = smoothstep(-0.02, 0.14, M.y);
        if (moonAbove > 0.01 && uStarsIntensity > 0.05) {
          float moonDot = clamp(dot(dir, M), 0.0, 1.0);
          float moonOcclude = clamp(1.0 - mainDensity * 0.92 - cirrusDensity * 0.40, 0.0, 1.0);
          float moonDisc = smoothstep(0.9991, 0.99965, moonDot);
          vec3 crescentOffset = safeNormalize(M + vec3(0.016, 0.011, 0.0), M);
          float crescentCut = smoothstep(0.9990, 0.99955, clamp(dot(dir, crescentOffset), 0.0, 1.0));
          float crescent = clamp(moonDisc - crescentCut * 0.88, 0.0, 1.0);
          float moonHalo = pow(moonDot, 24.0) * 0.26 + pow(moonDot, 160.0) * 0.42;
          vec3 moonCol = vec3(0.84, 0.91, 1.0);
          sky += moonCol * (moonHalo + crescent * 1.85) * moonAbove * uStarsIntensity * moonOcclude;
        }

        // Solar disc + aureole modulated directly by cloud density along ray dir
        float solarCloudOcclusion = clamp(1.0 - mainDensity * 0.94 - cirrusDensity * 0.45, 0.0, 1.0);
        float aureole = pow(sunDot, 16.0) * 0.48 + pow(sunDot, 96.0) * 0.65;
        float solarDisc = smoothstep(0.9985, 0.99955, sunDot) * 2.4;
        sky += uSunColor * (aureole + solarDisc) * dayMask * solarCloudOcclusion;

        // High Cirrus clouds (420m)
        if (cirrusDensity > 0.002) {
          vec3 cirrusBase = mix(uHorizonColor * 1.06, vec3(0.96, 0.97, 1.0), 0.45 * dayMask);
          vec3 cirrusLit = mix(
            cirrusBase,
            uSunColor * 1.08 + vec3(0.12),
            0.35 * dayMask + 0.35 * pow(sunDot, 4.0) * dayMask
          );
          if (uStarsIntensity > 0.05) {
            cirrusLit = mix(cirrusLit, vec3(0.16, 0.22, 0.34), uStarsIntensity * 0.78);
          }
          sky = mix(sky, cirrusLit, cirrusDensity * 0.82);
        }

        // Main Cumulus / Storm layer (180m) with 4-tap directional sun self-shadowing + Mie silver lining
        if (mainDensity > 0.002) {
          vec3 lightDirRef = dayMask > 0.05 ? L : M;
          vec2 marchStep = (lightDirRef.xz / max(lightDirRef.y, 0.24)) * 11.0;
          float opticalDepth = 0.0;
          float dummyC = 0.0;
          for (int i = 1; i <= 4; i++) {
            float fi = float(i);
            vec2 tapXZ = mainXZ + marchStep * fi;
            float tapD = sampleWorldCloudLayer(tapXZ, uCloudTime, uCloudCoverage, uCloudStyle, dummyC);
            opticalDepth += tapD * (0.42 - fi * 0.06);
          }
          float sunLit = exp(-opticalDepth * 1.55);

          float isStorm = smoothstep(2.2, 3.0, uCloudStyle);
          vec3 dayTop = mix(uHorizonColor * 0.95, uSunColor * 1.10 + vec3(0.16, 0.14, 0.10), 0.62);
          dayTop = mix(dayTop, mix(uHorizonColor * 0.82, vec3(0.58, 0.64, 0.72), 0.45), isStorm * 0.62);

          vec3 dayBelly = mix(uHorizonColor * 0.66, vec3(0.32, 0.40, 0.52), 0.52);
          dayBelly = mix(dayBelly, vec3(0.18, 0.23, 0.30), isStorm * 0.68);

          vec3 nightCloud = mix(vec3(0.06, 0.10, 0.18), vec3(0.18, 0.25, 0.38), sunLit * 0.65);

          vec3 cloudColor = mix(dayBelly, dayTop, clamp(sunLit * 1.15, 0.0, 1.0));
          cloudColor = mix(cloudColor, nightCloud, clamp(uStarsIntensity, 0.0, 1.0) * 0.88);

          // Mie forward-scattering silver lining around cloud edges
          float edgeBand = smoothstep(0.02, 0.32, mainDensity) * (1.0 - smoothstep(0.32, 0.88, mainDensity));
          float miePhase = pow(sunDot, 12.0);
          vec3 silverLining = (uSunColor * 1.25 + vec3(0.24, 0.20, 0.14))
            * miePhase * (0.45 + 1.45 * edgeBand) * dayMask * (0.85 + 0.35 * (1.0 - clamp(uSunTransmission, 0.0, 1.0)));
          cloudColor += silverLining * (1.0 - isStorm * 0.45);

          float cloudAlpha = clamp(mainDensity * (0.92 + 0.08 * isStorm), 0.0, 0.98);
          sky = mix(sky, cloudColor, cloudAlpha);
        }

        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  });
}

export function createSnowParticleMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uCamPos: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uWindStrength: { value: 0.25 },
      uOpacity: { value: 0 },
      uBoxSize: { value: new THREE.Vector3(64, 34, 64) },
      uPixelRatio: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      attribute float aSize;

      uniform vec3 uCamPos;
      uniform float uTime;
      uniform float uWindStrength;
      uniform float uOpacity;
      uniform vec3 uBoxSize;
      uniform float uPixelRatio;

      varying float vAlpha;

      void main() {
        vec3 boxHalf = uBoxSize * 0.5;
        float fallSpeed = 1.8 + aSeed * 1.6;
        vec3 drift = vec3(
          uTime * (0.6 + uWindStrength * 5.2) + sin(uTime * 1.4 + aSeed * 19.0) * 0.9,
          -uTime * fallSpeed,
          uTime * (0.3 + uWindStrength * 2.4) + cos(uTime * 1.1 + aSeed * 23.0) * 0.9
        );

        vec3 wrapped = mod(position + drift - uCamPos + boxHalf, uBoxSize) - boxHalf + uCamPos;
        vec4 mvPosition = viewMatrix * vec4(wrapped, 1.0);
        float dist = max(-mvPosition.z, 0.5);

        vAlpha = uOpacity * (1.0 - smoothstep(22.0, 32.0, length(wrapped - uCamPos)));
        gl_PointSize = clamp((aSize * 85.0 * uPixelRatio) / dist, 1.0, 14.0) * step(0.005, uOpacity);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;

      void main() {
        if (vAlpha <= 0.01) discard;
        vec2 c = gl_PointCoord - vec2(0.5);
        float d = length(c);
        float soft = smoothstep(0.5, 0.08, d);
        if (soft <= 0.01) discard;
        gl_FragColor = vec4(0.95, 0.98, 1.0, soft * vAlpha * 0.9);
      }
    `,
  });
}

export function createRainParticleMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uCamPos: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uWindStrength: { value: 0.25 },
      uOpacity: { value: 0 },
      uBoxSize: { value: new THREE.Vector3(56, 30, 56) },
      uPixelRatio: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      attribute float aSize;

      uniform vec3 uCamPos;
      uniform float uTime;
      uniform float uWindStrength;
      uniform float uOpacity;
      uniform vec3 uBoxSize;
      uniform float uPixelRatio;

      varying float vAlpha;
      varying float vTilt;

      void main() {
        vec3 boxHalf = uBoxSize * 0.5;
        float fallSpeed = 18.0 + aSeed * 8.0;
        vec3 drift = vec3(
          uTime * (1.2 + uWindStrength * 6.5),
          -uTime * fallSpeed,
          uTime * (0.5 + uWindStrength * 2.5)
        );

        vec3 wrapped = mod(position + drift - uCamPos + boxHalf, uBoxSize) - boxHalf + uCamPos;
        vec4 mvPosition = viewMatrix * vec4(wrapped, 1.0);
        float dist = max(-mvPosition.z, 0.6);

        vTilt = uWindStrength * 0.22;
        vAlpha = uOpacity * (1.0 - smoothstep(18.0, 28.0, length(wrapped - uCamPos)));
        gl_PointSize = clamp((aSize * 210.0 * uPixelRatio) / dist, 2.0, 26.0) * step(0.005, uOpacity);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      varying float vTilt;

      void main() {
        if (vAlpha <= 0.01) discard;
        vec2 uv = gl_PointCoord - vec2(0.5);
        float xDist = abs(uv.x + uv.y * vTilt);
        float streakX = smoothstep(0.09, 0.01, xDist);
        float streakY = smoothstep(0.5, 0.1, abs(uv.y));
        float alpha = streakX * streakY * vAlpha * 0.65;
        if (alpha <= 0.01) discard;
        gl_FragColor = vec4(0.76, 0.87, 0.98, alpha);
      }
    `,
  });
}

export function createFireflyParticleMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uCamPos: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uBoxSize: { value: new THREE.Vector3(70, 12, 70) },
      uPixelRatio: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;

      uniform vec3 uCamPos;
      uniform float uTime;
      uniform float uOpacity;
      uniform vec3 uBoxSize;
      uniform float uPixelRatio;

      varying float vGlow;
      varying float vSeed;

      void main() {
        vec3 boxHalf = uBoxSize * 0.5;
        vec3 drift = vec3(
          sin(uTime * 0.55 + aSeed * 17.0) * 2.2,
          sin(uTime * 0.85 + aSeed * 29.0) * 0.85,
          cos(uTime * 0.48 + aSeed * 23.0) * 2.2
        );

        vec3 base = vec3(position.x, uCamPos.y - 1.5 + mod(position.y, uBoxSize.y) - boxHalf.y * 0.3, position.z);
        vec3 wrapped = mod(base + drift - uCamPos + boxHalf, uBoxSize) - boxHalf + uCamPos;
        vec4 mvPosition = viewMatrix * vec4(wrapped, 1.0);
        float dist = max(-mvPosition.z, 0.8);

        float pWave = clamp(0.5 + 0.5 * sin(uTime * (1.8 + aSeed * 1.4) + aSeed * 31.0), 0.0, 1.0);
        float pulse = 0.25 + 0.75 * (pWave * pWave);
        vGlow = uOpacity * pulse * (1.0 - smoothstep(22.0, 35.0, length(wrapped - uCamPos)));
        vSeed = aSeed;

        gl_PointSize = clamp((130.0 * uPixelRatio) / dist, 2.0, 18.0) * step(0.01, uOpacity);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vGlow;
      varying float vSeed;

      void main() {
        if (vGlow <= 0.01) discard;
        float d = length(gl_PointCoord - vec2(0.5));
        float halo = exp(-d * d * 22.0);
        if (halo <= 0.01) discard;
        vec3 col = mix(vec3(0.75, 1.0, 0.35), vec3(1.0, 0.88, 0.40), vSeed);
        gl_FragColor = vec4(col, halo * vGlow);
      }
    `,
  });
}
