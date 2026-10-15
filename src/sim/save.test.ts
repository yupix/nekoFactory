import { beforeEach, describe, expect, it } from 'vitest';
import { BACKUP_KEY, KEY, SAVE_VERSION, loadGame, saveGame, serialize } from './save';
import { initialState } from './state';

const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
});
const NOW = 1_700_000_000_000;

describe('save', () => {
  beforeEach(() => store.clear());

  it('v1 の保存も順に移せる（研究の敷地拡張は島の拡張回数に、猫には名前と個性）', () => {
    const s = initialState(3) as Partial<ReturnType<typeof initialState>>;
    delete s.expansions;
    delete s.levels;
    delete s.layoutVersion;
    Object.assign(s, { researched: ['land1', 'pack', 'land2', 'speed1'], cats: [{ id: 9, x: 0, y: 0, color: 'white', state: 'idle', path: [], item: null, amount: 0, src: 0, dst: 0 }] });
    store.set(KEY, JSON.stringify({ version: 1, savedAt: NOW, state: s }));
    const r = loadGame(NOW);
    expect(r.source).toBe('main');
    expect(r.migrated).toBe(true);
    expect(r.state.expansions).toBe(4);
    expect(r.state.researched).toEqual(['speed1']);
    const c = r.state.cats[0];
    expect(c.name).toBeTruthy();
    expect(c.energy).toBe(1);
    expect(c.job).toBe(0);
    expect(c.good).not.toBe(c.bad);
    expect(c.stats[c.good]).toBeGreaterThanOrEqual(20);
  });

  it('v5 の保存からは猫の名簿・研究・島の拡張・コインだけ引き継ぎ、建物と在庫は初期状態', () => {
    const v5 = {
      coins: 4321, rp: 999, nextId: 50, incomeRate: 3, tutorialDone: true, expansions: 2, levels: { speedInf: 2, bogus: 1 }, seed: 77, layoutVersion: 9,
      researched: ['pack', 'yarn', 'speed1', 'tier2', 'def1'],
      buildings: [{ id: 3, type: 'hq', x: 0, y: 0 }, { id: 4, type: 'packer', x: 2, y: 2, input: { can: 3 }, output: 4 }, { id: 5, type: 'fishAmmo', x: 3, y: 2 }],
      cats: [{ id: 7, name: 'みけ', color: 'calico', x: 2.3, y: 1, state: 'toDest', item: 'gift', amount: 2, src: 4, dst: 5, path: [{ x: 3, y: 1 }], job: 4, work: true, rest: 'sleep', restAt: 4, good: 'fish', bad: 'study', temper: 'calm', stats: { leg: 40, str: 5, fish: 61, cook: 3, craft: 2, study: 1, brave: 9 } }],
      raid: { next: 10, wave: 6, tip: true, cur: null },
    };
    store.set(KEY, JSON.stringify({ version: 5, savedAt: NOW, state: v5 }));
    const r = loadGame(NOW);
    expect(r.migrated).toBe(true);
    const s = r.state;
    expect(s.coins).toBe(4321);
    expect(s.rp).toBe(0);
    expect(s.researched).toEqual(['speed1', 'tier2', 'def1']);
    expect(s.levels).toEqual({ speedInf: 2 });
    expect(s.expansions).toBe(2);
    // 建物は本部だけ、在庫は初期資材、鉱床は広がった島の外周にもある
    expect(s.buildings.map((b) => b.type)).toEqual(['hq']);
    expect(s.store).toEqual({ ironPlate: 60, gear: 20, stone: 40, brick: 10, coal: 30 });
    expect(s.ores.some((o) => Math.max(Math.abs(o.x + 0.5), Math.abs(o.y + 0.5)) > 14)).toBe(true);
    expect(s.raid).toEqual({ next: 480, wave: 0, tip: false, cur: null });
    expect(s.cats).toHaveLength(1);
    expect(s.cats[0]).toMatchObject({ id: 7, name: 'みけ', color: 'calico', good: 'fish', bad: 'study', temper: 'calm', state: 'idle', item: null, job: 0, rest: null, restAt: 0, x: 0, y: 0, robot: false });
    expect(s.cats[0].stats).toMatchObject({ leg: 40, fish: 61, brave: 9 });
    expect(s.cats[0].stats.mine).toBeGreaterThanOrEqual(0);
    expect(s.nextId).toBeGreaterThan(7);
    // 次に保存して読むと、もう移行はしない
    saveGame(s, NOW);
    expect(loadGame(NOW).migrated).toBe(false);
  });

  it('本体が壊れていてバックアップがあれば、バックアップから読む', () => {
    const s = initialState();
    s.coins = 1234;
    store.set(KEY, '{"version":2,"state":');
    store.set(BACKUP_KEY, serialize(s, NOW));
    const r = loadGame(NOW);
    expect(r.source).toBe('backup');
    expect(r.state.coins).toBe(1234);
    // 壊れた本体でバックアップを上書きしない
    saveGame(r.state, NOW);
    expect(JSON.parse(store.get(BACKUP_KEY)!).state.coins).toBe(1234);
    expect(JSON.parse(store.get(KEY)!).version).toBe(SAVE_VERSION);
  });

  it('手作業のキューとチュートリアルの印を保存し、ない保存には空のキューを補う', () => {
    const s = initialState();
    s.hand = { q: [{ id: 'gear', n: 3 }], t: 2 };
    s.craftTip = true;
    saveGame(s, NOW);
    expect(loadGame(NOW).state).toMatchObject({ hand: { q: [{ id: 'gear', n: 3 }], t: 2 }, craftTip: true });
    const old = initialState() as Partial<ReturnType<typeof initialState>>;
    delete old.hand;
    delete old.craftTip;
    store.set(KEY, JSON.stringify({ version: SAVE_VERSION, savedAt: NOW, state: old }));
    expect(loadGame(NOW).state).toMatchObject({ hand: { q: [], t: 0 }, craftTip: false });
  });

  it('収益の速さが負でも、オフラインでコインは減らない', () => {
    const s = initialState();
    s.coins = 1000;
    s.incomeRate = -5;
    store.set(KEY, serialize(s, NOW));
    const r = loadGame(NOW + 3600_000);
    expect(r.offline).toBe(0);
    expect(r.state.coins).toBe(1000);
  });

  it('保存の前に今の保存をバックアップへ退避する', () => {
    const s = initialState();
    s.coins = 1;
    saveGame(s, NOW);
    s.coins = 2;
    saveGame(s, NOW);
    expect(JSON.parse(store.get(BACKUP_KEY)!).state.coins).toBe(1);
    expect(JSON.parse(store.get(KEY)!).state.coins).toBe(2);
  });

  it('未知の版で、バックアップもなければ初期状態から始める', () => {
    const s = initialState();
    s.coins = 999;
    store.set(KEY, JSON.stringify({ version: SAVE_VERSION + 1, savedAt: NOW, state: s }));
    const r = loadGame(NOW);
    expect(r.source).toBe('new');
    expect(r.state.coins).toBe(300);
    expect(r.state.cats).toHaveLength(2);
  });
});
