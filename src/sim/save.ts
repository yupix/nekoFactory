import { initCat, initialState, offlineMultiplier, type GameState } from './state';

export const SAVE_VERSION = 4;
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
};

export function serialize(s: GameState, now: number): string {
  return JSON.stringify({ version: SAVE_VERSION, savedAt: now, state: s });
}

/** 保存データを今の版の state にする。解析できない・未知の版なら null */
export function parseSave(json: string | null, now: number): { state: GameState; savedAt: number } | null {
  if (!json) return null;
  try {
    const d = JSON.parse(json);
    if (!Number.isInteger(d?.version) || d.version > SAVE_VERSION || typeof d.state !== 'object' || !d.state) return null;
    for (let v = d.version; v < SAVE_VERSION; v++) {
      if (!MIGRATIONS[v]) return null;
      MIGRATIONS[v](d.state, now);
    }
    return { state: d.state, savedAt: Number(d.savedAt) || now };
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
  if (!saved) return { state: initialState(now >>> 0 || 1), offline: 0, source: 'new' as const, savedAt: 0 };
  const { state, savedAt } = saved;
  const elapsed = Math.min(Math.max((now - savedAt) / 1000, 0), MAX_OFFLINE_SEC);
  const offline = Math.floor(elapsed * state.incomeRate * 0.5 * offlineMultiplier(state));
  state.coins += offline;
  return { state, offline, source, savedAt };
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
