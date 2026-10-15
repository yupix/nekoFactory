import { afterEach, describe, expect, it } from 'vitest';
import { keepCat } from './away';
import { ITEM_IDS, RUNAWAY } from './data';
import { assignCat, awayRate, awayResearch, buyResearch, gridSize, initialState, placeBuilding, type GameState } from './state';
import { simOptions, tick, type GameEvent } from './tick';

const DT = 0.1;
const saved = { ...simOptions };
afterEach(() => Object.assign(simOptions, saved));

/** 本部と猫 1 匹の島。家出の待ち時間は済ませ、襲撃は来ない */
function island(seed = 5) {
  const s = initialState(seed);
  s.cats.length = 1;
  s.runaway.cd = 0;
  s.raid.next = 1e9;
  for (const id of ITEM_IDS) s.store[id] = 1000;
  return s;
}
function run(s: GameState, seconds: number, events: GameEvent[] = []) {
  for (let i = 0; i < Math.round(seconds / DT); i++) events.push(...tick(s, DT));
  return events;
}
/** 必ず家出させる（発生率を上げて、休憩中でない tick まで進める） */
function leave(s: GameState) {
  simOptions.runaway = 1e6;
  const ev: GameEvent[] = [];
  for (let k = 0; k < 300 && !s.cats.some((c) => c.away); k++) ev.push(...tick(s, DT));
  simOptions.runaway = 0;
  return ev;
}

describe('家出', () => {
  it('発生すると外周へ歩き、いかだで岸から 3 タイル離れると名簿から消える', () => {
    const s = island();
    const c = s.cats[0];
    const h = gridSize(s) / 2;
    expect(leave(s).some((e) => e.kind === 'away' && e.cat === c.id)).toBe(true);
    expect(c.away?.phase).toBe('walk');
    const phases = new Set<string>();
    const events: GameEvent[] = [];
    for (let k = 0; k < 600 && s.cats.length; k++) {
      events.push(...tick(s, DT));
      if (c.away) phases.add(c.away.phase);
      // 外周に着いた時点では外周のタイルにいる
      if (c.away?.phase === 'beach' && !phases.has('raft')) expect(Math.max(Math.abs(Math.round(c.x) + 0.5), Math.abs(Math.round(c.y) + 0.5))).toBeGreaterThanOrEqual(h - 1);
    }
    expect([...phases]).toEqual(['walk', 'beach', 'raft']);
    expect(s.cats).toHaveLength(0);
    expect(s.runaway.gone).toEqual([c.name]);
    expect(events.find((e) => e.kind === 'gone')).toMatchObject({ cat: c.id, name: c.name });
    // 1 件終わると 2 分は次が起きない
    expect(s.runaway.cd).toBeCloseTo(RUNAWAY.gap, 0);
  });

  it('途中でクリックすると戻り、元気 +0.3、10 分は家出しない', () => {
    const s = island();
    const c = s.cats[0];
    c.energy = 0.5;
    leave(s);
    run(s, 1);
    expect(keepCat(s, c.id)).toBeNull();
    expect(c.away).toBeNull();
    expect(c.energy).toBeCloseTo(0.8);
    expect(keepCat(s, c.id)).toBe('家出していません');
    simOptions.runaway = 1e6;
    run(s, RUNAWAY.stay - 1);
    expect(c.away).toBeFalsy();
    // 引き止めの 10 分が過ぎれば（休憩中でなければ）また家出しうる
    for (let k = 0; k < 600 && !c.away; k++) tick(s, DT);
    expect(c.away?.phase).toBe('walk');
  });

  it('いかだに乗った後でも 3 タイル以内なら泳いで戻り、職人は配属先へ戻る', () => {
    const s = island();
    const c = s.cats[0];
    placeBuilding(s, 'fishing', 2, 2);
    const b = s.buildings.find((x) => x.type === 'fishing')!;
    expect(assignCat(s, c.id, b.id)).toBeNull();
    run(s, 3);
    leave(s);
    expect(c.job).toBe(0);
    for (let k = 0; k < 600 && c.away?.phase !== 'raft'; k++) tick(s, DT);
    run(s, 2);
    expect(c.away?.phase).toBe('raft');
    expect(keepCat(s, c.id)).toBeNull();
    expect(c.away?.phase).toBe('swim');
    for (let k = 0; k < 600 && c.away; k++) tick(s, DT);
    expect(s.cats).toContain(c);
    expect(c.away).toBeNull();
    expect(c.job).toBe(b.id);
    const h = gridSize(s) / 2;
    expect(Math.abs(c.x) <= h && Math.abs(c.y) <= h).toBe(true);
  });

  it('新規開始から 10 分と襲撃中は発生しない', () => {
    simOptions.runaway = 1e6;
    const s = initialState(9);
    s.raid.next = 1e9;
    run(s, RUNAWAY.start - 0.5);
    expect(s.cats.some((c) => c.away)).toBe(false);
    run(s, 1);
    expect(s.cats.filter((c) => c.away)).toHaveLength(1); // 同時には 1 匹まで

    const r = island();
    r.raid.next = 0.05;
    run(r, 0.1);
    expect(r.raid.cur).not.toBeNull();
    run(r, 30);
    expect(r.cats.some((c) => c.away)).toBe(false);
  });

  it('居心地 I で倍率が 0.7 になり、首輪∞ で −5% ずつ', () => {
    const s = island();
    const c = s.cats[0];
    Object.assign(c, { energy: 1, temper: 'normal' });
    expect(awayRate(s, c)).toBe(1);
    c.energy = 0.5;
    expect(awayRate(s, c)).toBeCloseTo(2);
    c.temper = 'calm';
    expect(awayRate(s, c)).toBeCloseTo(2.6);
    s.rp = 1e6;
    expect(buyResearch(s, 'comfort1')).toBe('前提: 倉庫');
    buyResearch(s, 'storage');
    expect(buyResearch(s, 'comfort1')).toBeNull();
    expect(awayResearch(s)).toBeCloseTo(0.7);
    buyResearch(s, 'comfort2');
    buyResearch(s, 'comfort3');
    expect(buyResearch(s, 'collarInf')).toBeNull();
    expect(awayResearch(s)).toBeCloseTo(0.7 ** 3 * 0.95);
  });

  it('運搬中の品は出荷元の出力へ戻る', () => {
    simOptions.runaway = 0;
    const s = island();
    const c = s.cats[0];
    s.store.fish = 0;
    placeBuilding(s, 'fishing', 4, 0);
    const b = s.buildings.find((x) => x.type === 'fishing')!;
    for (let k = 0; k < 600 && c.state !== 'toDest'; k++) tick(s, DT);
    expect(c.item).toBe('fish');
    const carried = c.amount;
    const before = b.output;
    leave(s);
    expect(c.away).toBeTruthy();
    expect(c.item).toBeNull();
    // 釣り場は家出の tick にも 0.1 秒ぶん進むので、戻った分だけを比べる
    expect(b.output - before).toBeGreaterThanOrEqual(carried);
    expect(b.output - before).toBeLessThanOrEqual(carried + 1);
  });
});
