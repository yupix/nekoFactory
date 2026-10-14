import { BUFFER_CAP, BUILDINGS, CAT_COLORS, CAT_NAMES, FACILITY, GOOD_BONUS, GRID, INFINITE, RESEARCH, STAT_IDS, STATS, TEMPERS, WORK_STAT, type BuildingType, type CatColor, type InfiniteId, type ItemId, type ResearchId, type StatId, type Temper } from './data';
import { bfs, occupancy } from './path';

export interface Building {
  id: number;
  type: BuildingType;
  x: number;
  y: number;
  input: Partial<Record<ItemId, number>>;
  output: number;
  /** 生産中の経過秒 */
  progress: number;
  running: boolean;
  /** ティア（1〜3） */
  tier: number;
}

/** 休憩の種類 */
export type Rest = 'sleep' | 'play';

export interface Cat {
  id: number;
  x: number;
  y: number;
  color: CatColor;
  state: 'idle' | 'toSource' | 'toDest';
  path: { x: number; y: number }[];
  item: ItemId | null;
  amount: number;
  src: number;
  dst: number;
  name: string;
  /** 元気（0〜1）。働くと減る */
  energy: number;
  rest: Rest | null;
  /** 休憩の残り秒 */
  restT: number;
  /** 仕事のない猫の休憩（仕事が来たら中断する） */
  lazy: boolean;
  /** 休んでいる（向かっている）休憩施設の id。0 ならその場 */
  restAt: number;
  /** 施設の中の位置 */
  slot: number;
  /** energy 1 を使い切るまでの秒数（個体差 40〜80） */
  stamina: number;
  /** 進行方向の左側へずれて歩く量の個体差（0.15〜0.3） */
  lane: number;
  /** 今の横ずれ（対向の猫がいると 0.4 まで広がる） */
  off: number;
  /** なめらかに補間した進行方向 */
  hx: number;
  hy: number;
  /** 最後に通った経路の点 */
  nx: number;
  ny: number;
  /** 出発までの待ち（秒） */
  wait: number;
  /** 建物の辺で待つ位置の予約（建物 id × 4 + 辺、0 なら無し）と、その辺での並び順 */
  spot: number;
  queue: number;
  /** 仕事が見つからなかったときの、次に探すまでの秒数 */
  retry: number;
  /** ステータス（各 0〜100） */
  stats: Record<StatId, number>;
  /** 得意・苦手なステータスと気質（雇用時に決まる） */
  good: StatId;
  bad: StatId;
  temper: Temper;
  /** 職人として配属された建物の id（0 は運び屋） */
  job: number;
  /** 職人が作業位置に着いて作業している */
  work: boolean;
  /** 職人の作業位置 */
  wx: number;
  wy: number;
}

export interface GameState {
  coins: number;
  rp: number;
  buildings: Building[];
  cats: Cat[];
  researched: ResearchId[];
  nextId: number;
  /** コイン獲得速度（/秒、時定数 60 秒の EMA） */
  incomeRate: number;
  tutorialDone: boolean;
  /** 島を広げた回数 */
  expansions: number;
  /** 無限研究のレベル */
  levels: Partial<Record<InfiniteId, number>>;
  /** 乱数の状態（テストを決定的にするため state に持つ） */
  seed: number;
  /** 建物の配置か島の広さが変わるたびに +1（sim の経路キャッシュを捨てる目印） */
  layoutVersion: number;
}

export function initialState(seed = 1): GameState {
  const s: GameState = { coins: 300, rp: 0, buildings: [], cats: [], researched: [], nextId: 1, incomeRate: 0, tutorialDone: false, expansions: 0, levels: {}, seed: seed >>> 0, layoutVersion: 0 };
  addCat(s);
  return s;
}

/** state の seed を進める決定的な乱数（mulberry32） */
export function rand(s: { seed: number }) {
  let t = (s.seed = (s.seed + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const has = (s: GameState, id: ResearchId) => s.researched.includes(id);
const count = (s: GameState, ids: ResearchId[]) => ids.filter((id) => has(s, id)).length;
export const level = (s: GameState, id: InfiniteId) => s.levels[id] ?? 0;

export const gridSize = (s: GameState) => Math.min(GRID.max, GRID.base + GRID.step * s.expansions);
export const catSpeed = (s: GameState) => 2 * (1 + 0.25 * count(s, ['speed1', 'speed2', 'speed3']) + 0.05 * level(s, 'speedInf'));
export const carryCap = (s: GameState) => 1 + count(s, ['cargo1', 'cargo2']) + Math.floor(level(s, 'cargoInf') / 5);
export const productionSpeed = (s: GameState) => 1 + 0.2 * count(s, ['eff1', 'eff2', 'eff3']) + 0.05 * level(s, 'effInf');
export const offlineMultiplier = (s: GameState) => (has(s, 'maneki') ? 2 : 1);
/** 市場の売値の倍率 */
export const tradeMultiplier = (s: GameState) => 1 + 0.05 * level(s, 'tradeInf');
/** 疲れる速さの倍率 */
export const fatigueRate = (s: GameState) => 0.8 ** count(s, ['motiv1', 'motiv2', 'motiv3']) * 0.95 ** level(s, 'motivInf');

/** ステータスの Lv（10 ごとに 1 上がる） */
export const statLevel = (v: number) => Math.floor(v / 10) + 1;
/** 猫ごとの速度（脚力で ×(1 + 値/200)） */
export const catSpeedOf = (s: GameState, c: Cat) => catSpeed(s) * (1 + c.stats.leg / 200);
/** 猫ごとの運搬量（力持ち 50 以上で +1、100 で +2） */
export const carryOf = (s: GameState, c: Cat) => carryCap(s) + (c.stats.str >= 100 ? 2 : c.stats.str >= 50 ? 1 : 0);
/** 職人 1 匹の生産速度の倍率（得意なステータスが効く建物ならさらに ×1.25） */
export function statBonus(c: Cat, type: BuildingType) {
  const st = WORK_STAT[type];
  if (!st) return 1;
  return (1 + c.stats[st] / 100) * (c.good === st ? GOOD_BONUS : 1);
}
/** 作業していて、生産ボーナスが効いている職人 */
export const isWorking = (c: Cat) => !!c.job && c.work && !c.rest;

// --- ティア ---
export const TIER_MAX = 3;
/** ティアを上げるのに要る研究 */
export const TIER_RESEARCH: Record<number, ResearchId> = { 2: 'tier2', 3: 'tier3' };
/** 入出力バッファの上限 */
export const bufferCap = (b: Building) => BUFFER_CAP + 5 * (b.tier - 1);
/** ティアによる生産速度の倍率（生産建物のみ。研究所は RP が増える） */
export const tierSpeed = (b: Building) => (WORK_STAT[b.type] && b.type !== 'lab' ? 1.5 ** (b.tier - 1) : 1);
/** 市場の売値の倍率 */
export const marketBonus = (b: Building) => 1 + 0.1 * (b.tier - 1);
/** 研究所の RP の倍率 */
export const labBonus = (b: Building) => 1 + 0.25 * (b.tier - 1);
/** 休憩施設の定員と回復の倍率 */
export const facilityCap = (b: Building) => (FACILITY[b.type]?.cap ?? 0) + b.tier - 1;
export const facilityRecover = (b: Building) => 1 + 0.25 * (b.tier - 1);
/** 配属できる職人の数 */
export const crafterCap = (b: Building) => (WORK_STAT[b.type] ? (b.tier >= 3 ? 2 : 1) : 0);
export const craftersOf = (s: GameState, b: Building) => s.cats.filter((c) => c.job === b.id);
/** 次のティアへの強化コスト（設置数によらない） */
export const upgradeCost = (b: Building) => BUILDINGS[b.type].cost * (b.tier === 1 ? 4 : 12);
/** これまでの強化に払ったコイン */
const upgradeSpent = (b: Building) => BUILDINGS[b.type].cost * (b.tier >= 3 ? 16 : b.tier === 2 ? 4 : 0);
/** 撤去したときの返金（最後に買った値段と強化分の 50%） */
export const refundOf = (s: GameState, b: Building) => Math.floor((Math.floor(BUILDINGS[b.type].cost * 1.15 ** (buildingCount(s, b.type) - 1)) + upgradeSpent(b)) * 0.5);
/** 強化できない理由。できるなら null */
export function upgradeBlocker(s: GameState, b: Building): string | null {
  if (b.tier >= TIER_MAX) return '最大ティアです';
  const r = TIER_RESEARCH[b.tier + 1];
  if (!has(s, r)) return `研究「${RESEARCH[r].name}」が必要です`;
  return s.coins < upgradeCost(b) ? 'コインが足りません' : null;
}

export const isUnlocked = (s: GameState, type: BuildingType) => {
  const u = BUILDINGS[type].unlock;
  return !u || has(s, u);
};
export const buildingCount = (s: GameState, type: BuildingType) => s.buildings.filter((b) => b.type === type).length;
export const buildingCost = (s: GameState, type: BuildingType) =>
  Math.floor(BUILDINGS[type].cost * 1.15 ** buildingCount(s, type));
export const hireCost = (s: GameState) =>
  Math.floor(100 * 1.5 ** s.cats.length * 0.7 ** count(s, ['herd1', 'herd2']));
export const expandCost = (s: GameState) => 500 * 2 ** s.expansions;
export const infiniteCost = (s: GameState, id: InfiniteId) => Math.floor(INFINITE[id].base * 1.6 ** level(s, id));
export const buildingAt = (s: GameState, x: number, y: number) => s.buildings.find((b) => b.x === x && b.y === y);
export const isInfinite = (id: string): id is InfiniteId => id in INFINITE;

/** 研究を買えない理由。買えるなら null */
export function researchBlocker(s: GameState, id: ResearchId | InfiniteId): string | null {
  if (isInfinite(id)) {
    const r = INFINITE[id];
    if (!has(s, r.req)) return `前提: ${RESEARCH[r.req].name}`;
    return s.rp < infiniteCost(s, id) ? 'RP 不足' : null;
  }
  const r = RESEARCH[id];
  if (has(s, id)) return '研究済み';
  if (r.req && !has(s, r.req)) return `前提: ${RESEARCH[r.req].name}`;
  if (s.rp < r.rp) return 'RP 不足';
  return null;
}

// --- アクション（失敗時はエラー文、成功時は null を返す） ---

export function placeBuilding(s: GameState, type: BuildingType, x: number, y: number): string | null {
  const h = gridSize(s) / 2;
  if (!isUnlocked(s, type)) return '未解放です';
  if (x < -h || x >= h || y < -h || y >= h) return '敷地の外です';
  if (buildingAt(s, x, y)) return 'すでに建物があります';
  const cost = buildingCost(s, type);
  if (s.coins < cost) return 'コインが足りません';
  s.coins -= cost;
  s.buildings.push({ id: s.nextId++, type, x, y, input: {}, output: 0, progress: 0, running: false, tier: 1 });
  s.layoutVersion++;
  if (type === 'market') s.tutorialDone = true;
  return null;
}

export function removeBuilding(s: GameState, x: number, y: number): string | null {
  const b = buildingAt(s, x, y);
  if (!b) return '建物がありません';
  // 返金は最後に買ったときの価格と強化分の 50%
  s.coins += refundOf(s, b);
  s.buildings.splice(s.buildings.indexOf(b), 1);
  s.layoutVersion++;
  // 配属されていた職人は運び屋に戻る
  for (const c of s.cats)
    if (c.job === b.id) {
      c.job = 0;
      c.work = false;
      if (!c.rest) c.path = [];
    }
  return null;
}

/** 建物のティアを 1 つ上げる */
export function upgradeBuilding(s: GameState, id: number): string | null {
  const b = s.buildings.find((x) => x.id === id);
  if (!b) return '建物がありません';
  const err = upgradeBlocker(s, b);
  if (err) return err;
  s.coins -= upgradeCost(b);
  b.tier++;
  return null;
}

/** 猫を職人として建物に配属する（別の建物の職人なら移る） */
export function assignCat(s: GameState, catId: number, buildingId: number): string | null {
  const c = s.cats.find((x) => x.id === catId);
  const b = s.buildings.find((x) => x.id === buildingId);
  if (!c || !b) return '見つかりません';
  if (!WORK_STAT[b.type]) return 'この建物には配属できません';
  if (c.job === b.id) return null;
  if (craftersOf(s, b).length >= crafterCap(b)) return '職人がいっぱいです';
  c.job = b.id;
  c.work = false;
  c.retry = 0;
  // 作業位置は着く前に選び直す（建物のタイルは作業位置にならない）
  c.wx = b.x;
  c.wy = b.y;
  if (c.state === 'idle' && !c.rest) c.path = [];
  return null;
}

/** 職人をはずして運び屋に戻す */
export function unassignCat(s: GameState, catId: number): string | null {
  const c = s.cats.find((x) => x.id === catId);
  if (!c?.job) return '職人ではありません';
  c.job = 0;
  c.work = false;
  if (c.state === 'idle' && !c.rest) c.path = [];
  return null;
}

export function hireCat(s: GameState): string | null {
  const cost = hireCost(s);
  if (s.coins < cost) return 'コインが足りません';
  s.coins -= cost;
  addCat(s);
  return null;
}

export function buyResearch(s: GameState, id: ResearchId | InfiniteId): string | null {
  const err = researchBlocker(s, id);
  if (err) return err;
  if (isInfinite(id)) {
    s.rp -= infiniteCost(s, id);
    s.levels[id] = level(s, id) + 1;
    return null;
  }
  s.rp -= RESEARCH[id].rp;
  s.researched.push(id);
  return null;
}

/** 島を 1 周（各辺 +2）広げる */
export function expandIsland(s: GameState): string | null {
  if (gridSize(s) >= GRID.max) return 'これ以上は広げられません';
  const cost = expandCost(s);
  if (s.coins < cost) return 'コインが足りません';
  s.coins -= cost;
  s.expansions++;
  s.layoutVersion++;
  return null;
}

/** 寝ている猫を起こす（撫でる）。元気 60% で仕事に戻る */
export function wakeCat(s: GameState, id: number): string | null {
  const c = s.cats.find((c) => c.id === id);
  if (!c || c.rest !== 'sleep') return '起きています';
  c.energy = Math.max(c.energy, 0.6);
  endRest(s, c);
  return null;
}

/** 休憩を終える。施設にいたなら、仕事の続きの経路を引き直す（届かなければ荷物は諦める） */
export function endRest(s: GameState, c: Cat) {
  const at = c.restAt;
  c.rest = null;
  c.restT = 0;
  c.lazy = false;
  c.restAt = 0;
  if (!at) return;
  c.path = [];
  if (c.state === 'idle') return;
  const t = s.buildings.find((b) => b.id === (c.state === 'toSource' ? c.src : c.dst));
  const size = gridSize(s);
  const path = t && bfs(size, occupancy(size, s.buildings), Math.round(c.x), Math.round(c.y)).path(t.x, t.y);
  if (path) c.path = path;
  else {
    c.state = 'idle';
    c.item = null;
    c.amount = 0;
  }
}

/** 施設の定員のうち、使っている（向かっている）猫の数 */
export const facilityUsers = (s: GameState, b: Building) => s.cats.filter((c) => c.restAt === b.id).length;
/** 職人ではない猫の数 */
export const carrierCount = (s: GameState) => s.cats.filter((c) => !c.job).length;
export const isFacility = (type: BuildingType) => !!FACILITY[type];

/** 名前・元気・歩き方の個性を決める（旧セーブの猫にも使う） */
export function initCat(s: GameState, c: Partial<Cat>) {
  c.name ??= CAT_NAMES[Math.floor(rand(s) * CAT_NAMES.length)];
  c.energy ??= 1;
  c.rest ??= null;
  if ((c.rest as string) === 'nap') c.rest = 'sleep';
  c.restT ??= 0;
  c.lazy ??= false;
  c.restAt ??= 0;
  c.slot ??= 0;
  c.stamina ??= 40 + rand(s) * 40;
  c.lane ??= 0.15 + rand(s) * 0.15;
  c.off ??= c.lane;
  c.hx ??= 1;
  c.hy ??= 0;
  c.nx ??= Math.round(c.x ?? 0);
  c.ny ??= Math.round(c.y ?? 0);
  c.wait ??= 0;
  c.spot ??= 0;
  c.queue ??= 0;
  c.retry ??= 0;
  if (!c.stats) {
    // 個性は seed と猫 id から決める（s.seed は進めないので、ほかの乱数の並びは変わらない）
    const r = { seed: (s.seed ^ Math.imul(c.id ?? 0, 0x9e3779b1)) >>> 0 };
    const gi = Math.floor(rand(r) * STAT_IDS.length);
    let bi = Math.floor(rand(r) * (STAT_IDS.length - 1));
    if (bi >= gi) bi++;
    c.good = STAT_IDS[gi];
    c.bad = STAT_IDS[bi];
    c.stats = Object.fromEntries(STAT_IDS.map((id) => [id, (id === c.good ? 20 : 0) + Math.floor(rand(r) * 16)])) as Record<StatId, number>;
    const t = rand(r);
    c.temper = t < 0.3 ? 'calm' : t < 0.6 ? 'diligent' : 'normal';
  }
  c.temper ??= 'normal';
  c.job ??= 0;
  c.work ??= false;
  c.wx ??= c.x ?? 0;
  c.wy ??= c.y ?? 0;
}

/** 「ミケ ・ 釣り好き ・ のんびり ・ 苦手: 研究」の個性の部分 */
export const traitText = (c: Cat) => `${STATS[c.good].trait} ・ ${TEMPERS[c.temper].name} ・ 苦手: ${STATS[c.bad].name}`;

function addCat(s: GameState) {
  const color = CAT_COLORS[Math.floor(rand(s) * CAT_COLORS.length)];
  const c: Partial<Cat> = { id: s.nextId++, x: 0, y: 0, color, state: 'idle', path: [], item: null, amount: 0, src: 0, dst: 0 };
  initCat(s, c);
  s.cats.push(c as Cat);
}
