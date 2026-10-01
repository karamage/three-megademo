/** Shared GLSL chunks: hashing, value noise, fbm. */
export const noiseGLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * .1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(.1031, .1030, .0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
float noise2(vec2 x) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float noise3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm2(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * noise2(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 3.1; a *= 0.5; }
  return s;
}
float fbm3(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * noise3(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
  return s;
}
float fbm3lo(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 3; i++) { s += a * noise3(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
  return s / 0.875;
}
`;

/** Uniform block shared by every material that evaluates the sky. */
export const skyUniformsGLSL = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uMoonLightDir;
uniform float uSunRadius;
uniform float uMoonRadius;
uniform float uDay;
uniform float uDawn;
uniform float uSpace;
uniform float uDark;
uniform float uTotality;
uniform float uSunVis;
uniform float uMoonBright;
uniform float uMoonVis;
uniform float uClouds;
uniform float uDiamond;
uniform vec3 uDiamondDir;
uniform float uStarBoost;
uniform vec3 uMilkyN;
uniform float uPixelAngle;
uniform float uHigh;
`;

/**
 * The procedural sky. Evaluated per pixel for the dome and at low resolution
 * into a cubemap that the ocean and the orb use for reflections.
 */
export const skyGLSL = /* glsl */ `
void frame(vec3 c, out vec3 t1, out vec3 t2) {
  vec3 up = abs(c.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  t1 = normalize(cross(up, c));
  t2 = cross(c, t1);
}

vec3 starLayer(vec3 d, float sc, float prob, float seed) {
  vec3 p = d * sc;
  vec3 c = floor(p);
  vec3 h = hash33(c + seed);
  vec3 sp = c + 0.15 + 0.7 * h;
  float dist = length(p - sp);
  float on = step(1.0 - prob, hash13(c * 1.37 + seed + 7.13));
  float mag = pow(hash13(c + seed + 3.7), 5.0);
  float px = uPixelAngle * sc;
  float size = max(0.03 + 0.07 * mag, px * 0.75);
  float energy = (0.03 + 0.07 * mag) / size;
  float b = exp(-dist * dist / (size * size)) * (0.25 + 5.0 * mag) * energy * energy;
  float tw = 0.6 + 0.4 * sin(uTime * (1.3 + 4.0 * h.x) + h.y * 6.2831);
  vec3 col = mix(vec3(0.62, 0.76, 1.0), vec3(1.0, 0.84, 0.66), h.z * h.z);
  return col * b * on * tw;
}

vec3 sky(vec3 d) {
  float h = max(d.y, 0.0);
  float hor2 = pow(1.0 - h, 2.5);
  float hor = pow(1.0 - h, 7.0);
  vec2 sunFlat = normalize(uSunDir.xz + 1e-4);
  float sunSide = pow(max(dot(normalize(d.xz + 1e-4), sunFlat), 0.0) * 0.5 + 0.5, 3.0);

  // ---------------- atmosphere
  vec3 night = mix(vec3(0.0022, 0.005, 0.016), vec3(0.012, 0.03, 0.07), hor2);
  vec3 day = mix(vec3(0.018, 0.1, 0.42), vec3(0.42, 0.62, 0.9), pow(1.0 - h, 4.0));
  vec3 dawn = mix(mix(vec3(0.045, 0.06, 0.2), vec3(0.42, 0.2, 0.38), hor2), vec3(1.25, 0.48, 0.2), hor * (0.45 + 0.9 * sunSide));
  vec3 atm = mix(night, day, uDay);
  atm = mix(atm, dawn, uDawn);
  vec3 ecl = mix(vec3(0.003, 0.006, 0.024), vec3(0.75, 0.3, 0.1), pow(1.0 - h, 14.0));
  ecl = mix(ecl, vec3(0.05, 0.03, 0.09), pow(1.0 - h, 5.0) * (1.0 - pow(1.0 - h, 14.0)) * 0.6);
  atm = mix(atm, ecl, uDark);
  atm *= 1.0 - uSpace;
  // below the horizon (seen through fog / in space)
  atm *= mix(1.0, smoothstep(-0.35, 0.0, d.y), 1.0 - uSpace);
  vec3 col = atm;

  float atmLum = dot(atm, vec3(0.3, 0.6, 0.1));
  float starVis = clamp(max(uSpace, 1.0 - uDay * (1.0 - uDark * 0.85)) - atmLum * 3.0, 0.0, 1.0) * uStarBoost;
  starVis *= mix(smoothstep(-0.02, 0.12, d.y), 1.0, uSpace);

#ifndef SKY_LITE
  // ---------------- milky way & nebula
  if (starVis > 0.001) {
    // galactic coordinates: angle along the band, offset across it
    float mwd = dot(d, uMilkyN);
    vec3 e1 = normalize(cross(uMilkyN, vec3(0.0, 1.0, 0.01)));
    vec3 e2 = cross(uMilkyN, e1);
    float ang = atan(dot(d, e2), dot(d, e1));
    vec2 ring = vec2(cos(ang), sin(ang));
    float warp = (fbm3lo(vec3(ring * 2.0, 3.0)) - 0.5) * 0.12;
    float x = mwd + warp;
    float core = exp(-pow(ang - 0.6, 2.0) * 1.2);
    float width = 0.13 + 0.09 * core;
    float band = exp(-x * x / (width * width));
    float glow = exp(-x * x / (width * width * 6.0));
    vec3 mw = vec3(0.05, 0.08, 0.18) * glow * 0.6;
    float dense = 0.0;
    if (abs(x) < width * 2.6) {
      vec3 gq = vec3(ring * 5.0, x * 15.0);
      float n = fbm3(gq);
      vec3 wq = vec3(ring * 7.0, x * 22.0);
      float w = fbm3lo(wq * 0.6 + 4.0);
      float lanes = fbm3(wq + vec3(w * 3.0, w * 2.0, 0.0) + 7.0);
      float rift = exp(-pow((x - 0.025 * sin(ang * 3.0)) / (width * 0.28), 2.0)) * smoothstep(0.35, 0.6, noise3(vec3(ring * 4.0, 1.0)));
      float lane = clamp(smoothstep(0.46, 0.66, lanes) + rift * 0.75, 0.0, 1.0) * smoothstep(0.95, 0.1, abs(x) / width);
      vec3 body = mix(vec3(0.1, 0.12, 0.3), vec3(0.18, 0.36, 0.5), n);
      body += vec3(1.0, 0.72, 0.48) * core * pow(band, 2.0) * 0.9;
      mw += body * band * (0.45 + 1.1 * n) * (1.0 - lane * 0.85);
      dense = band * (1.0 - lane * 0.7);
    }
    col += mw * 0.7 * starVis;
    if (uSpace > 0.01) {
      vec3 neb = vec3(0.02, 0.2, 0.3) * smoothstep(0.5, 0.85, fbm3lo(d * 1.7 + 30.0))
               + vec3(0.32, 0.05, 0.25) * smoothstep(0.55, 0.9, fbm3lo(d * 2.4 - 7.0));
      col += neb * 0.25 * uSpace * starVis;
    }
    col += starLayer(d, 95.0, 0.5, 0.0) * starVis;
    col += starLayer(d, 210.0, 0.34 + dense * 0.5, 17.0) * starVis;
    col += starLayer(d, 330.0, 0.2 + dense * 0.75, 41.0) * starVis * 0.8;
  }
#else
  if (d.y < 0.0) {
    vec3 horizon = mix(mix(vec3(0.012, 0.03, 0.07), vec3(0.62, 0.78, 0.95), uDay), vec3(1.25, 0.48, 0.2), uDawn * 0.5);
    horizon = mix(horizon, vec3(0.5, 0.2, 0.08), uDark) * (1.0 - uSpace);
    vec3 deep = mix(vec3(0.0, 0.006, 0.016), vec3(0.0, 0.05, 0.08), uDay * (1.0 - uDark));
    col = mix(deep, horizon * 0.8, pow(1.0 + d.y, 12.0));
  }
  {
    float mwd = dot(d, uMilkyN);
    float band = exp(-mwd * mwd * 11.0);
    col += vec3(0.1, 0.16, 0.3) * band * fbm3lo(d * 3.2 + vec3(4.0, 1.0, 0.0)) * 0.5 * starVis;
  }
#endif

  // ---------------- sun, moon geometry
  vec3 st1, st2, mt1, mt2;
  frame(uSunDir, st1, st2);
  frame(uMoonDir, mt1, mt2);
  vec2 suv = vec2(dot(d, st1), dot(d, st2)) / uSunRadius;
  vec2 muv = vec2(dot(d, mt1), dot(d, mt2)) / uMoonRadius;
  float rs = length(suv);
  float rm = length(muv);
  float sFront = step(0.0, dot(d, uSunDir));
  float mFront = step(0.0, dot(d, uMoonDir));
  float aaM = max(fwidth(rm), 0.003) * 1.2;
  float moonMask = mFront * (1.0 - smoothstep(1.0 - aaM, 1.0 + aaM, rm)) * uMoonVis;
  float aaS = max(fwidth(rs), 0.003) * 1.2;
  float sunDisk = sFront * (1.0 - smoothstep(1.0 - aaS, 1.0 + aaS, rs));
  float aboveHorizon = smoothstep(-0.02, 0.01, d.y);

  // sun disk + scattering glow
  float limb = sqrt(max(0.0, 1.0 - rs * rs));
  vec3 sunCol = mix(vec3(1.0, 0.5, 0.22), vec3(1.0, 0.93, 0.82), clamp(uDay + uSpace, 0.0, 1.0));
  col += sunCol * (0.35 + 0.65 * limb) * 60.0 * sunDisk * (1.0 - moonMask) * aboveHorizon;
  float sa = length(d - uSunDir);
  vec3 glowCol = mix(vec3(1.0, 0.55, 0.28), vec3(1.0, 0.86, 0.7), uDay);
  col += glowCol * (exp(-sa * sa / 0.0018) * 2.2 + exp(-sa * 9.0) * 0.35 + exp(-sa * 2.2) * 0.12 * (1.0 - uSpace)) * uSunVis;

  // ---------------- corona & prominences (totality)
  if (uTotality > 0.001 && sFront > 0.5 && rs < 9.0) {
    vec2 dir2 = suv / max(rs, 1e-4);
    float lr = log(max(rs, 1.0));
    float s1 = fbm3lo(vec3(dir2 * 2.6, lr * 0.8 - uTime * 0.02));
    float s2 = noise3(vec3(dir2 * 9.0, lr * 2.0 + uTime * 0.05));
    float s3 = noise3(vec3(dir2 * 22.0, uTime * 0.07));
    float streamer = pow(s1, 3.0) * 4.0 + pow(s2, 4.0) * 1.2 + pow(s3, 6.0) * 0.8;
    float eq = 0.55 + 0.45 * pow(abs(dot(dir2, normalize(vec2(0.94, 0.34)))), 2.0);
    float x = max(rs - 1.0, 0.0);
    float fall = exp(-x * 2.4) * 1.0 + exp(-x * 1.0) * 0.2 * eq;
    float corona = fall * (0.25 + streamer * eq) * smoothstep(0.97, 1.03, rs);
    corona += exp(-x * 18.0) * 2.4 * smoothstep(0.97, 1.0, rs);
    vec3 cc = mix(vec3(1.0, 0.98, 0.95), vec3(0.55, 0.72, 1.0), smoothstep(1.1, 4.0, rs));
    float pr = pow(noise3(vec3(dir2 * 7.0, uTime * 0.06)), 5.0) * 26.0;
    vec3 prom = vec3(1.0, 0.16, 0.32) * pr * smoothstep(0.99, 1.02, rs) * (1.0 - smoothstep(1.03, 1.14, rs));
    col += (cc * corona * 6.0 + prom * 3.0) * uTotality * (1.0 - moonMask * 0.999);
  }

  // ---------------- moon
  if (mFront > 0.5 && rm < 1.05 && uMoonVis > 0.0) {
    float z = sqrt(max(0.0, 1.0 - rm * rm));
    vec3 n = normalize(muv.x * mt1 + muv.y * mt2 - z * uMoonDir);
    vec3 q = n * 2.0;
    float mar = smoothstep(0.44, 0.6, fbm3(q * 1.25 + vec3(4.0, 0.0, 2.0)));
    float alb = 0.82 - 0.4 * mar;
#ifndef SKY_LITE
    alb *= 0.8 + 0.35 * fbm3(q * 8.0);
    // craters at two scales with random radii; bright rims, darker floors
    for (int ci = 0; ci < 2; ci++) {
      float sc = ci == 0 ? 5.0 : 13.0;
      vec3 cq = q * sc + float(ci) * 17.0;
      vec3 cc = floor(cq);
      vec3 ch = hash33(cc);
      float rad = 0.12 + 0.22 * ch.y;
      float dc = length(cq - (cc + 0.3 + 0.4 * ch)) / rad;
      float on = step(ci == 0 ? 0.62 : 0.55, ch.x);
      alb *= 1.0 + on * (0.14 * smoothstep(1.25, 1.0, dc) * smoothstep(0.75, 1.0, dc) - 0.1 * smoothstep(0.95, 0.2, dc));
    }
    // a bright rayed crater
    float tyc = length(n - normalize(vec3(-0.3, -0.55, -0.78)));
    alb += 0.25 * exp(-tyc * tyc * 400.0) + 0.06 * exp(-tyc * 9.0) * pow(noise3(n * 40.0), 3.0);
#endif
    float lit = smoothstep(-0.08, 0.35, dot(n, uMoonLightDir));
    vec3 mc = vec3(1.0, 0.955, 0.9) * alb * lit * uMoonBright * (0.55 + 0.45 * pow(z, 0.4));
    mc += vec3(0.012, 0.016, 0.026) * alb * (1.0 - lit) * (0.4 + uDark);
    mc *= mix(0.88, 1.0, z);
    col = mix(col, mc + atm * 0.92, moonMask);
  }
  // moon halo (atmospheric)
  float ma = length(d - uMoonDir);
  col += vec3(0.55, 0.68, 0.95) * (exp(-ma * 14.0) * 0.22 + exp(-ma * 3.5) * 0.05 * (1.0 - uSpace)) * uMoonBright * (1.0 - uDay) * (1.0 - moonMask);

  // ---------------- clouds
  if (uClouds > 0.001 && d.y > 0.0) {
    vec2 cp = d.xz / (d.y + 0.06) * 0.9 + uTime * vec2(0.006, 0.003);
#ifndef SKY_LITE
    float c = fbm2(cp * 1.4);
    c += (fbm2(cp * 5.0 + 9.0) - 0.5) * 0.18;
#else
    float c = noise2(cp * 1.4) * 0.6 + noise2(cp * 2.8) * 0.3;
#endif
    c = smoothstep(0.52 - 0.14 * uClouds, 0.92, c) * uClouds * smoothstep(0.0, 0.12, d.y);
    float toSun = exp(-sa * 2.5);
    vec3 cDay = mix(vec3(0.75, 0.8, 0.9), vec3(1.6, 1.4, 1.2), toSun) * uDay;
    vec3 cDawn = mix(vec3(0.55, 0.25, 0.35), vec3(2.2, 0.9, 0.4), toSun * 1.5 + hor * 0.4) * uDawn;
    vec3 cNight = vec3(0.012, 0.018, 0.035) + vec3(0.25, 0.28, 0.35) * exp(-ma * 4.0) * uMoonBright * 0.4;
    vec3 cCol = mix(cNight, cDay, uDay);
    cCol = mix(cCol, cDawn, uDawn);
    cCol = mix(cCol, vec3(0.02, 0.025, 0.05) + vec3(0.6, 0.25, 0.1) * hor, uDark);
    col = mix(col, cCol, c * 0.9 * (1.0 - uSpace));
  }

  // ---------------- diamond ring
  float da = length(d - uDiamondDir);
  col += vec3(1.0, 0.97, 0.92) * uDiamond * (exp(-da * da / 1.2e-6) * 400.0 + exp(-da * da / 4e-5) * 30.0 + exp(-da * 40.0) * 1.2);

  return max(col, 0.0);
}
`;
