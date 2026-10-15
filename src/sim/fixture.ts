import { BUFFER_CAP, GRID, ITEM_IDS, ORES, RECIPES, type BuildingType, type ItemId } from './data';
import { DIRS, gridSize, hireCat, initialState, placeBuilding, rand, recipesOf, type GameState } from './state';
import { tick } from './tick';

/** 置く建物の割合（生産チェーン + 休憩施設） */
const MIX: [BuildingType, number][] = [['miner', 0.35], ['furnace', 0.15], ['assembler', 0.1], ['fishing', 0.08], ['cannery', 0.05], ['lab', 0.05], ['market', 0.07], ['bed', 0.08], ['toybox', 0.07]];

/** ベンチと同値性テスト用: seed から決定的に建物と猫を並べた工場 */
export function factory(cats: number, buildings: number, size: number, seed = 42): GameState {
  const s = initialState(seed);
  s.coins = 1e300;
  s.researched.push('steel', 'storage');
  s.expansions = (size - GRID.base) / 4;
  const h = size / 2;
  const tile = () => Math.floor(rand(s) * size) - h;
  // 資材は使い切らない量。倉庫が満杯で止まらないよう、品はしきい値つきで売る
  for (const id of ITEM_IDS) {
    s.store[id] = 1e9;
    s.sell[id] = 20;
  }
  while (s.buildings.length < buildings) {
    let r = rand(s);
    const type = MIX.find(([, p]) => (r -= p) < 0)?.[0] ?? 'toybox';
    const x = tile();
    const y = tile();
    if (Math.abs(x) + Math.abs(y) <= 1) continue;
    // 採掘機の下には鉱床を敷く
    if (type === 'miner' && !s.ores.some((o) => o.x === x && o.y === y)) s.ores.push({ x, y, k: ORES[Math.floor(rand(s) * ORES.length)] });
    placeBuilding(s, type, x, y);
  }
  for (const id of ITEM_IDS) s.store[id] = 50;
  while (s.cats.length < cats) hireCat(s);
  for (const c of s.cats) {
    let x = 0;
    let y = 0;
    do {
      x = tile();
      y = tile();
    } while (s.buildings.some((b) => b.x === x && b.y === y));
    Object.assign(c, { x, y, nx: x, ny: y });
  }
  // 稼働中の工場らしく、加工建物と研究所の入力を満杯にしておく（本部にも品物が流れる）
  for (const b of s.buildings) {
    if (b.type === 'lab') b.input.redPack = BUFFER_CAP;
    for (const id of recipesOf(s, b)) for (const i of Object.keys(RECIPES[id].in) as ItemId[]) b.input[i] = BUFFER_CAP;
  }
  s.coins = 0;
  return s;
}

/** ベンチ用: 本部を囲む四角いリフトの輪（同心に 2000 タイル）に、1 タイル 2 個ずつ品を吊る */
export function lifted(tiles = 2000, perTile = 2) {
  const s = initialState(7);
  s.cats = [];
  s.researched.push('steel', 'lift');
  s.expansions = 8;
  s.store.ironPlate = s.store.gear = 1e9;
  for (let r = 2; s.lifts.length < tiles && r < gridSize(s) / 2; r++) {
    // 半径 r の四角を反時計回りに 1 周
    for (let side = 0; side < 4; side++) {
      const [dx, dy] = DIRS[side];
      for (let k = 0; k < 2 * r; k++) {
        const x = side === 0 ? -r + k : side === 1 ? r : side === 2 ? r - k : -r;
        const y = side === 0 ? -r : side === 1 ? -r + k : side === 2 ? r : r - k;
        s.lifts.push({ x, y, d: DIRS.findIndex(([a, b]) => a === dx && b === dy), tier: 1, items: [] });
      }
    }
  }
  s.lifts.length = Math.min(s.lifts.length, tiles);
  for (const l of s.lifts) for (let k = 0; k < perTile; k++) l.items.push({ k: 'ironOre', p: 1 - (k + 0.5) / perTile - 1e-3, e: l.d });
  s.rev++;
  return s;
}

/** ベンチ用: 工場に水鉄砲タワーを置き、犬 40 匹（ウェーブ 19）が上陸して暴れ続ける状態にする（倒れず、退却もしない） */
export function raiding(s: GameState, weapons = 12) {
  const h = gridSize(s) / 2;
  s.coins = 1e300;
  const store = { ...s.store };
  s.store.ironPlate = s.store.brick = 1e9;
  for (let n = 0; n < weapons; ) {
    const x = Math.floor(rand(s) * 12) - 6;
    const y = Math.floor(rand(s) * 12) - 6;
    if (!placeBuilding(s, 'waterGun', x, y)) n++;
  }
  s.coins = 0;
  s.store = store;
  s.raid.wave = 18;
  s.raid.next = 0.01;
  tick(s, 0.1);
  for (let i = 0; i < 150; i++) tick(s, 0.1);
  const raid = s.raid.cur!;
  raid.t = -1e9;
  for (const d of raid.dogs) d.hp = d.max = 1e12;
  for (const b of s.buildings) if (b.type === 'hq') b.hp = 1e12;
  if (raid.dogs.length !== 40 || h < 0) throw new Error(`犬が ${raid.dogs.length} 匹`);
  return s;
}

/** 浮動小数の位置を除いた結果のダンプ */
export function dump(s: GameState) {
  return JSON.stringify({
    coins: s.coins,
    rp: s.rp,
    store: s.store,
    buildings: s.buildings.map((b) => [b.id, b.input, b.output]),
    cats: s.cats.map((c) => [c.id, c.state, c.item, c.amount, c.src, c.dst, c.rest, c.restAt]),
  });
}

/** 32bit FNV-1a */
export function hash(str: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16);
}
