import * as THREE from 'three';
import { shared } from './materials';
import type { Post } from './post';
import { createWorld } from './world';
import { RING } from '../sim/data';

export interface Tile {
  x: number;
  y: number;
}
export type Quality = 0 | 1 | 2;
export interface QualityInfo {
  auto: boolean;
  level: Quality;
  /** 自動で出発点より下げた */
  dropped: boolean;
}

const FOV = 30;
const PITCH_NEAR = THREE.MathUtils.degToRad(38);
const PITCH_FAR = THREE.MathUtils.degToRad(60);
const MIN_DIST = 4.5;
const PAN_SPEED = 14;
const SUN_PERIOD = 480;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

const MARKER_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uAlpha;
uniform float uDash;
varying vec2 vUv;
void main() {
  vec2 p = vUv - 0.5;
  vec2 q = abs(p) - 0.34;
  float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.1;
  float edge = exp(-abs(sd) * 38.0);
  float fill = (1.0 - smoothstep(-0.03, 0.0, sd)) * 0.18;
  if (uDash > 0.5) edge *= step(0.5, fract(atan(p.y, p.x) * 2.2 - uTime * 0.8));
  float pulse = 0.82 + 0.18 * sin(uTime * 5.0);
  gl_FragColor = vec4(uColor * (edge + fill) * pulse * uAlpha, 1.0);
}`;

function marker(dash: boolean) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(1.25, 1.25).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color() }, uTime: shared.uTime, uAlpha: { value: 0 }, uDash: { value: dash ? 1 : 0 } },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: MARKER_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  m.position.y = 0.015;
  m.renderOrder = 2;
  return m;
}

/** レンダラー・カメラ操作・光と空・ポストプロセス・ピッキング */
export function createScene(container: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);
  const el = renderer.domElement;

  const scene = new THREE.Scene();
  const world = createWorld(scene);

  // --- 空 ---
  const [skyCanvas, skyCtx] = (() => {
    const c = document.createElement('canvas');
    c.width = 2;
    c.height = 256;
    return [c, c.getContext('2d')!] as const;
  })();
  const sky = new THREE.CanvasTexture(skyCanvas);
  sky.colorSpace = THREE.SRGBColorSpace;
  scene.background = sky;
  const SKY = {
    noon: [new THREE.Color(0x86c8f5), new THREE.Color(0xcdeefa), new THREE.Color(0xeef9ff)],
    eve: [new THREE.Color(0x8fa6e6), new THREE.Color(0xf3c4c8), new THREE.Color(0xffe2bf)],
  };
  let skyPhase = -1;
  function paintSky(t: number) {
    if (Math.abs(t - skyPhase) < 0.01) return;
    skyPhase = t;
    const g = skyCtx.createLinearGradient(0, 0, 0, 256);
    const stops = [0, 0.55, 1];
    const c = new THREE.Color();
    stops.forEach((s, i) => g.addColorStop(s, `#${c.lerpColors(SKY.noon[i], SKY.eve[i], t).getHexString()}`));
    skyCtx.fillStyle = g;
    skyCtx.fillRect(0, 0, 2, 256);
    sky.needsUpdate = true;
  }

  // --- 光 ---
  const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x8fb070, 1.35);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3e0, 2.7);
  sun.castShadow = true;
  sun.shadow.radius = 3;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.025;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 160;
  scene.add(sun, sun.target);
  const SUN = {
    noon: { color: new THREE.Color(0xfff3e0), sky: new THREE.Color(0xcfe6ff), ground: new THREE.Color(0x8fb070), i: 2.7 },
    eve: { color: new THREE.Color(0xffb37a), sky: new THREE.Color(0xffd6bd), ground: new THREE.Color(0x9a8566), i: 2.25 },
  };
  const sunTint = new THREE.Color();
  const lightView = new THREE.Matrix4();
  const corner = new THREE.Vector3();
  function updateSun(time: number) {
    const t = 0.5 - 0.5 * Math.cos((time / SUN_PERIOD) * Math.PI * 2);
    const el = THREE.MathUtils.lerp(THREE.MathUtils.degToRad(60), THREE.MathUtils.degToRad(27), t);
    const az = -1.2 - 0.55 * t;
    sun.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(80);
    sun.color.lerpColors(SUN.noon.color, SUN.eve.color, t);
    sun.intensity = THREE.MathUtils.lerp(SUN.noon.i, SUN.eve.i, t);
    hemi.color.lerpColors(SUN.noon.sky, SUN.eve.sky, t);
    hemi.groundColor.lerpColors(SUN.noon.ground, SUN.eve.ground, t);
    shared.uEvening.value = t;
    shared.uRimColor.value.lerpColors(new THREE.Color(0xfff6e8), new THREE.Color(0xffc9a0), t);
    sunTint.copy(sun.color);
    paintSky(t);
    // 影のカメラを島全体にぴったり合わせる
    lightView.lookAt(sun.position, sun.target.position, THREE.Object3D.DEFAULT_UP).setPosition(sun.position).invert();
    const L = world.half + 0.5;
    const box = new THREE.Box3();
    for (const x of [-L, L]) for (const z of [-L, L]) for (const y of [-0.5, 2.5]) box.expandByPoint(corner.set(x, y, z).applyMatrix4(lightView));
    const cam = sun.shadow.camera;
    cam.left = box.min.x;
    cam.right = box.max.x;
    cam.bottom = box.min.y;
    cam.top = box.max.y;
    cam.updateProjectionMatrix();
  }

  // --- カメラ ---
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 400);
  let size = 0;
  const maxDist = () => 20 + size * 1.6;
  const rig = { target: new THREE.Vector3(), yaw: Math.PI / 4, goalYaw: Math.PI / 4, dist: 13, goalDist: 13 };
  const vel = new THREE.Vector2();
  const zoomShift = new THREE.Vector3();
  const intro = { t: 0, dur: 3.6 };
  const keys = new Set<string>();
  const camDir = new THREE.Vector3();
  /** 追跡中の対象（毎フレーム位置を返す。いなくなったら null） */
  let follow: (() => THREE.Vector3 | null) | null = null;
  let onFollowEnd: () => void = () => {};
  function stopFollow() {
    if (!follow) return;
    follow = null;
    onFollowEnd();
  }

  function pitchFor(dist: number) {
    const k = THREE.MathUtils.clamp((dist - MIN_DIST) / (maxDist() - MIN_DIST), 0, 1);
    return THREE.MathUtils.lerp(PITCH_NEAR, PITCH_FAR, k);
  }
  function applyCamera() {
    let yaw = rig.yaw;
    let dist = rig.dist;
    let pitch = pitchFor(dist);
    if (intro.t < 1) {
      const k = ease(intro.t);
      yaw = THREE.MathUtils.lerp(rig.yaw - 0.9, rig.yaw, k);
      dist = THREE.MathUtils.lerp(maxDist() * 1.25, rig.dist, k);
      pitch = THREE.MathUtils.lerp(THREE.MathUtils.degToRad(84), pitch, k);
    }
    camDir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    camera.position.copy(rig.target).addScaledVector(camDir, dist);
    camera.lookAt(rig.target);
    camera.updateMatrixWorld();
  }

  // --- 入力 ---
  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();
  const mouse = { x: 0, y: 0, inside: false };
  function rayAt(clientX: number, clientY: number) {
    const r = el.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray;
  }
  function groundPoint(clientX: number, clientY: number, out = new THREE.Vector3()) {
    return rayAt(clientX, clientY).intersectPlane(groundPlane, out);
  }
  function tileAt(clientX: number, clientY: number): Tile | null {
    const p = groundPoint(clientX, clientY);
    if (!p) return null;
    const x = Math.floor(p.x);
    const y = Math.floor(p.z);
    const h = size / 2;
    return x >= -h && x < h && y >= -h && y < h ? { x, y } : null;
  }

  let onClick: (clientX: number, clientY: number, touch: boolean) => void = () => {};
  let onCancel: () => void = () => {};
  let onLongPress: (clientX: number, clientY: number) => void = () => {};
  /** ドラッグで塗る（リフトの連続配置）。'start' で true を返したらその操作はパンでなく塗りになる */
  let paint: ((clientX: number, clientY: number, phase: 'start' | 'move' | 'end') => boolean) | null = null;
  /** 塗っている指（マウスは -1）と最後の位置 */
  let painting: { id: number; x: number; y: number } | null = null;
  function endPaint() {
    if (!painting) return;
    const p = painting;
    painting = null;
    paint?.(p.x, p.y, 'end');
  }
  /** 左ボタンか 1 本指のドラッグ。held = 長押しが発火した（離してもタップにしない） */
  let drag: { x: number; y: number; moved: boolean; grab: THREE.Vector3 | null; t: number; touch: boolean; held: boolean; timer: number } | null = null;
  let spin: { x: number; yaw: number; moved: boolean } | null = null;
  /** 画面に触れている指。2 本でピンチズームと 90° スナップ回転 */
  const touches = new Map<number, { x: number; y: number }>();
  let pinch: { d: number; a: number; dist: number } | null = null;
  function twoFingers() {
    const [p, q] = [...touches.values()];
    return { d: Math.max(1, Math.hypot(q.x - p.x, q.y - p.y)), a: Math.atan2(q.y - p.y, q.x - p.x), x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  }
  function startDrag(x: number, y: number, touch: boolean, moved = false) {
    drag = { x, y, moved, grab: groundPoint(x, y), t: performance.now(), touch, held: false, timer: 0 };
    vel.set(0, 0);
    if (touch && !moved)
      drag.timer = window.setTimeout(() => {
        if (!drag || drag.moved) return;
        drag.held = true;
        onLongPress(drag.x, drag.y);
      }, 500);
  }
  function endDrag() {
    if (drag) clearTimeout(drag.timer);
    drag = null;
  }
  /** ズームの目標距離を変え、指した地点へ寄せる（ホイールとピンチ共通） */
  function zoomTo(goal: number, clientX: number, clientY: number) {
    const before = rig.goalDist;
    rig.goalDist = THREE.MathUtils.clamp(goal, MIN_DIST, maxDist());
    const p = groundPoint(clientX, clientY);
    if (p) zoomShift.add(p.sub(rig.target).multiplyScalar(1 - rig.goalDist / before).setY(0));
  }
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 1) {
        if (paint?.(e.clientX, e.clientY, 'start')) {
          painting = { id: e.pointerId, x: e.clientX, y: e.clientY };
          return;
        }
        return startDrag(e.clientX, e.clientY, true);
      }
      // 2 本目の指: タップとパンと塗りをやめてピンチへ
      endPaint();
      endDrag();
      if (touches.size === 2) {
        const g = twoFingers();
        pinch = { d: g.d, a: g.a, dist: rig.goalDist };
        stopFollow();
      }
      return;
    }
    if (e.button === 0) {
      if (paint?.(e.clientX, e.clientY, 'start')) painting = { id: -1, x: e.clientX, y: e.clientY };
      else startDrag(e.clientX, e.clientY, false);
    } else if (e.button === 2) spin = { x: e.clientX, yaw: rig.goalYaw, moved: false };
  });
  el.addEventListener('pointerdown', (e) => el.setPointerCapture(e.pointerId));
  el.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.inside = true;
    } else if (touches.has(e.pointerId)) {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && touches.size >= 2) {
        const g = twoFingers();
        zoomTo((pinch.dist * pinch.d) / g.d, g.x, g.y);
        // 指の回転が 45° を超えたら 90° スナップで回す
        const da = Math.atan2(Math.sin(g.a - pinch.a), Math.cos(g.a - pinch.a));
        if (Math.abs(da) > Math.PI / 4) {
          rig.goalYaw += Math.sign(da) * (Math.PI / 2);
          pinch.a += Math.sign(da) * (Math.PI / 2);
        }
        return;
      }
    }
    if (painting && painting.id === (e.pointerType === 'mouse' ? -1 : e.pointerId)) {
      painting.x = e.clientX;
      painting.y = e.clientY;
      paint?.(e.clientX, e.clientY, 'move');
      return;
    }
    if (spin) {
      const dx = e.clientX - spin.x;
      if (Math.abs(dx) > 4) spin.moved = true;
      if (spin.moved) rig.goalYaw = rig.yaw = spin.yaw - dx * 0.006;
    }
    if (!drag || drag.held) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < (drag.touch ? 8 : 5)) return;
    drag.moved = true;
    clearTimeout(drag.timer);
    stopFollow();
    const p = groundPoint(e.clientX, e.clientY);
    if (!p || !drag.grab) return;
    const now = performance.now();
    const dt = Math.max((now - drag.t) / 1000, 1 / 240);
    drag.t = now;
    const dx = drag.grab.x - p.x;
    const dz = drag.grab.z - p.z;
    rig.target.x += dx;
    rig.target.z += dz;
    vel.lerp(new THREE.Vector2(dx / dt, dz / dt), 0.5);
    clampTarget();
    applyCamera();
  });
  el.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && (mouse.inside = false));
  function release(e: PointerEvent, cancel: boolean) {
    if (painting && (e.pointerType === 'mouse' ? painting.id === -1 && (cancel || e.button === 0) : painting.id === e.pointerId)) {
      painting.x = e.clientX;
      painting.y = e.clientY;
      endPaint();
      if (e.pointerType !== 'mouse') touches.delete(e.pointerId);
      return;
    }
    if (e.pointerType !== 'mouse') {
      if (!touches.delete(e.pointerId)) return;
      if (pinch) {
        const g = touches.size >= 2 ? twoFingers() : null;
        pinch = g && { d: g.d, a: g.a, dist: rig.goalDist };
        // 残った 1 本の指はそのままパンを続ける（タップにはしない）
        const rest = [...touches.values()][0];
        if (touches.size === 1) startDrag(rest.x, rest.y, true, true);
        return;
      }
    }
    if (drag && (drag.touch || e.button === 0)) {
      if (!drag.moved && !drag.held && !cancel) {
        vel.set(0, 0);
        onClick(e.clientX, e.clientY, drag.touch);
      } else if (performance.now() - drag.t > 80) vel.set(0, 0);
      endDrag();
    } else if (e.button === 2 && spin) {
      if (spin.moved) rig.goalYaw = Math.PI / 4 + Math.round((rig.goalYaw - Math.PI / 4) / (Math.PI / 2)) * (Math.PI / 2);
      else if (!cancel) onCancel();
      spin = null;
    }
  }
  el.addEventListener('pointerup', (e) => release(e, false));
  el.addEventListener('pointercancel', (e) => release(e, true));
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoomTo(rig.goalDist * Math.exp(e.deltaY * 0.0011), e.clientX, e.clientY);
    },
    { passive: false },
  );
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    keys.add(k);
    if ('wasd'.includes(k) && k.length === 1) stopFollow();
    if (k === 'q') rig.goalYaw -= Math.PI / 2;
    if (k === 'e') rig.goalYaw += Math.PI / 2;
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());

  function clampTarget() {
    // 追跡中は浜と沖まで（家出していかだで出ていく猫を追える）
    const h = size / 2 + (follow ? RING + 6 : 0);
    rig.target.x = THREE.MathUtils.clamp(rig.target.x, -h, h);
    rig.target.z = THREE.MathUtils.clamp(rig.target.z, -h, h);
  }

  // --- ポストプロセス（遅延読み込み。届くまでは素の描画） ---
  const aoHide: THREE.Object3D[] = [];
  let post: Post | null = null;
  function syncPost() {
    if (!post) return;
    post.ao.enabled = post.finish.enabled = level === 2;
    post.bloom.enabled = level >= 1;
    post.composer.setPixelRatio(renderer.getPixelRatio());
    post.composer.setSize(container.clientWidth, container.clientHeight);
  }
  const postReady = import('./post').then(({ createPost }) => {
    post = createPost(renderer, scene, camera, aoHide);
    syncPost();
  });

  // 画質: 2 = 高（AO+ブルーム+ビネット）, 1 = 中（ブルームのみ）, 0 = 低（ポストなし・影なし・雲と装飾半分）
  const QUALITY_KEY = 'nekoFactory.quality';
  /** 自動のときの出発点: タッチ端末か 4 コア以下なら「中」 */
  const autoStart: Quality = navigator.maxTouchPoints > 0 || navigator.hardwareConcurrency <= 4 ? 1 : 2;
  // 旧設定（エフェクト OFF）は「低」として引き継ぐ
  const savedQ = localStorage.getItem(QUALITY_KEY) ?? (localStorage.getItem('nekoFactory.fx') === 'off' ? '0' : 'auto');
  let auto = !['0', '1', '2'].includes(savedQ);
  let level = (auto ? autoStart : Number(savedQ)) as Quality;
  let applied = -1;
  let onQuality: (q: QualityInfo) => void = () => {};
  const qualityInfo = (): QualityInfo => ({ auto, level, dropped: auto && level < autoStart });
  function applyQuality() {
    if (level === applied) return;
    applied = level;
    renderer.setPixelRatio(Math.min(devicePixelRatio, [1, 1.5, 2][level]));
    sun.castShadow = level > 0;
    sun.shadow.mapSize.setScalar(level === 2 ? 2048 : 1024);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
    world.lite = level === 0;
    resize();
    syncPost();
    onQuality(qualityInfo());
  }
  const perf = { frames: 0, time: 0, warm: 0 };
  /** 自動のとき、直近 3 秒の平均 fps が 45 を切れば 1 段下げる */
  function watchPerf(dt: number) {
    perf.warm += dt;
    if (perf.warm < 5 || dt > 0.25 || document.hidden) return;
    perf.frames++;
    perf.time += dt;
    if (perf.time < 3) return;
    const fps = perf.frames / perf.time;
    perf.frames = perf.time = 0;
    if (fps < 45 && auto && level > 0) {
      level = (level - 1) as Quality;
      applyQuality();
    }
  }

  // コンテキストロスト中は描かない（復帰は three が GL 資源を作り直す）
  let lost = false;
  let onContext: (lost: boolean) => void = () => {};
  el.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
    onContext(true);
  });
  el.addEventListener('webglcontextrestored', () => {
    lost = false;
    sun.shadow.map = null;
    perf.warm = 0;
    onContext(false);
  });

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    syncPost();
  }
  window.addEventListener('resize', resize);
  resize();

  // --- マーカー ---
  const hover = marker(false);
  const selected = marker(true);
  scene.add(hover, selected);
  aoHide.push(hover, selected);
  const hoverGoal = new THREE.Vector3();
  let hoverAlpha = 0;

  applyCamera();
  applyQuality();

  return {
    scene,
    camera,
    renderer,
    world,
    /** ポストプロセスの読み込み完了 */
    postReady,
    setSize(n: number) {
      if (n === size) return;
      size = n;
      world.setSize(n);
      rig.goalDist = Math.min(rig.goalDist, maxDist());
    },
    set onClick(fn: (clientX: number, clientY: number, touch: boolean) => void) {
      onClick = fn;
    },
    set onCancel(fn: () => void) {
      onCancel = fn;
    },
    /** ドラッグ塗り。'start'（左ボタンか 1 本指の押下）で true を返すと、離すまで 'move' と 'end' を呼ぶ（パン・クリック・長押しはしない） */
    set paint(fn: ((clientX: number, clientY: number, phase: 'start' | 'move' | 'end') => boolean) | null) {
      paint = fn;
      if (!fn) painting = null;
    },
    get paint() {
      return paint;
    },
    /** タッチの長押し（500ms） */
    set onLongPress(fn: (clientX: number, clientY: number) => void) {
      onLongPress = fn;
    },
    set onQuality(fn: (q: QualityInfo) => void) {
      onQuality = fn;
      fn(qualityInfo());
    },
    /** WebGL コンテキストの喪失（true）と復帰（false） */
    set onContext(fn: (lost: boolean) => void) {
      onContext = fn;
    },
    /** 撮影用: フライインを飛ばす */
    skipIntro() {
      intro.t = 1;
    },
    /** 対象を画面の中央に保ち続ける（null で解除） */
    follow(fn: (() => THREE.Vector3 | null) | null) {
      if (!fn) return stopFollow();
      follow = fn;
      rig.goalDist = Math.min(rig.goalDist, 8.5);
    },
    get following() {
      return !!follow;
    },
    set onFollowEnd(fn: () => void) {
      onFollowEnd = fn;
    },
    /** 指定位置へカメラを寄せる */
    focus(x: number, z: number, dist?: number, yawSteps?: number) {
      rig.target.set(x, 0, z);
      vel.set(0, 0);
      if (dist) rig.goalDist = rig.dist = THREE.MathUtils.clamp(dist, MIN_DIST, maxDist());
      if (yawSteps !== undefined) rig.goalYaw = rig.yaw = Math.PI / 4 + (yawSteps * Math.PI) / 2;
    },
    get quality() {
      return qualityInfo();
    },
    /** 画質を選ぶ（'auto' は端末から決めて重ければ下げる）。選択は保存する */
    setQuality(q: 'auto' | Quality) {
      auto = q === 'auto';
      level = q === 'auto' ? autoStart : q;
      localStorage.setItem(QUALITY_KEY, String(q));
      perf.frames = perf.time = perf.warm = 0;
      applyQuality();
    },
    /** AO の法線パスから外す（透明物・ビルボード） */
    noAO(o: THREE.Object3D) {
      aoHide.push(o);
    },
    tileAt,
    rayAt,
    /** マウス位置（キャンバス外なら null） */
    mouse() {
      return mouse.inside && !drag?.moved && !spin?.moved ? mouse : null;
    },
    /** タイルの光るハイライト。t が null なら消す */
    highlight(t: Tile | null, color: number) {
      if (t) {
        hoverGoal.set(t.x + 0.5, 0.015, t.y + 0.5);
        if (hoverAlpha < 0.05) hover.position.copy(hoverGoal);
        (hover.material as THREE.ShaderMaterial).uniforms.uColor.value.setHex(color);
      }
      hoverAlpha = t ? 1 : 0;
    },
    select(t: Tile | null) {
      selected.visible = !!t;
      if (t) selected.position.set(t.x + 0.5, 0.016, t.y + 0.5);
      const u = (selected.material as THREE.ShaderMaterial).uniforms;
      u.uColor.value.setHex(0xffe08a);
      u.uAlpha.value = 1;
    },
    /** ワールド座標 → 画面ピクセル */
    project(x: number, y: number, z: number) {
      const v = new THREE.Vector3(x, y, z).project(camera);
      const r = el.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    },
    update(dt: number, time: number) {
      shared.uTime.value = time;
      shared.uCloudOffset.value.set(time * 0.0035, time * 0.0012);
      intro.t = Math.min(1, intro.t + dt / intro.dur);
      // WASD はカメラの向きに合わせる
      const k = (PAN_SPEED * dt * rig.dist) / 24;
      const fx = -Math.sin(rig.yaw);
      const fz = -Math.cos(rig.yaw);
      if (keys.has('w')) (rig.target.x += fx * k), (rig.target.z += fz * k);
      if (keys.has('s')) (rig.target.x -= fx * k), (rig.target.z -= fz * k);
      if (keys.has('d')) (rig.target.x -= fz * k), (rig.target.z += fx * k);
      if (keys.has('a')) (rig.target.x += fz * k), (rig.target.z -= fx * k);
      if (follow) {
        const p = follow();
        if (!p) stopFollow();
        else {
          const k2 = damp(4.5, dt);
          rig.target.x += (p.x - rig.target.x) * k2;
          rig.target.z += (p.z - rig.target.z) * k2;
          vel.set(0, 0);
        }
      }
      if (!drag) {
        rig.target.x += vel.x * dt;
        rig.target.z += vel.y * dt;
        vel.multiplyScalar(Math.exp(-dt * 5));
      }
      const zk = damp(10, dt);
      rig.target.addScaledVector(zoomShift, zk);
      zoomShift.multiplyScalar(1 - zk);
      clampTarget();
      rig.dist += (rig.goalDist - rig.dist) * zk;
      rig.yaw += (rig.goalYaw - rig.yaw) * damp(9, dt);
      applyCamera();
      updateSun(time);
      world.update(time, sunTint, dt);
      if (world.shake > 0) {
        const a = world.shake * 0.035;
        camera.position.x += (Math.random() - 0.5) * a;
        camera.position.y += (Math.random() - 0.5) * a;
        camera.updateMatrixWorld();
      }
      hover.position.lerp(hoverGoal, damp(25, dt));
      const hu = (hover.material as THREE.ShaderMaterial).uniforms;
      hu.uAlpha.value += (hoverAlpha - hu.uAlpha.value) * damp(14, dt);
      hover.visible = hu.uAlpha.value > 0.01;
      watchPerf(dt);
    },
    render() {
      if (lost) return;
      if (level === 0 || !post) renderer.render(scene, camera);
      else post.composer.render();
    },
  };
}
