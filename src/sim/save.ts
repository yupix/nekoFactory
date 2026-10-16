import { GRID, INFINITE, RAID, RESEARCH } from './data';
import { addCat, catCount, genOres, gridSize, initCat, initialState, maxHp, newHand, newRaidState, newRunaway, offlineMultiplier, placeHq, START_CATS, type Cat, type GameState } from './state';

export const SAVE_VERSION = 8;
export const KEY = 'nekoFactory';
export const BACKUP_KEY = 'nekoFactory.bak';
const MAX_OFFLINE_SEC = 8 * 3600;

/**
 * 版ごとの変換。MIGRATIONS[v] は v 版の state を v+1 版の形にする。
 * 新しい版を足すときは SAVE_VERSION を上げ、ここに 1 段足す
 */
const MIGRATIONS: Record<number, (s: GameState, now: number) => void> = {
  // v1→v2: 研究の「敷地拡張」は島の拡張回数に置き換え、猫に名前と元気を付ける。sim の経路キャッシュ用に layoutVersion を足す
  1(s, now) {
    const researched = s.researched as string[];
    const land = researched.filter((id) => id === 'land1' || id === 'land2').length;
    s.researched = researched.filter((id) => id !== 'land1' && id !== 'land2') as GameState['researched'];
    s.expansions ??= land * 2;
    s.levels ??= {};
    s.seed ??= now >>> 0 || 1;
    s.layoutVersion ??= 0;
    for (const c of s.cats) initCat(s, c);
  },
  // v2→v3: 猫にステータス・個性・役割を付ける（seed と猫 id から決定的に）
  2(s) {
    for (const c of s.cats) initCat(s, c);
  },
  // v3→v4: 建物にティアを付ける（既存の建物はティア 1）
  3(s) {
    for (const b of s.buildings) b.tier ??= 1;
  },
  // v4→v5: 襲撃と防衛。建物は HP 満タン、中心に本部（中心の建物は最寄りの空きへ）、次の襲撃は読み込みから初回と同じ時間後、猫に勇敢
  4(s) {
    for (const b of s.buildings) b.hp = maxHp(s, b);
    placeHq(s);
    s.raid = newRaidState();
    for (const c of s.cats) initCat(s, c);
  },
  // v5→v6: 素材経済。猫の名簿（名前・個性・ステータス）・研究済み・島の拡張回数・コインだけ引き継ぎ、建物と在庫は初期状態にする
  5(s, now) {
    const fresh = initialState((s.seed || now) >>> 0 || 1);
    fresh.coins = Number(s.coins) || 0;
    fresh.researched = (s.researched ?? []).filter((id) => id in RESEARCH);
    fresh.levels = Object.fromEntries(Object.entries(s.levels ?? {}).filter(([id]) => id in INFINITE));
    // 広がった島の外周にも鉱床を作る
    for (let k = 0; k < (Number(s.expansions) || 0) && gridSize(fresh) < GRID.max; k++) {
      const from = gridSize(fresh);
      fresh.expansions++;
      genOres(fresh, from, gridSize(fresh));
    }
    fresh.cats = (s.cats ?? []).map((c) => {
      const cat: Partial<Cat> = { id: c.id, name: c.name, color: c.color, stats: c.stats, good: c.good, bad: c.bad, temper: c.temper, stamina: c.stamina, lane: c.lane, x: 0, y: 0, state: 'idle', path: [], item: null, amount: 0, src: 0, dst: 0 };
      initCat(fresh, cat);
      return cat as Cat;
    });
    fresh.nextId = Math.max(fresh.nextId, Number(s.nextId) || 0, ...fresh.cats.map((c) => c.id + 1));
    for (const k of Object.keys(s)) delete (s as unknown as Record<string, unknown>)[k];
    Object.assign(s, fresh);
  },
  // v6→v7: 初回の襲撃を 8 分後から 15 分後に延ばした。まだ第 1 波が来ていなければ残り時間を延ばした分だけ足す
  6(s) {
    const r = s.raid;
    if (!r || r.wave > 0 || r.cur) return;
    r.next = Math.min(RAID.first, r.next + RAID.first - 480);
    if (r.next > 180) r.tip = false;
  },
  // v7→v8: 初期の猫を 3 匹にした。ロボ猫を除く猫が 3 匹未満なら 3 匹になるまで足す（既存の島への一度きりのプレゼント）
  7(s) {
    while (catCount(s) < START_CATS) addCat(s);
  },
};

export function serialize(s: GameState, now: number): string {
  return JSON.stringify({ version: SAVE_VERSION, savedAt: now, state: s });
}

/** 保存データを今の版の state にする。解析できない・未知の版なら null */
export function parseSave(json: string | null, now: number): { state: GameState; savedAt: number; from: number } | null {
  if (!json) return null;
  try {
    const d = JSON.parse(json);
    if (!Number.isInteger(d?.version) || d.version > SAVE_VERSION || typeof d.state !== 'object' || !d.state) return null;
    for (let v = d.version; v < SAVE_VERSION; v++) {
      if (!MIGRATIONS[v]) return null;
      MIGRATIONS[v](d.state, now);
    }
    // 確保数は後から足した（版は上げない。ない品は既定値）
    d.state.keep ??= {};
    // 家出も後から足した（家出中の猫と引き止めの残りは猫に、間隔と去った猫は runaway に入る。ない保存は今から 10 分は起きない）
    d.state.runaway ??= newRunaway(Number(d.state.seed) || now);
    // 本部の手作業も後から足した
    d.state.hand ??= newHand();
    d.state.craftTip ??= false;
    // 運び手不足のヒントも後から足した
    d.state.hireTip ??= { lag: 0, cd: 0 };
    return { state: d.state, savedAt: Number(d.savedAt) || now, from: d.version };
  } catch {
    return null;
  }
}

/**
 * 保存データを復元し、オフライン収益を付与する。本体が壊れていればバックアップを使い、どちらも使えなければ初期状態。
 * source はどこから読んだか（new は初期状態）
 */
export function deserialize(json: string | null, now: number, backup: string | null = null) {
  let saved = parseSave(json, now);
  let source: 'main' | 'backup' | 'new' = 'main';
  if (!saved && json) {
    saved = parseSave(backup, now);
    source = 'backup';
  }
  if (!saved) return { state: initialState(now >>> 0 || 1), offline: 0, source: 'new' as const, savedAt: 0, migrated: false };
  const { state, savedAt } = saved;
  /** 素材経済より前の保存から移した（説明のモーダルを出す） */
  const migrated = saved.from < 6;
  const elapsed = Math.min(Math.max((now - savedAt) / 1000, 0), MAX_OFFLINE_SEC);
  // 古い保存には襲撃の損失で負になった速さが残っていることがあるので、負なら付与しない
  const offline = Math.max(0, Math.floor(elapsed * state.incomeRate * 0.5 * offlineMultiplier(state)));
  state.coins += offline;
  return { state, offline, source, savedAt, migrated };
}

/** 本体が壊れていたときは、それでバックアップを上書きしない */
let backupMain = true;

export function loadGame(now = Date.now()) {
  const r = deserialize(localStorage.getItem(KEY), now, localStorage.getItem(BACKUP_KEY));
  backupMain = r.source === 'main';
  return r;
}

/** 今の保存をバックアップへ退避してから上書きする。保存時刻を返す。容量不足などでは例外を投げる */
export function saveGame(s: GameState, now = Date.now()) {
  const json = serialize(s, now);
  const cur = localStorage.getItem(KEY);
  if (cur && backupMain) localStorage.setItem(BACKUP_KEY, cur);
  localStorage.setItem(KEY, json);
  backupMain = true;
  return now;
}

/** 読み込める保存データなら、今の保存をバックアップへ退避して置き換える。失敗時はエラー文 */
export function importSave(json: string): string | null {
  if (!parseSave(json, Date.now())) return '読み込めないファイルです';
  const cur = localStorage.getItem(KEY);
  if (cur) localStorage.setItem(BACKUP_KEY, cur);
  localStorage.setItem(KEY, json);
  return null;
}

export const clearSave = () => {
  localStorage.removeItem(KEY);
  localStorage.removeItem(BACKUP_KEY);
};
