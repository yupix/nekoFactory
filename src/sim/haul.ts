import { BUILDINGS, ITEM_IDS, RECIPES, ROBOT, SQUEEZE, SUPPLY, type ItemId } from './data';
import { bfs, occupancy, type Bfs } from './path';
import { accepts, bufferCap, carryOf, gridSize, inputSpace, isBroken, keepOf, recipesOf, stock, storeCap, type Building, type Cat, type GameState } from './state';
import { outputFull, simOptions, type Ctx } from './tick';

/**
 * 運搬の割当（需要優先）。毎 tick、需要（入力が足りない建物）と供給（建物の出力・確保数を超える本部の在庫）を集め、
 * 優先度の段階で「出荷元 → 届け先」の組を作る。距離は同じ段階の中でだけ比べる:
 *   1 飢えた建物 ← 出力が満杯で止まっている出荷元 / 2 飢えた建物 ← その他の出荷元（本部を含む）/
 *   3 満杯で止まっている出荷元 → 受け取れる建物（なければ本部）/ 4 不足した建物 ← 出荷元 / 5 その他の出荷元 → 3 と同じ /
 *   6 本部 → 入力に空きのある建物（補充）
 * 3・5 段の届け先には、出力が満杯で止まっている建物は選ばない（本部にも届かないときの最後の手段だけ）。止まった建物の出力が別の止まった建物に詰め込まれず本部へ行くように。
 * 止まった出荷元（3 段）は不足（4 段）より先に拾う（運搬量の 1 回分を届けるたびに不足が再発して、止まった建物がいつまでも後回しにならないように）。
 * 段階の高い組から順に、その組の出荷元に一番近い待機中の猫を割り当てる。1 つの組には 1 tick に 1 匹まで。
 * 3 段だけは、満杯で止まってから（最後に拾われてから）長い出荷元から拾う（補充の速い近くの採掘機がいつも勝って、遠くの止まった建物が拾われ続けないように）
 */

export const inputTotal = (b: Building) => Object.values(b.input).reduce((a, n) => a + (n ?? 0), 0);
/** 1 回の生産でその品を使う数（研究所・兵器は 1） */
export function needOf(s: GameState, d: Building, item: ItemId) {
  let n = 1;
  for (const id of recipesOf(s, d)) n = Math.max(n, RECIPES[id].in[item] ?? 0);
  return n;
}

/** 運搬の仕事を待っている猫（職人・家出中・逃走中・充電が要るロボ猫を除く。仕事のない猫のひと休みは切り上げて来る） */
export const isFreeCarrier = (c: Cat) => c.state === 'idle' && !c.job && !c.away && c.flee <= 0 && (!c.rest || c.lazy) && !(c.robot && c.energy < ROBOT.low);

/** 届け先の品の数（運搬予定を含む）と空き。研究所は研究パックの合計、本部は倉庫 */
function room(s: GameState, ctx: Ctx, d: Building, item: ItemId) {
  if (d.type === 'hq') return { have: stock(s, item) + ctx.incomingTo(d.id, item), cap: storeCap(s) };
  if (d.type === 'lab') return { have: inputTotal(d) + ctx.incomingTo(d.id), cap: bufferCap(d) };
  return { have: (d.input[item] ?? 0) + ctx.incomingTo(d.id, item), cap: bufferCap(d) };
}
/** 需要の段階: 0 飢え（1 回分ない）/ 1 不足（2 回分ない）/ 2 足りている（出力が満杯で止まっている建物も） */
const levelOf = (have: number, need: number) => (have < need ? 0 : have < 2 * need ? 1 : 2);
/** 出荷元に今ある、運び出せる数（本部は確保数を超える分） */
const available = (s: GameState, src: Building, item: ItemId) => (src.type === 'hq' ? stock(s, item) - keepOf(s, item) : src.out === item ? src.output : 0);
/** 出力が満杯で止まっている */
const isFull = (s: GameState, b: Building) => b.type !== 'hq' && (b.output >= bufferCap(b) || outputFull(s, b));
/** 割当の段階（bucket の添字。小さいほど先） */
const P = { starvedFull: 1, starved: 2, stalled: 3, short: 4, surplus: 5, refill: 6 } as const;
/** 需要の組の段階（0 は組にしない） */
const demandP = (s: GameState, src: Building, level: number) => (level === 0 ? (isFull(s, src) ? P.starvedFull : P.starved) : level === 1 ? P.short : src.type === 'hq' ? P.refill : 0);

interface Pair {
  p: number;
  src: Building;
  item: ItemId;
  /** 届け先（3・5 段は割り当てるときに選び直す） */
  dst: Building;
  /** 同じ段の中で比べる距離（一番近い待機猫 → 出荷元 → 届け先） */
  dist: number;
  /** 本部から出す（同じ段では建物の出力の後） */
  late: boolean;
  /** 3 段: 出荷元が満杯で止まった回（古いほど先） */
  since: number;
}

/**
 * 3・5 段の届け先: 出荷元から一番近い、受け取れる建物（出力が満杯で止まっている建物を除く）。なければ本部。
 * 本部にも届かない・空きがなければ、一番近い止まっている建物（最後の手段。満杯の出荷元がいつまでも拾われないことはないように）
 */
function receiver(s: GameState, ctx: Ctx, src: Building, item: ItemId, from: Bfs) {
  let best: Building | null = null;
  let bestD = Infinity;
  let stalled: Building | null = null;
  let stalledD = Infinity;
  let hq: Building | null = null;
  for (const d of ctx.L.dsts[item]!) {
    if (d === src || isBroken(d)) continue;
    const r = room(s, ctx, d, item);
    if (r.have >= r.cap) continue;
    const dd = from.dist(d.x, d.y);
    if (dd < 0) continue;
    if (d.type === 'hq') hq = d;
    else if (isFull(s, d)) {
      if (dd < stalledD) (stalled = d), (stalledD = dd);
    } else if (dd < bestD) (best = d), (bestD = dd);
  }
  return best ?? hq ?? stalled;
}

/** 待機中の猫に運搬の仕事を割り当てる（tick の冒頭に 1 回） */
export function assignJobs(s: GameState, ctx: Ctx) {
  // 満杯で止まった出荷元の記録（待機猫がいない tick も数える）
  const L = ctx.L;
  L.clock++;
  for (const src of L.srcs) {
    if (src.type !== 'hq' && !isBroken(src) && isFull(s, src)) {
      if (!L.fullSince.has(src.id)) L.fullSince.set(src.id, L.clock);
    } else L.fullSince.delete(src.id);
  }
  const free = s.cats.filter(isFreeCarrier);
  if (!free.length) return;
  const tile = new Map(free.map((c) => [c, { x: Math.round(c.x), y: Math.round(c.y) }]));
  // 出荷元ごとの、一番近い待機猫までの距離（届かなければ組を作らない）
  const near = new Map<Building, number>();
  const catDist = (src: Building) => {
    let d = near.get(src);
    if (d !== undefined) return d;
    const from = ctx.fromBuilding(src);
    d = Infinity;
    for (const c of free) {
      const t = tile.get(c)!;
      const k = from.dist(t.x, t.y);
      if (k >= 0 && k < d) d = k;
    }
    near.set(src, d);
    return d;
  };

  // 供給（品ごと）: 建物の出力、確保数を超える本部の在庫
  const supply: Partial<Record<ItemId, Building[]>> = {};
  for (const src of ctx.L.srcs) {
    if (isBroken(src)) continue;
    if (src.type === 'hq') {
      for (const item of ITEM_IDS) if (available(s, src, item) > 0) (supply[item] ??= []).push(src);
    } else if (src.out && src.output > 0) (supply[src.out] ??= []).push(src);
  }

  const buckets: Pair[][] = [[], [], [], [], [], [], []];
  for (const item of Object.keys(supply) as ItemId[]) {
    const srcs = supply[item]!.filter((src) => catDist(src) < Infinity);
    if (!srcs.length) continue;
    // 需要（品ごとの届け先 × 出荷元）
    for (const d of ctx.L.dsts[item]!) {
      if (d.type === 'hq' || isBroken(d)) continue;
      const r = room(s, ctx, d, item);
      if (r.have >= r.cap) continue;
      // 出力が満杯で止まっている建物は材料ではなく出力の空きを待っているので、需要は「足りている」扱い
      const level = isFull(s, d) ? 2 : levelOf(r.have, needOf(s, d, item));
      for (const src of srcs) {
        if (src === d || (level === 2 && src.type !== 'hq')) continue;
        const dd = ctx.fromBuilding(src).dist(d.x, d.y);
        if (dd < 0) continue;
        const p = demandP(s, src, level);
        buckets[p].push({ p, src, item, dst: d, dist: catDist(src) + dd, late: src.type === 'hq' && !SUPPLY.includes(item), since: 0 });
      }
    }
    // 供給から（出荷元 → 受け取れる建物、なければ本部）
    for (const src of srcs) {
      if (src.type === 'hq') continue;
      const from = ctx.fromBuilding(src);
      const d = receiver(s, ctx, src, item, from);
      if (!d) continue;
      const p = isFull(s, src) ? P.stalled : P.surplus;
      buckets[p].push({ p, src, item, dst: d, dist: catDist(src) + from.dist(d.x, d.y), late: false, since: p === P.stalled ? (L.fullSince.get(src.id) ?? L.clock) : 0 });
    }
  }

  for (let p = 1; p < buckets.length && free.length; p++) {
    const list = buckets[p];
    list.sort((a, b) => +a.late - +b.late || a.since - b.since || a.dist - b.dist || a.src.id - b.src.id || a.dst.id - b.dst.id || ITEMS_INDEX[a.item] - ITEMS_INDEX[b.item]);
    for (let i = 0; i < list.length && free.length; i++) {
      const pair = list[i];
      const { src, item } = pair;
      const avail = available(s, src, item);
      if (avail <= 0) continue;
      let dst = pair.dst;
      const from = ctx.fromBuilding(src);
      const supplyPair = p === P.stalled || p === P.surplus;
      if (supplyPair) {
        const d = receiver(s, ctx, src, item, from);
        if (!d) continue;
        dst = d;
      }
      const r = room(s, ctx, dst, item);
      if (r.have >= r.cap) continue;
      if (!supplyPair) {
        // 先の割当で需要が満たされてきたら、その段階の組として後ろへ回す
        const level = isFull(s, dst) ? 2 : levelOf(r.have, needOf(s, dst, item));
        const now = demandP(s, src, level);
        if (now !== p) {
          if (now > p) buckets[now].push({ ...pair, p: now });
          continue;
        }
      }
      // その組の出荷元に一番近い待機猫
      let cat: Cat | null = null;
      let best = Infinity;
      for (const c of free) {
        const t = tile.get(c)!;
        const k = from.dist(t.x, t.y);
        if (k >= 0 && k < best) (best = k), (cat = c);
      }
      if (!cat) continue;
      free.splice(free.indexOf(cat), 1);
      take(s, ctx, cat, src, item, dst, Math.min(carryOf(s, cat), avail, r.cap - r.have), from, tile.get(cat)!);
    }
  }
}
const ITEMS_INDEX = Object.fromEntries(ITEM_IDS.map((id, i) => [id, i])) as Record<ItemId, number>;

/** 出力から即座に差し引いて予約し、出荷元へ向かわせる（仕事のない猫のひと休みは切り上げる） */
function take(s: GameState, ctx: Ctx, cat: Cat, src: Building, item: ItemId, dst: Building, amount: number, from: Bfs, t: { x: number; y: number }) {
  if (src.type === 'hq') s.store[item] = stock(s, item) - amount;
  else src.output -= amount;
  // 拾われたら「満杯で止まった時刻」を数え直す
  ctx.L.fullSince.delete(src.id);
  if (cat.rest) {
    cat.rest = null;
    cat.restT = 0;
    cat.lazy = false;
    ctx.setRestAt(cat, 0);
  }
  cat.state = 'toSource';
  cat.item = item;
  cat.amount = amount;
  cat.src = src.id;
  cat.dst = dst.id;
  cat.retry = 0;
  ctx.addIncoming(dst.id, item, amount);
  // 猫 → 出荷元の経路は、出荷元 → 猫の経路の逆順（グリッドは無向）
  cat.path = simOptions.reversePath ? from.pathBack(t.x, t.y)! : ctx.bfs(t.x, t.y).path(src.x, src.y)!;
}

// --- 運搬の状況（建物カードの材料待ちの行） ---

/** 盤面ごとの、建物を起点とする BFS（UI 用。配置が変わったら捨てる） */
let uiBfs: { ver: number; size: number; map: Map<number, Bfs> } | null = null;
function reach(s: GameState, b: Building) {
  const size = gridSize(s);
  if (!uiBfs || uiBfs.ver !== s.layoutVersion || uiBfs.size !== size) uiBfs = { ver: s.layoutVersion, size, map: new Map() };
  let r = uiBfs.map.get(b.id);
  if (!r) uiBfs.map.set(b.id, (r = bfs(size, occupancy(size, s.buildings), b.x, b.y, SQUEEZE.cost)));
  return r;
}
const coord = (n: number) => (n < 0 ? `−${-n}` : String(n));

export interface HaulRow {
  item: ItemId;
  /** 品のある場所（「採掘機 (−6, 4) の出力に 10」「本部に 58（確保 10）」） */
  where: string[];
  /** 運ばれない理由か、運搬中の表示（null は表示なし） */
  reason: string | null;
}

/**
 * 建物が待っている材料（入力が 1 回分に足りない品）ごとの、品の所在と運ばれない理由。
 * 理由: 猫が運んでいる / 予約済み（ほかへ運ぶ途中）/ 本部の在庫が確保数以下 / 道が通じていない / 運び手がいない / 別の建物が優先 / 割り当て待ち
 */
export function haulStatus(s: GameState, b: Building, items: ItemId[]): HaulRow[] {
  const rows: HaulRow[] = [];
  const from = reach(s, b);
  const carriers = s.cats.filter((c) => !c.job && !c.away);
  for (const item of items) {
    if ((b.input[item] ?? 0) >= needOf(s, b, item)) continue;
    const coming = s.cats.reduce((a, c) => a + (c.state !== 'idle' && c.dst === b.id && c.item === item ? c.amount : 0), 0);
    const where: string[] = [];
    let reachable = false;
    let any = false;
    const outs = s.buildings.filter((x) => x !== b && x.type !== 'hq' && x.out === item && x.output > 0).sort((a, c) => c.output - a.output);
    for (const x of outs) {
      if (where.length < 2) where.push(`${BUILDINGS[x.type].name} (${coord(x.x)}, ${coord(x.y)}) の出力に ${x.output}`);
      any = true;
      if (from.dist(x.x, x.y) >= 0) reachable = true;
    }
    const hq = s.buildings.find((x) => x.type === 'hq');
    const n = stock(s, item);
    if (hq && n > 0) {
      where.push(`本部に ${n}（確保 ${keepOf(s, item)}）`);
      if (n > keepOf(s, item)) {
        any = true;
        if (from.dist(hq.x, hq.y) >= 0) reachable = true;
      }
    }
    const reserved = s.cats.some((c) => c.state === 'toSource' && c.item === item && c.dst !== b.id);
    const reason = coming
      ? `猫が運んでいる（${coming} 個）`
      : !any
        ? reserved
          ? '予約済み（ほかの建物へ運ぶ途中）'
          : hq && n > 0
            ? '本部の在庫が確保数以下'
            : null
        : !reachable
          ? '道が通じていない'
          : !carriers.length
            ? '運び手がいない'
            : !carriers.some(isFreeCarrier)
              ? '別の建物が優先'
              : '割り当て待ち';
    if (where.length || reason) rows.push({ item, where, reason });
  }
  return rows;
}

/**
 * 出力が満杯で止まっている建物の、出力が運び出されない理由。受け取れる建物か本部に空きがあり道が通じていれば運び手待ち
 * （運び手がいない・みんな手がふさがっているならそう言う）、本部まで道が通じていて満杯なら倉庫がいっぱい、本部まで道が通じていなければ道がない
 */
export function outputStatus(s: GameState, b: Building): string {
  const item = b.out;
  const from = reach(s, b);
  const hq = s.buildings.find((x) => x.type === 'hq');
  const carriers = s.cats.filter((c) => !c.job && !c.away);
  const waiting = !carriers.length
    ? '運び手がいません。猫を雇うか、職人を運び屋に戻そう'
    : !carriers.some(isFreeCarrier)
      ? `運び手（${carriers.length} 匹）がみんなほかの運搬か休憩中です。猫を雇うと早く運ばれます`
      : '運び手を待っています';
  if (item)
    for (const d of s.buildings)
      if (d !== b && d.type !== 'hq' && !isBroken(d) && accepts(s, d, item) && inputSpace(s, d, item) > 0 && from.dist(d.x, d.y) >= 0) return waiting;
  if (!hq || from.dist(hq.x, hq.y) < 0) return '道が通じていません';
  return item && inputSpace(s, hq, item) > 0 ? waiting : '倉庫がいっぱいです';
}
