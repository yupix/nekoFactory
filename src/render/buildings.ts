import * as THREE from 'three';
import { BUILDINGS, FACILITY, HAND, ITEMS, RECIPES, RECIPES_OF, WEAPONS, WORK_STAT, type BuildingType, type ItemId } from '../sim/data';
import { bufferCap, isBroken, isWorking, maxHp, missingSources, recipeTime, suppliedItems, weaponRange, type Building, type GameState } from '../sim/state';
import { hasInputs, outputFull } from '../sim/tick';
import { BILLBOARD_VERT, type Fx } from './fx';
import { ITEM_IDS, Layer, type Items } from './layer';
import { MAT, toon } from './materials';
import { BENCH, buildingModels, FURNACE_MOUTH, ITEM_H, MINER_PILE, MUZZLE, PALLET, rbox, tierGeometries, TURRET_BARREL, Y0, type V3 } from './models';
import { pondMaterial } from './world';

export interface UiState {
  /** 'lift' はリフトの設置（hoverTile にゴースト、liftDir の向きの矢印。liftPath はドラッグ中の連続配置） */
  mode: BuildingType | 'remove' | 'lift' | null;
  hoverTile: { x: number; y: number } | null;
  /** カーソルが指している建物 */
  hoverId: number | null;
  /** 設置できるか（ゴーストの色） */
  canPlace: boolean;
  /** リフトの向き（0:+x 1:+y 2:-x 3:-y） */
  liftDir: number;
  /** ドラッグ中に並べるリフト（空のこともある） */
  liftPath: { x: number; y: number; d: number }[];
}

interface BState {
  type: BuildingType;
  x: number;
  y: number;
  born: number;
  act: number;
  runT: number;
  prevRunning: boolean;
  prevProgress: number;
  catchT: number;
  bump: number;
  emit: number;
  hover: number;
  red: number;
  bar: number;
  flying: number;
  /** 施設を使っている猫の数（なめらかに） */
  use: number;
  /** 作業中の職人がいるか（craft はなめらかに） */
  crewed: boolean;
  craft: number;
  /** 表示中のティアと、強化演出の開始時刻（-1 なら演出なし）と木づちを打った回数 */
  tier: number;
  upT: number;
  hits: number;
  /** 耐久: 表示中の割合、前回の HP、最後に噛まれた時刻、ひび（0〜1）、故障（なめらかに 0〜1）、煙の間隔 */
  hpShown: number;
  lastHp: number;
  hitT: number;
  crack: number;
  brk: number;
  smokeT: number;
  /** 兵器: 砲塔の向き、反動、狙っている犬、機関銃の銃身の回転角と回転速度 */
  yaw: number;
  recoil: number;
  aimDog: number;
  spin: number;
  spinV: number;
  /** 出力の品（採掘機の鉱石の山。撤去後の描画にも使う） */
  out: ItemId | null;
  /** 市場のコインの演出の間引き（最後に出した時刻と、まだ出していない額） */
  coinT: number;
  coinAmt: number;
}

/** ティアごとの建物の大きさ（横・高さ） */
const TIER_SCALE: [number, number][] = [[1, 1], [1.06, 1.12], [1.12, 1.22]];
/** 強化演出の長さと、木づちを打つ時刻 */
const UPGRADE_T = 1.5;
const HITS = [0.35, 0.75, 1.15];

/** おもちゃ箱のボールの位置（猫も同じ式で目で追う） */
export function ballPos(bx: number, by: number, id: number, t: number, out: THREE.Vector3) {
  const a = t * 1.7 + id;
  return out.set(bx + 0.5 + Math.cos(a) * 0.3, Y0 + 0.05, by + 0.5 + Math.sin(a) * 0.3);
}

interface Dying {
  st: BState;
  t: number;
}

const TYPES = Object.keys(BUILDINGS) as BuildingType[];
/** 吹き出し: 出力満杯・不足アイテム・故障（工具）・弾切れ */
const ICONS = ['!', ...ITEM_IDS, 'tool', 'ammo', 'none'] as const;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function cobbleTexture() {
  const n = 256;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  g.fillStyle = '#a99d8b';
  g.fillRect(0, 0, n, n);
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const rows = 7;
  const h = n / rows;
  for (let j = 0; j < rows; j++) {
    let x = -r() * 30;
    while (x < n) {
      const w = 26 + r() * 22;
      const l = 74 + r() * 9;
      const sx = x + 2.5;
      const sy = j * h + 2.5;
      g.fillStyle = `hsl(${30 + r() * 14}, ${9 + r() * 9}%, ${l}%)`;
      g.beginPath();
      g.roundRect(sx, sy, w - 5, h - 5, 9);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.16)';
      g.beginPath();
      g.roundRect(sx + 2, sy + 2, w - 12, (h - 5) * 0.45, 7);
      g.fill();
      x += w;
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** 頭上の吹き出しアイコン（「!」と不足アイテム）のアトラス。アイテムの絵はサムネイルができたら set で差し替える（それまでは色の丸） */
function iconAtlas() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = s * ICONS.length;
  c.height = s;
  const g = c.getContext('2d')!;
  function draw(i: number, img?: HTMLCanvasElement) {
    const icon = ICONS[i];
    const x = i * s;
    const warn = icon === '!' || icon === 'tool';
    g.save();
    g.clearRect(x, 0, s, s);
    g.translate(x, 0);
    g.shadowColor = 'rgba(0,0,0,0.25)';
    g.shadowBlur = 8;
    g.shadowOffsetY = 3;
    g.fillStyle = icon === 'tool' ? '#f0a33c' : icon === 'none' ? '#e5574a' : warn ? '#ff6b4a' : '#ffffff';
    g.beginPath();
    g.roundRect(12, 8, 104, 92, 30);
    g.moveTo(52, 96);
    g.lineTo(64, 120);
    g.lineTo(76, 96);
    g.fill();
    g.shadowColor = 'transparent';
    g.lineWidth = 6;
    g.strokeStyle = warn || icon === 'none' ? '#ffffff' : icon === 'ammo' ? '#e5574a' : '#ffb98a';
    g.beginPath();
    g.roundRect(15, 11, 98, 86, 27);
    g.stroke();
    if (icon === 'tool') {
      // スパナと金づち
      g.strokeStyle = '#fff';
      g.lineCap = 'round';
      g.lineWidth = 11;
      g.beginPath();
      g.moveTo(42, 78);
      g.lineTo(84, 34);
      g.stroke();
      g.beginPath();
      g.arc(88, 30, 13, 0, Math.PI * 2);
      g.fillStyle = '#fff';
      g.fill();
      g.fillStyle = '#f0a33c';
      g.fillRect(84, 16, 9, 16);
      g.lineWidth = 9;
      g.beginPath();
      g.moveTo(44, 30);
      g.lineTo(82, 76);
      g.stroke();
      g.fillStyle = '#fff';
      g.save();
      g.translate(40, 28);
      g.rotate(-0.88);
      g.fillRect(-18, -9, 36, 18);
      g.restore();
    } else if (icon === 'ammo') {
      g.fillStyle = '#e5574a';
      g.font = '900 40px "M PLUS Rounded 1c", "Arial Rounded MT Bold", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('弾', 64, 38);
      g.font = '900 28px "M PLUS Rounded 1c", "Arial Rounded MT Bold", sans-serif';
      g.fillText('切れ', 64, 74);
    } else if (icon === 'none') {
      // 材料の供給元がない（「材料待ち」の白い吹き出しと区別する赤い吹き出し）
      g.fillStyle = '#fff';
      g.font = '900 36px "M PLUS Rounded 1c", "Arial Rounded MT Bold", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('材料', 64, 38);
      g.fillText('なし', 64, 74);
    } else if (warn) {
      g.fillStyle = '#fff';
      g.font = '900 78px "M PLUS Rounded 1c", "Arial Rounded MT Bold", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('!', 64, 58);
    } else if (img) g.drawImage(img, 22, 12, 84, 84);
    else {
      g.fillStyle = `#${ITEMS[icon as ItemId].color.toString(16).padStart(6, '0')}`;
      g.beginPath();
      g.arc(64, 54, 24, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }
  ICONS.forEach((_, i) => draw(i));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return {
    tex: t,
    set(id: ItemId, img: HTMLCanvasElement) {
      draw(ICONS.indexOf(id), img);
      t.needsUpdate = true;
    },
  };
}

const BAR_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec2 vBar;
void main() {
  vec2 size = vec2(0.6, 0.12);
  vec2 p = (vUv - 0.5) * size;
  float r = size.y * 0.5;
  vec2 q = abs(p) - (size * 0.5 - r);
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  float aa = fwidth(d);
  float a = 1.0 - smoothstep(-aa, aa, d);
  if (a <= 0.0) discard;
  vec3 col = vec3(1.0);
  float inset = 0.022;
  if (d + inset < 0.0) {
    float x = (p.x + size.x * 0.5 - inset) / (size.x - 2.0 * inset);
    vec3 fill = mix(vec3(0.2, 0.62, 0.12), vec3(0.62, 0.92, 0.25), vUv.y);
    fill *= 0.92 + 0.12 * step(0.5, fract((p.x - p.y) * 16.0 - uTime * 1.2));
    col = x < vBar.x ? fill : vec3(0.09, 0.07, 0.06);
  }
  gl_FragColor = vec4(col, a * vBar.y);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** 耐久バー（残りの割合で緑 → 黄 → 赤） */
const HP_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec2 vBar;
void main() {
  vec2 size = vec2(0.56, 0.09);
  vec2 p = (vUv - 0.5) * size;
  float r = size.y * 0.5;
  vec2 q = abs(p) - (size * 0.5 - r);
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  float aa = fwidth(d);
  float a = 1.0 - smoothstep(-aa, aa, d);
  if (a <= 0.0) discard;
  vec3 col = vec3(1.0);
  float inset = 0.018;
  if (d + inset < 0.0) {
    float x = (p.x + size.x * 0.5 - inset) / (size.x - 2.0 * inset);
    vec3 fill = mix(vec3(0.92, 0.22, 0.16), vec3(0.98, 0.78, 0.2), smoothstep(0.15, 0.45, vBar.x));
    fill = mix(fill, vec3(0.36, 0.82, 0.22), smoothstep(0.5, 0.8, vBar.x));
    fill *= 0.85 + 0.25 * vUv.y;
    col = x < vBar.x ? fill : vec3(0.12, 0.08, 0.07);
  }
  gl_FragColor = vec4(col, a * vBar.y);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** 横に n 個並んだアトラスから vIcon.x 番目を描く */
const atlasFrag = (n: number) => /* glsl */ `
uniform sampler2D uTex;
varying vec2 vUv;
varying vec2 vIcon;
void main() {
  vec4 t = texture2D(uTex, vec2((vUv.x + vIcon.x) / ${n}.0, vUv.y));
  if (t.a < 0.02) discard;
  gl_FragColor = vec4(t.rgb, t.a * vIcon.y);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const ICON_FRAG = atlasFrag(ICONS.length);

/** 頭上のティアの ★（1〜3 個）と、得意バッジのアトラス（★1 ★2 ★3 得意） */
function badgeAtlas() {
  const w = 192;
  const h = 64;
  const c = document.createElement('canvas');
  c.width = w * 4;
  c.height = h;
  const g = c.getContext('2d')!;
  const star = (x: number, y: number, r: number) => {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r * 0.45 : r;
      g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath();
  };
  g.lineJoin = 'round';
  for (let t = 1; t <= 3; t++)
    for (let k = 0; k < t; k++) {
      star(t * 0 + (t - 1) * w + w / 2 + (k - (t - 1) / 2) * 52, h / 2 + 2, 24);
      g.lineWidth = 7;
      g.strokeStyle = '#7a4a12';
      g.stroke();
      g.fillStyle = '#ffd34d';
      g.fill();
    }
  // 得意バッジ: 金の丸に白い星と「得意」
  const x = 3 * w + w / 2;
  g.fillStyle = '#ff9f2e';
  g.strokeStyle = '#fff';
  g.lineWidth = 5;
  g.beginPath();
  g.roundRect(x - 80, 6, 160, 52, 26);
  g.fill();
  g.stroke();
  star(x - 46, 32, 17);
  g.fillStyle = '#fff6c8';
  g.fill();
  g.fillStyle = '#fff';
  g.font = '900 30px "M PLUS Rounded 1c", "Arial Rounded MT Bold", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('得意', x + 14, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function billboardMat(frag: string, attr: string, uniforms: Record<string, THREE.IUniform>) {
  return new THREE.ShaderMaterial({
    uniforms,
    defines: { NK_SCREEN_SIZE: 1 },
    vertexShader: `${BILLBOARD_VERT}
      attribute vec2 ${attr};
      varying vec2 v${attr.slice(1)};
      void main() {
        vUv = uv;
        v${attr.slice(1)} = ${attr};
        gl_Position = projectionMatrix * viewMatrix * vec4(billboard(position.xy), 1.0);
      }`,
    fragmentShader: frag,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
}

/** 在庫を積む位置（パレットの上に 2×2、魚は 2 本ずつ井桁） */
function stackSlot(item: ItemId, i: number, out: THREE.Matrix4) {
  const q = new THREE.Quaternion();
  if (item === 'fish') {
    const layer = Math.floor(i / 2);
    const k = i % 2 ? 1 : -1;
    const turn = layer % 2;
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, turn ? Math.PI / 2 : 0);
    const off = new THREE.Vector3(turn ? k * 0.045 : 0.02, 0.022 + layer * 0.038, turn ? 0.02 : k * 0.045);
    return out.compose(off.add(new THREE.Vector3(PALLET[0], Y0, PALLET[2])), q, new THREE.Vector3(0.62, 0.62, 0.62));
  }
  const layer = Math.floor(i / 4);
  const k = i % 4;
  const s = 0.8;
  q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, ((i * 37) % 7) * 0.08);
  return out.compose(
    new THREE.Vector3(PALLET[0] + (k % 2 ? 0.05 : -0.05), Y0 + 0.022 + layer * ITEM_H[item] * s, PALLET[2] + (k > 1 ? 0.05 : -0.05)),
    q,
    new THREE.Vector3(s, s, s),
  );
}

/** state の建物を描く */
export function createBuildings(parent: THREE.Object3D, items: Items, fx: Fx, noAO: (o: THREE.Object3D) => void, sound: (name: 'thud' | 'research') => void = () => {}) {
  const models = buildingModels();
  const base = {} as Record<BuildingType, Layer>;
  const parts = {} as Record<string, Layer>;
  for (const t of TYPES) {
    base[t] = new Layer(parent, models[t].base, MAT.fx, 16, { shadow: true, attrs: { aFx: 4, aDmg: 2 } });
    for (const [name, p] of Object.entries(models[t].parts)) {
      parts[`${t}.${name}`] = new Layer(parent, p.geo, MAT[p.mat], 16, { shadow: p.shadow, attrs: p.mat === 'fx' ? { aFx: 4, aDmg: 2 } : { aFx: 4 }, renderOrder: p.mat === 'glass' ? 1 : 0 });
      if (p.mat === 'glass') noAO(parts[`${t}.${name}`].mesh);
    }
  }
  const pads = new Layer(parent, rbox(0.94, Y0, 0.94, 0.035, 2).translate(0, Y0 / 2, 0), toon({ map: cobbleTexture() }), 32, { receive: true });
  const ponds = new Layer(parent, new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), pondMaterial, 16, {});
  const time = { value: 0 };
  const bars = new Layer(parent, new THREE.PlaneGeometry(0.6, 0.12), billboardMat(BAR_FRAG, 'aBar', { uTime: time }), 16, { attrs: { aBar: 2 }, renderOrder: 10 });
  const hpBars = new Layer(parent, new THREE.PlaneGeometry(0.56, 0.09), billboardMat(HP_FRAG, 'aBar', {}), 16, { attrs: { aBar: 2 }, renderOrder: 10 });
  noAO(hpBars.mesh);
  const atlas = iconAtlas();
  const icons = new Layer(parent, new THREE.PlaneGeometry(0.42, 0.42), billboardMat(ICON_FRAG, 'aIcon', { uTex: { value: atlas.tex } }), 16, { attrs: { aIcon: 2 }, renderOrder: 11 });
  // ★ はバーの下、得意バッジはバーの右（板を画面上でずらす）
  const badgeTex = { value: badgeAtlas() };
  const badgeMat = billboardMat(atlasFrag(4), 'aIcon', { uTex: badgeTex });
  const tierStars = new Layer(parent, new THREE.PlaneGeometry(0.36, 0.12).translate(0, -0.12, 0), badgeMat, 16, { attrs: { aIcon: 2 }, renderOrder: 10 });
  const goodBadge = new Layer(parent, new THREE.PlaneGeometry(0.36, 0.12).translate(0.46, 0.0, 0), badgeMat, 16, { attrs: { aIcon: 2 }, renderOrder: 11 });
  noAO(bars.mesh);
  noAO(icons.mesh);
  noAO(tierStars.mesh);
  noAO(goodBadge.mesh);
  // ティアの装飾と強化の足場
  const tg = tierGeometries();
  const decoMat = toon({ vertexColors: true, glow: true, rim: 0.2 });
  const deco = {
    work: new Layer(parent, tg.work, decoMat, 16, { shadow: true }),
    rest: new Layer(parent, tg.rest, decoMat, 16, { shadow: true }),
    flag: new Layer(parent, tg.flag, decoMat, 16, { shadow: true, color: true }),
    gold: new Layer(parent, tg.gold, decoMat, 16, { shadow: true }),
    scaffold: new Layer(parent, tg.scaffold, decoMat, 4, { shadow: true }),
    mallet: new Layer(parent, tg.mallet, decoMat, 4, { shadow: true }),
  };
  const flagCol = new THREE.Color();

  const ghostMat = toon({ vertexColors: true, transparent: true, opacity: 0.62, depthWrite: false, rim: 0.7, cloud: false });
  const ghost = new THREE.Mesh(models.fishing.full, ghostMat);
  ghost.visible = false;
  ghost.renderOrder = 5;
  parent.add(ghost);
  noAO(ghost);
  const ghostGoal = new THREE.Vector3();

  const states = new Map<number, BState>();
  const dying: Dying[] = [];
  let ready = false;

  const M = new THREE.Matrix4();
  const T = new THREE.Matrix4();
  const O = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  const sc = new THREE.Vector3();
  const reserved = new Map<number, number>();
  const users = new Map<number, number>();
  /** 建物 id → 作業中の職人の数と、得意な猫がいるか */
  const crew = new Map<number, { n: number; good: boolean }>();
  /** 柵のあるタイル（横木をつなぐ） */
  const fences = new Set<number>();
  const tileKey = (x: number, y: number) => (x + 512) * 1024 + y + 512;
  let dogs: { id: number; x: number; y: number }[] = [];

  const eY = new THREE.Euler(0, 0, 0, 'YXZ');
  const quat = (x: number, y: number, z: number) => q.setFromEuler(e.set(x, y, z));
  /** 向き → 傾き → ひねりの順の回転（腕や銃身が向いた先で動く） */
  const quatY = (x: number, y: number, z: number) => q.setFromEuler(eY.set(x, y, z));
  const world = (x: number, y: number, z: number, out = new THREE.Vector3()) => out.set(x, y, z).applyMatrix4(M);

  /** 可動部を 1 つ描く: M × T(回転中心 + off) × R */
  function part(st: BState, name: string, rot: THREE.Quaternion, off: V3 = [0, 0, 0], w = 0, scale: number | V3 = 1) {
    const model = models[st.type].parts[name];
    T.compose(v.set(model.pivot[0] + off[0], model.pivot[1] + off[1], model.pivot[2] + off[2]), rot, typeof scale === 'number' ? sc.setScalar(scale) : sc.set(...scale));
    const l = parts[`${st.type}.${name}`];
    const i = l.push(O.multiplyMatrices(M, T));
    l.set('aFx', i, st.type === 'market' ? 0 : 1 - st.act, st.hover, st.red, w);
    if (model.mat === 'fx') l.set('aDmg', i, st.crack, st.brk);
    return O;
  }

  function animate(st: BState, b: Building | null, dt: number, now: number) {
    const def = BUILDINGS[st.type];
    const prog = b && b.running && def.time ? Math.min(1, b.progress / recipeTime(b)) : 0;
    // 職人がいる間は粒子が増える
    const busy = 1 + 1.4 * st.craft;
    switch (st.type) {
      case 'fishing': {
        const bite = b?.running && prog > 0.78 ? (prog - 0.78) / 0.22 : 0;
        const recoil = st.catchT < 1.2 ? Math.exp(-st.catchT * 6) : 0;
        const rx = -0.75 + Math.sin(st.runT * 1.4) * 0.03 - bite * (0.07 + Math.sin(now * 38) * 0.035) + recoil * 0.4;
        const bobY = Math.sin(st.runT * 2.4) * 0.006 * (1 + st.craft) - bite * (0.012 + 0.008 * Math.sin(now * 30)) + recoil * 0.05;
        part(st, 'bobber', quat(0, 0, 0), [0, bobY, 0]);
        const bob = world(-0.04, Y0 + 0.07 + bobY + 0.02, -0.2);
        // 職人がいる間は竿を猫が持つ（備え付けの竿と糸は描かない）
        if (!st.crewed) {
          const rodM = part(st, 'rod', quat(rx, 0, -0.35)).clone();
          const tip = v2.set(0, 0.56, 0).applyMatrix4(rodM);
          const dir = bob.clone().sub(tip);
          const len = dir.length();
          const l = parts['fishing.line'];
          const i = l.push(O.compose(tip, q.setFromUnitVectors(v.set(0, -1, 0), dir.normalize()), sc.set(1, len, 1)));
          l.set('aFx', i, 1 - st.act, st.hover, st.red, 0);
        }
        ponds.push(O.multiplyMatrices(M, T.compose(v.set(-0.08, Y0 + 0.066, -0.08), quat(0, 0, 0), sc.set(0.54, 1, 0.54))));
        st.emit += dt * st.act * busy;
        if (st.emit > 1.6) {
          st.emit = 0;
          fx.ripple(bob.setY(Y0 + 0.075));
        }
        break;
      }
      case 'cannery':
        part(st, 'gear', quat(st.runT * 2.2, 0, 0));
        st.emit += dt * st.act * busy;
        if (st.emit > 0.42) {
          st.emit = 0;
          fx.smoke(world(0.06, Y0 + 0.74, -0.22));
        }
        break;
      case 'miner': {
        const bob = Math.sin(st.runT * 9) * 0.012 * st.act;
        part(st, 'drill', quat(0, st.runT * 14, 0), [0, bob - 0.02 * st.act, 0]);
        part(st, 'fly', quat(st.runT * 6, 0, 0));
        // 掘った鉱石の山（鉱床の種類）
        if (st.out) for (const p of MINER_PILE) items.push(st.out, O.multiplyMatrices(M, T.compose(v.set(p[0], p[1], p[2]), quat(0, p[0] * 9, 0), sc.setScalar(0.9))));
        st.emit += dt * st.act * busy;
        if (st.emit > 0.55) {
          st.emit = 0;
          fx.dust(world(-0.06, Y0 + 0.07, -0.06), 2, 0.12);
        }
        break;
      }
      case 'furnace': {
        // 火は揺らめき、止まると熾火だけ残る
        const flick = Math.sin(now * 17 + st.x * 3) * 0.5 + Math.sin(now * 29 + st.y * 5) * 0.5;
        const k = st.act * (0.85 + 0.15 * flick) + 0.06;
        part(st, 'fire', quat(0, Math.sin(now * 7) * 0.2, Math.sin(now * 11) * 0.06 * st.act), [0, 0, 0], st.act * (0.6 + 0.4 * flick), [0.7 + 0.3 * k, Math.max(0.05, k * (1 + 0.15 * flick)), 0.7 + 0.3 * k]);
        st.emit += dt * st.act * busy;
        if (st.emit > 0.45) {
          st.emit = 0;
          fx.smoke(world(0.05, Y0 + 0.8, -0.16), 0xb8b2aa);
        }
        if (st.act > 0.3 && Math.random() < dt * 3 * st.act) fx.sparkle(world(FURNACE_MOUTH[0] + (Math.random() - 0.5) * 0.1, Y0 + 0.2, FURNACE_MOUTH[2] + 0.03), 0xffa040, 1, 0.03);
        break;
      }
      case 'assembler': {
        // アームが作業台の上を左右に動き、ときどき下ろして溶接する。台の上には作っている品
        const yaw = -0.62 + Math.sin(st.runT * 1.3) * 0.3 * st.act;
        const tap = Math.max(0, Math.sin(st.runT * 5.2)) ** 4 * st.act;
        part(st, 'arm', quatY(0.12 * tap, yaw, 0));
        const out = b?.running && b.cur ? RECIPES[b.cur].out : null;
        if (out) items.push(out, O.multiplyMatrices(M, T.compose(v.set(BENCH[0], BENCH[1], BENCH[2]), quat(0, now * 0.4, 0), sc.setScalar(0.45 + 0.55 * prog))));
        st.emit += dt * st.act * busy;
        if (st.emit > 0.35 && tap > 0.5) {
          st.emit = 0;
          fx.sparkle(world(BENCH[0], BENCH[1] + 0.05, BENCH[2]), 0x9fe8ff, 2, 0.05);
        }
        break;
      }
      case 'charger': {
        // 充電中はコイルが回って光り、台へ稲妻が走る
        const c = st.use;
        part(st, 'coil', quat(0, st.runT * 0.3 + now * 4 * c, 0), [0, 0, 0], c * (0.6 + 0.4 * Math.sin(now * 12)), 1 + 0.05 * c * Math.sin(now * 20));
        if (c > 0.3 && Math.random() < dt * 9 * c) {
          const pad = world(Math.random() < 0.5 ? -0.2 : 0.2, Y0 + 0.12, 0.22);
          fx.sparkle(world(0, Y0 + 0.72, -0.28).lerp(pad, Math.random()), 0x9fe8ff, 1, 0.03);
          if (Math.random() < 0.3) fx.glow(pad, 0x7fdcff, 0.3);
        }
        break;
      }
      case 'market':
        part(st, 'coin', quat(0, now * 2 + st.bump * 6, 0), [0, Math.sin(now * 2.2) * 0.012 + st.bump * 0.06, 0]);
        break;
      case 'bed':
        // 寝ている猫の重みでふかふかに沈む
        part(st, 'cushion', quat(0, 0, 0), [0, -0.02 * st.use, 0], 0, [1 + 0.04 * st.use, 1 - 0.45 * st.use, 1 + 0.04 * st.use]);
        break;
      case 'toybox': {
        // 使われている間はボールが箱のまわりを転がる
        const p = st.use > 0.05 ? ballPos(0, 0, 0, now, v2).sub(v.set(0.5, 0, 0.5)) : v2.set(0.28, Y0 + 0.05, -0.3);
        const roll = now * 6;
        part(st, 'ball', quat(st.use > 0.05 ? roll : 0, 0, st.use > 0.05 ? -roll * 0.5 : 0), [p.x, p.y - Y0 - 0.05, p.z]);
        break;
      }
      case 'tower':
        part(st, 'pom', quat(Math.sin(now * 2.3) * (0.15 + 0.5 * st.use), 0, Math.sin(now * 1.7) * (0.1 + 0.4 * st.use)));
        break;
      case 'waterGun':
      case 'turret':
      case 'cannon': {
        // 砲塔は標的を向き、撃つと砲口と逆へ反動
        const k = st.recoil * (st.type === 'cannon' ? 0.09 : st.type === 'turret' ? 0.025 : 0.05);
        const rx = -Math.sin(st.yaw) * k;
        const rz = -Math.cos(st.yaw) * k;
        part(st, 'turret', quat(0, st.yaw, 0), [rx, 0, rz]);
        if (st.type === 'turret') {
          // 銃身の束は砲塔と一緒に回る位置へずらし、軸まわりに回す
          const [bx, , bz] = TURRET_BARREL;
          const sy = Math.sin(st.yaw);
          const cy = Math.cos(st.yaw);
          part(st, 'barrel', quatY(0, st.yaw, st.spin), [bx * cy + bz * sy - bx + rx, 0, -bx * sy + bz * cy - bz + rz]);
        }
        break;
      }
      case 'fence':
        for (const [dx, dy, a] of [[1, 0, 0], [0, 1, -Math.PI / 2], [-1, 0, Math.PI], [0, -1, Math.PI / 2]] as const) if (fences.has(tileKey(st.x + dx, st.y + dy))) part(st, 'rail', quat(0, a, 0));
        break;
      case 'lab': {
        const pulse = (0.5 + 0.5 * Math.sin(st.runT * 4)) * 0.6 * st.act + st.bump * 0.7;
        part(st, 'glass', quat(0, 0, 0));
        part(st, 'core', quat(0, 0, 0), [0, 0, 0], pulse);
        part(st, 'dish', quat(0, st.runT * 0.9, 0));
        st.emit += dt * st.act * busy;
        if (st.emit > 0.7) {
          st.emit = 0;
          fx.sparkle(world(0.3, Y0 + 0.27, 0.27), 0xb8ffd0, 1, 0.03);
        }
        break;
      }
    }
  }

  /** 生産完了の瞬間の演出（品物が飛び出して在庫の山に乗る） */
  function complete(st: BState, b: Building, shown: number) {
    const item = b.out;
    if (!item) return;
    let from: THREE.Vector3;
    switch (st.type) {
      case 'fishing':
        from = world(-0.04, Y0 + 0.08, -0.2);
        fx.splash(from.clone().setY(Y0 + 0.075));
        break;
      case 'cannery':
        from = world(0.06, Y0 + 0.14, 0.17);
        for (let k = 0; k < 3; k++) fx.smoke(world(0.06, Y0 + 0.74, -0.22), 0xffffff);
        break;
      case 'miner':
        from = world(-0.06, Y0 + 0.08, -0.06);
        fx.dust(from.clone(), 5, 0.15);
        break;
      case 'furnace':
        from = world(FURNACE_MOUTH[0], Y0 + 0.12, FURNACE_MOUTH[2] + 0.04);
        fx.sparkle(from.clone(), 0xffb050, 5, 0.08);
        break;
      case 'assembler':
        from = world(BENCH[0], BENCH[1], BENCH[2]);
        fx.sparkle(from.clone().setY(BENCH[1] + 0.1), 0x9fe8ff, 4, 0.1);
        if (item === 'robot') fx.glow(from.clone().setY(BENCH[1] + 0.08), 0x7fe8ff, 0.5);
        break;
      default:
        return;
    }
    const slot = Math.min(shown, bufferCap(b) - 1);
    const to = stackSlot(item, slot, T);
    v.setFromMatrixPosition(to);
    const target = v.clone().applyMatrix4(new THREE.Matrix4().makeTranslation(b.x + 0.5, 0, b.y + 0.5));
    st.flying++;
    fx.fly(item, from, target, st.type === 'fishing' ? 0.7 : 0.5, st.type === 'fishing' ? 0.6 : 0.35, item === 'fish' ? 0.62 : 0.8, () => st.flying--);
  }

  function newState(b: Building, now: number): BState {
    return { type: b.type, x: b.x, y: b.y, born: ready ? now : -1e9, act: BUILDINGS[b.type].time ? (b.running ? 1 : 0) : 1, runT: Math.random() * 10, prevRunning: b.running, prevProgress: b.progress, catchT: 9, bump: 0, emit: 0, hover: 0, red: 0, bar: 0, flying: 0, use: 0, crewed: false, craft: 0, tier: b.tier ?? 1, upT: -1, hits: 0, hpShown: 1, lastHp: b.hp, hitT: -9, crack: 0, brk: isBroken(b) ? 1 : 0, smokeT: 0, yaw: Math.random() * 6, recoil: 0, aimDog: 0, spin: 0, spinV: 0, out: b.out, coinT: -9, coinAmt: 0 };
  }

  return {
    setItemIcon: atlas.set,
    /** 兵器の発射（反動と砲口の煙）。dog は狙った犬 */
    fired(x: number, y: number, dog: number) {
      for (const st of states.values()) {
        if (st.x !== x || st.y !== y || !WEAPONS[st.type]) continue;
        st.recoil = 1;
        st.aimDog = dog;
        M.makeTranslation(x + 0.5, 0, y + 0.5);
        const m = MUZZLE[st.type] ?? 0.3;
        const pv = models[st.type].parts.turret.pivot;
        const mz = world(pv[0] + Math.sin(st.yaw) * m, pv[1] + 0.08, pv[2] + Math.cos(st.yaw) * m);
        if (st.type === 'cannon') {
          for (let k = 0; k < 3; k++) fx.smoke(mz, 0xd8d2ca);
          fx.glow(mz, 0xffb050, 0.5);
        } else if (st.type === 'turret') {
          fx.glow(mz, 0xffd27a, 0.22);
          fx.sparkle(mz, 0xffe08a, 1, 0.02);
          if (Math.random() < 0.4) fx.smoke(mz, 0xd8d2ca);
        }
        return;
      }
    },
    /** 市場の売却・研究所の消費 */
    event(kind: 'coin' | 'rp', s: GameState, x: number, y: number, amount: number) {
      const b = s.buildings.find((b) => b.x === x && b.y === y);
      const st = b && states.get(b.id);
      if (!st) return;
      M.makeTranslation(x + 0.5, 0, y + 0.5);
      if (kind === 'coin') {
        // 市場は自動で毎秒売るので、コインの演出は間引いて額をまとめる
        const t = performance.now() / 1000;
        st.coinAmt += amount;
        if (t - st.coinT < 0.9) return;
        st.coinT = t;
        st.bump = 1;
        fx.coins(world(0, Y0 + 0.5, 0.05), Math.min(8, 2 + Math.round(Math.log2(1 + st.coinAmt))));
        st.coinAmt = 0;
      } else {
        st.bump = 1;
        fx.sparkle(world(-0.09, Y0 + 0.5, -0.08), 0x9ffff0, 3, 0.16);
      }
    },
    /** レイが最初に当たる建物 */
    pick(ray: THREE.Ray, s: GameState) {
      let best: Building | null = null;
      let bestD = Infinity;
      const box = new THREE.Box3();
      for (const b of s.buildings) {
        box.min.set(b.x + 0.05, 0, b.y + 0.05);
        box.max.set(b.x + 0.95, models[b.type].top * 0.8, b.y + 0.95);
        const hit = ray.intersectBox(box, v);
        if (!hit) continue;
        const d = hit.distanceTo(ray.origin);
        if (d < bestD) (bestD = d), (best = b);
      }
      return best;
    },
    update(s: GameState, dt: number, now: number, ui: UiState) {
      time.value = now;
      for (const l of Object.values(base)) l.begin();
      for (const l of Object.values(parts)) l.begin();
      for (const l of [pads, ponds, bars, hpBars, icons, tierStars, goodBadge, ...Object.values(deco)]) l.begin();
      fences.clear();
      for (const b of s.buildings) if (b.type === 'fence') fences.add(tileKey(b.x, b.y));
      dogs = s.raid?.cur?.dogs ?? [];
      reserved.clear();
      users.clear();
      crew.clear();
      for (const c of s.cats) {
        if (c.state === 'toSource') reserved.set(c.src, (reserved.get(c.src) ?? 0) + c.amount);
        if (c.restAt && c.path.length === 0) users.set(c.restAt, (users.get(c.restAt) ?? 0) + 1);
        if (isWorking(c)) {
          const k = crew.get(c.job) ?? { n: 0, good: false };
          k.n++;
          k.good ||= c.good === WORK_STAT[s.buildings.find((b) => b.id === c.job)?.type ?? 'market'];
          crew.set(c.job, k);
        }
      }

      const seen = new Set<number>();
      // 供給元のある品（材料待ちの建物があるときだけ集める）
      let supplied: Set<ItemId> | null = null;
      for (const b of s.buildings) {
        seen.add(b.id);
        let st = states.get(b.id);
        if (!st) {
          st = newState(b, now);
          states.set(b.id, st);
          if (ready) fx.dust(new THREE.Vector3(b.x + 0.5, 0.02, b.y + 0.5), 12, 0.5);
        }
        const def = BUILDINGS[b.type];
        const broken = isBroken(b);
        const running = (def.time ? b.running : true) && !broken;
        const team = crew.get(b.id);
        // 耐久: 噛まれると揺れて土ぼこり、壊れた瞬間は煙が噴き、故障中は煙がくすぶる
        const max = maxHp(s, b);
        const ratio = Math.max(0, Math.min(1, b.hp / max));
        if (b.hp < st.lastHp - 1e-3) {
          if (now - st.hitT > 0.4) fx.dust(new THREE.Vector3(b.x + 0.5, 0.05, b.y + 0.5), 4, 0.35);
          st.hitT = now;
          if (broken) {
            st.bump = 1;
            fx.dust(new THREE.Vector3(b.x + 0.5, 0.05, b.y + 0.5), 14, 0.55);
            for (let k = 0; k < 5; k++) fx.smoke(new THREE.Vector3(b.x + 0.3 + Math.random() * 0.4, 0.4 + Math.random() * 0.3, b.y + 0.3 + Math.random() * 0.4), 0x5a544e);
          }
        } else if (b.hp > st.lastHp + 1 && ratio >= 0.999) {
          fx.sparkle(new THREE.Vector3(b.x + 0.5, 0.45, b.y + 0.5), 0xfff1a8, 8, 0.35);
          st.bump = Math.max(st.bump, 0.6);
        }
        st.lastHp = b.hp;
        st.hpShown += (ratio - st.hpShown) * (1 - Math.exp(-dt * 8));
        st.crack = 1 - st.hpShown;
        st.brk += ((broken ? 1 : 0) - st.brk) * (1 - Math.exp(-dt * 4));
        if (broken) {
          st.smokeT -= dt;
          if (st.smokeT <= 0) {
            st.smokeT = 0.35 + Math.random() * 0.25;
            fx.smoke(new THREE.Vector3(b.x + 0.35 + Math.random() * 0.3, models[b.type].top * 0.7, b.y + 0.35 + Math.random() * 0.3), 0x6a645e);
          }
        }
        if (WEAPONS[b.type]) {
          // 狙っている犬（いなければ射程内で一番近い犬）を向く。いなければゆっくり見回す
          const range = weaponRange(b) + 0.5;
          let t = dogs.find((d) => d.id === st.aimDog && Math.hypot(d.x - b.x, d.y - b.y) <= range);
          if (!t) {
            let bd = range;
            for (const d of dogs) {
              const dd = Math.hypot(d.x - b.x, d.y - b.y);
              if (dd < bd) (bd = dd), (t = d);
            }
          }
          const goal = t && !broken ? Math.atan2(t.x - b.x, t.y - b.y) : st.yaw + dt * 0.25 * (broken ? 0 : 1);
          st.yaw += wrap(goal - st.yaw) * (1 - Math.exp(-dt * 9));
          st.recoil *= Math.exp(-dt * 7);
          st.spinV = Math.max(st.spinV * Math.exp(-dt * 1.5), st.recoil > 0.3 ? 28 : 0);
          st.spin += st.spinV * dt;
        }
        st.crewed = !!team;
        st.craft += ((team && b.running ? 1 : 0) - st.craft) * (1 - Math.exp(-dt * 3));
        st.act += ((running ? 1 : 0) - st.act) * (1 - Math.exp(-dt * (running ? 4 : 2.2)));
        // 職人がいる間は機械も速く動く
        st.runT += dt * st.act * (1 + 0.8 * st.craft);
        // 強化: 足場を組んで木づちで 3 回打ち、完了でキラキラ
        if (st.upT < 0 && (b.tier ?? 1) > st.tier) {
          st.upT = now;
          st.hits = 0;
        }
        const upAge = st.upT < 0 ? -1 : now - st.upT;
        if (upAge >= 0 && st.hits < HITS.length && upAge >= HITS[st.hits]) {
          st.hits++;
          st.bump = Math.max(st.bump, 0.45);
          fx.dust(new THREE.Vector3(b.x + 0.5 + 0.3, 0.05, b.y + 0.5 + 0.38), 6, 0.25);
          sound('thud');
        }
        if (upAge >= UPGRADE_T) {
          st.upT = -1;
          st.tier++;
          st.bump = 1;
          fx.sparkle(new THREE.Vector3(b.x + 0.5, 0.5, b.y + 0.5), 0xfff1a8, 14, 0.45);
          fx.glow(new THREE.Vector3(b.x + 0.5, 0.45, b.y + 0.5), 0xffe27a, 0.9);
          sound('research');
        }
        st.catchT += dt;
        st.bump *= Math.exp(-dt * 5);
        const inUse = (users.get(b.id) ?? 0) > 0 ? 1 : 0;
        st.use += (inUse - st.use) * (1 - Math.exp(-dt * (inUse ? 6 : 3)));
        st.hover += ((ui.hoverId === b.id && ui.mode !== 'remove' ? 1 : 0) - st.hover) * (1 - Math.exp(-dt * 12));
        st.red += ((ui.hoverId === b.id && ui.mode === 'remove' ? 1 : 0) - st.red) * (1 - Math.exp(-dt * 12));
        // 出現は弾みながら拡大、売却・消費で軽く弾む
        const age = now - st.born;
        const grow = age < 1.2 ? 1 - Math.exp(-7 * age) * Math.cos(11 * age) : 1;
        const growXZ = age < 1.2 ? 1 - Math.exp(-7 * Math.max(0, age - 0.05)) * Math.cos(11 * Math.max(0, age - 0.05)) : 1;
        const squash = st.bump * Math.sin(st.bump * 9) * 0.08;
        // キャットタワーは乗っている猫がいるとゆらゆら揺れる
        const sway = b.type === 'tower' ? st.use * 0.035 : 0;
        const [tx, ty] = TIER_SCALE[st.tier - 1] ?? TIER_SCALE[0];
        const hitAge = now - st.hitT;
        const shake = (upAge >= 0 ? Math.sin(now * 40) * 0.01 * Math.exp(-((upAge - HITS[Math.max(0, st.hits - 1)]) * 8)) : 0) + (hitAge < 0.3 ? Math.sin(now * 55) * 0.018 * (1 - hitAge / 0.3) : 0);
        // ティアの装飾は建物の大きさに合わせず、タイルの角に置く
        M.compose(v.set(b.x + 0.5, 0, b.y + 0.5), quat(0, 0, 0), sc.set(Math.max(growXZ, 1e-3), Math.max(grow, 1e-3), Math.max(growXZ, 1e-3)));
        if (st.tier >= 2 && b.type !== 'fence') {
          const work = !FACILITY[b.type] && b.type !== 'market';
          (work ? deco.work : deco.rest).push(M);
          const fi = deco.flag.push(O.multiplyMatrices(M, T.compose(v.set(0.4, Y0 + (work ? 0.72 : 0.54), -0.4), quat(0, Math.sin(now * 3 + b.id) * 0.35, Math.sin(now * 5 + b.id) * 0.05), sc.setScalar(1))));
          deco.flag.color(fi, flagCol.setHex(st.tier >= 3 ? 0xf2c447 : def.color));
        }
        if (st.tier >= 3) deco.gold.push(M);
        if (upAge >= 0) {
          // 足場はせり上がって現れ、最後に縮んで消える
          const show = Math.min(1, upAge / 0.2) * Math.min(1, (UPGRADE_T - upAge) / 0.15);
          deco.scaffold.push(O.multiplyMatrices(M, T.compose(v.set(0, 0, 0), quat(0, 0, 0), sc.set(1, Math.max(show, 1e-3), 1))));
          // 木づちは打つ瞬間に振り下ろす
          const next = HITS[Math.min(st.hits, HITS.length - 1)];
          const swing = st.hits < HITS.length ? smoothstep01(1 - Math.max(0, next - upAge) / 0.3) : 0;
          deco.mallet.push(O.multiplyMatrices(M, T.compose(v.set(0.3, Y0 + 0.25, 0.4), quat(0, 0, 0.9 - 1.7 * swing), sc.setScalar(1.2 * show))));
        }
        M.compose(v.set(b.x + 0.5 + shake, 0, b.y + 0.5), quat(Math.sin(now * 2.1) * sway, 0, Math.sin(now * 1.6 + 1) * sway), sc.set(Math.max((growXZ + squash) * tx, 1e-3), Math.max((grow - squash) * ty, 1e-3), Math.max((growXZ + squash) * tx, 1e-3)));
        const i = base[b.type].push(M);
        base[b.type].set('aFx', i, b.type === 'market' ? 0 : 1 - st.act, st.hover, st.red, 0);
        base[b.type].set('aDmg', i, st.crack, st.brk);
        if (b.type !== 'fence') pads.push(T.compose(v.set(b.x + 0.5, 0, b.y + 0.5), quat(0, 0, 0), sc.set(Math.max(growXZ, 1e-3), 1, Math.max(growXZ, 1e-3))));
        const cap = bufferCap(b);
        const shown = Math.max(0, Math.min(cap, b.output + (reserved.get(b.id) ?? 0) - st.flying));
        if (def.time && st.prevRunning && (!b.running || b.progress < st.prevProgress - 1e-6) && b.type !== 'lab') {
          st.catchT = 0;
          complete(st, b, shown);
        }
        st.prevRunning = b.running;
        st.prevProgress = b.progress;
        animate(st, b, dt, now);

        // 在庫の山
        st.out = b.out;
        const item = b.out;
        const pile = Math.max(0, Math.min(cap, b.output + (reserved.get(b.id) ?? 0) - st.flying));
        if (item) for (let k = 0; k < pile; k++) items.push(item, O.multiplyMatrices(M, stackSlot(item, k, T)));

        // 進捗バーと吹き出し
        const top = models[b.type].top * ty;
        // 本部は手作業の進み
        const hand = b.type === 'hq' ? s.hand.q[0] : undefined;
        st.bar += ((((def.time && b.running) || hand) && !broken ? 1 : 0) - st.bar) * (1 - Math.exp(-dt * 10));
        if (st.bar > 0.02) {
          const j = bars.push(T.compose(v.set(b.x + 0.5, top + 0.14, b.y + 0.5), q.identity(), sc.setScalar(0.85 + 0.15 * st.bar)));
          bars.set('aBar', j, hand ? Math.min(1, s.hand.t / HAND[hand.id].time) : prog(b), st.bar);
        }
        // 耐久バーは減っているときだけ
        if (st.hpShown < 0.995 || ratio < 0.995) {
          const j = hpBars.push(T.compose(v.set(b.x + 0.5, top + 0.26, b.y + 0.5), q.identity(), sc.setScalar(hitAge < 0.25 ? 1.08 : 1)));
          hpBars.set('aBar', j, st.hpShown, Math.min(1, (1 - st.hpShown) * 40));
        }
        const full = outputFull(s, b);
        const waiting = !full && !broken && !!RECIPES_OF[b.type] && !b.running && !hasInputs(s, b);
        const ammo = WEAPONS[b.type]?.ammo;
        const empty = !!ammo && (b.input[ammo] ?? 0) < 1;
        const none = waiting && missingSources(s, b, (supplied ??= suppliedItems(s))).length > 0;
        if (broken || full || waiting || empty) {
          let icon = 0;
          if (broken) icon = ICONS.indexOf('tool');
          else if (empty) icon = ICONS.indexOf('ammo');
          else if (none) icon = ICONS.indexOf('none');
          else if (waiting) {
            // 固定レシピ（自動なら最初のレシピ）で最初に足りない材料
            const r = RECIPES[b.recipe ?? RECIPES_OF[b.type]![0]];
            const need = (Object.keys(r.in) as ItemId[]).find((it) => (b.input[it] ?? 0) < r.in[it]!);
            icon = need ? 1 + ITEM_IDS.indexOf(need) : 0;
          }
          const loud = broken || full || none;
          const bob = loud ? Math.abs(Math.sin(now * 4)) * 0.09 : Math.sin(now * 1.6 + b.id) * 0.025;
          const s = loud ? 1 + Math.sin(now * 8) * 0.04 : 0.8;
          const j = icons.push(T.compose(v.set(b.x + 0.5, top + 0.46 + bob, b.y + 0.5), q.identity(), sc.setScalar(s)));
          icons.set('aIcon', j, icon, loud || empty ? 1 : 0.82);
        }
        // ティアの ★（柵は強化したものだけ）と、得意な職人が作業している間の得意バッジ（キラキラ付き）
        if (b.type !== 'fence' || st.tier > 1) {
          const tj = tierStars.push(T.compose(v.set(b.x + 0.5, top + 0.14, b.y + 0.5), q.identity(), sc.setScalar(st.tier === 1 ? 0.75 : 1)));
          tierStars.set('aIcon', tj, st.tier - 1, st.tier === 1 ? 0.7 : 1);
        }
        if (team?.good) {
          const gj = goodBadge.push(T.compose(v.set(b.x + 0.5, top + 0.14 + Math.sin(now * 3 + b.id) * 0.015, b.y + 0.5), q.identity(), sc.setScalar(1 + Math.sin(now * 6) * 0.04)));
          goodBadge.set('aIcon', gj, 3, 1);
          if (Math.random() < dt * 2.5) fx.sparkle(new THREE.Vector3(b.x + 0.5 + 0.25, top + 0.2, b.y + 0.5), 0xffe27a, 1, 0.12);
        }
      }
      for (const [id, st] of states)
        if (!seen.has(id)) {
          states.delete(id);
          dying.push({ st, t: now });
          fx.dust(new THREE.Vector3(st.x + 0.5, 0.02, st.y + 0.5), 10, 0.45);
        }
      // 撤去: 跳ねてから縮んで消える
      for (let k = dying.length - 1; k >= 0; k--) {
        const d = dying[k];
        const t = (now - d.t) / 0.4;
        if (t >= 1) {
          dying.splice(k, 1);
          continue;
        }
        const s2 = Math.max(1e-3, 1 - t * t);
        M.compose(v.set(d.st.x + 0.5, Math.sin(t * Math.PI) * 0.15, d.st.y + 0.5), quat(0, t * 1.5, 0), sc.setScalar(s2));
        d.st.act = 0;
        const di = base[d.st.type].push(M);
        base[d.st.type].set('aFx', di, 0.6, 0, 0, 0);
        base[d.st.type].set('aDmg', di, d.st.crack, d.st.brk);
        animate(d.st, null, 0, now);
      }

      // 設置ゴースト
      const placing = ui.mode && ui.mode !== 'remove' && ui.mode !== 'lift' && ui.hoverTile;
      if (placing) {
        const geo = models[ui.mode as BuildingType].full;
        if (ghost.geometry !== geo) ghost.geometry = geo;
        ghostGoal.set(ui.hoverTile!.x + 0.5, 0.06 + Math.sin(now * 3) * 0.03, ui.hoverTile!.y + 0.5);
        if (!ghost.visible) ghost.position.copy(ghostGoal);
        ghost.position.lerp(ghostGoal, 1 - Math.exp(-dt * 22));
        ghost.position.x += ui.canPlace ? 0 : Math.sin(now * 40) * 0.01;
        ghostMat.emissive.setHex(ui.canPlace ? 0x223a55 : 0x8a1010);
        ghostMat.opacity = ui.canPlace ? 0.62 : 0.5;
        ghost.scale.setScalar(1 + Math.sin(now * 3) * 0.015);
      }
      ghost.visible = !!placing;

      for (const l of Object.values(base)) l.end();
      for (const l of Object.values(parts)) l.end();
      for (const l of [pads, ponds, bars, hpBars, icons, tierStars, goodBadge, ...Object.values(deco)]) l.end();
      ready = true;
    },
  };
}

const smoothstep01 = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

function prog(b: Building) {
  const t = BUILDINGS[b.type].time ? recipeTime(b) : 0;
  return t ? Math.min(1, b.progress / t) : 0;
}
