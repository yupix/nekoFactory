import { DOGS, RAID, RING, WEAPONS, type DogKind } from './data';
import { gridSize, isBroken, maxHp, rand, weaponDamage, weaponRange, type Boat, type Dog, type GameState, type Raid } from './state';
import type { Ctx, GameEvent } from './tick';

/** 沖から接岸までと、帰りの秒数。沖の距離（タイル） */
const SAIL = 5;
const LEAVE = 6;
const OFFSHORE = 16;
/** 接岸してから最初の犬が降りるまでと、次の犬までの秒数 */
const DROP_DELAY = 2;
const DROP_EVERY = 0.45;
/** 接岸位置は敷地の端からこの距離の海 */
const DOCK = RING + 2;

export const waveSize = (n: number) => Math.min(3 + 2 * n, 40);
export const waveHp = (n: number) => 30 * 1.15 ** n;
export const waveAtk = (n: number) => 5 * 1.1 ** n;
/** 船の表示位置（接岸位置から沖へのずれ、0〜OFFSHORE） */
export function boatOffset(b: Boat) {
  if (b.state === 'in') return OFFSHORE * (1 - Math.min(1, b.t / SAIL)) ** 2;
  if (b.state === 'out') return OFFSHORE * Math.min(1, b.t / LEAVE) ** 2;
  return 0;
}

/** ウェーブが進むほど番犬・ブルドッグが増える */
function pickKind(s: GameState, n: number): DogKind {
  const bull = Math.min(0.45, 0.05 * (n - 1));
  const pup = Math.max(0.15, 0.8 - 0.06 * n);
  const r = rand(s);
  return r < bull ? 'bulldog' : r < bull + pup ? 'puppy' : 'guard';
}

/** ウェーブ s.raid.wave を始める: 犬を作って船に乗せ、島のランダムな辺へ向かわせる */
export function startWave(s: GameState, events: GameEvent[]) {
  const n = s.raid.wave;
  const h = gridSize(s) / 2;
  const raid: Raid = { wave: n, t: 0, landed: false, dogs: [], boats: [], shots: [], result: null, nextId: 1, total: 0 };
  const kinds = Array.from({ length: waveSize(n) }, () => pickKind(s, n));
  if (n % 5 === 0) kinds.push('boss');
  const nb = Math.ceil(kinds.length / 5);
  for (let i = 0; i < nb; i++) {
    const [nx, ny] = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const)[Math.floor(rand(s) * 4)];
    // 辺の上で散らし、本部からの直線上を沖から来る
    const lat = (rand(s) * 2 - 1) * Math.max(1, h - 2);
    const d = h + DOCK;
    const x = nx ? nx * d : lat;
    const y = ny ? ny * d : lat;
    const l = Math.hypot(x, y);
    raid.boats.push({ id: raid.nextId++, x, y, dx: x / l, dy: y / l, t: 0, state: 'in', cargo: [] });
  }
  kinds.forEach((kind, i) => {
    const def = DOGS[kind];
    const boat = raid.boats[i % nb];
    const hp = waveHp(n) * def.hp;
    boat.cargo.push({ id: raid.nextId++, kind, x: boat.x, y: boat.y, hx: -boat.dx, hy: -boat.dy, hp, max: hp, atk: waveAtk(n) * def.atk, speed: RAID.dogSpeed * def.speed, state: 'land', path: [], target: 0, boat: boat.id, ex: 0, ey: 0, ver: -1, wait: 0 });
  });
  raid.total = kinds.length;
  s.raid.cur = raid;
  events.push({ kind: 'wave', amount: n, x: 0, y: 0 });
}

/** 船が着いた辺の外向きの向き */
const sideOf = (b: Boat) => (Math.abs(b.x) > Math.abs(b.y) ? [Math.sign(b.x), 0] : [0, Math.sign(b.y)]);

/** 船の辺で、敷地に入れる（建物のない）端のタイルを接岸位置の近くから探す */
function entry(s: GameState, ctx: Ctx, boat: Boat) {
  const h = ctx.size / 2;
  const [nx, ny] = sideOf(boat);
  const edge = (nx || ny) > 0 ? h - 1 : -h;
  const lat = (nx ? boat.y : boat.x) + (rand(s) - 0.5) * 3;
  const u0 = Math.max(-h, Math.min(h - 1, Math.round(lat)));
  const at = (u: number) => (nx ? { x: edge, y: u } : { x: u, y: edge });
  for (let k = 0; k < ctx.size; k++)
    for (const u of [u0 + k, u0 - k]) {
      if (u < -h || u >= h) continue;
      const t = at(u);
      if (!ctx.blocked(t.x, t.y)) return t;
    }
  return at(u0);
}

/** 浜から敷地の端のタイルまでの道（入口が塞がれていれば外側で止まる） */
function landPath(s: GameState, ctx: Ctx, dog: Dog, boat: Boat) {
  const e = entry(s, ctx, boat);
  const [nx, ny] = sideOf(boat);
  dog.ex = e.x;
  dog.ey = e.y;
  dog.path = [{ x: boat.x - boat.dx * 1.4, y: boat.y - boat.dy * 1.4 }, { x: e.x + nx, y: e.y + ny }];
  if (!ctx.blocked(e.x, e.y)) dog.path.push(e);
}

const inGrid = (ctx: Ctx, x: number, y: number) => {
  const h = ctx.size / 2;
  return x >= -h && x < h && y >= -h && y < h;
};

/** 自由タイルの BFS で最初に触れた（壊れていない）建物を標的にし、その隣まで歩く */
function seek(s: GameState, ctx: Ctx, raid: Raid, dog: Dog) {
  const tx = Math.round(dog.x);
  const ty = Math.round(dog.y);
  dog.ver = s.layoutVersion;
  dog.state = 'walk';
  dog.path = [];
  if (!inGrid(ctx, tx, ty)) {
    // 入口が塞がれていた: 入口の建物を外から噛む。壊れていれば別の入口へ
    const b = ctx.at(dog.ex, dog.ey);
    if (b && !isBroken(b)) {
      dog.target = b.id;
      dog.state = 'bite';
      return;
    }
    const boat = raid.boats.find((x) => x.id === dog.boat);
    if (boat && !b) dog.path = [{ x: dog.ex, y: dog.ey }];
    else if (boat) landPath(s, ctx, dog, boat);
    dog.wait = 1;
    return;
  }
  const from = ctx.fromTile(tx, ty);
  const order = from.order();
  for (let k = 1; k < order.length; k++) {
    const b = ctx.L.byPos[order[k]];
    if (!b || isBroken(b)) continue;
    const path = from.path(b.x, b.y)!;
    path.pop();
    dog.path = path;
    dog.target = b.id;
    if (!path.length) dog.state = 'bite';
    return;
  }
  // 噛める建物がない
  dog.target = 0;
  dog.wait = 1;
}

/** 船へ戻る道（入口から浜へ） */
function retreat(s: GameState, ctx: Ctx, raid: Raid, dog: Dog) {
  const boat = raid.boats.find((b) => b.id === dog.boat)!;
  dog.state = 'retreat';
  dog.ver = s.layoutVersion;
  const [nx, ny] = sideOf(boat);
  const tx = Math.round(dog.x);
  const ty = Math.round(dog.y);
  const path = inGrid(ctx, tx, ty) ? ctx.fromTile(tx, ty).path(dog.ex, dog.ey) : null;
  dog.path = path ?? [];
  if (path || inGrid(ctx, tx, ty)) dog.path.push({ x: dog.ex + nx, y: dog.ey + ny });
  dog.path.push({ x: boat.x - boat.dx * 1.4, y: boat.y - boat.dy * 1.4 });
}

function walk(dog: Dog, dt: number) {
  let rem = dog.speed * dt;
  while (rem > 0 && dog.path.length) {
    const p = dog.path[0];
    const dx = p.x - dog.x;
    const dy = p.y - dog.y;
    const d = Math.hypot(dx, dy);
    if (d > 1e-6) {
      dog.hx = dx / d;
      dog.hy = dy / d;
    }
    if (d <= rem) {
      dog.x = p.x;
      dog.y = p.y;
      dog.path.shift();
      rem -= d;
    } else {
      dog.x += (dx / d) * rem;
      dog.y += (dy / d) * rem;
      rem = 0;
    }
  }
}

/** 決着をつける。残りの犬は船へ戻り、報酬・損失を払う */
function finish(s: GameState, ctx: Ctx, raid: Raid, result: NonNullable<Raid['result']>, events: GameEvent[]) {
  raid.result = result;
  for (const b of raid.boats) b.cargo = [];
  for (const d of raid.dogs) retreat(s, ctx, raid, d);
  raid.shots = raid.shots.filter((x) => !x.dog);
  const n = raid.wave;
  if (result === 'clear') {
    s.coins += 100 * n;
    s.rp += 20 * n;
    events.push({ kind: 'clear', amount: 100 * n, x: 0, y: 0 });
  } else if (result === 'lost') {
    const loss = Math.min(Math.floor(s.coins * 0.1), 50000);
    s.coins -= loss;
    events.push({ kind: 'lost', amount: loss, x: 0, y: 0 });
  } else events.push({ kind: 'retreat', amount: raid.dogs.length, x: 0, y: 0 });
}

function hurt(s: GameState, raid: Raid, dog: Dog, dmg: number, events: GameEvent[]) {
  if (dog.hp <= 0) return;
  dog.hp -= dmg;
  if (dog.hp > 0) return;
  // 骨が落ちて、拾わずにコインになる
  raid.dogs.splice(raid.dogs.indexOf(dog), 1);
  const coins = 10 * raid.wave;
  s.coins += coins;
  events.push({ kind: 'bone', amount: coins, x: dog.x, y: dog.y, dog: dog.id });
}

/** 兵器: 射程内で本部に最も近い犬を撃つ（弾を 1 発使う）。連射は砲手の勇敢で速くなる */
function fire(s: GameState, ctx: Ctx, raid: Raid | null, dt: number, bonus: Map<number, number>, events: GameEvent[]) {
  const hq = ctx.L.hq ?? { x: 0, y: 0 };
  for (const b of ctx.L.weapons) {
    const w = WEAPONS[b.type]!;
    b.running = false;
    b.cd = (b.cd ?? 0) - dt * (bonus.get(b.id) ?? 1);
    const ready = raid && raid.dogs.length && !isBroken(b) && (!w.ammo || (b.input[w.ammo] ?? 0) >= 1);
    let best: Dog | null = null;
    if (ready) {
      const range = weaponRange(b);
      let bestD = Infinity;
      for (const d of raid.dogs) {
        if (Math.hypot(d.x - b.x, d.y - b.y) > range) continue;
        const dh = Math.hypot(d.x - hq.x, d.y - hq.y);
        if (dh < bestD) (bestD = dh), (best = d);
      }
    }
    if (!best) {
      b.cd = Math.max(0, b.cd);
      continue;
    }
    b.running = true;
    while (b.cd <= 0 && (!w.ammo || (b.input[w.ammo] ?? 0) >= 1)) {
      if (w.ammo) b.input[w.ammo]!--;
      b.cd += 1 / w.rate;
      const dist = Math.hypot(best.x - b.x, best.y - b.y);
      raid!.shots.push({ id: raid!.nextId++, type: b.type, x: b.x, y: b.y, tx: best.x, ty: best.y, dog: w.splash ? 0 : best.id, t: 0, dur: dist / w.speed + (w.splash ? 0.35 : 0.05), dmg: weaponDamage(s, b) });
      events.push({ kind: 'fire', amount: best.id, x: b.x, y: b.y, type: b.type });
    }
  }
}

/** 襲撃の 1 tick: 次の襲撃までの時計、兵器、弾、船、犬 */
export function raidTick(s: GameState, ctx: Ctx, dt: number, bonus: Map<number, number>, events: GameEvent[]) {
  const r = s.raid;
  r.next -= dt;
  if (!r.tip && r.wave === 0 && r.next <= 180) {
    r.tip = true;
    events.push({ kind: 'tip', amount: 0, x: 0, y: 0 });
  }
  if (r.next <= 0) {
    r.next += RAID.every;
    if (!r.cur) {
      r.wave++;
      startWave(s, events);
    }
  }
  const raid = r.cur;
  fire(s, ctx, raid, dt, bonus, events);
  if (!raid) return;

  for (let i = raid.shots.length - 1; i >= 0; i--) {
    const sh = raid.shots[i];
    sh.t += dt;
    const target = sh.dog ? raid.dogs.find((d) => d.id === sh.dog) : undefined;
    if (target) {
      sh.tx = target.x;
      sh.ty = target.y;
    }
    if (sh.t < sh.dur) continue;
    raid.shots.splice(i, 1);
    const splash = WEAPONS[sh.type]!.splash;
    events.push({ kind: 'hit', amount: sh.dmg, x: sh.tx, y: sh.ty, type: sh.type });
    if (splash) for (const d of [...raid.dogs]) Math.hypot(d.x - sh.tx, d.y - sh.ty) <= splash && hurt(s, raid, d, sh.dmg, events);
    else if (target) hurt(s, raid, target, sh.dmg, events);
  }

  for (let i = raid.boats.length - 1; i >= 0; i--) {
    const b = raid.boats[i];
    b.t += dt;
    if (b.state === 'in' && b.t >= SAIL) {
      b.state = 'dock';
      b.t = 0;
    } else if (b.state === 'dock') {
      if (b.cargo.length && b.t >= DROP_DELAY) {
        b.t = DROP_DELAY - DROP_EVERY;
        const dog = b.cargo.shift()!;
        landPath(s, ctx, dog, b);
        raid.dogs.push(dog);
        raid.landed = true;
      }
      if (raid.result && !raid.dogs.some((d) => d.boat === b.id)) {
        b.state = 'out';
        b.t = 0;
      }
    } else if (b.state === 'out' && b.t >= LEAVE) raid.boats.splice(i, 1);
  }

  const hq = ctx.L.hq;
  for (let i = raid.dogs.length - 1; i >= 0; i--) {
    const dog = raid.dogs[i];
    if (dog.wait > 0) dog.wait -= dt;
    if (dog.state === 'retreat') {
      if (dog.ver !== s.layoutVersion && inGrid(ctx, Math.round(dog.x), Math.round(dog.y))) retreat(s, ctx, raid, dog);
      walk(dog, dt);
      if (!dog.path.length) raid.dogs.splice(i, 1);
      continue;
    }
    if (dog.state === 'land') {
      walk(dog, dt);
      if (!dog.path.length) seek(s, ctx, raid, dog);
      continue;
    }
    if (dog.state === 'walk') {
      // 盤面が変わった・標的が壊れたら探し直す（見つからなかったときは 1 秒待つ）
      const t = ctx.byId.get(dog.target);
      if (dog.ver !== s.layoutVersion || (dog.wait <= 0 && (!t || isBroken(t)))) seek(s, ctx, raid, dog);
      walk(dog, dt);
      if (dog.path.length || dog.state !== 'walk') continue;
      const b = ctx.byId.get(dog.target);
      if (b && !isBroken(b) && Math.abs(Math.round(dog.x) - b.x) + Math.abs(Math.round(dog.y) - b.y) <= 1) dog.state = 'bite';
      else if (dog.wait <= 0) seek(s, ctx, raid, dog);
      continue;
    }
    // 噛む: 標的が壊れた・消えたら次を探す
    const b = ctx.byId.get(dog.target);
    if (!b || isBroken(b)) {
      seek(s, ctx, raid, dog);
      continue;
    }
    const dx = b.x - dog.x;
    const dy = b.y - dog.y;
    const d = Math.hypot(dx, dy) || 1;
    dog.hx = dx / d;
    dog.hy = dy / d;
    // 建物の辺まで寄る（タイルの外へははみ出さない）
    if (d > 0.82) {
      const step = Math.min(d - 0.82, dog.speed * 0.5 * dt);
      dog.x += (dx / d) * step;
      dog.y += (dy / d) * step;
    }
    b.hp = Math.max(0, b.hp - dog.atk * dt);
    if (b.hp > 0) continue;
    events.push({ kind: 'broken', amount: 0, x: b.x, y: b.y, type: b.type });
    if (b === hq && !raid.result) finish(s, ctx, raid, 'lost', events);
    else seek(s, ctx, raid, dog);
  }

  if (!raid.result) {
    if (raid.landed) raid.t += dt;
    if (raid.landed && !raid.dogs.length && raid.boats.every((b) => !b.cargo.length)) finish(s, ctx, raid, 'clear', events);
    else if (raid.t >= RAID.limit) finish(s, ctx, raid, 'retreat', events);
  }
  if (raid.result && !raid.dogs.length && !raid.boats.length) r.cur = null;
}

/** 襲撃のないとき: 本部は自然に全回復し、研究「自己修復」で壊れていない建物も毎秒 1 HP 治る */
export function heal(s: GameState, dt: number) {
  if (s.raid.cur) return;
  const self = s.researched.includes('selfRepair');
  for (const b of s.buildings) {
    const max = maxHp(s, b);
    if (b.hp >= max) continue;
    if (b.type === 'hq') b.hp = Math.min(max, b.hp + (max / 120) * dt);
    else if (self && b.hp > 0) b.hp = Math.min(max, b.hp + dt);
  }
}

/** 一番近い犬（猫が逃げる判定用） */
export function nearestDog(raid: Raid, x: number, y: number): Dog | null {
  let best: Dog | null = null;
  let bd = Infinity;
  for (const d of raid.dogs) {
    const dd = (d.x - x) ** 2 + (d.y - y) ** 2;
    if (dd < bd) (bd = dd), (best = d);
  }
  return best;
}

