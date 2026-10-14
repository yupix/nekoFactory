import type { BuildingType, InfiniteId, ResearchId } from './sim/data';
import { assignCat, buyResearch, expandIsland, hireCat, placeBuilding, removeBuilding, unassignCat, upgradeBuilding, wakeCat, type GameState } from './sim/state';
import { tick, type GameEvent } from './sim/tick';

/** sim を固定 10Hz でメインスレッドの外で回す（描画のフレームを止めないため） */
export type Action =
  | { kind: 'place'; type: BuildingType; x: number; y: number }
  | { kind: 'remove'; x: number; y: number }
  | { kind: 'hire' }
  | { kind: 'research'; id: ResearchId | InfiniteId }
  | { kind: 'expand' }
  | { kind: 'wake'; id: number }
  | { kind: 'assign'; cat: number; building: number }
  | { kind: 'unassign'; cat: number }
  | { kind: 'upgrade'; id: number };
export type ToWorker = { kind: 'init'; state: GameState } | { kind: 'act'; seq: number; action: Action } | { kind: 'pause'; paused: boolean };
export interface FromWorker {
  state: GameState;
  events: GameEvent[];
  /** 反映済みの最後のアクション番号 */
  acked: number;
  /** この通知までに進めた tick 数 */
  ticks: number;
  errors: string[];
}

const STEP = 0.1;
let s: GameState | null = null;
let acked = 0;
let acc = 0;
let last = performance.now();
let paused = false;
const errors: string[] = [];

function apply(a: Action) {
  if (!s) return null;
  switch (a.kind) {
    case 'place':
      return placeBuilding(s, a.type, a.x, a.y);
    case 'remove':
      return removeBuilding(s, a.x, a.y);
    case 'hire':
      return hireCat(s);
    case 'research':
      return buyResearch(s, a.id);
    case 'expand':
      return expandIsland(s);
    case 'wake':
      return wakeCat(s, a.id);
    case 'assign':
      return assignCat(s, a.cat, a.building);
    case 'unassign':
      return unassignCat(s, a.cat);
    case 'upgrade':
      return upgradeBuilding(s, a.id);
  }
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.kind === 'init') {
    s = m.state;
    last = performance.now();
  } else if (m.kind === 'act') {
    const err = apply(m.action);
    if (err) errors.push(err);
    acked = m.seq;
    post([], 0);
  } else {
    paused = m.paused;
    last = performance.now();
  }
};

function post(events: GameEvent[], ticks: number) {
  if (!s) return;
  (self as unknown as Worker).postMessage({ state: s, events, acked, ticks, errors: errors.splice(0) } satisfies FromWorker);
}

setInterval(() => {
  const now = performance.now();
  if (!s || paused) {
    last = now;
    return;
  }
  // 長時間止まっていた分は追いかけない（メインスレッド版と同じ 1 秒上限）
  acc = Math.min(acc + (now - last) / 1000, 1);
  last = now;
  if (acc < STEP) return;
  const events: GameEvent[] = [];
  let n = 0;
  while (acc >= STEP) {
    acc -= STEP;
    events.push(...tick(s, STEP));
    n++;
  }
  post(events, n);
}, 10);
