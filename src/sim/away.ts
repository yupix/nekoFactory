import { RING, RUNAWAY } from './data';
import { addStore, assignCat, awayRate, bufferCap, catSpeedOf, isLeaving, rand, type Cat, type GameState } from './state';
import { move, simOptions, type Ctx, type GameEvent } from './tick';

/** 野原の外側から水際までの距離（render/world.ts の砂浜の坂が水面 y=-0.22 を切る位置） */
export const WATERLINE = 1.15;
/** 外向きの軸で、水際の位置（sim の座標。表示はタイルの中心が +0.5） */
const shoreAt = (ctx: Ctx, k: number) => k * (ctx.size / 2 + RING + WATERLINE) - 0.5;
/** 外向きの軸で、岸から沖へ出た距離 */
function offshore(ctx: Ctx, c: Cat) {
  const a = c.away!;
  return a.dx ? (c.x - shoreAt(ctx, a.dx)) * a.dx : (c.y - shoreAt(ctx, a.dy)) * a.dy;
}
/** 岸の上の点（外周のタイルから外へまっすぐ。o は岸からの距離） */
function shorePoint(ctx: Ctx, c: Cat, o: number) {
  const a = c.away!;
  return a.dx ? { x: shoreAt(ctx, a.dx) + o * a.dx, y: a.ey } : { x: a.ex, y: shoreAt(ctx, a.dy) + o * a.dy };
}

/** (x, y) へまっすぐ step だけ進む。着いたら true */
function toward(c: Cat, x: number, y: number, step: number) {
  const d = Math.hypot(x - c.x, y - c.y);
  if (d <= step) {
    c.x = x;
    c.y = y;
    return true;
  }
  c.hx = (x - c.x) / d;
  c.hy = (y - c.y) / d;
  c.x += c.hx * step;
  c.y += c.hy * step;
  return false;
}

/**
 * 家出の 1 tick（猫の行動の前）: 引き止めの残り時間、沖へ出きった猫を名簿から消す、新しい家出の発生判定。
 * 開始 10 分・1 件ごとの 2 分・襲撃中・家出中の猫がいる間は起きない（hidden とオフラインは tick が進まない）
 */
export function awayTick(s: GameState, ctx: Ctx, dt: number, events: GameEvent[]) {
  const r = s.runaway;
  for (let i = s.cats.length - 1; i >= 0; i--) {
    const c = s.cats[i];
    if (c.stay) c.stay = Math.max(0, c.stay - dt);
    if (c.away?.phase !== 'raft' || offshore(ctx, c) < RUNAWAY.raft) continue;
    s.cats.splice(i, 1);
    r.gone.unshift(c.name);
    r.gone.length = Math.min(r.gone.length, 3);
    r.cd = RUNAWAY.gap;
    events.push({ kind: 'gone', amount: 0, x: c.x, y: c.y, cat: c.id, name: c.name });
  }
  if (r.cd > 0) r.cd -= dt;
  if (r.cd > 0 || s.raid.cur || s.cats.some((c) => c.away)) return;
  for (const c of s.cats) {
    if (c.robot || c.rest || c.flee > 0 || (c.stay ?? 0) > 0) continue;
    if (rand(r) < (simOptions.runaway * awayRate(s, c) * dt) / 60 && startAway(s, ctx, c, events)) return;
  }
}

/** 家出を始める: 仕事を捨て（運搬中の品は出荷元へ戻す。入らなければ消える）、職人は配属を外れ、最寄りの外周タイルへ歩く */
export function startAway(s: GameState, ctx: Ctx, c: Cat, events: GameEvent[]) {
  const h = ctx.size / 2;
  const cx = Math.round(c.x);
  const cy = Math.round(c.y);
  if (cx < -h || cx >= h || cy < -h || cy >= h) return false;
  const from = ctx.bfs(cx, cy);
  let e: { x: number; y: number } | null = null;
  for (const i of from.order()) {
    const p = from.cell(i);
    if ((p.x === -h || p.x === h - 1 || p.y === -h || p.y === h - 1) && (!ctx.blocked(p.x, p.y) || (p.x === cx && p.y === cy))) {
      e = p;
      break;
    }
  }
  // 囲われていて外周へ出られない猫は家出しない
  if (!e) return false;
  if (c.state !== 'idle' && c.item) {
    const src = ctx.byId.get(c.src);
    if (src?.type === 'hq') addStore(s, c.item, c.amount);
    else if (src && (src.out === c.item || src.output <= 0)) {
      src.out = c.item;
      src.output = Math.min(bufferCap(src), src.output + c.amount);
    }
    ctx.addIncoming(c.dst, c.item, -c.amount);
  }
  const dx = e.x === h - 1 ? 1 : e.x === -h ? -1 : 0;
  c.away = { phase: 'walk', ex: e.x, ey: e.y, dx, dy: dx ? 0 : e.y === h - 1 ? 1 : -1, job: c.job };
  c.state = 'idle';
  c.item = null;
  c.amount = 0;
  c.job = 0;
  c.work = false;
  c.wait = 0;
  c.retry = 0;
  ctx.setSpot(c, 0);
  c.path = from.path(e.x, e.y) ?? [];
  events.push({ kind: 'away', amount: 0, x: c.x, y: c.y, cat: c.id });
  return true;
}

/** 家出中の猫の動き（休憩・なまけ・犬からの逃走はしない） */
export function stepAway(s: GameState, ctx: Ctx, c: Cat, dt: number) {
  const a = c.away!;
  const speed = catSpeedOf(s, c);
  switch (a.phase) {
    case 'walk':
      if (c.path.length) move(s, ctx, c, dt);
      else a.phase = 'beach';
      break;
    case 'beach': {
      const p = shorePoint(ctx, c, 0.35);
      if (toward(c, p.x, p.y, speed * RUNAWAY.speed * dt)) a.phase = 'raft';
      break;
    }
    case 'raft': {
      const p = shorePoint(ctx, c, RUNAWAY.raft + 1);
      toward(c, p.x, p.y, RUNAWAY.drift * dt);
      break;
    }
    case 'swim': {
      const p = shorePoint(ctx, c, -0.3);
      if (toward(c, p.x, p.y, RUNAWAY.swim * dt)) {
        a.phase = 'back';
        c.wait = 0.9; // 岸で体を振るう
      }
      break;
    }
    case 'back':
      if (c.wait > 0) c.wait -= dt;
      else if (toward(c, a.ex, a.ey, speed * dt)) resume(s, c);
      break;
  }
}

/** 家出をやめて元の役割へ戻す（職人なら配属先が空いていれば再配属） */
function resume(s: GameState, c: Cat) {
  const job = c.away!.job;
  c.away = null;
  c.path = [];
  c.wait = 0;
  c.nx = Math.round(c.x);
  c.ny = Math.round(c.y);
  if (job && !c.job) assignCat(s, c.id, job);
}

/** 家出中の猫を引き止める。元気 +0.3、10 分は家出しない。いかだからは泳いで、浜からは歩いて島へ戻る */
export function keepCat(s: GameState, id: number): string | null {
  const c = s.cats.find((x) => x.id === id);
  if (!c || !isLeaving(c)) return '家出していません';
  c.energy = Math.min(1, c.energy + RUNAWAY.energy);
  c.stay = RUNAWAY.stay;
  s.runaway.cd = RUNAWAY.gap;
  const a = c.away!;
  if (a.phase === 'walk') resume(s, c);
  else a.phase = a.phase === 'beach' ? 'back' : 'swim';
  return null;
}
