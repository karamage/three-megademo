import {
  AdditiveBlending,
  AlwaysDepth,
  BackSide,
  type Blending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CubeCamera,
  DataTexture,
  DepthTexture,
  DoubleSide,
  GLSL3,
  HalfFloatType,
  IcosahedronGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  NoBlending,
  NoToneMapping,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  RepeatWrapping,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  type Texture,
  Vector2,
  Vector3,
  Vector4,
  WebGLCubeRenderTarget,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { AUTO_RIPPLES, Director, ORB_RADIUS, SUN_R, type WorldState } from "./director";
import { downFrag, finalFrag, fsVert, raysFrag, streakFrag, upFrag } from "./shaders/post";
import {
  copyDepthFrag,
  copyVert,
  oceanFrag,
  oceanVert,
  orbFrag,
  orbVert,
  particleFrag,
  particleVert,
  skyFrag,
  skyVert,
  WAVE_COUNT,
} from "./shaders/world";
import { BAR } from "./timeline";

type U<T> = { value: T };

export interface EngineOptions {
  mobile: boolean;
}

// ---------------------------------------------------------------- procedural textures
function makeNormalMap(): DataTexture {
  const N = 256;
  const waves: { kx: number; ky: number; a: number; p: number }[] = [];
  let seed = 1337;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 56; i++) {
    let kx = 0;
    let ky = 0;
    while (kx === 0 && ky === 0) {
      kx = Math.round((rnd() - 0.5) * 44);
      ky = Math.round((rnd() - 0.5) * 30 + 6);
    }
    const k = Math.hypot(kx, ky);
    waves.push({ kx, ky, a: 1 / k ** 1.45, p: rnd() * Math.PI * 2 });
  }
  const sx = new Float32Array(N * N);
  const sy = new Float32Array(N * N);
  const hh = new Float32Array(N * N);
  let maxS = 0;
  let minH = Infinity;
  let maxH = -Infinity;
  const w = (2 * Math.PI) / N;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let h = 0;
      let dx = 0;
      let dy = 0;
      for (const wv of waves) {
        const ph = w * (wv.kx * x + wv.ky * y) + wv.p;
        const s = Math.sin(ph);
        const c = Math.cos(ph);
        h += wv.a * s;
        dx += wv.a * wv.kx * c;
        dy += wv.a * wv.ky * c;
      }
      const i = y * N + x;
      sx[i] = dx;
      sy[i] = dy;
      hh[i] = h;
      maxS = Math.max(maxS, Math.abs(dx), Math.abs(dy));
      minH = Math.min(minH, h);
      maxH = Math.max(maxH, h);
    }
  }
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    data[i * 4] = Math.round((sx[i] / maxS) * 127.5 + 127.5);
    data[i * 4 + 1] = Math.round((sy[i] / maxS) * 127.5 + 127.5);
    data[i * 4 + 2] = Math.round(((hh[i] - minH) / (maxH - minH)) * 255);
    data[i * 4 + 3] = 255;
  }
  const tex = new DataTexture(data, N, N, RGBAFormat);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function makeDirtTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 288;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  g.fillStyle = "#000";
  g.fillRect(0, 0, c.width, c.height);
  let seed = 99;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  g.globalCompositeOperation = "lighter";
  for (let i = 0; i < 140; i++) {
    const x = rnd() * c.width;
    const y = rnd() * c.height;
    const r = 3 + rnd() ** 3 * 38;
    const a = 0.04 + rnd() * 0.16;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(255,255,255,${a})`);
    grad.addColorStop(0.75, `rgba(255,255,255,${a * 0.7})`);
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 6; i++) {
    g.strokeStyle = `rgba(255,255,255,${0.03 + rnd() * 0.04})`;
    g.lineWidth = 6 + rnd() * 20;
    g.beginPath();
    const x = rnd() * c.width;
    const y = rnd() * c.height;
    g.moveTo(x, y);
    g.bezierCurveTo(
      x + rnd() * 200,
      y + rnd() * 80,
      x + rnd() * 200,
      y - rnd() * 80,
      x + 200 + rnd() * 100,
      y,
    );
    g.stroke();
  }
  const tex = new CanvasTexture(c);
  tex.minFilter = LinearFilter;
  return tex;
}

function waveSet(): Vector4[] {
  const out: Vector4[] = [];
  const Ls = [62, 39, 24, 17, 11.5, 7.6, 5.3, 3.7, 2.6, 1.8, 1.25, 0.85];
  const st = [0.11, 0.1, 0.095, 0.085, 0.08, 0.07, 0.06, 0.055, 0.05, 0.045, 0.04, 0.035];
  const angles = [0.15, -0.35, 0.55, -0.6, 0.95, -1.1, 0.3, 1.4, -0.85, 0.65, -1.4, 0.05];
  for (let i = 0; i < WAVE_COUNT; i++) {
    const a = angles[i] + Math.PI / 2;
    out.push(new Vector4(Math.cos(a) * 0.3, Math.sin(a), st[i], Ls[i]));
  }
  return out;
}

// ---------------------------------------------------------------- fullscreen helper
class FS {
  private mesh: Mesh;
  private scene = new Scene();
  private cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  constructor() {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.mesh = new Mesh(g);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }
  render(r: WebGLRenderer, m: ShaderMaterial, target: WebGLRenderTarget | null) {
    this.mesh.material = m;
    r.setRenderTarget(target);
    r.render(this.scene, this.cam);
  }
}

const fsMat = (frag: string, uniforms: Record<string, U<unknown>>, blending: Blending = NoBlending) =>
  new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: fsVert,
    fragmentShader: frag,
    uniforms,
    depthTest: false,
    depthWrite: false,
    blending,
  });

const rt = (w: number, h: number, opts: ConstructorParameters<typeof WebGLRenderTarget>[2] = {}) =>
  new WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    type: HalfFloatType,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    depthBuffer: false,
    ...opts,
  });

// ---------------------------------------------------------------- engine
export class Engine {
  readonly renderer: WebGLRenderer;
  readonly camera: PerspectiveCamera;
  readonly director = new Director();
  private fs = new FS();
  private worldScene = new Scene();
  private compScene = new Scene();
  private cubeScene = new Scene();
  private cubeRT: WebGLCubeRenderTarget;
  private cubeCam: CubeCamera;
  private rtWorld!: WebGLRenderTarget;
  private rtComp!: WebGLRenderTarget;
  private mips: WebGLRenderTarget[] = [];
  private rtRays!: WebGLRenderTarget;
  private rtStreakA!: WebGLRenderTarget;
  private rtStreakB!: WebGLRenderTarget;
  private skyU: Record<string, U<unknown>>;
  private oceanMat: ShaderMaterial;
  private orbMat: ShaderMaterial;
  private orb: Mesh;
  private ocean: Mesh;
  private partMat: ShaderMaterial;
  private copyMat: ShaderMaterial;
  private downMat: ShaderMaterial;
  private upMat: ShaderMaterial;
  private raysMat: ShaderMaterial;
  private streakMat: ShaderMaterial;
  private finalMat: ShaderMaterial;
  private ripples: Vector4[] = Array.from({ length: 8 }, () => new Vector4(0, 0, -100, 0));
  private rippleIdx = 0;
  private lastT = -1;
  private scale = 1;
  private width = 1;
  private height = 1;
  private frameTimes: number[] = [];
  private lastScaleChange = 0;
  private capturePending: ((b: Blob | null) => void) | null = null;
  private samples: number;
  private pointer = new Vector2();
  private pointerSmooth = new Vector2();
  private tmpV = new Vector3();
  state: WorldState | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private opts: EngineOptions,
  ) {
    const r = new WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
      stencil: false,
      depth: true,
    });
    r.toneMapping = NoToneMapping;
    r.autoClear = true;
    r.setClearColor(0x000000, 1);
    this.renderer = r;
    this.samples = opts.mobile ? 0 : 2;
    this.scale = 1;

    this.camera = new PerspectiveCamera(50, 1, 0.1, 6000);

    // ------------------------------------------------ sky
    this.skyU = {
      uTime: { value: 0 },
      uSunDir: { value: new Vector3() },
      uMoonDir: { value: new Vector3() },
      uMoonLightDir: { value: new Vector3() },
      uSunRadius: { value: SUN_R },
      uMoonRadius: { value: 0.05 },
      uDay: { value: 0 },
      uDawn: { value: 0 },
      uSpace: { value: 1 },
      uDark: { value: 0 },
      uTotality: { value: 0 },
      uSunVis: { value: 0 },
      uMoonBright: { value: 1 },
      uMoonVis: { value: 1 },
      uClouds: { value: 0 },
      uDiamond: { value: 0 },
      uDiamondDir: { value: new Vector3(0, 1, 0) },
      uStarBoost: { value: 1 },
      uMilkyN: { value: new Vector3(0, 0, 1) },
      uPixelAngle: { value: 0.001 },
      uHigh: { value: 0 },
    };
    const skyMat = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      uniforms: this.skyU,
      side: BackSide,
      depthWrite: false,
    });
    const sky = new Mesh(new SphereGeometry(3000, 64, 32), skyMat);
    sky.frustumCulled = false;
    sky.renderOrder = 10; // after the ocean, so early-z rejects sky pixels hidden by water
    sky.onBeforeRender = () => sky.position.copy(this.camera.position);
    this.worldScene.add(sky);

    const skyLite = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      uniforms: { ...this.skyU, uPixelAngle: { value: 0.02 } },
      defines: { SKY_LITE: 1 },
      side: BackSide,
      depthWrite: false,
    });
    this.cubeScene.add(new Mesh(new SphereGeometry(50, 32, 16), skyLite));
    this.cubeRT = new WebGLCubeRenderTarget(opts.mobile ? 96 : 160, {
      type: HalfFloatType,
      generateMipmaps: true,
      minFilter: LinearMipmapLinearFilter,
      magFilter: LinearFilter,
    });
    this.cubeCam = new CubeCamera(0.1, 200, this.cubeRT);

    // ------------------------------------------------ ocean
    const res = opts.mobile ? 280 : 420;
    const waves = waveSet();
    const waveU = { uWaves: { value: waves }, uWaveScale: { value: 1 }, uWaveTime: { value: 0 } };
    this.oceanMat = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: oceanVert,
      fragmentShader: oceanFrag,
      uniforms: {
        ...waveU,
        uGridRadius: { value: 6000 },
        uGridRes: { value: res },
        uTime: this.skyU.uTime,
        uEnv: { value: this.cubeRT.texture },
        uNormalMap: { value: makeNormalMap() },
        uSunDir: this.skyU.uSunDir,
        uMoonDir: this.skyU.uMoonDir,
        uSunSpec: { value: 0 },
        uMoonSpec: { value: 0 },
        uDeepColor: { value: new Vector3() },
        uScatterColor: { value: new Vector3() },
        uFogDensity: { value: 0.001 },
        uFogColor: { value: new Vector3() },
        uBio: { value: 0 },
        uPulse: { value: 0 },
        uFoam: { value: 0.6 },
        uDetail: { value: 1 },
        uRipples: { value: this.ripples },
        uOrbPos: { value: new Vector3() },
        uOrbColor: { value: new Vector3() },
        uOrbGlow: { value: 0 },
        uDiamond: this.skyU.uDiamond,
        uDiamondDir: this.skyU.uDiamondDir,
      },
      side: DoubleSide,
    });
    const ocean = new Mesh(new PlaneGeometry(2, 2, res, res), this.oceanMat);
    ocean.frustumCulled = false;
    this.ocean = ocean;
    this.worldScene.add(ocean);

    // ------------------------------------------------ composite scene: world copy + orb + particles
    this.copyMat = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: copyVert,
      fragmentShader: copyDepthFrag,
      uniforms: { uColor: { value: null }, uDepth: { value: null } },
      depthTest: true,
      depthWrite: true,
      depthFunc: AlwaysDepth,
    });
    const fsGeo = new BufferGeometry();
    fsGeo.setAttribute("position", new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const copy = new Mesh(fsGeo, this.copyMat);
    copy.frustumCulled = false;
    copy.renderOrder = -10;
    this.compScene.add(copy);

    this.orbMat = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: orbVert,
      fragmentShader: orbFrag,
      uniforms: {
        uTime: this.skyU.uTime,
        uWobble: { value: 1 },
        uPulse: { value: 0 },
        uScene: { value: null },
        uEnv: { value: this.cubeRT.texture },
        uResolution: { value: new Vector2(1, 1) },
        uViewProj: { value: new Matrix4() },
        uCenter: { value: new Vector3() },
        uRadius: { value: ORB_RADIUS },
        uSunDir: this.skyU.uSunDir,
        uMoonDir: this.skyU.uMoonDir,
        uSunSpec: { value: 0 },
        uMoonSpec: { value: 0 },
        uGlowColor: { value: new Vector3() },
        uGlow: { value: 1 },
        uDissolve: { value: 0 },
      },
    });
    this.orb = new Mesh(new IcosahedronGeometry(1, opts.mobile ? 32 : 56), this.orbMat);
    this.orb.renderOrder = 0;
    this.compScene.add(this.orb);

    const count = opts.mobile ? 50000 : 130000;
    const pGeo = new BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < count * 3; i++) pos[i] = Math.random();
    for (let i = 0; i < count * 4; i++) seed[i] = Math.random();
    pGeo.setAttribute("position", new BufferAttribute(pos, 3));
    pGeo.setAttribute("aSeed", new BufferAttribute(seed, 4));
    this.partMat = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: particleVert,
      fragmentShader: particleFrag,
      uniforms: {
        ...waveU,
        uTime: this.skyU.uTime,
        uStage: { value: 0 },
        uOrbPos: { value: new Vector3() },
        uOrbRadius: { value: ORB_RADIUS },
        uRiseTime: { value: 0 },
        uBurst: { value: 0 },
        uPulse: { value: 0 },
        uSize: { value: 0.16 },
        uPixelRatio: { value: 1 },
        uSpaceY: { value: 260 },
        uIntensity: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: AdditiveBlending,
    });
    const points = new Points(pGeo, this.partMat);
    points.frustumCulled = false;
    points.renderOrder = 10;
    this.compScene.add(points);

    // ------------------------------------------------ post
    this.downMat = fsMat(downFrag, {
      uTex: { value: null },
      uTexel: { value: new Vector2() },
      uPrefilter: { value: 0 },
      uThreshold: { value: 1.0 },
    });
    this.upMat = fsMat(
      upFrag,
      { uTex: { value: null }, uTexel: { value: new Vector2() }, uScatter: { value: 0.72 } },
      AdditiveBlending,
    );
    this.raysMat = fsMat(raysFrag, {
      uTex: { value: null },
      uLightPos: { value: new Vector2(0.5, 0.5) },
      uDensity: { value: 0.9 },
      uDecay: { value: 0.965 },
      uAspect: { value: 1 },
      uMaskRadius: { value: 0 },
    });
    this.streakMat = fsMat(streakFrag, {
      uTex: { value: null },
      uTexel: { value: new Vector2() },
      uStep: { value: 1 },
      uThreshold: { value: 0 },
    });
    this.finalMat = fsMat(finalFrag, {
      uScene: { value: null },
      uBloom: { value: null },
      uBloomLow: { value: null },
      uRays: { value: null },
      uStreak: { value: null },
      uDirt: { value: makeDirtTexture() },
      uResolution: { value: new Vector2() },
      uTime: this.skyU.uTime,
      uExposure: { value: 1 },
      uBloomStr: { value: 1 },
      uRaysStr: { value: 0 },
      uRaysColor: { value: new Vector3(1, 1, 1) },
      uStreakStr: { value: 0 },
      uGhostStr: { value: 0 },
      uDirtStr: { value: 1.2 },
      uFlash: { value: 0 },
      uFade: { value: 0 },
      uCA: { value: 0.3 },
      uGrain: { value: 0.022 },
      uVignette: { value: 0.6 },
      uSaturation: { value: 1 },
      uContrast: { value: 1 },
      uLift: { value: new Vector3() },
      uGain: { value: new Vector3(1, 1, 1) },
      uLetterbox: { value: 0 },
      uOccluder: { value: new Vector4() },
      uAspect: { value: 1 },
    });

    this.resize();
  }

  /** Compile every program up front so the first frames do not hitch. */
  async warmup(): Promise<void> {
    this.renderFrame(0.01);
    const r = this.renderer;
    await Promise.all([
      r.compileAsync(this.worldScene, this.camera),
      r.compileAsync(this.compScene, this.camera),
      r.compileAsync(this.cubeScene, this.camera),
    ]);
    // touch every chapter so lazily-reached shader branches are warm
    for (const b of [0, 10, 25, 40, 47]) this.renderFrame(b * BAR);
  }

  resize() {
    const cw = Math.max(1, this.canvas.clientWidth);
    const ch = Math.max(1, this.canvas.clientHeight);
    // pixel budget: the scene is fill-rate bound, so cap the internal resolution
    const budget = this.opts.mobile ? 0.9e6 : 2.0e6;
    const dprMax = Math.min(window.devicePixelRatio || 1, this.opts.mobile ? 2 : 1.5);
    const dpr = Math.min(dprMax, Math.sqrt(budget / (cw * ch)));
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(Math.round(cw * Math.max(dpr, 1)), Math.round(ch * Math.max(dpr, 1)), false);
    this.width = Math.round(cw * dpr * this.scale);
    this.height = Math.round(ch * dpr * this.scale);
    this.camera.aspect = cw / ch;
    this.camera.updateProjectionMatrix();
    this.allocTargets();
  }

  private allocTargets() {
    const w = this.width;
    const h = this.height;
    this.rtWorld?.dispose();
    this.rtComp?.dispose();
    for (const m of this.mips) m.dispose();
    this.rtRays?.dispose();
    this.rtStreakA?.dispose();
    this.rtStreakB?.dispose();

    this.rtWorld = rt(w, h, {
      depthBuffer: true,
      samples: this.samples,
      depthTexture: new DepthTexture(w, h),
    });
    this.rtComp = rt(w, h, { depthBuffer: true, samples: this.samples });
    this.mips = [];
    for (let i = 0; i < 6; i++) this.mips.push(rt(w >> (i + 1), h >> (i + 1)));
    this.rtRays = rt(w >> 2, h >> 2);
    this.rtStreakA = rt(w >> 2, h >> 3);
    this.rtStreakB = rt(w >> 2, h >> 3);
    (this.orbMat.uniforms.uResolution.value as Vector2).set(w, h);
    (this.finalMat.uniforms.uResolution.value as Vector2).set(
      this.renderer.domElement.width,
      this.renderer.domElement.height,
    );
    this.partMat.uniforms.uPixelRatio.value = h / 1080;
  }

  setPointer(nx: number, ny: number) {
    this.pointer.set(nx, ny);
  }

  /** Drop a ripple on the sea where the user tapped. Returns true if the sea was hit. */
  addRippleAtScreen(nx: number, ny: number, t: number): boolean {
    const v = this.tmpV.set(nx, ny, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
    if (v.y > -0.005) return false;
    const d = -this.camera.position.y / v.y;
    if (d > 900) return false;
    const x = this.camera.position.x + v.x * d;
    const z = this.camera.position.z + v.z * d;
    this.pushRipple(x, z, t, 1.4);
    return true;
  }

  private pushRipple(x: number, z: number, t: number, s: number) {
    this.ripples[this.rippleIdx].set(x, z, t, s);
    this.rippleIdx = (this.rippleIdx + 1) % this.ripples.length;
  }

  capture(): Promise<Blob | null> {
    return new Promise((res) => {
      this.capturePending = res;
    });
  }

  private applyState(s: WorldState, t: number) {
    const u = this.skyU;
    u.uTime.value = t;
    (u.uSunDir.value as Vector3).copy(s.sunDir);
    (u.uMoonDir.value as Vector3).copy(s.moonDir);
    (u.uMoonLightDir.value as Vector3).copy(s.moonLightDir);
    u.uMoonRadius.value = s.moonRadius;
    u.uDay.value = s.day;
    u.uDawn.value = s.dawn;
    u.uSpace.value = s.space;
    u.uDark.value = s.dark;
    u.uTotality.value = s.totality;
    u.uSunVis.value = s.sunVis;
    u.uMoonBright.value = s.moonBright;
    u.uMoonVis.value = s.moonVis;
    u.uClouds.value = s.clouds;
    u.uDiamond.value = s.diamond;
    (u.uDiamondDir.value as Vector3).copy(s.diamondDir);
    (u.uMilkyN.value as Vector3).copy(s.milkyN);
    u.uPixelAngle.value = ((this.camera.fov * Math.PI) / 180 / this.height) * 1.0;

    this.ocean.visible = s.space < 0.995 && s.cam.pos.y < 140;
    const o = this.oceanMat.uniforms;
    o.uWaveScale.value = s.waveScale;
    o.uWaveTime.value = t;
    o.uSunSpec.value = s.sunSpec;
    o.uMoonSpec.value = s.moonSpec;
    (o.uDeepColor.value as Vector3).fromArray(s.deepColor);
    (o.uScatterColor.value as Vector3).fromArray(s.scatterColor);
    o.uFogDensity.value = s.fogDensity;
    (o.uFogColor.value as Vector3).fromArray(s.fogColor);
    o.uBio.value = s.bio;
    o.uPulse.value = s.pulse;
    o.uFoam.value = s.foam;
    (o.uOrbPos.value as Vector3).copy(s.orbPos);
    (o.uOrbColor.value as Vector3).fromArray(s.orbColor);
    o.uOrbGlow.value =
      s.orbForm > 0.01 ? s.orbGlow * Math.min(1, s.orbForm) * (1 - Math.min(1, s.orbDissolve)) : 0;

    const ob = this.orbMat.uniforms;
    const r = ORB_RADIUS * Math.max(0.0001, s.orbForm);
    this.orb.visible = s.orbForm > 0.002 && s.orbDissolve < 1;
    this.orb.position.copy(s.orbPos);
    this.orb.scale.setScalar(r);
    (ob.uCenter.value as Vector3).copy(s.orbPos);
    ob.uRadius.value = r;
    ob.uPulse.value = s.pulse;
    ob.uSunSpec.value = s.sunSpec;
    ob.uMoonSpec.value = s.moonSpec;
    (ob.uGlowColor.value as Vector3).fromArray(s.orbColor);
    ob.uGlow.value = s.orbGlow;
    ob.uDissolve.value = s.orbDissolve;
    ob.uWobble.value = 0.55 + (1 - Math.min(1, s.orbForm)) * 2;

    const p = this.partMat.uniforms;
    p.uWaveScale.value = s.waveScale;
    p.uWaveTime.value = t;
    p.uStage.value = s.stage;
    (p.uOrbPos.value as Vector3).copy(s.orbPos);
    p.uRiseTime.value = s.riseTime;
    p.uBurst.value = s.burst;
    p.uPulse.value = s.pulse;
    p.uSpaceY.value = s.spaceY;
    p.uIntensity.value = s.particleIntensity;

    // auto ripples, triggered as time crosses them
    if (t > this.lastT && t - this.lastT < 1) {
      for (const [b, x, z, str] of AUTO_RIPPLES) {
        const te = b * BAR;
        if (te > this.lastT && te <= t) this.pushRipple(x, z, te, str);
      }
    }
    this.lastT = t;
  }

  private placeCamera(s: WorldState, dt: number) {
    const c = this.camera;
    const k = 1 - Math.exp(-dt * 2.5);
    this.pointerSmooth.lerp(this.pointer, k);
    c.position.copy(s.cam.pos);
    c.up.set(Math.sin(s.cam.roll), Math.cos(s.cam.roll), 0);
    // subtle parallax + handheld breathing
    const t = s.t;
    const target = this.tmpV.copy(s.cam.target);
    const dist = target.distanceTo(c.position);
    const sway = dist * 0.012;
    target.x +=
      (this.pointerSmooth.x * 0.05 + Math.sin(t * 0.37) * 0.006 + Math.sin(t * 1.13) * 0.002) * dist;
    target.y += (this.pointerSmooth.y * 0.03 + Math.sin(t * 0.29 + 1.0) * 0.004) * dist;
    c.position.x += Math.sin(t * 0.21) * sway * 0.1;
    c.lookAt(target);
    // shots are framed for ~16:9; widen the vertical fov on narrow (portrait) screens
    let fov = s.cam.fov;
    if (c.aspect < 1.5) {
      const tanV = Math.tan(((fov / 2) * Math.PI) / 180) * (1.5 / c.aspect) ** 0.62;
      fov = (2 * Math.atan(tanV) * 180) / Math.PI;
    }
    if (c.fov !== fov) {
      c.fov = fov;
      c.updateProjectionMatrix();
    }
    c.updateMatrixWorld();
    c.matrixWorldInverse.copy(c.matrixWorld).invert();
  }

  private adaptResolution(dt: number, now: number) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 45) this.frameTimes.shift();
    if (now - this.lastScaleChange < 2500 || this.frameTimes.length < 45) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    let next = this.scale;
    if (avg > 1 / 45) next = Math.max(0.5, this.scale - 0.1);
    else if (avg < 1 / 75 && this.scale < 1) next = Math.min(1, this.scale + 0.1);
    if (next !== this.scale) {
      this.scale = next;
      this.lastScaleChange = now;
      this.frameTimes = [];
      this.resize();
    }
  }

  private lastFrame = performance.now();

  /** Render one frame of the piece at time t (seconds). */
  renderFrame(t: number, adaptive = false) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (adaptive) this.adaptResolution(dt, now);

    const s = this.director.update(t);
    this.state = s;
    this.applyState(s, t);
    this.placeCamera(s, dt);
    const r = this.renderer;

    (this.orbMat.uniforms.uViewProj.value as Matrix4).multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse,
    );
    // reflections
    this.cubeCam.update(r, this.cubeScene);

    // world (sky + ocean) with depth
    r.setRenderTarget(this.rtWorld);
    r.clear();
    r.render(this.worldScene, this.camera);

    // composite: copy world (color + depth), refractive orb, particles
    this.copyMat.uniforms.uColor.value = this.rtWorld.texture;
    this.copyMat.uniforms.uDepth.value = this.rtWorld.depthTexture;
    this.orbMat.uniforms.uScene.value = this.rtWorld.texture;
    r.setRenderTarget(this.rtComp);
    r.clear();
    r.render(this.compScene, this.camera);

    // bloom: downsample chain
    const dm = this.downMat.uniforms;
    let src: Texture = this.rtComp.texture;
    let sw = this.width;
    let sh = this.height;
    for (let i = 0; i < this.mips.length; i++) {
      dm.uTex.value = src;
      (dm.uTexel.value as Vector2).set(1 / sw, 1 / sh);
      dm.uPrefilter.value = i === 0 ? 1 : 0;
      dm.uThreshold.value = s.bloomThreshold;
      this.fs.render(r, this.downMat, this.mips[i]);
      src = this.mips[i].texture;
      sw = this.mips[i].width;
      sh = this.mips[i].height;
    }

    // god rays from the bright pass
    const light = this.tmpV.copy(this.camera.position).addScaledVector(s.lightDir, 1000).project(this.camera);
    const camDir = this.camera.getWorldDirection(new Vector3());
    const facing = Math.max(0, camDir.dot(s.lightDir));
    const onScreen =
      light.z < 1
        ? Math.max(0, 1 - Math.max(0, Math.abs(light.x) - 1) * 1.5) *
          Math.max(0, 1 - Math.max(0, Math.abs(light.y) - 1) * 1.5)
        : 0;
    const rm = this.raysMat.uniforms;
    rm.uTex.value = this.mips[1].texture;
    (rm.uLightPos.value as Vector2).set(light.x * 0.5 + 0.5, light.y * 0.5 + 0.5);
    rm.uAspect.value = this.camera.aspect;
    const tanHalf = Math.tan(((this.camera.fov / 2) * Math.PI) / 180);
    rm.uMaskRadius.value = (Math.tan(s.moonRadius) / tanHalf) * 0.5 * (s.totality > 0.01 ? 1 : 0);
    this.fs.render(r, this.raysMat, this.rtRays);

    // anamorphic streak
    const sm = this.streakMat.uniforms;
    const stw = this.rtStreakA.width;
    const sth = this.rtStreakA.height;
    sm.uTex.value = this.mips[1].texture;
    (sm.uTexel.value as Vector2).set(1 / stw, 1 / sth);
    sm.uStep.value = 1;
    sm.uThreshold.value = 2.0;
    this.fs.render(r, this.streakMat, this.rtStreakA);
    sm.uThreshold.value = 0;
    sm.uTex.value = this.rtStreakA.texture;
    sm.uStep.value = 4;
    this.fs.render(r, this.streakMat, this.rtStreakB);
    sm.uTex.value = this.rtStreakB.texture;
    sm.uStep.value = 14;
    this.fs.render(r, this.streakMat, this.rtStreakA);

    // bloom: upsample chain
    const um = this.upMat.uniforms;
    for (let i = this.mips.length - 1; i > 0; i--) {
      um.uTex.value = this.mips[i].texture;
      (um.uTexel.value as Vector2).set(1 / this.mips[i].width, 1 / this.mips[i].height);
      r.autoClear = false;
      this.fs.render(r, this.upMat, this.mips[i - 1]);
      r.autoClear = true;
    }

    // final grade to screen
    const f = this.finalMat.uniforms;
    f.uScene.value = this.rtComp.texture;
    f.uBloom.value = this.mips[0].texture;
    f.uBloomLow.value = this.mips[3].texture;
    f.uRays.value = this.rtRays.texture;
    f.uStreak.value = this.rtStreakA.texture;
    f.uExposure.value = s.exposure;
    f.uBloomStr.value = s.bloom * 0.085;
    f.uRaysStr.value = s.rays * facing * onScreen * 1.6;
    (f.uRaysColor.value as Vector3).fromArray(s.raysColor);
    f.uStreakStr.value = s.streak * 0.5;
    f.uGhostStr.value = s.ghost * 0.06;
    f.uFlash.value = Math.min(1, s.flash);
    f.uFade.value = s.fade;
    f.uCA.value = s.ca;
    f.uSaturation.value = s.saturation;
    f.uContrast.value = s.contrast;
    (f.uLift.value as Vector3).fromArray(s.lift);
    (f.uGain.value as Vector3).fromArray(s.gain);
    f.uLetterbox.value = s.letterbox;
    f.uAspect.value = this.camera.aspect;
    const occ = f.uOccluder.value as Vector4;
    if (s.occlusion > 0.01) {
      const mp = this.tmpV.copy(this.camera.position).addScaledVector(s.moonDir, 1000).project(this.camera);
      const rad = (Math.tan(s.moonRadius) / tanHalf) * 0.5;
      occ.set(mp.x * 0.5 + 0.5, mp.y * 0.5 + 0.5, mp.z < 1 ? rad : 0, Math.min(1, s.occlusion));
    } else occ.set(0, 0, 0, 0);
    this.fs.render(r, this.finalMat, null);

    if (this.capturePending) {
      const done = this.capturePending;
      this.capturePending = null;
      this.canvas.toBlob((b) => done(b), "image/png");
    }
  }

  dispose() {
    this.renderer.dispose();
  }
}
