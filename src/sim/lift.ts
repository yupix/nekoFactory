import { LIFT } from './data';
import { accepts, addStore, DIRS, inputSpace, isBroken, type Building, type GameState, type Lift } from './state';

/** 品と品の最小の間隔（1 タイルにフック 4 個） */
export const SPACING = 1 / LIFT.hooks;

/** リフトのつながり。lifts の並びの番号で持ち、配置かリフトが変わるまで使い回す */
export interface LiftGraph {
  lifts: Lift[];
  /** 次のリフトの番号（-1 なら終端） */
  next: Int32Array;
  /** 終端の先の建物（なければ詰まる） */
  end: (Building | undefined)[];
  /** 下流から上流への処理順（ループは最後にまとめる） */
  order: Int32Array;
  /** 建物 → その建物から離れる向きのリフト（出力を積む） */
  loaders: Map<Building, number[]>;
  /** この tick で処理済みか（ループの品が 2 回進まないように） */
  done: Uint32Array;
}

let stamp = 0;

export function buildLifts(s: GameState, byPos: (Building | undefined)[], size: number): LiftGraph {
  const h = size / 2;
  const lifts = s.lifts;
  const n = lifts.length;
  const at = new Int32Array(size * size).fill(-1);
  const inGrid = (x: number, y: number) => x >= -h && x < h && y >= -h && y < h;
  lifts.forEach((l, i) => inGrid(l.x, l.y) && (at[(l.y + h) * size + l.x + h] = i));
  const next = new Int32Array(n).fill(-1);
  const end: (Building | undefined)[] = new Array(n);
  const loaders = new Map<Building, number[]>();
  const feeders: number[][] = Array.from({ length: n }, () => []);
  lifts.forEach((l, i) => {
    const [dx, dy] = DIRS[l.d];
    const fx = l.x + dx;
    const fy = l.y + dy;
    if (inGrid(fx, fy)) {
      const j = at[(fy + h) * size + fx + h];
      // 向かい合ったリフトはつながない
      if (j >= 0) {
        const o = lifts[j];
        if (o.x + DIRS[o.d][0] !== l.x || o.y + DIRS[o.d][1] !== l.y) {
          next[i] = j;
          feeders[j].push(i);
        }
      } else end[i] = byPos[(fy + h) * size + fx + h];
    }
    const bx = l.x - dx;
    const by = l.y - dy;
    const b = inGrid(bx, by) ? byPos[(by + h) * size + bx + h] : undefined;
    if (b && b.type !== 'hq') {
      const list = loaders.get(b);
      if (list) list.push(i);
      else loaders.set(b, [i]);
    }
  });
  // 終端から上流へたどる（下流を先に動かすと、同じ tick で空いた分に詰められる）
  const order = new Int32Array(n);
  const seen = new Uint8Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (next[i] !== -1) continue;
    order[k++] = i;
    seen[i] = 1;
  }
  for (let q = 0; q < k; q++) for (const f of feeders[order[q]]) if (!seen[f]) (seen[f] = 1), (order[k++] = f);
  for (let i = 0; i < n; i++) if (!seen[i]) order[k++] = i;
  return { lifts, next, end, order, loaders, done: new Uint32Array(n) };
}

/** リフトの速さ（タイル/秒。ティア 2 で ×2、3 で ×4） */
export const liftSpeed = (l: Lift) => LIFT.speed * 2 ** (l.tier - 1);

/** 終端の建物が品を受け取れるか。受け取れたら入れる */
function unload(s: GameState, b: Building, k: Lift['items'][number]['k']) {
  if (isBroken(b) || !accepts(s, b, k) || inputSpace(s, b, k) <= 0) return false;
  if (b.type === 'hq') addStore(s, k, 1);
  else b.input[k] = (b.input[k] ?? 0) + 1;
  return true;
}

/** リフトの 1 tick: 建物から積み、品を進め、次のリフトか建物へ渡す */
export function liftTick(s: GameState, g: LiftGraph, dt: number) {
  const { lifts, next, end, order, done } = g;
  if (!lifts.length) return;
  const t = ++stamp >>> 0;
  // 建物の出力を 0.5 秒に 1 個、離れる向きのリフトへ順番に積む
  for (const [b, list] of g.loaders) {
    if (isBroken(b) || b.output <= 0 || !b.out) {
      b.lt = 0;
      continue;
    }
    b.lt = Math.min(LIFT.load, (b.lt ?? 0) + dt);
    if (b.lt < LIFT.load) continue;
    for (let k = 0; k < list.length; k++) {
      const r = ((b.rot ?? 0) + k) % list.length;
      const l = lifts[list[r]];
      const rear = l.items[l.items.length - 1];
      if (l.items.length >= LIFT.hooks || (rear && rear.p < SPACING)) continue;
      l.items.push({ k: b.out, p: 0, e: l.d });
      b.output--;
      b.lt = 0;
      b.rot = (r + 1) % list.length;
      break;
    }
  }
  for (let o = 0; o < order.length; o++) {
    const i = order[o];
    const l = lifts[i];
    done[i] = t;
    const items = l.items;
    if (!items.length) continue;
    const v = liftSpeed(l) * dt;
    const front = items[0];
    front.p += v;
    if (front.p >= 1) {
      const j = next[i];
      let passed = false;
      if (j >= 0) {
        const n = lifts[j];
        const enter = front.p - 1;
        const rear = n.items[n.items.length - 1];
        if (n.items.length < LIFT.hooks && (!rear || rear.p - enter >= SPACING)) {
          // まだ動かしていないリフト（ループ）へ渡すときは、そこで進む分を先に引いておく
          n.items.push({ k: front.k, p: done[j] === t ? enter : enter - liftSpeed(n) * dt, e: l.d });
          passed = true;
        }
      } else if (end[i]) passed = unload(s, end[i]!, front.k);
      if (passed) {
        items.shift();
        // 新しい先頭も進める（この tick では渡さない）
        if (items.length) items[0].p = Math.min(items[0].p + v, 1);
      } else front.p = 1;
    }
    for (let k = 1; k < items.length; k++) items[k].p = Math.min(items[k].p + v, items[k - 1].p - SPACING);
  }
}
