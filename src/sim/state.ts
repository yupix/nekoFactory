import { AMMO_CAP, BUFFER_CAP, BUILDINGS, CAT_COLORS, CAT_NAMES, DEPOSIT, FACILITY, GOOD_BONUS, GRID, HAND, HAND_QUEUE, INFINITE, ITEM_IDS, ITEMS, KEEP, LIFT, MULTI_RECIPE, ORES, RAID, RECIPE_IDS, RECIPES, RECIPES_OF, RESEARCH, ROBOT, RUNAWAY, START_STORE, STAT_IDS, STATS, STORE, SUPPLY, TEMPERS, WEAPONS, WORK_STAT, type BuildingType, type CatColor, type Cost, type DogKind, type HandId, type InfiniteId, type ItemId, type OreId, type RecipeId, type ResearchId, type StatId, type Temper } from './data';
import { bfs, occupancy } from './path';

export interface Building {
  id: number;
  type: BuildingType;
  x: number;
  y: number;
  input: Partial<Record<ItemId, number>>;
  /** 出力バッファの量と、その品（採掘機は鉱床の鉱石） */
  output: number;
  out: ItemId | null;
  /** 固定したレシピ（null は自動） */
  recipe: RecipeId | null;
  /** 生産中のレシピ */
  cur: RecipeId | null;
  /** 生産中の経過秒（市場は売却の進み） */
  progress: number;
  running: boolean;
  /** ティア（1〜3） */
  tier: number;
  /** 耐久。0 で故障（生産・運搬・発射が止まる） */
  hp: number;
  /** プレイヤーが止めた（生産せず、材料も受け取らない。出力は運び出す） */
  off?: boolean;
  /** 兵器の次の発射までの秒数 */
  cd?: number;
  /** リフトへ積む間隔の経過秒と、次に積むリフトの順番（市場は次に売る品の順番） */
  lt?: number;
  rot?: number;
}

/** リフトに吊られた品。p はタイルの中の進み（0 入口〜1 出口）、e は入ってきたときの進む向き */
export interface LiftItem {
  k: ItemId;
  p: number;
  e: number;
}
/** 吊り下げ式リフトのタイル。d は向き（0 +x, 1 +y, 2 −x, 3 −y）。items は先頭（p が大きい）から */
export interface Lift {
  x: number;
  y: number;
  d: number;
  tier: number;
  items: LiftItem[];
}
export const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;

/** 鉱床のタイル */
export interface Ore {
  x: number;
  y: number;
  k: OreId;
}

export interface Dog {
  id: number;
  kind: DogKind;
  x: number;
  y: number;
  hx: number;
  hy: number;
  hp: number;
  max: number;
  /** 毎秒のダメージ */
  atk: number;
  /** タイル/秒 */
  speed: number;
  /** land: 船から敷地へ / walk: 標的へ / bite: 噛んでいる / retreat: 船へ戻る */
  state: 'land' | 'walk' | 'bite' | 'retreat';
  path: { x: number; y: number }[];
  /** 標的の建物 id */
  target: number;
  boat: number;
  /** 敷地に入るタイル */
  ex: number;
  ey: number;
  /** 経路を引いたときの layoutVersion */
  ver: number;
  /** 次に標的を探すまでの秒数 */
  wait: number;
}

export interface Boat {
  id: number;
  /** 接岸する位置と、本部から見た向き（沖はこの向き） */
  x: number;
  y: number;
  dx: number;
  dy: number;
  /** 状態に入ってからの秒数 */
  t: number;
  state: 'in' | 'dock' | 'out';
  /** まだ降りていない犬 */
  cargo: Dog[];
}

/** 飛んでいる弾。着弾で dmg を与える（大砲は範囲） */
export interface Shot {
  id: number;
  type: BuildingType;
  x: number;
  y: number;
  tx: number;
  ty: number;
  /** 追いかける犬（大砲は 0: 撃った時点の位置に落ちる） */
  dog: number;
  t: number;
  dur: number;
  dmg: number;
}

export interface Raid {
  wave: number;
  /** 上陸からの秒数 */
  t: number;
  landed: boolean;
  dogs: Dog[];
  boats: Boat[];
  shots: Shot[];
  /** 決着（clear 全滅・retreat 時間切れ・lost 本部が壊れた）。残りの犬は船へ戻る */
  result: 'clear' | 'retreat' | 'lost' | null;
  nextId: number;
  /** この襲撃の総数 */
  total: number;
}

export interface RaidState {
  /** 次の襲撃までの秒数（sim が進んでいる間だけ減る） */
  next: number;
  /** これまでのウェーブ数 */
  wave: number;
  /** 初回襲撃の前のチュートリアルを出したか */
  tip: boolean;
  cur: Raid | null;
}

/** 休憩の種類（charge はロボ猫の充電） */
export type Rest = 'sleep' | 'play' | 'charge';

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
  /** 犬から逃げている残り秒 */
  flee: number;
  /** ロボ猫（運び屋専用。energy をバッテリーとして使う） */
  robot: boolean;
  /** 家出の最中（null・なしは家にいる） */
  away?: Away | null;
  /** 引き止められてから家出しない残り秒 */
  stay?: number;
}

/**
 * 家出の進み。walk: 外周のタイルへ歩く / beach: 浜を海へ / raft: いかだで沖へ / swim: 引き止められて泳いで岸へ / back: 浜から島へ戻る。
 * (ex, ey) は外周のタイル、(dx, dy) は外向きの向き、job は職人だったときの配属先
 */
export interface Away {
  phase: 'walk' | 'beach' | 'raft' | 'swim' | 'back';
  ex: number;
  ey: number;
  dx: number;
  dy: number;
  job: number;
}

/** 家出の全体の状態: 次に起きうるまでの秒数（新規開始の 10 分と 1 件ごとの 2 分）、乱数の種（ほかの乱数の並びを変えない）、去った猫の名前（新しい順に 3 件まで） */
export interface RunawayState {
  cd: number;
  seed: number;
  gone: string[];
}
export const newRunaway = (seed: number): RunawayState => ({ cd: RUNAWAY.start, seed: (seed ^ 0x2545f491) >>> 0, gone: [] });

/** 本部の手作業のキュー（先頭から 1 個ずつ作る。材料は追加したときに払う）と、先頭の 1 個の経過秒 */
export interface HandState {
  q: { id: HandId; n: number }[];
  t: number;
}
export const newHand = (): HandState => ({ q: [], t: 0 });

export interface GameState {
  coins: number;
  rp: number;
  buildings: Building[];
  cats: Cat[];
  researched: ResearchId[];
  nextId: number;
  /** コイン獲得速度（/秒、時定数 60 秒の EMA） */
  incomeRate: number;
  /** チュートリアルの段階（TUTORIAL.length で完了） */
  tut: number;
  /** 島を広げた回数 */
  expansions: number;
  /** 無限研究のレベル */
  levels: Partial<Record<InfiniteId, number>>;
  /** 乱数の状態（テストを決定的にするため state に持つ） */
  seed: number;
  /** 建物の配置か島の広さが変わるたびに +1（sim の経路キャッシュを捨てる目印） */
  layoutVersion: number;
  /** レシピ・研究・リフトが変わるたびに +1（運搬の候補とリフトのつながりを作り直す目印） */
  rev: number;
  raid: RaidState;
  /** 本部の倉庫の在庫 */
  store: Partial<Record<ItemId, number>>;
  /** 市場で売る品と、残す量（この数より多い分だけ売る） */
  sell: Partial<Record<ItemId, number>>;
  /** 本部から機械へ出さずに残す数（確保数。ない品は keepOf の既定） */
  keep: Partial<Record<ItemId, number>>;
  ores: Ore[];
  /** 鉱床を作る乱数の種（state の seed とは別。拡張のたびに同じ種から外周を作る） */
  oreSeed: number;
  lifts: Lift[];
  runaway: RunawayState;
  hand: HandState;
  /** 「歯車が足りないときは本部で手作りできる」を出したか */
  craftTip: boolean;
}

/** チュートリアルの段階: 建てる建物か、作る品か、RP */
export const TUTORIAL: ({ build: BuildingType } | { make: ItemId } | { rp: true })[] = [{ build: 'miner' }, { make: 'ironPlate' }, { make: 'gear' }, { rp: true }];
export const tutorialDone = (s: GameState) => s.tut >= TUTORIAL.length;

export const newRaidState = (): RaidState => ({ next: RAID.first, wave: 0, tip: false, cur: null });

export function initialState(seed = 1): GameState {
  const s: GameState = {
    coins: 300, rp: 0, buildings: [], cats: [], researched: [], nextId: 1, incomeRate: 0, tut: 0, expansions: 0, levels: {}, seed: seed >>> 0, layoutVersion: 0, rev: 0,
    raid: newRaidState(), store: { ...START_STORE }, sell: {}, keep: {}, ores: [], oreSeed: seed >>> 0, lifts: [], runaway: newRunaway(seed), hand: newHand(), craftTip: false,
  };
  addCat(s);
  addCat(s);
  placeHq(s);
  genOres(s, 0, gridSize(s));
  return s;
}

/**
 * 鉱床を作る: 一辺 from の正方形の外側から一辺 to までの帯に、種類ごとに塊を置く（from 0 は初期範囲で 2〜3 個、拡張の外周は 1 個）。
 * 乱数は oreSeed と to から作るので、同じ島はいつも同じ鉱床になる
 */
export function genOres(s: GameState, from: number, to: number) {
  const r = { seed: (s.oreSeed ^ Math.imul(to + 1, 0x9e3779b1)) >>> 0 };
  const hf = from / 2;
  const ht = to / 2;
  const taken = new Set(s.ores.map((o) => o.x * 1000 + o.y));
  const inBand = (x: number, y: number) => x >= -ht && x < ht && y >= -ht && y < ht && !(x >= -hf && x < hf && y >= -hf && y < hf) && Math.max(Math.abs(x), Math.abs(y)) > DEPOSIT.keep;
  for (const k of ORES) {
    const n = from ? 1 : DEPOSIT.clusters[0] + Math.floor(rand(r) * (DEPOSIT.clusters[1] - DEPOSIT.clusters[0] + 1));
    for (let c = 0; c < n; c++) {
      // 帯の中の空いたタイルから始め、隣へ広げる
      let sx = 0;
      let sy = 0;
      let ok = false;
      for (let t = 0; t < 200 && !ok; t++) {
        sx = Math.floor(rand(r) * to) - ht;
        sy = Math.floor(rand(r) * to) - ht;
        ok = inBand(sx, sy) && !taken.has(sx * 1000 + sy);
      }
      if (!ok) continue;
      const size = DEPOSIT.size[0] + Math.floor(rand(r) * (DEPOSIT.size[1] - DEPOSIT.size[0] + 1));
      const cells = [{ x: sx, y: sy }];
      taken.add(sx * 1000 + sy);
      for (let t = 0; t < size * 12 && cells.length < size; t++) {
        const b = cells[Math.floor(rand(r) * cells.length)];
        const [dx, dy] = DIRS[Math.floor(rand(r) * 4)];
        const x = b.x + dx;
        const y = b.y + dy;
        if (!inBand(x, y) || taken.has(x * 1000 + y)) continue;
        taken.add(x * 1000 + y);
        cells.push({ x, y });
      }
      for (const p of cells) s.ores.push({ x: p.x, y: p.y, k });
    }
  }
}
export const oreAt = (s: GameState, x: number, y: number) => s.ores.find((o) => o.x === x && o.y === y)?.k ?? null;

/** 中心に本部を置く。中心にほかの建物があれば最寄りの空きタイルへ移す */
export function placeHq(s: GameState) {
  if (s.buildings.some((b) => b.type === 'hq')) return;
  const at = buildingAt(s, 0, 0);
  if (at) {
    const h = gridSize(s) / 2;
    let best: { x: number; y: number } | null = null;
    for (let r = 1; !best && r < h * 2; r++)
      for (let dy = -r; dy <= r && !best; dy++)
        for (const dx of [-(r - Math.abs(dy)), r - Math.abs(dy)]) {
          const x = dx;
          const y = dy;
          if (x >= -h && x < h && y >= -h && y < h && !buildingAt(s, x, y)) {
            best = { x, y };
            break;
          }
        }
    if (best) Object.assign(at, best);
  }
  const b = newBuilding(s, 'hq', 0, 0);
  s.buildings.push(b);
  s.layoutVersion++;
}

function newBuilding(s: GameState, type: BuildingType, x: number, y: number, recipe: RecipeId | null = null): Building {
  const b: Building = { id: s.nextId++, type, x, y, input: {}, output: 0, out: null, recipe, cur: null, progress: 0, running: false, tier: 1, hp: 0 };
  b.hp = maxHp(s, b);
  return b;
}

/** state の seed を進める決定的な乱数（mulberry32） */
export function rand(s: { seed: number }) {
  let t = (s.seed = (s.seed + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const has = (s: GameState, id: ResearchId) => s.researched.includes(id);
const count = (s: GameState, ids: ResearchId[]) => ids.filter((id) => has(s, id)).length;
export const level = (s: GameState, id: InfiniteId) => s.levels[id] ?? 0;

export const gridSize = (s: GameState) => Math.min(GRID.max, GRID.base + GRID.step * s.expansions);

// --- 本部の倉庫と資材 ---
/** アイテムごとの倉庫の容量（倉庫 1 棟で +200） */
export const storeCap = (s: GameState) => STORE.base + STORE.per * buildingCount(s, 'warehouse');
export const stock = (s: GameState, id: ItemId) => s.store[id] ?? 0;
/** 本部の確保数（弾薬・研究パックは既定 0、ほかは 10） */
export const keepOf = (s: GameState, id: ItemId) => s.keep[id] ?? (SUPPLY.includes(id) ? 0 : KEEP);
/** 資材の不足分（足りていれば空） */
export function missing(s: GameState, cost: Cost, mult = 1): Cost {
  const out: Cost = {};
  for (const id of Object.keys(cost) as ItemId[]) {
    const need = cost[id]! * mult - stock(s, id);
    if (need > 0) out[id] = need;
  }
  return out;
}
export const canAfford = (s: GameState, cost: Cost, mult = 1) => Object.keys(missing(s, cost, mult)).length === 0;
function pay(s: GameState, cost: Cost, mult = 1) {
  for (const id of Object.keys(cost) as ItemId[]) s.store[id] = stock(s, id) - cost[id]! * mult;
}
/** 倉庫へ入れる（容量を超える分は切り捨て。すでに超えていれば減らさない） */
export function addStore(s: GameState, id: ItemId, n: number) {
  const have = stock(s, id);
  s.store[id] = Math.max(have, Math.min(storeCap(s), have + n));
}
export function give(s: GameState, cost: Cost, mult = 1) {
  for (const id of Object.keys(cost) as ItemId[]) addStore(s, id, Math.floor(cost[id]! * mult));
}
/** 資材の一覧の文（「鉄板 6・歯車 3」） */
export const costText = (cost: Cost, mult = 1) => (Object.keys(cost) as ItemId[]).map((id) => `${ITEMS[id].name} ${cost[id]! * mult}`).join('・');
/** 資材の売値の合計（修理費の基準） */
const costValue = (cost: Cost) => (Object.keys(cost) as ItemId[]).reduce((a, id) => a + ITEMS[id].value * cost[id]!, 0);
export const catSpeed = (s: GameState): number => 2 * (1 + 0.25 * count(s, ['speed1', 'speed2', 'speed3']) + 0.05 * level(s, 'speedInf'));
export const carryCap = (s: GameState) => 1 + count(s, ['cargo1', 'cargo2']) + Math.floor(level(s, 'cargoInf') / 5);
export const productionSpeed = (s: GameState) => 1 + 0.2 * count(s, ['eff1', 'eff2', 'eff3']) + 0.05 * level(s, 'effInf');
export const offlineMultiplier = (s: GameState) => (has(s, 'maneki') ? 2 : 1);
/** 市場の売値の倍率（交渉∞） */
export const tradeMultiplier = (s: GameState) => 1 + 0.05 * level(s, 'tradeInf');
/** 疲れる速さの倍率 */
export const fatigueRate = (s: GameState) => 0.8 ** count(s, ['motiv1', 'motiv2', 'motiv3']) * 0.95 ** level(s, 'motivInf');
/** 家出の発生率の研究による倍率（居心地 −30% ずつ、首輪∞ −5%/Lv） */
export const awayResearch = (s: GameState) => 0.7 ** count(s, ['comfort1', 'comfort2', 'comfort3']) * 0.95 ** level(s, 'collarInf');
/** 猫ごとの家出しやすさ（元気が減るほど上がり、気質で変わる。研究は含まない） */
export const awayMood = (c: Cat) => (1 + 2 * (1 - c.energy)) * TEMPERS[c.temper].away;
/** 家出の発生率の倍率（基本の 0.4%/分 に掛ける） */
export const awayRate = (s: GameState, c: Cat) => awayMood(c) * awayResearch(s);
/** ごきげん（家出のしやすさの目安）: 高・中・低 */
export const moodOf = (c: Cat): 'high' | 'mid' | 'low' => {
  const m = awayMood(c);
  return m < 1.6 ? 'high' : m < 2.4 ? 'mid' : 'low';
};
export const MOOD_NAME = { high: '高', mid: '中', low: '低' } as const;
/** 家出しようとしている（引き止められる）猫 */
export const isLeaving = (c: Cat) => !!c.away && c.away.phase !== 'swim' && c.away.phase !== 'back';

// --- 耐久と兵器 ---
export const isWeapon = (type: BuildingType) => !!WEAPONS[type];
/** 種類ごとの最大 HP の基本値 */
export function hpBase(type: BuildingType) {
  if (type === 'hq') return 500;
  if (type === 'fence') return 300;
  if (isWeapon(type)) return 150;
  if (FACILITY[type]) return 60;
  if (type === 'market' || type === 'lab') return 120;
  return 100;
}
/** 最大 HP（基本値 × ティア、研究「頑丈」で増える） */
export const maxHp = (s: GameState, b: Building) => hpBase(b.type) * b.tier * (1 + 0.25 * count(s, ['sturdy1', 'sturdy2', 'sturdy3']) + 0.05 * level(s, 'sturdyInf'));
export const isBroken = (b: Building) => b.hp <= 0;
/** 修理費のコイン（全快で 建設資材の売値の合計 × 0.3 × ティア、減った HP の割合ぶん。研究「格安修理」で −30%） */
export function repairCost(s: GameState, b: Building) {
  const max = maxHp(s, b);
  if (b.hp >= max) return 0;
  return Math.ceil(costValue(BUILDINGS[b.type].cost) * 0.3 * b.tier * (has(s, 'cheapRepair') ? 0.7 : 1) * (1 - Math.max(0, b.hp) / max));
}
/** 兵器の射程とダメージ（ティア 2 で +1・×1.5、ティア 3 で +2・×2.25、火力∞ で +5%） */
export const weaponRange = (b: Building) => WEAPONS[b.type]!.range + b.tier - 1;
export const weaponDamage = (s: GameState, b: Building) => WEAPONS[b.type]!.dmg * 1.5 ** (b.tier - 1) * (1 + 0.05 * level(s, 'fireInf'));
/** 最大 HP が変わる操作の前後で、壊れていない建物は増えた分だけ HP を足す */
function keepHp(s: GameState, run: () => void) {
  const before = s.buildings.map((b) => maxHp(s, b));
  run();
  s.buildings.forEach((b, i) => {
    if (b.hp > 0) b.hp = Math.max(1, b.hp + maxHp(s, b) - before[i]);
  });
}

/** ステータスの Lv（10 ごとに 1 上がる） */
export const statLevel = (v: number) => Math.floor(v / 10) + 1;
/** 猫ごとの速度（脚力で ×(1 + 値/200)、ロボ猫は ×1.5） */
export const catSpeedOf = (s: GameState, c: Cat) => catSpeed(s) * (c.robot ? ROBOT.speed : 1 + c.stats.leg / 200);
/** 猫ごとの運搬量（力持ち 50 以上で +1、100 で +2。ロボ猫は +2） */
export const carryOf = (s: GameState, c: Cat) => carryCap(s) + (c.robot ? ROBOT.carry : c.stats.str >= 100 ? 2 : c.stats.str >= 50 ? 1 : 0);
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
/** 入出力バッファの上限（兵器の弾は 20） */
export const bufferCap = (b: Building) => (isWeapon(b.type) ? AMMO_CAP : BUFFER_CAP + 5 * (b.tier - 1));
/** ティアによる生産速度の倍率（生産建物のみ。研究所は RP が増える） */
export const tierSpeed = (b: Building) => (RECIPES_OF[b.type] ? 1.5 ** (b.tier - 1) : 1);
/** 市場が 1 秒に売る数（ティア 2 で 2、3 で 4） */
export const marketRate = (b: Building) => 2 ** (b.tier - 1);
/** 研究所の RP の倍率 */
export const labBonus = (b: Building) => 1 + 0.25 * (b.tier - 1);
/** 休憩施設の定員と回復の倍率 */
export const facilityCap = (b: Building) => (FACILITY[b.type]?.cap ?? 0) + b.tier - 1;
export const facilityRecover = (b: Building) => 1 + 0.25 * (b.tier - 1);
/** 配属できる職人の数 */
export const crafterCap = (b: Building) => (isWeapon(b.type) ? 1 : WORK_STAT[b.type] ? (b.tier >= 3 ? 2 : 1) : 0);
export const craftersOf = (s: GameState, b: Building) => s.cats.filter((c) => c.job === b.id);
/** 次のティアへの強化の資材の倍率（建設資材 ×4 / ×12。設置数によらない） */
export const upgradeMult = (tier: number) => (tier === 1 ? 4 : 12);
export const upgradeCost = (b: Building): Cost => scaled(BUILDINGS[b.type].cost, upgradeMult(b.tier));
/** 建設と強化に払った資材の倍率（ティア 1: 1、2: 5、3: 17） */
const spentMult = (tier: number) => 1 + (tier >= 2 ? 4 : 0) + (tier >= 3 ? 12 : 0);
const scaled = (cost: Cost, k: number): Cost => Object.fromEntries((Object.keys(cost) as ItemId[]).map((id) => [id, cost[id]! * k]));
/** 撤去したときに戻る資材（建設と強化の 50%、切り捨て） */
export const refundOf = (_s: GameState, b: Building): Cost => Object.fromEntries((Object.keys(BUILDINGS[b.type].cost) as ItemId[]).map((id) => [id, Math.floor(BUILDINGS[b.type].cost[id]! * spentMult(b.tier) * 0.5)]));
const notEnough = (s: GameState, cost: Cost) => `資材が足りません（${costText(missing(s, cost))}）`;
/** 強化できない理由。できるなら null */
export function upgradeBlocker(s: GameState, b: Building): string | null {
  if (b.tier >= TIER_MAX) return '最大ティアです';
  const r = TIER_RESEARCH[b.tier + 1];
  if (!has(s, r)) return `研究「${RESEARCH[r].name}」が必要です`;
  const cost = upgradeCost(b);
  return canAfford(s, cost) ? null : notEnough(s, cost);
}

// --- レシピ ---
export const recipeUnlocked = (s: GameState, id: RecipeId) => {
  const u = RECIPES[id].unlock;
  return !u || has(s, u);
};
/** 建物が今作れるレシピ（固定ならそれだけ、自動なら解放済みのすべて） */
export function recipesOf(s: GameState, b: Building): RecipeId[] {
  if (b.recipe) return [b.recipe];
  return (RECIPES_OF[b.type] ?? []).filter((id) => recipeUnlocked(s, id));
}
/** 生産中（なければ固定・最初の）レシピの生産時間 */
export function recipeTime(b: Building) {
  const id = b.cur ?? b.recipe ?? RECIPES_OF[b.type]?.[0];
  return id ? RECIPES[id].time : BUILDINGS[b.type].time;
}
/** 建物がその品を入力に受け取るか。止めた建物は何も受け取らない */
export const accepts = (s: GameState, b: Building, item: ItemId) => b.type === 'hq' || (!b.off && uses(s, b, item));
/** 建物がその品を使うか（研究所は研究パック、兵器は弾、本部は何でも、生産建物は作れるレシピの材料） */
export function uses(s: GameState, b: Building, item: ItemId) {
  if (b.type === 'hq') return true;
  if (b.type === 'lab') return !!ITEMS[item].rp;
  const w = WEAPONS[b.type];
  if (w) return w.ammo === item;
  return recipesOf(s, b).some((id) => RECIPES[id].in[item]);
}
/** 入力に入れられる残り（猫が運んでいる途中の分は数えない） */
export function inputSpace(s: GameState, b: Building, item: ItemId) {
  if (b.type === 'hq') return storeCap(s) - stock(s, item);
  if (b.type === 'lab') return bufferCap(b) - Object.values(b.input).reduce((a, n) => a + (n ?? 0), 0);
  return bufferCap(b) - (b.input[item] ?? 0);
}

export const isUnlocked = (s: GameState, type: BuildingType) => {
  const u = BUILDINGS[type].unlock;
  return !u || has(s, u);
};
export const buildingCount = (s: GameState, type: BuildingType) => s.buildings.filter((b) => b.type === type).length;
/** 建設資材（設置数によらない） */
export const buildingCost = (_s: GameState, type: BuildingType): Cost => BUILDINGS[type].cost;
/** ロボ猫を除いた猫の数 */
export const catCount = (s: GameState) => s.cats.filter((c) => !c.robot).length;
export const robotCount = (s: GameState) => s.cats.length - catCount(s);
export const hireCost = (s: GameState) =>
  Math.floor(70 * 1.4 ** catCount(s) * 0.7 ** count(s, ['herd1', 'herd2']));
export const expandCost = (s: GameState) => 500 * 2 ** s.expansions;
export const infiniteCost = (s: GameState, id: InfiniteId) => Math.floor(INFINITE[id].base * 1.6 ** level(s, id));
export const buildingAt = (s: GameState, x: number, y: number) => s.buildings.find((b) => b.x === x && b.y === y);
export const liftAt = (s: GameState, x: number, y: number) => s.lifts.find((l) => l.x === x && l.y === y);
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

/** 建てられない理由。建てられるなら null */
export function placeBlocker(s: GameState, type: BuildingType, x: number, y: number): string | null {
  const h = gridSize(s) / 2;
  if (type === 'hq') return '本部は建てられません';
  if (!isUnlocked(s, type)) return '未解放です';
  if (x < -h || x >= h || y < -h || y >= h) return '敷地の外です';
  if (buildingAt(s, x, y)) return 'すでに建物があります';
  if (liftAt(s, x, y)) return 'リフトがあります';
  if (type === 'miner' && !oreAt(s, x, y)) return '採掘機は鉱床の上にしか置けません';
  const cost = buildingCost(s, type);
  return canAfford(s, cost) ? null : notEnough(s, cost);
}

export function placeBuilding(s: GameState, type: BuildingType, x: number, y: number, recipe: RecipeId | null = null): string | null {
  const err = placeBlocker(s, type, x, y);
  if (err) return err;
  if (recipe && (RECIPES[recipe].b !== type || !MULTI_RECIPE.includes(type) || !recipeUnlocked(s, recipe))) recipe = null;
  pay(s, buildingCost(s, type));
  const b = newBuilding(s, type, x, y, recipe);
  if (type === 'miner') b.out = oreAt(s, x, y);
  s.buildings.push(b);
  s.layoutVersion++;
  const step = TUTORIAL[s.tut];
  if (step && 'build' in step && step.build === type) s.tut++;
  return null;
}

/** 石の炉・組立機のレシピを変える（null は自動）。作りかけは材料ごと捨てずに続ける */
export function setRecipe(s: GameState, id: number, recipe: RecipeId | null): string | null {
  const b = s.buildings.find((x) => x.id === id);
  if (!b) return '建物がありません';
  if (!MULTI_RECIPE.includes(b.type)) return 'レシピを選べない建物です';
  if (recipe && (RECIPES[recipe].b !== b.type || !recipeUnlocked(s, recipe))) return '未解放のレシピです';
  b.recipe = recipe;
  // 新しいレシピで使わない入力は本部へ戻す（止めている建物は全部）
  for (const i of Object.keys(b.input) as ItemId[]) if (!accepts(s, b, i)) b.input[i] = (b.input[i] ?? 0) - toStore(s, i, b.input[i] ?? 0);
  // 出力には 1 種類しか置けないので、新しいレシピで作らない品が出力に残っていれば本部へ戻す（残ると運び出されるまで作れない）
  if (b.out && b.output > 0 && !recipesOf(s, b).some((id) => (RECIPES[id].out ?? b.out) === b.out)) b.output -= toStore(s, b.out, b.output);
  s.rev++;
  return null;
}

/** 本部の倉庫へ入るだけ入れ、入れた数を返す（満杯なら残りは呼び出し側に残す） */
export function toStore(s: GameState, item: ItemId, n: number) {
  const k = Math.max(0, Math.min(n, storeCap(s) - stock(s, item)));
  s.store[item] = stock(s, item) + k;
  return k;
}

/** 止めたり動かしたりできる建物（生産建物と研究所） */
export const canPause = (b: Building) => !!RECIPES_OF[b.type] || b.type === 'lab';
/** まとめて止める・動かす仲間: 同じ種類で、同じレシピ（採掘機は同じ鉱石） */
export const sameSetup = (a: Building, b: Building) => a.type === b.type && a.recipe === b.recipe && (a.type !== 'miner' || a.out === b.out);

/**
 * 建物を止める（off）・動かす。止めた建物は生産せず、猫もリフトも材料を届けない。入っていた材料は本部へ戻す（本部が満杯なら建物に残る）。
 * 作りかけは材料ごと残し、動かすと続きから作る。出力の品はそのまま運び出される
 */
export function setOff(s: GameState, ids: number[], off: boolean): string | null {
  const list = s.buildings.filter((b) => ids.includes(b.id) && canPause(b));
  if (!list.length) return '止められる建物がありません';
  for (const b of list) {
    if (!!b.off === off) continue;
    if (off) {
      b.off = true;
      b.running = false;
      // 研究所はパックを RP にし終えるまで消費しないので、進みは捨てる
      if (b.type === 'lab') b.progress = 0;
      for (const i of Object.keys(b.input) as ItemId[]) b.input[i] = (b.input[i] ?? 0) - toStore(s, i, b.input[i] ?? 0);
    } else {
      delete b.off;
      if (b.type !== 'lab' && b.cur && b.progress > 0) b.running = true;
    }
  }
  s.rev++;
  return null;
}

/** 本部から機械へ出さずに残す数 */
export function setKeep(s: GameState, item: ItemId, n: number): string | null {
  s.keep[item] = Math.max(0, Math.floor(n) || 0);
  return null;
}

/**
 * 供給元のある品: 本部の在庫が確保数を超えているか、その品を出す建物がある（採掘機は鉱床の鉱石、出力に在庫がある、
 * または材料に供給元があるか入力に揃っているレシピで作れる）。材料の供給元を鎖の元までたどる
 */
export function suppliedItems(s: GameState): Set<ItemId> {
  const set = new Set<ItemId>();
  for (const id of ITEM_IDS) if (stock(s, id) > keepOf(s, id)) set.add(id);
  for (const b of s.buildings) if (b.out && ((b.type === 'miner' && !b.off) || b.output > 0)) set.add(b.out);
  for (let grew = true; grew; ) {
    grew = false;
    for (const b of s.buildings)
      for (const id of b.off ? [] : recipesOf(s, b)) {
        const r = RECIPES[id];
        if (!r.out || set.has(r.out)) continue;
        if ((Object.keys(r.in) as ItemId[]).every((i) => set.has(i) || (b.input[i] ?? 0) >= r.in[i]!)) {
          set.add(r.out);
          grew = true;
        }
      }
  }
  return set;
}
export const hasSource = (s: GameState, item: ItemId) => suppliedItems(s).has(item);
/**
 * 供給元がなく、入力にも足りない材料。固定レシピはそのレシピの材料、自動はどのレシピも作れないときだけ、足りない材料が一番少ないレシピの分。
 * 作れるレシピがあれば空
 */
export function missingSources(s: GameState, b: Building, supplied = suppliedItems(s)): ItemId[] {
  let best: ItemId[] | null = null;
  for (const id of recipesOf(s, b)) {
    const r = RECIPES[id];
    const miss = (Object.keys(r.in) as ItemId[]).filter((i) => !supplied.has(i) && (b.input[i] ?? 0) < r.in[i]!);
    if (!miss.length) return [];
    if (!best || miss.length < best.length) best = miss;
  }
  return best ?? [];
}
/** 供給元のない材料の案内（「銅鉱石の供給元がありません。銅鉱石の鉱床に採掘機を置こう」） */
export function sourceHint(item: ItemId) {
  const name = ITEMS[item].name;
  if (ITEMS[item].cat === 'ore') return `${name}の供給元がありません。${name}の鉱床に採掘機を置こう`;
  const r = RECIPE_IDS.map((id) => RECIPES[id]).find((r) => r.out === item);
  if (!r) return `${name}の供給元がありません`;
  const where = BUILDINGS[r.b].name;
  return `${name}の供給元がありません。${Object.keys(r.in).length ? `${where}で${name}を作ろう` : `${where}を置こう`}`;
}

/** 市場で売るかどうかと、残す量 */
export function setSell(s: GameState, item: ItemId, on: boolean, keep = 0): string | null {
  if (!ITEMS[item].value) return 'この品は売れません';
  if (on) s.sell[item] = Math.max(0, Math.floor(keep) || 0);
  else delete s.sell[item];
  return null;
}

export function removeBuilding(s: GameState, x: number, y: number): string | null {
  const b = buildingAt(s, x, y);
  if (!b) return liftAt(s, x, y) ? removeLift(s, x, y) : '建物がありません';
  if (b.type === 'hq') return '本部は撤去できません';
  // 建設と強化の資材の 50% を倉庫へ（倉庫を撤去するなら、減った容量で切り捨てる）
  s.buildings.splice(s.buildings.indexOf(b), 1);
  give(s, refundOf(s, b));
  if (b.type === 'warehouse') for (const id of ITEM_IDS) if (stock(s, id) > storeCap(s)) s.store[id] = storeCap(s);
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

// --- 本部の手作業 ---
/** 手作業で作れない理由（材料は n 個分）。作れるなら null */
export function handBlocker(s: GameState, id: HandId, n = 1): string | null {
  const r = HAND[id];
  if (!r) return '手作業では作れません';
  if (r.unlock && !has(s, r.unlock)) return `研究「${RESEARCH[r.unlock].name}」が必要です`;
  if (ITEMS[id].cat === 'ore' && !s.ores.some((o) => o.k === id)) return `島に${ITEMS[id].name}の鉱床がありません`;
  const last = s.hand.q[s.hand.q.length - 1];
  if (s.hand.q.length >= HAND_QUEUE && last?.id !== id) return `手作業のキューがいっぱいです（${HAND_QUEUE} 件まで）`;
  if (s.buildings.find((b) => b.type === 'hq') === undefined) return '本部がありません';
  return canAfford(s, r.in, n) ? null : notEnough(s, scaled(r.in, n));
}
/** 手作業をキューに足す（材料はここで払う。最後の件と同じ品ならまとめる） */
export function queueHand(s: GameState, id: HandId, n: number): string | null {
  n = Math.floor(n);
  if (!(n >= 1 && n <= 100)) return '個数は 1〜100 です';
  const err = handBlocker(s, id, n);
  if (err) return err;
  pay(s, HAND[id].in, n);
  const last = s.hand.q[s.hand.q.length - 1];
  if (last?.id === id) last.n += n;
  else s.hand.q.push({ id, n });
  return null;
}
/** キューの i 件目を取り消す（払った材料は全部戻す。容量は超えてもよい） */
export function cancelHand(s: GameState, i: number): string | null {
  const e = s.hand.q[i];
  if (!e) return 'その手作業はありません';
  for (const [k, v] of Object.entries(HAND[e.id].in) as [ItemId, number][]) s.store[k] = stock(s, k) + v * e.n;
  s.hand.q.splice(i, 1);
  if (i === 0) s.hand.t = 0;
  return null;
}
/** 資材の不足分のうち、手作業でまかなえる分（品ごとの回数）。順に足したときに材料が足りるものだけ */
export function handPlan(s: GameState, cost: Cost): { id: HandId; n: number }[] {
  const t: GameState = { ...s, store: { ...s.store }, hand: { q: s.hand.q.map((e) => ({ ...e })), t: s.hand.t } };
  const plan: { id: HandId; n: number }[] = [];
  for (const [id, need] of Object.entries(missing(s, cost)) as [ItemId, number][]) {
    if (!(id in HAND)) continue;
    const h = id as HandId;
    // キューにある分は差し引く
    const queued = s.hand.q.reduce((a, e) => a + (e.id === h ? e.n * HAND[h].n : 0), 0);
    const n = Math.ceil((need - queued) / HAND[h].n);
    if (n > 0 && !queueHand(t, h, n)) plan.push({ id: h, n });
  }
  return plan;
}
/** 手作業のチュートリアルを出した */
export function markCraftTip(s: GameState): string | null {
  s.craftTip = true;
  return null;
}

// --- リフト ---
/** リフトを置く。すでにあれば向きだけ変える */
export function placeLift(s: GameState, x: number, y: number, d: number): string | null {
  const h = gridSize(s) / 2;
  if (!has(s, 'lift')) return '研究「リフト」が必要です';
  if (x < -h || x >= h || y < -h || y >= h) return '敷地の外です';
  const cur = liftAt(s, x, y);
  if (cur) {
    if (cur.d !== d) {
      cur.d = d;
      s.rev++;
    }
    return null;
  }
  if (buildingAt(s, x, y)) return '建物の上には置けません';
  if (!canAfford(s, LIFT.cost)) return notEnough(s, LIFT.cost);
  pay(s, LIFT.cost);
  s.lifts.push({ x, y, d: ((d % 4) + 4) % 4, tier: 1, items: [] });
  s.rev++;
  return null;
}
/** ドラッグで置いたタイルをまとめて置く。1 つも置けなければ最初のエラー */
export function placeLifts(s: GameState, tiles: { x: number; y: number; d: number }[]): string | null {
  let first: string | null = null;
  let ok = 0;
  for (const t of tiles) {
    const err = placeLift(s, t.x, t.y, t.d);
    if (err) first ??= err;
    else ok++;
  }
  return ok ? null : first;
}
/** 撤去は資材を 100% 返す（強化分も）。吊っていた品も倉庫へ */
export function removeLift(s: GameState, x: number, y: number): string | null {
  const l = liftAt(s, x, y);
  if (!l) return 'リフトがありません';
  s.lifts.splice(s.lifts.indexOf(l), 1);
  give(s, LIFT.cost, spentMult(l.tier));
  for (const it of l.items) give(s, { [it.k]: 1 });
  s.rev++;
  return null;
}
/** リフトのタイルと、つながった（前後の）リフトをたどったタイル */
export function liftLine(s: GameState, x: number, y: number): Lift[] {
  const start = liftAt(s, x, y);
  if (!start) return [];
  const key = (x: number, y: number) => x * 1000 + y;
  const byPos = new Map(s.lifts.map((l) => [key(l.x, l.y), l]));
  const seen = new Set<Lift>([start]);
  const stack = [start];
  while (stack.length) {
    const l = stack.pop()!;
    const [dx, dy] = DIRS[l.d];
    const next = byPos.get(key(l.x + dx, l.y + dy));
    const near = [next];
    for (const [ex, ey] of DIRS) {
      const o = byPos.get(key(l.x + ex, l.y + ey));
      if (o && o.x + DIRS[o.d][0] === l.x && o.y + DIRS[o.d][1] === l.y) near.push(o);
    }
    for (const o of near) if (o && !seen.has(o)) seen.add(o), stack.push(o);
  }
  return [...seen];
}
export const liftUpgradeCost = (l: Lift): Cost => scaled(LIFT.cost, upgradeMult(l.tier));
/** リフトを 1 段強化する（all ならつながったリフトをまとめて。最大のタイルは飛ばす） */
export function upgradeLift(s: GameState, x: number, y: number, all = false): string | null {
  if (!has(s, 'fastLift')) return '研究「高速リフト」が必要です';
  const one = liftAt(s, x, y);
  if (!one) return 'リフトがありません';
  const list = (all ? liftLine(s, x, y) : [one]).filter((l) => l.tier < TIER_MAX);
  if (!list.length) return '最大ティアです';
  const total: Cost = {};
  for (const l of list) for (const [id, n] of Object.entries(liftUpgradeCost(l)) as [ItemId, number][]) total[id] = (total[id] ?? 0) + n;
  if (!canAfford(s, total)) return notEnough(s, total);
  pay(s, total);
  for (const l of list) l.tier++;
  return null;
}
/** つながったリフトをまとめて強化するときの資材 */
export function liftLineCost(s: GameState, x: number, y: number): Cost {
  const total: Cost = {};
  for (const l of liftLine(s, x, y)) if (l.tier < TIER_MAX) for (const [id, n] of Object.entries(liftUpgradeCost(l)) as [ItemId, number][]) total[id] = (total[id] ?? 0) + n;
  return total;
}

// --- ロボ猫 ---
/** 倉庫のロボ猫を 1 体使って、本部から運搬ロボットを出す */
export function launchRobot(s: GameState): string | null {
  if (stock(s, 'robot') < 1) return '倉庫にロボ猫がありません（組立機で作って本部へ）';
  s.store.robot = stock(s, 'robot') - 1;
  const n = robotCount(s) + 1;
  const hq = s.buildings.find((b) => b.type === 'hq');
  const c: Partial<Cat> = { id: s.nextId++, x: hq?.x ?? 0, y: hq?.y ?? 0, color: 'gray', state: 'idle', path: [], item: null, amount: 0, src: 0, dst: 0, robot: true, name: `R-${String(n).padStart(2, '0')}` };
  initCat(s, c);
  s.cats.push(c as Cat);
  return null;
}

/** 建物のティアを 1 つ上げる */
export function upgradeBuilding(s: GameState, id: number): string | null {
  const b = s.buildings.find((x) => x.id === id);
  if (!b) return '建物がありません';
  const err = upgradeBlocker(s, b);
  if (err) return err;
  pay(s, upgradeCost(b));
  keepHp(s, () => b.tier++);
  return null;
}

/** 建物を直す（減った HP の割合ぶんのコイン） */
export function repairBuilding(s: GameState, id: number): string | null {
  const b = s.buildings.find((x) => x.id === id);
  if (!b) return '建物がありません';
  const cost = repairCost(s, b);
  if (!cost) return '直すところはありません';
  if (s.coins < cost) return 'コインが足りません';
  s.coins -= cost;
  b.hp = maxHp(s, b);
  return null;
}

/** 故障中の建物の修理費の合計 */
export const repairAllCost = (s: GameState) => s.buildings.reduce((a, b) => a + (isBroken(b) ? repairCost(s, b) : 0), 0);

/** 故障中の建物をまとめて直す */
export function repairAll(s: GameState): string | null {
  const cost = repairAllCost(s);
  if (!cost) return '故障中の建物はありません';
  if (s.coins < cost) return 'コインが足りません';
  s.coins -= cost;
  for (const b of s.buildings) if (isBroken(b)) b.hp = maxHp(s, b);
  return null;
}

/** 猫を職人として建物に配属する（別の建物の職人なら移る） */
export function assignCat(s: GameState, catId: number, buildingId: number): string | null {
  const c = s.cats.find((x) => x.id === catId);
  const b = s.buildings.find((x) => x.id === buildingId);
  if (!c || !b) return '見つかりません';
  if (c.robot) return 'ロボ猫は職人になれません';
  if (c.away) return '家出の最中です';
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
    keepHp(s, () => (s.levels[id] = level(s, id) + 1));
    return null;
  }
  s.rp -= RESEARCH[id].rp;
  keepHp(s, () => s.researched.push(id));
  s.rev++;
  return null;
}

/** 島を 1 周（各辺 +2）広げる */
export function expandIsland(s: GameState): string | null {
  if (gridSize(s) >= GRID.max) return 'これ以上は広げられません';
  const cost = expandCost(s);
  if (s.coins < cost) return 'コインが足りません';
  s.coins -= cost;
  const from = gridSize(s);
  s.expansions++;
  genOres(s, from, gridSize(s));
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

/** 猫の名前を変える（前後の空白を除いて 1〜8 文字） */
export function renameCat(s: GameState, id: number, name: string): string | null {
  const c = s.cats.find((c) => c.id === id);
  if (!c) return '見つかりません';
  const n = name.trim();
  const len = [...n].length;
  if (len < 1 || len > 8) return '名前は 1〜8 文字にしてください';
  c.name = n;
  return null;
}

/** 休憩を終える。施設にいたなら、仕事の続きの経路を引き直す（届かなければ荷物は諦める） */
export function endRest(s: GameState, c: Cat) {
  const at = c.restAt;
  c.rest = null;
  c.restT = 0;
  c.lazy = false;
  c.restAt = 0;
  if (at) repath(s, c);
}

/** 今いるタイルから仕事の続きの経路を引き直す。届かなければ荷物は諦める（予約の後始末は呼び出し側） */
export function repath(s: GameState, c: Cat) {
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
/** 職人ではない猫の数（ロボ猫を含む） */
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
  c.flee ??= 0;
  c.robot ??= false;
  // 勇敢・採掘は後から足したステータス。古い猫にも seed と猫 id から決めて付ける
  STAT_IDS.forEach((id, k) => {
    if (c.stats![id] !== undefined) return;
    const r = { seed: (s.seed ^ Math.imul((c.id ?? 0) + 7 * k, 0x85ebca6b)) >>> 0 };
    c.stats![id] = Math.floor(rand(r) * 16);
  });
}

/** 「ミケ ・ 釣り好き ・ のんびり ・ 苦手: 研究」の個性の部分 */
export const traitText = (c: Cat) => (c.robot ? '運搬ロボット ・ 疲れない ・ 犬から逃げない' : `${STATS[c.good].trait} ・ ${TEMPERS[c.temper].name} ・ 苦手: ${STATS[c.bad].name}`);

function addCat(s: GameState) {
  const color = CAT_COLORS[Math.floor(rand(s) * CAT_COLORS.length)];
  const c: Partial<Cat> = { id: s.nextId++, x: 0, y: 0, color, state: 'idle', path: [], item: null, amount: 0, src: 0, dst: 0 };
  initCat(s, c);
  s.cats.push(c as Cat);
}
