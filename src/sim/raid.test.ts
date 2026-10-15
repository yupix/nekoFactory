import { describe, expect, it } from 'vitest';
import { ITEM_IDS } from './data';
import { deserialize, serialize } from './save';
import { initialState, maxHp, placeBuilding, repairAll, repairBuilding, type Dog, type GameState } from './state';
import { tick } from './tick';

const DT = 0.1;
const run = (s: GameState, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) tick(s, DT);
};
/** 猫のいない島（犬と建物だけを見る） */
function island() {
  const s = initialState(3);
  s.cats = [];
  s.coins = 1e5;
  s.researched.push('steel', 'def1', 'def2');
  for (const id of ITEM_IDS) s.store[id] = 1000;
  return s;
}
/** 上陸済みの犬を置く（船は北の沖に 1 隻） */
function dog(s: GameState, x: number, y: number, o: Partial<Dog> = {}) {
  s.raid.cur ??= { wave: 1, t: 0, landed: true, dogs: [], boats: [{ id: 1, x: 0, y: -20, dx: 0, dy: -1, t: 0, state: 'dock', cargo: [] }], shots: [], result: null, nextId: 10, total: 0 };
  const d: Dog = { id: s.raid.cur.nextId++, kind: 'guard', x, y, hx: 1, hy: 0, hp: 1e6, max: 1e6, atk: 10, speed: 1.4, state: 'walk', path: [], target: 0, boat: 1, ex: 0, ey: -10, ver: -1, wait: 0, ...o };
  s.raid.cur.dogs.push(d);
  s.raid.cur.total++;
  return d;
}

describe('襲撃と防衛', () => {
  it('開始 15 分で最初のウェーブが出て、5 分おきに続く。止めている間（hidden・オフライン）は進まない', () => {
    const s = island();
    run(s, 899.9);
    expect(s.raid.cur).toBeNull();
    // hidden の間は tick が呼ばれない。保存して 1 時間後に読み込んでも残り時間は同じ
    const back = deserialize(serialize(s, 0), 3600_000).state;
    expect(back.raid.next).toBeCloseTo(0.1, 5);
    run(back, 0.1);
    expect(back.raid.wave).toBe(1);
    expect(back.raid.cur?.total).toBe(5);
    run(back, 299.9);
    expect(back.raid.wave).toBe(1);
    run(back, 0.1);
    expect(back.raid.wave).toBe(2);
    expect(back.raid.cur?.total).toBe(7);
  });

  it('初回が 8 分だった頃の保存は、第 1 波の前なら残り時間を 7 分延ばす（15 分を超えない）。第 1 波の後はそのまま', () => {
    const v6 = (raid: object) => deserialize(JSON.stringify({ version: 6, savedAt: 0, state: { ...island(), raid } }), 0).state.raid;
    expect(v6({ next: 205, wave: 0, tip: false, cur: null })).toMatchObject({ next: 625, tip: false });
    // チュートリアルを出した後でも、3 分より先になったらもう一度出す
    expect(v6({ next: 120, wave: 0, tip: true, cur: null })).toMatchObject({ next: 540, tip: false });
    expect(v6({ next: 30, wave: 0, tip: true, cur: null })).toMatchObject({ next: 450 });
    expect(v6({ next: 480, wave: 0, tip: false, cur: null }).next).toBe(900);
    expect(v6({ next: 100, wave: 2, tip: true, cur: null })).toMatchObject({ next: 100, wave: 2 });
  });

  it('犬が建物を噛んで HP 0 で故障し、生産が止まり、修理でコインが減って復旧する', () => {
    const s = island();
    placeBuilding(s, 'fishing', 5, 0);
    const b = s.buildings[1];
    dog(s, 6, 0, { atk: 50 });
    // 最初の tick で標的を見つけ、次から噛む
    run(s, 2);
    expect(b.hp).toBeCloseTo(maxHp(s, b) - 95, 0);
    run(s, 0.2);
    expect(b.hp).toBe(0);
    s.raid.cur!.dogs = [];
    s.raid.cur!.result = 'retreat';
    const out = b.output;
    run(s, 10);
    expect(b.output).toBe(out);
    const coins = s.coins;
    // 修理費は建設資材の売値の合計 × 0.3（釣り場は石レンガ 5 × 4 = 20 → 6）
    expect(repairBuilding(s, b.id)).toBeNull();
    expect(s.coins).toBe(coins - 6);
    expect(b.hp).toBe(maxHp(s, b));
    run(s, 2.1);
    expect(b.output).toBe(out + 1);
    // 全修理は故障中だけを直す
    b.hp = 0;
    s.buildings[0].hp = 0;
    const before = s.coins;
    expect(repairAll(s)).toBeNull();
    expect(s.coins).toBe(before - 6 - 120);
    expect(repairAll(s)).toBe('故障中の建物はありません');
  });

  it('弾丸を持つタレットが射程内の犬にダメージを与え弾が減る。弾切れでは撃たない', () => {
    const s = island();
    placeBuilding(s, 'turret', 4, 4);
    const l = s.buildings[1];
    l.input.bullet = 2;
    const d = dog(s, 4, 8, { speed: 0, atk: 0 });
    run(s, 1.5);
    expect(l.input.bullet).toBe(0);
    expect(d.hp).toBe(1e6 - 20);
    run(s, 3);
    expect(d.hp).toBe(1e6 - 20);
    // 射程外は撃たない
    l.input.bullet = 5;
    d.x = 4 + 6;
    run(s, 2);
    expect(l.input.bullet).toBe(5);
  });

  it('全滅でクリア報酬が入る', () => {
    const s = island();
    placeBuilding(s, 'waterGun', 3, 3);
    dog(s, 3, 6, { hp: 5, max: 5, speed: 0 });
    const coins = s.coins;
    run(s, 2);
    expect(s.raid.cur?.result).toBe('clear');
    expect(s.coins).toBe(coins + 10 + 100);
    expect(s.rp).toBe(20);
  });

  it('上陸から 120 秒で退却し、報酬はない。犬は船へ戻り襲撃が終わる', () => {
    const s = island();
    dog(s, 5, 5, { atk: 0 });
    const coins = s.coins;
    run(s, 119.9);
    expect(s.raid.cur?.result).toBeNull();
    run(s, 0.2);
    expect(s.raid.cur?.result).toBe('retreat');
    run(s, 40);
    expect(s.raid.cur).toBeNull();
    expect(s.coins).toBe(coins);
  });

  it('柵で囲うと犬は柵を標的にする', () => {
    const s = island();
    placeBuilding(s, 'market', 5, 5);
    const d = dog(s, 5, 9, { atk: 0 });
    tick(s, DT);
    expect(s.buildings.find((b) => b.id === d.target)?.type).toBe('market');
    for (const [x, y] of [[5, 6], [5, 4], [4, 5], [6, 5]]) placeBuilding(s, 'fence', x, y);
    tick(s, DT);
    const t = s.buildings.find((b) => b.id === d.target)!;
    expect(t.type).toBe('fence');
    expect([t.x, t.y]).toEqual([5, 6]);
  });

  it('本部の HP が 0 になると襲撃は終わり、コインの 10% を失う', () => {
    const s = island();
    s.coins = 1000;
    const hq = s.buildings[0];
    hq.hp = 1;
    dog(s, 1, 0, { atk: 50 });
    run(s, 0.2);
    expect(s.raid.cur?.result).toBe('lost');
    expect(s.coins).toBe(900);
    expect(s.raid.cur?.dogs[0].state).toBe('retreat');
  });

  it('犬が 2.5 タイル以内に来た猫は逃げる。勇敢 50 以上の猫は逃げない', () => {
    const s = initialState(3);
    const c = s.cats[0];
    Object.assign(c, { x: 4, y: 4, nx: 4, ny: 4 });
    c.stats.brave = 10;
    dog(s, 6, 4, { speed: 0, atk: 0 });
    tick(s, DT);
    expect(c.flee).toBeGreaterThan(0);
    run(s, 1);
    expect(c.x).toBeLessThan(4 - 1.5);
    run(s, 2);
    expect(c.flee).toBe(0);
    Object.assign(c, { x: 4, y: 4, nx: 4, ny: 4, path: [] });
    c.stats.brave = 50;
    run(s, 1);
    expect(c.flee).toBe(0);
    expect(c.x).toBeGreaterThan(3);
  });
});
