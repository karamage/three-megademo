export const fsVert = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** 13-tap downsample (Jimenez, CoD:AW) with optional soft-knee threshold + Karis average. */
export const downFrag = /* glsl */ `
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uPrefilter;
uniform float uThreshold;
in vec2 vUv;
out vec4 fragColor;
vec3 s(float x, float y) { return texture(uTex, vUv + vec2(x, y) * uTexel).rgb; }
float karis(vec3 c) { return 1.0 / (1.0 + max(c.r, max(c.g, c.b)) * 0.25); }
void main() {
  vec3 a = s(-2.0, 2.0), b = s(0.0, 2.0), c = s(2.0, 2.0);
  vec3 d = s(-2.0, 0.0), e = s(0.0, 0.0), f = s(2.0, 0.0);
  vec3 g = s(-2.0, -2.0), h = s(0.0, -2.0), i = s(2.0, -2.0);
  vec3 j = s(-1.0, 1.0), k = s(1.0, 1.0), l = s(-1.0, -1.0), m = s(1.0, -1.0);
  vec3 col;
  if (uPrefilter > 0.5) {
    vec3 g0 = (j + k + l + m) * 0.25;
    vec3 g1 = (a + b + d + e) * 0.25;
    vec3 g2 = (b + c + e + f) * 0.25;
    vec3 g3 = (d + e + g + h) * 0.25;
    vec3 g4 = (e + f + h + i) * 0.25;
    float w0 = karis(g0) * 0.5, w1 = karis(g1) * 0.125, w2 = karis(g2) * 0.125, w3 = karis(g3) * 0.125, w4 = karis(g4) * 0.125;
    col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
    float br = max(col.r, max(col.g, col.b));
    float knee = uThreshold * 0.6;
    float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-4);
    col *= max(soft, br - uThreshold) / max(br, 1e-4);
    col = min(col, vec3(24.0));
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  fragColor = vec4(col, 1.0);
}
`;

/** 9-tap tent upsample, blended additively onto the next larger mip. */
export const upFrag = /* glsl */ `
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uScatter;
in vec2 vUv;
out vec4 fragColor;
vec3 s(float x, float y) { return texture(uTex, vUv + vec2(x, y) * uTexel).rgb; }
void main() {
  vec3 c = (s(-1.0, 1.0) + s(1.0, 1.0) + s(-1.0, -1.0) + s(1.0, -1.0))
         + (s(0.0, 1.0) + s(-1.0, 0.0) + s(1.0, 0.0) + s(0.0, -1.0)) * 2.0
         + s(0.0, 0.0) * 4.0;
  fragColor = vec4(c / 16.0 * uScatter, 1.0);
}
`;

/** Volumetric light scattering (radial blur toward the light). */
export const raysFrag = /* glsl */ `
uniform sampler2D uTex;
uniform vec2 uLightPos;
uniform float uDensity;
uniform float uDecay;
uniform float uAspect;
uniform float uMaskRadius;
in vec2 vUv;
out vec4 fragColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  const int N = 48;
  vec2 delta = (vUv - uLightPos) * uDensity / float(N);
  vec2 uv = vUv - delta * (0.5 + 0.25 * hash(vUv * 731.0));
  float illum = 1.0;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < N; i++) {
    uv -= delta;
    acc += texture(uTex, uv).rgb * illum;
    illum *= uDecay;
  }
  vec2 dl = (vUv - uLightPos) * vec2(uAspect, 1.0);
  float falloff = 1.0 / (1.0 + dot(dl, dl) * 4.0);
  falloff *= mix(1.0, smoothstep(uMaskRadius * 0.95, uMaskRadius * 1.9, length(dl)), step(0.0001, uMaskRadius));
  fragColor = vec4(acc / float(N) * falloff, 1.0);
}
`;

/** Horizontal anamorphic streak blur. */
export const streakFrag = /* glsl */ `
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uStep;
uniform float uThreshold;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = -6; i <= 6; i++) {
    float fi = float(i);
    float w = exp(-fi * fi / 18.0);
    vec3 c = texture(uTex, vUv + vec2(fi * uStep * uTexel.x, 0.0)).rgb;
    c = max(c - uThreshold, 0.0);
    acc += c * w;
    wsum += w;
  }
  fragColor = vec4(acc / wsum, 1.0);
}
`;

export const finalFrag = /* glsl */ `
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uBloomLow;
uniform sampler2D uRays;
uniform sampler2D uStreak;
uniform sampler2D uDirt;
uniform vec2 uResolution;
uniform float uTime;
uniform float uExposure;
uniform float uBloomStr;
uniform float uRaysStr;
uniform vec3 uRaysColor;
uniform float uStreakStr;
uniform float uGhostStr;
uniform float uDirtStr;
uniform float uFlash;
uniform float uFade;
uniform float uCA;
uniform float uGrain;
uniform float uVignette;
uniform float uSaturation;
uniform float uContrast;
uniform vec3 uLift;
uniform vec3 uGain;
uniform float uLetterbox;
uniform vec4 uOccluder; // xy = uv centre, z = radius (uv.y units), w = strength
uniform float uAspect;
in vec2 vUv;
out vec4 fragColor;

vec3 aces(vec3 x) {
  // Stephen Hill's fitted ACES (RRT+ODT) — keeps highlights soft
  const mat3 ACESIn = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 ACESOut = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  vec3 v = ACESIn * x;
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return clamp(ACESOut * (a / b), 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

void main() {
  vec2 uv = vUv;
  vec2 cuv = uv - 0.5;
  float r2 = dot(cuv, cuv);
  vec2 ca = cuv * uCA * r2 * 0.03;
  vec3 col;
  col.r = texture(uScene, uv - ca).r;
  col.g = texture(uScene, uv - ca * 0.5).g;
  col.b = texture(uScene, uv).b;

  float dirt = texture(uDirt, uv).r;
  float occ = 1.0;
  if (uOccluder.z > 0.0) {
    float od = length((uv - uOccluder.xy) * vec2(uAspect, 1.0));
    occ = mix(1.0 - 0.9 * uOccluder.w, 1.0, smoothstep(uOccluder.z * 0.8, uOccluder.z * 1.15, od));
  }
  vec3 bloom = texture(uBloom, uv).rgb;
  col += bloom * uBloomStr * (1.0 + dirt * uDirtStr) * occ;
  col += texture(uRays, uv).rgb * uRaysStr * uRaysColor * occ;
  col += texture(uStreak, uv).rgb * uStreakStr * vec3(0.55, 0.75, 1.25) * occ;

  // pseudo lens flare: ghosts + halo
  if (uGhostStr > 0.001) {
    vec2 gv = 1.0 - uv;
    vec2 gd = (0.5 - gv) * 0.42;
    vec3 gh = vec3(0.0);
    for (int i = 0; i < 4; i++) {
      vec2 o = gv + gd * float(i);
      float w = pow(max(1.0 - length(0.5 - o) / 0.7071, 0.0), 8.0);
      gh += texture(uBloomLow, o).rgb * w * vec3(0.5 + 0.5 * float(i == 1), 0.8, 1.0 - 0.3 * float(i == 2));
    }
    col += gh * uGhostStr * (1.0 + dirt * 2.0);
  }

  col *= uExposure;
  col = aces(col);

  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSaturation);
  col = clamp((col - 0.5) * uContrast + 0.5, 0.0, 1.0);
  col = col * uGain + uLift * (1.0 - col);

  float vig = smoothstep(1.05, 0.2, length(cuv * vec2(1.0, 1.15)) * 1.15);
  col *= mix(1.0, vig, uVignette);
  col = mix(col, vec3(1.0), uFlash);
  col *= 1.0 - uFade;

  col = toSRGB(clamp(col, 0.0, 1.0));
  float g = hash(uv * uResolution + fract(uTime * 13.7) * 100.0) - 0.5;
  col += g * uGrain;
  col += (hash(uv * uResolution * 1.3 + 7.0) + hash(uv * uResolution * 0.7 + 3.0) - 1.0) / 255.0;

  float lb = uLetterbox * 0.5;
  if (abs(cuv.y) > 0.5 - lb) col = vec3(0.0);
  fragColor = vec4(col, 1.0);
}
`;
