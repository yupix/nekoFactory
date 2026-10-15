import type { BuildingType, HandId, InfiniteId, ItemId, RecipeId, ResearchId } from './sim/data';
import { assignCat, buyResearch, cancelHand, expandIsland, hireCat, launchRobot, markCraftTip, placeBuilding, queueHand, placeLifts, removeBuilding, renameCat, repairAll, repairBuilding, setKeep, setRecipe, setSell, unassignCat, upgradeBuilding, upgradeLift, wakeCat, type GameState } from './sim/state';
import { tick, type GameEvent } from './sim/tick';
import { keepCat } from './sim/away';

/** sim を固定 10Hz でメインスレッドの外で回す（描画のフレームを止めないため） */
export type Action =
  | { kind: 'place'; type: BuildingType; x: number; y: number; recipe: RecipeId | null }
  | { kind: 'lifts'; tiles: { x: number; y: number; d: number }[] }
  | { kind: 'upgradeLift'; x: number; y: number; all: boolean }
  | { kind: 'recipe'; id: number; recipe: RecipeId | null }
  | { kind: 'sell'; item: ItemId; on: boolean; keep: number }
  | { kind: 'keep'; item: ItemId; n: number }
  | { kind: 'robot' }
  | { kind: 'remove'; x: number; y: number }
  | { kind: 'hire' }
  | { kind: 'research'; id: ResearchId | InfiniteId }
  | { kind: 'expand' }
  | { kind: 'wake'; id: number }
  | { kind: 'stay'; id: number }
  | { kind: 'assign'; cat: number; building: number }
  | { kind: 'unassign'; cat: number }
  | { kind: 'upgrade'; id: number }
  | { kind: 'rename'; id: number; name: string }
  | { kind: 'repair'; id: number }
  | { kind: 'repairAll' }
  | { kind: 'hand'; id: HandId; n: number }
  | { kind: 'handCancel'; i: number }
  | { kind: 'craftTip' };
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
      return placeBuilding(s, a.type, a.x, a.y, a.recipe);
    case 'lifts':
      return placeLifts(s, a.tiles);
    case 'upgradeLift':
      return upgradeLift(s, a.x, a.y, a.all);
    case 'recipe':
      return setRecipe(s, a.id, a.recipe);
    case 'sell':
      return setSell(s, a.item, a.on, a.keep);
    case 'keep':
      return setKeep(s, a.item, a.n);
    case 'robot':
      return launchRobot(s);
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
    case 'stay':
      return keepCat(s, a.id);
    case 'assign':
      return assignCat(s, a.cat, a.building);
    case 'unassign':
      return unassignCat(s, a.cat);
    case 'upgrade':
      return upgradeBuilding(s, a.id);
    case 'rename':
      return renameCat(s, a.id, a.name);
    case 'repair':
      return repairBuilding(s, a.id);
    case 'repairAll':
      return repairAll(s);
    case 'hand':
      return queueHand(s, a.id, a.n);
    case 'handCancel':
      return cancelHand(s, a.i);
    case 'craftTip':
      return markCraftTip(s);
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
