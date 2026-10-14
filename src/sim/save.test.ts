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

  it('v1 の保存を読むと、研究の敷地拡張が島の拡張回数に変わる', () => {
    const s = initialState(3) as Partial<ReturnType<typeof initialState>>;
    delete s.expansions;
    delete s.levels;
    delete s.layoutVersion;
    Object.assign(s, { researched: ['land1', 'pack', 'land2'], cats: [{ id: 9, x: 0, y: 0, color: 'white', state: 'idle', path: [], item: null, amount: 0, src: 0, dst: 0 }] });
    store.set(KEY, JSON.stringify({ version: 1, savedAt: NOW, state: s }));
    const r = loadGame(NOW);
    expect(r.source).toBe('main');
    expect(r.state.expansions).toBe(4);
    expect(r.state.researched).toEqual(['pack']);
    expect(r.state.layoutVersion).toBe(0);
    expect(r.state.cats[0].name).toBeTruthy();
    expect(r.state.cats[0].energy).toBe(1);
    // v2→v3: ステータスと個性、v3→v4: 建物はティア 1
    expect(r.state.cats[0].job).toBe(0);
    expect(r.state.cats[0].good).not.toBe(r.state.cats[0].bad);
    expect(r.state.cats[0].stats[r.state.cats[0].good]).toBeGreaterThanOrEqual(20);
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
    expect(r.state.cats).toHaveLength(1);
  });
});
