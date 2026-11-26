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
  float forwardScatter = pow(max(dot(viewDir, sunDir), 0.0), 4.0);
  vec3 scatteredMist = mix(fogColor, sunColor * 0.92 + fogColor * 0.25, forwardScatter * mistGlow * 0.42);

  return mix(color, scatteredMist, fogFactor);
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

        float hemi = 0.5 + 0.5 * effN.y;
        vec3 ambient = mix(uHemisphereGround, uHemisphereSky, hemi);
        vec3 snowShadowTint = mix(ambient, uHemisphereSky * 0.92 + vec3(0.10, 0.15, 0.24), 0.45);
        vec3 effAmbient = mix(ambient, snowShadowTint, snowMask);

        vec3 hv = L + V;
        vec3 H = dot(hv, hv) > 1e-6 ? normalize(hv) : effN;
        float wetSpec = pow(max(dot(effN, H), 0.0), 48.0) * wetAmount * (1.0 - snowMask) * 0.65;
        float sparkleHash = hash21(floor(xz * 18.0) + floor(V.xz * 6.0));
        float snowSparkle = step(0.982, sparkleHash) * pow(max(dot(effN, H), 0.0), 18.0) * snowMask * 0.95;

        float rim = pow(1.0 - clamp(dot(effN, V), 0.0, 1.0), 3.2) * 0.14;
        vec3 surfaceCol = mix(albedo, snowAlbedo, snowMask);

        vec3 lit = surfaceCol * (effAmbient * 0.64 + uSunColor * NdotL * dapple * 1.05)
          + uSunColor * (wetSpec * dapple + snowSparkle)
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
        float hemi = 0.5 + 0.5 * N.y;
        vec3 ambient = mix(uHemisphereGround, uHemisphereSky, hemi);

        vec3 hv = L + V;
        vec3 H = dot(hv, hv) > 1e-6 ? normalize(hv) : N;
        float wetSpec = pow(max(dot(N, H), 0.0), 28.0) * uWetness * (1.0 - snowDust) * 0.24;

        vec3 lit = albedo * (ambient * 0.62 + uSunColor * NdotL * 0.94) + uSunColor * wetSpec;
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
        float backLight = pow(max(dot(-V, L), 0.0), 2.8) * max(L.y + 0.2, 0.0) * (1.0 - snowCap * 0.85);
        vec3 sssGlow = foliage * vec3(1.35, 1.55, 0.72) * backLight * 0.52;

        float hemi = 0.5 + 0.5 * softN.y;
        vec3 ambient = mix(uHemisphereGround, uHemisphereSky, hemi);

        vec3 hv = L + V;
        vec3 H = dot(hv, hv) > 1e-6 ? normalize(hv) : softN;
        float wetSpec = pow(max(dot(softN, H), 0.0), 26.0) * uWetness * (1.0 - snowCap) * 0.25;
        float rim = pow(1.0 - clamp(dot(softN, V), 0.0, 1.0), 3.0) * 0.14;

        vec3 lit = albedo * (ambient * 0.68 + uSunColor * wrapDiff * 0.95)
          + uSunColor * (sssGlow + wetSpec)
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
        float wrapDiff = max((dot(N, L) + 0.45) / 1.45, 0.0);
        float trans = pow(max(dot(-V, L), 0.0), 2.5) * vUv.y * (1.0 - snowCoat * 0.8) * 0.48;
        float hemi = 0.5 + 0.5 * N.y;
        vec3 ambient = mix(uHemisphereGround, uHemisphereSky, hemi);

        vec3 hv = L + V;
        vec3 H = dot(hv, hv) > 1e-6 ? normalize(hv) : N;
        float wetSpec = pow(max(dot(N, H), 0.0), 24.0) * uWetness * (1.0 - snowCoat) * 0.28;

        vec3 lit = albedo * (ambient * 0.66 + uSunColor * wrapDiff * dapple * 0.98)
          + uSunColor * (bladeCol * trans * dapple + wetSpec);

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
        float wrapDiff = max((dot(N, L) + 0.42) / 1.42, 0.0);
        float sss = pow(max(dot(-V, L), 0.0), 2.4) * (1.0 - snowMask * 0.85) * 0.44;
        float hemi = 0.5 + 0.5 * N.y;
        vec3 ambient = mix(uHemisphereGround, uHemisphereSky, hemi);

        vec3 hv = L + V;
        vec3 H = dot(hv, hv) > 1e-6 ? normalize(hv) : N;
        float wetSpec = pow(max(dot(N, H), 0.0), 28.0) * uWetness * (1.0 - snowMask) * 0.25;

        vec3 lit = albedo * (ambient * 0.66 + uSunColor * wrapDiff * dapple * 0.96)
          + uSunColor * (fernCol * sss * dapple + wetSpec);

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
        float NdotL = max(dot(N, L), 0.0);
        float hemi = 0.5 + 0.5 * N.y;
        vec3 ambient = mix(uHemisphereGround, uHemisphereSky, hemi);

        vec3 hv = L + V;
        vec3 H = dot(hv, hv) > 1e-6 ? normalize(hv) : N;
        float wetSpec = pow(max(dot(N, H), 0.0), 38.0) * uWetness * (1.0 - snowCap) * 0.45;
        // Soft velvety sheen on moss edges
        float mossRim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.5) * mossMask * (1.0 - snowCap) * 0.18;

        vec3 lit = albedo * (ambient * 0.64 + uSunColor * NdotL * dapple * 0.98)
          + uSunColor * wetSpec * dapple
          + uSunColor * mossRim * 0.4;

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
      uSunColor: { value: new THREE.Color(0xfff1d6) },
      uZenithColor: { value: new THREE.Color(0x527fa3) },
      uHorizonColor: { value: new THREE.Color(0xcdd6c5) },
      uOvercast: { value: 0 },
      uStarsIntensity: { value: 0 },
      uTime: { value: 0 },
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
      uniform vec3 uSunColor;
      uniform vec3 uZenithColor;
      uniform vec3 uHorizonColor;
      uniform float uOvercast;
      uniform float uStarsIntensity;
      uniform float uTime;

      varying vec3 vDir;

      ${GLSL_NOISE_AND_FOG}

      void main() {
        vec3 dir = safeNormalize(vDir, vec3(0.0, 1.0, 0.0));
        vec3 L = safeNormalize(uSunDir, vec3(0.0, 1.0, 0.0));
        float up = clamp(dir.y, 0.0, 1.0);

        vec3 sky = mix(uHorizonColor, uZenithColor, pow(up, 0.52));

        vec2 cloudUv = dir.xz / (max(dir.y, 0.14)) * 1.4 + vec2(uTime * 0.012, uTime * 0.006);
        float cloud = fbm4(cloudUv);
        float cloudMask = smoothstep(0.45 - uOvercast * 0.35, 0.82 - uOvercast * 0.25, cloud) * smoothstep(0.02, 0.35, up);
        vec3 cloudCol = mix(uHorizonColor * 1.04, uHorizonColor * 0.85, uOvercast);
        sky = mix(sky, cloudCol, cloudMask * (0.35 + 0.55 * uOvercast));

        float sunDot = max(dot(dir, L), 0.0);
        float sunVis = (1.0 - uOvercast * 0.88) * smoothstep(-0.08, 0.12, L.y);
        sky += uSunColor * pow(sunDot, 10.0) * 0.42 * sunVis;
        sky += uSunColor * smoothstep(0.9982, 0.9995, sunDot) * 1.7 * sunVis;

        if (uStarsIntensity > 0.01 && dir.y > 0.04) {
          vec2 starGrid = floor(dir.xz / (dir.y + 0.4) * 180.0);
          float starVal = hash21(starGrid);
          float twinkle = 0.65 + 0.35 * sin(uTime * 2.5 + starVal * 40.0);
          float star = step(0.9965, starVal) * twinkle * smoothstep(0.04, 0.28, dir.y) * (1.0 - uOvercast);
          sky += vec3(0.85, 0.92, 1.0) * star * uStarsIntensity;
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
