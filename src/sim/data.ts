export type ItemId = 'fish' | 'can' | 'yarn' | 'gift' | 'scarf' | 'luxury';
export type BuildingType = 'fishing' | 'cannery' | 'packer' | 'yarnMill' | 'knitter' | 'workshop' | 'market' | 'lab' | 'bed' | 'toybox' | 'tower';
export type ResearchId =
  | 'pack' | 'yarn' | 'luxury'
  | 'speed1' | 'speed2' | 'speed3'
  | 'cargo1' | 'cargo2'
  | 'eff1' | 'eff2' | 'eff3'
  | 'herd1' | 'herd2'
  | 'maneki'
  | 'motiv1' | 'motiv2' | 'motiv3'
  | 'tower'
  | 'tier2' | 'tier3';
export type InfiniteId = 'speedInf' | 'effInf' | 'cargoInf' | 'tradeInf' | 'motivInf';

export const ITEMS: Record<ItemId, { name: string; value: number; color: number }> = {
  fish: { name: '魚', value: 5, color: 0x4a90d9 },
  can: { name: '猫缶', value: 20, color: 0xc0c6cc },
  yarn: { name: '毛糸', value: 8, color: 0xf08cb4 },
  gift: { name: 'ギフト箱', value: 80, color: 0xe0443c },
  scarf: { name: 'マフラー', value: 30, color: 0x8e5cc8 },
  luxury: { name: '高級ギフト', value: 400, color: 0xf2c230 },
};

export interface BuildingDef {
  name: string;
  cost: number;
  color: number;
  /** 生産時間（秒）。市場は 0、研究所は 1 個消費する時間 */
  time: number;
  inputs: Partial<Record<ItemId, number>>;
  output: ItemId | null;
  unlock?: ResearchId;
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  fishing: { name: '釣り場', cost: 50, color: 0x3d7fc4, time: 2, inputs: {}, output: 'fish' },
  cannery: { name: '加工場', cost: 200, color: 0x8a8f96, time: 3, inputs: { fish: 2 }, output: 'can' },
  packer: { name: '包装機', cost: 800, color: 0xe08a2c, time: 4, inputs: { can: 2 }, output: 'gift', unlock: 'pack' },
  yarnMill: { name: '毛糸工場', cost: 300, color: 0xe76fa3, time: 3, inputs: {}, output: 'yarn', unlock: 'yarn' },
  knitter: { name: '編み機', cost: 1000, color: 0x7b4fb8, time: 4, inputs: { yarn: 2 }, output: 'scarf', unlock: 'yarn' },
  workshop: { name: '高級工房', cost: 5000, color: 0xd4a514, time: 6, inputs: { gift: 1, scarf: 1 }, output: 'luxury', unlock: 'luxury' },
  market: { name: '市場', cost: 100, color: 0xd9534f, time: 0, inputs: {}, output: null },
  lab: { name: '研究所', cost: 500, color: 0x3fb3a5, time: 1, inputs: {}, output: null },
  bed: { name: '猫ベッド', cost: 150, color: 0xf3a6c0, time: 0, inputs: {}, output: null },
  toybox: { name: 'おもちゃ箱', cost: 300, color: 0x7fc6e8, time: 0, inputs: {}, output: null },
  tower: { name: 'キャットタワー', cost: 800, color: 0xc89a6c, time: 0, inputs: {}, output: null, unlock: 'tower' },
};

/** 休憩施設: 使える休み方・定員・1 回の休憩の秒数・回復する元気 */
export const FACILITY: Partial<Record<BuildingType, { kinds: ('sleep' | 'play')[]; cap: number; time: number; gain: number }>> = {
  bed: { kinds: ['sleep'], cap: 1, time: 6, gain: 1 },
  toybox: { kinds: ['play'], cap: 2, time: 4, gain: 0.6 },
  tower: { kinds: ['sleep', 'play'], cap: 3, time: 5, gain: 0.8 },
};

export const RESEARCH: Record<ResearchId, { name: string; desc: string; rp: number; req?: ResearchId }> = {
  pack: { name: '包装', desc: '包装機を解放', rp: 150 },
  yarn: { name: '毛糸', desc: '毛糸工場・編み機を解放', rp: 400, req: 'pack' },
  luxury: { name: '高級ギフト', desc: '高級工房を解放', rp: 1500, req: 'yarn' },
  speed1: { name: '速足 I', desc: '猫の速度 +25%', rp: 50 },
  speed2: { name: '速足 II', desc: '猫の速度 +25%', rp: 200, req: 'speed1' },
  speed3: { name: '速足 III', desc: '猫の速度 +25%', rp: 800, req: 'speed2' },
  cargo1: { name: '大荷物 I', desc: '運搬量 2', rp: 100 },
  cargo2: { name: '大荷物 II', desc: '運搬量 3', rp: 500, req: 'cargo1' },
  eff1: { name: '効率 I', desc: '全建物の生産速度 +20%', rp: 150 },
  eff2: { name: '効率 II', desc: '全建物の生産速度 +20%', rp: 600, req: 'eff1' },
  eff3: { name: '効率 III', desc: '全建物の生産速度 +20%', rp: 2400, req: 'eff2' },
  herd1: { name: '猫の群れ I', desc: '雇用コスト −30%', rp: 200 },
  herd2: { name: '猫の群れ II', desc: '雇用コスト −30%', rp: 800, req: 'herd1' },
  maneki: { name: '招き猫', desc: 'オフライン収益 ×2', rp: 1000, req: 'pack' },
  motiv1: { name: 'やる気 I', desc: '猫の疲労速度 −20%', rp: 100 },
  motiv2: { name: 'やる気 II', desc: '猫の疲労速度 −20%', rp: 400, req: 'motiv1' },
  motiv3: { name: 'やる気 III', desc: '猫の疲労速度 −20%', rp: 1600, req: 'motiv2' },
  tower: { name: 'キャットタワー', desc: 'キャットタワーを解放', rp: 250, req: 'motiv1' },
  tier2: { name: '増築', desc: '建物をティア 2 に強化できる', rp: 300, req: 'pack' },
  tier3: { name: '大改装', desc: '建物をティア 3 に強化できる', rp: 2000, req: 'tier2' },
};

/** 無限研究。コストは base × 1.6^レベル */
export const INFINITE: Record<InfiniteId, { name: string; desc: string; base: number; req: ResearchId }> = {
  speedInf: { name: '速足∞', desc: '猫の速度 +5%', base: 1000, req: 'speed3' },
  effInf: { name: '効率∞', desc: '生産速度 +5%', base: 1500, req: 'eff3' },
  cargoInf: { name: '大荷物∞', desc: '5 レベルごとに運搬量 +1', base: 2000, req: 'cargo2' },
  tradeInf: { name: '交渉∞', desc: '市場の売値 +5%', base: 1200, req: 'pack' },
  motivInf: { name: 'やる気∞', desc: '疲労速度 −5%', base: 800, req: 'motiv3' },
};

/** 島の広さ（初期と上限）と 1 回の拡張で増える辺の長さ */
export const GRID = { base: 20, max: 60, step: 4 };

export const CAT_NAMES = [
  'たま', 'みけ', 'くろ', 'しろ', 'とら', 'ちゃちゃ', 'もも', 'こむぎ', 'きなこ', 'あずき',
  'おもち', 'だいふく', 'ぽてと', 'むぎ', 'こはる', 'ゆず', 'はな', 'そら', 'まる', 'ふく',
  'こてつ', 'ぎん', 'さくら', 'つくし', 'みかん', 'ごま', 'のり', 'おこげ', 'もなか', 'ちくわ',
];

export const BUFFER_CAP = 10;
export const CAT_COLORS = ['white', 'black', 'brown', 'gray', 'calico'] as const;
export type CatColor = (typeof CAT_COLORS)[number];

// --- 猫の個性 ---

export type StatId = 'leg' | 'str' | 'fish' | 'cook' | 'craft' | 'study';
/** ステータスの表示名と、得意なときの呼び名 */
export const STATS: Record<StatId, { name: string; trait: string }> = {
  leg: { name: '脚力', trait: '俊足' },
  str: { name: '力持ち', trait: '力持ち' },
  fish: { name: '釣り', trait: '釣り好き' },
  cook: { name: '料理', trait: '食いしん坊' },
  craft: { name: '手芸', trait: '器用' },
  study: { name: '研究', trait: '物知り' },
};
export const STAT_IDS = Object.keys(STATS) as StatId[];
/** 職人を配属できる建物と、そこで効くステータス */
export const WORK_STAT: Partial<Record<BuildingType, StatId>> = { fishing: 'fish', cannery: 'cook', packer: 'cook', yarnMill: 'craft', knitter: 'craft', workshop: 'craft', lab: 'study' };
/** ステータスが 1 秒に伸びる量（得意 ×2、苦手 ×0.5） */
export const STAT_GROWTH = 100 / (4 * 3600);
/** 得意なステータスが効く建物での生産速度の上乗せ */
export const GOOD_BONUS = 1.25;
/** 職人の疲れやすさ（運び屋に対する倍率） */
export const CRAFT_FATIGUE = 0.7;

export type Temper = 'calm' | 'diligent' | 'normal';
/** 気質: 疲れる速さと休憩で回復する量の倍率 */
export const TEMPERS: Record<Temper, { name: string; fatigue: number; recover: number }> = {
  calm: { name: 'のんびり', fatigue: 1.3, recover: 1.5 },
  diligent: { name: '働き者', fatigue: 0.7, recover: 0.8 },
  normal: { name: 'ふつう', fatigue: 1, recover: 1 },
};
