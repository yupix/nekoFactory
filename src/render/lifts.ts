import * as THREE from 'three';
import { LIFT, type ItemId } from '../sim/data';
import { buildLifts, liftSpeed, SPACING } from '../sim/lift';
import { DIRS, gridSize, type Building, type GameState } from '../sim/state';
import type { UiState } from './buildings';
import { Layer, type Items } from './layer';
import { toon } from './materials';
import { Geo, ITEM_H, LIFT_DIM, liftGeometries } from './models';

/** ティアごとの支柱の色 */
const TIER_COLOR = [0xd9a441, 0xe5484d, 0x4a8fe0];
const { hc: HC, r: R, tilt: TILT, hook: HOOK, line: LINE, arm: ARM_Y } = LIFT_DIM;
/** 前進ケーブルは滑車の中心より上で進行方向の右、戻りケーブルは下で左 */
const UPY = R * Math.cos(TILT);
const SIDE = R * Math.sin(TILT);
const HF = HC + UPY;
const HR = HC - UPY;
const ITEM_S = 0.85;
/** sim の 1 tick（秒）。描画は直近の状態から先へ進めて見せる */
const STEP = 0.1;
/** 積み降ろしアームの柱の、経路からの横のずれと動く長さ */
const ARM_SIDE = 0.18;
const ARM_T = 0.45;

const FROM = 1;
const TO = 2;
const LOAD = 4;
const UNLOAD = 8;

const P = new THREE.Vector3();
const TAN = new THREE.Vector3();
/** pathAt の結果が曲がり角の四分円か（1 右折、-1 左折、0 直線） */
let turn = 0;

/**
 * タイル（中心 cx, cz）を向き e で入り向き d へ出る経路上の点 P（xz）と接線 TAN。t は 0〜1。
 * from / to が false ならその端はタイルの中心（終端の支柱）
 */
function pathAt(cx: number, cz: number, e: number, d: number, from: boolean, to: boolean, t: number) {
  if (((e + 2) & 3) === d) from = false;
  const [dx, dz] = DIRS[d];
  const [ex, ez] = DIRS[e];
  if (from && to && e !== d) {
    // 曲がり角: タイルの角を中心とする半径 0.5 の四分円
    const kx = cx - ex * 0.5 + dx * 0.5;
    const kz = cz - ez * 0.5 + dz * 0.5;
    const th = (t * Math.PI) / 2;
    const c = Math.cos(th);
    const s = Math.sin(th);
    P.set(kx - dx * 0.5 * c + ex * 0.5 * s, 0, kz - dz * 0.5 * c + ez * 0.5 * s);
    TAN.set(dx * s + ex * c, 0, dz * s + ez * c);
    turn = d === ((e + 1) & 3) ? 1 : -1;
    return;
  }
  turn = 0;
  const ax = from ? cx - ex * 0.5 : cx;
  const az = from ? cz - ez * 0.5 : cz;
  const bx = to ? cx + dx * 0.5 : cx;
  const bz = to ? cz + dz * 0.5 : cz;
  P.set(ax + (bx - ax) * t, 0, az + (bz - az) * t);
  const len = Math.hypot(bx - ax, bz - az);
  if (len > 1e-6) TAN.set((bx - ax) / len, 0, (bz - az) / len);
  else TAN.set(dx, 0, dz);
}

const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
/** ティア（0 始まり）の速さ（タイル/秒、sim の liftSpeed と同じ） */
const speedOf = (k: number) => LIFT.speed * 2 ** k;

/** 吊り下げ式リフト: 支柱・滑車・2 本のケーブル・流れるフック・揺れながら運ばれる品・積み降ろしアーム。すべて InstancedMesh */
export function createLifts(parent: THREE.Object3D, items: Items, noAO: (o: THREE.Object3D) => void) {
  const geos = TIER_COLOR.map((c) => liftGeometries(c));
  const g0 = geos[0];
  const mat = toon({ vertexColors: true, glow: true, rim: 0.3 });
  const poles = geos.map((g) => new Layer(parent, g.pole, mat, 64, { shadow: true }));
  const posts = geos.map((g) => new Layer(parent, g.post, mat, 16, { shadow: true }));
  const yokes = new Layer(parent, g0.yoke, mat, 64, { shadow: true });
  const beams = new Layer(parent, g0.beam, mat, 64, { shadow: true });
  const cables = new Layer(parent, g0.cable, mat, 256, { shadow: false });
  const pulleys = new Layer(parent, g0.pulley, mat, 64, { shadow: true });
  const hooks = new Layer(parent, g0.hook, mat, 512, { shadow: false });
  const lines = new Layer(parent, g0.line, mat, 256, { shadow: false });
  const arms = new Layer(parent, g0.arm, mat, 16, { shadow: true });
  const ghostMat = toon({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, rim: 0.7, cloud: false });
  ghostMat.emissive.setHex(0x223a55);
  const ghostGeo = new Geo().put(g0.pole).put(g0.pulley, { p: [0, HC, 0] }).put(g0.yoke, { p: [0, HC, 0] }).build();
  const ghosts = new Layer(parent, ghostGeo, ghostMat, 8, { color: true, renderOrder: 5 });
  const arrows = new Layer(parent, g0.arrow, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }), 8, { color: true, renderOrder: 6 });
  for (const l of [ghosts, arrows]) noAO(l.mesh);

  // --- タイルごとの静的な情報（配置が変わったら作り直す） ---
  let n = 0;
  let cx = new Float32Array(0);
  let cz = new Float32Array(0);
  let dir = new Uint8Array(0);
  let ein = new Uint8Array(0);
  let flags = new Uint8Array(0);
  let tier = new Uint8Array(0);
  let next: Int32Array = new Int32Array(0);
  /** 滑車の向きの基底（x 軸・y 軸・z 軸）と中心。1 タイル 12 個 */
  let pb = new Float32Array(0);
  /** 直線タイルのケーブル: 前進の始点・終点、戻りの始点・終点（xz）と向き。曲がり角と孤立は lineOk = 0 */
  let seg = new Float32Array(0);
  let lineOk = new Uint8Array(0);
  // --- タイルごとの動く状態（作り直しでもタイルの位置で引き継ぐ） ---
  let keys = new Int32Array(0);
  let jam = new Float32Array(0);
  let off = new Float32Array(0);
  let swing = new Float32Array(0);
  let swingV = new Float32Array(0);
  let vPrev = new Float32Array(0);
  let armT = new Float32Array(0);
  let prevN = new Int16Array(0);
  /** ティアごとのフックの進み（タイル） */
  const phase = [0, 0, 0];

  let sig = NaN;
  let lastRef: unknown = null;

  const M = new THREE.Matrix4();
  const M2 = new THREE.Matrix4();
  const T = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const Z = new THREE.Vector3(0, 0, 1);
  const basis = new THREE.Matrix4();
  const bx = new THREE.Vector3();
  const by = new THREE.Vector3();
  const tint = new THREE.Color();
  const tileKey = (x: number, y: number) => (x + 512) * 1024 + y + 512;

  function segment(l: Layer, a: THREE.Vector3, b: THREE.Vector3) {
    v2.subVectors(b, a);
    const len = v2.length();
    if (len < 1e-5) return;
    q.setFromUnitVectors(Z, v2.multiplyScalar(1 / len));
    l.push(M.compose(a, q, sc.set(1, 1, len)));
  }

  /** ケーブルの点（前進 fwd は右上、戻りは左下） */
  function cablePoint(fwd: boolean, out: THREE.Vector3) {
    const k = fwd ? SIDE : -SIDE;
    return out.set(P.x - TAN.z * k, fwd ? HF : HR, P.z + TAN.x * k);
  }

  function rebuild(s: GameState) {
    const lifts = s.lifts;
    const size = gridSize(s);
    const h = size / 2;
    const byPos: (Building | undefined)[] = new Array(size * size);
    for (const b of s.buildings) if (b.x >= -h && b.x < h && b.y >= -h && b.y < h) byPos[(b.y + h) * size + b.x + h] = b;
    const g = buildLifts(s, byPos, size);
    const old = new Map<number, number>();
    for (let i = 0; i < n; i++) old.set(keys[i], i);
    const o = { jam, off, swing, swingV, vPrev, armT, prevN };
    n = lifts.length;
    cx = new Float32Array(n);
    cz = new Float32Array(n);
    dir = new Uint8Array(n);
    ein = new Uint8Array(n);
    flags = new Uint8Array(n);
    tier = new Uint8Array(n);
    next = g.next;
    pb = new Float32Array(n * 12);
    seg = new Float32Array(n * 10);
    lineOk = new Uint8Array(n);
    keys = new Int32Array(n);
    jam = new Float32Array(n);
    off = new Float32Array(n);
    swing = new Float32Array(n);
    swingV = new Float32Array(n);
    vPrev = new Float32Array(n);
    armT = new Float32Array(n).fill(-9);
    prevN = new Int16Array(n);
    const loader = new Uint8Array(n);
    for (const list of g.loaders.values()) for (const i of list) loader[i] = 1;
    // 主な入口: まっすぐ後ろから来るリフトを優先、なければ横から合流するもの
    const feed = new Int8Array(n).fill(-1);
    for (let i = 0; i < n; i++) {
      const j = next[i];
      if (j < 0) continue;
      if (feed[j] < 0 || lifts[i].d === lifts[j].d) feed[j] = lifts[i].d;
    }
    for (let i = 0; i < n; i++) {
      const l = lifts[i];
      cx[i] = l.x + 0.5;
      cz[i] = l.y + 0.5;
      dir[i] = l.d;
      tier[i] = Math.min(3, Math.max(1, l.tier)) - 1;
      ein[i] = feed[i] >= 0 ? feed[i] : l.d;
      flags[i] = (feed[i] >= 0 || loader[i] ? FROM : 0) | (next[i] >= 0 || g.end[i] ? TO : 0) | (loader[i] ? LOAD : 0) | (next[i] < 0 && g.end[i] ? UNLOAD : 0);
      keys[i] = tileKey(l.x, l.y);
      const k = old.get(keys[i]);
      vPrev[i] = speedOf(tier[i]);
      if (k !== undefined) {
        jam[i] = o.jam[k];
        off[i] = o.off[k];
        swing[i] = o.swing[k];
        swingV[i] = o.swingV[k];
        vPrev[i] = o.vPrev[k];
        armT[i] = o.armT[k];
        prevN[i] = o.prevN[k];
      }
    }

    // 静的な部品: 支柱・軸受け・腕木・ケーブル・アームの柱
    for (const l of [...poles, ...posts, yokes, beams, cables]) l.begin();
    for (let i = 0; i < n; i++) {
      const f = flags[i];
      const from = !!(f & FROM);
      const to = !!(f & TO);
      poles[tier[i]].push(M.makeTranslation(cx[i], 0, cz[i]));
      // 滑車は経路の中ほど、上側が右へ傾く
      pathAt(cx[i], cz[i], ein[i], dir[i], from, to, 0.5);
      bx.set(-TAN.z, 0, TAN.x);
      by.set(0, Math.cos(TILT), 0).addScaledVector(bx, Math.sin(TILT));
      bx.crossVectors(by, TAN);
      q.setFromRotationMatrix(basis.makeBasis(bx, by, TAN));
      pb.set([bx.x, bx.y, bx.z, by.x, by.y, by.z, TAN.x, TAN.y, TAN.z, P.x, HC, P.z], i * 12);
      yokes.push(M.compose(v.set(P.x, HC, P.z), q, one));
      v.set(P.x, HC, P.z).addScaledVector(by, -0.095);
      segment(beams, v2.set(cx[i], HC - 0.05, cz[i]).clone(), v);
      // 孤立したリフトは支柱だけ
      if (!from && !to) continue;
      const segs = from && to && ein[i] !== dir[i] ? 4 : 1;
      if (segs === 1) {
        lineOk[i] = 1;
        pathAt(cx[i], cz[i], ein[i], dir[i], from, to, 0);
        const o = i * 10;
        seg[o + 8] = TAN.x;
        seg[o + 9] = TAN.z;
        cablePoint(true, v);
        seg[o] = v.x;
        seg[o + 1] = v.z;
        cablePoint(false, v);
        seg[o + 4] = v.x;
        seg[o + 5] = v.z;
        pathAt(cx[i], cz[i], ein[i], dir[i], from, to, 1);
        cablePoint(true, v);
        seg[o + 2] = v.x;
        seg[o + 3] = v.z;
        cablePoint(false, v);
        seg[o + 6] = v.x;
        seg[o + 7] = v.z;
      }
      for (const fwd of [true, false]) {
        pathAt(cx[i], cz[i], ein[i], dir[i], from, to, 0);
        const a = cablePoint(fwd, new THREE.Vector3());
        for (let k = 1; k <= segs; k++) {
          pathAt(cx[i], cz[i], ein[i], dir[i], from, to, k / segs);
          const b = cablePoint(fwd, new THREE.Vector3());
          segment(cables, a, b);
          a.copy(b);
        }
      }
      // 積み降ろしアームの柱（建物との境目、経路の右）
      if (f & (LOAD | UNLOAD)) {
        const [dx, dz] = DIRS[dir[i]];
        const k = f & LOAD ? -0.5 : 0.5;
        posts[tier[i]].push(M.makeTranslation(cx[i] + dx * k - dz * ARM_SIDE, 0, cz[i] + dz * k + dx * ARM_SIDE));
      }
    }
    for (const l of [...poles, ...posts, yokes, beams, cables]) l.end();
  }

  const E = M.elements;
  /** M を y 軸まわりの回転（cos c, sin s）と平行移動にする */
  function yawAt(c: number, s: number, x: number, y: number, z: number) {
    E[0] = c; E[1] = 0; E[2] = -s; E[3] = 0;
    E[4] = 0; E[5] = 1; E[6] = 0; E[7] = 0;
    E[8] = s; E[9] = 0; E[10] = c; E[11] = 0;
    E[12] = x; E[13] = y; E[14] = z; E[15] = 1;
    return M;
  }

  /** 品を吊るす: フック・糸・品（i はタイル、t は経路の位置）。行列は向き・前後の揺れ・横の振れから直接組む */
  function hang(i: number, id: ItemId, e0: number, t: number, sway: number, now: number) {
    const f = flags[i];
    let sy: number;
    let cy: number;
    if (lineOk[i] && (e0 === ein[i] || !(f & FROM))) {
      // 直線: 前計算したケーブルの端点を補間
      const o = i * 10;
      v.set(seg[o] + (seg[o + 2] - seg[o]) * t, HF, seg[o + 1] + (seg[o + 3] - seg[o + 1]) * t);
      sy = seg[o + 8];
      cy = seg[o + 9];
      turn = 0;
    } else {
      pathAt(cx[i], cz[i], e0, dir[i], !!(f & FROM), !!(f & TO), t);
      cablePoint(true, v);
      sy = TAN.x;
      cy = TAN.z;
    }
    const sp = speedOf(tier[i]) * (1 - jam[i]);
    // 曲がり角では遠心力で外側へ振れる
    const roll = turn ? turn * Math.min(0.55, (0.12 * sp * sp) / 0.5) * Math.sin(Math.PI * t) : 0;
    const jig = jam[i] > 0.01 ? jam[i] * 0.05 * Math.sin(now * 22 + t * 9 + i) : 0;
    hooks.push(yawAt(cy, sy, v.x + sy * jig * 0.1, v.y, v.z + cy * jig * 0.1));
    const pitch = swing[i] + sway + jig;
    const cp = Math.cos(pitch);
    const spp = Math.sin(pitch);
    const cr = Math.cos(roll);
    const sr = Math.sin(roll);
    // R = Ry(yaw)·Rx(pitch)·Rz(roll) の列
    const r00 = cy * cr + sy * spp * sr;
    const r10 = cp * sr;
    const r20 = -sy * cr + cy * spp * sr;
    const r01 = -cy * sr + sy * spp * cr;
    const r11 = cp * cr;
    const r21 = sy * sr + cy * spp * cr;
    const r02 = sy * cp;
    const r12 = -spp;
    const r22 = cy * cp;
    const y0 = v.y - HOOK;
    E[0] = r00; E[1] = r10; E[2] = r20; E[3] = 0;
    E[4] = r01 * LINE; E[5] = r11 * LINE; E[6] = r21 * LINE; E[7] = 0;
    E[8] = r02; E[9] = r12; E[10] = r22; E[11] = 0;
    E[12] = v.x; E[13] = y0; E[14] = v.z; E[15] = 1;
    lines.push(M);
    const d = -LINE - ITEM_H[id] * ITEM_S;
    const k = ITEM_S;
    E[0] = r00 * k; E[1] = r10 * k; E[2] = r20 * k;
    E[4] = r01 * k; E[5] = r11 * k; E[6] = r21 * k;
    E[8] = r02 * k; E[9] = r12 * k; E[10] = r22 * k;
    E[12] = v.x + r01 * d; E[13] = y0 + r11 * d; E[14] = v.z + r21 * d;
    items.push(id, M);
  }

  return {
    update(s: GameState, dt: number, now: number, alpha: number, ui: UiState) {
      const lifts = s.lifts ?? [];
      if (lifts !== lastRef) {
        lastRef = lifts;
        let h = lifts.length * 7 + s.layoutVersion * 131 + s.buildings.length * 17 + gridSize(s) * 3;
        for (const l of lifts) h = (Math.imul(h, 31) + tileKey(l.x, l.y) * 16 + l.d * 4 + l.tier) | 0;
        if (h !== sig) {
          sig = h;
          rebuild(s);
        }
        // 積み降ろしの瞬間（前回の状態との品の数の差）
        for (let i = 0; i < n; i++) {
          const it = lifts[i].items;
          const c = it.length;
          if (flags[i] & LOAD && c > prevN[i] && it[c - 1].p < 0.45) armT[i] = now;
          if (flags[i] & UNLOAD && c < prevN[i]) armT[i] = now;
          prevN[i] = c;
        }
      }
      for (let k = 0; k < 3; k++) phase[k] = (phase[k] + speedOf(k) * dt) % 1024;
      for (const l of [pulleys, hooks, lines, arms, ghosts, arrows]) l.begin();
      const inv = dt > 1e-5 ? 1 / dt : 0;
      for (let i = 0; i < n && i < lifts.length; i++) {
        const l = lifts[i];
        const it = l.items;
        const f = flags[i];
        const speed = liftSpeed(l);
        // 詰まり: 先頭が出口で待っている
        const stuck = it.length > 0 && it[0].p >= 1 - 1e-6 ? 1 : 0;
        jam[i] += (stuck - jam[i]) * damp(stuck ? 6 : 3, dt);
        // フックの進み: 詰まっている間は止まり、動き出したら間隔にそろえる
        off[i] -= speed * dt * jam[i];
        if (jam[i] < 0.5) off[i] += (Math.round(off[i] / SPACING) * SPACING - off[i]) * damp(1.5, dt);
        const ph = phase[tier[i]] + off[i];
        // 振り子: 加速・減速で前後に揺れる
        const veff = speed * (1 - jam[i]);
        const acc = (veff - vPrev[i]) * inv;
        vPrev[i] = veff;
        swingV[i] += (-30 * swing[i] - 1.5 * swingV[i] + 1.2 * acc) * dt;
        swing[i] = THREE.MathUtils.clamp(swing[i] + swingV[i] * dt, -0.5, 0.5);
        // 滑車
        // 滑車: 基底 × x 軸まわりの回転
        const o = i * 12;
        const ang = (ph / R) % (Math.PI * 2);
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        E[0] = pb[o]; E[1] = pb[o + 1]; E[2] = pb[o + 2]; E[3] = 0;
        E[4] = pb[o + 3] * ca + pb[o + 6] * sa; E[5] = pb[o + 4] * ca + pb[o + 7] * sa; E[6] = pb[o + 5] * ca + pb[o + 8] * sa; E[7] = 0;
        E[8] = pb[o + 6] * ca - pb[o + 3] * sa; E[9] = pb[o + 7] * ca - pb[o + 4] * sa; E[10] = pb[o + 8] * ca - pb[o + 5] * sa; E[11] = 0;
        E[12] = pb[o + 9]; E[13] = pb[o + 10]; E[14] = pb[o + 11]; E[15] = 1;
        pulleys.push(M);
        if (!(f & (FROM | TO))) continue;
        // 品（描画は sim の直近の状態から少し先へ進める）
        const adv = alpha * STEP * speed;
        let prevP = Infinity;
        const fromF = !!(f & FROM);
        for (let k = 0; k < it.length; k++) {
          const item = it[k];
          let vp: number;
          if (k === 0) vp = stuck ? 1 : Math.min(item.p + adv, next[i] >= 0 ? 1 + adv : 1);
          else vp = Math.min(item.p + adv, prevP - SPACING);
          vp = Math.max(vp, item.p);
          prevP = vp;
          const sway = 0.035 * Math.sin(now * 2.6 + k * 1.7 + i * 0.37) * (1 - jam[i]);
          if (vp > 1 && next[i] >= 0 && next[i] < n) hang(next[i], item.k, dir[i], Math.min(1, vp - 1), sway, now);
          else hang(i, item.k, fromF ? item.e : dir[i], Math.min(1, vp), sway, now);
        }
        // 空のフック: 前進側は品のない所に、戻り側は逆向きに流れる
        const base = ((ph % SPACING) + SPACING) % SPACING;
        const jig = jam[i] * 0.06;
        for (let k = 0; k < 4; k++) {
          const p = base + k * SPACING;
          let busy = false;
          for (let j = 0; j < it.length && !busy; j++) busy = Math.abs(it[j].p - p) < SPACING / 2;
          const w = jig > 0.001 ? jig * 0.012 * Math.sin(now * 21 + k * 2.1 + i) : 0;
          if (lineOk[i]) {
            const o = i * 10;
            const tx = seg[o + 8];
            const tz = seg[o + 9];
            if (!busy) hooks.push(yawAt(tz, tx, seg[o] + (seg[o + 2] - seg[o]) * p + tx * w, HF, seg[o + 1] + (seg[o + 3] - seg[o + 1]) * p + tz * w));
            hooks.push(yawAt(tz, tx, seg[o + 6] + (seg[o + 4] - seg[o + 6]) * p - tx * w, HR, seg[o + 7] + (seg[o + 5] - seg[o + 7]) * p - tz * w));
            continue;
          }
          if (!busy) {
            pathAt(cx[i], cz[i], ein[i], dir[i], fromF, !!(f & TO), p);
            cablePoint(true, v);
            hooks.push(yawAt(TAN.z, TAN.x, v.x + TAN.x * w, v.y, v.z + TAN.z * w));
          }
          pathAt(cx[i], cz[i], ein[i], dir[i], fromF, !!(f & TO), 1 - p);
          cablePoint(false, v);
          hooks.push(yawAt(TAN.z, TAN.x, v.x - TAN.x * w, v.y, v.z - TAN.z * w));
        }
        // 積み降ろしアーム: ふだんは建物を向き、受け渡しの瞬間に経路の上へ振る（降ろせず詰まっている間は伸ばしたまま）
        if (f & (LOAD | UNLOAD)) {
          const [dx, dz] = DIRS[dir[i]];
          const kk = f & LOAD ? -0.5 : 0.5;
          const u = Math.min(1, Math.max(0, (now - armT[i]) / ARM_T));
          const reach = Math.max(Math.sin(u * Math.PI), f & UNLOAD ? jam[i] : 0);
          const restA = Math.atan2(-dz * Math.sign(kk), dx * Math.sign(kk));
          const toPath = Math.atan2(dx, dz);
          let da = toPath - restA;
          da = Math.atan2(Math.sin(da), Math.cos(da));
          const a = restA + da * reach + (f & UNLOAD ? jam[i] * 0.05 * Math.sin(now * 9 + i) : 0);
          arms.push(M.compose(v.set(cx[i] + dx * kk - dz * ARM_SIDE, ARM_Y, cz[i] + dz * kk + dx * ARM_SIDE), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, a), one));
        }
      }

      // 設置ゴースト: 支柱と、地面に向きの矢印
      if (ui.mode === 'lift') {
        tint.setHex(ui.canPlace ? 0xffffff : 0xff5a46);
        const ghost = (x: number, y: number, d: number, hover: boolean) => {
          const [dx, dz] = DIRS[d];
          const bob = hover ? 0.04 + Math.sin(now * 3) * 0.03 : 0.02;
          ghosts.color(ghosts.push(M.makeTranslation(x + 0.5, bob, y + 0.5)), tint);
          const slide = Math.sin(now * 4) * 0.06;
          q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.atan2(dx, dz));
          arrows.color(arrows.push(M.compose(v.set(x + 0.5 + dx * slide, 0.035, y + 0.5 + dz * slide), q, sc.setScalar(hover ? 1.15 : 1))), ui.canPlace ? tint.setHex(0x9ff0a0) : tint);
          tint.setHex(ui.canPlace ? 0xffffff : 0xff5a46);
        };
        const ht = ui.hoverTile;
        for (const t of ui.liftPath ?? []) ghost(t.x, t.y, t.d, false);
        if (ht && !(ui.liftPath ?? []).some((t) => t.x === ht.x && t.y === ht.y)) ghost(ht.x, ht.y, ui.liftDir & 3, true);
      }
      for (const l of [pulleys, hooks, lines, arms, ghosts, arrows]) l.end();
    },
  };
}
