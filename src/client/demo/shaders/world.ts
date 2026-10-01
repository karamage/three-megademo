import { noiseGLSL, skyGLSL, skyUniformsGLSL } from "./common";

export const WAVE_COUNT = 12;

// ---------------------------------------------------------------- sky dome
export const skyVert = /* glsl */ `
out vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

export const skyFrag = /* glsl */ `
${skyUniformsGLSL}
${noiseGLSL}
${skyGLSL}
in vec3 vDir;
out vec4 fragColor;
void main() {
  fragColor = vec4(sky(normalize(vDir)), 1.0);
}
`;

// ---------------------------------------------------------------- ocean
const wavesGLSL = /* glsl */ `
#define NW ${WAVE_COUNT}
uniform vec4 uWaves[NW];
uniform float uWaveScale;
uniform float uWaveTime;
`;

export const oceanVert = /* glsl */ `
${wavesGLSL}
uniform float uGridRadius;
uniform float uGridRes;
out vec3 vWorld;
out vec3 vNormal;
out float vCrest;

void main() {
  vec2 g = position.xy;
  float r = length(g);
  float rr = uGridRadius * pow(r, 3.0);
  vec2 off = r > 0.0 ? g / r * rr : vec2(0.0);
  vec2 base = cameraPosition.xz + off;
  float spacing = uGridRadius * 3.0 * pow(max(r, 0.004), 2.0) * (2.0 / uGridRes);

  vec3 disp = vec3(0.0);
  vec3 T = vec3(1.0, 0.0, 0.0);
  vec3 B = vec3(0.0, 0.0, 1.0);
  float crest = 0.0;
  for (int i = 0; i < NW; i++) {
    vec4 w = uWaves[i];
    float L = w.w;
    float fade = clamp(L / (spacing * 5.0) - 0.6, 0.0, 1.0);
    float k = 6.28318 / L;
    float c = sqrt(9.81 / k);
    vec2 dd = normalize(w.xy);
    float steep = w.z * uWaveScale * fade;
    float a = steep / k;
    float f = k * (dot(dd, base) - c * uWaveTime) + float(i) * 1.7;
    float s = sin(f);
    float co = cos(f);
    disp += vec3(dd.x * a * co, a * s, dd.y * a * co);
    T += vec3(-dd.x * dd.x * steep * s, dd.x * steep * co, -dd.x * dd.y * steep * s);
    B += vec3(-dd.x * dd.y * steep * s, dd.y * steep * co, -dd.y * dd.y * steep * s);
    crest += steep * s;
  }
  vec3 wp = vec3(base.x, 0.0, base.y) + disp;
  vNormal = normalize(cross(B, T));
  vWorld = wp;
  vCrest = crest;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

export const oceanFrag = /* glsl */ `
${noiseGLSL}
uniform float uTime;
uniform samplerCube uEnv;
uniform sampler2D uNormalMap;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform float uSunSpec;
uniform float uMoonSpec;
uniform vec3 uDeepColor;
uniform vec3 uScatterColor;
uniform float uFogDensity;
uniform vec3 uFogColor;
uniform float uBio;
uniform float uPulse;
uniform float uFoam;
uniform float uDetail;
uniform float uWaveScale;
uniform vec4 uRipples[8];
uniform vec3 uOrbPos;
uniform vec3 uOrbColor;
uniform float uOrbGlow;
uniform float uDiamond;
uniform vec3 uDiamondDir;
in vec3 vWorld;
in vec3 vNormal;
in float vCrest;
out vec4 fragColor;

void main() {
  vec3 V = cameraPosition - vWorld;
  float dist = length(V);
  V /= dist;
  vec3 N = normalize(vNormal);
  vec2 uv = vWorld.xz;

  float detailFade = exp(-dist * 0.01) * uDetail;
  vec2 n1 = texture(uNormalMap, uv * 0.029 + uTime * vec2(0.004, 0.009)).xy * 2.0 - 1.0;
  vec2 n2 = texture(uNormalMap, uv * 0.081 + uTime * vec2(-0.011, 0.003)).xy * 2.0 - 1.0;
  vec2 n3 = texture(uNormalMap, uv * 0.0063 + uTime * vec2(0.0015, -0.002)).xy * 2.0 - 1.0;
  vec2 dn = (n1 * 0.55 + n2 * 0.4) * detailFade + n3 * 0.22 * (0.4 + uWaveScale);

  float ringGlow = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 rp = uRipples[i];
    float age = uTime - rp.z;
    if (age < 0.0 || age > 9.0 || rp.w <= 0.0) continue;
    vec2 dv = uv - rp.xy;
    float r = length(dv);
    float front = age * 7.0;
    float width = 1.5 + age * 0.9;
    float env = exp(-pow((r - front) / width, 2.0)) * exp(-age * 0.42) * rp.w;
    float ph = (r - front) * 2.4;
    dn += (dv / max(r, 1e-3)) * cos(ph) * env * 0.5;
    ringGlow += env * (0.55 + 0.45 * sin(ph));
  }
  N = normalize(N + vec3(dn.x, 0.0, dn.y));

  float NdV = dot(N, V);
  if (NdV < 0.03) { N = normalize(N + V * (0.03 - NdV)); NdV = dot(N, V); }
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  float F = 0.02 + 0.98 * pow(1.0 - clamp(NdV, 0.0, 1.0), 5.0);

  float lod = clamp(log2(dist * 0.08 + 1.0), 0.0, 4.0);
  vec3 refl = textureLod(uEnv, R, lod).rgb;

  float sd = length(R - uSunDir);
  float md = length(R - uMoonDir);
  vec3 spec = vec3(1.0, 0.88, 0.72) * (exp(-sd * sd / 1.6e-4) * 90.0 + exp(-sd * sd / 0.006) * 5.0 + exp(-sd * 5.0) * 0.35) * uSunSpec;
  spec += vec3(0.82, 0.9, 1.0) * (exp(-md * md / 2.2e-4) * 40.0 + exp(-md * md / 0.006) * 0.8 + exp(-md * 6.0) * 0.04) * uMoonSpec;
  float dd = length(R - uDiamondDir);
  spec += vec3(1.0, 0.96, 0.9) * exp(-dd * dd / 4e-4) * 60.0 * uDiamond;

  vec3 Lo = uOrbPos - vWorld;
  float dO = length(Lo);
  vec3 lo = Lo / dO;
  float ol = length(R - lo);
  vec3 orbLight = uOrbColor * uOrbGlow * (exp(-ol * ol / 0.004) * 5.0 + 6.0 / (1.0 + dO * dO * 0.015) * (0.3 + 0.7 * max(dot(N, lo), 0.0)) * 0.25);

  float crest = clamp(vCrest * 1.1 + 0.25, 0.0, 1.0);
  vec3 L = normalize(uSunDir * uSunSpec + uMoonDir * uMoonSpec * 0.4 + vec3(0.0, 0.02, 0.0));
  float sss = pow(max(dot(V, -normalize(L + N * 0.7)), 0.0), 3.0);
  vec3 body = uDeepColor + uScatterColor * (crest * crest * 0.55 + sss * crest * 1.4);

  vec3 col = mix(body, refl, F) + spec * (0.25 + F) + orbLight;

  float fn = texture(uNormalMap, uv * 0.11 - uTime * 0.01).b;
  float foam = smoothstep(0.72, 1.0, crest + fn * 0.3 - 0.12) * uFoam * uWaveScale;
  col = mix(col, vec3(0.75, 0.82, 0.9) * (0.2 + 0.8 * max(uSunSpec, 0.15)), foam * 0.5);

  // bioluminescence
  if (uBio > 0.001) {
    vec2 sp = uv * 1.6;
    vec2 ci = floor(sp);
    vec2 cf = fract(sp) - 0.5;
    float hh = hash12(ci);
    vec2 o = (vec2(hash12(ci + 3.1), hash12(ci + 7.7)) - 0.5) * 0.7;
    float tw = pow(0.5 + 0.5 * sin(uTime * (0.8 + hh * 2.5) + hh * 40.0), 6.0);
    float sparkle = smoothstep(0.045, 0.0, length(cf - o)) * tw * step(0.55, hh) * exp(-dist * 0.03);
    float flow = fbm2(uv * 0.12 + vec2(uTime * 0.03, -uTime * 0.02));
    // thin glowing filaments that ride the crests
    float fil = 1.0 - abs(fn * 2.0 - 1.0);
    fil = pow(fil, 10.0) * smoothstep(0.35, 0.8, crest + flow * 0.3);
    float bioMask = fil * 1.4 + smoothstep(0.82, 1.0, crest + fn * 0.15) * 0.5;
    vec3 bioCol = mix(vec3(0.0, 0.5, 1.0), vec3(0.15, 1.0, 0.85), flow);
    col += bioCol * (bioMask + sparkle * 4.0) * uBio * (1.0 + uPulse * 1.5) * exp(-dist * 0.008);
  }
  col += vec3(0.25, 0.85, 1.0) * ringGlow * 2.2 * exp(-dist * 0.004);

  // horizon haze: a uniform tint (sampling the env here would smear the moon disk into a column)
  vec3 fogCol = uFogColor;
  float fog = 1.0 - exp(-dist * uFogDensity);
  col = mix(col, fogCol, fog);

  fragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------- orb
export const orbVert = /* glsl */ `
${noiseGLSL}
uniform float uTime;
uniform float uWobble;
uniform float uPulse;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vObj;

vec3 displace(vec3 n) {
  float w = noise3(n * 1.5 + vec3(0.0, uTime * 0.32, 0.0)) * 2.0 - 1.0;
  float w2 = noise3(n * 3.4 - vec3(uTime * 0.45)) * 2.0 - 1.0;
  float h = w * 0.075 + w2 * 0.028;
  h += sin(n.y * 4.0 + uTime * 1.1) * 0.025 + sin(n.x * 3.0 - uTime * 0.8) * 0.02;
  h += uPulse * 0.035 * sin(n.x * 6.0 + n.z * 5.0 + uTime * 9.0);
  return n * (1.0 + h * uWobble);
}

void main() {
  vec3 n = normalize(position);
  vec3 p = displace(n);
  vec3 t = normalize(cross(n, abs(n.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 b = cross(n, t);
  float e = 0.01;
  vec3 p1 = displace(normalize(n + t * e));
  vec3 p2 = displace(normalize(n + b * e));
  vec3 nn = normalize(cross(p1 - p, p2 - p));
  if (dot(nn, n) < 0.0) nn = -nn;
  vObj = n;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * nn);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const orbFrag = /* glsl */ `
${noiseGLSL}
uniform float uTime;
uniform sampler2D uScene;
uniform samplerCube uEnv;
uniform vec2 uResolution;
uniform mat4 uViewProj;
uniform vec3 uCenter;
uniform float uRadius;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform float uSunSpec;
uniform float uMoonSpec;
uniform vec3 uGlowColor;
uniform float uGlow;
uniform float uDissolve;
uniform float uPulse;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vObj;
out vec4 fragColor;

vec3 sampleThrough(vec3 dir, vec3 from) {
  vec3 P = from + dir * 80.0;
  vec4 c = uViewProj * vec4(P, 1.0);
  vec3 env = textureLod(uEnv, dir, 1.0).rgb;
  if (c.w <= 0.0) return env;
  vec2 uv = c.xy / c.w * 0.5 + 0.5;
  float inb = smoothstep(-0.05, 0.15, uv.x) * smoothstep(1.05, 0.85, uv.x) * smoothstep(-0.05, 0.15, uv.y) * smoothstep(1.05, 0.85, uv.y);
  return mix(env, texture(uScene, clamp(uv, 0.001, 0.999)).rgb, inb);
}

vec3 refractChannel(vec3 V, vec3 N, float ior, out float pathLen) {
  vec3 d1 = refract(-V, N, 1.0 / ior);
  vec3 oc = vWorld - uCenter;
  float t = max(-2.0 * dot(oc, d1), 0.0);
  pathLen = t;
  vec3 ex = vWorld + d1 * t;
  vec3 Ne = normalize(ex - uCenter);
  vec3 d2 = refract(d1, -Ne, ior);
  if (dot(d2, d2) < 0.01) d2 = reflect(d1, -Ne);
  return sampleThrough(normalize(d2), ex);
}

void main() {
  float dn = noise3(vObj * 4.0 + uTime * 0.1) * 0.55 + noise3(vObj * 13.0) * 0.3 + noise3(vObj * 37.0) * 0.15;
  if (dn < uDissolve) discard;
  float edge = uDissolve > 0.001 ? smoothstep(uDissolve + 0.035, uDissolve, dn) : 0.0;

  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorld);
  float NdV = clamp(dot(N, V), 0.0, 1.0);
  float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);

  float l1, l2, l3;
  vec3 refr;
  refr.r = refractChannel(V, N, 1.326, l1).r;
  refr.g = refractChannel(V, N, 1.333, l2).g;
  refr.b = refractChannel(V, N, 1.342, l3).b;
  float path = l2 / max(uRadius, 0.001);
  refr *= exp(-path * vec3(0.16, 0.05, 0.03));

  vec3 R = reflect(-V, N);
  vec3 refl = textureLod(uEnv, R, 0.0).rgb;
  float sd = length(R - uSunDir);
  float md = length(R - uMoonDir);
  vec3 spec = vec3(1.0, 0.9, 0.8) * exp(-sd * sd / 8e-5) * 120.0 * uSunSpec
            + vec3(0.85, 0.9, 1.0) * exp(-md * md / 1.2e-4) * 40.0 * uMoonSpec;

  float caus = pow(1.0 - abs(noise3(vObj * 2.6 + vec3(0.0, uTime * 0.35, uTime * 0.2)) * 2.0 - 1.0), 10.0);
  caus += pow(1.0 - abs(noise3(vObj * 5.3 - uTime * 0.3) * 2.0 - 1.0), 14.0) * 0.6;
  vec3 inner = uGlowColor * (caus * 0.1 + 0.02) * uGlow * (1.0 + uPulse * 2.0) * (0.3 + 0.7 * NdV);
  vec3 rim = uGlowColor * pow(1.0 - NdV, 4.0) * uGlow * 0.6;

  vec3 col = refr * (1.0 - F) + refl * F + spec + inner + rim;
  col += mix(vec3(0.6, 0.95, 1.0), vec3(1.0, 0.8, 0.5), uGlowColor.r) * edge * 6.0;
  fragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------- particles
export const particleVert = /* glsl */ `
${noiseGLSL}
${wavesGLSL}
uniform float uTime;
uniform float uStage;
uniform vec3 uOrbPos;
uniform float uOrbRadius;
uniform float uRiseTime;
uniform float uBurst;
uniform float uPulse;
uniform float uSize;
uniform float uPixelRatio;
uniform float uSpaceY;
in vec4 aSeed;
out vec3 vColor;
out float vAlpha;

mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1, 0, 0, 0, c, s, 0, -s, c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0, -s, c, 0, 0, 0, 1); }

float waveH(vec2 p) {
  float h = 0.0;
  for (int i = 0; i < 5; i++) {
    vec4 w = uWaves[i];
    float k = 6.28318 / w.w;
    float c = sqrt(9.81 / k);
    h += w.z * uWaveScale / k * sin(k * (dot(normalize(w.xy), p) - c * uWaveTime) + float(i) * 1.7);
  }
  return h;
}

vec3 stDust(vec4 s, vec3 r) {
  vec3 p = (r - 0.5) * vec3(520.0, 360.0, 520.0);
  p.z = mod(p.z + uTime * 7.0 * (0.5 + s.y), 520.0) - 260.0;
  return p + vec3(0.0, uSpaceY, 0.0);
}
vec3 stSea(vec4 s, vec3 r) {
  vec3 p = vec3(mix(-80.0, 80.0, r.x), 0.0, mix(-70.0, 190.0, r.z));
  p.x += sin(uTime * 0.2 + s.z * 30.0) * 1.5;
  p.y = waveH(p.xz) + 0.15 + r.y * r.y * 1.4;
  return p;
}
vec3 stOrbit(vec4 s, vec3 r) {
  if (s.x > 0.86) {
    vec3 d = normalize(r - 0.5 + 1e-3);
    float rad = uOrbRadius * 0.92 * pow(s.y, 0.33);
    d = rotX(uTime * 0.2 * (s.z - 0.5)) * d;
    return uOrbPos + d * rad;
  }
  float ring = floor(s.x / 0.86 * 3.0);
  float rad = uOrbRadius * (1.45 + ring * 0.55 + s.y * s.y * 0.6) * (1.0 + uBurst * (2.0 + s.z * 4.0));
  float ang = s.z * 6.2831 + uTime * (0.32 - ring * 0.07) * (1.0 + 0.6 / (0.5 + s.y));
  vec3 p = vec3(cos(ang) * rad, (s.w - 0.5) * 0.35 * (1.0 + ring) * (1.0 + uBurst * 6.0), sin(ang) * rad);
  p = rotX(0.32 + ring * 0.22) * p;
  p = rotZ(ring * 0.45 - 0.35) * p;
  return uOrbPos + p;
}
vec3 stRise(vec4 s, vec3 r) {
  float t = uRiseTime * (0.6 + s.y * 0.8);
  vec3 dir = normalize(r - 0.5 + vec3(0.0, 0.15, 0.0) + 1e-3);
  vec3 p = uOrbPos + dir * (uOrbRadius * 1.2 + t * (1.5 + s.x * 6.0));
  p.y += t * t * (0.08 + s.z * 0.25);
  p.x += sin(t * 0.7 + s.w * 20.0) * (1.0 + t * 0.3);
  p.z += cos(t * 0.6 + s.z * 20.0) * (1.0 + t * 0.3);
  return p;
}
vec3 stateP(int k, vec4 s, vec3 r) {
  if (k <= 0) return stDust(s, r);
  if (k == 1) return stSea(s, r);
  if (k == 2) return stOrbit(s, r);
  return stRise(s, r);
}
vec3 stateC(int k, vec4 s) {
  if (k <= 0) return mix(vec3(0.55, 0.7, 1.0), vec3(1.0, 0.8, 0.7), s.z) * 0.8;
  if (k == 1) return mix(vec3(0.1, 0.65, 1.0), vec3(0.3, 1.0, 0.85), s.z) * 1.4;
  if (k == 2) return mix(vec3(0.55, 0.9, 1.0), vec3(1.0, 0.95, 0.85), s.y) * 1.2;
  return mix(vec3(1.0, 0.72, 0.38), vec3(1.0, 0.9, 0.7), s.z) * 2.2;
}

float stateS(int k) {
  if (k <= 0) return 4.0;
  if (k == 1) return 1.0;
  if (k == 2) return 0.75;
  return 2.6;
}

void main() {
  vec4 s = aSeed;
  vec3 r = position;
  float st = clamp(uStage, 0.0, 3.0);
  int k = int(floor(st));
  float f = st - float(k);
  if (k >= 3) { k = 2; f = 1.0; }
  float pf = smoothstep(s.w * 0.5, s.w * 0.5 + 0.5, f);
  vec3 a = stateP(k, s, r);
  vec3 b = f > 0.0 ? stateP(k + 1, s, r) : a;
  vec3 p = mix(a, b, pf);
  float arc = sin(pf * 3.14159);
  p += (vec3(noise3(r * 10.0 + 1.0), noise3(r * 10.0 + 9.0) + 0.6, noise3(r * 10.0 + 17.0)) - 0.5) * arc * 10.0;
  if (k == 1) {
    // the sea gives itself up: a rising vortex that winds into the orb
    vec3 rel = p - uOrbPos;
    float sw = (1.0 - pf) * 4.0 * arc;
    float cs = cos(sw), sn = sin(sw);
    rel.xz = mat2(cs, -sn, sn, cs) * rel.xz;
    p = uOrbPos + rel;
  }
  vColor = mix(stateC(k, s), stateC(k + 1, s), pf) * (1.0 + arc * 2.5);

  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float twinkle = 0.55 + 0.45 * sin(uTime * (2.0 + s.x * 5.0) + s.y * 50.0);
  float sk = mix(stateS(k), stateS(k + 1), pf) * (1.0 + arc * 1.8);
  float size = sk * uSize * (0.35 + s.y * s.y * 1.6) * (1.0 + uPulse * 0.6) * uPixelRatio * 260.0 / max(-mv.z, 0.1);
  float clamped = clamp(size, 1.5, 48.0 * uPixelRatio);
  // only a few lanterns survive the release; the rest fade into the air
  float riseW = (k == 2) ? pf : 0.0;
  float keep = mix(1.0, s.x < 0.22 ? 1.0 : 0.08, riseW);
  vAlpha = twinkle * min(size / 1.5, 1.0) * smoothstep(0.1, 2.0, -mv.z) * keep;
  gl_PointSize = clamped;
}
`;

export const particleFrag = /* glsl */ `
uniform float uIntensity;
in vec3 vColor;
in float vAlpha;
out vec4 fragColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d2 = dot(c, c);
  float a = exp(-d2 * 18.0) * 0.6 + exp(-d2 * 110.0) * 1.6;
  if (a < 0.01) discard;
  fragColor = vec4(vColor * a * vAlpha * uIntensity, 1.0);
}
`;

// ---------------------------------------------------------------- depth-preserving copy
export const copyVert = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const copyDepthFrag = /* glsl */ `
uniform sampler2D uColor;
uniform sampler2D uDepth;
in vec2 vUv;
out vec4 fragColor;
void main() {
  fragColor = texture(uColor, vUv);
  gl_FragDepth = texture(uDepth, vUv).r;
}
`;
