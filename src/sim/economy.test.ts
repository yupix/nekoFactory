import { describe, expect, it } from 'vitest';
import { ITEM_IDS } from './data';
import { parseSave } from './save';
import { outputStatus } from './haul';
import { accepts, assignCat, buyResearch, cancelHand, handPlan, initialState, launchRobot, missingSources, placeBuilding, placeLift, queueHand, removeBuilding, setOff, setRecipe, sourceHint, stock, storeCap, suppliedItems, type GameState } from './state';
import { tick } from './tick';
import userSave from './fixtures/user-save-iron-to-hq.json?raw';

const DT = 0.1;
const run = (s: GameState, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) tick(s, DT);
};
/** 本部のない島。猫 1 匹（cats: false なら猫なし）、資材はたっぷり */
function bare(cats = true) {
  const s = initialState(4);
  s.buildings = [];
  s.cats.length = cats ? 1 : 0;
  s.ores = [];
  for (const id of ITEM_IDS) s.store[id] = 1000;
  s.layoutVersion++;
  return s;
}
/** 本部のある島（猫なし、倉庫は空） */
function withHq() {
  const s = initialState(4);
  s.cats = [];
  s.ores = [];
  s.store = { ironPlate: 1000, gear: 1000, brick: 1000, stone: 1000, wire: 1000, circuit: 1000 };
  return s;
}

describe('素材経済', () => {
  it('鉱床は seed から決まり、本部のまわり 3 タイルにはなく、4 種類ある', () => {
    const a = initialState(11);
    expect(initialState(11).ores).toEqual(a.ores);
    expect(a.ores.every((o) => Math.max(Math.abs(o.x), Math.abs(o.y)) > 3)).toBe(true);
    expect(new Set(a.ores.map((o) => o.k)).size).toBe(4);
    for (const k of ['ironOre', 'copperOre', 'coal', 'stone']) expect(a.ores.filter((o) => o.k === k).length).toBeGreaterThanOrEqual(2 * 6);
  });

  it('採掘機は鉱床の外に置けず、鉱床の上ではその鉱石を出す', () => {
    const s = bare(false);
    s.ores.push({ x: 3, y: 3, k: 'copperOre' });
    expect(placeBuilding(s, 'miner', 2, 3)).toBe('採掘機は鉱床の上にしか置けません');
    expect(placeBuilding(s, 'miner', 3, 3)).toBeNull();
    // 鉱床の上には他の建物も置ける
    s.ores.push({ x: 5, y: 5, k: 'coal' });
    expect(placeBuilding(s, 'furnace', 5, 5)).toBeNull();
    run(s, 2);
    expect(s.buildings[0]).toMatchObject({ output: 1, out: 'copperOre' });
  });

  it('石の炉が鉄鉱石 + 石炭で鉄板を作る。レシピを固定するとそれしか作らない', () => {
    const s = bare(false);
    placeBuilding(s, 'furnace', 0, 0);
    const b = s.buildings[0];
    Object.assign(b.input, { ironOre: 1, coal: 1, stone: 2 });
    run(s, 2.9);
    expect(b.output).toBe(0);
    run(s, 0.1);
    expect(b).toMatchObject({ output: 1, out: 'ironPlate', input: { ironOre: 0, coal: 0, stone: 2 } });
    // 出力に鉄板がある間は、別の品（石レンガ）は作らない
    run(s, 5);
    expect(b.output).toBe(1);
    b.output = 0;
    expect(setRecipe(s, b.id, 'copperPlate')).toBeNull();
    run(s, 5);
    expect(b.output).toBe(0);
    expect(setRecipe(s, b.id, 'steel')).toBe('未解放のレシピです');
    expect(setRecipe(s, b.id, 'brick')).toBeNull();
    run(s, 2);
    expect(b).toMatchObject({ output: 1, out: 'brick' });
  });

  it('資材が足りなければ建てられず、建てると倉庫から引かれ、撤去で 50% 戻る', () => {
    const s = initialState(4);
    expect(s.store).toEqual({ ironPlate: 60, gear: 20, stone: 40, brick: 10, coal: 30 });
    s.store.gear = 4;
    expect(placeBuilding(s, 'assembler', 5, 5)).toBe('資材が足りません（歯車 1）');
    expect(s.store).toMatchObject({ ironPlate: 60, gear: 4 });
    s.store.gear = 5;
    expect(placeBuilding(s, 'assembler', 5, 5)).toBeNull();
    expect(s.store).toMatchObject({ ironPlate: 50, gear: 0 });
    expect(removeBuilding(s, 5, 5)).toBeNull();
    expect(s.store).toMatchObject({ ironPlate: 55, gear: 2 });
  });

  it('届け先のない品は本部へ運ばれ倉庫が増える。容量で止まり、倉庫棟で広がる', () => {
    const s = initialState(4);
    s.cats.length = 1;
    s.store.brick = 100;
    placeBuilding(s, 'fishing', 2, 0);
    const f = s.buildings[1];
    for (let i = 0; i < 100 && !s.store.fish; i++) tick(s, DT);
    expect(s.store.fish).toBe(1);
    // 倉庫が満杯の品は運ばない（出力に溜まる）
    s.store.fish = 200;
    run(s, 30);
    expect(s.store.fish).toBe(200);
    expect(f.output).toBe(10);
    expect(f.running).toBe(false);
    s.researched.push('storage');
    s.store.ironPlate = 20;
    s.store.brick = 20;
    expect(placeBuilding(s, 'warehouse', -2, 0)).toBeNull();
    run(s, 10);
    expect(s.store.fish).toBeGreaterThan(200);
  });

  it('レシピを固定した建物には、猫はそのレシピの材料だけ運ぶ', () => {
    const s = bare();
    s.ores.push({ x: 1, y: 0, k: 'ironOre' }, { x: 0, y: 1, k: 'stone' });
    placeBuilding(s, 'miner', 1, 0);
    placeBuilding(s, 'furnace', 3, 0, 'brick');
    const [miner, furnace] = s.buildings;
    run(s, 10);
    expect(furnace.input.ironOre ?? 0).toBe(0);
    expect(miner.output).toBeGreaterThan(0);
    placeBuilding(s, 'miner', 0, 1);
    run(s, 20);
    expect(furnace.out).toBe('brick');
  });

  it('市場は「売る」品をしきい値より多い分だけ 1 秒に 1 個売る', () => {
    const s = bare(false);
    s.coins = 0;
    placeBuilding(s, 'market', 0, 0);
    s.store.ironPlate = 33;
    s.store.gear = 5;
    s.sell = { ironPlate: 30 };
    run(s, 1);
    expect(s.store.ironPlate).toBe(32);
    expect(s.coins).toBeCloseTo(6);
    run(s, 10);
    expect(s.store.ironPlate).toBe(30);
    expect(s.store.gear).toBe(5);
    expect(s.coins).toBeCloseTo(18);
    expect(s.incomeRate).toBeGreaterThan(0);
    // 市場がなければ売れない
    removeBuilding(s, 0, 0);
    s.store.ironPlate = 40;
    run(s, 3);
    expect(s.store.ironPlate).toBe(40);
  });

  it('赤パックを研究所へ届けると 2 秒で 10 RP になる', () => {
    const s = bare();
    placeBuilding(s, 'assembler', 1, 0, 'redPack');
    placeBuilding(s, 'lab', 3, 0);
    const [asm, lab] = s.buildings;
    Object.assign(asm, { output: 1, out: 'redPack' });
    for (let i = 0; i < 100 && !lab.input.redPack; i++) tick(s, DT);
    expect(lab.input.redPack).toBe(1);
    run(s, 1.9);
    expect(s.rp).toBe(0);
    const events = [...tick(s, DT), ...tick(s, DT)];
    expect(s.rp).toBe(10);
    expect(events).toContainEqual({ kind: 'rp', amount: 10, x: 3, y: 0 });
  });

  it('本部は弾薬を兵器へ配る', () => {
    const s = initialState(4);
    s.cats.length = 1;
    s.researched.push('steel', 'def1');
    for (const id of ITEM_IDS) s.store[id] = 100;
    s.store.bullet = 5;
    placeBuilding(s, 'turret', 4, 0);
    run(s, 15);
    expect(s.buildings[1].input.bullet).toBe(5);
    expect(s.store.bullet).toBe(0);
  });

  it('チュートリアルは採掘機の設置・鉄板・歯車・RP で進む', () => {
    const s = bare(false);
    s.ores.push({ x: 0, y: 0, k: 'ironOre' });
    placeBuilding(s, 'miner', 0, 0);
    expect(s.tut).toBe(1);
    placeBuilding(s, 'furnace', 2, 0);
    Object.assign(s.buildings[1].input, { ironOre: 1, coal: 1 });
    run(s, 3);
    expect(s.tut).toBe(2);
    placeBuilding(s, 'assembler', 4, 0);
    s.buildings[2].input.ironPlate = 2;
    run(s, 2);
    expect(s.tut).toBe(3);
    placeBuilding(s, 'lab', 6, 0);
    s.buildings[3].input.redPack = 1;
    run(s, 2.1);
    expect(s.tut).toBe(4);
  });
});

describe('ロボ猫', () => {
  it('起動で倉庫のロボ猫が減り、運搬ロボットが増える', () => {
    const s = initialState(4);
    const n = s.cats.length;
    expect(launchRobot(s)).toBe('倉庫にロボ猫がありません（組立機で作って本部へ）');
    s.store.robot = 1;
    expect(launchRobot(s)).toBeNull();
    expect(s.store.robot).toBe(0);
    expect(s.cats).toHaveLength(n + 1);
    expect(s.cats[n]).toMatchObject({ robot: true, name: 'R-01', x: 0, y: 0 });
  });

  it('運搬でバッテリーが減り、0.2 を切ると充電スタンドへ行って満充電になる', () => {
    const s = bare(false);
    s.researched.push('steel', 'robot');
    s.store.robot = 1;
    launchRobot(s);
    const r = s.cats[0];
    placeBuilding(s, 'fishing', 1, 0);
    placeBuilding(s, 'cannery', 5, 0);
    placeBuilding(s, 'charger', -3, 2);
    const charger = s.buildings[2];
    r.energy = 0.21;
    // 運んでいる間だけ減る（120 秒で 1）
    for (let i = 0; i < 300 && r.rest !== 'charge'; i++) tick(s, DT);
    expect(r.rest).toBe('charge');
    expect(r.restAt).toBe(charger.id);
    expect(r.energy).toBeLessThan(0.2);
    for (let i = 0; i < 300 && r.rest; i++) tick(s, DT);
    expect(r.rest).toBeNull();
    expect(r.energy).toBeGreaterThan(0.99);
    // 職人にはなれない
    expect(assignCat(s, r.id, s.buildings[0].id)).toBe('ロボ猫は職人になれません');
  });
});

describe('リフト', () => {
  /** 釣り場 A（-4,0）→ リフト 3 タイル → 本部（0,0） */
  function line() {
    const s = withHq();
    s.researched.push('steel', 'lift');
    placeBuilding(s, 'fishing', -4, 0);
    for (const x of [-3, -2, -1]) expect(placeLift(s, x, 0, 0)).toBeNull();
    return s;
  }

  it('建物 A → リフト 3 タイル → 建物 B で品が届く', () => {
    const s = withHq();
    s.researched.push('steel', 'lift');
    placeBuilding(s, 'fishing', 2, 2);
    for (const x of [3, 4, 5]) placeLift(s, x, 2, 0);
    placeBuilding(s, 'cannery', 6, 2);
    const [, a, b] = s.buildings;
    run(s, 4);
    expect(b.input.fish ?? 0).toBe(0);
    expect(s.lifts.some((l) => l.items.length)).toBe(true);
    run(s, 2);
    expect(b.input.fish).toBe(1);
    expect(a.output).toBeLessThanOrEqual(1);
    // 置いたリフトの資材は 1 タイル 鉄板 1 + 歯車 1（加工場は鉄板 5）
    expect(s.store.ironPlate).toBe(1000 - 3 - 5);
    expect(s.store.gear).toBe(1000 - 3);
  });

  it('本部に向かうリフトは何でも倉庫に入れる。もう一度置くと向きだけ変わる', () => {
    const s = line();
    run(s, 10);
    expect(s.store.fish).toBeGreaterThanOrEqual(3);
    const plates = s.store.ironPlate;
    expect(placeLift(s, -1, 0, 1)).toBeNull();
    expect(s.store.ironPlate).toBe(plates);
    expect(s.lifts[2].d).toBe(1);
  });

  it('先が満杯なら詰まって、A の出力に溜まる', () => {
    const s = withHq();
    s.researched.push('steel', 'lift');
    placeBuilding(s, 'fishing', 2, 2);
    for (const x of [3, 4, 5]) placeLift(s, x, 2, 0);
    placeBuilding(s, 'cannery', 6, 2);
    const [, a, b] = s.buildings;
    // 出力が満杯の加工場は魚を使わないので、入力も満杯のまま
    Object.assign(b, { output: 10, out: 'can', input: { fish: 10 } });
    run(s, 80);
    expect(s.lifts.map((l) => l.items.length)).toEqual([4, 4, 4]);
    expect(s.lifts[2].items[0].p).toBe(1);
    expect(a.output).toBe(10);
    // 空くと流れ出す
    b.input.fish = 0;
    run(s, 3);
    expect(b.input.fish).toBe(10);
    expect(a.output).toBeLessThan(10);
  });

  it('横から合流する', () => {
    const s = line();
    placeBuilding(s, 'fishing', -2, -2);
    expect(placeLift(s, -2, -1, 1)).toBeNull();
    const [, a, c] = s.buildings;
    s.store.fish = 0;
    run(s, 30);
    // 両方の釣り場の魚が本部へ届き、どちらにも溜まらない
    expect(s.store.fish).toBeGreaterThanOrEqual(24);
    expect(a.output).toBeLessThanOrEqual(1);
    expect(c.output).toBeLessThanOrEqual(1);
  });

  it('リフトの撤去は資材を全部返し、強化は高速リフトの研究が要る', () => {
    const s = line();
    expect(buyResearch(s, 'fastLift')).toBe('RP 不足');
    s.store.ironPlate = 50;
    expect(removeBuilding(s, -3, 0)).toBeNull();
    expect(s.store.ironPlate).toBe(51);
    expect(s.lifts).toHaveLength(2);
  });
});

describe('運搬の優先', () => {
  it('近くの品を本部へ運ぶより、遠くても加工する建物へ材料を運ぶ', () => {
    const s = initialState(4);
    s.cats.length = 1;
    s.ores = [{ x: 1, y: -1, k: 'ironOre' }, { x: 6, y: 6, k: 'coal' }];
    for (const id of ITEM_IDS) s.store[id] = 100;
    placeBuilding(s, 'miner', 1, -1);
    placeBuilding(s, 'miner', 6, 6);
    placeBuilding(s, 'furnace', 2, 1);
    const [, iron, coal, furnace] = s.buildings;
    Object.assign(iron, { output: 10, out: 'ironOre' });
    Object.assign(coal, { output: 10, out: 'coal' });
    furnace.input.ironOre = 10;
    // 近くの鉄鉱石はいつでもある
    for (let i = 0; i < 300; i++) {
      iron.output = 10;
      tick(s, DT);
    }
    expect(furnace.out).toBe('ironPlate');
  });

  it('石炭は近い炉だけでなく、遠い炉にも分けて運ぶ', () => {
    const s = initialState(4);
    s.cats.length = 2;
    s.ores = [{ x: 3, y: 0, k: 'coal' }];
    for (const id of ITEM_IDS) s.store[id] = 100;
    placeBuilding(s, 'miner', 3, 0);
    placeBuilding(s, 'furnace', 4, 0, 'ironPlate');
    placeBuilding(s, 'furnace', -8, 0, 'copperPlate');
    const [, coal, near, far] = s.buildings;
    for (let i = 0; i < 600; i++) {
      coal.output = 10;
      near.input.ironOre = 10;
      far.input.copperOre = 10;
      tick(s, DT);
    }
    expect(far.out).toBe('copperPlate');
  });

  it('鉄板を使う組立機が並んでいても、弾丸の組立機にも配る', () => {
    const s = initialState(4);
    s.cats.length = 2;
    s.researched.push('steel', 'def1');
    for (const id of ITEM_IDS) s.store[id] = 100;
    placeBuilding(s, 'furnace', 3, 0, 'ironPlate');
    placeBuilding(s, 'assembler', 5, 0, 'gear');
    placeBuilding(s, 'assembler', 3, 2, 'bullet');
    const [, furnace, , bullet] = s.buildings;
    // 炉は 3 秒に 1 枚くらいずつ鉄板を出す
    for (let i = 0; i < 600; i++) {
      if (i % 30 === 0) Object.assign(furnace, { output: furnace.output + 1, out: 'ironPlate' });
      tick(s, DT);
    }
    expect(bullet.out).toBe('bullet');
  });

  it('炉の鉄板は、材料の運搬があっても本部へ運ばれる（飢えた材料を先に運んでから）', () => {
    const s = initialState(4);
    s.cats.length = 1;
    s.ores = [{ x: 6, y: 6, k: 'coal' }];
    for (const id of ITEM_IDS) s.store[id] = 100;
    placeBuilding(s, 'miner', 6, 6);
    placeBuilding(s, 'furnace', 2, 1);
    const [, coal, furnace] = s.buildings;
    Object.assign(furnace, { output: 10, out: 'ironPlate', input: { ironOre: 10 } });
    const before = s.store.ironPlate!;
    for (let i = 0; i < 600; i++) {
      coal.output = 10;
      tick(s, DT);
    }
    // 猫 1 匹で、飢えた石炭（遠い採掘機）と満杯の鉄板を交互に運ぶ
    expect(s.store.ironPlate).toBeGreaterThanOrEqual(before + 3);
  });
});

describe('供給と運搬の規則', () => {
  it('本部は確保数を超える鉄板を自動モードの組立機へ配り、確保数を切らない', () => {
    const s = initialState(4);
    s.cats.length = 1;
    s.ores = [];
    placeBuilding(s, 'assembler', 3, 0);
    const asm = s.buildings[1];
    s.store = { ironPlate: 30 };
    let min = Infinity;
    for (let i = 0; i < 1200; i++) {
      tick(s, DT);
      min = Math.min(min, stock(s, 'ironPlate'));
    }
    expect(min).toBe(10);
    expect(stock(s, 'ironPlate')).toBe(10);
    // 20 枚が歯車 10 個になった（本部へ運ばれたか、出力に残っている）
    expect(stock(s, 'gear') + asm.output + (asm.input.ironPlate ?? 0) / 2).toBe(10);
  });

  it('レシピを変えると、新しいレシピで使わない入力だけ本部へ戻す（本部が満杯なら入るだけ）', () => {
    const s = bare(false);
    placeBuilding(s, 'furnace', 0, 0, 'copperPlate');
    placeBuilding(s, 'assembler', 2, 0, 'wire');
    const [furnace, asm] = s.buildings;
    s.store = {};
    furnace.input = { coal: 10, ironOre: 2 };
    setRecipe(s, furnace.id, null);
    expect(furnace.input).toEqual({ coal: 10, ironOre: 2 });
    asm.input = { ironPlate: 10 };
    setRecipe(s, asm.id, 'gear');
    expect(asm.input.ironPlate).toBe(10);
    setRecipe(s, asm.id, 'redPack');
    expect(asm.input.ironPlate).toBe(0);
    expect(stock(s, 'ironPlate')).toBe(10);
    // 本部の空きが 3 なら 3 だけ戻り、7 は残る
    asm.input = { ironPlate: 10, copperPlate: 4 };
    s.store.ironPlate = storeCap(s) - 3;
    setRecipe(s, asm.id, 'wire');
    expect(asm.input).toEqual({ ironPlate: 7, copperPlate: 4 });
    expect(stock(s, 'ironPlate')).toBe(storeCap(s));
  });

  it('本部へ納める仕事は、近い採掘機より遠くで出力が満杯の採掘機を先に拾う', () => {
    const s = initialState(4);
    s.cats.length = 1;
    s.ores = [{ x: 2, y: 0, k: 'coal' }, { x: -8, y: 0, k: 'ironOre' }];
    placeBuilding(s, 'miner', 2, 0);
    placeBuilding(s, 'miner', -8, 0);
    const [, coal, iron] = s.buildings;
    Object.assign(coal, { output: 5, out: 'coal' });
    Object.assign(iron, { output: 10, out: 'ironOre' });
    tick(s, DT);
    expect(s.cats[0]).toMatchObject({ state: 'toSource', src: iron.id, dst: s.buildings[0].id });
  });

  it('自動モードは作れるレシピを順繰りに作る（銅線だけに偏らない）', () => {
    const s = bare(false);
    placeBuilding(s, 'assembler', 0, 0);
    const asm = s.buildings[0];
    asm.input = { copperPlate: 10, gear: 10, ironPlate: 10 };
    const made: string[] = [];
    for (let i = 0; i < 400 && made.length < 6; i++) {
      tick(s, DT);
      if (asm.output > 0) {
        made.push(asm.out!);
        asm.output = 0;
      }
    }
    expect(made).toEqual(['gear', 'wire', 'redPack', 'gear', 'wire', 'redPack']);
  });

  it('供給元のない材料: 固定レシピはその材料、自動はどのレシピも作れないときだけ。鎖の元までたどる', () => {
    const s = bare(false);
    placeBuilding(s, 'furnace', 0, 0, 'copperPlate');
    placeBuilding(s, 'assembler', 2, 0, 'wire');
    const [furnace, asm] = s.buildings;
    s.store = {};
    expect(missingSources(s, furnace)).toEqual(['copperOre', 'coal']);
    // 銅板を作る炉はあるが、その炉に銅鉱石が来ないので銅板も供給元なし
    expect(missingSources(s, asm)).toEqual(['copperPlate']);
    s.store.coal = 11;
    expect(missingSources(s, furnace)).toEqual(['copperOre']);
    // 本部の在庫は確保数（10）を超える分だけ数える
    s.store.copperOre = 10;
    expect(missingSources(s, furnace)).toEqual(['copperOre']);
    s.store.copperOre = 11;
    expect(missingSources(s, furnace)).toEqual([]);
    expect(missingSources(s, asm)).toEqual([]);
    // 入力に揃っていれば警告しない
    s.store = {};
    furnace.input = { copperOre: 1, coal: 1 };
    expect(missingSources(s, furnace)).toEqual([]);
    // 自動は作れるレシピが 1 つでもあれば警告しない（炉の入力の銅鉱石で銅板 → 銅線が作れる）
    setRecipe(s, asm.id, null);
    expect(missingSources(s, asm)).toEqual([]);
    furnace.input = {};
    expect(missingSources(s, asm)).toEqual(['ironPlate']);
    expect(sourceHint('copperOre')).toBe('銅鉱石の供給元がありません。銅鉱石の鉱床に採掘機を置こう');
    expect(sourceHint('copperPlate')).toBe('銅板の供給元がありません。石の炉で銅板を作ろう');
    expect(sourceHint('gear')).toBe('歯車の供給元がありません。組立機で歯車を作ろう');
    expect(sourceHint('fish')).toBe('魚の供給元がありません。釣り場を置こう');
  });

  it('ユーザーのセーブ: 警告が出て、鉄鉱石は本部へ運ばれ、組立機を自動にすると本部の鉄板で歯車ができる', () => {
    const s = parseSave(userSave, Date.now())!.state;
    const furnace = s.buildings.find((b) => b.type === 'furnace')!;
    const asm = s.buildings.find((b) => b.type === 'assembler')!;
    // 炉は「銅板」、組立機は「銅線」に固定されたまま。どちらも銅の供給元がない
    expect(missingSources(s, furnace)).toEqual(['copperOre']);
    expect(missingSources(s, asm)).toEqual(['copperPlate']);
    expect(s.store.ironOre ?? 0).toBe(0);
    setRecipe(s, asm.id, null);
    expect(missingSources(s, asm)).toEqual([]);
    const gear = stock(s, 'gear');
    run(s, 300);
    expect(stock(s, 'ironOre')).toBeGreaterThan(0);
    expect(stock(s, 'gear') + (asm.out === 'gear' ? asm.output : 0)).toBeGreaterThan(gear);
    // 本部の鉄板は確保数を残して組立機へ運ばれた
    expect(stock(s, 'ironPlate')).toBe(10);
  });
});

describe('本部の手作業', () => {
  /** 本部だけの島（猫なし）。鉱床は石と石炭が 1 タイルずつ */
  function hand() {
    const s = initialState(4);
    s.cats = [];
    s.ores = [{ x: 6, y: 6, k: 'stone' }, { x: 7, y: 6, k: 'coal' }];
    s.store = { ironPlate: 10 };
    return s;
  }

  it('歯車の手作りで鉄板が減り、6 秒後に歯車が増える。取り消すと材料が戻る', () => {
    const s = hand();
    expect(queueHand(s, 'gear', 2)).toBeNull();
    expect(stock(s, 'ironPlate')).toBe(6);
    run(s, 5.9);
    expect(stock(s, 'gear')).toBe(0);
    run(s, 0.1);
    expect(stock(s, 'gear')).toBe(1);
    expect(s.hand.q).toEqual([{ id: 'gear', n: 1 }]);
    expect(cancelHand(s, 0)).toBeNull();
    expect(stock(s, 'ironPlate')).toBe(8);
    expect(s.hand.q).toEqual([]);
    expect(queueHand(s, 'gear', 5)).toBe('資材が足りません（鉄板 2）');
  });

  it('鉱床がない種類は手掘りできない。ある種類は 6 秒で 1 個', () => {
    const s = hand();
    expect(queueHand(s, 'ironOre', 1)).toBe('島に鉄鉱石の鉱床がありません');
    expect(queueHand(s, 'stone', 1)).toBeNull();
    run(s, 6);
    expect(stock(s, 'stone')).toBe(1);
    // 弾丸は防衛 I から
    expect(queueHand(s, 'bullet', 1)).toBe('研究「防衛 I」が必要です');
  });

  it('キューは 10 件までで、11 件目は拒否する（最後と同じ品はまとめる）', () => {
    const s = hand();
    for (let i = 0; i < 10; i++) expect(queueHand(s, i % 2 ? 'coal' : 'stone', 1)).toBeNull();
    expect(queueHand(s, 'stone', 1)).toBe('手作業のキューがいっぱいです（10 件まで）');
    expect(queueHand(s, 'coal', 3)).toBeNull();
    expect(s.hand.q.length).toBe(10);
    expect(s.hand.q[9]).toEqual({ id: 'coal', n: 4 });
  });

  it('本部が故障中は進まない', () => {
    const s = hand();
    const hq = s.buildings[0];
    queueHand(s, 'gear', 1);
    // 本部は襲撃のないとき自然に直るので、毎 tick 壊しておく
    for (let i = 0; i < 100; i++) {
      hq.hp = 0;
      tick(s, DT);
    }
    expect(stock(s, 'gear')).toBe(0);
    expect(s.hand.t).toBe(0);
    hq.hp = 100;
    run(s, 6);
    expect(stock(s, 'gear')).toBe(1);
  });

  it('倉庫が満杯なら完成を待ち、キューも減らない。空けばすぐ入る', () => {
    const s = hand();
    s.store.gear = storeCap(s);
    queueHand(s, 'gear', 1);
    run(s, 10);
    expect(stock(s, 'gear')).toBe(storeCap(s));
    expect(s.hand.q).toEqual([{ id: 'gear', n: 1 }]);
    s.store.gear = storeCap(s) - 1;
    run(s, 0.1);
    expect(stock(s, 'gear')).toBe(storeCap(s));
    expect(s.hand.q).toEqual([]);
  });

  it('初期資材で採掘機 3・炉 2・組立機 1 を建ててもまだ歯車が残る。足りなくなれば手作りの案が出る', () => {
    const s = initialState(4);
    const ores = s.ores.slice(0, 3);
    for (const o of ores) expect(placeBuilding(s, 'miner', o.x, o.y)).toBeNull();
    expect(placeBuilding(s, 'furnace', 1, 0)).toBeNull();
    expect(placeBuilding(s, 'furnace', 2, 0)).toBeNull();
    expect(placeBuilding(s, 'assembler', 3, 0)).toBeNull();
    expect(stock(s, 'gear')).toBeGreaterThan(0);
    // 歯車を使い切ると、組立機の不足分（歯車 5）は手作りで 5 回
    s.store.gear = 0;
    expect(handPlan(s, { ironPlate: 10, gear: 5 })).toEqual([{ id: 'gear', n: 5 }]);
    queueHand(s, 'gear', 2);
    expect(handPlan(s, { ironPlate: 10, gear: 5 })).toEqual([{ id: 'gear', n: 3 }]);
  });

  it('出力が満杯の建物の説明: 本部に空きがあれば運び手待ち、本部も満杯なら倉庫がいっぱい、道がなければ道がない', () => {
    const s = hand();
    s.ores.push({ x: 2, y: 0, k: 'ironOre' });
    s.store.ironPlate = 1000;
    s.store.brick = 1000;
    s.store.gear = 1000;
    placeBuilding(s, 'miner', 2, 0);
    const m = s.buildings[1];
    expect(outputStatus(s, m)).toBe('運び手を待っています');
    s.store.ironOre = storeCap(s);
    expect(outputStatus(s, m)).toBe('倉庫がいっぱいです');
    for (const [x, y] of [[1, 0], [3, 0], [2, 1], [2, -1]]) placeBuilding(s, 'fence', x, y);
    expect(outputStatus(s, m)).toBe('道が通じていません');
  });
});

describe('建物の停止', () => {
  it('止めた建物は作らず、材料を受け取らない。入っていた材料は倉庫へ戻り、動かすと作りかけの続きから作る', () => {
    const s = bare(false);
    placeBuilding(s, 'assembler', 0, 0, 'gear');
    const asm = s.buildings[0];
    asm.input = { ironPlate: 5 };
    s.store = {};
    run(s, 1);
    // 歯車を作りかけ（鉄板 2 枚は使った）
    expect(asm).toMatchObject({ running: true, input: { ironPlate: 3 } });
    expect(setOff(s, [asm.id], true)).toBeNull();
    expect(asm).toMatchObject({ off: true, running: false, input: { ironPlate: 0 } });
    expect(stock(s, 'ironPlate')).toBe(3);
    expect(accepts(s, asm, 'ironPlate')).toBe(false);
    run(s, 10);
    expect(asm.output).toBe(0);
    expect(asm.progress).toBeCloseTo(1, 5);
    expect(setOff(s, [asm.id], false)).toBeNull();
    expect(asm.off).toBeUndefined();
    expect(asm.running).toBe(true);
    run(s, 1);
    expect(asm).toMatchObject({ output: 1, out: 'gear', running: false });
  });

  it('止めた組立機には本部の鉄板が配られず、動いている弾丸の組立機へ回る', () => {
    const s = initialState(4);
    s.cats.length = 1;
    s.ores = [];
    s.researched.push('steel', 'def1');
    placeBuilding(s, 'assembler', 3, 0, 'gear');
    placeBuilding(s, 'assembler', -3, 0, 'bullet');
    const [, gear, bullet] = s.buildings;
    s.store = { ironPlate: 30 };
    setOff(s, [gear.id], true);
    run(s, 120);
    expect(gear.input.ironPlate ?? 0).toBe(0);
    expect(gear.output).toBe(0);
    // 確保数 10 を超える 20 枚は弾丸 40 発になった（本部へ運ばれたか、出力・入力に残っている）
    expect(stock(s, 'ironPlate')).toBe(10);
    expect(stock(s, 'bullet') + bullet.output + 2 * (bullet.input.ironPlate ?? 0)).toBe(40);
  });

  it('止める前に運び始めた材料は、届いたときに倉庫へ戻す', () => {
    const s = initialState(4);
    s.cats.length = 1;
    s.ores = [];
    placeBuilding(s, 'assembler', 4, 0, 'gear');
    const asm = s.buildings[1];
    s.store = { ironPlate: 30 };
    const cat = s.cats[0];
    for (let i = 0; i < 300 && !(cat.state === 'toDest' && cat.dst === asm.id); i++) tick(s, DT);
    expect(cat.state).toBe('toDest');
    const carried = cat.amount;
    const before = stock(s, 'ironPlate');
    setOff(s, [asm.id], true);
    for (let i = 0; i < 300 && cat.state !== 'idle'; i++) tick(s, DT);
    expect(asm.input.ironPlate ?? 0).toBe(0);
    expect(stock(s, 'ironPlate')).toBe(before + carried);
  });

  it('リフトも止めた建物には品を入れず、手前で詰まる', () => {
    const s = withHq();
    s.researched.push('steel', 'lift');
    placeBuilding(s, 'fishing', 2, 2);
    for (const x of [3, 4, 5]) placeLift(s, x, 2, 0);
    placeBuilding(s, 'cannery', 6, 2);
    const b = s.buildings[2];
    setOff(s, [b.id], true);
    run(s, 20);
    expect(b.input.fish ?? 0).toBe(0);
    expect(s.lifts.reduce((a, l) => a + l.items.length, 0)).toBeGreaterThan(0);
    setOff(s, [b.id], false);
    run(s, 2);
    expect(b.input.fish).toBeGreaterThan(0);
  });

  it('まとめて止められる。本部や市場は止められない。止めた建物は供給元に数えない', () => {
    const s = bare(false);
    placeBuilding(s, 'assembler', 0, 0, 'gear');
    placeBuilding(s, 'assembler', 2, 0, 'gear');
    placeBuilding(s, 'market', 4, 0);
    const [a, b, m] = s.buildings;
    s.store = {};
    a.input = { ironPlate: 4 };
    expect(suppliedItems(s).has('gear')).toBe(true);
    expect(setOff(s, [a.id, b.id, m.id], true)).toBeNull();
    expect([a.off, b.off, m.off]).toEqual([true, true, undefined]);
    expect(suppliedItems(s).has('gear')).toBe(false);
    expect(setOff(s, [m.id], true)).toBe('止められる建物がありません');
    expect(setOff(s, [a.id, b.id], false)).toBeNull();
    expect([a.off, b.off]).toEqual([undefined, undefined]);
  });
});
