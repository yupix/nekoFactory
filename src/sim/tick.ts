import { BUILDINGS, CRAFT_FATIGUE, FACILITY, ITEMS, STAT_GROWTH, TEMPERS, WORK_STAT, type ItemId, type StatId } from './data';
import { bfs, occupancy, type Bfs } from './path';
import { bufferCap, carryOf, catSpeedOf, endRest, facilityCap, facilityRecover, fatigueRate, gridSize, isWorking, labBonus, marketBonus, productionSpeed, rand, statBonus, statLevel, tierSpeed, tradeMultiplier, type Building, type Cat, type GameState, type Rest } from './state';

/** 市場への納品と研究所の消費（浮遊テキスト用）、猫のステータスの Lv UP（cat と stat 付き） */
export interface GameEvent {
  kind: 'coin' | 'rp' | 'lvup';
  amount: number;
  x: number;
  y: number;
  cat?: number;
  stat?: StatId;
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
};
/** 職人の作業位置を探す辺の順（+y が正面）と、建物の中心からの距離 */
const WORK_SIDES = [[0, 1], [-1, 0], [1, 0], [0, -1]] as const;
const WORK_DIST = 0.62;

/**
 * 同値性テスト用の切り替え。retry: 仕事が見つからなかった猫が次に探すまでの秒数（0 で毎 tick 探す）。
 * reversePath: 出荷元へ向かう経路を出荷元の BFS の逆順で引く（false なら猫起点の BFS。距離は同じで、同じ長さの経路の選び方だけが違う）
 */
export const simOptions = { retry: 0.5, reversePath: true };

/** dt 秒進める。発生した納品イベントを返す */
export function tick(s: GameState, dt: number): GameEvent[] {
  const events: GameEvent[] = [];
  const speed = productionSpeed(s);
  const ctx = new Ctx(s);
  // 作業中の職人の生産ボーナス（2 匹なら乗算）
  const bonus = new Map<number, number>();
  for (const c of s.cats) {
    const b = isWorking(c) ? ctx.byId.get(c.job) : undefined;
    if (b) bonus.set(b.id, (bonus.get(b.id) ?? 1) * statBonus(c, b.type));
  }
  for (const b of s.buildings) produce(s, b, dt * speed * tierSpeed(b) * (bonus.get(b.id) ?? 1), events);

  const coinsBefore = s.coins;
  for (const cat of s.cats) {
    if (cat.retry > 0) cat.retry -= dt;
    if (rest(s, ctx, cat, dt)) continue;
    if (cat.state === 'idle') {
      if (cat.job) craft(s, ctx, cat, dt);
      else {
        assignJob(s, ctx, cat);
        if (cat.state === 'idle') idleBehavior(s, ctx, cat, dt);
      }
    }
    move(s, ctx, cat, dt);
    if (cat.state !== 'idle' && cat.path.length === 0 && cat.wait <= 0) arrive(s, ctx, cat, events);
    // 働いている間だけ疲れ、ステータスが伸びる（職人は建物が稼働している間）
    const job = cat.state === 'idle' && cat.work ? ctx.byId.get(cat.job) : undefined;
    if (cat.state !== 'idle' || job?.running)
      cat.energy = Math.max(0, cat.energy - (dt / cat.stamina) * fatigueRate(s) * TEMPERS[cat.temper].fatigue * (job ? CRAFT_FATIGUE : 1));
    if (cat.state !== 'idle') {
      grow(cat, 'leg', dt, events);
      if (cat.amount >= 2) grow(cat, 'str', dt, events);
    } else if (job?.running) grow(cat, WORK_STAT[job.type]!, dt, events);
  }
  separate(s, ctx);
  s.incomeRate += ((s.coins - coinsBefore) / dt - s.incomeRate) * Math.min(1, dt / 60);
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

const inputTotal = (b: Building) => Object.values(b.input).reduce((a, n) => a + n, 0);

export function hasInputs(b: Building) {
  if (b.type === 'lab') return inputTotal(b) > 0;
  const inputs = BUILDINGS[b.type].inputs;
  return (Object.keys(inputs) as ItemId[]).every((i) => (b.input[i] ?? 0) >= inputs[i]!);
}

function produce(s: GameState, b: Building, dt: number, events: GameEvent[]) {
  const def = BUILDINGS[b.type];
  if (!def.time) return;
  if (!b.running) {
    if (b.output >= bufferCap(b) || !hasInputs(b)) return;
    // 研究所は消費完了時に入力から取り出す（処理中の 1 個も入力上限に数える）
    if (b.type !== 'lab') for (const i of Object.keys(def.inputs) as ItemId[]) b.input[i]! -= def.inputs[i]!;
    b.running = true;
    b.progress = 0;
  }
  b.progress += dt;
  if (b.progress >= def.time - EPS) {
    if (b.type === 'lab') {
      const item = (Object.keys(b.input) as ItemId[]).find((i) => b.input[i]! > 0)!;
      b.input[item]!--;
      const amount = Math.round(Math.ceil(ITEMS[item].value / 5) * labBonus(b));
      s.rp += amount;
      events.push({ kind: 'rp', amount, x: b.x, y: b.y });
    } else b.output++;
    b.running = false;
    b.progress = 0;
  }
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
  /** 出力を持つ建物（並び順は s.buildings のまま） */
  srcs: Building[];
  /** アイテムごとの届け先の候補（市場・研究所・その品を入力に取る加工建物） */
  dsts: Partial<Record<ItemId, Building[]>>;
  /** 建物を起点とする BFS */
  from: Map<number, Bfs>;
}
let layout: Layout | null = null;

function getLayout(s: GameState): Layout {
  if (layout && layout.state === s && layout.version === s.layoutVersion) return layout;
  const size = gridSize(s);
  const h = size / 2;
  const byPos: (Building | undefined)[] = new Array(size * size);
  for (const b of s.buildings) byPos[(b.y + h) * size + b.x + h] = b;
  const dsts: Layout['dsts'] = {};
  for (const item of Object.keys(ITEMS) as ItemId[])
    dsts[item] = s.buildings.filter((d) => d.type === 'market' || d.type === 'lab' || BUILDINGS[d.type].inputs[item]);
  // 盤面が変わったら、仕事を探すのを待っている猫もすぐ探し直す
  for (const c of s.cats) c.retry = 0;
  return (layout = {
    state: s,
    version: s.layoutVersion,
    size,
    grid: occupancy(size, s.buildings),
    byId: new Map(s.buildings.map((b) => [b.id, b])),
    byPos,
    srcs: s.buildings.filter((b) => BUILDINGS[b.type].output),
    dsts,
    from: new Map(),
  });
}

const ITEM_INDEX = Object.fromEntries((Object.keys(ITEMS) as ItemId[]).map((id, i) => [id, i])) as Record<ItemId, number>;
/** incoming のキー（item 省略時はその建物の全アイテムの合計） */
const incKey = (id: number, item?: ItemId) => id * 8 + (item ? ITEM_INDEX[item] : 7);

/** 出荷元ごとの届け先の選択（猫の位置によらない） */
interface Choice {
  dst: Building;
  dist: number;
  space: number;
}

/** tick 内で使い回す情報。tick の冒頭に 1 回集計し、割当や状態の変化に合わせて更新する */
class Ctx {
  L: Layout;
  size: number;
  byId: Map<number, Building>;
  /** 運搬中の猫が届ける予定の量 */
  private incoming = new Map<number, number>();
  /** 出荷元 id → 届け先の選択（null は届け先なし） */
  private choices = new Map<number, Choice | null>();
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
  bfs(x: number, y: number) {
    return bfs(this.size, this.L.grid, x, y);
  }
  fromBuilding(b: Building) {
    let r = this.L.from.get(b.id);
    if (!r) this.L.from.set(b.id, (r = this.bfs(b.x, b.y)));
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
  /** 届ける予定の量を足す（負なら引く）。空きが変わるなら、影響する出荷元の届け先を選び直す */
  addIncoming(id: number, item: ItemId, n: number, changesSpace = true) {
    for (const k of [incKey(id, item), incKey(id)]) this.incoming.set(k, (this.incoming.get(k) ?? 0) + n);
    if (!changesSpace) return;
    if (n > 0) {
      // 空きが減った届け先を選んでいた出荷元だけ選び直す
      for (const [src, c] of this.choices) if (c?.dst.id === id) this.choices.delete(src);
    } else this.choices.clear();
  }
  /** 出荷元の品の届け先: 入力に空きのある加工建物・研究所(0) > 市場(1)、同じ優先度なら近い方 */
  choice(src: Building, item: ItemId): Choice | null {
    let c = this.choices.get(src.id);
    if (c !== undefined) return c;
    const from = this.fromBuilding(src);
    let tier = 2;
    c = null;
    for (const d of this.L.dsts[item]!) {
      let t: number;
      let cap = Infinity;
      if (d.type === 'market') t = 1;
      else {
        t = 0;
        cap = d.type === 'lab' ? bufferCap(d) - inputTotal(d) - this.incomingTo(d.id) : bufferCap(d) - (d.input[item] ?? 0) - this.incomingTo(d.id, item);
        if (cap <= 0) continue;
      }
      if (t > tier) continue;
      const dd = from.dist(d.x, d.y);
      if (dd < 0 || (c && t === tier && dd >= c.dist)) continue;
      c = { dst: d, dist: dd, space: cap };
      tier = t;
    }
    this.choices.set(src.id, c);
    return c;
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

function assignJob(s: GameState, ctx: Ctx, cat: Cat) {
  // 職人は運搬ジョブを取らない
  if (cat.retry > 0 || cat.job) return;
  const cx = Math.round(cat.x);
  const cy = Math.round(cat.y);
  let best: { src: Building; item: ItemId; c: Choice; from: Bfs } | null = null;
  let bestTotal = Infinity;
  // 猫からの距離は、出荷元の BFS で猫のタイルまでの距離を見る（無向なので同じ）
  for (const src of ctx.L.srcs) {
    if (src.output <= 0) continue;
    const from = ctx.fromBuilding(src);
    const dCat = from.dist(cx, cy);
    if (dCat < 0 || dCat >= bestTotal) continue;
    const item = BUILDINGS[src.type].output!;
    const c = ctx.choice(src, item);
    if (c && dCat + c.dist < bestTotal) {
      best = { src, item, c, from };
      bestTotal = dCat + c.dist;
    }
  }
  if (!best) {
    // 見つからなければしばらく探さない（猫 id で探す tick をずらす）
    if (simOptions.retry) cat.retry = simOptions.retry + 0.1 * (cat.id % 5);
    return;
  }

  // 出力から即座に差し引いて予約する
  const { src, item, c } = best;
  const amount = Math.min(carryOf(s, cat), src.output, c.space);
  src.output -= amount;
  cat.state = 'toSource';
  cat.item = item;
  cat.amount = amount;
  cat.src = src.id;
  cat.dst = c.dst.id;
  ctx.addIncoming(c.dst.id, item, amount);
  // 猫 → 出荷元の経路は、出荷元 → 猫の経路の逆順
  cat.path = simOptions.reversePath ? best.from.pathBack(cx, cy)! : ctx.bfs(cx, cy).path(src.x, src.y)!;
}

/** 疲れによる休憩の始まりやすさ（毎秒の確率）。0.3 を切ると急に上がる */
export function restChance(energy: number) {
  if (energy > 0.6) return 0;
  if (energy > 0.3) return (0.02 * (0.6 - energy)) / 0.3;
  return 0.02 + 0.3 * ((0.3 - energy) / 0.3) ** 2;
}

/** 休憩に入る。10 タイル以内に空いた施設があればそこへ歩いて行く（荷物は背負ったまま） */
function startRest(s: GameState, ctx: Ctx, cat: Cat, kind: Rest, lazy: boolean) {
  cat.rest = kind;
  cat.lazy = lazy;
  // 職人は休憩の間は作業しない（終わったら作業位置へ戻る）
  cat.work = false;
  ctx.setRestAt(cat, 0);
  let from: Bfs | null = null;
  let best: { b: Building; d: number; slot: number } | null = null;
  for (const b of s.buildings) {
    const def = FACILITY[b.type];
    if (!def || !def.kinds.includes(kind)) continue;
    const used = ctx.slots(b.id);
    if (used.length >= facilityCap(b)) continue;
    from ??= ctx.bfs(Math.round(cat.x), Math.round(cat.y));
    const d = from.dist(b.x, b.y);
    if (d < 0 || d > FACILITY_RANGE || (best && d >= best.d)) continue;
    let slot = 0;
    while (used.includes(slot)) slot++;
    best = { b, d, slot };
  }
  if (best && from) {
    cat.slot = best.slot;
    ctx.setRestAt(cat, best.b.id);
    cat.path = from.path(best.b.x, best.b.y)!;
    cat.restT = FACILITY[best.b.type]!.time;
  } else cat.restT = kind === 'sleep' ? (lazy ? 6 + rand(s) * 8 : 8 + rand(s) * 7) : 3 + rand(s) * 3;
}

/** 休憩の進行と開始。休憩中（施設へ向かう途中を含む）で、この tick はほかに動かないなら true */
function rest(s: GameState, ctx: Ctx, cat: Cat, dt: number): boolean {
  if (cat.rest && cat.lazy) {
    // 仕事のない猫の休憩は、仕事が来たら（職人に配属されたら）切り上げる
    assignJob(s, ctx, cat);
    if (cat.state !== 'idle' || cat.job) {
      if (cat.job) cat.path = [];
      cat.rest = null;
      cat.restT = 0;
      cat.lazy = false;
      ctx.setRestAt(cat, 0);
      return false;
    }
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
    const gain = f ? FACILITY[f.type]!.gain * facilityRecover(f) : cat.rest === 'play' ? 0.3 : 1;
    cat.energy = Math.min(1, cat.energy + gain * TEMPERS[cat.temper].recover);
    finishRest(s, ctx, cat);
    cat.wait = 0.3; // 起きてすぐは少し伸びをする
    return false;
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
function move(s: GameState, ctx: Ctx, cat: Cat, dt: number) {
  if (cat.wait > 0) {
    cat.wait -= dt;
    return;
  }
  if (cat.path.length === 0) return;
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

  let rem = Math.min(catSpeedOf(s, cat) * dt, maxStep);
  while (rem > 0 && cat.path.length > 0) {
    const t = target(s, ctx, cat);
    const d = Math.hypot(t.x - cat.x, t.y - cat.y);
    if (d <= rem) {
      cat.x = t.x;
      cat.y = t.y;
      const p = cat.path.shift()!;
      cat.nx = p.x;
      cat.ny = p.y;
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
  // 左側通行: 進行方向 (hx, hy) の左は (hy, -hx)
  return { x: n.x + cat.hy * cat.off, y: n.y - cat.hx * cat.off };
}

/** 近い猫同士を押し離す（歩いている猫は進行方向に垂直に）。1 回で押す量と行き先に上限がある */
function separate(s: GameState, ctx: Ctx) {
  const cell = 0.5;
  const hash = new Map<number, Cat[]>();
  const free = (c: Cat) => !(c.restAt && c.path.length === 0);
  for (const c of s.cats) {
    if (!free(c)) continue;
    const k = cellKey(c.x, c.y, cell);
    const list = hash.get(k);
    if (list) list.push(c);
    else hash.set(k, [c]);
  }
  for (const a of s.cats) {
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

function nudge(ctx: Ctx, c: Cat, ux: number, uy: number, amount: number) {
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
    // ponytail: 途中で建物が撤去・経路が塞がれたら荷物は消える。再割当が要るならここで assignJob し直す
    const path = dst && ctx.byId.has(cat.src) ? ctx.bfs(Math.round(cat.x), Math.round(cat.y)).path(dst.x, dst.y) : null;
    if (!path) return drop(ctx, cat);
    cat.state = 'toDest';
    cat.path = path;
    return;
  }
  if (dst && cat.item) {
    const value = ITEMS[cat.item].value;
    if (dst.type === 'market') {
      const amount = Math.floor(value * cat.amount * tradeMultiplier(s) * marketBonus(dst));
      s.coins += amount;
      events.push({ kind: 'coin', amount, x: dst.x, y: dst.y });
    } else {
      dst.input[cat.item] = (dst.input[cat.item] ?? 0) + cat.amount;
    }
  }
  // 届けた分は入力に入ったので、空きは変わらない（届け先の選び直しは要らない）
  if (cat.item) ctx.addIncoming(cat.dst, cat.item, -cat.amount, false);
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
