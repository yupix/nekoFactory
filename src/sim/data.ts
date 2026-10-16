export type ItemId =
  | 'ironOre' | 'copperOre' | 'coal' | 'stone'
  | 'ironPlate' | 'copperPlate' | 'brick'
  | 'gear' | 'wire' | 'circuit' | 'steel'
  | 'redPack' | 'greenPack' | 'bluePack'
  | 'fish' | 'can'
  | 'bullet' | 'shell'
  | 'robot';
export type OreId = 'ironOre' | 'copperOre' | 'coal' | 'stone';
export type BuildingType =
  | 'miner' | 'furnace' | 'assembler' | 'fishing' | 'cannery' | 'lab' | 'market' | 'warehouse' | 'charger'
  | 'bed' | 'toybox' | 'tower'
  | 'hq' | 'waterGun' | 'turret' | 'cannon' | 'fence';
export type ResearchId =
  | 'steel' | 'storage' | 'robot' | 'lift' | 'fastLift' | 'bluePack'
  | 'speed1' | 'speed2' | 'speed3'
  | 'cargo1' | 'cargo2'
  | 'eff1' | 'eff2' | 'eff3'
  | 'herd1' | 'herd2'
  | 'maneki'
  | 'motiv1' | 'motiv2' | 'motiv3'
  | 'comfort1' | 'comfort2' | 'comfort3'
  | 'tower'
  | 'tier2' | 'tier3'
  | 'def1' | 'def2'
  | 'sturdy1' | 'sturdy2' | 'sturdy3' | 'selfRepair' | 'cheapRepair';
export type InfiniteId = 'speedInf' | 'effInf' | 'cargoInf' | 'tradeInf' | 'motivInf' | 'sturdyInf' | 'fireInf' | 'collarInf';

export type ItemCat = 'ore' | 'plate' | 'mid' | 'pack' | 'cat' | 'ammo' | 'unit';
export const ITEM_CATS: Record<ItemCat, string> = { ore: '鉱石', plate: '精錬品', mid: '中間素材', pack: '研究パック', cat: '猫用品', ammo: '弾薬', unit: 'ユニット' };

/** value: 売値（0 は売れない）。rp: 研究所に納めたときの RP */
export const ITEMS: Record<ItemId, { name: string; value: number; color: number; cat: ItemCat; rp?: number }> = {
  ironOre: { name: '鉄鉱石', value: 2, color: 0x9a7a6a, cat: 'ore' },
  copperOre: { name: '銅鉱石', value: 2, color: 0xd9824a, cat: 'ore' },
  coal: { name: '石炭', value: 2, color: 0x3a3a40, cat: 'ore' },
  stone: { name: '石', value: 2, color: 0xb8b0a4, cat: 'ore' },
  ironPlate: { name: '鉄板', value: 6, color: 0xaeb8c2, cat: 'plate' },
  copperPlate: { name: '銅板', value: 6, color: 0xe08a4a, cat: 'plate' },
  brick: { name: '石レンガ', value: 4, color: 0xc96a4a, cat: 'plate' },
  gear: { name: '歯車', value: 14, color: 0x8f9aa6, cat: 'mid' },
  wire: { name: '銅線', value: 4, color: 0xf0a050, cat: 'mid' },
  circuit: { name: '回路基板', value: 40, color: 0x3fae5a, cat: 'mid' },
  steel: { name: '鋼材', value: 35, color: 0x6a7480, cat: 'mid' },
  redPack: { name: '赤パック', value: 0, color: 0xe5484d, cat: 'pack', rp: 10 },
  greenPack: { name: '緑パック', value: 0, color: 0x4fbf5a, cat: 'pack', rp: 40 },
  bluePack: { name: '青パック', value: 0, color: 0x4a8fe0, cat: 'pack', rp: 150 },
  fish: { name: '魚', value: 5, color: 0x4a90d9, cat: 'cat' },
  can: { name: '猫缶', value: 25, color: 0xc0c6cc, cat: 'cat' },
  bullet: { name: '弾丸', value: 10, color: 0xd9a441, cat: 'ammo' },
  shell: { name: '砲弾', value: 60, color: 0x4a4f5a, cat: 'ammo' },
  robot: { name: 'ロボ猫', value: 0, color: 0x9fb3c4, cat: 'unit' },
};
export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];
export const ORES: OreId[] = ['ironOre', 'copperOre', 'coal', 'stone'];

/** 建設資材（アイテム → 個数） */
export type Cost = Partial<Record<ItemId, number>>;

export interface BuildingDef {
  name: string;
  cost: Cost;
  color: number;
  /** 生産建物の生産時間の目安（秒、レシピごとの値は RECIPES）。研究所は 1 個消費する時間、市場・施設は 0 */
  time: number;
  unlock?: ResearchId;
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  miner: { name: '採掘機', cost: { ironPlate: 6, gear: 3 }, color: 0xd9a441, time: 2 },
  furnace: { name: '石の炉', cost: { stone: 8 }, color: 0xb0a090, time: 3 },
  assembler: { name: '組立機', cost: { ironPlate: 10, gear: 5 }, color: 0x5a8fc4, time: 2 },
  fishing: { name: '釣り場', cost: { brick: 5 }, color: 0x3d7fc4, time: 2 },
  cannery: { name: '加工場', cost: { ironPlate: 5, brick: 5 }, color: 0x8a8f96, time: 3 },
  lab: { name: '研究所', cost: { ironPlate: 10, circuit: 5 }, color: 0x3fb3a5, time: 2 },
  market: { name: '市場', cost: { brick: 10 }, color: 0xd9534f, time: 0 },
  warehouse: { name: '倉庫', cost: { ironPlate: 20, brick: 20 }, color: 0xa87a4a, time: 0, unlock: 'storage' },
  charger: { name: '充電スタンド', cost: { ironPlate: 10, wire: 10 }, color: 0x4fc4e8, time: 0, unlock: 'robot' },
  bed: { name: '猫ベッド', cost: { brick: 5 }, color: 0xf3a6c0, time: 0 },
  toybox: { name: 'おもちゃ箱', cost: { ironPlate: 5, gear: 2 }, color: 0x7fc6e8, time: 0 },
  tower: { name: 'キャットタワー', cost: { ironPlate: 10, gear: 5 }, color: 0xc89a6c, time: 0, unlock: 'tower' },
  // 本部は島の中心に最初からあり、建てられない（cost は修理費と強化費の基準）
  hq: { name: '本部', cost: { ironPlate: 40, brick: 40 }, color: 0xe8a33c, time: 0 },
  waterGun: { name: '水鉄砲タワー', cost: { ironPlate: 8, brick: 5 }, color: 0x4fb3e8, time: 0 },
  turret: { name: '機関銃タレット', cost: { ironPlate: 15, gear: 10 }, color: 0x6a7480, time: 0, unlock: 'def1' },
  cannon: { name: '大砲', cost: { steel: 20, gear: 10, circuit: 5 }, color: 0x5a5f6a, time: 0, unlock: 'def2' },
  fence: { name: '柵', cost: { brick: 2 }, color: 0xb98a5a, time: 0 },
};

export type RecipeId =
  | 'ore' | 'ironPlate' | 'copperPlate' | 'brick' | 'steel'
  | 'gear' | 'wire' | 'circuit' | 'redPack' | 'greenPack' | 'bluePack' | 'robot' | 'bullet' | 'shell'
  | 'fish' | 'can';
export interface Recipe {
  /** 作る建物 */
  b: BuildingType;
  in: Partial<Record<ItemId, number>>;
  /** 出力（採掘機は鉱床の種類で決まるので null） */
  out: ItemId | null;
  n: number;
  time: number;
  unlock?: ResearchId;
}
/** 生産のレシピ。建物ごとの並び順が「自動」で試す順 */
export const RECIPES: Record<RecipeId, Recipe> = {
  ore: { b: 'miner', in: {}, out: null, n: 1, time: 2 },
  ironPlate: { b: 'furnace', in: { ironOre: 1, coal: 1 }, out: 'ironPlate', n: 1, time: 3 },
  copperPlate: { b: 'furnace', in: { copperOre: 1, coal: 1 }, out: 'copperPlate', n: 1, time: 3 },
  brick: { b: 'furnace', in: { stone: 2 }, out: 'brick', n: 1, time: 2 },
  steel: { b: 'furnace', in: { ironPlate: 5, coal: 1 }, out: 'steel', n: 1, time: 8, unlock: 'steel' },
  gear: { b: 'assembler', in: { ironPlate: 2 }, out: 'gear', n: 1, time: 2 },
  wire: { b: 'assembler', in: { copperPlate: 1 }, out: 'wire', n: 2, time: 1 },
  circuit: { b: 'assembler', in: { ironPlate: 1, wire: 3 }, out: 'circuit', n: 1, time: 4 },
  redPack: { b: 'assembler', in: { copperPlate: 1, gear: 1 }, out: 'redPack', n: 1, time: 5 },
  greenPack: { b: 'assembler', in: { circuit: 1, gear: 1, steel: 1 }, out: 'greenPack', n: 1, time: 8, unlock: 'steel' },
  bluePack: { b: 'assembler', in: { circuit: 2, steel: 1, can: 1 }, out: 'bluePack', n: 1, time: 12, unlock: 'bluePack' },
  robot: { b: 'assembler', in: { ironPlate: 10, gear: 5, circuit: 3, can: 1 }, out: 'robot', n: 1, time: 20, unlock: 'robot' },
  bullet: { b: 'assembler', in: { ironPlate: 1 }, out: 'bullet', n: 2, time: 2, unlock: 'def1' },
  shell: { b: 'assembler', in: { steel: 1, coal: 1 }, out: 'shell', n: 1, time: 5, unlock: 'def2' },
  fish: { b: 'fishing', in: {}, out: 'fish', n: 1, time: 2 },
  can: { b: 'cannery', in: { fish: 2 }, out: 'can', n: 1, time: 3 },
};
export const RECIPE_IDS = Object.keys(RECIPES) as RecipeId[];
/** 建物ごとのレシピ（RECIPES の並び順） */
export const RECIPES_OF = {} as Partial<Record<BuildingType, RecipeId[]>>;
for (const id of RECIPE_IDS) (RECIPES_OF[RECIPES[id].b] ??= []).push(id);
/** 設置時と情報カードでレシピを選べる建物 */
export const MULTI_RECIPE: BuildingType[] = ['furnace', 'assembler'];

/** 本部の倉庫: アイテムごとの初期容量と、倉庫 1 棟で増える量 */
export const STORE = { base: 200, per: 200 };
/** 初期資材 */
export const START_STORE: Cost = { ironPlate: 60, gear: 20, stone: 40, brick: 10, coal: 30 };

/** 本部の手作業（詰み防止）: 作る品 → 材料・個数・秒。鉱石は手掘り（島にその鉱床があるときだけ） */
export type HandId = 'gear' | 'wire' | 'circuit' | 'bullet' | OreId;
export const HAND: Record<HandId, { in: Cost; n: number; time: number; unlock?: ResearchId }> = {
  gear: { in: { ironPlate: 2 }, n: 1, time: 6 },
  wire: { in: { copperPlate: 1 }, n: 2, time: 4 },
  circuit: { in: { ironPlate: 1, wire: 3 }, n: 1, time: 12 },
  bullet: { in: { ironPlate: 1 }, n: 2, time: 6, unlock: 'def1' },
  ironOre: { in: {}, n: 1, time: 6 },
  copperOre: { in: {}, n: 1, time: 6 },
  coal: { in: {}, n: 1, time: 6 },
  stone: { in: {}, n: 1, time: 6 },
};
export const HAND_IDS = Object.keys(HAND) as HandId[];
/** 手作業のキューの件数の上限 */
export const HAND_QUEUE = 10;
/** 弾薬と研究パック: 本部の確保数の既定が 0 で、本部から配る仕事も後回しにしない（建設資材ではないため） */
export const SUPPLY: ItemId[] = ['bullet', 'shell', 'redPack', 'greenPack', 'bluePack'];
/** 本部から機械へ出さずに残す数（確保数）の既定 */
export const KEEP = 10;

/** リフト: 1 タイルの建設資材、フックの数、ティア 1 の速さ（タイル/秒）、建物から積む間隔（秒） */
export const LIFT = { cost: { ironPlate: 1, gear: 1 } as Cost, hooks: 4, speed: 1, load: 0.5 };

/** ロボ猫: 速さ（猫に対する倍率）、運搬量の上乗せ、バッテリーが 1 減るまでの運搬秒数、充電に向かう残量、スタンドの定員と満充電の秒数、本部での充電秒数 */
export const ROBOT = { speed: 1.5, carry: 2, drain: 120, low: 0.2, cap: 2, charge: 10, hqCharge: 30 };

/** 兵器: 射程（タイル）・連射（発/秒）・ダメージ・弾・範囲の半径・弾の速さ（タイル/秒） */
export const WEAPONS: Partial<Record<BuildingType, { range: number; rate: number; dmg: number; ammo: ItemId | null; splash: number; speed: number }>> = {
  waterGun: { range: 4, rate: 1, dmg: 6, ammo: null, splash: 0, speed: 9 },
  turret: { range: 5.5, rate: 2, dmg: 10, ammo: 'bullet', splash: 0, speed: 14 },
  cannon: { range: 7, rate: 0.5, dmg: 40, ammo: 'shell', splash: 1.5, speed: 6 },
};
/** 兵器の弾の入力バッファの上限 */
export const AMMO_CAP = 20;

export type DogKind = 'puppy' | 'guard' | 'bulldog' | 'boss';
/** 犬の種類ごとの倍率（速度・HP・攻撃力） */
export const DOGS: Record<DogKind, { name: string; speed: number; hp: number; atk: number }> = {
  puppy: { name: '子犬', speed: 1.5, hp: 0.5, atk: 1 },
  guard: { name: '番犬', speed: 1, hp: 1, atk: 1 },
  bulldog: { name: 'ブルドッグ', speed: 0.7, hp: 2.5, atk: 1 },
  boss: { name: '大型犬', speed: 0.7, hp: 8, atk: 3 },
};
/**
 * 襲撃: 初回までの秒数・間隔・上陸から退却までの秒数・犬の基本速度（タイル/秒）・
 * 猫が逃げる距離と秒数・逃げない勇敢の値
 */
export const RAID = { first: 900, every: 300, limit: 120, dogSpeed: 1.4, flee: 2.5, fleeT: 2, brave: 50 };
/**
 * 猫のすり抜け: 建物や柵のタイルを細くなって通り抜ける。通り抜けは空いたタイル cost 枚ぶん余計にかかるとみなし（空いた道があればそちらを選ぶ）、
 * 速さは speed 倍、タイルの中心から side だけ横（建物の隙間）を通る。犬はすり抜けない
 */
export const SQUEEZE = { cost: 3, speed: 0.5, side: 0.42 };
/** 敷地の外側に広がる野原と砂浜の幅（タイル）。船はこの外の海に着く */
export const RING = 7.5;

/** 休憩施設: 使える休み方・定員・1 回の休憩の秒数・回復する元気 */
export const FACILITY: Partial<Record<BuildingType, { kinds: ('sleep' | 'play' | 'charge')[]; cap: number; time: number; gain: number }>> = {
  bed: { kinds: ['sleep'], cap: 1, time: 6, gain: 1 },
  charger: { kinds: ['charge'], cap: ROBOT.cap, time: ROBOT.charge, gain: 1 },
  toybox: { kinds: ['play'], cap: 2, time: 4, gain: 0.6 },
  tower: { kinds: ['sleep', 'play'], cap: 3, time: 5, gain: 0.8 },
};

export const RESEARCH: Record<ResearchId, { name: string; desc: string; rp: number; req?: ResearchId }> = {
  steel: { name: '製鋼', desc: '石の炉に鋼材、組立機に緑パックのレシピ', rp: 100 },
  storage: { name: '倉庫', desc: '倉庫を解放（本部の容量 +200）', rp: 150 },
  robot: { name: '猫型ロボット', desc: '組立機にロボ猫のレシピ、充電スタンドを解放', rp: 600, req: 'steel' },
  lift: { name: 'リフト', desc: '吊り下げ式リフトを解放', rp: 400, req: 'steel' },
  fastLift: { name: '高速リフト', desc: 'リフトをティア 2・3（速さ ×2 / ×4）に強化できる', rp: 1500, req: 'lift' },
  bluePack: { name: '青パック', desc: '組立機に青パックのレシピ', rp: 800, req: 'steel' },
  speed1: { name: '速足 I', desc: '猫の速度 +25%', rp: 50 },
  speed2: { name: '速足 II', desc: '猫の速度 +25%', rp: 200, req: 'speed1' },
  speed3: { name: '速足 III', desc: '猫の速度 +25%', rp: 800, req: 'speed2' },
  cargo1: { name: '大荷物 I', desc: '運搬量 3', rp: 100 },
  cargo2: { name: '大荷物 II', desc: '運搬量 4', rp: 500, req: 'cargo1' },
  eff1: { name: '効率 I', desc: '全建物の生産速度 +20%', rp: 150 },
  eff2: { name: '効率 II', desc: '全建物の生産速度 +20%', rp: 600, req: 'eff1' },
  eff3: { name: '効率 III', desc: '全建物の生産速度 +20%', rp: 2400, req: 'eff2' },
  herd1: { name: '猫の群れ I', desc: '雇用コスト −30%', rp: 200 },
  herd2: { name: '猫の群れ II', desc: '雇用コスト −30%', rp: 800, req: 'herd1' },
  maneki: { name: '招き猫', desc: 'オフライン収益 ×2', rp: 1000, req: 'storage' },
  motiv1: { name: 'やる気 I', desc: '猫の疲労速度 −20%', rp: 100 },
  motiv2: { name: 'やる気 II', desc: '猫の疲労速度 −20%', rp: 400, req: 'motiv1' },
  motiv3: { name: 'やる気 III', desc: '猫の疲労速度 −20%', rp: 1600, req: 'motiv2' },
  comfort1: { name: '居心地 I', desc: '猫の家出 −30%', rp: 150, req: 'storage' },
  comfort2: { name: '居心地 II', desc: '猫の家出 −30%', rp: 500, req: 'comfort1' },
  comfort3: { name: '居心地 III', desc: '猫の家出 −30%', rp: 1500, req: 'comfort2' },
  tower: { name: 'キャットタワー', desc: 'キャットタワーを解放', rp: 250, req: 'motiv1' },
  tier2: { name: '増築', desc: '建物をティア 2 に強化できる', rp: 300, req: 'steel' },
  tier3: { name: '大改装', desc: '建物をティア 3 に強化できる', rp: 2000, req: 'tier2' },
  def1: { name: '防衛 I', desc: '機関銃タレット・弾丸のレシピを解放', rp: 200, req: 'steel' },
  def2: { name: '防衛 II', desc: '大砲・砲弾のレシピを解放', rp: 1500, req: 'def1' },
  sturdy1: { name: '頑丈 I', desc: '全建物の最大 HP +25%', rp: 150, req: 'def1' },
  sturdy2: { name: '頑丈 II', desc: '全建物の最大 HP +25%', rp: 500, req: 'sturdy1' },
  sturdy3: { name: '頑丈 III', desc: '全建物の最大 HP +25%', rp: 1500, req: 'sturdy2' },
  selfRepair: { name: '自己修復', desc: '襲撃のないとき毎秒 1 HP 回復', rp: 600, req: 'sturdy1' },
  cheapRepair: { name: '格安修理', desc: '修理費 −30%', rp: 400, req: 'sturdy1' },
};

/** 無限研究。コストは base × 1.6^レベル */
export const INFINITE: Record<InfiniteId, { name: string; desc: string; base: number; req: ResearchId }> = {
  speedInf: { name: '速足∞', desc: '猫の速度 +5%', base: 1000, req: 'speed3' },
  effInf: { name: '効率∞', desc: '生産速度 +5%', base: 1500, req: 'eff3' },
  cargoInf: { name: '大荷物∞', desc: '5 レベルごとに運搬量 +1', base: 2000, req: 'cargo2' },
  tradeInf: { name: '交渉∞', desc: '市場の売値 +5%', base: 1200, req: 'storage' },
  motivInf: { name: 'やる気∞', desc: '疲労速度 −5%', base: 800, req: 'motiv3' },
  sturdyInf: { name: '頑丈∞', desc: '最大 HP +5%', base: 1000, req: 'sturdy3' },
  fireInf: { name: '火力∞', desc: '兵器のダメージ +5%', base: 1200, req: 'def2' },
  collarInf: { name: '首輪∞', desc: '猫の家出 −5%', base: 800, req: 'comfort3' },
};

/** 島の広さ（初期と上限）と 1 回の拡張で増える辺の長さ */
export const GRID = { base: 28, max: 60, step: 4 };
/** 鉱床: 種類ごとの塊の数（初期範囲）と大きさ、本部のまわりで作らない範囲 */
export const DEPOSIT = { clusters: [2, 3], size: [6, 15], keep: 3 };

export const CAT_NAMES = [
  'たま', 'みけ', 'くろ', 'しろ', 'とら', 'ちゃちゃ', 'もも', 'こむぎ', 'きなこ', 'あずき',
  'おもち', 'だいふく', 'ぽてと', 'むぎ', 'こはる', 'ゆず', 'はな', 'そら', 'まる', 'ふく',
  'こてつ', 'ぎん', 'さくら', 'つくし', 'みかん', 'ごま', 'のり', 'おこげ', 'もなか', 'ちくわ',
];

export const BUFFER_CAP = 10;
export const CAT_COLORS = ['white', 'black', 'brown', 'gray', 'calico'] as const;
export type CatColor = (typeof CAT_COLORS)[number];

// --- 猫の個性 ---

export type StatId = 'leg' | 'str' | 'fish' | 'mine' | 'cook' | 'craft' | 'study' | 'brave';
/** ステータスの表示名と、得意なときの呼び名 */
export const STATS: Record<StatId, { name: string; trait: string }> = {
  leg: { name: '脚力', trait: '俊足' },
  str: { name: '力持ち', trait: '力持ち' },
  fish: { name: '釣り', trait: '釣り好き' },
  mine: { name: '採掘', trait: '穴掘り' },
  cook: { name: '料理', trait: '食いしん坊' },
  craft: { name: '手芸', trait: '器用' },
  study: { name: '研究', trait: '物知り' },
  brave: { name: '勇敢', trait: '勇敢' },
};
export const STAT_IDS = Object.keys(STATS) as StatId[];
/** 職人を配属できる建物と、そこで効くステータス */
export const WORK_STAT: Partial<Record<BuildingType, StatId>> = {
  miner: 'mine', furnace: 'mine', fishing: 'fish', cannery: 'cook', assembler: 'craft', lab: 'study',
  waterGun: 'brave', turret: 'brave', cannon: 'brave',
};
/** ステータスが 1 秒に伸びる量（得意 ×2、苦手 ×0.5） */
export const STAT_GROWTH = 100 / (4 * 3600);
/** 得意なステータスが効く建物での生産速度の上乗せ */
export const GOOD_BONUS = 1.25;
/** 職人の疲れやすさ（運び屋に対する倍率） */
export const CRAFT_FATIGUE = 0.7;

export type Temper = 'calm' | 'diligent' | 'normal';
/** 気質: 疲れる速さと休憩で回復する量、家出のしやすさの倍率 */
export const TEMPERS: Record<Temper, { name: string; fatigue: number; recover: number; away: number }> = {
  calm: { name: 'のんびり', fatigue: 1.3, recover: 1.5, away: 1.3 },
  diligent: { name: '働き者', fatigue: 0.7, recover: 0.8, away: 0.8 },
  normal: { name: 'ふつう', fatigue: 1, recover: 1, away: 1 },
};

/**
 * 家出: 1 匹が毎分家出する確率・新規開始から起きない秒数・1 件ごとの間隔（秒）・引き止めた猫が家出しない秒数・
 * 歩く速さの倍率・いかだが消える岸からの距離（タイル）・いかだと泳ぎの速さ（タイル/秒）・引き止めで戻る元気
 */
export const RUNAWAY = { rate: 0.004, start: 600, gap: 120, stay: 600, speed: 1.2, raft: 3, drift: 0.35, swim: 1.1, energy: 0.3 };
