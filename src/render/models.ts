import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BuildingType, ItemId, OreId } from '../sim/data';
import { EYE_Y } from './materials';

export type V3 = [number, number, number];
export interface PartOpt {
  p?: V3;
  r?: V3;
  s?: V3 | number;
  glow?: number;
  /** 面ごとの法線（角柱の屋根などカクッとした陰影にする） */
  flat?: boolean;
  /** 猫用: 頂点ごとの [塗り種別, 白い模様の量]。種別 0 固定色 1 毛 2 瞳 3 目のハイライト */
  paint?: (p: THREE.Vector3) => [number, number];
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();
const _v = new THREE.Vector3();

function compose(o: PartOpt) {
  const s = o.s ?? 1;
  const sv = typeof s === 'number' ? [s, s, s] : s;
  return _m.compose(_p.set(...(o.p ?? [0, 0, 0])), _q.setFromEuler(_e.set(...(o.r ?? [0, 0, 0]))), _s.set(sv[0], sv[1], sv[2]));
}

/** 色付きパーツを 1 つのジオメトリに合成する（属性: position normal color glow [paint]） */
export class Geo {
  private parts: THREE.BufferGeometry[] = [];
  constructor(private withPaint = false) {}

  add(src: THREE.BufferGeometry, color: number, o: PartOpt = {}) {
    const g = src.index ? src.toNonIndexed() : src.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (o.flat) g.computeVertexNormals();
    g.applyMatrix4(compose(o));
    const pos = g.attributes.position;
    const n = pos.count;
    _c.set(color);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([_c.r, _c.g, _c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('glow', new THREE.BufferAttribute(new Float32Array(n).fill(o.glow ?? 0), 1));
    if (this.withPaint) {
      const pa = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) pa.set(o.paint ? o.paint(_v.fromBufferAttribute(pos, i)) : [1, 0], i * 2);
      g.setAttribute('paint', new THREE.BufferAttribute(pa, 2));
    }
    this.parts.push(g);
    return this;
  }

  /** 合成済みジオメトリを変換して追加 */
  put(src: THREE.BufferGeometry, o: PartOpt = {}) {
    this.parts.push(src.clone().applyMatrix4(compose(o)));
    return this;
  }

  build() {
    const g = mergeGeometries(this.parts)!;
    for (const p of this.parts) p.dispose();
    g.computeBoundingSphere();
    return g;
  }
}

// --- プリミティブ ---
export const rbox = (w: number, h: number, d: number, r = 0.03, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, r);
export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
export const cyl = (rt: number, rb: number, h: number, seg = 14) => new THREE.CylinderGeometry(rt, rb, h, seg);
export const sph = (r: number, ws = 14, hs = 10) => new THREE.SphereGeometry(r, ws, hs);
export const cone = (r: number, h: number, seg = 12) => new THREE.ConeGeometry(r, h, seg);
export const torus = (R: number, r: number, rs = 8, ts = 20, arc = Math.PI * 2) => new THREE.TorusGeometry(R, r, rs, ts, arc);
export const lathe = (pts: [number, number][], seg = 18) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);

const PI = Math.PI;
/** 建物の土台（石畳パッド）の上面の高さ */
export const Y0 = 0.05;

// --- 色 ---
const WOOD = 0xc08a58;
const WOOD_D = 0x8e5f3a;
const WOOD_L = 0xe2b47e;
const STONE = 0xbdb6ad;
const STONE_D = 0x948c84;
const METAL = 0xb7c2cc;
const WHITE = 0xfffaf2;
const GOLD = 0xf2c447;

// ===================== アイテム =====================

const rock = new THREE.DodecahedronGeometry(1, 0);

/** 鉱石の塊: 地の岩に鉱物の粒（glow で少し光る） */
function ore(g: Geo, base: number, fleck: number, glow = 0) {
  g.add(rock, base, { p: [0, 0.034, 0], s: [0.05, 0.036, 0.044], r: [0.3, 0.5, 0.2], flat: true });
  g.add(rock, base, { p: [0.036, 0.022, 0.022], s: [0.027, 0.022, 0.025], r: [1, 0.2, 0.6], flat: true });
  g.add(rock, base, { p: [-0.03, 0.018, 0.026], s: [0.022, 0.018, 0.02], r: [0.2, 1.3, 0.4], flat: true });
  for (const [x, y, z, r] of [[-0.02, 0.058, 0.016, 0.016], [0.026, 0.05, -0.02, 0.012], [-0.04, 0.034, -0.014, 0.013], [0.012, 0.04, 0.04, 0.011]] as const)
    g.add(rock, fleck, { p: [x, y, z], s: r, r: [x * 30, z * 20, 0], flat: true, glow });
}

function plate(g: Geo, col: number, edge: number) {
  g.add(rbox(0.11, 0.018, 0.085, 0.006), col, { p: [0, 0.009, 0] });
  g.add(box(0.09, 0.003, 0.006), 0xffffff, { p: [-0.004, 0.0185, -0.026] });
  g.add(box(0.112, 0.006, 0.087), edge, { p: [0, 0.003, 0] });
}

/** 研究パック: 色の液体の入ったフラスコ（形で種類を見分ける） */
function pack(g: Geo, liquid: number, shape: 'round' | 'cone' | 'hex') {
  const GLASS = 0xeef8ff;
  if (shape === 'round') {
    g.add(sph(0.042, 14, 10), liquid, { p: [0, 0.042, 0], glow: 0.6 });
    g.add(cyl(0.014, 0.016, 0.04, 10), GLASS, { p: [0, 0.098, 0] });
  } else if (shape === 'cone') {
    g.add(lathe([[0, 0], [0.042, 0], [0.045, 0.006], [0.018, 0.07], [0, 0.07]], 14), liquid, { glow: 0.6 });
    g.add(cyl(0.014, 0.018, 0.04, 10), GLASS, { p: [0, 0.084, 0] });
  } else {
    g.add(cyl(0.034, 0.036, 0.07, 6), liquid, { p: [0, 0.035, 0], glow: 0.6, flat: true });
    g.add(cyl(0.02, 0.034, 0.02, 6), GLASS, { p: [0, 0.08, 0], flat: true });
    g.add(cyl(0.013, 0.013, 0.02, 10), GLASS, { p: [0, 0.098, 0] });
  }
  g.add(cyl(0.015, 0.012, 0.016, 8), WOOD, { p: [0, 0.112, 0] });
  g.add(sph(1, 8, 6), 0xffffff, { p: [-0.018, 0.05, 0.028], s: [0.008, 0.016, 0.004] });
}

const ITEM_BUILDERS: Record<ItemId, (g: Geo) => void> = {
  ironOre: (g) => ore(g, 0x8a7568, 0xc0623e),
  copperOre: (g) => ore(g, 0x8f8a80, 0xf0904a, 0.25),
  coal: (g) => ore(g, 0x2c2c33, 0x5a5a66),
  stone(g) {
    g.add(sph(1, 10, 7), 0xb8b0a4, { p: [0, 0.03, 0], s: [0.05, 0.03, 0.04], r: [0, 0.4, 0] });
    g.add(sph(1, 9, 6), 0xa49c90, { p: [0.04, 0.02, 0.025], s: [0.028, 0.02, 0.024] });
    g.add(sph(1, 9, 6), 0xc8c0b4, { p: [-0.025, 0.05, -0.008], s: [0.026, 0.02, 0.024] });
  },
  ironPlate: (g) => plate(g, 0xb4bec8, 0x7e8892),
  copperPlate: (g) => plate(g, 0xe48c4c, 0xa85e30),
  brick(g) {
    g.add(rbox(0.1, 0.045, 0.05, 0.008), 0xc96a4a, { p: [0, 0.0225, 0] });
    g.add(box(0.09, 0.004, 0.04), 0xe08a6a, { p: [0, 0.045, 0] });
    g.add(rock, 0xa85a3e, { p: [0.04, 0.03, 0.022], s: 0.008, flat: true });
  },
  gear(g) {
    const C = 0x9aa6b2;
    g.add(cyl(0.044, 0.044, 0.022, 20), C, { p: [0, 0.011, 0] });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * PI * 2;
      g.add(box(0.018, 0.022, 0.018), C, { p: [Math.cos(a) * 0.05, 0.011, Math.sin(a) * 0.05], r: [0, -a, 0] });
    }
    g.add(torus(0.03, 0.004, 5, 18), 0x7a8692, { p: [0, 0.022, 0], r: [PI / 2, 0, 0] });
    g.add(cyl(0.013, 0.013, 0.024, 10), 0x4a525a, { p: [0, 0.012, 0] });
  },
  wire(g) {
    g.add(cyl(0.044, 0.044, 0.008, 16), WOOD_D, { p: [0, 0.004, 0] });
    g.add(cyl(0.044, 0.044, 0.008, 16), WOOD_D, { p: [0, 0.064, 0] });
    g.add(cyl(0.032, 0.032, 0.054, 16), 0xd87a34, { p: [0, 0.034, 0] });
    for (let k = 0; k < 5; k++) g.add(torus(0.033, 0.0055, 5, 18), k % 2 ? 0xf0a050 : 0xe08a3e, { p: [0, 0.014 + k * 0.01, 0], r: [PI / 2, 0, 0] });
    g.add(cyl(0.003, 0.003, 0.05, 4), 0xf0a050, { p: [0.04, 0.03, 0.02], r: [0.3, 0, 1.2] });
  },
  circuit(g) {
    g.add(rbox(0.11, 0.012, 0.085, 0.004), 0x2f9a4c, { p: [0, 0.006, 0] });
    g.add(rbox(0.036, 0.01, 0.03, 0.003), 0x22262c, { p: [0.012, 0.016, -0.004] });
    for (const z of [-0.012, 0, 0.012]) for (const sx of [-1, 1]) g.add(box(0.008, 0.003, 0.004), 0xd8dde2, { p: [0.012 + sx * 0.022, 0.0125, -0.004 + z] });
    for (const z of [-0.032, 0.03]) g.add(box(0.08, 0.002, 0.004), GOLD, { p: [-0.005, 0.0125, z] });
    g.add(box(0.004, 0.002, 0.06), GOLD, { p: [-0.042, 0.0125, 0] });
    g.add(cyl(0.008, 0.008, 0.012, 8), 0x3a6fb0, { p: [-0.025, 0.018, -0.015] });
    g.add(sph(0.006, 6, 5), 0x7dff9a, { p: [-0.036, 0.016, 0.024], glow: 1 });
  },
  steel(g) {
    const C = 0x6a7480;
    g.add(box(0.13, 0.008, 0.05), C, { p: [0, 0.004, 0] });
    g.add(box(0.13, 0.008, 0.05), C, { p: [0, 0.046, 0] });
    g.add(box(0.13, 0.036, 0.01), 0x5a636e, { p: [0, 0.025, 0] });
    g.add(box(0.13, 0.002, 0.006), 0xaab4be, { p: [0, 0.0505, -0.018] });
  },
  redPack: (g) => pack(g, 0xe5484d, 'round'),
  greenPack: (g) => pack(g, 0x4fbf5a, 'cone'),
  bluePack: (g) => pack(g, 0x4a8fe0, 'hex'),
  fish(g) {
    g.add(sph(1, 14, 10), 0x5aa6e0, { p: [0, 0.035, 0], s: [0.07, 0.033, 0.027] });
    g.add(sph(1, 12, 8), 0xe2f2fb, { p: [0.006, 0.027, 0], s: [0.058, 0.021, 0.023] });
    g.add(cone(0.032, 0.05, 6), 0x3f86c4, { p: [-0.088, 0.035, 0], r: [0, 0, -PI / 2], s: [1, 1, 0.32] });
    g.add(cone(0.02, 0.03, 6), 0x3f86c4, { p: [-0.005, 0.068, 0], s: [1.7, 1, 0.3] });
    for (const z of [-1, 1]) {
      g.add(sph(0.009, 8, 6), 0xffffff, { p: [0.044, 0.044, z * 0.02] });
      g.add(sph(0.0055, 6, 5), 0x1b1512, { p: [0.048, 0.045, z * 0.024] });
    }
  },
  can(g) {
    g.add(cyl(0.045, 0.045, 0.066, 18), 0xd3dae2, { p: [0, 0.033, 0] });
    g.add(cyl(0.0462, 0.0462, 0.036, 18), 0xf08a3c, { p: [0, 0.033, 0] });
    g.add(sph(1, 8, 6), 0xffffff, { p: [0, 0.033, 0.045], s: [0.016, 0.008, 0.004] });
    g.add(torus(0.04, 0.005, 6, 18), 0xa9b3bd, { p: [0, 0.066, 0], r: [PI / 2, 0, 0] });
    g.add(rbox(0.02, 0.005, 0.012, 0.002), 0xa9b3bd, { p: [0.012, 0.068, 0] });
  },
  bullet(g) {
    for (const [x, z] of [[-0.021, -0.012], [0.021, -0.012], [0, 0.024]] as const) {
      g.add(cyl(0.012, 0.012, 0.044, 10), 0xd9a441, { p: [x, 0.024, z] });
      g.add(cyl(0.013, 0.013, 0.005, 10), 0xb08030, { p: [x, 0.0025, z] });
      g.add(sph(1, 10, 8), 0xb87a4a, { p: [x, 0.046, z], s: [0.012, 0.02, 0.012] });
    }
  },
  shell(g) {
    g.add(sph(0.04, 14, 10), 0x3d4048, { p: [0, 0.04, 0] });
    g.add(torus(0.04, 0.005, 6, 18), 0xd9a441, { p: [0, 0.04, 0], r: [PI / 2, 0, 0] });
    g.add(cyl(0.008, 0.01, 0.025, 6), 0x8a6a3a, { p: [0, 0.088, 0] });
    g.add(sph(0.009, 6, 5), 0xffb03a, { p: [0, 0.103, 0], glow: 1 });
    g.add(sph(1, 8, 6), 0xffffff, { p: [-0.015, 0.06, 0.03], s: [0.01, 0.006, 0.004] });
  },
  robot(g) {
    // 折りたたまれたロボ猫（耳つきの金属の箱、目が光る）
    g.add(rbox(0.1, 0.08, 0.09, 0.02), 0xc9d3dc, { p: [0, 0.04, 0] });
    g.add(rbox(0.104, 0.014, 0.094, 0.006), 0x4fc4e8, { p: [0, 0.03, 0], glow: 0.5 });
    g.add(rbox(0.07, 0.03, 0.01, 0.006), 0x23282e, { p: [0, 0.056, 0.045] });
    for (const sx of [-1, 1]) {
      g.add(sph(0.007, 6, 5), 0x7fe8ff, { p: [sx * 0.018, 0.057, 0.051], glow: 1 });
      g.add(cone(0.02, 0.035, 4), 0xc9d3dc, { p: [sx * 0.03, 0.095, 0.01], r: [0, PI / 4, sx * -0.2], flat: true });
    }
    g.add(cyl(0.003, 0.003, 0.04, 4), 0x5a6670, { p: [0, 0.09, -0.04], r: [-0.5, 0, 0] });
    g.add(sph(0.007, 6, 5), 0xffc845, { p: [0, 0.108, -0.05], glow: 1 });
  },
};

export function itemGeo(id: ItemId) {
  const g = new Geo();
  ITEM_BUILDERS[id](g);
  return g.build();
}

/** 積み上げ時の 1 段の高さ */
export const ITEM_H: Record<ItemId, number> = {
  ironOre: 0.06, copperOre: 0.06, coal: 0.06, stone: 0.06,
  ironPlate: 0.02, copperPlate: 0.02, brick: 0.046,
  gear: 0.024, wire: 0.07, circuit: 0.017, steel: 0.051,
  redPack: 0.12, greenPack: 0.12, bluePack: 0.12,
  fish: 0.055, can: 0.066, bullet: 0.066, shell: 0.08, robot: 0.1,
};

// ===================== 建物 =====================

export interface PartModel {
  geo: THREE.BufferGeometry;
  mat: 'fx' | 'belt' | 'glass';
  /** 建物原点からの回転中心 */
  pivot: V3;
  /** 建物 1 棟あたりのインスタンス数 */
  count: number;
  /** 静止時の姿勢（ゴーストとサムネイル用） */
  rest?: V3;
  /** 影を落とすか */
  shadow: boolean;
}

export interface BuildingModel {
  base: THREE.BufferGeometry;
  parts: Record<string, PartModel>;
  /** ゴースト・サムネイル用の全体形状 */
  full: THREE.BufferGeometry;
  /** 頭上表示の高さ */
  top: number;
  /** 出力を積むパレット */
  pallet: boolean;
}

/** 出力パレットの中心 */
export const PALLET: V3 = [0.32, Y0, 0.32];

function pallet(g: Geo) {
  g.add(rbox(0.22, 0.022, 0.22, 0.006), WOOD_L, { p: [PALLET[0], Y0 + 0.011, PALLET[2]] });
  for (const dz of [-0.07, 0, 0.07]) g.add(box(0.21, 0.012, 0.035), WOOD_D, { p: [PALLET[0], Y0 + 0.006, PALLET[2] + dz] });
}

function window(g: Geo, x: number, y: number, z: number, w = 0.1, h = 0.1, pane = 0xffd88a, frame = WHITE, ry = 0) {
  g.add(rbox(w + 0.025, h + 0.025, 0.018, 0.006), frame, { p: [x, y, z], r: [0, ry, 0] });
  g.add(rbox(w, h, 0.02, 0.006), pane, { p: [x, y, z + (ry ? 0 : 0.003)], r: [0, ry, 0], glow: 0.9 });
  g.add(box(w, 0.008, 0.022), frame, { p: [x, y, z + 0.002], r: [0, ry, 0] });
}

const pebble = new THREE.DodecahedronGeometry(1, 0);

function fishing(): BuildingModel {
  const g = new Geo();
  const cx = -0.08;
  const cz = -0.08;
  const o = 0.74;
  const t = 0.11;
  const h = 0.09;
  // 石の縁
  g.add(rbox(o, h, t, 0.04, 3), STONE, { p: [cx, Y0 + h / 2, cz + (o - t) / 2] });
  g.add(rbox(o, h, t, 0.04, 3), STONE, { p: [cx, Y0 + h / 2, cz - (o - t) / 2] });
  g.add(rbox(t, h, o - 2 * t + 0.02, 0.04, 3), STONE, { p: [cx + (o - t) / 2, Y0 + h / 2, cz] });
  g.add(rbox(t, h, o - 2 * t + 0.02, 0.04, 3), STONE, { p: [cx - (o - t) / 2, Y0 + h / 2, cz] });
  const peb: [number, number, number][] = [[0.3, 0.12, 0.04], [0.27, -0.3, 0.035], [-0.41, -0.38, 0.045], [0.06, -0.45, 0.04], [-0.43, 0.08, 0.035], [0.29, 0.3, 0.03]];
  for (const [x, z, r] of peb) g.add(pebble, STONE_D, { p: [x, Y0 + h, z], s: [r, r * 0.7, r], r: [x * 3, z * 5, 0], flat: true });
  // 池の底（水面シェーダーの下）
  g.add(box(o - 2 * t + 0.02, 0.02, o - 2 * t + 0.02), 0x2f6f8f, { p: [cx, Y0 + 0.01, cz] });
  // 桟橋
  for (let i = 0; i < 6; i++) g.add(rbox(0.17, 0.024, 0.062, 0.008), i % 2 ? WOOD_L : 0xd6a46d, { p: [-0.22, Y0 + 0.105, 0.33 - i * 0.07] });
  for (const x of [-0.29, -0.15]) g.add(cyl(0.017, 0.017, 0.12, 8), WOOD_D, { p: [x, Y0 + 0.05, -0.03] });
  g.add(cyl(0.016, 0.02, 0.08, 8), WOOD_D, { p: [-0.22, Y0 + 0.15, -0.01] });
  // バケツと魚の尾
  g.add(cyl(0.045, 0.036, 0.07, 14), 0x6f9fc8, { p: [-0.24, Y0 + 0.152, 0.24] });
  g.add(torus(0.045, 0.004, 5, 16), 0x4f7fa8, { p: [-0.24, Y0 + 0.187, 0.24], r: [PI / 2, 0, 0] });
  g.add(cone(0.026, 0.04, 6), 0x3f86c4, { p: [-0.23, Y0 + 0.21, 0.24], s: [1, 1, 0.3], r: [0, 0.4, 0.2] });
  // 葦と蓮の葉
  for (const [x, z, hh] of [[0.18, -0.34, 0.22], [0.22, -0.31, 0.17], [0.14, -0.3, 0.19]] as V3[]) {
    g.add(cyl(0.006, 0.008, hh, 5), 0x5d9e4a, { p: [x, Y0 + 0.04 + hh / 2, z] });
    g.add(new THREE.CapsuleGeometry(0.014, 0.035, 3, 6), 0x7a4e2c, { p: [x, Y0 + 0.04 + hh, z] });
  }
  g.add(cyl(0.05, 0.05, 0.006, 12), 0x5fae5a, { p: [0.06, Y0 + 0.066, 0.06] });
  g.add(cyl(0.04, 0.04, 0.006, 12), 0x6bbb62, { p: [-0.3, Y0 + 0.066, -0.27] });
  g.add(sph(0.016, 8, 6), 0xffa6c9, { p: [0.07, Y0 + 0.078, 0.05], s: [1, 0.7, 1] });
  pallet(g);
  const base = g.build();

  // 釣り竿（+y 方向に伸ばし、回転中心は根元）
  const rod = new Geo()
    .add(cyl(0.006, 0.011, 0.56, 6), 0x7b5233, { p: [0, 0.28, 0] })
    .add(cyl(0.016, 0.016, 0.07, 8), 0xd9b48a, { p: [0, 0.05, 0] })
    .add(cyl(0.02, 0.02, 0.018, 10), 0x50616f, { p: [0.018, 0.1, 0], r: [0, 0, PI / 2] })
    .build();
  const line = new Geo().add(cyl(0.0025, 0.0025, 1, 4), 0xf4f4f4, { p: [0, -0.5, 0] }).build();
  const bobber = new Geo()
    .add(sph(0.022, 10, 8, ), 0xffffff, { p: [0, 0, 0] })
    .add(sph(0.0225, 10, 5), 0xe5484d, { p: [0, 0.003, 0], s: [1, 0.75, 1] })
    .add(cyl(0.004, 0.004, 0.03, 4), 0x333333, { p: [0, 0.03, 0] })
    .build();
  return finish(base, {
    rod: { geo: rod, mat: 'fx', pivot: [-0.22, Y0 + 0.17, -0.01], count: 1, rest: [-0.75, 0, -0.35], shadow: true },
    line: { geo: line, mat: 'fx', pivot: [0, 0, 0], count: 1, shadow: false },
    bobber: { geo: bobber, mat: 'fx', pivot: [-0.04, Y0 + 0.07, -0.2], count: 1, shadow: false },
  }, 0.66, true, (f) => f.add(box(o - 2 * t + 0.02, 0.01, o - 2 * t + 0.02), 0x5cc3e8, { p: [cx, Y0 + 0.065, cz] }));
}

function cannery(): BuildingModel {
  const g = new Geo();
  const cx = -0.08;
  const cz = -0.08;
  g.add(rbox(0.62, 0.05, 0.52, 0.015), 0x9a8e82, { p: [cx, Y0 + 0.025, cz] });
  g.add(rbox(0.56, 0.34, 0.46, 0.035), 0xf2e8d8, { p: [cx, Y0 + 0.05 + 0.17, cz] });
  g.add(rbox(0.565, 0.06, 0.465, 0.02), 0xc9b9a3, { p: [cx, Y0 + 0.08, cz] });
  // 切妻屋根（三角柱）
  g.add(new THREE.CylinderGeometry(0.33, 0.33, 0.64, 3), 0x6a8fbd, { p: [cx, Y0 + 0.47, cz], r: [-PI / 2, 0, PI / 2], s: [1, 1, 0.62], flat: true });
  g.add(rbox(0.66, 0.03, 0.035, 0.01), 0x4a6a92, { p: [cx, Y0 + 0.672, cz] });
  // 煙突
  g.add(cyl(0.05, 0.06, 0.5, 12), 0xc4573e, { p: [0.06, Y0 + 0.52, -0.22] });
  g.add(cyl(0.066, 0.066, 0.045, 12), 0x7a3a2e, { p: [0.06, Y0 + 0.77, -0.22] });
  for (const y of [0.6, 0.68]) g.add(cyl(0.0615, 0.0615, 0.012, 12), 0xa84a35, { p: [0.06, Y0 + y, -0.22] });
  // 窓・扉
  const fz = cz + 0.235;
  window(g, -0.27, Y0 + 0.24, fz, 0.09, 0.1);
  window(g, -0.12, Y0 + 0.24, fz, 0.09, 0.1);
  g.add(rbox(0.1, 0.17, 0.02, 0.01), 0x8a5a3a, { p: [0.06, Y0 + 0.135, fz] });
  g.add(sph(0.01, 6, 5), GOLD, { p: [0.09, Y0 + 0.13, fz + 0.012] });
  window(g, 0.205, Y0 + 0.26, cz + 0.08, 0.08, 0.08, 0xffd88a, WHITE, PI / 2);
  // 屋根の上の猫缶
  g.put(itemGeo('can'), { p: [-0.26, Y0 + 0.64, cz], s: 1.5, r: [0, 0.3, 0] });
  // 魚の木箱
  g.add(rbox(0.15, 0.1, 0.13, 0.012), WOOD, { p: [-0.33, Y0 + 0.05, 0.33] });
  g.add(rbox(0.155, 0.025, 0.135, 0.008), WOOD_D, { p: [-0.33, Y0 + 0.085, 0.33] });
  g.put(itemGeo('fish'), { p: [-0.34, Y0 + 0.1, 0.31], s: 0.8, r: [0, 0.3, 0] });
  g.put(itemGeo('fish'), { p: [-0.31, Y0 + 0.1, 0.36], s: 0.8, r: [0, -0.4, 0] });
  pallet(g);
  const base = g.build();

  const gear = new Geo();
  gear.add(cyl(0.07, 0.07, 0.025, 16), 0xd9a441, { r: [0, 0, PI / 2] });
  gear.add(cyl(0.025, 0.025, 0.035, 10), 0x8c6a2b, { r: [0, 0, PI / 2] });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * PI * 2;
    gear.add(box(0.022, 0.03, 0.03), 0xd9a441, { p: [0, Math.cos(a) * 0.08, Math.sin(a) * 0.08], r: [a, 0, 0] });
  }
  return finish(base, { gear: { geo: gear.build(), mat: 'fx', pivot: [0.215, Y0 + 0.2, -0.18], count: 1, shadow: true } }, 0.82, true);
}

const _sa = new THREE.Vector3();
const _sb = new THREE.Vector3();
const _sq = new THREE.Quaternion();
const _se = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);
/** 2 点を結ぶ円柱 */
export function strut(g: Geo, a: V3, b: V3, r: number, color: number, seg = 8, glow = 0) {
  _sa.set(...a);
  _sb.set(...b);
  const len = _sa.distanceTo(_sb);
  _se.setFromQuaternion(_sq.setFromUnitVectors(UP, _sb.sub(_sa).normalize()));
  return g.add(cyl(r, r, len, seg), color, { p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], r: [_se.x, _se.y, _se.z], glow });
}

/** 採掘機の鉱石の山（品は鉱床の種類で決まるので動的に積む） */
export const MINER_PILE: V3[] = [[-0.3, Y0 + 0.04, 0.27], [-0.22, Y0 + 0.04, 0.31], [-0.26, Y0 + 0.085, 0.29]];

function miner(): BuildingModel {
  const g = new Geo();
  const YEL = 0xd9a441;
  const DARK = 0x3d4048;
  const cx = -0.06;
  const cz = -0.06;
  g.add(rbox(0.62, 0.04, 0.62, 0.012), 0x7d868f, { p: [cx, Y0 + 0.02, cz] });
  for (let i = 0; i < 8; i++) g.add(box(0.075, 0.006, 0.04), i % 2 ? YEL : 0x2a2a2e, { p: [cx - 0.2625 + i * 0.075, Y0 + 0.042, cz + 0.285] });
  // 掘削口
  g.add(cyl(0.13, 0.15, 0.03, 16), STONE_D, { p: [cx, Y0 + 0.055, cz] });
  g.add(cyl(0.1, 0.1, 0.012, 16), 0x241e1a, { p: [cx, Y0 + 0.066, cz] });
  // やぐら（4 本脚が上ですぼまる）と横木
  const top = Y0 + 0.62;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) strut(g, [cx + sx * 0.24, Y0 + 0.04, cz + sz * 0.24], [cx + sx * 0.08, top, cz + sz * 0.08], 0.018, YEL, 6);
  for (const [h, w] of [[0.22, 0.19], [0.44, 0.135]]) {
    for (const sz of [-1, 1]) {
      g.add(box(w * 2, 0.018, 0.018), YEL, { p: [cx, Y0 + h, cz + sz * w] });
      g.add(box(0.018, 0.018, w * 2), YEL, { p: [cx + sz * w, Y0 + h, cz] });
    }
  }
  // モーター室
  g.add(rbox(0.24, 0.13, 0.22, 0.025), YEL, { p: [cx, top + 0.065, cz] });
  g.add(rbox(0.245, 0.03, 0.225, 0.01), DARK, { p: [cx, top + 0.01, cz] });
  for (const z of [-0.05, 0, 0.05]) g.add(box(0.006, 0.06, 0.03), DARK, { p: [cx + 0.121, top + 0.075, cz + z] });
  g.add(cyl(0.018, 0.022, 0.1, 8), DARK, { p: [cx - 0.07, top + 0.17, cz - 0.06] });
  g.add(sph(0.022, 8, 6), 0xff5a3a, { p: [cx + 0.07, top + 0.145, cz + 0.06], glow: 1 });
  // 操作盤
  g.add(rbox(0.1, 0.16, 0.06, 0.012), 0x5a646e, { p: [0.28, Y0 + 0.08, -0.3] });
  g.add(rbox(0.06, 0.04, 0.01, 0.006), 0x8ff0ff, { p: [0.28, Y0 + 0.12, -0.268], glow: 0.9 });
  g.add(sph(0.01, 6, 5), 0x63c76b, { p: [0.26, Y0 + 0.07, -0.268], glow: 1 });
  pallet(g);
  const drill = new Geo().add(cyl(0.016, 0.016, 0.5, 8), 0x8d96a0, { p: [0, -0.25, 0] }).add(cyl(0.04, 0.04, 0.04, 12), DARK, { p: [0, -0.02, 0] });
  for (let i = 0; i < 14; i++) {
    const a = i * 0.9;
    drill.add(box(0.05, 0.012, 0.02), 0xc4ccd4, { p: [Math.cos(a) * 0.02, -0.12 - i * 0.025, Math.sin(a) * 0.02], r: [0.3, -a, 0] });
  }
  drill.add(cone(0.03, 0.06, 8), 0xc4ccd4, { p: [0, -0.53, 0], r: [PI, 0, 0] });
  const fly = new Geo().add(cyl(0.055, 0.055, 0.02, 16), 0x8d96a0, { r: [0, 0, PI / 2] }).add(cyl(0.02, 0.02, 0.03, 8), DARK, { r: [0, 0, PI / 2] });
  for (let i = 0; i < 3; i++) fly.add(box(0.024, 0.09, 0.012), DARK, { r: [(i / 3) * PI, 0, 0] });
  return finish(g.build(), {
    drill: { geo: drill.build(), mat: 'fx', pivot: [cx, top, cz], count: 1, shadow: true },
    fly: { geo: fly.build(), mat: 'fx', pivot: [cx - 0.135, top + 0.07, cz], count: 1, shadow: true },
  }, 0.96, true);
}

/** 石の炉の焚き口（火の位置） */
export const FURNACE_MOUTH: V3 = [-0.05, Y0 + 0.07, 0.245];

function furnace(): BuildingModel {
  const g = new Geo();
  const [cx, , mz] = FURNACE_MOUTH;
  const cz = -0.08;
  const S1 = 0xb0a090;
  const S2 = 0x958676;
  const S3 = 0xc8baa8;
  g.add(cyl(0.34, 0.36, 0.05, 14), S2, { p: [cx, Y0 + 0.025, cz] });
  g.add(cyl(0.28, 0.31, 0.3, 14), S1, { p: [cx, Y0 + 0.2, cz] });
  g.add(new THREE.SphereGeometry(0.28, 14, 8, 0, PI * 2, 0, PI / 2), S1, { p: [cx, Y0 + 0.35, cz], s: [1, 0.75, 1] });
  // 表面の石積み（焚き口のまわりは空ける）
  for (let ring = 0; ring < 3; ring++)
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * PI * 2 + ring * 0.35;
      if (ring < 2 && Math.abs(Math.atan2(Math.sin(a - PI / 2), Math.cos(a - PI / 2))) < 0.5) continue;
      const r = 0.305 - ring * 0.01;
      g.add(rbox(0.1, 0.07, 0.04, 0.015), (i + ring) % 2 ? S3 : S2, { p: [cx + Math.cos(a) * r, Y0 + 0.1 + ring * 0.1, cz + Math.sin(a) * r], r: [0, PI / 2 - a, 0] });
    }
  // 焚き口
  g.add(rbox(0.2, 0.18, 0.05, 0.03), 0x6a5a4a, { p: [cx, Y0 + 0.14, mz - 0.02] });
  g.add(rbox(0.15, 0.13, 0.03, 0.03), 0x2a1a14, { p: [cx, Y0 + 0.13, mz - 0.008] });
  g.add(rbox(0.12, 0.045, 0.02, 0.015), 0xff7a2a, { p: [cx, Y0 + 0.088, mz + 0.002], glow: 1 });
  // 煙突
  g.add(cyl(0.065, 0.075, 0.32, 10), S2, { p: [cx + 0.1, Y0 + 0.58, cz - 0.08] });
  g.add(cyl(0.08, 0.08, 0.04, 10), 0x6a5e52, { p: [cx + 0.1, Y0 + 0.76, cz - 0.08] });
  // 石炭の山と火かき棒
  for (const [x, y, z, r] of [[0.3, 0.03, 0.06, 0.04], [0.34, 0.025, 0.13, 0.035], [0.27, 0.022, 0.13, 0.03], [0.31, 0.07, 0.1, 0.03]] as const)
    g.add(rock, 0x2c2c33, { p: [x, Y0 + y, z], s: r, r: [x * 10, z * 10, 0], flat: true });
  strut(g, [0.37, Y0, -0.06], [0.31, Y0 + 0.32, -0.2], 0.008, 0x50565e, 5);
  pallet(g);
  const fire = new Geo()
    .add(cone(0.05, 0.12, 8), 0xff6a1a, { p: [0, 0.06, 0], glow: 1 })
    .add(cone(0.032, 0.09, 8), 0xffc23a, { p: [0.025, 0.045, 0.005], glow: 1 })
    .add(cone(0.03, 0.08, 8), 0xff8a2a, { p: [-0.03, 0.04, -0.005], glow: 1 })
    .add(cone(0.018, 0.06, 6), 0xfff0a0, { p: [0, 0.03, 0.012], glow: 1 })
    .build();
  return finish(g.build(), { fire: { geo: fire, mat: 'fx', pivot: [cx, FURNACE_MOUTH[1], mz + 0.012], count: 1, shadow: false } }, 0.92, true);
}

/** 組立機の作業台の上（作っている品を置く） */
export const BENCH: V3 = [0, Y0 + 0.226, 0.04];

function assembler(): BuildingModel {
  const g = new Geo();
  const BLUE = 0x5a8fc4;
  const BD = 0x3f6f9e;
  // 奥の制御盤
  g.add(rbox(0.66, 0.04, 0.3, 0.012), 0x6e7681, { p: [0, Y0 + 0.02, -0.26] });
  g.add(rbox(0.62, 0.34, 0.24, 0.035), BLUE, { p: [0, Y0 + 0.21, -0.26] });
  g.add(rbox(0.63, 0.04, 0.25, 0.012), BD, { p: [0, Y0 + 0.39, -0.26] });
  g.add(rbox(0.2, 0.12, 0.014, 0.01), 0x23282e, { p: [-0.16, Y0 + 0.25, -0.137] });
  g.add(rbox(0.17, 0.09, 0.016, 0.008), 0x8ff0ff, { p: [-0.16, Y0 + 0.25, -0.135], glow: 0.9 });
  for (const [c, x] of [[0xe5484d, 0.06], [0x63c76b, 0.11], [0xffcf4a, 0.16]] as const) g.add(sph(0.016, 8, 6), c, { p: [x, Y0 + 0.28, -0.135], glow: c === 0x63c76b ? 1 : 0 });
  g.add(cyl(0.03, 0.03, 0.012, 14), 0x50616f, { p: [0.11, Y0 + 0.19, -0.135], r: [PI / 2, 0, 0] });
  // 作業台
  g.add(rbox(0.5, 0.035, 0.24, 0.01), 0xcfd6dc, { p: [0, Y0 + 0.2, 0.04] });
  g.add(rbox(0.5, 0.012, 0.24, 0.006), 0x8d96a0, { p: [0, Y0 + 0.178, 0.04] });
  for (const [x, z] of [[-0.22, -0.06], [0.22, -0.06], [-0.22, 0.14], [0.22, 0.14]]) g.add(box(0.03, 0.18, 0.03), 0x50565e, { p: [x, Y0 + 0.09, z] });
  g.add(rbox(0.14, 0.008, 0.12, 0.004), 0x3f8f5a, { p: [BENCH[0], BENCH[1] - 0.004, BENCH[2]] });
  // 部品箱
  g.add(rbox(0.12, 0.06, 0.09, 0.01), 0xd9a441, { p: [-0.17, Y0 + 0.248, 0.1] });
  g.put(itemGeo('gear'), { p: [-0.17, Y0 + 0.27, 0.1], s: 0.7 });
  g.put(itemGeo('ironPlate'), { p: [0.17, Y0 + 0.218, 0.1], s: 0.8, r: [0, 0.3, 0] });
  // ロボットアームの台座
  g.add(cyl(0.06, 0.07, 0.05, 14), 0x50565e, { p: [0.2, Y0 + 0.435, -0.24] });
  pallet(g);
  const ORANGE = 0xffa53a;
  const arm = new Geo().add(cyl(0.04, 0.04, 0.04, 12), BD, {}).add(sph(0.032, 10, 8), 0x50565e, { p: [0, 0.03, 0] });
  strut(arm, [0, 0.03, 0], [0, 0.14, 0.13], 0.02, ORANGE);
  arm.add(sph(0.026, 10, 8), 0x50565e, { p: [0, 0.14, 0.13] });
  strut(arm, [0, 0.14, 0.13], [0, -0.14, 0.34], 0.016, ORANGE);
  arm.add(cyl(0.022, 0.022, 0.03, 10), 0x50565e, { p: [0, -0.15, 0.34] });
  arm.add(cone(0.016, 0.04, 8), 0xc4ccd4, { p: [0, -0.185, 0.34], r: [PI, 0, 0] });
  arm.add(sph(0.008, 6, 5), 0x8ff0ff, { p: [0, -0.208, 0.34], glow: 1 });
  return finish(g.build(), { arm: { geo: arm.build(), mat: 'fx', pivot: [0.2, Y0 + 0.46, -0.24], count: 1, rest: [0, -0.62, 0], shadow: true } }, 0.8, true);
}

function crate(g: Geo, x: number, y: number, z: number, s: number, ry = 0) {
  g.add(rbox(s, s, s, 0.012), WOOD_L, { p: [x, y + s / 2, z], r: [0, ry, 0] });
  for (const k of [0.15, 0.85]) g.add(box(s + 0.006, 0.014, s + 0.006), WOOD_D, { p: [x, y + s * k, z], r: [0, ry, 0] });
}

function warehouse(): BuildingModel {
  const g = new Geo();
  const W = 0xa87a4a;
  const WD = 0x7a5432;
  g.add(rbox(0.88, 0.05, 0.7, 0.015), STONE_D, { p: [0, Y0 + 0.025, -0.08] });
  g.add(rbox(0.8, 0.4, 0.6, 0.03), W, { p: [0, Y0 + 0.25, -0.1] });
  for (let i = 0; i < 9; i++) g.add(box(0.008, 0.38, 0.004), WD, { p: [-0.36 + i * 0.09, Y0 + 0.25, 0.2] });
  g.add(new THREE.CylinderGeometry(0.42, 0.42, 0.88, 3), 0xb5533e, { p: [0, Y0 + 0.58, -0.1], r: [-PI / 2, 0, PI / 2], s: [1, 1, 0.62], flat: true });
  g.add(rbox(0.92, 0.03, 0.04, 0.01), 0x8a3a2a, { p: [0, Y0 + 0.84, -0.1] });
  // 大扉（X の筋交い）
  const fz = 0.203;
  g.add(rbox(0.36, 0.32, 0.02, 0.01), WD, { p: [-0.1, Y0 + 0.21, fz] });
  for (const r of [0.73, -0.73]) g.add(box(0.03, 0.44, 0.012), W, { p: [-0.1, Y0 + 0.21, fz + 0.012], r: [0, 0, r] });
  g.add(box(0.36, 0.03, 0.012), W, { p: [-0.1, Y0 + 0.21, fz + 0.012] });
  window(g, 0.24, Y0 + 0.32, fz, 0.1, 0.08);
  // 木箱と樽
  crate(g, 0.3, Y0, 0.33, 0.15, 0.2);
  crate(g, 0.29, Y0 + 0.15, 0.33, 0.11, -0.3);
  crate(g, -0.35, Y0, 0.33, 0.12, 0.5);
  g.add(cyl(0.05, 0.055, 0.13, 12), WOOD, { p: [0.12, Y0 + 0.065, 0.36] });
  for (const y of [0.03, 0.1]) g.add(torus(0.053, 0.006, 4, 14), 0x50565e, { p: [0.12, Y0 + y, 0.36], r: [PI / 2, 0, 0] });
  return finish(g.build(), {}, 0.95, false);
}

function charger(): BuildingModel {
  const g = new Geo();
  const C = 0x4fc4e8;
  g.add(rbox(0.86, 0.035, 0.86, 0.015), 0x6e7681, { p: [0, Y0 + 0.0175, 0] });
  // 充電台（sim の施設の位置 slot 0・1 に合わせる）
  for (const x of [-0.2, 0.2]) {
    g.add(cyl(0.14, 0.15, 0.025, 22), 0x3a4048, { p: [x, Y0 + 0.047, 0.22] });
    g.add(torus(0.12, 0.009, 5, 26), C, { p: [x, Y0 + 0.06, 0.22], r: [PI / 2, 0, 0], glow: 0.9 });
    g.add(cyl(0.04, 0.04, 0.006, 6), 0xffc845, { p: [x, Y0 + 0.062, 0.22], glow: 0.6, flat: true });
    strut(g, [x * 0.3, Y0 + 0.045, -0.2], [x, Y0 + 0.045, 0.08], 0.012, 0x2a2e34, 6);
  }
  // 電源の柱
  g.add(rbox(0.2, 0.46, 0.14, 0.03), 0xdfe6ec, { p: [0, Y0 + 0.265, -0.28] });
  g.add(rbox(0.205, 0.05, 0.145, 0.012), C, { p: [0, Y0 + 0.07, -0.28], glow: 0.4 });
  g.add(rbox(0.12, 0.08, 0.012, 0.008), 0x23282e, { p: [0, Y0 + 0.36, -0.205] });
  g.add(rbox(0.1, 0.06, 0.014, 0.006), 0x8ff0ff, { p: [0, Y0 + 0.36, -0.203], glow: 0.9 });
  for (const sx of [-1, 1]) g.add(cyl(0.02, 0.026, 0.05, 8), 0xf3e2c8, { p: [sx * 0.07, Y0 + 0.52, -0.28] });
  const coil = new Geo().add(cyl(0.02, 0.02, 0.2, 8), 0x8d96a0, { p: [0, 0.1, 0] });
  for (let k = 0; k < 5; k++) coil.add(torus(0.045 - k * 0.004, 0.009, 5, 16), 0xe08a3e, { p: [0, 0.03 + k * 0.032, 0], r: [PI / 2, 0, 0] });
  coil.add(sph(0.04, 12, 10), C, { p: [0, 0.22, 0], glow: 1 });
  return finish(g.build(), { coil: { geo: coil.build(), mat: 'fx', pivot: [0, Y0 + 0.495, -0.28], count: 1, shadow: true } }, 0.86, false);
}

function market(): BuildingModel {
  const g = new Geo();
  // カウンター
  g.add(rbox(0.66, 0.22, 0.26, 0.03), 0xc98b55, { p: [0, Y0 + 0.11, 0.08] });
  g.add(rbox(0.7, 0.03, 0.3, 0.012), 0xe6ae72, { p: [0, Y0 + 0.235, 0.08] });
  for (let i = 0; i < 6; i++) g.add(box(0.006, 0.18, 0.004), 0xa86f42, { p: [-0.27 + i * 0.108, Y0 + 0.11, 0.212] });
  // 奥の棚
  g.add(rbox(0.66, 0.42, 0.07, 0.02), 0xa86f42, { p: [0, Y0 + 0.21, -0.22] });
  g.add(box(0.62, 0.02, 0.1), 0xd39a62, { p: [0, Y0 + 0.3, -0.18] });
  // 柱
  for (const [x, z] of [[-0.33, 0.21], [0.33, 0.21], [-0.33, -0.19], [0.33, -0.19]]) g.add(cyl(0.018, 0.02, 0.62, 8), 0x9a6340, { p: [x, Y0 + 0.31, z] });
  // 縞のひさし
  const slope = Math.atan2(0.14, 0.56);
  for (let i = 0; i < 6; i++) {
    const x = -0.3125 + i * 0.125;
    g.add(rbox(0.125, 0.022, 0.62, 0.008), i % 2 ? 0xfff4ea : 0xe8505b, { p: [x, Y0 + 0.6, 0.02], r: [slope, 0, 0] });
    g.add(new THREE.CylinderGeometry(0.0625, 0.0625, 0.014, 12, 1, false, PI / 2, PI), i % 2 ? 0xfff4ea : 0xe8505b, { p: [x, Y0 + 0.523, 0.325], r: [-PI / 2, 0, 0] });
  }
  // 商品
  g.put(itemGeo('fish'), { p: [-0.22, Y0 + 0.25, 0.08], r: [0, 0.4, 0] });
  g.put(itemGeo('fish'), { p: [-0.14, Y0 + 0.25, 0.14], r: [0, -0.3, 0] });
  g.put(itemGeo('can'), { p: [0.02, Y0 + 0.25, 0.08] });
  g.put(itemGeo('can'), { p: [0.1, Y0 + 0.25, 0.1] });
  g.put(itemGeo('can'), { p: [0.06, Y0 + 0.316, 0.09] });
  g.put(itemGeo('gear'), { p: [0.23, Y0 + 0.25, 0.09] });
  g.put(itemGeo('circuit'), { p: [-0.2, Y0 + 0.31, -0.18] });
  g.put(itemGeo('ironPlate'), { p: [0.15, Y0 + 0.31, -0.18] });
  g.put(itemGeo('ironPlate'), { p: [0.15, Y0 + 0.329, -0.18], r: [0, 0.3, 0] });
  // 木箱
  for (const [x, z, it] of [[-0.33, 0.37, 'fish'], [0.34, 0.37, 'copperOre']] as [number, number, ItemId][]) {
    g.add(rbox(0.15, 0.11, 0.13, 0.012), WOOD, { p: [x, Y0 + 0.055, z] });
    g.add(rbox(0.155, 0.025, 0.135, 0.008), WOOD_D, { p: [x, Y0 + 0.09, z] });
    g.put(itemGeo(it), { p: [x, Y0 + 0.11, z], s: 0.75, r: [0, 0.5, 0] });
  }
  // 看板の支柱
  g.add(cyl(0.012, 0.012, 0.18, 6), 0x9a6340, { p: [0, Y0 + 0.73, -0.2] });
  const base = g.build();

  const coin = new Geo()
    .add(cyl(0.075, 0.075, 0.02, 24), GOLD, { r: [PI / 2, 0, 0], glow: 0.25 })
    .add(torus(0.056, 0.007, 6, 24), 0xffe08a, { p: [0, 0, 0.011] })
    .add(torus(0.056, 0.007, 6, 24), 0xffe08a, { p: [0, 0, -0.011] })
    .build();
  return finish(base, { coin: { geo: coin, mat: 'fx', pivot: [0, Y0 + 0.88, -0.2], count: 1, shadow: true } }, 0.98, false);
}

function lab(): BuildingModel {
  const g = new Geo();
  const cx = -0.05;
  const cz = -0.08;
  g.add(rbox(0.6, 0.04, 0.5, 0.012), 0x8fa9a6, { p: [cx, Y0 + 0.02, cz] });
  g.add(rbox(0.56, 0.27, 0.46, 0.04), 0xf2f8f7, { p: [cx, Y0 + 0.17, cz] });
  g.add(rbox(0.565, 0.05, 0.465, 0.015), 0x3fb3a5, { p: [cx, Y0 + 0.24, cz] });
  g.add(rbox(0.6, 0.03, 0.5, 0.012), 0xd7e8e6, { p: [cx, Y0 + 0.3, cz] });
  g.add(cyl(0.175, 0.19, 0.045, 20), 0x2e8f84, { p: [cx - 0.04, Y0 + 0.335, cz] });
  const fz = cz + 0.235;
  g.add(rbox(0.1, 0.16, 0.02, 0.01), 0x2e8f84, { p: [cx + 0.14, Y0 + 0.13, fz] });
  window(g, cx - 0.08, Y0 + 0.16, fz, 0.1, 0.08, 0x9ff2ec);
  window(g, cx - 0.21, Y0 + 0.16, fz, 0.08, 0.08, 0x9ff2ec);
  // アンテナの支柱
  g.add(cyl(0.012, 0.012, 0.12, 6), METAL, { p: [cx + 0.2, Y0 + 0.37, cz - 0.15] });
  // フラスコの台
  const tx = 0.3;
  const tz = 0.27;
  g.add(rbox(0.17, 0.02, 0.15, 0.006), WOOD_L, { p: [tx, Y0 + 0.11, tz] });
  for (const [x, z] of [[-0.07, -0.06], [0.07, -0.06], [-0.07, 0.06], [0.07, 0.06]]) g.add(cyl(0.008, 0.008, 0.11, 5), WOOD_D, { p: [tx + x, Y0 + 0.055, tz + z] });
  g.add(torus(0.09, 0.012, 6, 14, PI / 2), METAL, { p: [cx + 0.27, Y0 + 0.2, cz + 0.24], r: [PI / 2, 0, PI] });
  const base = g.build();

  const flaskPts: [number, number][] = [[0, 0], [0.062, 0], [0.066, 0.012], [0.03, 0.085], [0.019, 0.1], [0.019, 0.135], [0.024, 0.14]];
  const glass = new Geo()
    .add(new THREE.SphereGeometry(0.165, 22, 12, 0, PI * 2, 0, PI / 2), 0x8ff0ff, { p: [cx - 0.04, Y0 + 0.355, cz] })
    .add(lathe(flaskPts), 0xc8f8ff, { p: [tx, Y0 + 0.12, tz] })
    .build();
  const core = new Geo()
    .add(sph(0.065, 16, 12), 0x5fd8cc, { p: [cx - 0.04, Y0 + 0.43, cz], glow: 0.8 })
    .add(torus(0.1, 0.007, 5, 24), 0x3fb3a5, { p: [cx - 0.04, Y0 + 0.43, cz], r: [1.2, 0.3, 0] })
    .add(lathe([[0, 0.004], [0.058, 0.004], [0.06, 0.012], [0.035, 0.05], [0, 0.05]]), 0x6fd85a, { p: [tx, Y0 + 0.12, tz], glow: 0.7 })
    .build();
  const dish = new Geo()
    .add(lathe([[0, 0], [0.03, 0.004], [0.06, 0.016], [0.08, 0.034], [0.078, 0.036], [0.058, 0.02], [0.03, 0.008], [0, 0.004]], 18), WHITE, { r: [0.7, 0, 0] })
    .add(cyl(0.004, 0.004, 0.08, 4), METAL, { p: [0, 0.04, 0.03], r: [0.7, 0, 0] })
    .add(sph(0.012, 6, 5), 0xe5484d, { p: [0, 0.07, 0.055], glow: 0.8 })
    .build();
  return finish(base, {
    glass: { geo: glass, mat: 'glass', pivot: [0, 0, 0], count: 1, shadow: false },
    core: { geo: core, mat: 'fx', pivot: [0, 0, 0], count: 1, shadow: false },
    dish: { geo: dish, mat: 'fx', pivot: [cx + 0.2, Y0 + 0.43, cz - 0.15], count: 1, shadow: true },
  }, 0.8, false);
}

// ===================== 休憩施設 =====================

/** キャットタワーの台（施設の猫の位置 slot 0〜2 に合わせる） */
export const TOWER_DECKS: V3[] = [
  [0.08, Y0 + 0.84, 0.12],
  [-0.12, Y0 + 0.58, -0.04],
  [0.1, Y0 + 0.33, -0.12],
];
/** ベッドのクッションの上面の高さ */
export const BED_Y = Y0 + 0.09;

function bed(): BuildingModel {
  const g = new Geo();
  g.add(cyl(0.3, 0.32, 0.03, 24), 0xe98fb0, { p: [0, Y0 + 0.015, 0] });
  g.add(torus(0.25, 0.085, 10, 28), 0xf3a6c0, { p: [0, Y0 + 0.085, 0], r: [PI / 2, 0, 0], s: [1, 1, 1.05] });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * PI * 2;
    g.add(sph(0.018, 6, 5), 0xffffff, { p: [Math.cos(a) * 0.25, Y0 + 0.15, Math.sin(a) * 0.25], s: [1, 0.5, 1] });
  }
  // ほねの形のおもちゃ
  g.add(cyl(0.012, 0.012, 0.09, 6), 0xfff6e8, { p: [0.24, Y0 + 0.04, 0.3], r: [0, 0.6, PI / 2] });
  for (const k of [-1, 1]) for (const j of [-1, 1]) g.add(sph(0.016, 6, 5), 0xfff6e8, { p: [0.24 + k * 0.04, Y0 + 0.04, 0.3 + k * 0.027 + j * 0.012], r: [0, 0.6, 0] });
  const base = g.build();
  const cushion = new Geo()
    .add(sph(1, 20, 10), 0xfff1e4, { s: [0.21, 0.055, 0.21] })
    .add(sph(1, 12, 8), 0xffd9e6, { p: [0.08, 0.035, -0.08], s: [0.07, 0.03, 0.05], r: [0, 0.6, 0] })
    .build();
  return finish(base, { cushion: { geo: cushion, mat: 'fx', pivot: [0, Y0 + 0.05, 0], count: 1, shadow: true } }, 0.42, false);
}

function toybox(): BuildingModel {
  const g = new Geo();
  const bx = -0.1;
  const bz = -0.08;
  g.add(rbox(0.4, 0.24, 0.32, 0.03), 0x7fc6e8, { p: [bx, Y0 + 0.12, bz] });
  g.add(rbox(0.41, 0.04, 0.33, 0.012), 0x5aa9d0, { p: [bx, Y0 + 0.235, bz] });
  for (const x of [-0.12, 0.12]) g.add(rbox(0.06, 0.06, 0.012, 0.01), 0xffd447, { p: [bx + x, Y0 + 0.13, bz + 0.165] });
  g.add(sph(0.03, 10, 8), 0xff8fb3, { p: [bx, Y0 + 0.13, bz + 0.17], s: [1, 1, 0.4] });
  // 開いたふた
  g.add(rbox(0.41, 0.025, 0.3, 0.01), 0x9ad6f0, { p: [bx, Y0 + 0.32, bz - 0.2], r: [-1.1, 0, 0] });
  // 中のおもちゃ
  g.add(sph(0.055, 14, 10), 0xf48fb8, { p: [bx - 0.08, Y0 + 0.255, bz + 0.02] });
  for (const r of [[PI / 2, 0, 0.5], [0.3, 1.0, 0], [-0.5, 0.2, 1.2]] as V3[]) g.add(torus(0.055, 0.006, 5, 22), 0xd8639a, { p: [bx - 0.08, Y0 + 0.255, bz + 0.02], r });
  g.put(itemGeo('fish'), { p: [bx + 0.08, Y0 + 0.24, bz - 0.04], s: 0.8, r: [0.6, 0.4, 0.5] });
  g.add(cyl(0.006, 0.006, 0.32, 5), 0xc08a58, { p: [bx + 0.13, Y0 + 0.36, bz + 0.05], r: [0.15, 0, -0.35] });
  for (let i = 0; i < 4; i++) g.add(cone(0.02, 0.07, 6), [0xff8fb3, 0xffd447, 0x9fd3ff, 0xc9a8ff][i], { p: [bx + 0.19 + Math.cos(i) * 0.012, Y0 + 0.53 + i * 0.012, bz + 0.07], r: [Math.sin(i * 2) * 0.6, 0, -0.35 + Math.cos(i * 3) * 0.6] });
  // ねずみのおもちゃ
  g.add(sph(1, 10, 8), 0xb5b0b8, { p: [0.28, Y0 + 0.03, 0.26], s: [0.045, 0.03, 0.06], r: [0, 0.8, 0] });
  for (const k of [-1, 1]) g.add(cyl(0.015, 0.015, 0.006, 8), 0xf2a7b5, { p: [0.28 + k * 0.022, Y0 + 0.065, 0.26 + 0.02], r: [PI / 2 - 0.4, 0.8, 0] });
  g.add(cyl(0.004, 0.004, 0.09, 4), 0xf2a7b5, { p: [0.24, Y0 + 0.02, 0.21], r: [PI / 2, 0, 0.8] });
  const base = g.build();
  const ball = new Geo()
    .add(sph(0.05, 14, 10), 0xe5484d, {})
    .add(torus(0.05, 0.008, 5, 18), 0xffffff, { r: [PI / 2, 0, 0] })
    .add(torus(0.05, 0.008, 5, 18), 0xffffff, { r: [0, 0, 0] })
    .build();
  return finish(base, { ball: { geo: ball, mat: 'fx', pivot: [0, Y0 + 0.05, 0], count: 1, shadow: true } }, 0.56, false);
}

function tower(): BuildingModel {
  const g = new Geo();
  g.add(rbox(0.62, 0.05, 0.62, 0.02), 0xd9c2a3, { p: [0, Y0 + 0.025, 0] });
  for (const [x, top, z] of TOWER_DECKS) {
    const h = top - Y0;
    g.add(cyl(0.04, 0.04, h, 12), 0xd8b98a, { p: [x, Y0 + h / 2, z] });
    for (let k = 0.06; k < h - 0.04; k += 0.05) g.add(torus(0.041, 0.006, 4, 14), 0xbf9a64, { p: [x, Y0 + k, z], r: [PI / 2, 0, 0] });
  }
  // 台（slot と同じ並び）
  for (const [x, y, z] of TOWER_DECKS) {
    g.add(cyl(0.15, 0.15, 0.035, 20), 0xf3e2c8, { p: [x, y - 0.018, z] });
    g.add(cyl(0.152, 0.152, 0.012, 20), 0xc89a6c, { p: [x, y - 0.04, z] });
  }
  // 中段の小屋
  g.add(rbox(0.24, 0.2, 0.22, 0.04), 0xc89a6c, { p: [-0.13, Y0 + 0.13, 0.16] });
  g.add(cyl(0.065, 0.065, 0.01, 16), 0x5a3d2b, { p: [-0.13, Y0 + 0.12, 0.272], r: [PI / 2, 0, 0] });
  g.add(rbox(0.26, 0.03, 0.24, 0.012), 0xf3e2c8, { p: [-0.13, Y0 + 0.245, 0.16] });
  const base = g.build();
  const pom = new Geo()
    .add(cyl(0.003, 0.003, 0.18, 4), 0xffffff, { p: [0, -0.09, 0] })
    .add(sph(0.035, 10, 8), 0xff8fb3, { p: [0, -0.19, 0] })
    .build();
  return finish(base, { pom: { geo: pom, mat: 'fx', pivot: [0.21, Y0 + 0.82, 0.16], count: 1, shadow: true } }, 1.02, false);
}

// ===================== 本部と防衛 =====================

/** 本部の軒先の高さ（休む猫が座る） */
function hq(): BuildingModel {
  const g = new Geo();
  const ORANGE = 0xe8a33c;
  g.add(rbox(0.9, 0.06, 0.9, 0.02), STONE, { p: [0, Y0 + 0.03, 0] });
  // 母屋と軒先のデッキ（猫が並んで休む）
  g.add(rbox(0.66, 0.4, 0.5, 0.04), 0xfff1dc, { p: [0, Y0 + 0.26, -0.1] });
  g.add(rbox(0.67, 0.06, 0.51, 0.02), 0xd8b98a, { p: [0, Y0 + 0.09, -0.1] });
  g.add(rbox(0.78, 0.04, 0.3, 0.012), WOOD_L, { p: [0, Y0 + 0.08, 0.27] });
  for (const x of [-0.36, 0.36]) g.add(cyl(0.02, 0.022, 0.42, 8), WOOD_D, { p: [x, Y0 + 0.29, 0.38] });
  g.add(rbox(0.82, 0.035, 0.22, 0.012), ORANGE, { p: [0, Y0 + 0.51, 0.3], r: [0.32, 0, 0] });
  // 猫耳の切妻屋根
  g.add(new THREE.CylinderGeometry(0.38, 0.38, 0.62, 3), ORANGE, { p: [0, Y0 + 0.66, -0.1], r: [-PI / 2, 0, PI / 2], s: [1, 1, 0.66], flat: true });
  g.add(rbox(0.72, 0.035, 0.04, 0.012), 0xb86f1f, { p: [0, Y0 + 0.9, -0.1] });
  for (const sx of [-1, 1]) {
    g.add(cone(0.1, 0.2, 4), ORANGE, { p: [sx * 0.2, Y0 + 0.98, -0.1], r: [0, PI / 4, sx * -0.25], flat: true });
    g.add(cone(0.055, 0.12, 4), 0xf4a9b8, { p: [sx * 0.2, Y0 + 0.97, -0.05], r: [0, PI / 4, sx * -0.25], flat: true });
  }
  // 丸い扉・肉球の看板・窓
  const fz = 0.155;
  g.add(rbox(0.14, 0.2, 0.02, 0.02), 0x9a5a34, { p: [0, Y0 + 0.2, fz] });
  g.add(cyl(0.07, 0.07, 0.02, 16), 0x9a5a34, { p: [0, Y0 + 0.3, fz], r: [PI / 2, 0, 0] });
  g.add(sph(0.012, 6, 5), GOLD, { p: [0.045, Y0 + 0.2, fz + 0.014] });
  g.add(cyl(0.065, 0.065, 0.016, 16), WHITE, { p: [0, Y0 + 0.43, fz], r: [PI / 2, 0, 0] });
  g.add(cyl(0.022, 0.022, 0.02, 10), ORANGE, { p: [0, Y0 + 0.415, fz + 0.004], r: [PI / 2, 0, 0] });
  for (const [x, y] of [[-0.03, 0.455], [-0.01, 0.468], [0.01, 0.468], [0.03, 0.455]]) g.add(cyl(0.009, 0.009, 0.02, 8), ORANGE, { p: [x, Y0 + y, fz + 0.004], r: [PI / 2, 0, 0] });
  window(g, -0.22, Y0 + 0.3, fz, 0.1, 0.1);
  window(g, 0.22, Y0 + 0.3, fz, 0.1, 0.1);
  // 旗竿
  g.add(cyl(0.01, 0.012, 0.42, 6), 0xf5efe4, { p: [0.28, Y0 + 0.95, -0.2] });
  g.add(box(0.16, 0.1, 0.006), 0xe5484d, { p: [0.36, Y0 + 1.1, -0.2] });
  g.add(sph(0.018, 8, 6), GOLD, { p: [0.28, Y0 + 1.17, -0.2] });
  return finish(g.build(), {}, 1.22, false);
}

/** 兵器の砲塔は +z が砲口。回転中心から砲口までの距離 */
export const MUZZLE: Partial<Record<BuildingType, number>> = { waterGun: 0.3, turret: 0.38, cannon: 0.36 };

function waterGun(): BuildingModel {
  const g = new Geo();
  g.add(rbox(0.5, 0.04, 0.5, 0.015), STONE_D, { p: [0, Y0 + 0.02, 0] });
  // 木の櫓と青いタンク
  for (const [x, z] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) g.add(cyl(0.022, 0.026, 0.36, 8), WOOD_D, { p: [x, Y0 + 0.18, z] });
  for (const y of [0.12, 0.26]) {
    g.add(box(0.36, 0.02, 0.025), WOOD, { p: [0, Y0 + y, 0.17] }).add(box(0.36, 0.02, 0.025), WOOD, { p: [0, Y0 + y, -0.17] });
    g.add(box(0.025, 0.02, 0.36), WOOD, { p: [0.17, Y0 + y, 0] }).add(box(0.025, 0.02, 0.36), WOOD, { p: [-0.17, Y0 + y, 0] });
  }
  g.add(cyl(0.2, 0.2, 0.05, 18), WOOD_L, { p: [0, Y0 + 0.385, 0] });
  g.add(cyl(0.16, 0.17, 0.18, 18), 0x4fb3e8, { p: [0, Y0 + 0.5, 0] });
  for (const y of [0.45, 0.55]) g.add(torus(0.166, 0.008, 5, 20), 0x2f7fb0, { p: [0, Y0 + y, 0], r: [PI / 2, 0, 0] });
  g.add(cyl(0.02, 0.02, 0.16, 8), METAL, { p: [-0.12, Y0 + 0.3, 0.12], r: [0.3, 0, 0] });
  const turret = new Geo()
    .add(cyl(0.08, 0.09, 0.06, 14), 0x2f7fb0, { p: [0, 0, 0] })
    .add(cyl(0.035, 0.04, 0.3, 10), 0xe5484d, { p: [0, 0.05, 0.13], r: [PI / 2 - 0.2, 0, 0] })
    .add(cyl(0.045, 0.045, 0.03, 10), 0xffd447, { p: [0, 0.08, 0.28], r: [PI / 2 - 0.2, 0, 0] })
    .add(sph(0.05, 10, 8), 0x4fb3e8, { p: [0, 0.05, 0], s: [1, 0.7, 1] })
    .build();
  return finish(g.build(), { turret: { geo: turret, mat: 'fx', pivot: [0, Y0 + 0.62, 0], count: 1, shadow: true } }, 0.86, false);
}

/** 機関銃タレット: 砲塔（回転中心 turret）と、砲塔に付いて回る銃身の束（barrel、砲塔の回転中心からの位置 TURRET_BARREL） */
export const TURRET_BARREL: V3 = [0, 0.05, 0.08];

function turret(): BuildingModel {
  const g = new Geo();
  // 土嚢の輪
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * PI * 2;
    g.add(sph(1, 10, 7), 0xc8b48a, { p: [Math.cos(a) * 0.32, Y0 + 0.04, Math.sin(a) * 0.32], s: [0.085, 0.045, 0.055], r: [0, -a - PI / 2, 0] });
  }
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * PI * 2 + 0.3;
    g.add(sph(1, 10, 7), 0xb8a47a, { p: [Math.cos(a) * 0.3, Y0 + 0.11, Math.sin(a) * 0.3], s: [0.08, 0.04, 0.05], r: [0, -a - PI / 2, 0] });
  }
  g.add(cyl(0.26, 0.28, 0.03, 18), 0x7d868f, { p: [0, Y0 + 0.015, 0] });
  g.add(cyl(0.08, 0.11, 0.24, 12), 0x50565e, { p: [0, Y0 + 0.12, 0] });
  g.add(cyl(0.12, 0.12, 0.03, 16), 0x3d4048, { p: [0, Y0 + 0.25, 0] });
  // 弾薬箱
  g.add(rbox(0.13, 0.08, 0.09, 0.01), 0x5a6a3a, { p: [-0.33, Y0 + 0.04, 0.33] });
  g.put(itemGeo('bullet'), { p: [-0.33, Y0 + 0.08, 0.33], s: 0.9 });
  const head = new Geo()
    .add(rbox(0.2, 0.12, 0.22, 0.03), 0x6a7480, { p: [0, 0.03, -0.03] })
    .add(rbox(0.28, 0.16, 0.02, 0.01), 0x5a646e, { p: [0, 0.06, 0.09], r: [-0.15, 0, 0] })
    .add(rbox(0.06, 0.08, 0.1, 0.01), 0x5a6a3a, { p: [0.13, 0.02, -0.03] })
    .add(cyl(0.012, 0.012, 0.06, 6), 0x23282e, { p: [-0.06, 0.13, 0] })
    .add(sph(0.016, 8, 6), 0xff5a3a, { p: [-0.06, 0.16, 0], glow: 1 })
    .add(rbox(0.04, 0.04, 0.12, 0.01), 0x50565e, { p: [0, -0.01, -0.16] })
    .build();
  const barrel = new Geo();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2;
    barrel.add(cyl(0.011, 0.011, 0.3, 6), 0x3d4048, { p: [Math.cos(a) * 0.024, Math.sin(a) * 0.024, 0.15], r: [PI / 2, 0, 0] });
  }
  barrel.add(cyl(0.012, 0.012, 0.3, 6), 0x5a646e, { p: [0, 0, 0.15], r: [PI / 2, 0, 0] });
  barrel.add(cyl(0.042, 0.042, 0.02, 12), 0x8d96a0, { p: [0, 0, 0.03], r: [PI / 2, 0, 0] });
  barrel.add(cyl(0.038, 0.038, 0.015, 12), 0x8d96a0, { p: [0, 0, 0.27], r: [PI / 2, 0, 0] });
  barrel.add(box(0.01, 0.012, 0.2), 0xffc845, { p: [0, 0.04, 0.15] });
  const pv: V3 = [0, Y0 + 0.3, 0];
  return finish(g.build(), {
    turret: { geo: head, mat: 'fx', pivot: pv, count: 1, shadow: true },
    barrel: { geo: barrel.build(), mat: 'fx', pivot: [pv[0] + TURRET_BARREL[0], pv[1] + TURRET_BARREL[1], pv[2] + TURRET_BARREL[2]], count: 1, shadow: true },
  }, 0.62, false);
}

function cannon(): BuildingModel {
  const g = new Geo();
  // 石積みの砲座
  g.add(cyl(0.38, 0.42, 0.12, 20), STONE, { p: [0, Y0 + 0.06, 0] });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * PI * 2;
    g.add(rbox(0.12, 0.1, 0.08, 0.02), STONE_D, { p: [Math.cos(a) * 0.36, Y0 + 0.16, Math.sin(a) * 0.36], r: [0, -a, 0] });
  }
  g.add(cyl(0.3, 0.3, 0.02, 20), 0x8a7a68, { p: [0, Y0 + 0.125, 0] });
  // 砲弾の山
  for (const [x, z, y] of [[-0.3, 0.3, 0], [-0.24, 0.34, 0], [-0.27, 0.32, 0.06]] as V3[]) g.put(itemGeo('shell'), { p: [x, Y0 + 0.11 + y, z], s: 0.9 });
  const turret = new Geo()
    .add(rbox(0.22, 0.08, 0.26, 0.02), WOOD_D, { p: [0, 0.02, -0.02] })
    .add(cyl(0.07, 0.07, 0.03, 14), WOOD, { p: [0.13, 0.0, -0.02], r: [0, 0, PI / 2] })
    .add(cyl(0.07, 0.07, 0.03, 14), WOOD, { p: [-0.13, 0.0, -0.02], r: [0, 0, PI / 2] })
    .add(cyl(0.06, 0.08, 0.42, 16), 0x3d4048, { p: [0, 0.11, 0.08], r: [PI / 2 - 0.35, 0, 0] })
    .add(torus(0.068, 0.012, 6, 16), 0xd9a441, { p: [0, 0.18, 0.26], r: [-0.35, 0, 0] })
    .add(sph(0.085, 12, 10), 0x3d4048, { p: [0, 0.05, -0.12] })
    .build();
  return finish(g.build(), { turret: { geo: turret, mat: 'fx', pivot: [0, Y0 + 0.2, 0], count: 1, shadow: true } }, 0.66, false);
}

/** 柵: 杭と、隣の柵へ伸びる横木（+x 向き、回転中心は杭） */
function fence(): BuildingModel {
  const g = new Geo();
  g.add(rbox(0.12, 0.42, 0.12, 0.02), 0xb98a5a, { p: [0, 0.21, 0] });
  g.add(new THREE.ConeGeometry(0.09, 0.09, 4), 0x9a6b3e, { p: [0, 0.46, 0], r: [0, PI / 4, 0], flat: true });
  g.add(rbox(0.16, 0.035, 0.16, 0.01), 0x8a5a34, { p: [0, 0.3, 0] });
  for (const a of [0.4, 2.2, 4.1]) g.add(pebble, STONE_D, { p: [Math.cos(a) * 0.1, 0.02, Math.sin(a) * 0.1], s: 0.035, flat: true });
  const rail = new Geo();
  for (const y of [0.16, 0.32]) rail.add(rbox(0.5, 0.05, 0.035, 0.012), WOOD, { p: [0.25, y, 0] });
  for (const x of [0.17, 0.33]) {
    rail.add(rbox(0.06, 0.34, 0.025, 0.008), WOOD_L, { p: [x, 0.19, 0.025] });
    rail.add(new THREE.ConeGeometry(0.035, 0.05, 4), WOOD_L, { p: [x, 0.38, 0.025], r: [0, PI / 4, 0], s: [1, 1, 0.5], flat: true });
  }
  return finish(g.build(), { rail: { geo: rail.build(), mat: 'fx', pivot: [0, 0, 0], count: 0, shadow: true } }, 0.5, false, (f) => f.put(rail.build()).put(rail.build(), { r: [0, PI, 0] }));
}

function finish(base: THREE.BufferGeometry, parts: Record<string, PartModel>, top: number, hasPallet: boolean, extra?: (g: Geo) => void): BuildingModel {
  const f = new Geo().put(base);
  for (const p of Object.values(parts)) {
    if (p.geo === parts.line?.geo || !p.count) continue;
    f.put(p.geo, { p: p.pivot, r: p.rest });
    if (p.count === 2 && p.rest) f.put(p.geo, { p: p.pivot, r: [p.rest[0], p.rest[1], -p.rest[2]] });
  }
  extra?.(f);
  return { base, parts, full: f.build(), top, pallet: hasPallet };
}

const BUILDERS: Record<BuildingType, () => BuildingModel> = { miner, furnace, assembler, fishing, cannery, lab, market, warehouse, charger, bed, toybox, tower, hq, waterGun, turret, cannon, fence };

let cache: Record<BuildingType, BuildingModel> | null = null;
export function buildingModels() {
  cache ??= Object.fromEntries(Object.entries(BUILDERS).map(([k, f]) => [k, f()])) as Record<BuildingType, BuildingModel>;
  return cache;
}

let itemCache: Record<ItemId, THREE.BufferGeometry> | null = null;
export function itemModels() {
  itemCache ??= Object.fromEntries(Object.keys(ITEM_BUILDERS).map((k) => [k, itemGeo(k as ItemId)])) as Record<ItemId, THREE.BufferGeometry>;
  return itemCache;
}

// ===================== 猫 =====================

/** 猫の各パーツの関節位置（胴の中心からの相対） */
export const CAT = {
  bodyY: 0.155,
  head: [0, 0.065, 0.115] as V3,
  tail: [0, 0.03, -0.135] as V3,
  legs: [
    [-0.05, -0.02, 0.085],
    [0.05, -0.02, 0.085],
    [-0.052, -0.02, -0.085],
    [0.052, -0.02, -0.085],
  ] as V3[],
  /** 背中の荷物の位置 */
  cargo: [0, 0.075, -0.03] as V3,
};

export function catGeometries() {
  const fur = (light: (p: THREE.Vector3) => number) => (p: THREE.Vector3): [number, number] => [1, light(p)];

  const body = new Geo(true)
    .add(sph(1, 18, 14), 0xffffff, { s: [0.092, 0.086, 0.148], paint: fur((p) => (p.y < -0.035 || (p.z > 0.1 && p.y < 0.02) ? 1 : 0)) })
    .add(sph(1, 12, 10), 0xffffff, { p: [0, 0.005, 0.105], s: [0.068, 0.07, 0.06], paint: fur((p) => (p.y < 0.03 ? 1 : 0)) })
    .add(sph(1, 12, 10), 0xffffff, { p: [-0.045, -0.012, -0.075], s: [0.055, 0.066, 0.072], paint: fur((p) => (p.y < -0.05 ? 1 : 0)) })
    .add(sph(1, 12, 10), 0xffffff, { p: [0.045, -0.012, -0.075], s: [0.055, 0.066, 0.072], paint: fur((p) => (p.y < -0.05 ? 1 : 0)) })
    .build();

  const fixed = (): [number, number] => [0, 0];
  /** 頭。sad は耳を横へ伏せた（家出中の）顔 */
  const makeHead = (sad: boolean) => {
  const head = new Geo(true)
    .add(sph(1, 20, 16), 0xffffff, { p: [0, 0.065, 0.035], s: [0.125, 0.108, 0.112], paint: fur((p) => (p.y < 0.03 && p.z > 0.08 ? 1 : 0)) })
    .add(sph(1, 10, 8), 0xffffff, { p: [-0.025, 0.033, 0.125], s: [0.035, 0.028, 0.03], paint: fur(() => 1) })
    .add(sph(1, 10, 8), 0xffffff, { p: [0.025, 0.033, 0.125], s: [0.035, 0.028, 0.03], paint: fur(() => 1) })
    .add(sph(1, 8, 6), 0xf08a9a, { p: [0, 0.052, 0.148], s: [0.014, 0.0095, 0.008], paint: fixed });
  for (const sx of [-1, 1]) {
    head.add(torus(0.0095, 0.0024, 4, 8, PI), 0x5b3a3a, { p: [sx * 0.0095, 0.036, 0.152], r: [0, 0, PI], paint: fixed });
    head.add(sph(1, 12, 10), 0x111111, { p: [sx * 0.045, EYE_Y, 0.133], s: [0.0235, 0.031, 0.013], r: [0, sx * 0.38, 0], paint: () => [2, 0] });
    head.add(sph(0.0082, 6, 5), 0xffffff, { p: [sx * 0.038, EYE_Y + 0.012, 0.145], paint: () => [3, 0] });
    head.add(sph(0.004, 5, 4), 0xffffff, { p: [sx * 0.05, EYE_Y - 0.01, 0.144], paint: () => [3, 0] });
    const ear = sad ? { r: [-0.55, 0, -sx * 1.2] as V3, y: -0.016, x: 0.016 } : { r: [-0.12, 0, -sx * 0.38] as V3, y: 0, x: 0 };
    head.add(cone(0.045, 0.085, 10), 0xffffff, { p: [sx * (0.068 + ear.x), 0.158 + ear.y, 0.028], r: ear.r, s: [1, 1, 0.72], paint: fur(() => 0) });
    head.add(cone(0.027, 0.055, 8), 0xf4a9b8, { p: [sx * (0.064 + ear.x), 0.152 + ear.y, 0.046], r: ear.r, s: [1, 1, 0.45], paint: fixed });
    for (let k = 0; k < 3; k++)
      head.add(box(0.075, 0.0028, 0.0028), 0xf2ede4, { p: [sx * 0.085, 0.043 + (k - 1) * 0.011, 0.118], r: [0, -sx * 0.25, sx * (k - 1) * 0.18], paint: fixed });
  }
  return head.build();
  };

  const leg = new Geo(true)
    .add(new THREE.CapsuleGeometry(0.03, 0.085, 4, 10), 0xffffff, { p: [0, -0.0725, 0], paint: fur((p) => (p.y < -0.095 ? 1 : 0)) })
    .add(sph(1, 10, 8), 0xffffff, { p: [0, -0.125, 0.008], s: [0.034, 0.024, 0.04], paint: fur(() => 1) })
    .build();

  // 尻尾: 根元から先へ細くなる管
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0.04, -0.05),
    new THREE.Vector3(0, 0.11, -0.075),
    new THREE.Vector3(0, 0.17, -0.068),
    new THREE.Vector3(0, 0.205, -0.042),
  ]);
  const segs = 20;
  const radial = 8;
  const tube = new THREE.TubeGeometry(curve, segs, 0.021, radial, false);
  const pos = tube.attributes.position;
  const c = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    curve.getPointAt(i / segs, c);
    const k = 1 - 0.4 * (i / segs);
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      _v.fromBufferAttribute(pos, idx).sub(c).multiplyScalar(k).add(c);
      pos.setXYZ(idx, _v.x, _v.y, _v.z);
    }
  }
  const end = curve.getPointAt(1);
  const tail = new Geo(true)
    .add(tube, 0xffffff, { paint: fur((p) => (p.y > 0.19 ? 1 : 0)) })
    .add(sph(0.0127, 8, 6), 0xffffff, { p: [end.x, end.y, end.z], paint: fur(() => 1) })
    .add(sph(0.021, 8, 6), 0xffffff, { paint: fur(() => 0) })
    .build();

  return { body, head: makeHead(false), headSad: makeHead(true), leg, tail };
}

// ===================== 装飾 =====================

export function decoGeometries() {
  const tree = new Geo()
    .add(cyl(0.06, 0.09, 0.5, 8), 0x8b5e3c, { p: [0, 0.25, 0] })
    .add(sph(0.38, 14, 10), 0x5fb55a, { p: [0, 0.78, 0] })
    .add(sph(0.27, 12, 9), 0x70c463, { p: [0.21, 0.66, 0.09] })
    .add(sph(0.28, 12, 9), 0x55a952, { p: [-0.19, 0.68, -0.07] })
    .add(sph(0.22, 12, 9), 0x78cc6a, { p: [0.04, 0.98, 0.1] })
    .build();
  const pine = new Geo()
    .add(cyl(0.05, 0.07, 0.3, 8), 0x7a5234, { p: [0, 0.15, 0] })
    .add(cone(0.42, 0.5, 12), 0x3f8f5a, { p: [0, 0.48, 0] })
    .add(cone(0.33, 0.44, 12), 0x48a063, { p: [0, 0.72, 0] })
    .add(cone(0.22, 0.36, 12), 0x55af6d, { p: [0, 0.95, 0] })
    .build();
  const bush = new Geo()
    .add(sph(0.2, 12, 9), 0x62b45a, { p: [0, 0.15, 0] })
    .add(sph(0.15, 10, 8), 0x6fc265, { p: [0.17, 0.11, 0.05] })
    .add(sph(0.14, 10, 8), 0x58a852, { p: [-0.15, 0.1, -0.04] })
    .add(sph(0.022, 6, 5), 0xe0455b, { p: [0.08, 0.3, 0.12] })
    .add(sph(0.022, 6, 5), 0xe0455b, { p: [-0.1, 0.24, 0.13] })
    .add(sph(0.022, 6, 5), 0xe0455b, { p: [0.2, 0.2, 0.15] })
    .build();
  const rock = new Geo()
    .add(new THREE.DodecahedronGeometry(0.24, 0), 0xaca69e, { p: [0, 0.08, 0], s: [1, 0.62, 0.85], flat: true })
    .add(new THREE.DodecahedronGeometry(0.11, 0), 0x9d978f, { p: [0.24, 0.04, 0.1], s: [1, 0.7, 1], r: [0.5, 0.3, 0], flat: true })
    .build();
  const petals = new Geo();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * PI * 2;
    petals.add(sph(1, 6, 4), 0xffffff, { p: [Math.cos(a) * 0.026, 0.16, Math.sin(a) * 0.026], s: [0.026, 0.011, 0.017], r: [0, -a, 0] });
  }
  const stem = new Geo()
    .add(cyl(0.006, 0.007, 0.16, 4), 0x4f9a42, { p: [0, 0.08, 0] })
    .add(sph(0.014, 6, 5), 0xffd447, { p: [0, 0.166, 0] })
    .add(sph(1, 6, 4), 0x5aa84a, { p: [0.02, 0.05, 0], s: [0.03, 0.008, 0.013], r: [0, 0, 0.5] })
    .build();
  const tuft = new Geo();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * PI * 2;
    tuft.add(cone(0.022, 0.16 + (i % 3) * 0.03, 4), i % 2 ? 0x5aa84a : 0x6dbb55, { p: [Math.cos(a) * 0.03, 0.08, Math.sin(a) * 0.03], r: [Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3] });
  }
  const mushroom = new Geo()
    .add(cyl(0.024, 0.03, 0.07, 8), 0xfff1dc, { p: [0, 0.035, 0] })
    .add(new THREE.SphereGeometry(0.062, 12, 6, 0, PI * 2, 0, PI / 2), 0xe5484d, { p: [0, 0.065, 0], s: [1, 0.75, 1] })
    .add(sph(0.011, 5, 4), 0xffffff, { p: [0.025, 0.105, 0.01] })
    .add(sph(0.009, 5, 4), 0xffffff, { p: [-0.02, 0.1, 0.025] })
    .add(sph(0.008, 5, 4), 0xffffff, { p: [-0.01, 0.11, -0.025] })
    .build();
  const post = new Geo()
    .add(rbox(0.075, 0.32, 0.075, 0.015), 0xc8956a, { p: [0, 0.16, 0] })
    .add(new THREE.ConeGeometry(0.06, 0.06, 4), 0xb3815a, { p: [0, 0.35, 0], r: [0, PI / 4, 0], flat: true })
    .build();
  const rail = new Geo().add(rbox(1.0, 0.04, 0.03, 0.012), 0xd9a879, {}).build();
  const cloud = new Geo();
  const puffs: [number, number, number, number][] = [[0, 0, 0, 1.6], [1.4, -0.1, 0.3, 1.2], [-1.3, -0.15, -0.2, 1.25], [0.5, 0.35, -0.4, 1.1], [-0.5, 0.3, 0.5, 1.0], [2.3, -0.3, -0.1, 0.8], [-2.2, -0.3, 0.2, 0.8]];
  for (const [x, y, z, r] of puffs) cloud.add(sph(r, 14, 10), 0xffffff, { p: [x, y, z], s: [1, 0.55, 0.9] });
  return { tree, pine, bush, rock, petals: petals.build(), stem, tuft: tuft.build(), mushroom, post, rail, cloud: cloud.build() };
}

// ===================== 職人の道具 =====================

/** 職人が作業で使う道具（猫の足元を原点とした猫の座標系、+z が前） */
export function toolGeometries() {
  const rod = new Geo()
    .add(cyl(0.005, 0.009, 0.42, 6), 0x7b5233, { p: [0, 0.21, 0] })
    .add(cyl(0.014, 0.014, 0.07, 8), 0xd9b48a, { p: [0, 0.03, 0] })
    .add(cyl(0.017, 0.017, 0.016, 10), 0x50616f, { p: [0.016, 0.07, 0], r: [0, 0, PI / 2] })
    .build();
  const line = new Geo().add(cyl(0.0022, 0.0022, 1, 4), 0xf4f4f4, { p: [0, 0.5, 0] }).build();
  // かまど付きの鍋
  const pot = new Geo()
    .add(cyl(0.06, 0.066, 0.022, 12), 0x8f8a84, { p: [0, 0.011, 0] })
    .add(cyl(0.04, 0.04, 0.012, 10), 0xff8a3a, { p: [0, 0.024, 0], glow: 1 })
    .add(cyl(0.075, 0.062, 0.085, 16), 0x50565e, { p: [0, 0.07, 0] })
    .add(torus(0.075, 0.008, 6, 20), 0x6b727b, { p: [0, 0.112, 0], r: [PI / 2, 0, 0] })
    .add(cyl(0.068, 0.068, 0.006, 16), 0xe8a04a, { p: [0, 0.104, 0], glow: 0.25 })
    .add(torus(0.016, 0.004, 4, 10), 0x6b727b, { p: [0.082, 0.09, 0], r: [0, 0, 0] })
    .add(torus(0.016, 0.004, 4, 10), 0x6b727b, { p: [-0.082, 0.09, 0], r: [0, 0, 0] })
    .build();
  // お玉（+y が柄）
  const ladle = new Geo()
    .add(cyl(0.0045, 0.0045, 0.17, 6), WOOD, { p: [0, 0.085, 0] })
    .add(new THREE.SphereGeometry(0.02, 10, 6, 0, PI * 2, PI / 2, PI / 2), METAL, {})
    .build();
  // つるはし（+y が柄、頭は ±z に尖る）
  const pickaxe = new Geo()
    .add(cyl(0.006, 0.007, 0.2, 6), WOOD, { p: [0, 0.1, 0] })
    .add(cone(0.012, 0.07, 6), 0x8d96a0, { p: [0, 0.2, 0.035], r: [PI / 2 + 0.25, 0, 0] })
    .add(cone(0.012, 0.07, 6), 0x8d96a0, { p: [0, 0.2, -0.035], r: [-PI / 2 - 0.25, 0, 0] })
    .add(rbox(0.024, 0.024, 0.03, 0.006), 0x5a646e, { p: [0, 0.2, 0] })
    .build();
  // ふいご（底が原点、y の拡大で膨らむ。+z が筒先）
  const bellows = new Geo()
    .add(rbox(0.09, 0.008, 0.12, 0.004), WOOD, { p: [0, 0.004, 0] })
    .add(sph(1, 10, 6), 0x8a5a34, { p: [0, 0.025, -0.01], s: [0.04, 0.022, 0.055] })
    .add(rbox(0.09, 0.008, 0.12, 0.004), WOOD_L, { p: [0, 0.046, -0.005], r: [0.12, 0, 0] })
    .add(cyl(0.006, 0.012, 0.05, 6), 0x8d96a0, { p: [0, 0.02, 0.08], r: [PI / 2, 0, 0] })
    .add(cyl(0.005, 0.005, 0.05, 5), WOOD_D, { p: [0, 0.05, -0.08], r: [PI / 2, 0, 0] })
    .build();
  // 金づち（柄の先が原点、+y が頭）
  const hammer = new Geo().add(cyl(0.005, 0.006, 0.14, 6), WOOD, { p: [0, 0.07, 0] }).add(rbox(0.05, 0.026, 0.026, 0.006), 0x5a646e, { p: [0, 0.145, 0] }).build();
  // フラスコ（底が原点）
  const flask = new Geo()
    .add(lathe([[0, 0], [0.042, 0], [0.045, 0.008], [0.02, 0.058], [0.013, 0.068], [0.013, 0.095], [0.017, 0.1]]), 0xd8f8ff, {})
    .add(lathe([[0, 0.003], [0.04, 0.003], [0.041, 0.009], [0.026, 0.036], [0, 0.036]]), 0x6fd85a, { glow: 0.9 })
    .build();
  return { rod, line, pot, ladle, pickaxe, bellows, hammer, flask };
}

// ===================== ティアの装飾 =====================

/** ティア 2: 旗竿と 2 本目の煙突（生産建物）か花のプランター。旗は別（instance color で建物の色） */
export function tierGeometries() {
  const pole = (g: Geo, top: number) => g.add(cyl(0.008, 0.01, top, 6), 0xf5efe4, { p: [0.4, Y0 + top / 2, -0.4] }).add(sph(0.016, 8, 6), GOLD, { p: [0.4, Y0 + top, -0.4] });
  const work = pole(new Geo(), 0.78)
    .add(cyl(0.04, 0.048, 0.42, 10), 0xb5533e, { p: [-0.4, Y0 + 0.21, -0.4] })
    .add(cyl(0.054, 0.054, 0.04, 10), 0x6e3529, { p: [-0.4, Y0 + 0.42, -0.4] })
    .add(cyl(0.05, 0.05, 0.012, 10), 0x9a4a36, { p: [-0.4, Y0 + 0.3, -0.4] })
    .build();
  const rest = pole(new Geo(), 0.6).add(rbox(0.16, 0.06, 0.07, 0.015), WOOD, { p: [-0.36, Y0 + 0.03, -0.4] });
  for (const [x, c] of [[-0.41, 0xff8fb3], [-0.36, 0xffd447], [-0.31, 0x9fd3ff]] as const) rest.add(sph(0.022, 8, 6), c, { p: [x, Y0 + 0.075, -0.4] }).add(sph(0.016, 6, 5), 0x5fae5a, { p: [x + 0.012, Y0 + 0.068, -0.39] });
  // 旗（竿の先から +x へなびく。回転中心は竿側）
  const flag = new Geo().add(box(0.16, 0.09, 0.006), 0xffffff, { p: [0.08, 0, 0] }).add(cone(0.045, 0.05, 3), 0xffffff, { p: [0.17, 0, 0], r: [0, 0, -PI / 2], s: [1, 1, 0.13] }).build();
  // ティア 3: 金の縁取りと明かりの灯籠
  const gold = new Geo();
  for (const [x, z, w, d] of [[0, 0.46, 0.94, 0.03], [0, -0.46, 0.94, 0.03], [0.46, 0, 0.03, 0.94], [-0.46, 0, 0.03, 0.94]]) gold.add(rbox(w, 0.022, d, 0.008), GOLD, { p: [x, Y0 + 0.011, z], glow: 0.25 });
  for (const [x, z] of [[-0.44, 0.44], [0.44, 0.06]]) {
    gold.add(cyl(0.01, 0.012, 0.2, 6), 0x5a4a3a, { p: [x, Y0 + 0.1, z] });
    gold.add(rbox(0.05, 0.06, 0.05, 0.01), GOLD, { p: [x, Y0 + 0.23, z] });
    gold.add(rbox(0.036, 0.042, 0.054, 0.006), 0xfff0a0, { p: [x, Y0 + 0.23, z], glow: 1 });
    gold.add(cone(0.04, 0.035, 4), 0x7a3e8e, { p: [x, Y0 + 0.278, z], r: [0, PI / 4, 0], flat: true });
  }
  // 強化中の足場（建物を囲む 4 本の柱と横板）と木づち（柄の先が原点、+y が頭）
  const scaffold = new Geo();
  for (const [x, z] of [[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]]) scaffold.add(box(0.03, 0.8, 0.03), WOOD, { p: [x, Y0 + 0.4, z] });
  for (const y of [0.3, 0.62]) {
    scaffold.add(box(0.88, 0.022, 0.07), WOOD_L, { p: [0, Y0 + y, 0.42] }).add(box(0.88, 0.022, 0.07), WOOD_L, { p: [0, Y0 + y, -0.42] });
    scaffold.add(box(0.07, 0.022, 0.88), WOOD_L, { p: [0.42, Y0 + y, 0] }).add(box(0.07, 0.022, 0.88), WOOD_L, { p: [-0.42, Y0 + y, 0] });
  }
  scaffold.add(box(0.02, 0.9, 0.02), WOOD_D, { p: [0, Y0 + 0.36, 0.42], r: [0, 0, 1.05] });
  const mallet = new Geo().add(cyl(0.008, 0.008, 0.2, 6), WOOD_D, { p: [0, 0.1, 0] }).add(cyl(0.035, 0.035, 0.09, 10), WOOD, { p: [0, 0.2, 0], r: [0, 0, PI / 2] }).build();
  return { work, rest: rest.build(), flag, gold: gold.build(), scaffold: scaffold.build(), mallet };
}

// ===================== 犬と船 =====================

/** 犬の関節位置（胴の中心からの相対、+z が前） */
export const DOG = {
  bodyY: 0.17,
  head: [0, 0.075, 0.15] as V3,
  tail: [0, 0.05, -0.15] as V3,
  legs: [
    [-0.045, -0.035, 0.09],
    [0.045, -0.035, 0.09],
    [-0.048, -0.035, -0.095],
    [0.048, -0.035, -0.095],
  ] as V3[],
};

/** 犬: 長い鼻先・垂れ耳・太い尻尾。白地で作り、毛色はインスタンスの色で塗る（鼻・目・首輪は濃いので沈まない） */
export function dogGeometries() {
  const LIGHT = 0xfff6ea;
  const body = new Geo()
    .add(sph(1, 16, 12), 0xffffff, { s: [0.085, 0.078, 0.155] })
    .add(sph(1, 12, 10), LIGHT, { p: [0, -0.022, 0.085], s: [0.066, 0.062, 0.07] })
    .add(sph(1, 12, 10), 0xffffff, { p: [0, 0.01, -0.09], s: [0.075, 0.07, 0.07] })
    .add(torus(0.06, 0.013, 6, 18), 0x9e1f2a, { p: [0, 0.04, 0.12], r: [PI / 2 + 0.5, 0, 0] })
    .add(cyl(0.016, 0.016, 0.006, 10), 0xffd447, { p: [0, 0.005, 0.165], r: [PI / 2 + 0.5, 0, 0] })
    .build();
  const head = new Geo()
    .add(sph(1, 16, 12), 0xffffff, { p: [0, 0.03, 0], s: [0.075, 0.07, 0.072] })
    .add(rbox(0.072, 0.056, 0.11, 0.026), LIGHT, { p: [0, 0.0, 0.085] })
    .add(sph(0.02, 8, 6), 0x1b1512, { p: [0, 0.02, 0.142], s: [1.1, 0.85, 0.8] })
    .add(rbox(0.03, 0.006, 0.04, 0.003), 0xe0607a, { p: [0, -0.03, 0.12] });
  for (const sx of [-1, 1]) {
    head.add(sph(0.013, 8, 6), 0x1b1512, { p: [sx * 0.034, 0.055, 0.06] });
    head.add(sph(0.004, 5, 4), 0xffffff, { p: [sx * 0.03, 0.06, 0.071] });
    // 垂れ耳
    head.add(sph(1, 10, 8), 0xb0a090, { p: [sx * 0.068, 0.02, -0.005], s: [0.022, 0.065, 0.045], r: [0, 0, sx * 0.28] });
  }
  const leg = new Geo()
    .add(new THREE.CapsuleGeometry(0.023, 0.09, 4, 8), 0xffffff, { p: [0, -0.065, 0] })
    .add(sph(1, 8, 6), LIGHT, { p: [0, -0.115, 0.01], s: [0.028, 0.02, 0.034] })
    .build();
  const tail = new Geo()
    .add(cyl(0.012, 0.026, 0.15, 8), 0xffffff, { p: [0, 0.075, 0] })
    .add(sph(0.014, 8, 6), LIGHT, { p: [0, 0.15, 0] })
    .build();
  // 倒れた犬が残す骨
  const bone = new Geo()
    .add(cyl(0.018, 0.018, 0.16, 8), 0xfff6e8, { r: [0, 0, PI / 2] })
    .add(sph(0.026, 8, 6), 0xfff6e8, { p: [0.085, 0, 0.02] })
    .add(sph(0.026, 8, 6), 0xfff6e8, { p: [0.085, 0, -0.02] })
    .add(sph(0.026, 8, 6), 0xfff6e8, { p: [-0.085, 0, 0.02] })
    .add(sph(0.026, 8, 6), 0xfff6e8, { p: [-0.085, 0, -0.02] })
    .build();
  return { body, head: head.build(), leg, tail, bone };
}

/** 犬の船（+z が舳先、原点は水面） */
export function boatGeometry() {
  const HULL = 0x8a5a34;
  const g = new Geo()
    .add(rbox(0.62, 0.26, 1.5, 0.08, 3), HULL, { p: [0, -0.02, -0.05] })
    .add(cone(0.31, 0.5, 4), HULL, { p: [0, -0.02, 0.92], r: [PI / 2, PI / 4, 0], s: [1, 1, 0.52], flat: true })
    .add(rbox(0.56, 0.035, 1.42, 0.02), WOOD_L, { p: [0, 0.11, -0.05] })
    .add(rbox(0.66, 0.05, 0.05, 0.02), 0xe5484d, { p: [0, 0.08, 0.68] })
    .add(rbox(0.05, 0.07, 1.46, 0.02), 0x6a4226, { p: [0.3, 0.14, -0.05] })
    .add(rbox(0.05, 0.07, 1.46, 0.02), 0x6a4226, { p: [-0.3, 0.14, -0.05] })
    .add(cyl(0.025, 0.03, 1.3, 8), WOOD_D, { p: [0, 0.75, 0.05] })
    .add(rbox(0.7, 0.75, 0.02, 0.02), 0xfff6e8, { p: [0, 0.82, 0.08], r: [0.06, 0, 0] })
    .add(rbox(0.71, 0.08, 0.025, 0.01), 0xe5484d, { p: [0, 0.6, 0.08] })
    .add(rbox(0.71, 0.08, 0.025, 0.01), 0xe5484d, { p: [0, 1.02, 0.1] })
    .add(cyl(0.11, 0.11, 0.026, 16), 0x5a3d2b, { p: [0, 0.82, 0.1], r: [PI / 2, 0, 0] })
    .add(box(0.2, 0.1, 0.005), 0x2f2c34, { p: [0.1, 1.38, 0.05] })
    .add(cyl(0.12, 0.13, 0.08, 12), WOOD, { p: [0, 0.18, -0.55] })
    .build();
  return g;
}

// ===================== ロボ猫 =====================

/** ロボ猫の脚の 1 節の長さ（太もも → 膝 → すね）と、アンテナの先の位置（尻尾の根元から） */
export const ROBOT_LEG = 0.07;
export const ROBOT_TIP: V3 = [0, 0.2, -0.075];

/** ロボ猫: 猫と同じ関節位置に、金属の板・光る目・2 節の脚・アンテナの尻尾。目とアンテナの先と稲妻は発光用に別 */
export function robotGeometries() {
  const M1 = 0xd2dbe3;
  const M2 = 0x93a0ac;
  const M3 = 0x55606a;
  const ACC = 0x4fc4e8;
  const body = new Geo()
    .add(rbox(0.16, 0.15, 0.27, 0.06, 3), M1, {})
    .add(rbox(0.165, 0.05, 0.2, 0.02), M2, { p: [0, -0.04, -0.01] })
    .add(rbox(0.04, 0.012, 0.2, 0.006), ACC, { p: [0, 0.076, -0.01], glow: 0.7 })
    .add(rbox(0.11, 0.09, 0.02, 0.02), M2, { p: [0, 0, 0.132] })
    .add(sph(0.018, 8, 6), M3, { p: CAT.tail });
  for (const sx of [-1, 1]) {
    body.add(rbox(0.012, 0.08, 0.16, 0.006), M2, { p: [sx * 0.082, 0.01, -0.01] });
    for (const z of [-0.06, 0.04]) body.add(sph(0.006, 6, 5), M3, { p: [sx * 0.089, 0.035, z] });
  }
  const head = new Geo()
    .add(rbox(0.19, 0.15, 0.17, 0.06, 3), M1, { p: [0, 0.065, 0.035] })
    .add(rbox(0.15, 0.08, 0.02, 0.025), 0x1f242a, { p: [0, 0.06, 0.115] })
    .add(rbox(0.04, 0.01, 0.01, 0.004), M3, { p: [0, 0.012, 0.12] });
  for (const sx of [-1, 1]) {
    head.add(cone(0.042, 0.075, 4), M1, { p: [sx * 0.06, 0.16, 0.03], r: [0, PI / 4, -sx * 0.32], s: [1, 1, 0.7], flat: true });
    head.add(cone(0.024, 0.045, 4), ACC, { p: [sx * 0.058, 0.155, 0.046], r: [0, PI / 4, -sx * 0.32], s: [1, 1, 0.4], flat: true, glow: 0.6 });
    head.add(cyl(0.02, 0.02, 0.014, 10), M2, { p: [sx * 0.098, 0.06, 0.03], r: [0, 0, PI / 2] });
    for (let k = 0; k < 2; k++) head.add(box(0.05, 0.003, 0.003), M3, { p: [sx * 0.11, 0.035 + k * 0.012, 0.09], r: [0, -sx * 0.25, sx * (k - 0.5) * 0.3] });
  }
  const eyes = new Geo();
  for (const sx of [-1, 1]) eyes.add(cyl(0.022, 0.022, 0.006, 14), 0xffffff, { p: [sx * 0.04, EYE_Y, 0.127], r: [PI / 2, 0, 0] });
  const upper = new Geo().add(cyl(0.019, 0.016, ROBOT_LEG, 8), M2, { p: [0, -ROBOT_LEG / 2, 0] }).add(sph(0.021, 8, 6), M3, { p: [0, -ROBOT_LEG, 0] }).build();
  const lower = new Geo()
    .add(cyl(0.015, 0.013, ROBOT_LEG - 0.01, 8), M1, { p: [0, -(ROBOT_LEG - 0.01) / 2, 0] })
    .add(rbox(0.036, 0.016, 0.048, 0.006), M3, { p: [0, -ROBOT_LEG + 0.003, 0.008] })
    .build();
  const tail = new Geo();
  strut(tail, [0, 0, 0], [0, 0.1, -0.05], 0.007, M3, 6);
  tail.add(sph(0.011, 6, 5), M2, { p: [0, 0.1, -0.05] });
  strut(tail, [0, 0.1, -0.05], ROBOT_TIP, 0.005, M3, 6);
  const tip = new Geo().add(sph(0.018, 10, 8), 0xffffff, {}).build();
  // 充電中の稲妻（原点が中心、xy 平面）
  const sh = new THREE.Shape();
  sh.moveTo(0.02, 0.1);
  sh.lineTo(-0.035, 0);
  sh.lineTo(0, 0);
  sh.lineTo(-0.02, -0.1);
  sh.lineTo(0.04, 0.015);
  sh.lineTo(0.004, 0.015);
  sh.lineTo(0.03, 0.1);
  sh.closePath();
  const bolt = new Geo().add(new THREE.ExtrudeGeometry(sh, { depth: 0.02, bevelEnabled: false }), 0xffd34d, { p: [0, 0, -0.01], glow: 1, flat: true }).build();
  return { body: body.build(), head: head.build(), eyes: eyes.build(), upper, lower, tail: tail.build(), tip, bolt };
}

// ===================== リフト =====================

/** リフトの寸法: 滑車の中心の高さ・半径・傾き（上側が前進ケーブル、下側が戻りケーブル）、フックの長さ、品を吊る糸の長さ、積み降ろしアームの高さ */
export const LIFT_DIM = { hc: 1.5, r: 0.075, tilt: 0.5, hook: 0.05, line: 0.24, arm: 1.16 };

/** リフトの部品（原点や向きは各部品のコメント） */
export function liftGeometries(poleColor: number) {
  const { hc, r, arm: ay } = LIFT_DIM;
  const DARK = 0x50565e;
  // 支柱（原点は足元）
  const pole = new Geo()
    .add(rbox(0.16, 0.03, 0.16, 0.008), 0x6e7681, { p: [0, 0.015, 0] })
    .add(cyl(0.04, 0.04, 0.03, 8), DARK, { p: [0, 0.045, 0] })
    .add(cyl(0.028, 0.034, hc - 0.06, 8), poleColor, { p: [0, (hc - 0.06) / 2 + 0.03, 0] })
    .add(box(0.05, 0.04, 0.05), DARK, { p: [0, hc - 0.05, 0] })
    .build();
  // 滑車（原点が中心、軸は x、+z が進行方向）。回っているのが分かるようにスポークと印
  const pulley = new Geo().add(cyl(r, r, 0.014, 18), 0x9aa3ad, { r: [0, 0, PI / 2] }).add(torus(r, 0.008, 5, 22), 0x3d4048, { r: [0, PI / 2, 0] }).add(cyl(0.02, 0.02, 0.03, 10), DARK, { r: [0, 0, PI / 2] });
  for (let i = 0; i < 3; i++) pulley.add(box(0.024, 0.008, r * 1.7), 0x6e7681, { r: [(i / 3) * PI, 0, 0] });
  pulley.add(box(0.026, 0.016, 0.016), 0xffc845, { p: [0, r * 0.72, 0] });
  // 滑車の軸受け（滑車と同じ座標系）
  const yoke = new Geo()
    .add(box(0.01, 0.1, 0.028), DARK, { p: [0.022, -0.045, 0] })
    .add(box(0.01, 0.1, 0.028), DARK, { p: [-0.022, -0.045, 0] })
    .add(box(0.054, 0.012, 0.028), DARK, { p: [0, -0.095, 0] })
    .build();
  // ケーブルと腕木（+z に長さ 1）
  const cable = new Geo().add(cyl(0.0055, 0.0055, 1, 5), 0x2a2e34, { p: [0, 0, 0.5], r: [PI / 2, 0, 0] }).build();
  const beam = new Geo().add(cyl(0.012, 0.012, 1, 6), DARK, { p: [0, 0, 0.5], r: [PI / 2, 0, 0] }).build();
  // フック（原点がケーブル、+z が進行方向）
  const hook = new Geo()
    .add(rbox(0.024, 0.02, 0.04, 0.006), DARK, { p: [0, 0.006, 0] })
    .add(cyl(0.0035, 0.0035, 0.04, 5), 0x9aa3ad, { p: [0, -0.02, 0] })
    .add(torus(0.011, 0.0035, 4, 10, PI * 1.4), 0x9aa3ad, { p: [0, -0.044, 0], r: [0, PI / 2, PI * 0.8] })
    .build();
  // 品を吊る糸（-y に長さ 1）
  const line = new Geo().add(cyl(0.0025, 0.0025, 1, 4), 0xe8e4dc, { p: [0, -0.5, 0] }).build();
  // 積み降ろしアームの柱（原点が足元）と腕（原点が柱の頂、+x へ伸びて先に爪）
  const post = new Geo()
    .add(rbox(0.07, 0.03, 0.07, 0.008), 0x6e7681, { p: [0, 0.015, 0] })
    .add(box(0.03, ay, 0.03), poleColor, { p: [0, ay / 2, 0] })
    .add(cyl(0.022, 0.022, 0.03, 10), DARK, { p: [0, ay, 0] })
    .build();
  const armGeo = new Geo()
    .add(box(0.2, 0.018, 0.022), DARK, { p: [0.1, 0.01, 0] })
    .add(box(0.012, 0.06, 0.03), 0x9aa3ad, { p: [0.2, 0.04, 0.012] })
    .add(box(0.012, 0.06, 0.03), 0x9aa3ad, { p: [0.2, 0.04, -0.012] })
    .add(sph(0.012, 6, 5), 0xffc845, { p: [0, 0.03, 0], glow: 0.6 })
    .build();
  // 設置の向きの矢印（地面、+z を指す）
  const as = new THREE.Shape();
  as.moveTo(-0.09, -0.22);
  as.lineTo(0.09, -0.22);
  as.lineTo(0.09, 0.02);
  as.lineTo(0.2, 0.02);
  as.lineTo(0, 0.32);
  as.lineTo(-0.2, 0.02);
  as.lineTo(-0.09, 0.02);
  as.closePath();
  const arrow = new THREE.ShapeGeometry(as).rotateX(PI / 2);
  return { pole, pulley: pulley.build(), yoke, cable, beam, hook, line, post, arm: armGeo, arrow };
}

// ===================== 鉱床 =====================

/** 鉱床の岩: 種類ごとに大きな塊（タイルの中）と小さな塊（建物の下から覗く角）。[地, 地 2, 鉱物] */
const DEPOSIT: Record<OreId, [number, number, number, number]> = {
  ironOre: [0x8a7568, 0x9b8576, 0xc0623e, 0],
  copperOre: [0x8f8a80, 0xa29c90, 0xf0904a, 0.3],
  coal: [0x2c2c33, 0x3c3c44, 0x5e5e6a, 0],
  stone: [0xa49c90, 0xb8b0a4, 0xd0c8bc, 0],
};
export function depositGeometries() {
  const big = {} as Record<OreId, THREE.BufferGeometry>;
  const small = {} as Record<OreId, THREE.BufferGeometry>;
  for (const k of Object.keys(DEPOSIT) as OreId[]) {
    const [a, b, f, gl] = DEPOSIT[k];
    const round = k === 'stone';
    const shape = round ? sph(1, 9, 6) : rock;
    big[k] = new Geo()
      .add(shape, a, { p: [0, 0.05, 0], s: [0.17, 0.09, 0.14], r: [0.2, 0.4, 0.1], flat: !round })
      .add(shape, b, { p: [0.16, 0.035, 0.08], s: [0.1, 0.07, 0.09], r: [0.8, 0.2, 0.5], flat: !round })
      .add(shape, b, { p: [-0.14, 0.03, 0.11], s: [0.08, 0.055, 0.07], r: [0.3, 1.2, 0.2], flat: !round })
      .add(shape, a, { p: [-0.06, 0.025, -0.17], s: [0.07, 0.05, 0.06], r: [1.1, 0.4, 0], flat: !round })
      .add(rock, f, { p: [0.03, 0.12, 0.03], s: 0.035, r: [0.5, 0.3, 0], flat: true, glow: gl })
      .add(rock, f, { p: [0.17, 0.09, 0.06], s: 0.025, r: [0.2, 0.9, 0], flat: true, glow: gl })
      .add(rock, f, { p: [-0.09, 0.08, 0.05], s: 0.028, r: [1, 0, 0.4], flat: true, glow: gl })
      .add(rock, f, { p: [-0.13, 0.05, 0.15], s: 0.02, flat: true, glow: gl })
      .build();
    small[k] = new Geo()
      .add(shape, a, { p: [0, 0.03, 0], s: [0.07, 0.05, 0.06], r: [0.4, 0.6, 0.2], flat: !round })
      .add(shape, b, { p: [0.05, 0.02, 0.035], s: [0.04, 0.03, 0.035], r: [1, 0.2, 0.3], flat: !round })
      .add(rock, f, { p: [-0.01, 0.07, 0.01], s: 0.02, r: [0.4, 0.8, 0], flat: true, glow: gl })
      .add(rock, f, { p: [0.05, 0.045, 0.03], s: 0.014, flat: true, glow: gl })
      .build();
  }
  return { big, small };
}
