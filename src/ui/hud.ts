import type { Quality, QualityInfo } from '../render/scene';
import type { CoatKey, ThumbKey } from '../render/thumbs';
import { liftSpeed } from '../sim/lift';
import { BUILDINGS, FACILITY, FUEL, GOOD_BONUS, GRID, HAND, INFINITE, ITEMS, LIFT, MULTI_RECIPE, RAID, RECIPES, RECIPES_OF, RESEARCH, ROBOT, STAT_IDS, STATS, WEAPONS, WORK_STAT, type BuildingType, type Cost, type HandId, type InfiniteId, type ItemId, type RecipeId, type StatId } from '../sim/data';
import { accepts, canPause, isLeaving, MOOD_NAME, moodOf, bufferCap, buildingCount, catCount, crafterCap, craftersOf, expandCost, facilityCap, facilityUsers, fuelOut, gridSize, handPlan, has, hireCost, hpBase, isBroken, isUnlocked, isWorking, liftLineCost, liftUpgradeCost, marketRate, maxHp, missing, missingSources, productionSpeed, recipesOf, recipeTime, recipeUnlocked, refundOf, repairAllCost, repairCost, researchBlocker, robotCount, sameSetup, sourceHint, statBonus, statLevel, stock, storeCap, suppliedItems, TIER_MAX, TIER_RESEARCH, tierSpeed, traitText, TUTORIAL, tutorialDone, upgradeBlocker, upgradeCost, uses, usesFuel, weaponDamage, weaponRange, type Building, type Cat, type GameState, type Lift } from '../sim/state';
import { haulStatus, outputStatus } from '../sim/haul';
import { hasInputs, outputFull } from '../sim/tick';
import type { Bus, GameAudio } from './audio';
import { ICON } from './icons';

export type Mode = BuildingType | 'remove' | 'lift' | null;

const COAT_COLOR: Record<CoatKey, number> = { white: 0xf3ece2, black: 0x3b3433, brown: 0xd98f4e, gray: 0x9b9ca3, calico: 0xe6b27a, saba: 0x8c9088 };
const thumbs = new Map<ThumbKey, string>();
/** サムネイルの URL。できるまでは色付きのプレースホルダ */
export function thumbUrl(key: ThumbKey) {
  const url = thumbs.get(key);
  if (url) return url;
  const [kind, id] = key.split(':');
  const c = kind === 'building' ? BUILDINGS[id as BuildingType].color : kind === 'item' ? ITEMS[id as ItemId].color : kind === 'coat' ? COAT_COLOR[id as CoatKey] : kind === 'lift' ? 0x8a96a3 : 0x9fb3c4;
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" rx="3" fill="#${c.toString(16).padStart(6, '0')}" opacity=".6"/></svg>`)}`;
}
/** サムネイルの img タグ（できたら setThumb で差し替わる） */
export const thumbImg = (key: ThumbKey, attrs = 'alt=""') => `<img data-thumb="${key}" src="${thumbUrl(key)}" ${attrs}>`;
/** できたサムネイルを登録し、表示中の img も差し替える */
export function setThumb(key: ThumbKey, url: string) {
  thumbs.set(key, url);
  for (const img of document.querySelectorAll<HTMLImageElement>(`img[data-thumb="${key}"]`)) img.src = url;
}
export const itemImg = (id: ItemId, cls = 'it') => thumbImg(`item:${id}`, `class="${cls}" alt="${ITEMS[id].name}" title="${ITEMS[id].name}"`);

const UNITS = ['K', 'M', 'B', 'T'];
/** 1234 → 1.2K、3456789 → 3.5M */
export function fmt(n: number): string {
  if (Math.abs(n) < 1000) return String(Math.floor(n));
  let i = -1;
  while (Math.abs(n) >= 1000 && i < UNITS.length - 1) {
    n /= 1000;
    i++;
  }
  return `${n.toFixed(1)}${UNITS[i]}`;
}

/** 資材のアイコンと個数（足りない品は赤）。have を渡さなければ色分けしない */
export function costHtml(cost: Cost, s?: GameState, mult = 1) {
  const short = s ? missing(s, cost, mult) : {};
  return (Object.keys(cost) as ItemId[]).map((id) => `<span class="c${short[id] ? ' short' : ''}" data-c="${id}">${itemImg(id, 'ci')}<b>${fmt(cost[id]! * mult)}</b></span>`).join('');
}
/** costHtml で作った資材の表示の不足分だけ更新する */
export function syncCost(box: Element, cost: Cost, s: GameState, mult = 1) {
  const short = missing(s, cost, mult);
  for (const e of box.querySelectorAll<HTMLElement>('[data-c]')) e.classList.toggle('short', !!short[e.dataset.c as ItemId]);
}

/** ホバーできない端末（タッチ）。ツールチップ・ホバー音は使わず、タップで情報を出す */
const hoverless = matchMedia('(hover: none)');
/** 狭い画面と横持ち: 上部 HUD を 1 行にし、研究・サウンド・島の拡張はメニューから（style.css と同じ条件） */
const compact = matchMedia('(max-width: 640px), (max-height: 500px)');
/** 横持ち: 建設バーは右端の縦並び */
const side = matchMedia('(max-height: 500px)');
/** 縦持ちの狭い画面: 情報カードは全画面シート */
const sheet = matchMedia('(max-width: 640px)');

type Slot = BuildingType | 'lift';
/** 建設バーのグループ。本部は建てられない */
const GROUPS: { label: string; cls: string; types: Slot[] }[] = [
  { label: '生産', cls: 'make', types: ['miner', 'furnace', 'assembler', 'fishing', 'cannery', 'lab'] },
  { label: '物流', cls: 'log', types: ['market', 'warehouse', 'lift', 'charger'] },
  { label: '防衛', cls: 'def', types: ['waterGun', 'turret', 'cannon', 'fence'] },
  { label: '休憩', cls: 'rest', types: ['bed', 'toybox', 'tower'] },
];
export const DESC: Record<BuildingType | 'lift', string> = {
  miner: '鉱床の上に置くと、その鉱石を掘り出す。',
  furnace: `石炭を燃やして鉱石を焼き、鉄板・銅板・石レンガにする。石炭 1 個で ${FUEL.burn} 秒。`,
  assembler: '板から歯車・銅線・回路基板・研究パックを組み立てる。',
  fishing: '池で魚を釣り上げる。材料はいらない。',
  cannery: '魚をことこと煮て猫缶にする。',
  lab: '研究パックを 2 秒に 1 個調べて研究点（RP）にする。',
  market: '倉庫で「売る」にした品を、1 秒に 1 個ずつ売ってコインに換える。',
  warehouse: '本部の倉庫の容量を各アイテム +200 する。',
  charger: 'ロボ猫が充電に来る。2 台まで、10 秒で満充電。',
  lift: '頭上のケーブルで品を吊って運ぶ。建物から離れる向きに置くと積み込み、建物に向けると届ける。',
  bed: '疲れた猫がふかふかのベッドでぐっすり眠る。6 秒で元気いっぱい。',
  toybox: 'ボールを転がして遊ぶ。4 秒で元気 +60%。',
  tower: '段を登って、上で眠るか爪とぎ。5 秒で元気 +80%。',
  hq: '猫たちの本部で、全部の品の倉庫。猫はここから出てくる。壊されると襲撃に負け、コインを奪われる。',
  waterGun: '近づいた犬に水をかける。弾はいらない。',
  turret: '弾丸を連射する。猫が組立機や本部から弾丸を運んでくる。',
  cannon: '砲弾で遠くの犬をまとめて吹き飛ばす。',
  fence: '犬も猫も通れない頑丈な柵。囲うと犬は柵をかじる。',
};
const slotName = (t: Slot) => (t === 'lift' ? 'リフト' : BUILDINGS[t].name);
const slotCost = (t: Slot) => (t === 'lift' ? LIFT.cost : BUILDINGS[t].cost);
const slotUnlocked = (s: GameState, t: Slot) => (t === 'lift' ? has(s, 'lift') : isUnlocked(s, t));
const slotLock = (t: Slot) => RESEARCH[t === 'lift' ? 'lift' : BUILDINGS[t].unlock!].name;
const DIR_NAME = ['東', '南', '西', '北'];

const setText = (el: Element, text: string) => {
  if (el.textContent !== text) el.textContent = text;
};
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};
/** CSS アニメーションを最初から再生し直す */
export function replay(e: HTMLElement, cls: string) {
  e.classList.remove(cls);
  void e.offsetWidth;
  e.classList.add(cls);
}

/** 表示値を目標値へなめらかに寄せ、増えたら弾ませる */
class Counter {
  shown: number;
  private last: number;
  constructor(private out: HTMLElement, private pill: HTMLElement, start: number) {
    this.shown = this.last = start;
    out.textContent = fmt(start);
  }
  update(target: number, dt: number) {
    const d = target - this.shown;
    this.shown = Math.abs(d) < 0.5 ? target : this.shown + d * (1 - Math.exp(-dt * 7));
    setText(this.out, fmt(this.shown));
    if (target > this.last + 0.5 && !this.pill.classList.contains('bump')) replay(this.pill, 'bump');
    if (target < this.last - 0.5) replay(this.pill, 'spend');
    this.last = target;
  }
}

export interface HudHandlers {
  audio: GameAudio;
  /** 建設・撤去のモードを切り替える（同じものをもう一度選ぶと解除、null で解除） */
  select(m: Mode): void;
  /** 今のモード */
  mode(): Mode;
  /** 猫を雇う（雇えたら true） */
  hire(): boolean;
  research(): void;
  /** 猫の一覧を開閉する */
  cats(): void;
  expand(): void;
  reset(): void;
  /** 保存データを JSON ファイルとしてダウンロードする */
  exportSave(): void;
  importSave(file: File): void;
  remove(b: Building): void;
  deselect(): void;
  /** 猫を追う（null で解除） */
  follow(id: number | null): void;
  following(): number | null;
  wake(c: Cat): void;
  /** 猫を建物の職人にする・はずす */
  assign(c: Cat, b: Building): void;
  unassign(c: Cat): void;
  upgrade(b: Building): void;
  repair(b: Building): void;
  repairAll(): void;
  /** 石の炉・組立機のレシピを変える（null は自動） */
  recipe(b: Building, r: RecipeId | null): void;
  /** 建物を止める（true）・動かす（false） */
  setOff(ids: number[], off: boolean): void;
  /** リフトの配置で向きを回す */
  rotate(): void;
  liftTurn(l: Lift): void;
  liftUpgrade(l: Lift, all: boolean): void;
  removeLift(l: Lift): void;
  /** 倉庫パネルを開閉する */
  store(): void;
  /** 倉庫パネルの手作業タブを開く */
  craft(): void;
  /** 建設の不足分を本部の手作業のキューに入れる */
  hand(list: { id: HandId; n: number }[]): void;
  quality: { get(): QualityInfo; set(q: 'auto' | Quality): void };
}

const COAT_NAME: Record<CoatKey, string> = { white: '白', black: '黒', brown: '茶トラ', gray: 'グレー', calico: '三毛', saba: 'サバトラ' };
export const coatKey = (c: Pick<Cat, 'id' | 'color'>): CoatKey => (c.color === 'gray' && c.id % 2 ? 'saba' : c.color);

/** ティアの効果の説明 */
function tierEffect(type: BuildingType, tier: number) {
  const fac = FACILITY[type];
  const k = tier - 1;
  if (WEAPONS[type]) return `射程 +${k}・ダメージ ×${1.5 ** k}・HP ×${tier}`;
  if (type === 'fence' || type === 'hq') return `HP ×${tier}`;
  if (type === 'charger') return `定員 ${fac!.cap + k}・HP ×${tier}`;
  if (fac) return `定員 ${fac.cap + k}・回復 ×${1 + 0.25 * k}`;
  if (type === 'market') return `売却 ${2 ** k} 個/秒`;
  if (type === 'warehouse') return `HP ×${tier}`;
  const cap = `上限 ${10 + 5 * k}`;
  const crew = tier >= 3 ? '・職人 2 匹' : '';
  if (type === 'lab') return `RP ×${1 + 0.25 * k}・${cap}${crew}`;
  return `生産速度 ×${1.5 ** k}・${cap}${crew}`;
}
const stars = (tier: number) => '★'.repeat(tier) + '☆'.repeat(TIER_MAX - tier);
/** 秒 → m:ss */
export const clock = (sec: number) => {
  const t = Math.max(0, Math.ceil(sec));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/** 猫の今の様子（ラベルと色） */
export function catMood(c: Cat): [string, string] {
  if (c.away) return isLeaving(c) ? (c.away.phase === 'raft' ? ['いかだで海へ…', 'full'] : ['家出しようとしている', 'full']) : ['帰ってくる', 'ok'];
  if (c.rest === 'charge') return [c.restAt && c.path.length ? '充電に向かう' : '充電中', 'wait'];
  if (c.robot && c.state === 'idle') return ['待機中', 'idle'];
  if (c.flee > 0) return ['犬から逃げている', 'full'];
  if (c.rest && c.restAt && c.path.length) return ['休憩に向かう', 'wait'];
  if (c.job && !c.rest && c.state === 'idle') return c.work ? ['作業中', 'ok'] : ['作業場へ', 'wait'];
  if (c.rest === 'sleep') return [c.lazy ? 'うたた寝' : 'お昼寝中', 'sleep'];
  if (c.rest === 'play') return [c.lazy ? 'あそび中' : 'ひと休み', 'wait'];
  if (c.state === 'toSource') return ['取りに行く', 'ok'];
  if (c.state === 'toDest') return ['運んでいる', 'ok'];
  return ['のんびり', 'idle'];
}

/** 上部 HUD・建設バー・ツールチップ・情報カード・トースト・ダイアログ・チュートリアル */
export function createHud(h: HudHandlers) {
  const sfx = h.audio.play;

  document.body.insertAdjacentHTML(
    'beforeend',
    `<header id="hud" class="ui">
      <div class="brand panel">${thumbImg('coat:brown')}<b>ねこ工場</b></div>
      <div class="res panel">
        <div class="pill coin" id="coin-pill"><i>${ICON.coin}</i><b id="coins">0</b><small id="rate"></small></div>
        <div class="pill rp" id="rp-pill"><i>${ICON.rp}</i><b id="rp">0</b><small>RP</small></div>
        <button class="pill cats" id="cat-pill" title="猫の一覧"><i>${ICON.cat}</i><b id="cats">0</b><small id="cats-sub">匹</small></button>
        <button class="pill store" id="store-pill" title="倉庫"><i>${ICON.box}</i><b>倉庫</b></button>
      </div>
      <div class="tools panel">
        <button id="expand-btn" class="btn">${ICON.island}<span>島を広げる</span><small class="cost"><i>${ICON.coin}</i><b></b></small></button>
        <button id="research-btn" class="btn primary">${ICON.flask}<span>研究</span><em id="research-badge" hidden></em></button>
        <button id="sound-btn" class="btn icon" title="サウンド">${ICON.sound}</button>
        <button id="menu-btn" class="btn icon" title="設定">${ICON.gear}<em id="menu-badge" hidden></em></button>
      </div>
    </header>
    <div id="sound-pop" class="pop panel" hidden>
      <h4>サウンド</h4>
      ${(['bgm', 'sfx', 'amb'] as Bus[]).map((b) => `<label class="slider"><span>${{ bgm: 'BGM', sfx: '効果音', amb: '環境音' }[b]}</span><input type="range" min="0" max="100" data-bus="${b}"><output></output></label>`).join('')}
      <button id="mute-btn" class="toggle"><span>ミュート</span><b></b></button>
    </div>
    <div id="menu-pop" class="pop panel" hidden>
      <div id="menu-main" class="menu-main"><button id="cats-btn" class="btn">${ICON.cat}<span>猫の一覧</span></button></div>
      <h4>設定</h4>
      <div class="quality"><span>${ICON.sparkle}画質<small id="q-now"></small></span><div class="seg">${(['auto', 2, 1, 0] as const).map((q) => `<button data-q="${q}">${{ auto: '自動', 2: '高', 1: '中', 0: '低' }[q]}</button>`).join('')}</div></div>
      <p id="fx-note" class="note" hidden></p>
      <div class="save-row"><button id="export-btn" class="btn">エクスポート</button><button id="import-btn" class="btn">インポート</button></div>
      <input id="import-file" type="file" accept=".json,application/json" hidden>
      <p id="saved-at" class="note">まだ保存していません</p>
      <button id="reset-btn" class="btn danger wide">最初からやり直す</button>
    </div>
    <div id="raid" class="panel ui" hidden><i class="dog">${ICON.dog}</i><div class="rt"><small></small><b></b></div><button id="repair-all" class="btn" hidden>${ICON.hammer}<span>全修理</span><small><i>${ICON.coin}</i><b></b></small></button></div>
    <div id="raid-band" hidden></div>
    <div id="raid-edge" hidden></div>
    <div id="away" class="panel ui" hidden role="alert"><img class="face" alt=""><span><b></b>が家出しようとしている！</span><button class="btn primary">${ICON.follow}<span>見る</span></button></div>
    <nav id="bar" class="ui panel"></nav>
    <div id="place-opts" class="panel ui" hidden></div>
    <div id="tip" class="tip panel" hidden></div>
    <aside id="info" class="card panel" hidden></aside>
    <div id="toasts"></div>
    <div id="dialog" hidden><div class="dialog panel"></div></div>
    <div id="tutorial" class="card panel ui" hidden>
      <div class="tut-head">${thumbImg('coat:brown')}<b>ねこ工場へようこそ！</b></div>
      <ol>
        <li data-step="0"><i><b>1</b>${ICON.check}</i><span>色のついた岩（<b>鉱床</b>）に<b>採掘機</b>を置こう。鉄鉱石と石炭の鉱床に 1 つずつ</span></li>
        <li data-step="1"><i><b>2</b>${ICON.check}</i><span><b>石の炉</b>を置いて<b>鉄板</b>を作ろう。猫が鉱石と石炭を運んでくれる</span></li>
        <li data-step="2"><i><b>3</b>${ICON.check}</i><span><b>組立機</b>で鉄板から<b>歯車</b>を作ろう</span></li>
        <li data-step="3"><i><b>4</b>${ICON.check}</i><span>銅板と歯車で<b>赤パック</b>を作り、<b>研究所</b>へ届けて RP をためよう</span></li>
      </ol>
      <p class="keys touch"><span>1 本指で移動</span><span>2 本指でズーム・回転</span><span>同じ場所を 2 回タップで設置</span><span>長押しで撤去</span></p>
      <p class="keys mouse"><span><kbd>ドラッグ</kbd><kbd>WASD</kbd>移動</span><span><kbd>ホイール</kbd>ズーム</span><span><kbd>Q</kbd><kbd>E</kbd><kbd>右ドラッグ</kbd>回転</span><span><kbd>右クリック</kbd><kbd>Esc</kbd>解除</span></p>
    </div>`,
  );
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const coinPill = $('coin-pill');
  const coins = new Counter($('coins'), coinPill, 0);
  const rp = new Counter($('rp'), $('rp-pill'), 0);

  // --- ボタンの音 ---
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse' || hoverless.matches) return;
    const b = (e.target as HTMLElement).closest('button');
    if (b && !b.contains(e.relatedTarget as Node)) sfx('hover');
  });
  document.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('button')) sfx('click');
  });

  // --- ポップオーバー ---
  const pops = [$('sound-pop'), $('menu-pop')];
  function togglePop(p: HTMLElement, anchor: HTMLElement) {
    const open = p.hidden;
    // 狭い画面ではサウンドもメニューの中にあるので、メニューボタンの下に出す
    const r = (compact.matches ? $('menu-btn') : anchor).getBoundingClientRect();
    for (const q of pops) q.hidden = true;
    p.hidden = !open;
    if (open) {
      p.style.top = `${r.bottom + 10}px`;
      p.style.right = `${Math.max(10, innerWidth - r.right)}px`;
      sfx('open');
    } else sfx('close');
  }
  $('sound-btn').onclick = (e) => togglePop($('sound-pop'), e.currentTarget as HTMLElement);
  $('menu-btn').onclick = (e) => togglePop($('menu-pop'), e.currentTarget as HTMLElement);
  document.addEventListener('pointerdown', (e) => {
    const t = e.target as HTMLElement;
    if (!t.closest('.pop') && !t.closest('#sound-btn') && !t.closest('#menu-btn')) for (const q of pops) q.hidden = true;
  });
  const st = h.audio.settings;
  for (const input of document.querySelectorAll<HTMLInputElement>('#sound-pop input')) {
    const bus = input.dataset.bus as Bus;
    const out = input.nextElementSibling as HTMLOutputElement;
    input.value = String(Math.round(st[bus] * 100));
    out.value = input.value;
    input.style.setProperty('--v', `${input.value}%`);
    input.oninput = () => {
      out.value = input.value;
      input.style.setProperty('--v', `${input.value}%`);
      h.audio.set(bus, Number(input.value) / 100);
    };
    input.onchange = () => sfx(bus === 'bgm' ? 'click' : bus === 'sfx' ? 'coin' : 'select');
  }
  const syncSound = () => {
    $('mute-btn').classList.toggle('on', st.muted);
    setText($('mute-btn').querySelector('b')!, st.muted ? 'ON' : 'OFF');
    $('sound-btn').innerHTML = st.muted ? ICON.mute : ICON.sound;
    $('sound-btn').classList.toggle('off', st.muted);
  };
  $('mute-btn').onclick = () => {
    h.audio.set('muted', !st.muted);
    syncSound();
  };
  syncSound();
  const LEVEL = ['低', '中', '高'];
  const syncQuality = () => {
    const q = h.quality.get();
    for (const b of document.querySelectorAll<HTMLButtonElement>('#menu-pop .seg button')) b.classList.toggle('on', b.dataset.q === (q.auto ? 'auto' : String(q.level)));
    setText($('q-now'), q.auto ? `いまは「${LEVEL[q.level]}」` : q.level === 2 ? '影・光のにじみ・陰影すべて' : q.level === 1 ? '光のにじみだけ' : 'エフェクトと影なし・軽量');
  };
  for (const b of document.querySelectorAll<HTMLButtonElement>('#menu-pop .seg button'))
    b.onclick = () => {
      h.quality.set(b.dataset.q === 'auto' ? 'auto' : (Number(b.dataset.q) as Quality));
      syncQuality();
    };
  syncQuality();
  $('export-btn').onclick = h.exportSave;
  const importFile = $<HTMLInputElement>('import-file');
  $('import-btn').onclick = () => importFile.click();
  importFile.onchange = () => {
    const f = importFile.files?.[0];
    importFile.value = '';
    if (!f) return;
    for (const q of pops) q.hidden = true;
    h.importSave(f);
  };
  $('reset-btn').onclick = () => {
    for (const q of pops) q.hidden = true;
    h.reset();
  };
  $('cat-pill').onclick = $('cats-btn').onclick = () => {
    for (const q of pops) q.hidden = true;
    h.cats();
  };
  $('store-pill').onclick = () => {
    for (const q of pops) q.hidden = true;
    h.store();
  };
  $('research-btn').onclick = () => {
    for (const q of pops) q.hidden = true;
    h.research();
  };
  const expandBtn = $('expand-btn');
  expandBtn.onclick = h.expand;
  // 狭い画面では研究・サウンド・島の拡張をメニューへ移す
  const tools = document.querySelector('#hud .tools')!;
  const placeTools = () => (compact.matches ? $('menu-main').append($('research-btn'), $('sound-btn'), expandBtn) : tools.prepend(expandBtn, $('research-btn'), $('sound-btn')));
  compact.addEventListener('change', placeTools);
  placeTools();

  // --- 建設バー ---
  const bar = $('bar');
  const tip = $('tip');
  const slotFor = (type: Slot, parent: HTMLElement) => {
    const b = el('button', 'slot', `${thumbImg(type === 'lift' ? 'lift' : `building:${type}`)}<span class="name">${slotName(type)}</span><span class="cost">${costHtml(slotCost(type))}</span><span class="lock">${ICON.lock}</span>`);
    b.onclick = () => slotUnlocked(state(), type) && h.select(type);
    parent.appendChild(b);
    return { type, el: b, cost: b.querySelector('.cost')! };
  };
  const slots: ReturnType<typeof slotFor>[] = [];
  for (const g of GROUPS) {
    const grp = el('div', `grp ${g.cls}`, `<span class="glabel">${g.label}</span>`);
    const row = el('div', 'gbtns');
    grp.appendChild(row);
    bar.appendChild(grp);
    slots.push(...g.types.map((t) => slotFor(t, row)));
  }
  const catTools = el('div', 'grp tools', '<span class="glabel">猫</span>');
  const toolRow = el('div', 'gbtns');
  catTools.appendChild(toolRow);
  bar.appendChild(catTools);
  const hire = el('button', 'slot hire', `${thumbImg('coat:brown')}<span class="name">猫を雇う</span><span class="cost coin"><i>${ICON.coin}</i><b></b></span>`);
  // 運び手不足のヒントの強調（チュートリアルの guide とは別のタイマーで外す。雇えたらすぐ外す）
  let hireGuide = 0;
  const unguideHire = () => {
    clearTimeout(hireGuide);
    hire.classList.remove('guide');
  };
  hire.onclick = () => h.hire() && unguideHire();
  const remove = el('button', 'slot remove', `<i class="big">${ICON.hammer}</i><span class="name">撤去</span><span class="cost sub">資材 50% 返却</span>`);
  remove.onclick = () => h.select('remove');
  toolRow.append(hire, remove);

  // 設置中の補助: 石の炉・組立機のレシピ、リフトの向き
  const opts = $('place-opts');
  const placeRecipes: Partial<Record<BuildingType, RecipeId | null>> = {};
  let optsKey = '';
  function updateOpts(s: GameState, mode: Mode) {
    const multi = mode && mode !== 'remove' && mode !== 'lift' && MULTI_RECIPE.includes(mode);
    // 資材が足りなければ不足分と、手作業でまかなえるなら「本部で手作りできる」
    const cost = mode && mode !== 'remove' ? slotCost(mode) : null;
    const short = cost ? missing(s, cost) : {};
    const lack = Object.keys(short).length > 0;
    const plan = lack ? handPlan(s, cost!) : [];
    // タッチでは右クリック・Esc がないので、やめるボタンを出す
    const cancel = !!mode && hoverless.matches;
    const key = (multi ? `${mode}:${placeRecipes[mode] ?? ''}:${s.researched.length}` : mode === 'lift' ? `lift:${liftDir}` : mode === 'miner' ? 'miner' : '') + (lack ? `|${JSON.stringify(short)}:${plan.length}` : '') + (cancel ? `|x:${mode}` : '');
    opts.hidden = !key;
    if (key === optsKey) return;
    optsKey = key;
    opts.innerHTML = '';
    if (multi) {
      const cur = placeRecipes[mode] ?? null;
      const list = (RECIPES_OF[mode] ?? []).filter((id) => recipeUnlocked(s, id));
      opts.innerHTML = `<span class="ol">作るもの</span><div class="chips">${[null, ...list].map((id) => `<button class="chip${cur === id ? ' on' : ''}" data-r="${id ?? ''}">${id ? `${itemImg(RECIPES[id].out!, 'ci')}${ITEMS[RECIPES[id].out!].name}` : '自動'}</button>`).join('')}</div>`;
      for (const c of opts.querySelectorAll<HTMLButtonElement>('[data-r]'))
        c.onclick = () => {
          placeRecipes[mode] = (c.dataset.r || null) as RecipeId | null;
          sfx('select');
        };
    } else if (mode === 'miner') {
      opts.innerHTML = `<span class="ol">採掘機</span><span>色のついた岩（鉱床）の上にだけ置ける。赤は鉄鉱石、橙は銅鉱石、黒は石炭、灰色は石</span>`;
    } else if (mode === 'lift') {
      opts.innerHTML = `<span class="ol">向き</span><b class="dir"><i style="transform: rotate(${liftDir * 90}deg)">${ICON.arrow}</i>${DIR_NAME[liftDir]}</b><button class="btn rot" data-rot="1">${ICON.rotate}<span>回転</span><kbd>R</kbd></button><small>ドラッグで続けて置ける。置いたリフトにもう一度置くと向きだけ変わる</small>`;
      opts.querySelector<HTMLButtonElement>('[data-rot]')!.onclick = () => h.rotate();
    }
    if (cancel) {
      opts.insertAdjacentHTML('afterbegin', `<button class="btn cancel">${ICON.close}<span>${mode === 'remove' ? '撤去をやめる' : '設置をやめる'}</span></button>`);
      opts.querySelector<HTMLButtonElement>('.cancel')!.onclick = () => {
        hideTip();
        h.select(null);
        sfx('close');
      };
    }
    if (lack) {
      opts.insertAdjacentHTML('beforeend', `<div class="short"><span>資材が足りません</span><span class="cost">${costHtml(short)}</span>${plan.length ? `<button class="btn primary craft">${ICON.hammer}<span>本部で手作りできる</span></button>` : ''}</div>`);
      const btn = opts.querySelector<HTMLButtonElement>('.craft');
      if (btn) btn.onclick = () => h.hand(handPlan(state(), slotCost(mode as Slot)));
    }
  }
  let liftDir = 0;

  let tipFor: HTMLElement | null = null;
  let tipHtml = '';
  /** タッチではタップしたボタンの説明をこの時刻まで出す */
  let tipUntil = 0;
  const showTip = (anchor: HTMLElement, html: string) => {
    tipFor = anchor;
    if (html !== tipHtml) tip.innerHTML = tipHtml = html;
    tip.hidden = false;
    const r = anchor.getBoundingClientRect();
    const w = tip.offsetWidth;
    const th = tip.offsetHeight;
    if (side.matches && anchor !== expandBtn) {
      // 右端の縦並びバー: ボタンの左に出す
      tip.style.left = `${r.left - w - 12}px`;
      tip.style.top = `${Math.min(innerHeight - th - 10, Math.max(10, r.top + r.height / 2 - th / 2))}px`;
      return;
    }
    tip.style.left = `${Math.min(innerWidth - w - 10, Math.max(10, r.left + r.width / 2 - w / 2))}px`;
    // 設置中の補助（やめるボタン・作るもの）が出ていれば、それを隠さないよう上に出す
    const top = opts.hidden ? r.top : Math.min(r.top, opts.getBoundingClientRect().top);
    tip.style.top = anchor === expandBtn ? `${r.bottom + 12}px` : `${top - th - 12}px`;
  };
  const hideTip = () => {
    tipFor = null;
    tipUntil = 0;
    tip.hidden = true;
  };
  for (const s of [...slots.map((x) => x.el), hire, remove, expandBtn]) {
    s.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && !hoverless.matches && (tipFor = s));
    s.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && hideTip());
    // タッチ: 選んだときだけ短く出す（もう一度タップして設置をやめたときは出さない）。ボタンの onclick の後に走るので、モードは切り替わった後
    s.addEventListener('click', () => {
      if (!hoverless.matches || s === expandBtn) return;
      const slot = slots.find((x) => x.el === s);
      // 未解放の建物は選べないので、解放に要る研究を見せる
      const show = slot ? !slotUnlocked(state(), slot.type) || h.mode() === slot.type : s === hire || h.mode() === 'remove';
      if (!show) return hideTip();
      tipFor = s;
      tipUntil = performance.now() + 2500;
    });
  }
  // タッチで出した説明は、画面のどこかに触れたら閉じる（地図の操作の邪魔をしない）
  addEventListener('pointerdown', () => tipUntil && hideTip(), true);

  const timeHtml = (sec: number, s: GameState) => `<span class="time">${ICON.clock}${(sec / productionSpeed(s)).toFixed(1)}秒</span>`;
  function recipeRow(id: RecipeId, s: GameState, out?: ItemId | null) {
    const r = RECIPES[id];
    const ins = (Object.keys(r.in) as ItemId[]).map((i) => `${itemImg(i)}<b>×${r.in[i]}</b>`).join('<span class="plus">+</span>');
    const o = r.out ?? out;
    const lock = !recipeUnlocked(s, id) ? `<span class="rlock">${ICON.lock}${RESEARCH[r.unlock!].name}</span>` : '';
    return `<div class="recipe${lock ? ' locked' : ''}" data-recipe="${id}">${ins || '<span class="any">鉱床から</span>'}${ICON.arrow}${o ? itemImg(o) : '<span class="any">鉱石</span>'}${r.n > 1 ? `<b>×${r.n}</b>` : ''}${lock || timeHtml(r.time, s)}</div>`;
  }
  function recipe(t: Slot, s: GameState) {
    if (t === 'lift') return `<div class="recipe"><i class="ic">${ICON.arrow}</i><span>${LIFT.speed} タイル/秒・1 タイルにフック ${LIFT.hooks} 個</span></div>`;
    const fac = FACILITY[t];
    if (t === 'charger') return `<div class="recipe"><i class="ic">${ICON.bolt}</i><span>ロボ猫の充電・定員 ${fac!.cap}・${fac!.time}秒</span></div>`;
    if (fac)
      return `<div class="recipe"><i class="ic">${ICON.heart}</i><span>${fac.kinds.map((k) => (k === 'sleep' ? 'お昼寝' : 'あそび')).join('・')}</span><span class="time">定員 ${fac.cap}・${fac.time}秒</span></div>`;
    const w = WEAPONS[t];
    if (w)
      return `<div class="recipe">${w.ammo ? `${itemImg(w.ammo)}<b>×1</b>` : '<span class="any">弾いらず</span>'}${ICON.arrow}<i class="ic">${ICON.dog}</i><span>射程 ${w.range}・${w.rate}発/秒・${w.dmg}${w.splash ? `・範囲 ${w.splash}` : ''}</span></div>`;
    if (t === 'fence') return `<div class="recipe"><i class="ic">${ICON.shield}</i><span>HP ${hpBase(t)}・犬の通り道をふさぐ</span></div>`;
    if (t === 'hq') return `<div class="recipe"><i class="ic">${ICON.box}</i><span>倉庫 各 ${storeCap(s)}・HP ${hpBase(t)}</span></div>`;
    if (t === 'market') return `<div class="recipe"><i class="ic">${ICON.box}</i><span>倉庫の「売る」品</span>${ICON.arrow}<i class="ic">${ICON.coin}</i><span>売値ぶん</span></div>`;
    if (t === 'warehouse') return `<div class="recipe"><i class="ic">${ICON.box}</i><span>倉庫の容量 各 +200</span></div>`;
    if (t === 'lab')
      return `<div class="recipe">${(['redPack', 'greenPack', 'bluePack'] as ItemId[]).map((id) => `${itemImg(id)}<b>${ITEMS[id].rp}</b>`).join('')}<i class="ic">${ICON.rp}</i>${timeHtml(2, s)}</div>`;
    // 燃料を使う建物は、どのレシピにも燃料が要る
    const fuel = FUEL.users.includes(t) ? `<div class="recipe">${itemImg(FUEL.item)}<b>×1</b>${ICON.arrow}<i class="ic">${ICON.bolt}</i><span>燃料 ${FUEL.burn}秒</span></div>` : '';
    return `<div class="recipes">${(RECIPES_OF[t] ?? []).map((id) => recipeRow(id, s)).join('')}${fuel}</div>`;
  }
  function buildingTip(t: Slot, s: GameState) {
    const n = t === 'lift' ? s.lifts.length : buildingCount(s, t);
    const lock = !slotUnlocked(s, t) ? `<p class="need">${ICON.lock}研究「${slotLock(t)}」で解放</p>` : '';
    // タッチでは画面を覆わないよう、レシピの多い建物（石の炉・組立機）の一覧は省く（作るものは設置中のチップで選べる）
    const long = t !== 'lift' && MULTI_RECIPE.includes(t) && hoverless.matches;
    return `<h4>${slotName(t)}${n ? `<small>${n} ${t === 'lift' ? 'タイル' : '棟'}</small>` : ''}</h4><p>${DESC[t]}</p>${long ? '' : recipe(t, s)}${lock || `<p class="price cost">${costHtml(slotCost(t), s)}</p>`}`;
  }

  // --- 情報カード ---
  const info = $('info');
  let infoId: number | null = null;
  /** 開いているカードの組み立ての目印（レシピや研究が変わったら作り直す） */
  let infoKey = '';
  /** 建物が入力に受け取る品（研究所は研究パックの合計 1 行。燃料を使う建物は燃料を必ず出す） */
  const inputsOf = (s: GameState, b: Building): ItemId[] => {
    const w = WEAPONS[b.type];
    if (w) return w.ammo ? [w.ammo] : [];
    const set = new Set<ItemId>();
    for (const id of recipesOf(s, b)) for (const i of Object.keys(RECIPES[id].in) as ItemId[]) set.add(i);
    if (usesFuel(b)) set.add(FUEL.item);
    // レシピで使わない材料が残っていれば（本部が満杯で戻せなかった分）それも出す
    for (const i of Object.keys(b.input) as ItemId[]) if ((b.input[i] ?? 0) > 0) set.add(i);
    return [...set];
  };
  /** レシピのチップに出す、供給元のない材料（レシピ id → 品） */
  const chipMissing = (s: GameState, b: Building, supplied: Set<ItemId>) =>
    MULTI_RECIPE.includes(b.type) ? Object.fromEntries((RECIPES_OF[b.type] ?? []).map((id) => [id, (Object.keys(RECIPES[id].in) as ItemId[]).filter((i) => !supplied.has(i))])) : {};
  const cardKey = (s: GameState, b: Building, supplied = suppliedItems(s)) => `${b.id}:${b.recipe}:${s.researched.length}:${JSON.stringify(chipMissing(s, b, supplied))}`;
  function openInfo(b: Building, s: GameState) {
    infoId = b.id;
    catId = null;
    liftSel = null;
    // 作り直したカードの出力の行は空なので、次の更新で必ず描く
    outKey = '';
    const supplied = suppliedItems(s);
    infoKey = cardKey(s, b, supplied);
    const miss = chipMissing(s, b, supplied);
    const def = BUILDINGS[b.type];
    const rows: string[] = [];
    if (b.type === 'lab') rows.push(`<div class="row" data-k="lab"><span class="any">研究パック</span><div class="meter"><i></i></div><b></b></div>`);
    for (const id of inputsOf(s, b)) {
      const fuel = id === FUEL.item && usesFuel(b);
      rows.push(`<div class="row" data-k="in:${id}">${itemImg(id)}<span>${ITEMS[id].name}${fuel ? '（燃料）' : uses(s, b, id) ? '' : '<small>（使わない）</small>'}</span><div class="meter"><i></i></div><b></b></div><p class="haul" data-h="${id}" hidden></p>`);
      if (fuel) rows.push(`<div class="row" data-k="fuel"><i class="ic">${ICON.bolt}</i><span>燃料</span><div class="meter"><i></i></div><b></b></div>`);
    }
    if (RECIPES_OF[b.type]) {
      rows.push(`<div class="row out" data-k="out"><span class="slot-it"></span><span class="out-name"></span><div class="meter"><i></i></div><b></b></div>`);
      rows.push(`<div class="row prog" data-k="prog"><i class="ic">${ICON.clock}</i><span>生産</span><div class="meter"><i></i></div><b></b></div>`);
    }
    if (b.type === 'lab') rows.push(`<div class="row prog" data-k="prog"><i class="ic">${ICON.clock}</i><span>研究</span><div class="meter"><i></i></div><b></b></div>`);
    if (b.type === 'hq') rows.push(`<div class="row prog" data-k="hand"><i class="ic">${ICON.hammer}</i><span>手作業</span><div class="meter"><i></i></div><b></b></div>`);
    if (FACILITY[b.type]) rows.push(`<div class="row" data-k="use"><i class="ic">${ICON.cat}</i><span>使用中</span><div class="meter"><i></i></div><b></b></div>`);
    rows.push(`<div class="row hp" data-k="hp"><i class="ic">${ICON.shield}</i><span>耐久</span><div class="meter"><i></i></div><b></b></div>`);
    const multi = MULTI_RECIPE.includes(b.type);
    const pickRecipe = multi
      ? `<div class="rpick"><span class="ol">作るもの</span><div class="chips">${[null, ...(RECIPES_OF[b.type] ?? [])]
          .map((id) => {
            const lock = id && !recipeUnlocked(s, id);
            const none = id && !lock ? miss[id] ?? [] : [];
            const noneHtml = none.length ? `<span class="miss" title="供給元のない材料: ${none.map((i) => ITEMS[i].name).join('・')}">${none.map((i) => itemImg(i, 'ci')).join('')}</span>` : '';
            return `<button class="chip${b.recipe === id ? ' on' : ''}" data-act="recipe" data-r="${id ?? ''}" ${lock ? `disabled title="研究「${RESEARCH[RECIPES[id!].unlock!].name}」で解放"` : ''}>${id ? `${itemImg(RECIPES[id].out!, 'ci')}${ITEMS[RECIPES[id].out!].name}${lock ? ICON.lock : ''}${noneHtml}` : '自動'}</button>`;
          })
          .join('')}</div><p class="note">${b.recipe ? '猫はこのレシピの材料だけ運ぶ' : '自動: 入力に揃った材料から作れるものを順繰りに作る'}。使わない材料は倉庫へ戻します</p></div>`
      : '';
    pickOpen = false;
    crewHtml = pickHtml = tierHtml = runHtml = '';
    info.innerHTML = `<header>${thumbImg(`building:${b.type}`)}<div><h3>${def.name}</h3><span class="state"></span></div><button class="x" title="閉じる">${ICON.close}</button></header>
      <p class="desc">${DESC[b.type]}</p>${pickRecipe}${multi ? (b.recipe ? recipeRow(b.recipe, s) : '') : recipe(b.type, s)}
      ${canPause(b) ? '<div class="run-box"></div>' : ''}
      <div class="stocks">${rows.join('')}</div>
      ${b.type === 'hq' ? `<div class="actions"><button class="btn" data-act="store">${ICON.box}<span>倉庫を開く</span></button><button class="btn" data-act="craft">${ICON.hammer}<span>手作業</span></button></div>` : ''}
      ${WORK_STAT[b.type] ? '<div class="crew"></div><div class="pick" hidden></div>' : ''}
      <div class="tier-box"></div>
      <p class="hint"></p>
      <button class="btn primary wide repair" data-act="repair" hidden>${ICON.hammer}<span>修理する</span><small><i>${ICON.coin}</i><b></b></small></button>
      ${b.type === 'hq' ? '' : `<button class="btn danger wide remove">${ICON.hammer}<span>撤去する</span><small class="cost"></small></button>`}`;
    info.querySelector<HTMLButtonElement>('.x')!.onclick = () => h.deselect();
    const rm = info.querySelector<HTMLButtonElement>('.remove');
    if (rm) {
      rm.querySelector('small')!.innerHTML = costHtml(refundOf(s, b));
      rm.onclick = () => {
        const cur = state().buildings.find((x) => x.id === infoId);
        if (cur) h.remove(cur);
      };
    }
    info.hidden = false;
    replay(info, 'enter');
  }
  let outKey = '';
  function updateInfo(s: GameState) {
    if (infoId === null) return;
    const b = s.buildings.find((x) => x.id === infoId);
    if (!b) return h.deselect();
    const supplied = suppliedItems(s);
    if (cardKey(s, b, supplied) !== infoKey) return openInfo(b, s);
    const producer = !!RECIPES_OF[b.type];
    const full = outputFull(s, b);
    // 出力に別の品が残っていて、材料の揃ったレシピに進めない（容量ではなく品の違いで止まっている）
    const mixed =
      full && !!b.out && b.output < bufferCap(b) && !recipesOf(s, b).some((id) => (RECIPES[id].out ?? b.out) === b.out && (Object.keys(RECIPES[id].in) as ItemId[]).every((i) => (b.input[i] ?? 0) >= RECIPES[id].in[i]!));
    const waiting = (producer || b.type === 'lab') && !b.off && !b.running && !full && !hasInputs(s, b);
    // 燃料切れ（作りかけのまま止まっていることもある）
    const noFuel = producer && !b.off && !full && fuelOut(s, b);
    // 作りかけで燃料切れのときは、燃料の供給元だけを見る
    const none = producer && waiting ? missingSources(s, b, supplied) : noFuel ? missingSources(s, b, supplied).filter((i) => i === FUEL.item) : [];
    const fac = FACILITY[b.type];
    const used = fac ? facilityUsers(s, b) : 0;
    const broken = isBroken(b);
    const w = WEAPONS[b.type];
    const empty = !!w?.ammo && (b.input[w.ammo] ?? 0) < 1;
    const selling = Object.keys(s.sell).length;
    const [label, cls] = broken
      ? ['故障中', 'full']
      : b.off
        ? ['停止中', 'off']
        : w
        ? b.running
          ? ['射撃中', 'ok']
          : empty
            ? ['弾切れ', 'full']
            : ['見張り中', 'idle']
        : b.type === 'hq'
          ? ['無事', 'ok']
          : b.type === 'fence'
            ? ['通せんぼ中', 'ok']
            : b.type === 'warehouse'
              ? ['保管中', 'ok']
              : fac
                ? used >= facilityCap(b)
                  ? ['満員', 'full']
                  : used
                    ? ['使用中', 'ok']
                    : ['空き', 'idle']
                : b.type === 'market'
                  ? b.running
                    ? ['売却中', 'ok']
                    : ['売る品なし', 'wait']
                  : b.type === 'lab'
                    ? b.running
                      ? ['研究中', 'ok']
                      : ['パック待ち', 'wait']
                    : full
                      ? mixed
                        ? ['出力待ち', 'wait']
                        : ['出力が満杯', 'full']
                      : none.length
                        ? ['材料なし', 'full']
                        : noFuel
                        ? ['燃料切れ', 'wait']
                        : waiting
                        ? ['材料待ち', 'wait']
                        : ['稼働中', 'ok'];
    const chip = info.querySelector('.state')!;
    setText(chip, label);
    chip.className = `state ${cls}`;
    const set = (k: string, v: number, max: number, text = `${v}/${max}`) => {
      const row = info.querySelector(`[data-k="${k}"]`);
      if (!row) return;
      (row.querySelector('.meter i') as HTMLElement).style.width = `${Math.min(100, (v / max) * 100)}%`;
      setText(row.querySelector('b')!, text);
    };
    const cap = bufferCap(b);
    if (fac) set('use', used, facilityCap(b));
    if (b.type === 'hq') {
      const head = s.hand.q[0];
      set('hand', head ? s.hand.t / HAND[head.id].time : 0, 1, head ? `${ITEMS[head.id].name} ×${head.n * HAND[head.id].n}` : 'なし');
    }
    if (b.type === 'lab') set('lab', Object.values(b.input).reduce((a, n) => a + (n ?? 0), 0), cap);
    for (const id of inputsOf(s, b)) set(`in:${id}`, b.input[id] ?? 0, cap);
    if (usesFuel(b)) set('fuel', b.fuel ?? 0, FUEL.burn, `${Math.ceil(b.fuel ?? 0)}秒`);
    // 材料待ちの行: 品の所在と、運ばれない理由（判定は sim 側）
    const status = waiting || (w && empty) ? haulStatus(s, b, inputsOf(s, b).filter((id) => accepts(s, b, id))) : [];
    for (const p of info.querySelectorAll<HTMLElement>('.haul')) {
      const r = status.find((x) => x.item === p.dataset.h);
      p.hidden = !r;
      if (r) setText(p, `${r.where.join(' ・ ')}${r.reason ? `${r.where.length ? ' → ' : ''}${r.reason}` : ''}`);
    }
    if (producer) {
      set('out', b.output, cap);
      const key = b.out ?? '';
      if (key !== outKey) {
        outKey = key;
        info.querySelector('[data-k="out"] .slot-it')!.innerHTML = b.out ? itemImg(b.out) : `<i class="ic">${ICON.box}</i>`;
        setText(info.querySelector('[data-k="out"] .out-name')!, b.out ? ITEMS[b.out].name : '出力');
      }
    }
    const max = maxHp(s, b);
    set('hp', Math.max(0, b.hp), max, `${Math.ceil(Math.max(0, b.hp))}/${Math.round(max)}`);
    const hpBar = info.querySelector<HTMLElement>('[data-k="hp"] .meter i')!;
    const r = b.hp / max;
    hpBar.style.background = r > 0.6 ? '' : r > 0.3 ? 'linear-gradient(#ffd977, #f0a33c)' : 'linear-gradient(#ff9a8a, #e5574a)';
    const rc = repairCost(s, b);
    const repair = info.querySelector<HTMLElement>('.repair')!;
    repair.hidden = !rc;
    repair.classList.toggle('poor', s.coins < rc);
    setText(repair.querySelector('small b')!, fmt(rc));
    updateCrew(b, s);
    updateTier(b, s);
    updateRun(b, s);
    const time = b.type === 'lab' ? 2 : recipeTime(b);
    // 止めている間は作りかけの進みのまま
    const done = b.running || b.off ? b.progress / time : 0;
    if (producer || b.type === 'lab') set('prog', done, 1, `${Math.floor(done * 100)}%`);
    let need: ItemId | null = null;
    if (waiting && producer) {
      const first = recipesOf(s, b)[0];
      need = first ? ((Object.keys(RECIPES[first].in) as ItemId[]).find((it) => (b.input[it] ?? 0) < RECIPES[first].in[it]!) ?? null) : null;
    }
    setText(
      info.querySelector('.hint')!,
      broken
        ? '故障中は動きません。猫も品物を運びません。修理すると元に戻ります'
        : b.off
          ? `止めています。材料は受け取らず、できた品は運び出されます${b.progress > 0 && b.type !== 'lab' ? '（作りかけは動かすと続きから）' : ''}`
          : w
          ? `射程 ${weaponRange(b)}・ダメージ ${Math.round(weaponDamage(s, b))}。${empty ? `${ITEMS[w.ammo!].name}を運んでもらうと撃てます（組立機で作るか、本部の在庫から配られます）` : '射程内で本部に一番近い犬を狙います'}`
          : b.type === 'hq'
            ? `次の襲撃まで ${clock(s.raid.next)}。届け先のない品はここへ運ばれます。確保数を下回る品は優先してここへ運ばれ、超える分は必要な機械へ配られます`
            : full
              ? mixed
                ? `出力の${ITEMS[b.out!].name}を運び出すまで、ほかの品は作れません（出力には 1 種類しか置けません）。${outputStatus(s, b)}`
                : `出力がいっぱい。${outputStatus(s, b)}`
              : none.length
                ? none.map(sourceHint).join('。')
                : noFuel
                ? `燃料切れ。${ITEMS[FUEL.item].name}が届くと動きます（1 個で ${FUEL.burn} 秒）`
                : need
                ? `${ITEMS[need].name}が届くのを待っています`
                : b.type === 'lab' && waiting
                  ? '組立機で作った研究パックが届くのを待っています'
                  : b.type === 'market'
                    ? selling
                      ? `倉庫の「売る」品を 1 秒に ${marketRate(b)} 個売ります（${selling} 種類を指定中）`
                      : '倉庫パネルで「売る」品を指定すると売り始めます'
                    : b.type === 'warehouse'
                      ? `本部の倉庫は各 ${storeCap(s)} 個まで入ります`
                      : b.type === 'charger'
                        ? 'バッテリーが減ったロボ猫が充電に来ます'
                        : fac
                          ? '疲れた猫が 10 マス以内なら歩いて来て休みます'
                          : '',
    );
  }

  // --- リフトの情報カード ---
  let liftSel: { x: number; y: number } | null = null;
  let liftHtml = '';
  function openLift(l: Lift) {
    infoId = catId = null;
    liftSel = { x: l.x, y: l.y };
    liftHtml = '';
    info.innerHTML = `<header>${thumbImg('lift')}<div><h3>リフト</h3><span class="state"></span></div><button class="x" title="閉じる">${ICON.close}</button></header>
      <p class="desc">${DESC.lift}</p><div class="lift-box"></div>`;
    info.querySelector<HTMLButtonElement>('.x')!.onclick = () => h.deselect();
    info.hidden = false;
    replay(info, 'enter');
  }
  function updateLift(s: GameState) {
    if (!liftSel) return;
    const l = s.lifts.find((x) => x.x === liftSel!.x && x.y === liftSel!.y);
    if (!l) return h.deselect();
    const jam = l.items[0]?.p >= 1;
    const chip = info.querySelector('.state')!;
    const [label, cls] = jam ? ['詰まり', 'full'] : l.items.length ? ['運搬中', 'ok'] : ['空', 'idle'];
    setText(chip, label);
    chip.className = `state ${cls}`;
    const fast = has(s, 'fastLift');
    const max = l.tier >= TIER_MAX;
    const one = liftUpgradeCost(l);
    const all = liftLineCost(s, l.x, l.y);
    const html = `<div class="tier-head"><span class="stars">${stars(l.tier)}</span><b>ティア ${l.tier}</b><small>${liftSpeed(l)} タイル/秒・向き ${DIR_NAME[l.d]}・品 ${l.items.length}/${LIFT.hooks}</small></div>
      <p class="hint">${jam ? '先の建物がいっぱいか、受け取れない品です。届け先を空けると流れ出します' : ''}</p>
      <div class="actions"><button class="btn" data-act="turn">${ICON.rotate}<span>向きを回す</span></button></div>
      ${max ? '<p class="note">最大まで強化済み</p>' : fast ? `<button class="btn primary wide" data-act="lift1">${ICON.hammer}<span>ティア ${l.tier + 1} に強化</span><small class="cost">${costHtml(one, s)}</small></button>
        <button class="btn wide" data-act="liftAll">${ICON.hammer}<span>つながったリフトをまとめて強化</span><small class="cost">${costHtml(all, s)}</small></button>` : `<p class="need">${ICON.lock}研究「${RESEARCH.fastLift.name}」で強化（速さ ×2 / ×4）</p>`}
      <button class="btn danger wide" data-act="liftRemove">${ICON.hammer}<span>撤去する（資材は全部戻る）</span></button>`;
    if (html !== liftHtml) info.querySelector('.lift-box')!.innerHTML = liftHtml = html;
  }

  // --- 職人スロットと選択リスト ---
  let pickOpen = false;
  let crewHtml = '';
  let pickHtml = '';
  let tierHtml = '';
  const face = (c: Cat) => thumbImg(`coat:${coatKey(c)}`, 'class="face" alt=""');
  const esc = (t: string) => t.replace(/[<>&"]/g, '');
  const statText = (c: Cat, st: StatId) => `${STATS[st].name} Lv${statLevel(c.stats[st])}（${Math.floor(c.stats[st])}）`;
  const roleText = (c: Cat, s: GameState) => {
    const b = c.job ? s.buildings.find((x) => x.id === c.job) : undefined;
    return b ? `職人: ${BUILDINGS[b.type].name}` : '運び屋';
  };
  function updateCrew(b: Building, s: GameState) {
    const st = WORK_STAT[b.type];
    const box = info.querySelector<HTMLElement>('.crew');
    if (!st || !box) return;
    const crew = craftersOf(s, b);
    const cap = crafterCap(b);
    let total = 1;
    const rows = crew.map((c) => {
      const working = isWorking(c);
      if (working) total *= statBonus(c, b.type);
      const [mood] = catMood(c);
      const good = c.good === st ? `<em class="good">${ICON.sparkle}得意ボーナス ×${GOOD_BONUS}</em>` : '';
      return `<div class="crafter">${face(c)}<div><b>${esc(c.name)}</b><small>${statText(c, st)} ・ ${working ? `×${statBonus(c, b.type).toFixed(2)}` : `${mood}（ボーナス停止中）`}</small>${good}</div><button class="btn off" data-act="unassign" data-cat="${c.id}">はずす</button></div>`;
    });
    const add = crew.length < cap ? `<button class="btn add" data-act="pick">${ICON.cat}<span>${pickOpen ? '閉じる' : '猫を配置'}</span></button>` : '';
    const gun = !!WEAPONS[b.type];
    const html = `<h4>${gun ? '砲手' : '職人'}<small>${crew.length}/${cap} ・ ${STATS[st].name}が効く</small>${total > 1 ? `<b class="boost">${gun ? '連射' : '生産'} ×${(total * tierSpeed(b)).toFixed(2)}</b>` : ''}</h4>${rows.join('')}${add}`;
    if (html !== crewHtml) box.innerHTML = crewHtml = html;
    const pick = info.querySelector<HTMLElement>('.pick')!;
    pick.hidden = !pickOpen || crew.length >= cap;
    if (pick.hidden) return;
    // その建物に効くステータスの高い順。ここの職人は出さない
    const list = s.cats.filter((c) => c.job !== b.id && !c.robot).sort((x, y) => y.stats[st] - x.stats[st]);
    const ph = list.length
      ? list
          .map((c) => `<button class="cand" data-act="assign" data-cat="${c.id}">${face(c)}<span class="nm"><b>${esc(c.name)}</b>${c.good === st ? `<em class="good">${ICON.sparkle}得意</em>` : ''}<small>${roleText(c, s)}</small></span><span class="sv">Lv${statLevel(c.stats[st])}<small>${Math.floor(c.stats[st])}</small></span></button>`)
          .join('')
      : '<p class="note">配置できる猫がいません</p>';
    if (ph !== pickHtml) pick.innerHTML = pickHtml = ph;
  }
  function updateTier(b: Building, s: GameState) {
    const box = info.querySelector<HTMLElement>('.tier-box')!;
    const max = b.tier >= TIER_MAX;
    const err = max ? null : upgradeBlocker(s, b);
    const locked = !max && err?.startsWith('研究');
    const cost = max ? {} : upgradeCost(b);
    const html = `<div class="tier-head"><span class="stars">${stars(b.tier)}</span><b>ティア ${b.tier}</b><small>${tierEffect(b.type, b.tier)}</small></div>${
      max
        ? '<p class="note">最大まで強化済み</p>'
        : `<p class="next">次: ${tierEffect(b.type, b.tier + 1)}</p>${
            locked
              ? `<p class="need">${ICON.lock}研究「${RESEARCH[TIER_RESEARCH[b.tier + 1]].name}」で解放</p>`
              : `<button class="btn primary wide upgrade ${err ? 'poor' : ''}" data-act="upgrade">${ICON.hammer}<span>ティア ${b.tier + 1} に強化</span><small class="cost">${costHtml(cost, s)}</small></button>`
          }`
    }`;
    if (html !== tierHtml) box.innerHTML = tierHtml = html;
  }
  /** 稼働の切り替え: この建物と、同じ設定（種類・レシピ。採掘機は鉱石）の建物をまとめて */
  let runHtml = '';
  /** まとめて切り替える建物の説明（「赤パックを作る組立機」「鉄鉱石の採掘機」「自動の石の炉」） */
  const setupName = (b: Building) => {
    const name = BUILDINGS[b.type].name;
    if (b.type === 'miner') return b.out ? `${ITEMS[b.out].name}の${name}` : name;
    if (!MULTI_RECIPE.includes(b.type)) return name;
    const out = b.recipe && RECIPES[b.recipe].out;
    return out ? `${ITEMS[out].name}を作る${name}` : `自動の${name}`;
  };
  const group = (s: GameState, b: Building) => s.buildings.filter((x) => sameSetup(x, b));
  function updateRun(b: Building, s: GameState) {
    const box = info.querySelector<HTMLElement>('.run-box');
    if (!box) return;
    const all = group(s, b);
    const off = all.filter((x) => x.off).length;
    const html = `<button class="btn wide ${b.off ? 'primary' : ''}" data-act="off">${b.off ? `${ICON.play}<span>動かす</span>` : `${ICON.pause}<span>止める</span>`}</button>${
      all.length > 1
        ? `<p class="note">同じ設定の${setupName(b)}: ${all.length} 棟（停止中 ${off}）</p><div class="actions">${
            off < all.length ? `<button class="btn" data-act="offAll">${ICON.pause}<span>全部止める</span></button>` : ''
          }${off ? `<button class="btn" data-act="onAll">${ICON.play}<span>全部動かす</span></button>` : ''}</div>`
        : ''
    }<p class="note">止めると材料を受け取らず、入っていた材料は倉庫へ戻します。ほかの建物に材料を回したいときに</p>`;
    if (html !== runHtml) box.innerHTML = runHtml = html;
  }
  info.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!t) return;
    const s = state();
    const b = s.buildings.find((x) => x.id === infoId);
    const c = s.cats.find((x) => x.id === Number(t.dataset.cat ?? catId));
    switch (t.dataset.act) {
      case 'pick':
        pickOpen = !pickOpen;
        sfx(pickOpen ? 'open' : 'close');
        break;
      case 'assign':
        if (b && c) {
          pickOpen = false;
          h.assign(c, b);
        }
        break;
      case 'unassign':
        if (c) h.unassign(c);
        break;
      case 'upgrade':
        if (b) h.upgrade(b);
        break;
      case 'repair':
        if (b) h.repair(b);
        break;
      case 'recipe':
        if (b) h.recipe(b, (t.dataset.r || null) as RecipeId | null);
        break;
      case 'off':
        if (b) h.setOff([b.id], !b.off);
        break;
      case 'offAll':
      case 'onAll':
        if (b) h.setOff(group(s, b).map((x) => x.id), t.dataset.act === 'offAll');
        break;
      case 'store':
        h.store();
        break;
      case 'craft':
        h.craft();
        break;
      default: {
        const l = liftSel && s.lifts.find((x) => x.x === liftSel!.x && x.y === liftSel!.y);
        if (!l) break;
        if (t.dataset.act === 'turn') h.liftTurn(l);
        else if (t.dataset.act === 'lift1') h.liftUpgrade(l, false);
        else if (t.dataset.act === 'liftAll') h.liftUpgrade(l, true);
        else if (t.dataset.act === 'liftRemove') h.removeLift(l);
      }
    }
  });

  // --- 猫の情報カード ---
  let catId: number | null = null;
  function openCat(c: Cat) {
    infoId = null;
    liftSel = null;
    catId = c.id;
    const key = coatKey(c);
    info.innerHTML = `<header>${thumbImg(c.robot ? 'robot' : `coat:${key}`)}<div><h3></h3><span class="state"></span></div><button class="x" title="閉じる">${ICON.close}</button></header>
      <p class="desc traits"></p>
      <div class="role"><span class="role-text"></span><button class="btn off" data-act="unassign">はずす</button></div>
      <div class="stocks">
        <div class="row energy"><i class="ic">${c.robot ? ICON.bolt : ICON.speed}</i><span>${c.robot ? 'バッテリー' : '元気'}</span><div class="meter"><i></i></div><b></b></div>
        <div class="row mood"${c.robot ? ' hidden' : ''}><i class="ic">${ICON.heart}</i><span>ごきげん</span><b class="mood-v"></b></div>
        <div class="row carry"><span class="slot-it"></span><span class="carry-text"></span></div>
      </div>
      <div class="stats"${c.robot ? ' hidden' : ''}>${STAT_IDS.map((id) => `<div class="stat${id === c.good ? ' good' : id === c.bad ? ' bad' : ''}" data-s="${id}"><span class="sn">${STATS[id].name}</span><span class="lv"></span><div class="meter"><i></i></div><b></b></div>`).join('')}</div>
      <p class="hint"></p>
      <div class="actions"><button class="btn primary follow">${ICON.follow}<span></span></button><button class="btn wake">${ICON.heart}<span>起こす</span></button></div>`;
    info.querySelector('h3')!.textContent = c.name;
    info.querySelector('.traits')!.textContent = `${c.name} ・ ${traitText(c)}`;
    info.querySelector('header img')!.setAttribute('title', c.robot ? 'ロボ猫' : `${COAT_NAME[key]}の猫`);
    info.querySelector<HTMLButtonElement>('.x')!.onclick = () => h.deselect();
    info.querySelector<HTMLButtonElement>('.follow')!.onclick = () => {
      h.follow(h.following() === catId ? null : catId);
      // 全画面シートのままだと追う様子が見えないので閉じる
      if (sheet.matches && h.following() !== null) h.deselect();
    };
    info.querySelector<HTMLButtonElement>('.wake')!.onclick = () => {
      const cur = state().cats.find((x) => x.id === catId);
      if (cur) h.wake(cur);
    };
    info.hidden = false;
    replay(info, 'enter');
  }
  let carryKey = '';
  function updateCat(s: GameState) {
    if (catId === null) return;
    const c = s.cats.find((x) => x.id === catId);
    if (!c) return h.deselect();
    setText(info.querySelector('h3')!, c.name);
    setText(info.querySelector('.traits')!, `${c.name} ・ ${traitText(c)}`);
    const [label, cls] = catMood(c);
    const chip = info.querySelector('.state')!;
    setText(chip, label);
    chip.className = `state ${cls}`;
    const e = Math.round(c.energy * 100);
    const bar = info.querySelector<HTMLElement>('.energy .meter i')!;
    bar.style.width = `${e}%`;
    bar.style.background = e > 55 ? '' : e > 25 ? 'linear-gradient(#ffd977, #f0a33c)' : 'linear-gradient(#ff9a8a, #e5574a)';
    setText(info.querySelector('.energy b')!, `${e}%`);
    if (!c.robot) {
      const m = moodOf(c);
      const mv = info.querySelector('.mood-v')!;
      setText(mv, MOOD_NAME[m]);
      mv.className = `mood-v ${m}`;
    }
    const key = c.item && c.state === 'toDest' ? `${c.item}:${c.amount}` : '';
    if (key !== carryKey) {
      carryKey = key;
      const row = info.querySelector<HTMLElement>('.carry')!;
      row.hidden = !key;
      if (c.item) {
        row.querySelector('.slot-it')!.innerHTML = itemImg(c.item);
        setText(row.querySelector('.carry-text')!, `${ITEMS[c.item].name} ×${c.amount} を運搬中`);
      }
    }
    setText(
      info.querySelector('.hint')!,
      c.away
        ? isLeaving(c)
          ? '家出しようとしています！ この猫をクリック・タップすると引き止められます'
          : '引き止められて、島へ戻ってきています'
        : c.robot
        ? c.rest === 'charge'
          ? c.restAt && c.path.length ? '充電スタンド（なければ本部）へ向かっています' : '充電しています。満タンになったら仕事に戻ります'
          : c.energy < ROBOT.low + 0.1
            ? 'バッテリーが少なめ。手が空いたら充電に行きます'
            : c.state === 'idle'
              ? '運べる品物ができるのを待っています'
              : ''
        : c.rest && c.restAt && c.path.length
        ? '休憩施設へ歩いています'
        : moodOf(c) === 'low' && !c.rest
          ? 'ごきげんが低め。疲れた猫は家出しやすい（休ませるか、研究「居心地」で減らせます）'
        : c.rest === 'sleep' && c.lazy
          ? '仕事がないので、うたた寝しています'
          : c.rest === 'sleep'
            ? '疲れて眠っています。起こすと元気 60% で仕事に戻ります'
            : c.rest === 'play'
              ? 'ひと休み中。遊ぶと元気が戻ります'
              : c.state === 'idle'
                ? '運べる品物ができるのを待っています'
                : '',
    );
    const followBtn = info.querySelector('.follow span')!;
    setText(followBtn, h.following() === catId ? 'やめる' : '追う');
    info.querySelector<HTMLElement>('.follow')!.classList.toggle('on', h.following() === catId);
    info.querySelector<HTMLElement>('.wake')!.hidden = c.rest !== 'sleep';
    // 役割とステータス（表示は Lv と次の Lv までのバー）
    const job = c.job ? s.buildings.find((x) => x.id === c.job) : undefined;
    const good = job && WORK_STAT[job.type] === c.good ? ` ・ 得意ボーナス ×${GOOD_BONUS}` : '';
    setText(info.querySelector('.role-text')!, c.robot ? `運搬ロボット ・ 速さ ×${ROBOT.speed}・運搬量 +${ROBOT.carry}` : job ? `職人 ・ ${BUILDINGS[job.type].name}（${catMood(c)[0]}）${good}` : '運び屋 ・ 建物の間で品物を運ぶ');
    info.querySelector<HTMLElement>('.role .btn')!.hidden = !job;
    for (const id of STAT_IDS) {
      const row = info.querySelector(`.stat[data-s="${id}"]`)!;
      const v = c.stats[id];
      setText(row.querySelector('.lv')!, `Lv${statLevel(v)}`);
      (row.querySelector('.meter i') as HTMLElement).style.width = `${v >= 100 ? 100 : (v % 10) * 10}%`;
      setText(row.querySelector('b')!, v >= 100 ? 'MAX' : String(Math.floor(v)));
    }
  }

  // --- トースト ---
  const toasts = $('toasts');
  function toast(msg: string, kind: 'info' | 'error' | 'good' | 'raid' = 'info', ms = 2300) {
    const t = el('div', `toast panel ${kind}`, `<i>${kind === 'good' ? ICON.sparkle : kind === 'error' ? '!' : kind === 'raid' ? ICON.dog : ICON.cat}</i><span></span>`);
    t.querySelector('span')!.textContent = msg;
    toasts.prepend(t);
    while (toasts.children.length > 3) toasts.lastElementChild!.remove();
    setTimeout(() => t.classList.add('out'), ms);
    setTimeout(() => t.remove(), ms + 400);
  }

  // --- 襲撃の表示（次の襲撃まで・襲撃中の残り犬数と残り時間・全修理） ---
  const raidBox = $('raid');
  const raidLabel = raidBox.querySelector('small')!;
  const raidValue = raidBox.querySelector('.rt b')!;
  const repairAllBtn = $('repair-all');
  repairAllBtn.onclick = () => h.repairAll();
  function updateRaid(s: GameState) {
    // チュートリアル中も、襲撃が近い・襲撃中・故障があるときは出す
    raidBox.hidden = !tutorialDone(s) && s.raid.next > 180 && !s.raid.cur && !repairAllCost(s);
    const r = s.raid.cur;
    const warn = !r && s.raid.next <= 60;
    const active = !!r && !r.result;
    raidBox.classList.toggle('warn', warn);
    raidBox.classList.toggle('active', active);
    $('raid-band').hidden = !warn && !active;
    $('raid-edge').hidden = !active;
    if (!r) {
      setText(raidLabel, `第 ${s.raid.wave + 1} 波の襲撃まで`);
      setText(raidValue, clock(s.raid.next));
    } else if (!r.result) {
      const left = r.dogs.length + r.boats.reduce((a, b) => a + b.cargo.length, 0);
      setText(raidLabel, `第 ${r.wave} 波の襲撃中`);
      setText(raidValue, r.landed ? `残り ${left} 匹 ・ ${clock(RAID.limit - r.t)}` : `犬 ${left} 匹が接近中`);
    } else {
      setText(raidLabel, r.result === 'clear' ? '撃退した！' : r.result === 'lost' ? '本部がやられた…' : '犬たちが帰っていく');
      setText(raidValue, `次まで ${clock(s.raid.next)}`);
    }
    const cost = repairAllCost(s);
    repairAllBtn.hidden = !cost;
    repairAllBtn.classList.toggle('poor', s.coins < cost);
    setText(repairAllBtn.querySelector('small b')!, fmt(cost));
  }

  // --- 家出の警告（「見る」で追跡。スマホはバーのタップで同じ） ---
  const awayBar = $('away');
  let awayId: number | null = null;
  awayBar.onclick = () => {
    if (awayId === null) return;
    h.follow(awayId);
    if (sheet.matches) h.deselect();
  };
  function updateAway(s: GameState) {
    const c = s.cats.find(isLeaving);
    awayBar.hidden = !c;
    if (!c) {
      awayId = null;
      return;
    }
    if (awayId !== c.id) {
      awayId = c.id;
      awayBar.querySelector('img')!.src = thumbUrl(c.robot ? 'robot' : `coat:${coatKey(c)}`);
      replay(awayBar, 'enter');
    }
    setText(awayBar.querySelector('b')!, c.name);
    awayBar.classList.toggle('on', h.following() === c.id);
  }

  // --- ダイアログ ---
  const dialog = $('dialog');
  function ask(o: { title: string; body: string; ok: string; cancel?: string; danger?: boolean; art?: string }) {
    return new Promise<boolean>((resolve) => {
      const box = dialog.firstElementChild as HTMLElement;
      box.innerHTML = `${o.art ?? thumbImg('coat:brown', 'class="art" alt=""')}<h2>${o.title}</h2><div class="body">${o.body}</div>
        <div class="actions">${o.cancel ? `<button class="btn ghost" data-r="0">${o.cancel}</button>` : ''}<button class="btn ${o.danger ? 'danger' : 'primary'}" data-r="1">${o.ok}</button></div>`;
      dialog.hidden = false;
      replay(box, 'enter');
      sfx('open');
      for (const b of box.querySelectorAll<HTMLButtonElement>('[data-r]'))
        b.onclick = () => {
          dialog.hidden = true;
          resolve(b.dataset.r === '1');
        };
    });
  }

  // --- HUD に吸い込まれるコイン ---
  let flying = 0;
  function flyCoins(x: number, y: number, amount: number) {
    const target = coinPill.querySelector('i')!.getBoundingClientRect();
    const tx = target.left + target.width / 2;
    const ty = target.top + target.height / 2;
    const n = Math.min(5, 1 + Math.floor(Math.log10(amount + 1) * 1.3));
    for (let i = 0; i < n && flying < 40; i++) {
      flying++;
      const c = el('div', 'flycoin', ICON.coin);
      document.body.appendChild(c);
      const mx = x + (tx - x) * 0.25 + (Math.random() - 0.5) * 90;
      const my = Math.min(y, ty) + (y - ty) * 0.15 - 70 - Math.random() * 50;
      const a = c.animate(
        [
          { transform: `translate(${x}px, ${y}px) scale(.3)`, opacity: 0 },
          { transform: `translate(${mx}px, ${my}px) scale(1.1)`, opacity: 1, offset: 0.35 },
          { transform: `translate(${tx}px, ${ty}px) scale(.65)`, opacity: 1 },
        ],
        { duration: 800 + i * 60, delay: i * 70, easing: 'cubic-bezier(.45,0,.7,.2)', fill: 'both' },
      );
      a.onfinish = () => {
        c.remove();
        flying--;
        replay(coinPill, 'bump');
        replay(coinPill.querySelector('i')!, 'spin');
      };
    }
  }

  // --- チュートリアル ---
  const tut = $('tutorial');
  const steps = [...tut.querySelectorAll<HTMLElement>('[data-step]')];
  /** 段階ごとに光らせる建設バーのボタン */
  const GUIDE: Slot[] = ['miner', 'furnace', 'assembler', 'lab'];

  let current: GameState | null = null;
  const state = () => current!;
  let researchReady = -1;
  let catShown = -1;

  return {
    update(s: GameState, mode: Mode, dt: number) {
      current = s;
      coins.update(s.coins, dt);
      rp.update(s.rp, dt);
      setText($('rate'), `+${s.incomeRate < 10 ? s.incomeRate.toFixed(1) : fmt(s.incomeRate)}/秒`);
      const cats = catCount(s);
      const robots = robotCount(s);
      if (cats + robots * 1000 !== catShown) {
        if (catShown >= 0) replay($('cat-pill'), 'bump');
        catShown = cats + robots * 1000;
        setText($('cats'), String(cats));
        setText($('cats-sub'), robots ? `匹+ロボ${robots}` : '匹');
      }
      for (const b of slots) {
        const unlocked = slotUnlocked(s, b.type);
        b.el.classList.toggle('locked', !unlocked);
        const short = Object.keys(missing(s, slotCost(b.type))).length > 0;
        b.el.classList.toggle('poor', unlocked && short);
        b.el.classList.toggle('active', mode === b.type);
        if (unlocked) syncCost(b.cost, slotCost(b.type), s);
      }
      const hc = hireCost(s);
      hire.classList.toggle('poor', s.coins < hc);
      setText(hire.querySelector('.cost b')!, fmt(hc));
      remove.classList.toggle('active', mode === 'remove');
      updateOpts(s, mode);
      const ready = [...(Object.keys(RESEARCH) as (keyof typeof RESEARCH)[]), ...(Object.keys(INFINITE) as InfiniteId[])].filter((id) => !researchBlocker(s, id)).length;
      if (ready !== researchReady) {
        researchReady = ready;
        const badge = $('research-badge');
        for (const b of [badge, $('menu-badge')]) {
          b.hidden = !ready;
          setText(b, String(ready));
        }
        $('research-btn').classList.toggle('glow', ready > 0);
      }
      // ツールチップは開いている間だけ中身を更新する
      if (tipUntil && performance.now() > tipUntil) hideTip();
      if (tipFor) {
        const slot = slots.find((x) => x.el === tipFor);
        if (slot) showTip(tipFor, buildingTip(slot.type, s));
        else if (tipFor === hire) showTip(hire, `<h4>猫を雇う<small>${catCount(s)} 匹</small></h4><p>工場の真ん中に段ボール箱で届く。建物の間で品物を運んでくれる。</p><p class="price ${s.coins < hc ? 'poor' : ''}"><i>${ICON.coin}</i>${fmt(hc)}</p>`);
        else if (tipFor === remove) showTip(remove, `<h4>撤去</h4><p>選んでから建物やリフトをクリックすると撤去する。建物は建設と強化の資材の半分、リフトは全部が倉庫に戻る。</p>`);
      }
      updateInfo(s);
      updateCat(s);
      updateLift(s);
      updateRaid(s);
      updateAway(s);
      // 島を広げる
      const size = gridSize(s);
      const maxed = size >= GRID.max;
      const ec = expandCost(s);
      expandBtn.classList.toggle('poor', !maxed && s.coins < ec);
      expandBtn.classList.toggle('maxed', maxed);
      setText(expandBtn.querySelector('.cost b')!, maxed ? '最大' : fmt(ec));
      if (tipFor === expandBtn)
        showTip(expandBtn, maxed ? `<h4>島を広げる</h4><p>島は最大の ${size}×${size} です。</p>` : `<h4>島を広げる<small>${size}×${size} → ${size + GRID.step}×${size + GRID.step}</small></h4><p>コインを払って島を 1 周広げる。海から新しい土地がせり上がる。</p><p class="price ${s.coins < ec ? 'poor' : ''}"><i>${ICON.coin}</i>${fmt(ec)}</p>`);
      // チュートリアル
      const done = tutorialDone(s);
      tut.hidden = done;
      steps.forEach((li, i) => {
        li.classList.toggle('done', i < s.tut);
        li.classList.toggle('now', i === s.tut);
      });
      for (const sl of slots) sl.el.classList.toggle('guide', !done && sl.type === GUIDE[s.tut] && mode !== sl.type && !s.buildings.some((b) => b.type === sl.type));
    },
    toast,
    ask,
    flyCoins,
    /** 雇うボタンを 8 秒強調する（付いていれば延ばす） */
    nudgeHire() {
      clearTimeout(hireGuide);
      hire.classList.add('guide');
      hireGuide = window.setTimeout(unguideHire, 8000);
    },
    select(t: { building: Building } | { cat: Cat } | { lift: Lift } | null, s: GameState) {
      if (t && 'building' in t) openInfo(t.building, s);
      else if (t && 'lift' in t) openLift(t.lift);
      else if (t) openCat(t.cat);
      else {
        infoId = catId = null;
        liftSel = null;
        info.hidden = true;
      }
    },
    /** 設置するときのレシピ（石の炉・組立機） */
    placeRecipe: (t: BuildingType) => placeRecipes[t] ?? null,
    set liftDir(d: number) {
      liftDir = d;
    },
    syncQuality,
    /** 猫のステータスの Lv UP（カードを開いていれば行を光らせる） */
    levelUp(id: number, stat: StatId) {
      if (catId !== id) return;
      const row = info.querySelector<HTMLElement>(`.stat[data-s="${stat}"]`);
      if (row) replay(row, 'bump');
    },
    /** 設定パネルの最終保存時刻 */
    setSavedAt(t: number) {
      setText($('saved-at'), `最終保存 ${new Date(t).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}`);
    },
    setFxNote(text: string) {
      const n = $('fx-note');
      n.hidden = !text;
      setText(n, text);
    },
    /** 猫のサムネイル画像 */
    get catUrl() {
      return thumbUrl('coat:brown');
    },
  };
}
export type Hud = ReturnType<typeof createHud>;
