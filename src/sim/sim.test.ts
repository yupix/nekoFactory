import { describe, expect, it } from 'vitest';
import { STAT_GROWTH } from './data';
import { assignCat, buyResearch, catSpeed, expandCost, expandIsland, facilityUsers, gridSize, hireCat, infiniteCost, initialState, placeBuilding, removeBuilding, tradeMultiplier, upgradeBuilding, type Cat, type GameState } from './state';
import { dump, factory, hash } from './fixture';
import { simOptions, tick } from './tick';

const DT = 0.1;
function run(s: GameState, seconds: number) {
  for (let i = 0; i < Math.round(seconds / DT); i++) tick(s, DT);
}
function rich() {
  const s = initialState();
  s.coins = 1e6;
  s.cats = []; // 猫に運ばせない
  return s;
}

describe('sim', () => {
  it('釣り場が 2 秒で魚を 1 つ出力し、出力 10 で停止する', () => {
    const s = rich();
    placeBuilding(s, 'fishing', 3, 3);
    const b = s.buildings[0];
    run(s, 1.9);
    expect(b.output).toBe(0);
    run(s, 0.1);
    expect(b.output).toBe(1);
    run(s, 60);
    expect(b.output).toBe(10);
    expect(b.running).toBe(false);
  });

  it('猫が魚を市場に届けるとコインが価値分増える', () => {
    const s = initialState();
    expect(placeBuilding(s, 'fishing', 1, 0)).toBeNull();
    expect(placeBuilding(s, 'market', 3, 0)).toBeNull();
    const start = s.coins;
    const events = [];
    for (let i = 0; i < 100 && s.coins === start; i++) events.push(...tick(s, DT));
    expect(s.coins - start).toBe(5);
    expect(events).toEqual([{ kind: 'coin', amount: 5, x: 3, y: 0 }]);
  });

  it('加工場が魚 2 → 猫缶 1 を生産する', () => {
    const s = rich();
    placeBuilding(s, 'cannery', 0, 0);
    const b = s.buildings[0];
    b.input.fish = 3;
    run(s, 2.9);
    expect(b.input.fish).toBe(1);
    expect(b.output).toBe(0);
    run(s, 0.1);
    expect(b.output).toBe(1);
    run(s, 10); // 残り魚 1 では次の生産は始まらない
    expect(b.output).toBe(1);
    expect(b.input.fish).toBe(1);
  });

  it('研究所がアイテムを受け取って 1 秒後に RP が増え、入力 10 個で満杯になり受け付けなくなる', () => {
    const s = initialState();
    s.coins = 1e6;
    placeBuilding(s, 'fishing', 1, 0);
    placeBuilding(s, 'lab', 3, 0);
    const [fishing, lab] = s.buildings;
    fishing.output = 1;
    // 猫が魚を研究所の入力へ届けるまで進める（市場はない）
    for (let i = 0; i < 100 && !lab.input.fish; i++) tick(s, DT);
    expect(lab.input.fish).toBe(1);
    run(s, 0.9);
    expect(s.rp).toBe(0);
    const events = tick(s, DT);
    expect(s.rp).toBe(1); // 魚の価値 5 ÷ 5
    expect(events).toContainEqual({ kind: 'rp', amount: 1, x: 3, y: 0 });
    expect(lab.input.fish).toBe(0);

    // 入力が 10 個なら受け付けず、市場があればそちらへ運ぶ（進行中の仕事は取り消してから確認）
    Object.assign(s.cats[0], { state: 'idle', path: [], item: null, amount: 0 });
    lab.input.fish = 10;
    fishing.output = 5;
    tick(s, DT);
    expect(s.cats[0].state).toBe('idle');
    expect(fishing.output).toBe(5);
    placeBuilding(s, 'market', -2, 0);
    tick(s, DT);
    expect(s.cats[0].state).toBe('toSource');
    expect(s.cats[0].dst).toBe(s.buildings[2].id);
  });

  it('研究購入で RP が減り、前提未達や RP 不足では失敗する', () => {
    const s = initialState();
    s.rp = 200;
    expect(buyResearch(s, 'yarn')).toBe('前提: 包装');
    expect(buyResearch(s, 'pack')).toBeNull();
    expect(s.rp).toBe(50);
    expect(s.researched).toEqual(['pack']);
    expect(buyResearch(s, 'pack')).toBe('研究済み');
    expect(buyResearch(s, 'yarn')).toBe('RP 不足');
    expect(s.rp).toBe(50);
    expect(s.researched).toEqual(['pack']);
  });

  it('島を広げるとコインが減り、敷地が 1 周（+4）広がる', () => {
    const s = initialState();
    s.coins = 2000;
    expect(gridSize(s)).toBe(20);
    expect(expandCost(s)).toBe(500);
    expect(placeBuilding(s, 'fishing', -12, 0)).toBe('敷地の外です');
    expect(expandIsland(s)).toBeNull();
    expect(s.coins).toBe(1500);
    expect(gridSize(s)).toBe(24);
    expect(expandCost(s)).toBe(1000);
    expect(expandIsland(s)).toBeNull();
    expect(gridSize(s)).toBe(28);
    expect(s.coins).toBe(500);
    expect(expandIsland(s)).toBe('コインが足りません');
    expect(placeBuilding(s, 'fishing', -12, 0)).toBeNull(); // 広がった外周に建てられる
    s.expansions = 10;
    s.coins = 1e9;
    expect(gridSize(s)).toBe(60);
    expect(expandIsland(s)).toBe('これ以上は広げられません');
  });

  it('無限研究はレベルごとにコストが上がり、効果が積み重なる', () => {
    const s = initialState();
    s.rp = 100000;
    expect(buyResearch(s, 'speedInf')).toBe('前提: 速足 III');
    s.researched.push('speed1', 'speed2', 'speed3', 'pack');
    const base = catSpeed(s);
    expect(infiniteCost(s, 'speedInf')).toBe(1000);
    expect(buyResearch(s, 'speedInf')).toBeNull();
    expect(infiniteCost(s, 'speedInf')).toBe(1600);
    expect(buyResearch(s, 'speedInf')).toBeNull();
    expect(infiniteCost(s, 'speedInf')).toBe(2560);
    expect(s.rp).toBe(100000 - 1000 - 1600);
    expect(catSpeed(s)).toBeCloseTo(base + 2 * 0.05 * 2);

    // 交渉∞ ×2 で市場の売値が 1.1 倍
    expect(buyResearch(s, 'tradeInf')).toBeNull();
    expect(buyResearch(s, 'tradeInf')).toBeNull();
    expect(tradeMultiplier(s)).toBeCloseTo(1.1);
    placeBuilding(s, 'market', 1, 0);
    const cat = s.cats[0];
    Object.assign(cat, { x: 1, y: 0, state: 'toDest', item: 'luxury', amount: 1, dst: s.buildings[0].id, path: [] });
    const before = s.coins;
    tick(s, DT);
    expect(s.coins - before).toBe(440);
  });

  it('元気が 0 近くの猫は眠り、眠り終わると元気が 1 に戻る', () => {
    const s = initialState(7);
    const cat = s.cats[0];
    cat.energy = 0.02;
    let i = 0;
    while (cat.rest !== 'sleep' && i++ < 600) tick(s, DT);
    expect(cat.rest).toBe('sleep');
    // 寝ている間はその場から動かない
    const at = [cat.x, cat.y];
    run(s, 5);
    expect([cat.x, cat.y]).toEqual(at);
    expect(cat.rest).toBe('sleep');
    i = 0;
    while (cat.rest === 'sleep' && i++ < 200) tick(s, DT);
    expect(i).toBeLessThan(110); // 8〜15 秒で起きる
    expect(cat.rest).toBeNull();
    expect(cat.energy).toBe(1);
  });

  it('同じ建物から同時に出発した 2 匹は 0.35 タイル以上離れる', () => {
    const s = initialState(3);
    s.coins = 1e6;
    placeBuilding(s, 'fishing', 0, 0);
    placeBuilding(s, 'market', 6, 0);
    const [src, dst] = s.buildings;
    hireCat(s);
    for (const c of s.cats) Object.assign(c, { x: 0.62, y: 0, nx: 1, ny: 0, state: 'toSource', item: 'fish', amount: 1, src: src.id, dst: dst.id, path: [] });
    run(s, 1.5);
    const [a, b] = s.cats;
    expect(a.state).toBe('toDest');
    expect(b.state).toBe('toDest');
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(0.35);
  });

  it('疲れた猫は 10 タイル以内のベッドへ歩いて行き、休むと元気が 1 に戻ってベッドが空く', () => {
    const s = initialState(5);
    s.coins = 1e6;
    placeBuilding(s, 'bed', 4, 0);
    const bed = s.buildings[0];
    const cat = s.cats[0];
    cat.energy = 0.02;
    let i = 0;
    while (cat.restAt !== bed.id && i++ < 600) tick(s, DT);
    expect(cat.rest).toBe('sleep');
    expect(facilityUsers(s, bed)).toBe(1);
    run(s, 3);
    expect(Math.round(cat.x)).toBe(4); // ベッドの上で寝ている
    expect(cat.energy).toBeLessThan(0.1);
    i = 0;
    while (cat.restAt === bed.id && i++ < 200) tick(s, DT);
    expect(cat.energy).toBe(1);
    expect(facilityUsers(s, bed)).toBe(0);
  });

  it('向かい合って歩く 2 匹は擦れ違いの間ずっと 0.3 タイル以上離れている', () => {
    const s = initialState(9);
    s.coins = 1e6;
    hireCat(s);
    const [a, b] = s.cats;
    const line = (from: number, to: number) => Array.from({ length: Math.abs(to - from) }, (_, k) => ({ x: from + Math.sign(to - from) * (k + 1), y: 0 }));
    Object.assign(a, { x: -5, y: 0, nx: -5, ny: 0, hx: 1, hy: 0, path: line(-5, 5) });
    Object.assign(b, { x: 5, y: 0, nx: 5, ny: 0, hx: -1, hy: 0, path: line(5, -5) });
    let min = Infinity;
    let passed = false;
    for (let k = 0; k < 80; k++) {
      tick(s, DT);
      min = Math.min(min, Math.hypot(a.x - b.x, a.y - b.y));
      passed ||= a.x > b.x;
    }
    expect(passed).toBe(true);
    expect(min).toBeGreaterThanOrEqual(0.3);
  });

  it('高速化の前後で結果が変わらない（猫 50・建物 150・36×36 を 600 tick）', () => {
    // 高速化前のコードで取ったダンプのハッシュ。再探索の 0.5 秒待ちと、
    // 出荷元 BFS の逆順の経路（距離は同じで同じ長さの経路の選び方だけが違う）は結果を変えるので切って比べる。
    // 猫の個性（脚力による速度・気質による疲れ方）で値が変わる。ステータス 0・気質ふつう・成長なしなら旧値 e7254fa5 / rp 471 と一致する
    const saved = { ...simOptions };
    Object.assign(simOptions, { retry: 0, reversePath: false });
    try {
      const s = factory(50, 150, 36);
      run(s, 60);
      expect({ coins: s.coins, rp: s.rp, hash: hash(dump(s)) }).toEqual({ coins: 0, rp: 466, hash: '3c579ce2' });
    } finally {
      Object.assign(simOptions, saved);
    }
  });

  describe('猫の個性・配属・成長', () => {
    /** 個性を固定した猫（得意: 研究、苦手: 力持ち、ステータスはすべて 0） */
    const plain = (c: Cat, stats: Partial<Cat['stats']> = {}) =>
      Object.assign(c, { good: 'study', bad: 'str', temper: 'normal', stats: { leg: 0, str: 0, fish: 0, cook: 0, craft: 0, study: 0, ...stats } });
    /** 生産を 1 回終えるまでの秒数 */
    function cycle(s: GameState, i = 0) {
      const b = s.buildings[i];
      Object.assign(b, { output: 0, progress: 0, running: false });
      let t = 0;
      while (b.output === 0 && t < 10) {
        tick(s, 0.01);
        t += 0.01;
      }
      return t;
    }
    /** 職人が作業位置に着くまで進める */
    function untilWorking(s: GameState, cats: Cat[]) {
      for (let i = 0; i < 300 && !cats.every((c) => c.work); i++) tick(s, DT);
      expect(cats.every((c) => c.work)).toBe(true);
    }

    it('運搬中に脚力が伸び、得意なら 2 倍、苦手なら半分、100 で止まる', () => {
      const s = initialState();
      s.coins = 1e6;
      placeBuilding(s, 'market', 9, 0);
      const cat = plain(s.cats[0], { leg: 10 });
      const carry = () => Object.assign(cat, { x: -9, y: 0, nx: -9, ny: 0, state: 'toDest', item: 'fish', amount: 1, dst: s.buildings[0].id, path: Array.from({ length: 18 }, (_, k) => ({ x: -8 + k, y: 0 })) });
      carry();
      run(s, 3);
      expect(cat.state).toBe('toDest');
      expect(cat.stats.leg - 10).toBeCloseTo(3 * STAT_GROWTH, 6);
      expect(cat.stats.str).toBe(0); // 1 個しか持っていない
      cat.stats.leg = 10;
      cat.good = 'leg';
      carry();
      run(s, 3);
      expect(cat.stats.leg - 10).toBeCloseTo(6 * STAT_GROWTH, 6);
      cat.stats.leg = 10;
      Object.assign(cat, { good: 'study', bad: 'leg' });
      carry();
      run(s, 3);
      expect(cat.stats.leg - 10).toBeCloseTo(1.5 * STAT_GROWTH, 6);
      cat.stats.leg = 100 - STAT_GROWTH;
      Object.assign(cat, { good: 'leg', bad: 'str' });
      carry();
      run(s, 3);
      expect(cat.stats.leg).toBe(100);
      // 何もしていない猫は伸びない
      Object.assign(cat, { state: 'idle', item: null, amount: 0, path: [], retry: 99 });
      cat.stats.leg = 10;
      run(s, 3);
      expect(cat.stats.leg).toBe(10);
    });

    it('配属した職人で生産時間が (1 + 値/100) 倍短くなり、得意ならさらに ×1.25', () => {
      const s = rich();
      hireCat(s);
      placeBuilding(s, 'fishing', 0, 0);
      const b = s.buildings[0];
      expect(cycle(s)).toBeCloseTo(2, 1);
      const cat = plain(s.cats[0], { fish: 50 });
      Object.assign(cat, { x: 3, y: 3, nx: 3, ny: 3 });
      expect(assignCat(s, cat.id, b.id)).toBeNull();
      // 歩いている間はボーナスがない
      expect(cycle(s)).toBeCloseTo(2, 1);
      untilWorking(s, [cat]);
      expect(cycle(s)).toBeCloseTo(2 / 1.5, 1);
      cat.good = 'fish';
      cat.stats.fish = 50;
      expect(cycle(s)).toBeCloseTo(2 / (1.5 * 1.25), 1);
      // 職人は運搬ジョブを取らない（市場があっても作業位置に留まる）
      placeBuilding(s, 'market', 4, 0);
      b.output = 5;
      run(s, 2);
      expect(cat.state).toBe('idle');
      expect(cat.work).toBe(true);
    });

    it('力持ち 50 で運搬量 +1、100 で +2', () => {
      const amountWith = (str: number) => {
        const s = initialState();
        s.coins = 1e6;
        placeBuilding(s, 'fishing', 1, 0);
        placeBuilding(s, 'market', 3, 0);
        s.buildings[0].output = 5;
        plain(s.cats[0], { str });
        tick(s, DT);
        return s.cats[0].amount;
      };
      expect(amountWith(49.9)).toBe(1);
      expect(amountWith(50)).toBe(2);
      expect(amountWith(99.9)).toBe(2);
      expect(amountWith(100)).toBe(3);
    });

    it('配属先を撤去すると運び屋に戻る', () => {
      const s = initialState();
      s.coins = 1e6;
      placeBuilding(s, 'fishing', 0, 2);
      placeBuilding(s, 'fishing', 1, 0);
      placeBuilding(s, 'market', 3, 0);
      const [work, src] = s.buildings;
      const cat = s.cats[0];
      expect(assignCat(s, cat.id, work.id)).toBeNull();
      untilWorking(s, [cat]);
      src.output = 3;
      run(s, 1);
      expect(cat.state).toBe('idle'); // 職人なので運ばない
      expect(removeBuilding(s, work.x, work.y)).toBeNull();
      expect(cat.job).toBe(0);
      expect(cat.work).toBe(false);
      tick(s, DT);
      expect(cat.state).toBe('toSource');
      expect(cat.src).toBe(src.id);
    });
  });

  describe('建物のティア', () => {
    it('強化でコインが減りティアが上がり、生産時間が 1/1.5 になる', () => {
      const s = rich();
      s.researched.push('pack', 'tier2', 'tier3');
      placeBuilding(s, 'fishing', 0, 0);
      const b = s.buildings[0];
      const coins = s.coins;
      expect(upgradeBuilding(s, b.id)).toBeNull();
      expect(s.coins).toBe(coins - 50 * 4);
      expect(b.tier).toBe(2);
      run(s, 2 / 1.5 - 0.05);
      expect(b.output).toBe(0);
      run(s, 0.1);
      expect(b.output).toBe(1);
      // ティア 2 の出力上限は 15
      run(s, 60);
      expect(b.output).toBe(15);
      // 強化コストは設置数によらない
      placeBuilding(s, 'fishing', 2, 0);
      expect(upgradeBuilding(s, b.id)).toBeNull();
      expect(s.coins).toBe(coins - 50 * 4 - Math.floor(50 * 1.15) - 50 * 12);
      expect(b.tier).toBe(3);
      expect(upgradeBuilding(s, b.id)).toBe('最大ティアです');
      // 撤去の返金は強化分も含めて 50%
      const before = s.coins;
      removeBuilding(s, 0, 0);
      expect(s.coins - before).toBe(Math.floor((Math.floor(50 * 1.15) + 50 * 16) * 0.5));
    });

    it('研究が未達なら強化できない', () => {
      const s = rich();
      placeBuilding(s, 'market', 0, 0);
      const b = s.buildings[0];
      const coins = s.coins;
      expect(upgradeBuilding(s, b.id)).toBe('研究「増築」が必要です');
      s.researched.push('pack', 'tier2');
      expect(upgradeBuilding(s, b.id)).toBeNull();
      expect(upgradeBuilding(s, b.id)).toBe('研究「大改装」が必要です');
      expect(b.tier).toBe(2);
      expect(s.coins).toBe(coins - 100 * 4);
      s.researched.push('tier3');
      s.coins = 100 * 12 - 1;
      expect(upgradeBuilding(s, b.id)).toBe('コインが足りません');
      expect(b.tier).toBe(2);
    });

    it('ティア 3 で職人 2 匹を配属でき、ボーナスが乗算になる', () => {
      const s = rich();
      s.researched.push('pack', 'tier2', 'tier3');
      for (let i = 0; i < 3; i++) hireCat(s);
      placeBuilding(s, 'fishing', 0, 0);
      const b = s.buildings[0];
      const [a, c, d] = s.cats;
      for (const [k, cat] of s.cats.entries()) Object.assign(cat, { x: -3 + k, y: 3, nx: -3 + k, ny: 3, good: k === 1 ? 'fish' : 'study', bad: 'str', temper: 'normal', stats: { leg: 0, str: 0, fish: k === 1 ? 20 : 40, cook: 0, craft: 0, study: 0 } });
      expect(assignCat(s, a.id, b.id)).toBeNull();
      expect(assignCat(s, c.id, b.id)).toBe('職人がいっぱいです');
      upgradeBuilding(s, b.id);
      upgradeBuilding(s, b.id);
      expect(assignCat(s, c.id, b.id)).toBeNull();
      expect(assignCat(s, d.id, b.id)).toBe('職人がいっぱいです');
      for (let i = 0; i < 300 && !(a.work && c.work); i++) tick(s, DT);
      expect(a.work && c.work).toBe(true);
      // 作業位置は別々の辺
      expect([Math.round(a.wx), Math.round(a.wy)]).not.toEqual([Math.round(c.wx), Math.round(c.wy)]);
      a.stats.fish = 40;
      c.stats.fish = 20;
      Object.assign(b, { output: 0, progress: 0, running: false });
      let t = 0;
      while (b.output === 0 && t < 10) {
        tick(s, 0.01);
        t += 0.01;
      }
      expect(t).toBeCloseTo(2 / (2.25 * 1.4 * 1.2 * 1.25), 1);
    });
  });
});
