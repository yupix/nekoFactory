import { describe, expect, it } from 'vitest';
import { ITEM_IDS, ORES, RECIPES, SQUEEZE, type BuildingType, type ItemId, type RecipeId } from './data';
import { haulStatus, isFreeCarrier, needOf } from './haul';
import { bfs, occupancy, type Bfs } from './path';
import { accepts, bufferCap, gridSize, hireCat, initialState, keepOf, placeBuilding, rand, stock, storeCap, type Building, type Cat, type GameState } from './state';
import { parseSave } from './save';
import { outputFull, simOptions, tick } from './tick';
import stalledSave from './fixtures/user-save-stalled-hq.json?raw';

const DT = 0.1;

/** seed から決まるランダムな工場（採掘機 2〜6、炉 1〜3、組立機 0〜2、本部、柵で一部を囲う、猫 2〜8、本部の在庫と確保数もランダム） */
function randomFactory(seed: number) {
  const s = initialState(seed);
  const r = { seed: (seed * 7919 + 13) >>> 0 };
  const int = (a: number, b: number) => a + Math.floor(rand(r) * (b - a + 1));
  const pick = <T>(list: readonly T[]) => list[Math.floor(rand(r) * list.length)];
  s.raid.next = 1e9;
  s.ores = [];
  s.coins = 1e9;
  for (const id of ITEM_IDS) s.store[id] = 1e6;
  const h = gridSize(s) / 2;
  const span = 9;
  const freeTile = () => {
    for (;;) {
      const x = int(-span, span);
      const y = int(-span, span);
      if (Math.abs(x) + Math.abs(y) > 1 && !s.buildings.some((b) => b.x === x && b.y === y)) return { x, y };
    }
  };
  const put = (type: BuildingType, recipe: RecipeId | null = null) => {
    const t = freeTile();
    if (type === 'miner') s.ores.push({ ...t, k: pick(ORES) });
    if (placeBuilding(s, type, t.x, t.y, recipe)) throw new Error(`置けない ${type}`);
    return s.buildings[s.buildings.length - 1];
  };
  const n = { miner: int(2, 6), furnace: int(1, 3), assembler: int(0, 2) };
  for (let i = 0; i < n.miner; i++) put('miner');
  for (let i = 0; i < n.furnace; i++) put('furnace', pick([null, 'ironPlate', 'copperPlate', 'brick'] as const));
  for (let i = 0; i < n.assembler; i++) put('assembler', pick([null, 'gear', 'wire', 'circuit', 'redPack'] as const));
  if (rand(r) < 0.5) put('lab');
  // 障害: 建物を 1 つ柵で囲う（猫はすり抜けて届く）こともある。ほかに柵を散らす
  if (rand(r) < 0.6) {
    const b = pick(s.buildings.filter((x) => x.type !== 'hq'));
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) placeBuilding(s, 'fence', b.x + dx, b.y + dy);
  }
  for (let i = int(0, 12); i > 0; i--) put('fence');
  // 稼働中らしく、出力と入力に品を入れる
  for (const b of s.buildings) {
    const recipes = b.type === 'miner' ? null : b.recipe ? [b.recipe] : (Object.keys(RECIPES) as RecipeId[]).filter((id) => RECIPES[id].b === b.type && !RECIPES[id].unlock);
    if (b.type === 'miner') b.out = s.ores.find((o) => o.x === b.x && o.y === b.y)!.k;
    else if (recipes?.length) b.out = RECIPES[pick(recipes)].out;
    if (b.out) b.output = rand(r) < 0.4 ? bufferCap(b) : int(0, bufferCap(b));
    for (const id of recipes ?? []) for (const i of Object.keys(RECIPES[id].in) as ItemId[]) if (rand(r) < 0.5) b.input[i] = int(0, bufferCap(b));
    if (b.type === 'lab' && rand(r) < 0.5) b.input.redPack = int(0, 3);
  }
  s.store = {};
  for (const id of ITEM_IDS) if (rand(r) < 0.7) s.store[id] = int(0, 60);
  for (const id of ITEM_IDS) if (rand(r) < 0.3) s.keep[id] = int(0, 20);
  while (s.cats.length < int(2, 8)) hireCat(s);
  for (const c of s.cats) {
    const t = rand(r) < 0.3 ? { x: 0, y: 0 } : freeTile();
    Object.assign(c, { x: t.x, y: t.y, nx: t.x, ny: t.y, energy: 0.6 + rand(r) * 0.4 });
  }
  s.coins = 0;
  if (h < span) throw new Error('島が狭い');
  return s;
}

const tileOf = (c: Cat) => ({ x: Math.round(c.x), y: Math.round(c.y) });
/** 届け先の品の数（運搬予定を含む）と上限 */
function room(s: GameState, d: Building, item: ItemId) {
  const coming = (f: (c: Cat) => boolean) => s.cats.reduce((a, c) => a + (c.state !== 'idle' && c.dst === d.id && f(c) ? c.amount : 0), 0);
  if (d.type === 'hq') return { have: stock(s, item) + coming((c) => c.item === item), cap: storeCap(s) };
  if (d.type === 'lab') return { have: Object.values(d.input).reduce((a, n) => a + (n ?? 0), 0) + coming(() => true), cap: bufferCap(d) };
  return { have: (d.input[item] ?? 0) + coming((c) => c.item === item), cap: bufferCap(d) };
}
const avail = (s: GameState, b: Building, item: ItemId) => (b.type === 'hq' ? stock(s, item) - keepOf(s, item) : b.out === item ? b.output : 0);
const isFull = (s: GameState, b: Building) => b.type !== 'hq' && (b.output >= bufferCap(b) || outputFull(s, b));

/** DESIGN.md「保証したい性質」の検査。tick の前の状態で条件を満たす組が、tick の後に猫を得ているか */
function checker(s: GameState) {
  const size = gridSize(s);
  const grid = occupancy(size, s.buildings);
  const cache = new Map<number, Bfs>();
  // 猫は建物や柵をすり抜けるので、柵で囲った建物にも届く
  const from = (b: Building) => cache.get(b.id) ?? (cache.set(b.id, bfs(size, grid, b.x, b.y, SQUEEZE.cost)), cache.get(b.id)!);
  const reaches = (b: Building, c: Cat) => {
    const t = tileOf(c);
    return from(b).dist(t.x, t.y) >= 0;
  };
  const dsts = s.buildings.filter((b) => b.type !== 'hq' && b.type !== 'fence' && b.type !== 'miner');
  const hq = s.buildings.find((b) => b.type === 'hq')!;

  /** 飢えた建物と品、その品のある到達可能な出荷元 */
  function hungry() {
    const out: { d: Building; item: ItemId; srcs: Building[] }[] = [];
    for (const d of dsts)
      for (const item of ITEM_IDS) {
        if (!accepts(s, d, item)) continue;
        const r = room(s, d, item);
        if (r.have >= r.cap || r.have >= needOf(s, d, item) || isFull(s, d)) continue;
        const srcs = [...s.buildings.filter((x) => x !== d && x.type !== 'hq' && x.out === item && x.output > 0), ...(avail(s, hq, item) > 0 ? [hq] : [])].filter((x) => from(x).dist(d.x, d.y) >= 0);
        if (srcs.length) out.push({ d, item, srcs });
      }
    return out;
  }
  /** 満杯で止まった出荷元のうち、受け取れる届け先（本部を含む）に届くもの */
  function stalled() {
    return s.buildings.filter((b) => {
      if (!b.out || b.output <= 0 || !isFull(s, b)) return false;
      const item = b.out;
      return s.buildings.some((d) => d !== b && (d.type === 'hq' || (d.type !== 'fence' && accepts(s, d, item))) && from(b).dist(d.x, d.y) >= 0 && (() => {
        const r = room(s, d, item);
        return r.have < r.cap;
      })());
    });
  }

  return {
    /** tick を 1 回進めて検査する。違反の説明を返す */
    step(): string[] {
      const free = s.cats.filter(isFreeCarrier);
      const h = hungry().filter((x) => free.some((c) => x.srcs.some((src) => reaches(src, c))));
      const st = stalled().filter((b) => free.some((c) => reaches(b, c)));
      tick(s, DT);
      const left = free.filter((c) => c.state === 'idle');
      const newly = free.filter((c) => c.state !== 'idle');
      const bad: string[] = [];
      for (const x of h) {
        if (newly.some((c) => c.dst === x.d.id && c.item === x.item)) continue;
        const r = room(s, x.d, x.item);
        if (r.have >= needOf(s, x.d, x.item) || r.have >= r.cap || isFull(s, x.d)) continue;
        const src = x.srcs.find((src) => avail(s, src, x.item) > 0 && left.some((c) => reaches(src, c)));
        if (src) bad.push(`飢え: ${x.d.type}#${x.d.id} の ${x.item}（${src.type}#${src.id} にあり、待機猫 ${left.map((c) => c.id)} が残った）`);
      }
      for (const b of st) {
        if (newly.some((c) => c.src === b.id)) continue;
        if (b.output > 0 && isFull(s, b) && left.some((c) => reaches(b, c)) && stalled().includes(b)) bad.push(`満杯: ${b.type}#${b.id} の ${b.out}×${b.output} が拾われない（待機猫 ${left.map((c) => c.id)}）`);
      }
      return bad;
    },
  };
}

const describeLayout = (s: GameState) =>
  JSON.stringify({
    buildings: s.buildings.filter((b) => b.type !== 'fence').map((b) => [b.id, b.type, b.x, b.y, b.recipe, b.out, b.output, b.input]),
    fences: s.buildings.filter((b) => b.type === 'fence').map((b) => [b.x, b.y]),
    cats: s.cats.map((c) => [c.id, Math.round(c.x), Math.round(c.y)]),
    store: s.store,
    keep: s.keep,
  });

describe('運搬の割当（需要優先）', () => {
  it('ファズ: 50 通りの工場で、毎 tick「保証したい性質」を満たす', () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 50; seed++) {
      const s = randomFactory(seed);
      const layout = describeLayout(s);
      const check = checker(s);
      for (let t = 0; t < 300; t++) {
        const bad = check.step();
        if (bad.length) {
          failures.push(`seed ${seed} tick ${t}: ${bad.join(' / ')}\n  配置: ${layout}`);
          break;
        }
      }
    }
    expect(failures).toEqual([]);
  });

  for (const recipe of ['ironPlate', null] as const)
    it(`再現: 石炭が満杯の炉（${recipe ?? '自動'}）にも鉄鉱石が運ばれ、鉄鉱石の採掘機が止まり続けない`, () => {
      const s = initialState(4);
      s.cats.length = 2;
      s.ores = [{ x: -4, y: 2, k: 'coal' }, { x: -6, y: 4, k: 'ironOre' }];
      placeBuilding(s, 'miner', -4, 2);
      placeBuilding(s, 'miner', -6, 4);
      placeBuilding(s, 'furnace', -3, 3, recipe);
      s.store = { ironPlate: 19, gear: 2, stone: 10, brick: 4, coal: 58 };
      const [, , iron, furnace] = s.buildings;
      furnace.input = { coal: 10 };
      let fullFor = 0;
      let maxFull = 0;
      let delivered = 0;
      let made = 0;
      for (let i = 0; i < 1200; i++) {
        const inBefore = furnace.input.ironOre ?? 0;
        const outBefore = furnace.output;
        tick(s, DT);
        delivered += Math.max(0, (furnace.input.ironOre ?? 0) - inBefore);
        made += Math.max(0, furnace.output - outBefore);
        fullFor = iron.output >= bufferCap(iron) ? fullFor + DT : 0;
        maxFull = Math.max(maxFull, fullFor);
      }
      // 2 匹・運搬量 2 でも採掘機の方が速いので満杯にはなるが、拾われずに止まり続けることはない。
      // 石炭は燃料で 8 枚に 1 個しか使わず、石炭の採掘機の出力も本部へ運ぶので、そのぶん猫の手が取られる（最長 12.9 秒）
      expect(delivered).toBeGreaterThanOrEqual(25);
      expect(made).toBeGreaterThanOrEqual(20);
      expect(maxFull).toBeLessThan(15);
    });

  it('再現: 出力が満杯で止まった建物ばかりのユーザーのセーブ（猫 3 匹）で、止まった出力が本部へ運ばれる', () => {
    const s = parseSave(stalledSave, Date.now())!.state;
    s.raid.next = 1e9;
    const saved = { ...simOptions };
    simOptions.runaway = 0;
    try {
      expect(s.cats).toHaveLength(3);
      const full = () => s.buildings.filter((b) => isFull(s, b)).length;
      let got = 0;
      for (let i = 0; i < 6000; i++) {
        const before = ITEM_IDS.map((id) => stock(s, id));
        tick(s, DT);
        ITEM_IDS.forEach((id, k) => (got += Math.max(0, stock(s, id) - before[k])));
      }
      // 10 分で本部に届いた数。運搬量 1 で不足を優先し、止まった建物を届け先に選んでいたときは 17 個（止まった建物は 8）、運搬の見直しで 72 個（6）、石炭を燃料にして 86 個（5）
      expect(got).toBeGreaterThanOrEqual(60);
      expect(full()).toBeLessThanOrEqual(7);
    } finally {
      Object.assign(simOptions, saved);
    }
  });

  /** 鉄鉱石の採掘機と、出力が満杯で止まった炉（どちらも出力が満杯）。猫 2 匹は本部に */
  function stalledFurnace() {
    const s = initialState(4);
    s.cats.length = 2;
    s.ores = [{ x: -4, y: 2, k: 'ironOre' }];
    expect(placeBuilding(s, 'miner', -4, 2)).toBeNull();
    expect(placeBuilding(s, 'furnace', -3, 3, 'ironPlate')).toBeNull();
    s.store = {};
    const [hq, miner, furnace] = s.buildings;
    Object.assign(miner, { out: 'ironOre', output: bufferCap(miner) });
    Object.assign(furnace, { out: 'ironPlate', output: bufferCap(furnace), input: { coal: bufferCap(furnace) } });
    const job = () => s.cats.find((c) => c.src === miner.id && c.state !== 'idle');
    return { s, hq, furnace, job };
  }

  it('満杯の出荷元の受け取れる建物が止まっていれば本部へ運ぶ', () => {
    const { s, hq, job } = stalledFurnace();
    tick(s, DT);
    expect(job()?.dst).toBe(hq.id);
  });

  it('本部が満杯なら、最後の手段として止まっている建物へ運ぶ', () => {
    const { s, furnace, job } = stalledFurnace();
    s.store.ironOre = storeCap(s);
    tick(s, DT);
    expect(job()?.dst).toBe(furnace.id);
  });

  it('満杯で止まった出荷元を、不足しているだけの建物への補給より先に拾う', () => {
    const s = initialState(4);
    s.cats.length = 1;
    s.ores = [{ x: 2, y: 0, k: 'ironOre' }, { x: -6, y: -6, k: 'stone' }];
    expect(placeBuilding(s, 'miner', 2, 0)).toBeNull();
    expect(placeBuilding(s, 'furnace', 3, 0, 'ironPlate')).toBeNull();
    expect(placeBuilding(s, 'miner', -6, -6)).toBeNull();
    s.store = {};
    const [hq, iron, furnace, stone] = s.buildings;
    Object.assign(iron, { out: 'ironOre', output: 3 });
    Object.assign(stone, { out: 'stone', output: bufferCap(stone) });
    // 鉄鉱石は 1 回分あるが 2 回分ない（不足。作っている途中なので、この tick では使わない）。近くの採掘機にあるが、遠くの止まった採掘機が先
    Object.assign(furnace, { input: { ironOre: 1, coal: bufferCap(furnace) }, running: true, cur: 'ironPlate', out: 'ironPlate', progress: 0 });
    tick(s, DT);
    expect(s.cats[0]).toMatchObject({ src: stone.id, dst: hq.id, item: 'stone' });
  });

  it('材料待ちの行に、品の所在と運ばれない理由を出す', () => {
    const s = initialState(4);
    s.cats.length = 1;
    s.ores = [{ x: -6, y: 4, k: 'ironOre' }];
    placeBuilding(s, 'miner', -6, 4);
    placeBuilding(s, 'furnace', 3, 3, 'ironPlate');
    const [hq, iron, furnace] = s.buildings;
    s.store = { coal: 15 };
    s.keep = { coal: 10 };
    Object.assign(iron, { output: 10, out: 'ironOre' });
    const row = (item: ItemId) => haulStatus(s, furnace, ['ironOre', 'coal']).find((r) => r.item === item);
    expect(row('ironOre')).toEqual({ item: 'ironOre', where: ['採掘機 (−6, 4) の出力に 10'], reason: '割り当て待ち' });
    expect(row('coal')?.where).toEqual(['本部に 15（確保 10）']);
    // 猫が出払っている
    s.cats[0].state = 'toSource';
    expect(row('ironOre')?.reason).toBe('別の建物が優先');
    s.cats.length = 0;
    expect(row('ironOre')?.reason).toBe('運び手がいない');
    // 本部の在庫が確保数以下
    s.store.coal = 8;
    expect(row('coal')).toEqual({ item: 'coal', where: ['本部に 8（確保 10）'], reason: '本部の在庫が確保数以下' });
    // 柵で囲っても、猫はすり抜けるので道は通じている
    s.store.brick = 100;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) placeBuilding(s, 'fence', furnace.x + dx, furnace.y + dy);
    s.cats.length = 0;
    hireCat(s);
    expect(row('ironOre')?.reason).toBe('割り当て待ち');
    expect(hq.type).toBe('hq');
  });
});
