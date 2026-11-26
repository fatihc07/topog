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

export function createTerrainMaterial(groundDetailMap: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: groundDetailMap },
      uSunDir: { value: new THREE.Vector3(0.45, 0.72, -0.52).normalize() },
      uSunColor: { value: new THREE.Color(0xfff1d6) },
      uHemisphereSky: { value: new THREE.Color(0xcdd6c5) },
      uHemisphereGround: { value: new THREE.Color(0x283520) },
      uFogColor: { value: new THREE.Color(0xcdd6c5) },
      uFogDensity: { value: 0.0115 },
      uMistGlow: { value: 0.65 },
      uDappleStrength: { value: 0.85 },
      uSnowDepth: { value: 0 },
      uSnowCoverage: { value: 0 },
      uWetness: { value: 0.08 },
      uTime: { value: 0 },
      uCloudTime: { value: 0 },
      uCloudCoverage: { value: 0.48 },
      uCloudStyle: { value: 0 },
      uSunTransmission: { value: 1 },
    },
    vertexShader: /* glsl */ `
      uniform float uSnowDepth;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;

      void main() {
        vec3 pos = position;
        vec3 wNormal = normalize(mat3(modelMatrix) * normal);
        float flatFactor = smoothstep(0.32, 0.92, wNormal.y);
        pos.y += min(uSnowDepth * 0.0055, 0.35) * flatFactor;

        vec4 worldPos = modelMatrix * vec4(pos, 1.0);
        vWorldPos = worldPos.xyz;
        vWorldNormal = wNormal;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uHemisphereSky;
      uniform vec3 uHemisphereGround;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      uniform float uMistGlow;
      uniform float uDappleStrength;
      uniform float uSnowDepth;
      uniform float uSnowCoverage;
      uniform float uWetness;
      uniform float uTime;
      uniform float uCloudTime;
      uniform float uCloudCoverage;
      uniform float uCloudStyle;
      uniform float uSunTransmission;

      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;

      ${GLSL_NOISE_AND_FOG}

      void main() {
        vec3 N = safeNormalize(vWorldNormal, vec3(0.0, 1.0, 0.0));
        vec3 V = safeNormalize(cameraPosition - vWorldPos, vec3(0.0, 0.0, 1.0));
        vec3 L = safeNormalize(uSunDir, vec3(0.0, 1.0, 0.0));

        vec2 xz = vWorldPos.xz;
        float macro = fbm4(xz * 0.055);
        float mid = fbm4(xz * 0.24 + vec2(11.3, 4.7));
        float micro = noise2(xz * 2.2);

        // Sample seamless ground detail texture at two incommensurate scales
        vec3 texA = texture2D(uMap, xz * 0.26).rgb;
        vec3 texB = texture2D(uMap, xz * 0.68 + vec2(0.37, 0.71)).rgb;
        vec3 groundTex = mix(texA, texB, 0.42);
        vec3 detailBoost = clamp((groundTex - vec3(0.24)) * 2.1 + vec3(0.96), vec3(0.55), vec3(1.55));

        // Winding dirt trail matching getTrailCenterX / getTrailFactor
        float trailCenterX = sin(xz.y * 0.075) * 3.6 + sin(xz.y * 0.028 + 0.8) * 2.1;
        float dxdz = 3.6 * 0.075 * cos(xz.y * 0.075) + 2.1 * 0.028 * cos(xz.y * 0.028 + 0.8);
        float perpScale = inversesqrt(1.0 + dxdz * dxdz);
        float trailEdgeNoise = (fbm4(xz * 0.35 + vec2(7.1, -3.4)) - 0.5) * 0.55;
        float trailDist = abs(xz.x - trailCenterX) * perpScale + trailEdgeNoise;
        float trailMask = 1.0 - smoothstep(1.1, 2.5, trailDist);
        float trailCore = 1.0 - smoothstep(0.35, 1.35, trailDist);

        // Lush mossy woodland floor + fallen-leaf humus
        vec3 mossDeep = vec3(0.15, 0.27, 0.12);
        vec3 mossEmerald = vec3(0.26, 0.42, 0.18);
        vec3 mossCol = mix(mossDeep, mossEmerald, smoothstep(0.25, 0.78, mid));

        vec3 humus = vec3(0.26, 0.18, 0.12);
        float humusMask = smoothstep(0.45, 0.75, macro + (micro - 0.5) * 0.22);
        vec3 woodlandFloor = mix(mossCol, humus, humusMask * 0.60) * detailBoost;

        // Warm ochre sunlit dirt footpath with compacted center & fallen-leaf shoulder
        vec3 trailCenterCol = vec3(0.56, 0.43, 0.28);
        vec3 trailShoulderCol = vec3(0.37, 0.28, 0.18);
        vec3 trailDirt = mix(trailShoulderCol, trailCenterCol, trailCore * 0.85 + 0.15 * mid);
        trailDirt *= mix(vec3(0.84), vec3(1.18), groundTex * 1.9);
        float pebble = hash21(floor(xz * 9.5));
        trailDirt *= mix(0.92, 1.12, smoothstep(0.75, 0.98, pebble));

        vec3 floorCol = mix(woodlandFloor, trailDirt, trailMask);

        // Rocky steep slopes
        float slope = 1.0 - smoothstep(0.58, 0.88, N.y);
        vec3 rockBase = vec3(0.35, 0.37, 0.39) * (0.78 + 0.42 * mid);
        vec3 albedo = mix(floorCol, rockBase, clamp(slope * 1.12, 0.0, 1.0));

        // Rain wetness: muddy dark soil + glossy water puddles along path & hollows
        float puddleNoise = smoothstep(0.44, 0.78, mid) * (1.0 - slope * 0.75);
        float trailPuddle = trailCore * smoothstep(0.40, 0.72, noise2(xz * 0.65));
        float wetAmount = clamp(uWetness * (0.62 + 0.48 * puddleNoise + 0.32 * trailPuddle), 0.0, 1.0);
        albedo *= mix(1.0, 0.50, wetAmount);

        // Dynamic snow blanket driven by uSnowCoverage & uSnowDepth
        float snowNoise = fbm4(xz * 0.085 + vec2(3.1, 8.9)) * 0.65 + micro * 0.35;
        float cliffResistance = (1.0 - smoothstep(0.42, 0.86, N.y)) * 0.48;
        float depthFactor = clamp(uSnowDepth / 18.0, 0.0, 1.0);
        float warmHollow = (1.0 - smoothstep(-1.5, 4.5, vWorldPos.y)) * 0.08 * (1.0 - depthFactor * 0.6);
        float snowField = uSnowCoverage * 1.18 - snowNoise * 0.34 - cliffResistance - warmHollow;
        float snowMask = smoothstep(0.02, 0.24, snowField) * smoothstep(0.0, 0.06, uSnowCoverage);

        vec3 snowAlbedo = mix(vec3(0.84, 0.90, 0.98), vec3(0.97, 0.985, 1.0), smoothstep(0.35, 0.85, N.y));
        vec3 snowN = safeNormalize(
          N + vec3((micro - 0.5) * 0.12, 0.0, (noise2(xz * 3.1 + 5.0) - 0.5) * 0.12),
          N
        );
        vec3 effN = safeNormalize(mix(N, snowN, snowMask), N);

        float NdotL = max(dot(effN, L), 0.0);
        float dapple = computeDappledSun(xz, uTime, trailMask, uDappleStrength);
        float directMask = computeCloudDirectMask(xz, L, uCloudTime, uCloudCoverage, uCloudStyle, uSunTransmission);
        float ambientBoost = mix(1.24, 1.0, directMask);

        float hemi = 0.5 + 0.5 * effN.y;
        vec3 ambient = mix(uHemisphereGround, uHemisphereSky, hemi);
        vec3 snowShadowTint = mix(ambient, uHemisphereSky * 0.92 + vec3(0.10, 0.15, 0.24), 0.45);
        vec3 effAmbient = mix(ambient, snowShadowTint, snowMask);

        vec3 hv = L + V;
        vec3 H = dot(hv, hv) > 1e-6 ? normalize(hv) : effN;
        float wetSpec = pow(clamp(dot(effN, H), 0.0, 1.0), 48.0) * wetAmount * (1.0 - snowMask) * 0.65;
        float sparkleHash = hash21(floor(xz * 18.0) + floor(V.xz * 6.0));
        float snowSparkle = step(0.982, sparkleHash) * pow(clamp(dot(effN, H), 0.0, 1.0), 18.0) * snowMask * 0.95;

        float rim = pow(1.0 - clamp(dot(effN, V), 0.0, 1.0), 3.2) * 0.14;
        vec3 surfaceCol = mix(albedo, snowAlbedo, snowMask);

        vec3 lit = surfaceCol * (effAmbient * 0.64 * ambientBoost + uSunColor * NdotL * dapple * directMask * 1.05)
          + uSunColor * (wetSpec * dapple + snowSparkle) * directMask
          + uHemisphereSky * rim * (0.30 + 0.70 * snowMask);

        lit = applyWoodlandMist(lit, vWorldPos, uFogColor, uFogDensity, L, uSunColor, uMistGlow);
        gl_FragColor = vec4(lit, 1.0);
      }
    `,
  });
}

export function createBarkMaterial(barkMap: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: barkMap },
      uSunDir: { value: new THREE.Vector3(0.45, 0.72, -0.52).normalize() },
      uSunColor: { value: new THREE.Color(0xfff1d6) },
      uHemisphereSky: { value: new THREE.Color(0xcdd6c5) },
      uHemisphereGround: { value: new THREE.Color(0x283520) },
      uFogColor: { value: new THREE.Color(0xcdd6c5) },
      uFogDensity: { value: 0.0115 },
      uMistGlow: { value: 0.65 },
      uTime: { value: 0 },
      uWindStrength: { value: 0.25 },
      uCanopySnow: { value: 0 },
      uWetness: { value: 0.08 },
      uCloudTime: { value: 0 },
      uCloudCoverage: { value: 0.48 },
      uCloudStyle: { value: 0 },
      uSunTransmission: { value: 1 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uWindStrength;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vLocalHeight;

      void main() {
        #ifdef USE_INSTANCING
          mat4 instMat = instanceMatrix;
        #else
          mat4 instMat = mat4(1.0);
        #endif

        #ifdef USE_INSTANCING_COLOR
          vColor = instanceColor;
        #else
          vColor = vec3(1.0);
        #endif

        vec4 instPos = instMat * vec4(position, 1.0);
        vec3 basePos = instMat[3].xyz;
        float h = max(instPos.y - basePos.y, 0.0);
        float phase = basePos.x * 0.23 + basePos.z * 0.19;
        float swayAmt = (h * h * 0.0014) * uWindStrength;
        instPos.x += swayAmt * (sin(uTime * 1.25 + phase) + 0.35 * sin(uTime * 2.6 + phase * 1.7));
        instPos.z += swayAmt * 0.65 * cos(uTime * 1.05 + phase * 1.3);

        vec4 worldPos = modelMatrix * instPos;
        vWorldPos = worldPos.xyz;
        vLocalHeight = max(position.y, 0.0);

        mat3 instNormalMat = mat3(instMat);
        vec3 instNorm = normalize(instNormalMat * normal);
        vWorldNormal = normalize(mat3(modelMatrix) * instNorm);
        vUv = uv;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uHemisphereSky;
      uniform vec3 uHemisphereGround;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      uniform float uMistGlow;
      uniform float uCanopySnow;
      uniform float uWetness;
      uniform float uCloudTime;
      uniform float uCloudCoverage;
      uniform float uCloudStyle;
      uniform float uSunTransmission;

      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vLocalHeight;

      ${GLSL_NOISE_AND_FOG}

      void main() {
        vec3 N = safeNormalize(vWorldNormal, vec3(0.0, 1.0, 0.0));
        vec3 V = safeNormalize(cameraPosition - vWorldPos, vec3(0.0, 0.0, 1.0));
        vec3 L = safeNormalize(uSunDir, vec3(0.0, 1.0, 0.0));

        vec2 barkUv = vec2(vUv.x * 2.0, vUv.y * 4.5);
        vec3 barkTex = texture2D(uMap, barkUv).rgb;
        float barkLuma = dot(barkTex, vec3(0.299, 0.587, 0.114));
        float isBirch = smoothstep(1.15, 1.65, max(vColor.r, max(vColor.g, vColor.b)));
        vec3 birchTex = mix(vec3(0.15, 0.13, 0.12), vec3(0.86, 0.85, 0.82), smoothstep(0.14, 0.44, barkLuma));
        vec3 barkCol = mix(barkTex * vColor, birchTex * (vColor * 0.56), isBirch);

        // Subtle moss creeping up the lower root flare / trunk collar
        float mossNoise = fbm4(vWorldPos.xz * 1.9 + vWorldPos.y * 1.4);
        float rootMoss = smoothstep(2.4, 0.15, vLocalHeight + (mossNoise - 0.5) * 1.1) *
          smoothstep(-0.2, 0.55, N.y + 0.25);
        vec3 mossCol = vec3(0.18, 0.31, 0.13) * (0.75 + 0.45 * mossNoise);
        barkCol = mix(barkCol, mossCol, clamp(rootMoss * 0.62, 0.0, 0.72));

        // Damp bark darkening
        barkCol *= mix(1.0, 0.56, clamp(uWetness, 0.0, 1.0));

        // Frost / snow dusting on windward & upward limbs
        float windward = clamp(N.x * 0.45 + N.z * 0.35 + 0.2, 0.0, 1.0);
        float snowDust = smoothstep(0.15, 0.85, N.y * 0.75 + windward * 0.55) * uCanopySnow * 0.78;
        vec3 albedo = mix(barkCol, vec3(0.88, 0.93, 0.99), snowDust);

        float NdotL = max(dot(N, L), 0.0);
        float directMask = computeCloudDirectMask(vWorldPos.xz, L, uCloudTime, uCloudCoverage, uCloudStyle, uSunTransmission);
        float ambientBoost = mix(1.24, 1.0, directMask);
        float hemi = 0.5 + 0.5 * N.y;
        vec3 ambient = mix(uHemisphereGround, uHemisphereSky, hemi);

        vec3 hv = L + V;
        vec3 H = dot(hv, hv) > 1e-6 ? normalize(hv) : N;
        float wetSpec = pow(clamp(dot(N, H), 0.0, 1.0), 28.0) * uWetness * (1.0 - snowDust) * 0.24;

        vec3 lit = albedo * (ambient * 0.62 * ambientBoost + uSunColor * NdotL * directMask * 0.94)
          + uSunColor * wetSpec * directMask;
        lit = applyWoodlandMist(lit, vWorldPos, uFogColor, uFogDensity, L, uSunColor, uMistGlow);
        gl_FragColor = vec4(lit, 1.0);
      }
    `,
  });
}

export function createCanopyMaterial(leafClusterMap: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      uMap: { value: leafClusterMap },
      uSunDir: { value: new THREE.Vector3(0.45, 0.72, -0.52).normalize() },
      uSunColor: { value: new THREE.Color(0xfff1d6) },
      uHemisphereSky: { value: new THREE.Color(0xcdd6c5) },
      uHemisphereGround: { value: new THREE.Color(0x283520) },
      uFogColor: { value: new THREE.Color(0xcdd6c5) },
      uFogDensity: { value: 0.0115 },
      uMistGlow: { value: 0.65 },
      uTime: { value: 0 },
      uWindStrength: { value: 0.25 },
      uCanopySnow: { value: 0 },
      uWetness: { value: 0.08 },
      uCloudTime: { value: 0 },
      uCloudCoverage: { value: 0.48 },
      uCloudStyle: { value: 0 },
      uSunTransmission: { value: 1 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uWindStrength;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec3 vColor;
      varying vec2 vUv;
      varying float vCrownHeight;

      void main() {
        #ifdef USE_INSTANCING
          mat4 instMat = instanceMatrix;
        #else
          mat4 instMat = mat4(1.0);
        #endif

        #ifdef USE_INSTANCING_COLOR
          vColor = instanceColor;
        #else
          vColor = vec3(1.0);
        #endif

        vec4 instPos = instMat * vec4(position, 1.0);
        vec3 basePos = instMat[3].xyz;
        float h = max(instPos.y - basePos.y, 0.0);
        float phase = basePos.x * 0.23 + basePos.z * 0.19;

        // Trunk-matched sway so foliage stays anchored on limbs
        float swayAmt = (h * h * 0.0014) * uWindStrength;
        instPos.x += swayAmt * (sin(uTime * 1.25 + phase) + 0.35 * sin(uTime * 2.6 + phase * 1.7));
        instPos.z += swayAmt * 0.65 * cos(uTime * 1.05 + phase * 1.3);

        // Airy leaf-card flutter
        float flutterPhase = instPos.x * 1.45 + instPos.z * 1.25 + instPos.y * 0.95;
        float flutter = (0.018 + uWindStrength * 0.08) * (0.5 + 0.5 * uv.y);
        instPos.x += sin(uTime * 3.4 + flutterPhase) * flutter;
        instPos.y += cos(uTime * 3.9 + flutterPhase * 1.18) * flutter * 0.55;

        vec4 worldPos = modelMatrix * instPos;
        vWorldPos = worldPos.xyz;
        vCrownHeight = clamp((position.y - 3.5) / 9.5, 0.0, 1.0);

        mat3 instNormalMat = mat3(instMat);
        vec3 instNorm = normalize(instNormalMat * normal);
        vWorldNormal = normalize(mat3(modelMatrix) * instNorm);
        vUv = uv;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uHemisphereSky;
      uniform vec3 uHemisphereGround;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      uniform float uMistGlow;
      uniform float uCanopySnow;
      uniform float uWetness;
      uniform float uCloudTime;
      uniform float uCloudCoverage;
      uniform float uCloudStyle;
      uniform float uSunTransmission;

      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec3 vColor;
      varying vec2 vUv;
      varying float vCrownHeight;

      ${GLSL_NOISE_AND_FOG}

      void main() {
        vec4 tex = texture2D(uMap, vUv);
        if (tex.a < 0.36) discard;

        vec3 N = safeNormalize(vWorldNormal, vec3(0.0, 1.0, 0.0));
        if (!gl_FrontFacing) N = -N;
        // Soften normal toward upward canopy hemisphere to prevent flat card seams
        vec3 softN = safeNormalize(mix(N, vec3(0.0, 1.0, 0.0), 0.35), vec3(0.0, 1.0, 0.0));
        vec3 V = safeNormalize(cameraPosition - vWorldPos, vec3(0.0, 0.0, 1.0));
        vec3 L = safeNormalize(uSunDir, vec3(0.0, 1.0, 0.0));

        vec3 foliage = tex.rgb * vColor;
        // Forest canopy self-shadowing: deeper shade on inner lower boughs, brighter tips
        foliage *= mix(0.68, 1.12, vCrownHeight * 0.55 + 0.45 * clamp(softN.y * 0.5 + 0.5, 0.0, 1.0));
        foliage *= mix(1.0, 0.78, clamp(uWetness, 0.0, 1.0));

        // Upward-facing snow accumulation dusting leafy crowns
        float snowNoise = noise2(vWorldPos.xz * 1.7 + vWorldPos.y);
        float snowCap = smoothstep(0.16, 0.72, softN.y + (snowNoise - 0.5) * 0.25) * uCanopySnow;
        snowCap = clamp(snowCap * (0.72 + 0.48 * vCrownHeight), 0.0, 0.92);
        vec3 snowCol = vec3(0.91, 0.955, 1.0);
        vec3 albedo = mix(foliage, snowCol, snowCap);

        // Wrap diffuse + translucent sunlit leaf subsurface scattering
        float wrapDiff = max((dot(softN, L) + 0.45) / 1.45, 0.0);
        float backLight = pow(clamp(dot(-V, L), 0.0, 1.0), 2.8) * max(L.y + 0.2, 0.0) * (1.0 - snowCap * 0.85);
        vec3 sssGlow = foliage * vec3(1.35, 1.55, 0.72) * backLight * 0.52;

        float directMask = computeCloudDirectMask(vWorldPos.xz, L, uCloudTime, uCloudCoverage, uCloudStyle, uSunTransmission);
        float ambientBoost = mix(1.24, 1.0, directMask);
        float hemi = 0.5 + 0.5 * softN.y;
        vec3 ambient = mix(uHemisphereGround, uHemisphereSky, hemi);

        vec3 hv = L + V;
        vec3 H = dot(hv, hv) > 1e-6 ? normalize(hv) : softN;
        float wetSpec = pow(clamp(dot(softN, H), 0.0, 1.0), 26.0) * uWetness * (1.0 - snowCap) * 0.25;
        float rim = pow(1.0 - clamp(dot(softN, V), 0.0, 1.0), 3.0) * 0.14;

        vec3 lit = albedo * (ambient * 0.68 * ambientBoost + uSunColor * wrapDiff * directMask * 0.95)
          + uSunColor * (sssGlow + wetSpec) * directMask
          + uHemisphereSky * rim * (0.25 + 0.75 * snowCap);

        lit = applyWoodlandMist(lit, vWorldPos, uFogColor, uFogDensity, L, uSunColor, uMistGlow);
        gl_FragColor = vec4(lit, 1.0);
      }
    `,
  });
}

export function createGrassMaterial(grassTuftMap: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      uMap: { value: grassTuftMap },
      uSunDir: { value: new THREE.Vector3(0.45, 0.72, -0.52).normalize() },
      uSunColor: { value: new THREE.Color(0xfff1d6) },
      uHemisphereSky: { value: new THREE.Color(0xcdd6c5) },
      uHemisphereGround: { value: new THREE.Color(0x283520) },
      uFogColor: { value: new THREE.Color(0xcdd6c5) },
      uFogDensity: { value: 0.0115 },
      uMistGlow: { value: 0.65 },
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
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uWindStrength;
      uniform float uSnowCoverage;
      uniform float uSnowDepth;

      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec3 vColor;
      varying vec2 vUv;
      varying float vLodFade;

      void main() {
        #ifdef USE_INSTANCING
          mat4 instMat = instanceMatrix;
        #else
          mat4 instMat = mat4(1.0);
        #endif

        #ifdef USE_INSTANCING_COLOR
          vColor = instanceColor;
        #else
          vColor = vec3(1.0);
        #endif

        vec3 baseWorld = (modelMatrix * vec4(instMat[3].xyz, 1.0)).xyz;
        float camDist = length(cameraPosition - baseWorld);
        float lodScale = 1.0 - smoothstep(46.0, 92.0, camDist);
        vLodFade = lodScale;

        vec3 localPos = position * lodScale;

        float tipFactor = uv.y * uv.y;
        float gustWave = sin(baseWorld.x * 0.16 + baseWorld.z * 0.11 - uTime * (1.7 + uWindStrength * 2.6)) * 0.5 + 0.5;
        float rustle = sin(uTime * 4.2 + baseWorld.x * 1.9 + baseWorld.z * 2.3);
        float windBend = (0.06 + uWindStrength * 0.42) * (0.35 + 0.65 * gustWave) + rustle * 0.04 * uWindStrength;

        float snowDroop = uSnowCoverage * 0.45;
        float buryDrop = min(uSnowDepth * 0.008, 0.24) * (1.0 - uv.y * 0.35);

        vec4 instPos = instMat * vec4(localPos, 1.0);
        instPos.x += windBend * tipFactor * lodScale;
        instPos.z += (windBend * 0.55 + snowDroop * 0.25) * tipFactor * lodScale;
        instPos.y -= (snowDroop * 0.26 * uv.y + buryDrop) * lodScale;

        vec4 worldPos = modelMatrix * instPos;
        vWorldPos = worldPos.xyz;

        mat3 instNormalMat = mat3(instMat);
        vWorldNormal = normalize(mat3(modelMatrix) * (instNormalMat * normal));
        vUv = uv;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uHemisphereSky;
      uniform vec3 uHemisphereGround;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      uniform float uMistGlow;
      uniform float uDappleStrength;
      uniform float uTime;
      uniform float uSnowCoverage;
      uniform float uWetness;
      uniform float uCloudTime;
      uniform float uCloudCoverage;
      uniform float uCloudStyle;
      uniform float uSunTransmission;

      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec3 vColor;
      varying vec2 vUv;
      varying float vLodFade;

      ${GLSL_NOISE_AND_FOG}

      void main() {
        if (vLodFade < 0.02) discard;

        vec4 tex = texture2D(uMap, vUv);
        if (tex.a < 0.28) discard;

        vec3 N = safeNormalize(vWorldNormal, vec3(0.0, 1.0, 0.0));
        if (!gl_FrontFacing) N = -N;
        vec3 V = safeNormalize(cameraPosition - vWorldPos, vec3(0.0, 0.0, 1.0));
        vec3 L = safeNormalize(uSunDir, vec3(0.0, 1.0, 0.0));

        vec3 bladeCol = tex.rgb * vColor;
        // Root ambient occlusion -> sunlit golden-green tips
        bladeCol *= mix(0.48, 1.12, smoothstep(0.0, 0.68, vUv.y));
        bladeCol *= mix(1.0, 0.74, clamp(uWetness, 0.0, 1.0));

        float frostNoise = noise2(vWorldPos.xz * 1.4);
        float snowCoat = smoothstep(0.08, 0.85, uSnowCoverage * (0.75 + 0.45 * vUv.y) - frostNoise * 0.22);
        vec3 albedo = mix(bladeCol, vec3(0.91, 0.955, 1.0), snowCoat * 0.92);

        float dapple = computeDappledSun(vWorldPos.xz, uTime, 0.0, uDappleStrength);
        float directMask = computeCloudDirectMask(vWorldPos.xz, L, uCloudTime, uCloudCoverage, uCloudStyle, uSunTransmission);
        float ambientBoost = mix(1.24, 1.0, directMask);
        float wrapDiff = max((dot(N, L) + 0.45) / 1.45, 0.0);
        float trans = pow(clamp(dot(-V, L), 0.0, 1.0), 2.5) * vUv.y * (1.0 - snowCoat * 0.8) * 0.48;
        float hemi = 0.5 + 0.5 * N.y;
        vec3 ambient = mix(uHemisphereGround, uHemisphereSky, hemi);

        vec3 hv = L + V;
        vec3 H = dot(hv, hv) > 1e-6 ? normalize(hv) : N;
        float wetSpec = pow(clamp(dot(N, H), 0.0, 1.0), 24.0) * uWetness * (1.0 - snowCoat) * 0.28;

        vec3 lit = albedo * (ambient * 0.66 * ambientBoost + uSunColor * wrapDiff * dapple * directMask * 0.98)
          + uSunColor * (bladeCol * trans * dapple + wetSpec) * directMask;

        lit = applyWoodlandMist(lit, vWorldPos, uFogColor, uFogDensity, L, uSunColor, uMistGlow);
        gl_FragColor = vec4(lit, 1.0);
      }
    `,
  });
}

export function createFernMaterial(fernFrondMap: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      uMap: { value: fernFrondMap },
      uSunDir: { value: new THREE.Vector3(0.45, 0.72, -0.52).normalize() },
      uSunColor: { value: new THREE.Color(0xfff1d6) },
      uHemisphereSky: { value: new THREE.Color(0xcdd6c5) },
      uHemisphereGround: { value: new THREE.Color(0x283520) },
      uFogColor: { value: new THREE.Color(0xcdd6c5) },
      uFogDensity: { value: 0.0115 },
      uMistGlow: { value: 0.65 },
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
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uWindStrength;
      uniform float uSnowCoverage;

      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec3 vColor;
      varying vec2 vUv;
      varying float vLodFade;

      void main() {
        #ifdef USE_INSTANCING
          mat4 instMat = instanceMatrix;
        #else
          mat4 instMat = mat4(1.0);
        #endif

        #ifdef USE_INSTANCING_COLOR
          vColor = instanceColor;
        #else
          vColor = vec3(1.0);
        #endif

        vec3 baseWorld = (modelMatrix * vec4(instMat[3].xyz, 1.0)).xyz;
        float camDist = length(cameraPosition - baseWorld);
        vLodFade = 1.0 - smoothstep(64.0, 118.0, camDist);

        vec3 localPos = position * vLodFade;
        float tip = uv.y;
        float phase = baseWorld.x * 0.75 + baseWorld.z * 0.92;
        float sway = sin(uTime * 2.4 + phase) * (0.025 + uWindStrength * 0.14) * tip * tip;
        localPos.y += sway * 0.55 - uSnowCoverage * 0.16 * tip;
        localPos.x += sway;

        vec4 worldPos = modelMatrix * instMat * vec4(localPos, 1.0);
        vWorldPos = worldPos.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * (mat3(instMat) * normal));
        vUv = uv;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uHemisphereSky;
      uniform vec3 uHemisphereGround;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      uniform float uMistGlow;
      uniform float uDappleStrength;
      uniform float uTime;
      uniform float uSnowCoverage;
      uniform float uCanopySnow;
      uniform float uWetness;
      uniform float uCloudTime;
      uniform float uCloudCoverage;
      uniform float uCloudStyle;
      uniform float uSunTransmission;

      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec3 vColor;
      varying vec2 vUv;
      varying float vLodFade;

      ${GLSL_NOISE_AND_FOG}

      void main() {
        if (vLodFade < 0.02) discard;

        vec4 tex = texture2D(uMap, vUv);
        if (tex.a < 0.30) discard;

        vec3 N = safeNormalize(vWorldNormal, vec3(0.0, 1.0, 0.0));
        if (!gl_FrontFacing) N = -N;
        vec3 V = safeNormalize(cameraPosition - vWorldPos, vec3(0.0, 0.0, 1.0));
        vec3 L = safeNormalize(uSunDir, vec3(0.0, 1.0, 0.0));

        vec3 fernCol = tex.rgb * vColor * mix(0.68, 1.14, vUv.y);
        fernCol *= mix(1.0, 0.74, clamp(uWetness, 0.0, 1.0));

        float snowAmt = max(uSnowCoverage, uCanopySnow * 0.9);
        float snowMask = smoothstep(0.12, 0.75, snowAmt * (0.55 + 0.55 * max(N.y, 0.0)));
        vec3 albedo = mix(fernCol, vec3(0.90, 0.95, 1.0), snowMask * 0.90);

        float dapple = computeDappledSun(vWorldPos.xz, uTime, 0.0, uDappleStrength);
        float directMask = computeCloudDirectMask(vWorldPos.xz, L, uCloudTime, uCloudCoverage, uCloudStyle, uSunTransmission);
        float ambientBoost = mix(1.24, 1.0, directMask);
        float wrapDiff = max((dot(N, L) + 0.42) / 1.42, 0.0);
        float sss = pow(clamp(dot(-V, L), 0.0, 1.0), 2.4) * (1.0 - snowMask * 0.85) * 0.44;
        float hemi = 0.5 + 0.5 * N.y;
        vec3 ambient = mix(uHemisphereGround, uHemisphereSky, hemi);

        vec3 hv = L + V;
        vec3 H = dot(hv, hv) > 1e-6 ? normalize(hv) : N;
        float wetSpec = pow(clamp(dot(N, H), 0.0, 1.0), 28.0) * uWetness * (1.0 - snowMask) * 0.25;

        vec3 lit = albedo * (ambient * 0.66 * ambientBoost + uSunColor * wrapDiff * dapple * directMask * 0.96)
          + uSunColor * (fernCol * sss * dapple + wetSpec) * directMask;

        lit = applyWoodlandMist(lit, vWorldPos, uFogColor, uFogDensity, L, uSunColor, uMistGlow);
        gl_FragColor = vec4(lit, 1.0);
      }
    `,
  });
}

export function createRockMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: { value: new THREE.Vector3(0.45, 0.72, -0.52).normalize() },
      uSunColor: { value: new THREE.Color(0xfff1d6) },
      uHemisphereSky: { value: new THREE.Color(0xcdd6c5) },
      uHemisphereGround: { value: new THREE.Color(0x283520) },
      uFogColor: { value: new THREE.Color(0xcdd6c5) },
      uFogDensity: { value: 0.0115 },
      uMistGlow: { value: 0.65 },
      uDappleStrength: { value: 0.85 },
      uTime: { value: 0 },
      uSnowCoverage: { value: 0 },
      uWetness: { value: 0.08 },
      uCloudTime: { value: 0 },
      uCloudCoverage: { value: 0.48 },
      uCloudStyle: { value: 0 },
      uSunTransmission: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec3 vColor;

      void main() {
        #ifdef USE_INSTANCING
          mat4 instMat = instanceMatrix;
        #else
          mat4 instMat = mat4(1.0);
        #endif

        #ifdef USE_INSTANCING_COLOR
          vColor = instanceColor;
        #else
          vColor = vec3(0.42, 0.44, 0.46);
        #endif

        vec4 worldPos = modelMatrix * instMat * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * (mat3(instMat) * normal));
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uHemisphereSky;
      uniform vec3 uHemisphereGround;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      uniform float uMistGlow;
      uniform float uDappleStrength;
      uniform float uTime;
      uniform float uSnowCoverage;
      uniform float uWetness;
      uniform float uCloudTime;
      uniform float uCloudCoverage;
      uniform float uCloudStyle;
      uniform float uSunTransmission;

      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec3 vColor;

      ${GLSL_NOISE_AND_FOG}

      void main() {
        vec3 N = safeNormalize(vWorldNormal, vec3(0.0, 1.0, 0.0));
        vec3 V = safeNormalize(cameraPosition - vWorldPos, vec3(0.0, 0.0, 1.0));
        vec3 L = safeNormalize(uSunDir, vec3(0.0, 1.0, 0.0));

        float grain = fbm4(vWorldPos.xz * 2.5 + vWorldPos.y * 1.9);
        float micro = noise2(vWorldPos.xz * 9.0 + vWorldPos.y * 7.0);
        vec3 stone = vColor * (0.70 + 0.46 * grain + 0.14 * micro);

        // Thick velvety woodland moss blanket on upward-facing boulder tops
        float mossNoise = fbm4(vWorldPos.xz * 2.8 + vec2(4.2, 9.1));
        float mossMask = smoothstep(0.28, 0.72, N.y + (mossNoise - 0.5) * 0.34);
        vec3 mossShadow = vec3(0.14, 0.27, 0.11);
        vec3 mossBright = vec3(0.29, 0.48, 0.18);
        vec3 mossCol = mix(mossShadow, mossBright, 0.4 + 0.6 * mossNoise);
        vec3 baseCol = mix(stone, mossCol, mossMask * 0.90);

        baseCol *= mix(1.0, 0.56, clamp(uWetness, 0.0, 1.0));

        // Thick snow cap as uSnowCoverage increases
        float snowCap = smoothstep(0.22, 0.72, N.y + (grain - 0.5) * 0.18) * smoothstep(0.02, 0.72, uSnowCoverage);
        vec3 albedo = mix(baseCol, vec3(0.93, 0.965, 1.0), snowCap);

        float dapple = computeDappledSun(vWorldPos.xz, uTime, 0.12, uDappleStrength);
        float directMask = computeCloudDirectMask(vWorldPos.xz, L, uCloudTime, uCloudCoverage, uCloudStyle, uSunTransmission);
        float ambientBoost = mix(1.24, 1.0, directMask);
        float NdotL = max(dot(N, L), 0.0);
        float hemi = 0.5 + 0.5 * N.y;
        vec3 ambient = mix(uHemisphereGround, uHemisphereSky, hemi);

        vec3 hv = L + V;
        vec3 H = dot(hv, hv) > 1e-6 ? normalize(hv) : N;
        float wetSpec = pow(clamp(dot(N, H), 0.0, 1.0), 38.0) * uWetness * (1.0 - snowCap) * 0.45;
        // Soft velvety sheen on moss edges
        float mossRim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.5) * mossMask * (1.0 - snowCap) * 0.18;

        vec3 lit = albedo * (ambient * 0.64 * ambientBoost + uSunColor * NdotL * dapple * directMask * 0.98)
          + uSunColor * wetSpec * dapple * directMask
          + uSunColor * mossRim * 0.4 * directMask;

        lit = applyWoodlandMist(lit, vWorldPos, uFogColor, uFogDensity, L, uSunColor, uMistGlow);
        gl_FragColor = vec4(lit, 1.0);
      }
    `,
  });
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
