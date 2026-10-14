import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BuildingType, ItemId } from '../sim/data';
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

const ITEM_BUILDERS: Record<ItemId, (g: Geo) => void> = {
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
  yarn(g) {
    g.add(sph(0.05, 16, 12), 0xf48fb8, { p: [0, 0.05, 0] });
    const rings: V3[] = [[PI / 2, 0, 0.5], [PI / 2, 0, -0.7], [0.3, 1.0, 0], [-0.5, 0.2, 1.2]];
    for (const r of rings) g.add(torus(0.05, 0.0055, 5, 22), 0xd8639a, { p: [0, 0.05, 0], r });
    g.add(cyl(0.004, 0.004, 0.06, 5), 0xd8639a, { p: [0.05, 0.015, 0.01], r: [0, 0.4, 1.1] });
  },
  gift(g) {
    g.add(rbox(0.1, 0.08, 0.1, 0.012), 0xe5484d, { p: [0, 0.04, 0] });
    g.add(rbox(0.104, 0.083, 0.024, 0.006), 0xffd447, { p: [0, 0.04, 0] });
    g.add(rbox(0.024, 0.083, 0.104, 0.006), 0xffd447, { p: [0, 0.04, 0] });
    for (const sx of [-1, 1]) g.add(torus(0.017, 0.006, 5, 12), 0xffd447, { p: [sx * 0.017, 0.093, 0], r: [0, 0, sx * 0.7], s: [1, 1, 0.8] });
    g.add(sph(0.011, 8, 6), 0xffc52e, { p: [0, 0.088, 0] });
  },
  scarf(g) {
    const cols = [0x8e5cc8, 0xf1e6ff];
    for (let layer = 0; layer < 3; layer++)
      for (let k = 0; k < 5; k++)
        g.add(rbox(0.028, 0.022, 0.072, 0.008), cols[(k + layer) % 2], { p: [-0.056 + k * 0.028 + layer * 0.006, 0.012 + layer * 0.021, 0] });
    g.add(torus(0.021, 0.011, 6, 10, PI), 0x8e5cc8, { p: [0.08, 0.033, 0], r: [0, 0, -PI / 2], s: [1, 1, 3.2] });
    for (let k = 0; k < 4; k++) g.add(cyl(0.003, 0.003, 0.03, 4), 0xf1e6ff, { p: [-0.078, 0.01, -0.027 + k * 0.018], r: [0, 0, 1.2] });
  },
  luxury(g) {
    g.add(rbox(0.11, 0.09, 0.11, 0.014), 0xf6c443, { p: [0, 0.045, 0] });
    g.add(rbox(0.114, 0.093, 0.026, 0.006), 0x7b3fc0, { p: [0, 0.045, 0] });
    g.add(rbox(0.026, 0.093, 0.114, 0.006), 0x7b3fc0, { p: [0, 0.045, 0] });
    for (const sx of [-1, 1]) g.add(torus(0.02, 0.007, 5, 12), 0x9a5ae0, { p: [sx * 0.02, 0.104, 0], r: [0, 0, sx * 0.7], s: [1, 1, 0.8] });
    g.add(new THREE.OctahedronGeometry(0.02), 0x8ff4ff, { p: [0, 0.125, 0], s: [1, 1.3, 1], glow: 0.7, flat: true });
  },
};

export function itemGeo(id: ItemId) {
  const g = new Geo();
  ITEM_BUILDERS[id](g);
  return g.build();
}

/** 積み上げ時の 1 段の高さ */
export const ITEM_H: Record<ItemId, number> = { fish: 0.055, can: 0.066, yarn: 0.085, gift: 0.08, scarf: 0.07, luxury: 0.09 };

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

function packer(): BuildingModel {
  const g = new Geo();
  const mx = -0.08;
  const mz = -0.2;
  g.add(rbox(0.44, 0.04, 0.34, 0.012), 0x8d8f99, { p: [mx, Y0 + 0.02, mz] });
  g.add(rbox(0.4, 0.3, 0.3, 0.05), 0xf39a3b, { p: [mx, Y0 + 0.18, mz] });
  g.add(rbox(0.405, 0.05, 0.305, 0.02), 0xd9792a, { p: [mx, Y0 + 0.31, mz] });
  // 前面パネルとボタン
  g.add(rbox(0.16, 0.12, 0.016, 0.01), 0xfff1dd, { p: [mx - 0.08, Y0 + 0.17, mz + 0.152] });
  const btn: [number, number][] = [[0xe5484d, -0.13], [0x63c76b, -0.08], [0xffcf4a, -0.03]];
  for (const [c, x] of btn) g.add(sph(0.014, 8, 6), c, { p: [mx + x, Y0 + 0.2, mz + 0.162], glow: c === 0x63c76b ? 1 : 0 });
  g.add(cyl(0.022, 0.022, 0.01, 12), 0x50616f, { p: [mx - 0.08, Y0 + 0.14, mz + 0.162], r: [PI / 2, 0, 0] });
  // ホッパー
  g.add(new THREE.CylinderGeometry(0.15, 0.07, 0.12, 4), METAL, { p: [mx - 0.04, Y0 + 0.39, mz - 0.02], r: [0, PI / 4, 0], flat: true });
  // リボンの糸巻き
  g.add(cyl(0.06, 0.06, 0.05, 16), 0xffd447, { p: [mx - 0.235, Y0 + 0.2, mz], r: [0, 0, PI / 2] });
  g.add(cyl(0.025, 0.025, 0.06, 10), WOOD_D, { p: [mx - 0.235, Y0 + 0.2, mz], r: [0, 0, PI / 2] });
  // コンベア（z 方向）
  const bx = 0.1;
  g.add(rbox(0.19, 0.05, 0.46, 0.015), 0x6e7681, { p: [bx, Y0 + 0.13, 0.04] });
  for (const z of [-0.14, 0.24]) for (const x of [-0.07, 0.07]) g.add(box(0.025, 0.12, 0.025), 0x555c66, { p: [bx + x, Y0 + 0.06, z] });
  g.add(cyl(0.03, 0.03, 0.19, 12), 0x9aa3ad, { p: [bx, Y0 + 0.145, 0.27], r: [0, 0, PI / 2] });
  // プレス機の腕
  g.add(rbox(0.06, 0.06, 0.2, 0.015), 0xd9792a, { p: [bx, Y0 + 0.4, -0.08] });
  g.add(rbox(0.04, 0.12, 0.04, 0.01), 0xd9792a, { p: [bx, Y0 + 0.36, -0.17] });
  pallet(g);
  const base = g.build();

  const belt = new Geo().add(box(0.15, 0.012, 0.42), 0x4a4f57, { p: [0, 0, 0] }).build();
  const press = new Geo()
    .add(cyl(0.012, 0.012, 0.12, 8), METAL, { p: [0, 0.06, 0] })
    .add(rbox(0.11, 0.035, 0.09, 0.01), 0x50616f, { p: [0, 0, 0] })
    .build();
  return finish(base, {
    belt: { geo: belt, mat: 'belt', pivot: [bx, Y0 + 0.16, 0.04], count: 1, shadow: false },
    press: { geo: press, mat: 'fx', pivot: [bx, Y0 + 0.26, 0.0], count: 1, shadow: true },
  }, 0.6, true);
}

function yarnMill(): BuildingModel {
  const g = new Geo();
  const cx = -0.08;
  const cz = -0.1;
  g.add(cyl(0.27, 0.29, 0.06, 18), STONE, { p: [cx, Y0 + 0.03, cz] });
  g.add(cyl(0.19, 0.245, 0.52, 18), 0xfde6ee, { p: [cx, Y0 + 0.06 + 0.26, cz] });
  g.add(cyl(0.222, 0.226, 0.035, 18), 0xe76fa3, { p: [cx, Y0 + 0.3, cz] });
  g.add(rbox(0.1, 0.16, 0.05, 0.03), 0x9a6340, { p: [cx, Y0 + 0.14, cz + 0.225] });
  g.add(cyl(0.042, 0.042, 0.02, 14), WHITE, { p: [cx, Y0 + 0.44, cz + 0.2], r: [PI / 2 - 0.12, 0, 0] });
  g.add(cyl(0.032, 0.032, 0.024, 14), 0xffd88a, { p: [cx, Y0 + 0.44, cz + 0.203], r: [PI / 2 - 0.12, 0, 0], glow: 0.9 });
  g.add(cone(0.27, 0.27, 18), 0xe76fa3, { p: [cx, Y0 + 0.58 + 0.135, cz] });
  g.add(sph(0.03, 8, 6), 0xffd447, { p: [cx, Y0 + 0.86, cz] });
  g.add(rbox(0.07, 0.07, 0.08, 0.02), 0xe76fa3, { p: [cx, Y0 + 0.6, cz + 0.2] });
  // ひつじ
  const sx = 0.27;
  const sz = -0.12;
  const fluff: V3[] = [[0, 0.13, 0], [0.04, 0.14, 0.03], [-0.04, 0.14, 0.02], [0.03, 0.15, -0.035], [-0.03, 0.13, -0.03], [0, 0.17, 0]];
  for (const [x, y, z] of fluff) g.add(sph(0.05, 10, 8), 0xffffff, { p: [sx + x, Y0 + y - 0.02, sz + z] });
  g.add(sph(1, 10, 8), 0x3d3330, { p: [sx, Y0 + 0.14, sz + 0.075], s: [0.03, 0.034, 0.035] });
  for (const e of [-1, 1]) {
    g.add(sph(1, 6, 5), 0x3d3330, { p: [sx + e * 0.035, Y0 + 0.15, sz + 0.07], s: [0.022, 0.01, 0.012], r: [0, 0, e * 0.4] });
    g.add(sph(0.006, 6, 4), 0xffffff, { p: [sx + e * 0.013, Y0 + 0.155, sz + 0.103] });
  }
  for (const [x, z] of [[-0.03, -0.03], [0.03, -0.03], [-0.03, 0.03], [0.03, 0.03]]) g.add(cyl(0.009, 0.009, 0.07, 6), 0x3d3330, { p: [sx + x, Y0 + 0.035, sz + z] });
  pallet(g);
  const base = g.build();

  const sails = new Geo();
  sails.add(sph(0.035, 10, 8), WOOD_D, {});
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * PI * 2 + 0.3;
    const dir = (r: number): V3 => [Math.sin(a) * r, Math.cos(a) * r, 0];
    sails.add(rbox(0.024, 0.34, 0.016, 0.006), WOOD, { p: dir(0.19), r: [0, 0, -a] });
    const off: V3 = [Math.cos(a) * 0.055, -Math.sin(a) * 0.055, 0];
    const c = dir(0.22);
    sails.add(rbox(0.09, 0.22, 0.008, 0.004), 0xfff6ee, { p: [c[0] + off[0], c[1] + off[1], 0.004], r: [0, 0, -a] });
    for (const k of [-1, 0, 1]) {
      const cc = dir(0.22 + k * 0.07);
      sails.add(box(0.09, 0.008, 0.012), 0xe76fa3, { p: [cc[0] + off[0], cc[1] + off[1], 0.006], r: [0, 0, -a] });
    }
  }
  return finish(base, { sails: { geo: sails.build(), mat: 'fx', pivot: [cx, Y0 + 0.6, cz + 0.255], count: 1, shadow: true } }, 1.02, true);
}

function knitter(): BuildingModel {
  const g = new Geo();
  const cx = -0.08;
  const cz = -0.12;
  g.add(rbox(0.5, 0.04, 0.4, 0.012), 0x6c5a8a, { p: [cx, Y0 + 0.02, cz] });
  g.add(rbox(0.46, 0.27, 0.34, 0.05), 0xc9b4ef, { p: [cx, Y0 + 0.17, cz] });
  g.add(rbox(0.5, 0.035, 0.38, 0.014), 0x7b4fb8, { p: [cx, Y0 + 0.31, cz] });
  g.add(rbox(0.3, 0.08, 0.02, 0.01), 0xeee4ff, { p: [cx + 0.03, Y0 + 0.22, cz + 0.172] });
  g.add(sph(0.016, 8, 6), 0xff6fae, { p: [cx - 0.16, Y0 + 0.25, cz + 0.172], glow: 1 });
  g.add(cyl(0.008, 0.008, 0.18, 6), WOOD_D, { p: [cx - 0.12, Y0 + 0.4, cz - 0.04] });
  // 編み上がったマフラー（前面から垂れて床に広がる）
  const cols = [0x8e5cc8, 0xf1e6ff];
  for (let k = 0; k < 5; k++) g.add(rbox(0.17, 0.05, 0.016, 0.006), cols[k % 2], { p: [cx + 0.03, Y0 + 0.17 - k * 0.04, cz + 0.18], r: [0.05, 0, 0] });
  for (let k = 0; k < 3; k++) g.add(rbox(0.17, 0.016, 0.05, 0.006), cols[(k + 1) % 2], { p: [cx + 0.03, Y0 + 0.008, cz + 0.205 + k * 0.045] });
  for (let k = 0; k < 5; k++) g.add(cyl(0.004, 0.004, 0.035, 4), 0xf1e6ff, { p: [cx - 0.04 + k * 0.035, Y0 + 0.006, cz + 0.36], r: [PI / 2, 0, 0] });
  // 毛糸かご
  g.add(cyl(0.07, 0.055, 0.06, 14), WOOD, { p: [0.25, Y0 + 0.03, -0.16] });
  g.put(itemGeo('yarn'), { p: [0.23, Y0 + 0.03, -0.17], s: 0.9 });
  g.put(itemGeo('yarn'), { p: [0.28, Y0 + 0.04, -0.13], s: 0.75, r: [0.4, 0, 0] });
  pallet(g);
  const base = g.build();

  const needle = new Geo()
    .add(cyl(0.009, 0.009, 0.42, 6), 0xd9dde3, { p: [0, 0, 0] })
    .add(sph(0.024, 8, 6), 0xff6fae, { p: [0, 0.21, 0] })
    .add(cone(0.009, 0.03, 6), 0xd9dde3, { p: [0, -0.225, 0], r: [PI, 0, 0] })
    .build();
  const ball = new Geo().put(itemGeo('yarn'), { p: [0, -0.05, 0], s: 1.5 }).build();
  const wheel = new Geo();
  wheel.add(torus(0.075, 0.012, 6, 20), 0x8e5cc8, { r: [0, PI / 2, 0] });
  for (let i = 0; i < 4; i++) wheel.add(box(0.012, 0.15, 0.012), 0xb7c2cc, { r: [(i / 4) * PI, 0, 0] });
  wheel.add(cyl(0.02, 0.02, 0.03, 10), 0x50616f, { r: [0, 0, PI / 2] });
  return finish(base, {
    needles: { geo: needle, mat: 'fx', pivot: [cx + 0.03, Y0 + 0.47, cz + 0.12], count: 2, rest: [0.5, 0, 0.55], shadow: true },
    ball: { geo: ball, mat: 'fx', pivot: [cx - 0.12, Y0 + 0.47, cz - 0.04], count: 1, shadow: true },
    wheel: { geo: wheel.build(), mat: 'fx', pivot: [cx + 0.245, Y0 + 0.16, cz - 0.02], count: 1, shadow: true },
  }, 0.72, true);
}

function workshop(): BuildingModel {
  const g = new Geo();
  const cx = -0.07;
  const cz = -0.11;
  g.add(rbox(0.6, 0.05, 0.5, 0.015), 0xe0b33a, { p: [cx, Y0 + 0.025, cz] });
  g.add(rbox(0.54, 0.38, 0.44, 0.04), 0xfff3e0, { p: [cx, Y0 + 0.05 + 0.19, cz] });
  g.add(rbox(0.56, 0.03, 0.46, 0.012), 0xe0b33a, { p: [cx, Y0 + 0.425, cz] });
  // マンサード屋根
  g.add(new THREE.CylinderGeometry(0.22, 0.33, 0.17, 4), 0x7a3e8e, { p: [cx, Y0 + 0.525, cz], r: [0, PI / 4, 0], s: [1.2, 1, 1.0], flat: true });
  g.add(rbox(0.36, 0.025, 0.3, 0.01), 0xe0b33a, { p: [cx, Y0 + 0.62, cz] });
  g.add(new THREE.OctahedronGeometry(0.05), 0xffd85a, { p: [cx, Y0 + 0.7, cz], s: [0.8, 1.2, 0.8], flat: true, glow: 0.5 });
  g.add(cyl(0.01, 0.01, 0.06, 6), 0xe0b33a, { p: [cx, Y0 + 0.64, cz] });
  // 扉とショーウィンドウ
  const fz = cz + 0.225;
  g.add(rbox(0.13, 0.21, 0.024, 0.02), 0x9b2335, { p: [cx, Y0 + 0.155, fz] });
  g.add(cyl(0.065, 0.065, 0.024, 16, ), 0x9b2335, { p: [cx, Y0 + 0.26, fz], r: [PI / 2, 0, 0] });
  g.add(sph(0.011, 6, 5), GOLD, { p: [cx + 0.04, Y0 + 0.15, fz + 0.015] });
  window(g, cx - 0.17, Y0 + 0.2, fz, 0.1, 0.13, 0xfff0b0, 0xe0b33a);
  window(g, cx + 0.17, Y0 + 0.2, fz, 0.1, 0.13, 0xfff0b0, 0xe0b33a);
  g.put(itemGeo('luxury'), { p: [cx - 0.17, Y0 + 0.14, fz - 0.03], s: 0.6 });
  // 赤い絨毯と鉢植え
  g.add(rbox(0.14, 0.012, 0.18, 0.004), 0xd23a4a, { p: [cx, Y0 + 0.006, fz + 0.1] });
  for (const sx of [-1, 1]) {
    g.add(cyl(0.032, 0.026, 0.05, 10), 0xc9774a, { p: [cx + sx * 0.12, Y0 + 0.025, fz + 0.07] });
    g.add(sph(0.042, 10, 8), 0x4fa75a, { p: [cx + sx * 0.12, Y0 + 0.085, fz + 0.07] });
  }
  pallet(g);
  const base = g.build();

  const bow = new Geo();
  for (const sx of [-1, 1]) {
    bow.add(torus(0.08, 0.026, 8, 18), 0xe8384f, { p: [sx * 0.085, 0.016, 0], r: [0, 0, sx * 0.35], s: [1, 0.72, 0.55] });
    bow.add(rbox(0.045, 0.14, 0.016, 0.007), 0xd92f45, { p: [sx * 0.045, -0.085, 0], r: [0, 0, sx * 0.35] });
  }
  bow.add(sph(0.038, 12, 10), 0xff5d72, { s: [1, 0.9, 0.7] });
  return finish(base, { bow: { geo: bow.build(), mat: 'fx', pivot: [cx, Y0 + 0.47, cz + 0.27], count: 1, shadow: true } }, 0.86, true);
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
  g.put(itemGeo('yarn'), { p: [0.23, Y0 + 0.25, 0.09] });
  g.put(itemGeo('gift'), { p: [-0.2, Y0 + 0.31, -0.18] });
  g.put(itemGeo('scarf'), { p: [0.15, Y0 + 0.31, -0.18] });
  // 木箱
  for (const [x, z, it] of [[-0.33, 0.37, 'fish'], [0.34, 0.37, 'yarn']] as [number, number, ItemId][]) {
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
  g.put(itemGeo('yarn'), { p: [bx - 0.08, Y0 + 0.2, bz + 0.02], s: 1.1 });
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

function finish(base: THREE.BufferGeometry, parts: Record<string, PartModel>, top: number, hasPallet: boolean, extra?: (g: Geo) => void): BuildingModel {
  const f = new Geo().put(base);
  for (const p of Object.values(parts)) {
    if (p.geo === parts.line?.geo) continue;
    f.put(p.geo, { p: p.pivot, r: p.rest });
    if (p.count === 2 && p.rest) f.put(p.geo, { p: p.pivot, r: [p.rest[0], p.rest[1], -p.rest[2]] });
  }
  extra?.(f);
  return { base, parts, full: f.build(), top, pallet: hasPallet };
}

const BUILDERS: Record<BuildingType, () => BuildingModel> = { fishing, cannery, packer, yarnMill, knitter, workshop, market, lab, bed, toybox, tower };

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
    head.add(cone(0.045, 0.085, 10), 0xffffff, { p: [sx * 0.068, 0.158, 0.028], r: [-0.12, 0, -sx * 0.38], s: [1, 1, 0.72], paint: fur(() => 0) });
    head.add(cone(0.027, 0.055, 8), 0xf4a9b8, { p: [sx * 0.064, 0.152, 0.046], r: [-0.12, 0, -sx * 0.38], s: [1, 1, 0.45], paint: fixed });
    for (let k = 0; k < 3; k++)
      head.add(box(0.075, 0.0028, 0.0028), 0xf2ede4, { p: [sx * 0.085, 0.043 + (k - 1) * 0.011, 0.118], r: [0, -sx * 0.25, sx * (k - 1) * 0.18], paint: fixed });
  }

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

  return { body, head: head.build(), leg, tail };
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
  // 糸車（回る輪は x 軸が車軸）と台
  const wheel = new Geo().add(torus(0.075, 0.008, 6, 22), 0xe76fa3, { r: [0, PI / 2, 0] });
  for (let i = 0; i < 3; i++) wheel.add(box(0.008, 0.15, 0.008), WOOD_L, { r: [(i / 3) * PI, 0, 0] });
  wheel.add(cyl(0.016, 0.016, 0.03, 10), WOOD_D, { r: [0, 0, PI / 2] });
  wheel.add(cyl(0.004, 0.004, 0.05, 5), WOOD_D, { p: [0, 0.055, 0.03], r: [0, 0, PI / 2] });
  const stand = new Geo()
    .add(rbox(0.05, 0.016, 0.14, 0.005), WOOD_D, { p: [0, 0.008, 0] })
    .add(box(0.012, 0.12, 0.012), WOOD, { p: [0.022, 0.07, 0] })
    .add(box(0.012, 0.12, 0.012), WOOD, { p: [-0.022, 0.07, 0] })
    .build();
  // 編み針（中心が原点）と編みかけのマフラー（上端が原点で -y に長さ 1）
  const needle = new Geo()
    .add(cyl(0.0045, 0.0045, 0.2, 6), 0xd9dde3, {})
    .add(sph(0.012, 8, 6), 0xff6fae, { p: [0, 0.1, 0] })
    .build();
  const strip = new Geo();
  for (let k = 0; k < 6; k++) strip.add(box(0.075, 1 / 6, 0.012), k % 2 ? 0xf1e6ff : 0x8e5cc8, { p: [0, -(k + 0.5) / 6, 0] });
  // リボン
  const bow = new Geo();
  for (const sx of [-1, 1]) {
    bow.add(torus(0.035, 0.011, 6, 14), 0xe8384f, { p: [sx * 0.037, 0.008, 0], r: [0, 0, sx * 0.35], s: [1, 0.72, 0.55] });
    bow.add(rbox(0.02, 0.06, 0.008, 0.003), 0xd92f45, { p: [sx * 0.02, -0.037, 0], r: [0, 0, sx * 0.35] });
  }
  bow.add(sph(0.017, 10, 8), 0xff5d72, { s: [1, 0.9, 0.7] });
  // フラスコ（底が原点）
  const flask = new Geo()
    .add(lathe([[0, 0], [0.042, 0], [0.045, 0.008], [0.02, 0.058], [0.013, 0.068], [0.013, 0.095], [0.017, 0.1]]), 0xd8f8ff, {})
    .add(lathe([[0, 0.003], [0.04, 0.003], [0.041, 0.009], [0.026, 0.036], [0, 0.036]]), 0x6fd85a, { glow: 0.9 })
    .build();
  return { rod, line, pot, ladle, wheel: wheel.build(), stand, needle, strip: strip.build(), bow: bow.build(), flask };
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
