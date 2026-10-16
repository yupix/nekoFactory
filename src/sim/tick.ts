import { CRAFT_FATIGUE, FACILITY, FUEL, HAND, ITEM_IDS, ITEMS, RAID, RECIPES, RECIPES_OF, ROBOT, RUNAWAY, SQUEEZE, STAT_GROWTH, TEMPERS, WORK_STAT, type BuildingType, type ItemId, type StatId } from './data';
import { awayTick, stepAway } from './away';
import { assignJobs, inputTotal } from './haul';
import { buildLifts, liftTick, type LiftGraph } from './lift';
import { bfs, occupancy, type Bfs } from './path';
import { heal, nearestDog, raidTick } from './raid';
import { accepts, addStore, bufferCap, catSpeedOf, endRest, facilityCap, facilityRecover, fatigueRate, gridSize, hasFuel, isBroken, isWeapon, isWorking, labBonus, marketRate, productionSpeed, rand, recipesOf, repath, statBonus, statLevel, stock, storeCap, tierSpeed, toStore, tradeMultiplier, TUTORIAL, usesFuel, type Building, type Cat, type GameState, type Rest } from './state';

/**
 * 市場への納品と研究所の消費（浮遊テキスト用）、猫のステータスの Lv UP（cat と stat 付き）、襲撃の出来事。
 * wave: 襲撃の開始（amount はウェーブ）/ bone: 犬が倒れた（dog、amount はコイン）/ clear・retreat・lost: 決着（clear は報酬コイン、lost は失ったコイン）/
 * broken: 建物の故障 / fire: 発射（amount は狙った犬）/ hit: 着弾（type は兵器）/ tip: 初回襲撃の 3 分前（チュートリアル）/
 * away: 猫が家出を始めた（cat）/ gone: 家出した猫が島を去った（cat と name）/ craft: 本部の手作業が 1 回できた（item、amount は個数）/
 * hireTip: 運び手不足が続いている（猫を雇おうのヒント。amount は雇用コスト）
 */
export interface GameEvent {
  kind: 'coin' | 'rp' | 'lvup' | 'wave' | 'bone' | 'clear' | 'retreat' | 'lost' | 'broken' | 'fire' | 'hit' | 'tip' | 'away' | 'gone' | 'craft' | 'hireTip';
  amount: number;
  x: number;
  y: number;
  cat?: number;
  stat?: StatId;
  dog?: number;
  type?: BuildingType;
  name?: string;
  item?: ItemId;
}

const EPS = 1e-9;
/** 近接分離: これより近い猫同士は押し離す */
export const SEPARATION = 0.35;
/** 対向の猫を気にする前方の距離と、そのときの横ずれ */
const AHEAD = 1.2;
const WIDE = 0.4;
/** 休憩施設を探す BFS 距離 */
const FACILITY_RANGE = 10;
/** 施設の中の猫の位置（施設タイルの中心から） */
const SLOTS: Record<string, { x: number; y: number }[]> = {
  bed: [{ x: 0, y: 0 }, { x: -0.14, y: 0.12 }, { x: 0.14, y: -0.12 }],
  toybox: [{ x: -0.22, y: 0.16 }, { x: 0.2, y: -0.14 }, { x: 0.24, y: 0.26 }, { x: -0.3, y: -0.3 }],
  tower: [{ x: 0.08, y: 0.12 }, { x: -0.12, y: -0.04 }, { x: 0.1, y: -0.12 }, { x: 0.3, y: 0.32 }, { x: -0.32, y: -0.3 }],
  charger: [{ x: -0.2, y: 0.22 }, { x: 0.2, y: 0.22 }, { x: 0, y: 0.32 }, { x: -0.3, y: -0.2 }],
};
/** 職人の作業位置を探す辺の順（+y が正面）と、建物の中心からの距離 */
const WORK_SIDES = [[0, 1], [-1, 0], [1, 0], [0, -1]] as const;
const WORK_DIST = 0.62;
/** 本部で休む位置（正面の軒先に並ぶ）。本部は定員なしで、回復は遅い */
const HQ_SLOTS = [{ x: -0.3, y: 0.4 }, { x: 0, y: 0.42 }, { x: 0.3, y: 0.4 }, { x: -0.42, y: 0.15 }, { x: 0.42, y: 0.15 }, { x: -0.15, y: 0.46 }, { x: 0.15, y: 0.46 }];
const HQ_REST = { time: 12, sleep: 1, play: 0.5, charge: 1 };

/**
 * 同値性テスト用の切り替え。retry: 職人が作業位置を見つけられなかったときに次に探すまでの秒数。
 * reversePath: 出荷元へ向かう経路を出荷元の BFS の逆順で引く（false なら猫起点の BFS。距離は同じで、同じ長さの経路の選び方だけが違う）。
 * runaway: 家出の基本の発生率（1 匹・1 分あたり。テストで上げる）
 */
export const simOptions = { retry: 0.5, reversePath: true, runaway: RUNAWAY.rate };

/** dt 秒進める。発生した納品イベントを返す */
export function tick(s: GameState, dt: number): GameEvent[] {
  const events: GameEvent[] = [];
  const speed = productionSpeed(s);
  const ctx = new Ctx(s);
  // 作業中の職人の生産ボーナス（2 匹なら乗算。兵器では連射の倍率）
  const bonus = new Map<number, number>();
  for (const c of s.cats) {
    const b = isWorking(c) ? ctx.byId.get(c.job) : undefined;
    if (b) bonus.set(b.id, (bonus.get(b.id) ?? 1) * statBonus(c, b.type));
  }
  for (const b of s.buildings) produce(s, b, dt * speed * tierSpeed(b) * (bonus.get(b.id) ?? 1), events);
  handTick(s, ctx.L.hq, dt, events);
  liftTick(s, ctx.L.lifts, dt);
  // 収益の速さ（オフライン収益の元）は市場の売上だけで測る（襲撃の報酬や損失は入れない）
  const coinsBefore = s.coins;
  for (const b of ctx.L.markets) sell(s, b, dt, events);
  const sold = s.coins - coinsBefore;
  raidTick(s, ctx, dt, bonus, events);
  heal(s, dt);
  awayTick(s, ctx, dt, events);
  assignJobs(s, ctx, dt, events);
  const raid = s.raid.cur;

  for (const cat of s.cats) {
    if (cat.retry > 0) cat.retry -= dt;
    if (cat.away) {
      stepAway(s, ctx, cat, dt);
      continue;
    }
    if (!cat.robot && (raid?.dogs.length || cat.flee > 0)) {
      if (flee(s, ctx, cat, dt)) continue;
    }
    if (rest(s, ctx, cat, dt)) continue;
    if (cat.state === 'idle') {
      if (cat.job) craft(s, ctx, cat, dt);
      else if (!cat.robot) idleBehavior(s, ctx, cat, dt);
    }
    move(s, ctx, cat, dt);
    if (cat.state !== 'idle' && cat.path.length === 0 && cat.wait <= 0) arrive(s, ctx, cat, events);
    if (cat.robot) {
      // ロボ猫は運搬中だけバッテリーが減る。疲れ・ステータスはない
      if (cat.state !== 'idle') cat.energy = Math.max(0, cat.energy - dt / ROBOT.drain);
      continue;
    }
    // 働いている間だけ疲れ、ステータスが伸びる（職人は建物が稼働している間）
    const job = cat.state === 'idle' && cat.work ? ctx.byId.get(cat.job) : undefined;
    if (cat.state !== 'idle' || job?.running)
      cat.energy = Math.max(0, cat.energy - (dt / cat.stamina) * fatigueRate(s) * TEMPERS[cat.temper].fatigue * (job ? CRAFT_FATIGUE : 1));
    if (cat.state !== 'idle') {
      grow(cat, 'leg', dt, events);
      if (cat.amount >= 2) grow(cat, 'str', dt, events);
    } else if (job?.running && !isBroken(job)) grow(cat, WORK_STAT[job.type]!, dt, events);
  }
  separate(s.cats, ctx);
  if (raid) separate(raid.dogs, ctx);
  s.incomeRate += (sold / dt - s.incomeRate) * Math.min(1, dt / 60);
  return events;
}

/** ステータスを伸ばす（得意 ×2、苦手 ×0.5、100 で止まる）。Lv が上がったらイベントを出す */
function grow(c: Cat, id: StatId, dt: number, events: GameEvent[]) {
  const v = c.stats[id];
  if (v >= 100) return;
  const n = Math.min(100, v + STAT_GROWTH * (id === c.good ? 2 : id === c.bad ? 0.5 : 1) * dt);
  c.stats[id] = n;
  if (statLevel(n) > statLevel(v)) events.push({ kind: 'lvup', amount: statLevel(n), x: c.x, y: c.y, cat: c.id, stat: id });
}

/** 入力が揃っていて、出力に入る（出力の品が同じか空の）レシピ。自動は前回作ったレシピの次から探す（順繰り） */
function ready(s: GameState, b: Building) {
  const list = recipesOf(s, b);
  const start = b.cur ? list.indexOf(b.cur) + 1 : 0;
  for (let k = 0; k < list.length; k++) {
    const id = list[(start + k) % list.length];
    const r = RECIPES[id];
    const out = r.out ?? b.out;
    if (b.output > 0 && b.out !== out) continue;
    if (b.output + r.n > bufferCap(b)) continue;
    if ((Object.keys(r.in) as ItemId[]).every((i) => (b.input[i] ?? 0) >= r.in[i]!)) return id;
  }
  return null;
}

/** 生産が始められるか（研究所は品があるか。燃料を使う建物は燃え残りか入力の燃料も要る） */
export function hasInputs(s: GameState, b: Building) {
  if (b.type === 'lab') return inputTotal(b) > 0;
  if (!RECIPES_OF[b.type]) return false;
  if (usesFuel(b) && !hasFuel(b)) return false;
  return recipesOf(s, b).some((id) => (Object.keys(RECIPES[id].in) as ItemId[]).every((i) => (b.input[i] ?? 0) >= RECIPES[id].in[i]!));
}
/** 出力が満杯で止まっている */
export const outputFull = (s: GameState, b: Building) => !!RECIPES_OF[b.type] && !b.off && !b.running && b.output > 0 && hasInputs(s, b) && !ready(s, b);

function produce(s: GameState, b: Building, dt: number, events: GameEvent[]) {
  // 故障中・止めている間は止まる（途中の進みは残る）
  if (isBroken(b) || b.off) return;
  if (b.type === 'lab') return research(s, b, dt, events);
  if (!RECIPES_OF[b.type]) return;
  const fuel = usesFuel(b);
  if (!b.running) {
    if (fuel && !hasFuel(b)) return;
    const id = ready(s, b);
    if (!id) return;
    const r = RECIPES[id];
    for (const i of Object.keys(r.in) as ItemId[]) b.input[i]! -= r.in[i]!;
    b.cur = id;
    b.out = r.out ?? b.out;
    b.running = true;
    b.progress = 0;
  }
  // 燃料: 燃え尽きていたら入力の燃料を 1 個くべる。なければ作りかけのまま待つ。燃えるのは進んだ分だけ
  if (fuel) {
    if ((b.fuel ?? 0) <= 0) {
      if ((b.input[FUEL.item] ?? 0) < 1) return;
      b.input[FUEL.item]!--;
      b.fuel = (b.fuel ?? 0) + FUEL.burn;
    }
    b.fuel = Math.max(0, b.fuel! - dt);
  }
  b.progress += dt;
  const r = RECIPES[b.cur!];
  if (b.progress >= r.time - EPS) {
    b.output += r.n;
    b.running = false;
    b.progress = 0;
    const step = TUTORIAL[s.tut];
    if (step && 'make' in step && step.make === b.out) s.tut++;
  }
}

/** 本部の手作業: キューの先頭を 1 個ずつ作る。本部が故障中は止まり、倉庫に入らなければできあがったまま待つ */
function handTick(s: GameState, hq: Building | undefined, dt: number, events: GameEvent[]) {
  const head = s.hand.q[0];
  if (!head || !hq || isBroken(hq)) return;
  const r = HAND[head.id];
  s.hand.t = Math.min(r.time, s.hand.t + dt);
  if (s.hand.t < r.time - EPS || storeCap(s) - stock(s, head.id) < r.n) return;
  s.store[head.id] = stock(s, head.id) + r.n;
  s.hand.t = 0;
  if (--head.n <= 0) s.hand.q.shift();
  events.push({ kind: 'craft', amount: r.n, x: hq.x, y: hq.y, item: head.id });
}

/** 研究所: 研究パックを 2 秒に 1 個 RP にする（処理中の 1 個も入力上限に数え、完了時に取り出す） */
function research(s: GameState, b: Building, dt: number, events: GameEvent[]) {
  if (!b.running) {
    if (!inputTotal(b)) return;
    b.running = true;
    b.progress = 0;
  }
  b.progress += dt;
  if (b.progress < 2 - EPS) return;
  const item = (Object.keys(b.input) as ItemId[]).find((i) => b.input[i]! > 0)!;
  b.input[item]!--;
  const amount = Math.round((ITEMS[item].rp ?? 0) * labBonus(b));
  s.rp += amount;
  events.push({ kind: 'rp', amount, x: b.x, y: b.y });
  b.running = false;
  b.progress = 0;
  const step = TUTORIAL[s.tut];
  if (step && 'rp' in step) s.tut++;
}

/** 市場: 倉庫の「売る」品を、残す量より多い分から 1 秒に 1 個（ティア 2 で 2、3 で 4）ずつ順に売る */
function sell(s: GameState, b: Building, dt: number, events: GameEvent[]) {
  if (isBroken(b)) return;
  b.progress = Math.min(b.progress + dt * marketRate(b), marketRate(b));
  let coins = 0;
  while (b.progress >= 1 - EPS) {
    let item: ItemId | null = null;
    for (let k = 0; k < ITEM_IDS.length && !item; k++) {
      const id = ITEM_IDS[((b.rot ?? 0) + k) % ITEM_IDS.length];
      const keep = s.sell[id];
      if (keep !== undefined && ITEMS[id].value && stock(s, id) > keep) {
        item = id;
        b.rot = (((b.rot ?? 0) + k + 1) % ITEM_IDS.length);
      }
    }
    if (!item) {
      b.progress = Math.min(b.progress, 1);
      break;
    }
    b.progress--;
    s.store[item]!--;
    coins += ITEMS[item].value * tradeMultiplier(s);
  }
  b.running = coins > 0;
  if (!coins) return;
  s.coins += coins;
  events.push({ kind: 'coin', amount: coins, x: b.x, y: b.y });
}

/** 建物の配置ごとに作る盤面情報。layoutVersion が変わるまで tick をまたいで使う */
interface Layout {
  state: GameState;
  version: number;
  size: number;
  grid: Uint8Array;
  byId: Map<number, Building>;
  /** タイル番号 → 建物 */
  byPos: (Building | undefined)[];
  rev: number;
  /** 出力を持つ建物（並び順は s.buildings のまま。リフトで積み出す建物は除く） */
  srcs: Building[];
  /** アイテムごとの届け先の候補（その品を入力に取る建物。本部は最後） */
  dsts: Partial<Record<ItemId, Building[]>>;
  markets: Building[];
  lifts: LiftGraph;
  /** 建物を起点とする BFS */
  from: Map<number, Bfs>;
  /** タイルを起点とする BFS（犬が標的を探す） */
  tiles: Map<number, Bfs>;
  weapons: Building[];
  hq: Building | undefined;
  /** 運搬の割当の回数と、出荷元の出力が満杯で止まった回（満杯の出荷元を古い順に拾う。保存しない） */
  clock: number;
  fullSince: Map<number, number>;
}
let layout: Layout | null = null;

function getLayout(s: GameState): Layout {
  if (layout && layout.state === s && layout.version === s.layoutVersion && layout.rev === s.rev) return layout;
  // 建物の配置が同じなら（レシピ・研究・リフトだけの変化）、経路のキャッシュは使い回す
  const keep = layout && layout.state === s && layout.version === s.layoutVersion ? layout : null;
  const size = gridSize(s);
  const h = size / 2;
  const byPos: (Building | undefined)[] = new Array(size * size);
  for (const b of s.buildings) byPos[(b.y + h) * size + b.x + h] = b;
  const lifts = buildLifts(s, byPos, size);
  const dsts: Layout['dsts'] = {};
  for (const item of ITEM_IDS) {
    const list = s.buildings.filter((d) => d.type !== 'hq' && accepts(s, d, item));
    const hq = s.buildings.find((b) => b.type === 'hq');
    if (hq) list.push(hq);
    dsts[item] = list;
  }
  // 盤面が変わったら、作業位置を探すのを待っている職人もすぐ探し直す
  for (const c of s.cats) c.retry = 0;
  return (layout = {
    state: s,
    version: s.layoutVersion,
    rev: s.rev,
    size,
    grid: keep?.grid ?? occupancy(size, s.buildings),
    byId: new Map(s.buildings.map((b) => [b.id, b])),
    byPos,
    srcs: s.buildings.filter((b) => (RECIPES_OF[b.type] || b.type === 'hq') && !lifts.loaders.has(b)),
    dsts,
    markets: s.buildings.filter((b) => b.type === 'market'),
    lifts,
    from: keep?.from ?? new Map(),
    tiles: keep?.tiles ?? new Map(),
    weapons: s.buildings.filter((b) => isWeapon(b.type)),
    hq: s.buildings.find((b) => b.type === 'hq'),
    clock: keep?.clock ?? layout?.clock ?? 0,
    fullSince: keep?.fullSince ?? new Map(),
  });
}

const ITEM_INDEX = Object.fromEntries(ITEM_IDS.map((id, i) => [id, i])) as Record<ItemId, number>;
/** incoming のキー（item 省略時はその建物の全アイテムの合計） */
const incKey = (id: number, item?: ItemId) => id * 32 + (item ? ITEM_INDEX[item] : 31);

/** tick 内で使い回す情報。tick の冒頭に 1 回集計し、割当や状態の変化に合わせて更新する */
export class Ctx {
  L: Layout;
  size: number;
  byId: Map<number, Building>;
  /** 運搬中の猫が届ける予定の量 */
  private incoming = new Map<number, number>();
  /** 休憩施設 id → 使用中（向かっている）猫のスロット */
  private users = new Map<number, number[]>();
  /** 建物の辺の待機位置 → そこに並ぶ猫の数 */
  private spots = new Map<number, number>();
  /** 前方確認用の空間ハッシュ（1.2 タイル四方） */
  private hash = new Map<number, Cat[]>();
  constructor(s: GameState) {
    this.L = getLayout(s);
    this.size = this.L.size;
    this.byId = this.L.byId;
    for (const c of s.cats) {
      const k = cellKey(c.x, c.y, AHEAD);
      const list = this.hash.get(k);
      if (list) list.push(c);
      else this.hash.set(k, [c]);
      if (c.state !== 'idle' && c.item) this.addIncoming(c.dst, c.item, c.amount);
      if (c.restAt) this.slots(c.restAt).push(c.slot);
      if (c.spot) this.spots.set(c.spot, (this.spots.get(c.spot) ?? 0) + 1);
    }
  }
  /** 猫の経路（建物はすり抜けられる） */
  bfs(x: number, y: number) {
    return bfs(this.size, this.L.grid, x, y, SQUEEZE.cost);
  }
  fromBuilding(b: Building) {
    let r = this.L.from.get(b.id);
    if (!r) this.L.from.set(b.id, (r = this.bfs(b.x, b.y)));
    return r;
  }
  /** タイルを起点とする犬の BFS（建物はすり抜けない。盤面が変わるまで使い回す） */
  fromTile(x: number, y: number) {
    const h = this.size / 2;
    const k = (y + h) * this.size + x + h;
    let r = this.L.tiles.get(k);
    if (!r) this.L.tiles.set(k, (r = bfs(this.size, this.L.grid, x, y)));
    return r;
  }
  at(x: number, y: number) {
    const h = this.size / 2;
    return this.L.byPos[(y + h) * this.size + x + h];
  }
  blocked(x: number, y: number) {
    const h = this.size / 2;
    return this.L.grid[(y + h) * this.size + x + h] === 1;
  }
  incomingTo(id: number, item?: ItemId) {
    return this.incoming.get(incKey(id, item)) ?? 0;
  }
  /** 届ける予定の量を足す（負なら引く） */
  addIncoming(id: number, item: ItemId, n: number) {
    for (const k of [incKey(id, item), incKey(id)]) this.incoming.set(k, (this.incoming.get(k) ?? 0) + n);
  }
  slots(id: number) {
    let list = this.users.get(id);
    if (!list) this.users.set(id, (list = []));
    return list;
  }
  /** 猫の休憩施設の予約を設定する（0 で解除） */
  setRestAt(cat: Cat, id: number) {
    this.release(cat.restAt, cat.slot);
    cat.restAt = id;
    if (id) this.slots(id).push(cat.slot);
  }
  release(id: number, slot: number) {
    if (!id) return;
    const list = this.slots(id);
    list.splice(list.indexOf(slot), 1);
  }
  /** 待機位置の予約を変え、変える前にそこへ並んでいた猫の数を返す */
  setSpot(cat: Cat, key: number) {
    if (cat.spot) this.spots.set(cat.spot, this.spots.get(cat.spot)! - 1);
    cat.spot = key;
    if (!key) return 0;
    const n = this.spots.get(key) ?? 0;
    this.spots.set(key, n + 1);
    return n;
  }
  /** (x, y) のまわりの猫（前方確認用） */
  *near(x: number, y: number) {
    const cx = Math.floor(x / AHEAD);
    const cy = Math.floor(y / AHEAD);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) yield* this.hash.get((cx + i) * 4099 + (cy + j)) ?? [];
  }
}

const cellKey = (x: number, y: number, cell: number) => Math.floor(x / cell) * 4099 + Math.floor(y / cell);
const blocked = (ctx: Ctx, x: number, y: number) => ctx.blocked(Math.round(x), Math.round(y));

/** 疲れによる休憩の始まりやすさ（毎秒の確率）。0.3 を切ると急に上がる */
export function restChance(energy: number) {
  if (energy > 0.6) return 0;
  if (energy > 0.3) return (0.02 * (0.6 - energy)) / 0.3;
  return 0.02 + 0.3 * ((0.3 - energy) / 0.3) ** 2;
}

/** 休憩に入る。10 タイル以内に空いた施設があればそこへ歩いて行く（荷物は背負ったまま）。ロボ猫の充電は距離を問わない */
function startRest(s: GameState, ctx: Ctx, cat: Cat, kind: Rest, lazy: boolean) {
  const range = kind === 'charge' ? Infinity : FACILITY_RANGE;
  cat.rest = kind;
  cat.lazy = lazy;
  // 職人は休憩の間は作業しない（終わったら作業位置へ戻る）
  cat.work = false;
  ctx.setRestAt(cat, 0);
  let from: Bfs | null = null;
  let best: { b: Building; d: number; slot: number } | null = null;
  for (const b of s.buildings) {
    const def = FACILITY[b.type];
    if (!def || !def.kinds.includes(kind) || isBroken(b)) continue;
    const used = ctx.slots(b.id);
    if (used.length >= facilityCap(b)) continue;
    from ??= ctx.bfs(Math.round(cat.x), Math.round(cat.y));
    const d = from.dist(b.x, b.y);
    if (d < 0 || d > range || (best && d >= best.d)) continue;
    let slot = 0;
    while (used.includes(slot)) slot++;
    best = { b, d, slot };
  }
  // 施設がなければ、最終手段の本部（定員なし）
  const hq = ctx.L.hq;
  if (!best && hq && !isBroken(hq)) {
    from ??= ctx.bfs(Math.round(cat.x), Math.round(cat.y));
    const d = from.dist(hq.x, hq.y);
    if (d >= 0 && d <= range) {
      let slot = 0;
      const used = ctx.slots(hq.id);
      while (used.includes(slot)) slot++;
      best = { b: hq, d, slot };
    }
  }
  if (best && from) {
    cat.slot = best.slot;
    ctx.setRestAt(cat, best.b.id);
    cat.path = from.path(best.b.x, best.b.y)!;
    cat.restT = FACILITY[best.b.type]?.time ?? (kind === 'charge' ? ROBOT.hqCharge : HQ_REST.time);
  } else cat.restT = kind === 'charge' ? ROBOT.hqCharge : kind === 'sleep' ? (lazy ? 6 + rand(s) * 8 : 8 + rand(s) * 7) : 3 + rand(s) * 3;
}

/** 休憩の進行と開始。休憩中（施設へ向かう途中を含む）で、この tick はほかに動かないなら true */
function rest(s: GameState, ctx: Ctx, cat: Cat, dt: number): boolean {
  if (cat.rest && cat.lazy && cat.job) {
    // 仕事のない猫の休憩は、職人に配属されたら切り上げる（運搬の仕事が来たときは割当の側で切り上げる）
    cat.path = [];
    cat.rest = null;
    cat.restT = 0;
    cat.lazy = false;
    ctx.setRestAt(cat, 0);
    return false;
  }
  if (cat.rest) {
    const f = cat.restAt ? ctx.byId.get(cat.restAt) : undefined;
    if (cat.restAt && !f) {
      // 施設が撤去された
      finishRest(s, ctx, cat);
      return false;
    }
    if (f && cat.path.length > 0) {
      move(s, ctx, cat, dt);
      return true;
    }
    cat.restT -= dt;
    if (cat.restT > 0) return true;
    const gain = f?.type === 'hq' ? HQ_REST[cat.rest] : f ? FACILITY[f.type]!.gain * facilityRecover(f) : cat.rest === 'play' ? 0.3 : 1;
    cat.energy = cat.robot ? 1 : Math.min(1, cat.energy + gain * TEMPERS[cat.temper].recover);
    finishRest(s, ctx, cat);
    cat.wait = 0.3; // 起きてすぐは少し伸びをする
    return false;
  }
  if (cat.robot) {
    // ロボ猫は手が空いたときにバッテリーが少なければ充電へ
    if (cat.state === 'idle' && cat.energy < ROBOT.low) startRest(s, ctx, cat, 'charge', false);
    return !!cat.rest;
  }
  const p = restChance(cat.energy);
  if (p > 0 && rand(s) < p * dt) {
    // 運搬中でも構わない（荷物は予約済みなので背負ったまま休む）
    const sleep = cat.energy <= 0.1 || rand(s) < (cat.energy < 0.3 ? 0.65 : 0.4);
    startRest(s, ctx, cat, sleep ? 'sleep' : 'play', false);
    return true;
  }
  return false;
}

/** 休憩を終える（施設の予約を外し、荷物を諦めたら届ける予定からも外す） */
function finishRest(s: GameState, ctx: Ctx, cat: Cat) {
  const { item, dst, amount, restAt, slot } = cat;
  const busy = cat.state !== 'idle';
  endRest(s, cat);
  ctx.release(restAt, slot);
  if (busy && cat.state === 'idle' && item) ctx.addIncoming(dst, item, -amount);
}

/**
 * 犬が 2.5 タイル以内に来た猫は 2 秒、犬と逆へ逃げる（速度 ×1.5、荷物は持ったまま）。
 * 勇敢 50 以上の猫と、配属先が無事な職人は逃げない。逃げている間は true
 */
function flee(s: GameState, ctx: Ctx, cat: Cat, dt: number): boolean {
  const raid = s.raid.cur;
  const dog = raid ? nearestDog(raid, cat.x, cat.y) : null;
  if (cat.flee <= 0) {
    if (!dog || cat.rest || cat.stats.brave >= RAID.brave) return false;
    const job = cat.job ? ctx.byId.get(cat.job) : undefined;
    if (job && !isBroken(job)) return false;
    if (Math.hypot(dog.x - cat.x, dog.y - cat.y) > RAID.flee) return false;
    cat.flee = RAID.fleeT;
    cat.work = false;
    cat.wait = 0;
  }
  cat.flee -= dt;
  if (dog) {
    const d = Math.hypot(cat.x - dog.x, cat.y - dog.y) || 1;
    const dx = (cat.x - dog.x) / d;
    const dy = (cat.y - dog.y) / d;
    const step = catSpeedOf(s, cat) * 1.5 * dt;
    const h = ctx.size / 2;
    // 真後ろが塞がっていれば斜め・横へ
    for (const a of [0, 0.7, -0.7, 1.5, -1.5]) {
      const ux = dx * Math.cos(a) - dy * Math.sin(a);
      const uy = dx * Math.sin(a) + dy * Math.cos(a);
      const x = cat.x + ux * step;
      const y = cat.y + uy * step;
      const tx = Math.round(x);
      const ty = Math.round(y);
      if (tx < -h || tx >= h || ty < -h || ty >= h) continue;
      if (ctx.blocked(tx, ty) && (tx !== Math.round(cat.x) || ty !== Math.round(cat.y))) continue;
      cat.x = x;
      cat.y = y;
      cat.hx = ux;
      cat.hy = uy;
      break;
    }
  }
  if (cat.flee > 0) return true;
  // 逃げ終わったら、今いるタイルから仕事の続きの経路を引き直す
  cat.flee = 0;
  cat.nx = Math.round(cat.x);
  cat.ny = Math.round(cat.y);
  const { item, dst, amount } = cat;
  const busy = cat.state !== 'idle';
  repath(s, cat);
  if (busy && cat.state === 'idle' && item) ctx.addIncoming(dst, item, -amount);
  return false;
}

/** 作業位置が使えるか（建物の隣の空いたタイルで、ほかの職人と重ならない） */
function spotOk(s: GameState, ctx: Ctx, cat: Cat, b: Building, x: number, y: number) {
  const tx = Math.round(x);
  const ty = Math.round(y);
  const h = ctx.size / 2;
  if (Math.abs(tx - b.x) + Math.abs(ty - b.y) !== 1 || tx < -h || tx >= h || ty < -h || ty >= h || ctx.blocked(tx, ty)) return false;
  return !s.cats.some((o) => o !== cat && o.job === b.id && Math.round(o.wx) === tx && Math.round(o.wy) === ty);
}

/** 職人: 作業位置へ歩いて行き、着いたら作業する（休憩から戻るときも同じ） */
function craft(s: GameState, ctx: Ctx, cat: Cat, dt: number) {
  const b = ctx.byId.get(cat.job);
  if (!b) {
    cat.job = 0;
    cat.work = false;
    return;
  }
  if (cat.path.length > 0 || cat.wait > 0) return;
  // 配属先が故障中は作業をやめて待つ
  if (isBroken(b)) {
    cat.work = false;
    return;
  }
  const cx = Math.round(cat.x);
  const cy = Math.round(cat.y);
  if (!spotOk(s, ctx, cat, b, cat.wx, cat.wy)) {
    // 作業位置を選び直す（正面から順に、猫が歩いて行ける辺）
    cat.work = false;
    if (cat.retry > 0) return;
    const from = ctx.bfs(cx, cy);
    for (const [dx, dy] of WORK_SIDES) {
      const tx = b.x + dx;
      const ty = b.y + dy;
      if (!spotOk(s, ctx, cat, b, tx, ty) || from.dist(tx, ty) < 0) continue;
      // 釣り場は正面なら桟橋の先に座る
      const lat = b.type === 'fishing' && dy === 1 ? -0.22 : 0;
      cat.wx = b.x + dx * WORK_DIST + lat;
      cat.wy = b.y + dy * WORK_DIST;
      cat.path = from.path(tx, ty)!;
      return;
    }
    cat.retry = simOptions.retry || 0.5;
    return;
  }
  const d = Math.hypot(cat.wx - cat.x, cat.wy - cat.y);
  if (d > 0.3 && (cx !== Math.round(cat.wx) || cy !== Math.round(cat.wy))) {
    // 押されて離れた・休憩から戻る: 作業位置のタイルまで歩く
    cat.work = false;
    const path = ctx.bfs(cx, cy).path(Math.round(cat.wx), Math.round(cat.wy));
    if (path) cat.path = path;
    else cat.wx = b.x; // 届かないので作業位置を選び直す
    return;
  }
  // タイルの中は作業位置へまっすぐ寄る
  const step = catSpeedOf(s, cat) * dt;
  if (d <= step) {
    cat.x = cat.wx;
    cat.y = cat.wy;
    cat.work = true;
  } else {
    cat.x += ((cat.wx - cat.x) / d) * step;
    cat.y += ((cat.wy - cat.y) / d) * step;
  }
}

/** 仕事のない猫: ときどき近くをうろつく・休む（施設があれば使う）。それ以外は座っている */
function idleBehavior(s: GameState, ctx: Ctx, cat: Cat, dt: number) {
  // 疲れている猫は疲れの休憩に任せる
  if (cat.path.length > 0 || cat.wait > 0 || restChance(cat.energy) > 0 || rand(s) >= 0.25 * dt) return;
  const r = rand(s);
  if (r < 0.22) return startRest(s, ctx, cat, 'sleep', true);
  if (r < 0.36) return startRest(s, ctx, cat, 'play', true);
  if (r >= 0.75) return;
  const x = Math.round(cat.x);
  const y = Math.round(cat.y);
  const from = ctx.bfs(x, y);
  const h = ctx.size / 2;
  const options: { x: number; y: number }[] = [];
  for (let dy = -3; dy <= 3; dy++)
    for (let dx = -3; dx <= 3; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (tx < -h || tx >= h || ty < -h || ty >= h || ctx.blocked(tx, ty)) continue;
      const d = from.dist(tx, ty);
      if (d > 0 && d <= 4) options.push({ x: tx, y: ty });
    }
  if (!options.length) return;
  const t = options[Math.floor(rand(s) * options.length)];
  cat.path = from.path(t.x, t.y)!;
}

/**
 * 経路の次の点へ向かって歩く。進行方向の左側へずれて歩き（左側通行）、
 * 前方 1.2 タイル以内に対向・停止中の猫がいれば横ずれを広げ、同方向で前を歩く猫は追い越さない
 */
export function move(s: GameState, ctx: Ctx, cat: Cat, dt: number) {
  if (cat.wait > 0) {
    cat.wait -= dt;
    return;
  }
  if (cat.path.length === 0) {
    cat.sq = cat.thru = false;
    return;
  }
  const n = cat.path[0];
  let dx = n.x - cat.nx;
  let dy = n.y - cat.ny;
  const len = Math.hypot(dx, dy);
  if (len > 0) {
    dx /= len;
    dy /= len;
    // 角でも横ずれが急に反転しないよう、向きはなめらかに追う
    const k = 1 - Math.exp(-dt * 10);
    cat.hx += (dx - cat.hx) * k;
    cat.hy += (dy - cat.hy) * k;
    const hl = Math.hypot(cat.hx, cat.hy) || 1;
    cat.hx /= hl;
    cat.hy /= hl;
  }
  let wide = false;
  let maxStep = Infinity;
  for (const o of ctx.near(cat.x, cat.y)) {
    if (o === cat) continue;
    const rx = o.x - cat.x;
    const ry = o.y - cat.y;
    const along = rx * cat.hx + ry * cat.hy;
    if (along <= 0 || along > AHEAD) continue;
    const lat = Math.abs(rx * cat.hy - ry * cat.hx);
    if (lat > 0.75) continue;
    const moving = o.path.length > 0 && !o.rest && o.wait <= 0;
    const dot = cat.hx * o.hx + cat.hy * o.hy;
    if (!moving || dot < 0) wide = true;
    else if (dot > 0.5 && lat < 0.3) maxStep = Math.min(maxStep, Math.max(0, along - 0.42));
  }
  cat.off += ((wide ? WIDE : cat.lane) - cat.off) * (1 - Math.exp(-dt * 6));

  // すり抜け: 通り抜ける建物のタイルへ向かう間と、その中心を過ぎて出ていく間は細くなってゆっくり歩く
  const squeezing = () => cat.path.length > 0 && (!!cat.thru || (cat.path.length > 1 && ctx.blocked(cat.path[0].x, cat.path[0].y)));
  cat.sq = squeezing();
  let rem = Math.min(catSpeedOf(s, cat) * (cat.away ? RUNAWAY.speed : 1) * (cat.sq ? SQUEEZE.speed : 1) * dt, maxStep);
  while (rem > 0 && cat.path.length > 0) {
    const t = target(s, ctx, cat);
    const d = Math.hypot(t.x - cat.x, t.y - cat.y);
    if (d <= rem) {
      cat.x = t.x;
      cat.y = t.y;
      const p = cat.path.shift()!;
      cat.nx = p.x;
      cat.ny = p.y;
      cat.thru = cat.path.length > 0 && ctx.blocked(p.x, p.y);
      rem -= d;
    } else {
      cat.x += ((t.x - cat.x) / d) * rem;
      cat.y += ((t.y - cat.y) / d) * rem;
      rem = 0;
    }
  }
}

/** 経路の次の点に向かうときの目標位置 */
function target(s: GameState, ctx: Ctx, cat: Cat) {
  const n = cat.path[0];
  const b = cat.path.length === 1 ? ctx.at(n.x, n.y) : undefined;
  if (b && cat.rest && cat.restAt === b.id && b.type === 'hq') {
    const slot = HQ_SLOTS[cat.slot % HQ_SLOTS.length];
    return { x: n.x + slot.x, y: n.y + slot.y };
  }
  if (b && FACILITY[b.type]) {
    const slot = SLOTS[b.type][cat.slot] ?? SLOTS[b.type][0];
    return { x: n.x + slot.x, y: n.y + slot.y };
  }
  if (b) {
    // 建物は、近づいた辺の外側で待つ。同じ辺に先客がいれば少しずつ外へ
    let ax = n.x - cat.nx;
    let ay = n.y - cat.ny;
    const l = Math.hypot(ax, ay) || 1;
    ax /= l;
    ay /= l;
    const side = ax > 0.5 ? 0 : ax < -0.5 ? 1 : ay > 0.5 ? 2 : 3;
    const key = b.id * 4 + side + 1;
    if (cat.spot !== key) cat.queue = Math.min(3, ctx.setSpot(cat, key));
    // 待つのは近づいてきた向きの左側（出ていく猫は反対側を通るので交差しない）
    const back = 0.62 + 0.16 * cat.queue;
    const lat = cat.lane;
    return { x: n.x - ax * back + ay * lat, y: n.y - ay * back - ax * lat };
  }
  if (cat.spot) ctx.setSpot(cat, 0);
  // 左側通行: 進行方向 (hx, hy) の左は (hy, -hx)。通り抜ける建物のタイルは、中心ではなく隣との隙間（タイルの端）を通る
  const off = cat.path.length > 1 && ctx.blocked(n.x, n.y) ? SQUEEZE.side : cat.off;
  return { x: n.x + cat.hy * off, y: n.y - cat.hx * off };
}

/** 押し離す対象（猫と犬） */
type Body = Pick<Cat, 'id' | 'x' | 'y' | 'hx' | 'hy' | 'path' | 'wait'> & { rest?: Rest | null; restAt?: number };

/** 近い猫同士（犬同士）を押し離す（歩いている猫は進行方向に垂直に）。1 回で押す量と行き先に上限がある */
function separate(list: Body[], ctx: Ctx) {
  const cell = 0.5;
  const hash = new Map<number, Body[]>();
  const free = (c: Body) => !(c.restAt && c.path.length === 0);
  for (const c of list) {
    if (!free(c)) continue;
    const k = cellKey(c.x, c.y, cell);
    const list = hash.get(k);
    if (list) list.push(c);
    else hash.set(k, [c]);
  }
  for (const a of list) {
    if (!free(a)) continue;
    const cx = Math.floor(a.x / cell);
    const cy = Math.floor(a.y / cell);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (const b of hash.get((cx + i) * 4099 + (cy + j)) ?? []) {
          if (b.id <= a.id) continue;
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          const d = Math.hypot(dx, dy);
          if (d >= SEPARATION) continue;
          if (d < 1e-6) {
            dx = a.hy;
            dy = -a.hx;
          } else {
            dx /= d;
            dy /= d;
          }
          const push = Math.min(0.04, (SEPARATION - d) / 2);
          nudge(ctx, a, dx, dy, push);
          nudge(ctx, b, -dx, -dy, push);
        }
  }
}

function nudge(ctx: Ctx, c: Body, ux: number, uy: number, amount: number) {
  if (c.path.length > 0 && !c.rest && c.wait <= 0) {
    // 歩いている猫は進行方向に垂直な向きだけに押す
    const side = Math.sign(ux * c.hy - uy * c.hx) || 1;
    ux = c.hy * side;
    uy = -c.hx * side;
  }
  const x = c.x + ux * amount;
  const y = c.y + uy * amount;
  const h = ctx.size / 2;
  if (Math.round(x) < -h || Math.round(x) >= h || Math.round(y) < -h || Math.round(y) >= h) return;
  // 建物にはめり込ませない（今いるタイルが建物なら、そのタイルの中だけは動ける）
  if (blocked(ctx, x, y) && (Math.round(x) !== Math.round(c.x) || Math.round(y) !== Math.round(c.y))) return;
  c.x = x;
  c.y = y;
}

function arrive(s: GameState, ctx: Ctx, cat: Cat, events: GameEvent[]) {
  const dst = ctx.byId.get(cat.dst);
  // 同じ建物で同時に取る・届ける猫は、出発をずらす
  if (s.cats.some((o) => o !== cat && !o.rest && Math.hypot(o.x - cat.x, o.y - cat.y) < 0.9)) cat.wait = 0.2 + rand(s) * 0.4;
  if (cat.state === 'toSource') {
    // 出荷元が故障していたら集荷しない（予約した分は戻す）
    const src = ctx.byId.get(cat.src);
    if (src && isBroken(src)) {
      if (src.type === 'hq' && cat.item) s.store[cat.item] = stock(s, cat.item) + cat.amount;
      else src.output += cat.amount;
      return drop(ctx, cat);
    }
    // ponytail: 途中で建物が撤去・経路が塞がれたら荷物は消える。再割当が要るならここで荷物を出荷元へ戻す
    const path = dst && src ? ctx.bfs(Math.round(cat.x), Math.round(cat.y)).path(dst.x, dst.y) : null;
    if (!path) return drop(ctx, cat);
    cat.state = 'toDest';
    cat.path = path;
    return;
  }
  // ponytail: 届け先が故障していたら荷物は諦める（届け先の選び直しはしない）
  if (dst && cat.item && !isBroken(dst)) {
    if (dst.type === 'hq') addStore(s, cat.item, cat.amount);
    // 運んでいる間に止められた建物の分は本部へ（入らなければ建物に置く）
    else dst.input[cat.item] = (dst.input[cat.item] ?? 0) + cat.amount - (dst.off ? toStore(s, cat.item, cat.amount) : 0);
  }
  // 届けた分は入力に入ったので、空きは変わらない（届け先の選び直しは要らない）
  if (cat.item) ctx.addIncoming(cat.dst, cat.item, -cat.amount);
  idle(cat);
}

/** 荷物を諦めて待機に戻る */
function drop(ctx: Ctx, cat: Cat) {
  if (cat.item) ctx.addIncoming(cat.dst, cat.item, -cat.amount);
  idle(cat);
}

function idle(cat: Cat) {
  cat.state = 'idle';
  cat.item = null;
  cat.amount = 0;
  cat.path = [];
}
