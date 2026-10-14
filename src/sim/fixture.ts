import { BUFFER_CAP, BUILDINGS, type BuildingType, type ItemId } from './data';
import { hireCat, initialState, placeBuilding, rand, type GameState } from './state';

/** 置く建物の割合（生産チェーン + 休憩施設） */
const MIX: [BuildingType, number][] = [['fishing', 0.5], ['cannery', 0.08], ['packer', 0.04], ['market', 0.2], ['lab', 0.03], ['bed', 0.08], ['toybox', 0.07]];

/** ベンチと同値性テスト用: seed から決定的に建物と猫を並べた工場 */
export function factory(cats: number, buildings: number, size: number, seed = 42): GameState {
  const s = initialState(seed);
  s.coins = 1e300;
  s.researched.push('pack');
  s.expansions = (size - 20) / 4;
  const h = size / 2;
  const tile = () => Math.floor(rand(s) * size) - h;
  while (s.buildings.length < buildings) {
    let r = rand(s);
    const type = MIX.find(([, p]) => (r -= p) < 0)?.[0] ?? 'toybox';
    const x = tile();
    const y = tile();
    if (Math.abs(x) + Math.abs(y) > 1) placeBuilding(s, type, x, y);
  }
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
  // 稼働中の工場らしく、加工建物と研究所の入力を満杯にしておく（市場にも品物が流れる）
  for (const b of s.buildings) {
    if (b.type === 'lab') b.input.fish = BUFFER_CAP;
    for (const i of Object.keys(BUILDINGS[b.type].inputs) as ItemId[]) b.input[i] = BUFFER_CAP;
  }
  s.coins = 0;
  return s;
}

/** 浮動小数の位置を除いた結果のダンプ */
export function dump(s: GameState) {
  return JSON.stringify({
    coins: s.coins,
    rp: s.rp,
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
