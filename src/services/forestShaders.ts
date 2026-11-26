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

vec3 applyExpFog(vec3 color, vec3 worldPos, vec3 fogColor, float fogDensity) {
  float dist = length(cameraPosition - worldPos);
  float fogFactor = 1.0 - exp(-fogDensity * fogDensity * dist * dist);
  return mix(color, fogColor, clamp(fogFactor, 0.0, 1.0));
}
`;

export function createTerrainMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: { value: new THREE.Vector3(0.45, 0.72, -0.52).normalize() },
      uSunColor: { value: new THREE.Color(0xfff1d6) },
      uHemisphereSky: { value: new THREE.Color(0x88b4e6) },
      uHemisphereGround: { value: new THREE.Color(0x283520) },
      uFogColor: { value: new THREE.Color(0x9fb8cc) },
      uFogDensity: { value: 0.0085 },
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
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uHemisphereSky;
      uniform vec3 uHemisphereGround;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      uniform float uSnowDepth;
      uniform float uSnowCoverage;
      uniform float uWetness;
      uniform float uTime;

      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;

      ${GLSL_NOISE_AND_FOG}

      void main() {
        vec3 N = normalize(vWorldNormal);
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 L = normalize(uSunDir);

        vec2 xz = vWorldPos.xz;
        float macro = fbm4(xz * 0.055);
        float mid = fbm4(xz * 0.28 + vec2(11.3, 4.7));
        float micro = noise2(xz * 2.4);
        float speck = hash21(floor(xz * 7.5));

        // Moss palette (#2d4a26 .. #486c2f)
        vec3 mossDark = vec3(0.176, 0.290, 0.149);
        vec3 mossLush = vec3(0.282, 0.424, 0.184);
        vec3 mossCol = mix(mossDark, mossLush, smoothstep(0.28, 0.76, mid));

        // Damp pine-needle humus (#3b2a1c) and fallen leaves / clover specks
        vec3 humus = vec3(0.231, 0.165, 0.110);
        vec3 leafAccent = mix(vec3(0.38, 0.27, 0.13), vec3(0.24, 0.43, 0.16), step(0.55, micro));
        float humusMask = smoothstep(0.42, 0.72, macro + (micro - 0.5) * 0.25);
        vec3 floorCol = mix(mossCol, humus, humusMask * 0.72);
        floorCol = mix(floorCol, leafAccent, smoothstep(0.84, 0.96, speck) * 0.35);

        // Rocky steep slopes (#555c63)
        float slope = 1.0 - smoothstep(0.60, 0.88, N.y);
        vec3 rockBase = vec3(0.333, 0.361, 0.388);
        vec3 rockCol = rockBase * (0.78 + 0.42 * mid);
        vec3 albedo = mix(floorCol, rockCol, clamp(slope * 1.15, 0.0, 1.0));

        // Wetness darkening + glossy wet micro-sheen
        float puddleNoise = smoothstep(0.42, 0.78, mid) * (1.0 - slope * 0.7);
        float wetAmount = clamp(uWetness * (0.65 + 0.55 * puddleNoise), 0.0, 1.0);
        albedo *= mix(1.0, 0.56, wetAmount);

        // Dynamic snow layer controlled by uSnowCoverage
        float snowNoise = fbm4(xz * 0.085 + vec2(3.1, 8.9)) * 0.65 + micro * 0.35;
        float cliffResistance = (1.0 - smoothstep(0.42, 0.86, N.y)) * 0.48;
        float warmHollow = (1.0 - smoothstep(-1.5, 4.5, vWorldPos.y)) * 0.10;
        float snowField = uSnowCoverage * 1.18 - snowNoise * 0.36 - cliffResistance - warmHollow;
        float snowMask = smoothstep(0.02, 0.24, snowField) * smoothstep(0.0, 0.06, uSnowCoverage);

        vec3 snowAlbedo = mix(vec3(0.83, 0.90, 0.98), vec3(0.97, 0.985, 1.0), smoothstep(0.35, 0.85, N.y));
        // Subtle micro-normal perturbation on snow
        vec3 snowN = normalize(N + vec3((micro - 0.5) * 0.12, 0.0, (noise2(xz * 3.1 + 5.0) - 0.5) * 0.12));
        vec3 effN = normalize(mix(N, snowN, snowMask));

        float NdotL = max(dot(effN, L), 0.0);
        float hemi = 0.5 + 0.5 * effN.y;
        vec3 ambient = mix(uHemisphereGround, uHemisphereSky, hemi);
        // Cool sky scatter tint on snow shadows
        vec3 snowShadowTint = mix(ambient, uHemisphereSky * 0.92 + vec3(0.10, 0.15, 0.24), 0.45);
        vec3 effAmbient = mix(ambient, snowShadowTint, snowMask);

        vec3 hv = L + V;
        vec3 H = dot(hv, hv) > 1e-6 ? normalize(hv) : effN;
        float wetSpec = pow(max(dot(effN, H), 0.0), 46.0) * wetAmount * (1.0 - snowMask) * 0.55;
        float sparkleHash = hash21(floor(xz * 18.0) + floor(V.xz * 6.0));
        float snowSparkle = step(0.982, sparkleHash) * pow(max(dot(effN, H), 0.0), 18.0) * snowMask * 0.95;

        float rim = pow(1.0 - clamp(dot(effN, V), 0.0, 1.0), 3.2) * 0.14;
        vec3 surfaceCol = mix(albedo, snowAlbedo, snowMask);

        vec3 lit = surfaceCol * (effAmbient * 0.68 + uSunColor * NdotL * 0.98)
          + uSunColor * (wetSpec + snowSparkle)
          + uHemisphereSky * rim * (0.35 + 0.65 * snowMask);

        lit = applyExpFog(lit, vWorldPos, uFogColor, uFogDensity);
        gl_FragColor = vec4(lit, 1.0);
      }
    `,
  });
}

export function createBarkMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: { value: new THREE.Vector3(0.45, 0.72, -0.52).normalize() },
      uSunColor: { value: new THREE.Color(0xfff1d6) },
      uHemisphereSky: { value: new THREE.Color(0x88b4e6) },
      uHemisphereGround: { value: new THREE.Color(0x283520) },
      uFogColor: { value: new THREE.Color(0x9fb8cc) },
      uFogDensity: { value: 0.0085 },
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

      void main() {
        #ifdef USE_INSTANCING
          mat4 instMat = instanceMatrix;
        #else
          mat4 instMat = mat4(1.0);
        #endif

        vec4 instPos = instMat * vec4(position, 1.0);
        vec3 basePos = instMat[3].xyz;
        float h = max(instPos.y - basePos.y, 0.0);
        float phase = basePos.x * 0.23 + basePos.z * 0.19;
        float swayAmt = (h * h * 0.0018) * uWindStrength;
        instPos.x += swayAmt * (sin(uTime * 1.35 + phase) + 0.35 * sin(uTime * 2.8 + phase * 1.7));
        instPos.z += swayAmt * 0.65 * cos(uTime * 1.15 + phase * 1.3);

        vec4 worldPos = modelMatrix * instPos;
        vWorldPos = worldPos.xyz;

        mat3 instNormalMat = mat3(instMat);
        vec3 instNorm = normalize(instNormalMat * normal);
        vWorldNormal = normalize(mat3(modelMatrix) * instNorm);
        vUv = uv;
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
      uniform float uCanopySnow;
      uniform float uWetness;

      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec2 vUv;

      ${GLSL_NOISE_AND_FOG}

      void main() {
        vec3 N = normalize(vWorldNormal);
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 L = normalize(uSunDir);

        float furrow = sin(vUv.x * 54.0 + fbm4(vec2(vUv.x * 8.0, vUv.y * 14.0)) * 5.0) * 0.5 + 0.5;
        float barkGrain = fbm4(vec2(vUv.x * 16.0, vUv.y * 28.0 + vWorldPos.y * 0.6));

        vec3 barkDark = vec3(0.18, 0.125, 0.09);
        vec3 barkWarm = vec3(0.36, 0.26, 0.19);
        vec3 barkCol = mix(barkDark, barkWarm, furrow * 0.6 + barkGrain * 0.4);

        // Damp bark darkening
        barkCol *= mix(1.0, 0.58, clamp(uWetness, 0.0, 1.0));

        // Frost / snow dusting on windward & upward faces
        float windward = clamp(N.x * 0.45 + N.z * 0.35 + 0.2, 0.0, 1.0);
        float snowDust = smoothstep(0.15, 0.85, N.y * 0.75 + windward * 0.55) * uCanopySnow * 0.78;
        vec3 albedo = mix(barkCol, vec3(0.88, 0.93, 0.99), snowDust);

        float NdotL = max(dot(N, L), 0.0);
        float hemi = 0.5 + 0.5 * N.y;
        vec3 ambient = mix(uHemisphereGround, uHemisphereSky, hemi);

        vec3 hv = L + V;
        vec3 H = dot(hv, hv) > 1e-6 ? normalize(hv) : N;
        float wetSpec = pow(max(dot(N, H), 0.0), 28.0) * uWetness * (1.0 - snowDust) * 0.22;

        vec3 lit = albedo * (ambient * 0.62 + uSunColor * NdotL * 0.92) + uSunColor * wetSpec;
        lit = applyExpFog(lit, vWorldPos, uFogColor, uFogDensity);
        gl_FragColor = vec4(lit, 1.0);
      }
    `,
  });
}

export function createCanopyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: { value: new THREE.Vector3(0.45, 0.72, -0.52).normalize() },
      uSunColor: { value: new THREE.Color(0xfff1d6) },
      uHemisphereSky: { value: new THREE.Color(0x88b4e6) },
      uHemisphereGround: { value: new THREE.Color(0x283520) },
      uFogColor: { value: new THREE.Color(0x9fb8cc) },
      uFogDensity: { value: 0.0085 },
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
          vColor = vec3(0.18, 0.42, 0.20);
        #endif

        vec4 instPos = instMat * vec4(position, 1.0);
        vec3 basePos = instMat[3].xyz;
        float h = max(instPos.y - basePos.y, 0.0);
        float phase = basePos.x * 0.23 + basePos.z * 0.19;

        // Trunk-matched sway so crowns stay locked onto trunks
        float swayAmt = (h * h * 0.0018) * uWindStrength;
        instPos.x += swayAmt * (sin(uTime * 1.35 + phase) + 0.35 * sin(uTime * 2.8 + phase * 1.7));
        instPos.z += swayAmt * 0.65 * cos(uTime * 1.15 + phase * 1.3);

        // Local branch/needle flutter
        float flutterPhase = instPos.x * 1.35 + instPos.z * 1.15 + instPos.y * 0.9;
        float flutter = uWindStrength * (0.045 + 0.015 * h);
        instPos.x += sin(uTime * 3.6 + flutterPhase) * flutter;
        instPos.y += cos(uTime * 4.1 + flutterPhase * 1.2) * flutter * 0.45;

        vec4 worldPos = modelMatrix * instPos;
        vWorldPos = worldPos.xyz;
        vCrownHeight = clamp((position.y - 0.15) * 1.1, 0.0, 1.0);

        mat3 instNormalMat = mat3(instMat);
        vec3 instNorm = normalize(instNormalMat * normal);
        vWorldNormal = normalize(mat3(modelMatrix) * instNorm);
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
      uniform float uCanopySnow;
      uniform float uWetness;

      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec3 vColor;
      varying float vCrownHeight;

      ${GLSL_NOISE_AND_FOG}

      void main() {
        vec3 N = normalize(vWorldNormal);
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 L = normalize(uSunDir);

        float leafTex = fbm4(vWorldPos.xz * 2.2 + vWorldPos.y * 1.7);
        vec3 foliage = vColor * (0.76 + 0.46 * leafTex);
        // Deep forest shade on lower inner boughs
        foliage *= mix(0.66, 1.08, vCrownHeight * 0.55 + 0.45 * clamp(N.y * 0.5 + 0.5, 0.0, 1.0));
        // Wet sheen darkening
        foliage *= mix(1.0, 0.78, clamp(uWetness, 0.0, 1.0));

        // Upward-facing snow accumulation frosting pine boughs & crowns
        float snowNoise = noise2(vWorldPos.xz * 1.8 + vWorldPos.y);
        float snowCap = smoothstep(0.18, 0.72, N.y + (snowNoise - 0.5) * 0.25) * uCanopySnow;
        snowCap = clamp(snowCap * (0.75 + 0.45 * vCrownHeight), 0.0, 0.94);
        vec3 snowCol = vec3(0.91, 0.955, 1.0);
        vec3 albedo = mix(foliage, snowCol, snowCap);

        // Wrap diffuse + translucent subsurface back-scattering glow
        float wrapDiff = max((dot(N, L) + 0.35) / 1.35, 0.0);
        float backLight = pow(max(dot(-V, L), 0.0), 3.0) * max(L.y + 0.15, 0.0) * (1.0 - snowCap * 0.85);
        vec3 sssGlow = foliage * vec3(1.4, 1.55, 0.7) * backLight * 0.42;

        float hemi = 0.5 + 0.5 * N.y;
        vec3 ambient = mix(uHemisphereGround, uHemisphereSky, hemi);

        vec3 hv = L + V;
        vec3 H = dot(hv, hv) > 1e-6 ? normalize(hv) : N;
        float wetSpec = pow(max(dot(N, H), 0.0), 26.0) * uWetness * (1.0 - snowCap) * 0.24;
        float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0) * 0.16;

        vec3 lit = albedo * (ambient * 0.66 + uSunColor * wrapDiff * 0.94)
          + uSunColor * (sssGlow + wetSpec)
          + uHemisphereSky * rim * (0.25 + 0.75 * snowCap);

        lit = applyExpFog(lit, vWorldPos, uFogColor, uFogDensity);
        gl_FragColor = vec4(lit, 1.0);
      }
    `,
  });
}

export function createGrassMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      uSunDir: { value: new THREE.Vector3(0.45, 0.72, -0.52).normalize() },
      uSunColor: { value: new THREE.Color(0xfff1d6) },
      uHemisphereSky: { value: new THREE.Color(0x88b4e6) },
      uHemisphereGround: { value: new THREE.Color(0x283520) },
      uFogColor: { value: new THREE.Color(0x9fb8cc) },
      uFogDensity: { value: 0.0085 },
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
          vColor = vec3(0.28, 0.52, 0.21);
        #endif

        vec3 baseWorld = (modelMatrix * vec4(instMat[3].xyz, 1.0)).xyz;
        float camDist = length(cameraPosition - baseWorld);
        float lodScale = 1.0 - smoothstep(55.0, 110.0, camDist);
        vLodFade = lodScale;

        // Shrink blades smoothly to zero beyond 110m
        vec3 localPos = position * lodScale;

        // Traveling wind gust wave across world (x, z)
        float tipFactor = uv.y * uv.y;
        float gustWave = sin(baseWorld.x * 0.16 + baseWorld.z * 0.11 - uTime * (1.7 + uWindStrength * 2.6)) * 0.5 + 0.5;
        float rustle = sin(uTime * 4.2 + baseWorld.x * 1.9 + baseWorld.z * 2.3);
        float windBend = (0.08 + uWindStrength * 0.46) * (0.35 + 0.65 * gustWave) + rustle * 0.045 * uWindStrength;

        // Snow-weight droop bends blades down and buries them slightly as snow deepens
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
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uHemisphereSky;
      uniform vec3 uHemisphereGround;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
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

        vec3 N = normalize(vWorldNormal);
        if (!gl_FrontFacing) N = -N;
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 L = normalize(uSunDir);

        // Lush woodland green -> golden/amber tip variation + root AO
        vec3 tipTint = vColor * vec3(1.26, 1.20, 0.72);
        vec3 bladeCol = mix(vColor, tipTint, smoothstep(0.52, 1.0, vUv.y));
        bladeCol *= mix(0.45, 1.06, smoothstep(0.0, 0.65, vUv.y));
        bladeCol *= mix(1.0, 0.74, clamp(uWetness, 0.0, 1.0));

        // Frost & snow coating on grass
        float frostNoise = noise2(vWorldPos.xz * 1.4);
        float snowCoat = smoothstep(0.08, 0.85, uSnowCoverage * (0.75 + 0.45 * vUv.y) - frostNoise * 0.22);
        vec3 albedo = mix(bladeCol, vec3(0.91, 0.955, 1.0), snowCoat * 0.92);

        float wrapDiff = max((dot(N, L) + 0.45) / 1.45, 0.0);
        float trans = pow(max(dot(-V, L), 0.0), 2.5) * vUv.y * (1.0 - snowCoat * 0.8) * 0.48;
        float hemi = 0.5 + 0.5 * N.y;
        vec3 ambient = mix(uHemisphereGround, uHemisphereSky, hemi);

        vec3 hv = L + V;
        vec3 H = dot(hv, hv) > 1e-6 ? normalize(hv) : N;
        float wetSpec = pow(max(dot(N, H), 0.0), 24.0) * uWetness * (1.0 - snowCoat) * 0.28;

        vec3 lit = albedo * (ambient * 0.68 + uSunColor * wrapDiff * 0.96)
          + uSunColor * (bladeCol * trans + wetSpec);

        lit = applyExpFog(lit, vWorldPos, uFogColor, uFogDensity);
        gl_FragColor = vec4(lit, 1.0);
      }
    `,
  });
}

export function createFernMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      uSunDir: { value: new THREE.Vector3(0.45, 0.72, -0.52).normalize() },
      uSunColor: { value: new THREE.Color(0xfff1d6) },
      uHemisphereSky: { value: new THREE.Color(0x88b4e6) },
      uHemisphereGround: { value: new THREE.Color(0x283520) },
      uFogColor: { value: new THREE.Color(0x9fb8cc) },
      uFogDensity: { value: 0.0085 },
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
          vColor = vec3(0.18, 0.46, 0.18);
        #endif

        vec3 baseWorld = (modelMatrix * vec4(instMat[3].xyz, 1.0)).xyz;
        float camDist = length(cameraPosition - baseWorld);
        vLodFade = 1.0 - smoothstep(68.0, 125.0, camDist);

        vec3 localPos = position * vLodFade;
        float tip = uv.y;
        float phase = baseWorld.x * 0.75 + baseWorld.z * 0.92;
        float sway = sin(uTime * 2.5 + phase) * (0.03 + uWindStrength * 0.14) * tip * tip;
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
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uHemisphereSky;
      uniform vec3 uHemisphereGround;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
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

        vec3 N = normalize(vWorldNormal);
        if (!gl_FrontFacing) N = -N;
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 L = normalize(uSunDir);

        // Pinnae / midrib shading pattern across frond UV
        float pinnae = 0.85 + 0.15 * sin(vUv.y * 42.0) * (1.0 - abs(vUv.x - 0.5) * 1.8);
        vec3 fernCol = vColor * pinnae * mix(0.65, 1.12, vUv.y);
        fernCol *= mix(1.0, 0.74, clamp(uWetness, 0.0, 1.0));

        float snowAmt = max(uSnowCoverage, uCanopySnow * 0.9);
        float snowMask = smoothstep(0.12, 0.75, snowAmt * (0.55 + 0.55 * max(N.y, 0.0)));
        vec3 albedo = mix(fernCol, vec3(0.90, 0.95, 1.0), snowMask * 0.90);

        float wrapDiff = max((dot(N, L) + 0.4) / 1.4, 0.0);
        float sss = pow(max(dot(-V, L), 0.0), 2.5) * (1.0 - snowMask * 0.85) * 0.36;
        float hemi = 0.5 + 0.5 * N.y;
        vec3 ambient = mix(uHemisphereGround, uHemisphereSky, hemi);

        vec3 hv = L + V;
        vec3 H = dot(hv, hv) > 1e-6 ? normalize(hv) : N;
        float wetSpec = pow(max(dot(N, H), 0.0), 28.0) * uWetness * (1.0 - snowMask) * 0.25;

        vec3 lit = albedo * (ambient * 0.65 + uSunColor * wrapDiff * 0.92)
          + uSunColor * (fernCol * sss + wetSpec);

        lit = applyExpFog(lit, vWorldPos, uFogColor, uFogDensity);
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
      uHemisphereSky: { value: new THREE.Color(0x88b4e6) },
      uHemisphereGround: { value: new THREE.Color(0x283520) },
      uFogColor: { value: new THREE.Color(0x9fb8cc) },
      uFogDensity: { value: 0.0085 },
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
          vColor = vec3(0.42, 0.45, 0.48);
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
      uniform float uSnowCoverage;
      uniform float uWetness;

      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec3 vColor;

      ${GLSL_NOISE_AND_FOG}

      void main() {
        vec3 N = normalize(vWorldNormal);
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 L = normalize(uSunDir);

        float grain = fbm4(vWorldPos.xz * 2.5 + vWorldPos.y * 1.9);
        vec3 stone = vColor * (0.72 + 0.52 * grain);

        // Woodland moss cap on top faces
        float mossNoise = noise2(vWorldPos.xz * 3.1);
        float mossMask = smoothstep(0.42, 0.82, N.y + (mossNoise - 0.5) * 0.25);
        vec3 mossCol = vec3(0.21, 0.36, 0.16) * (0.8 + 0.35 * grain);
        vec3 baseCol = mix(stone, mossCol, mossMask * 0.85);

        baseCol *= mix(1.0, 0.58, clamp(uWetness, 0.0, 1.0));

        // Thick snow cap as uSnowCoverage increases
        float snowCap = smoothstep(0.22, 0.72, N.y + (grain - 0.5) * 0.18) * smoothstep(0.02, 0.72, uSnowCoverage);
        vec3 albedo = mix(baseCol, vec3(0.93, 0.965, 1.0), snowCap);

        float NdotL = max(dot(N, L), 0.0);
        float hemi = 0.5 + 0.5 * N.y;
        vec3 ambient = mix(uHemisphereGround, uHemisphereSky, hemi);

        vec3 hv = L + V;
        vec3 H = dot(hv, hv) > 1e-6 ? normalize(hv) : N;
        float wetSpec = pow(max(dot(N, H), 0.0), 38.0) * uWetness * (1.0 - snowCap) * 0.45;

        vec3 lit = albedo * (ambient * 0.65 + uSunColor * NdotL * 0.95) + uSunColor * wetSpec;
        lit = applyExpFog(lit, vWorldPos, uFogColor, uFogDensity);
        gl_FragColor = vec4(lit, 1.0);
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
      uZenithColor: { value: new THREE.Color(0x2c68a8) },
      uHorizonColor: { value: new THREE.Color(0xaac7df) },
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
        vec3 dir = normalize(vDir);
        vec3 L = normalize(uSunDir);
        float up = clamp(dir.y, 0.0, 1.0);

        vec3 sky = mix(uHorizonColor, uZenithColor, pow(up, 0.52));

        // Soft animated cloud wisps
        vec2 cloudUv = dir.xz / (max(dir.y, 0.14)) * 1.4 + vec2(uTime * 0.012, uTime * 0.006);
        float cloud = fbm4(cloudUv);
        float cloudMask = smoothstep(0.45 - uOvercast * 0.35, 0.82 - uOvercast * 0.25, cloud) * smoothstep(0.02, 0.35, up);
        vec3 cloudCol = mix(uHorizonColor * 1.05, uHorizonColor * 0.85, uOvercast);
        sky = mix(sky, cloudCol, cloudMask * (0.35 + 0.55 * uOvercast));

        // Sun glow & disc (attenuated by overcast)
        float sunDot = max(dot(dir, L), 0.0);
        float sunVis = (1.0 - uOvercast * 0.88) * smoothstep(-0.08, 0.12, L.y);
        sky += uSunColor * pow(sunDot, 12.0) * 0.35 * sunVis;
        sky += uSunColor * smoothstep(0.9985, 0.9996, sunDot) * 1.8 * sunVis;

        // Subtle night stars
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
        // Thin wind-tilted rain streak
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

        float pulse = 0.25 + 0.75 * pow(0.5 + 0.5 * sin(uTime * (1.8 + aSeed * 1.4) + aSeed * 31.0), 2.0);
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
