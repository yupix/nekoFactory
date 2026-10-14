import type { Quality, QualityInfo } from '../render/scene';
import type { CoatKey, ThumbKey } from '../render/thumbs';
import { BUILDINGS, FACILITY, GOOD_BONUS, GRID, INFINITE, ITEMS, RESEARCH, STAT_IDS, STATS, WORK_STAT, type BuildingType, type InfiniteId, type ItemId, type StatId } from '../sim/data';
import { bufferCap, buildingCost, buildingCount, crafterCap, craftersOf, expandCost, facilityCap, facilityUsers, gridSize, hireCost, isUnlocked, isWorking, productionSpeed, refundOf, researchBlocker, statBonus, statLevel, TIER_MAX, TIER_RESEARCH, tierSpeed, traitText, upgradeBlocker, upgradeCost, type Building, type Cat, type GameState } from '../sim/state';
import { hasInputs } from '../sim/tick';
import type { Bus, GameAudio } from './audio';
import { ICON } from './icons';

export type Mode = BuildingType | 'remove' | null;

const COAT_COLOR: Record<CoatKey, number> = { white: 0xf3ece2, black: 0x3b3433, brown: 0xd98f4e, gray: 0x9b9ca3, calico: 0xe6b27a, saba: 0x8c9088 };
const thumbs = new Map<ThumbKey, string>();
/** サムネイルの URL。できるまでは色付きのプレースホルダ */
export function thumbUrl(key: ThumbKey) {
  const url = thumbs.get(key);
  if (url) return url;
  const [kind, id] = key.split(':');
  const c = kind === 'building' ? BUILDINGS[id as BuildingType].color : kind === 'item' ? ITEMS[id as ItemId].color : COAT_COLOR[id as CoatKey];
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" rx="3" fill="#${c.toString(16).padStart(6, '0')}" opacity=".6"/></svg>`)}`;
}
/** サムネイルの img タグ（できたら setThumb で差し替わる） */
export const thumbImg = (key: ThumbKey, attrs = 'alt=""') => `<img data-thumb="${key}" src="${thumbUrl(key)}" ${attrs}>`;
/** できたサムネイルを登録し、表示中の img も差し替える */
export function setThumb(key: ThumbKey, url: string) {
  thumbs.set(key, url);
  for (const img of document.querySelectorAll<HTMLImageElement>(`img[data-thumb="${key}"]`)) img.src = url;
}

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

/** ホバーできない端末（タッチ）。ツールチップ・ホバー音は使わず、タップで情報を出す */
const hoverless = matchMedia('(hover: none)');
/** 狭い画面と横持ち: 上部 HUD を 1 行にし、研究・サウンド・島の拡張はメニューから（style.css と同じ条件） */
const compact = matchMedia('(max-width: 640px), (max-height: 500px)');
/** 横持ち: 建設バーは右端の縦並び */
const side = matchMedia('(max-height: 500px)');
/** 縦持ちの狭い画面: 情報カードは全画面シート */
const sheet = matchMedia('(max-width: 640px)');

const TYPES = Object.keys(BUILDINGS) as BuildingType[];
/** 建設バーは生産の建物と休憩施設を別グループにする */
const WORKS = TYPES.filter((t) => !FACILITY[t]);
const RESTS = TYPES.filter((t) => FACILITY[t]);
export const DESC: Record<BuildingType, string> = {
  fishing: '池で魚を釣り上げる。材料はいらない。',
  cannery: '魚をことこと煮て猫缶にする。',
  packer: '猫缶をかわいいギフト箱に詰める。',
  yarnMill: '風車の力で毛糸を紡ぐ。材料はいらない。',
  knitter: '毛糸からふわふわのマフラーを編む。',
  workshop: 'ギフト箱とマフラーで高級ギフトを仕立てる。',
  market: '届いた品物を売ってコインに換える。',
  lab: '品物を 1 秒に 1 個調べて研究点（RP）にする。',
  bed: '疲れた猫がふかふかのベッドでぐっすり眠る。6 秒で元気いっぱい。',
  toybox: 'ボールを転がして遊ぶ。4 秒で元気 +60%。',
  tower: '段を登って、上で眠るか爪とぎ。5 秒で元気 +80%。',
};

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
  select(m: Mode): void;
  hire(): void;
  research(): void;
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
  quality: { get(): QualityInfo; set(q: 'auto' | Quality): void };
}

const COAT_NAME: Record<CoatKey, string> = { white: '白', black: '黒', brown: '茶トラ', gray: 'グレー', calico: '三毛', saba: 'サバトラ' };
export const coatKey = (c: Pick<Cat, 'id' | 'color'>): CoatKey => (c.color === 'gray' && c.id % 2 ? 'saba' : c.color);

/** ティアの効果の説明 */
function tierEffect(type: BuildingType, tier: number) {
  const fac = FACILITY[type];
  const k = tier - 1;
  if (fac) return `定員 ${fac.cap + k}・回復 ×${1 + 0.25 * k}`;
  if (type === 'market') return `売値 ×${(1 + 0.1 * k).toFixed(1)}`;
  const cap = `上限 ${10 + 5 * k}`;
  const crew = tier >= 3 ? '・職人 2 匹' : '';
  if (type === 'lab') return `RP ×${1 + 0.25 * k}・${cap}${crew}`;
  return `生産速度 ×${1.5 ** k}・${cap}${crew}`;
}
const stars = (tier: number) => '★'.repeat(tier) + '☆'.repeat(TIER_MAX - tier);

/** 猫の今の様子（ラベルと色） */
export function catMood(c: Cat): [string, string] {
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
  const itemImg = (id: ItemId) => thumbImg(`item:${id}`, `class="it" alt="${ITEMS[id].name}" title="${ITEMS[id].name}"`);
  const sfx = h.audio.play;

  document.body.insertAdjacentHTML(
    'beforeend',
    `<header id="hud" class="ui">
      <div class="brand panel">${thumbImg('coat:brown')}<b>ねこ工場</b></div>
      <div class="res panel">
        <div class="pill coin" id="coin-pill"><i>${ICON.coin}</i><b id="coins">0</b><small id="rate"></small></div>
        <div class="pill rp" id="rp-pill"><i>${ICON.rp}</i><b id="rp">0</b><small>RP</small></div>
        <div class="pill cats" id="cat-pill"><i>${ICON.cat}</i><b id="cats">0</b><small>匹</small></div>
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
      <div id="menu-main" class="menu-main"></div>
      <h4>設定</h4>
      <div class="quality"><span>${ICON.sparkle}画質<small id="q-now"></small></span><div class="seg">${(['auto', 2, 1, 0] as const).map((q) => `<button data-q="${q}">${{ auto: '自動', 2: '高', 1: '中', 0: '低' }[q]}</button>`).join('')}</div></div>
      <p id="fx-note" class="note" hidden></p>
      <div class="save-row"><button id="export-btn" class="btn">エクスポート</button><button id="import-btn" class="btn">インポート</button></div>
      <input id="import-file" type="file" accept=".json,application/json" hidden>
      <p id="saved-at" class="note">まだ保存していません</p>
      <button id="reset-btn" class="btn danger wide">最初からやり直す</button>
    </div>
    <nav id="bar" class="ui panel"></nav>
    <div id="tip" class="tip panel" hidden></div>
    <aside id="info" class="card panel" hidden></aside>
    <div id="toasts"></div>
    <div id="dialog" hidden><div class="dialog panel"></div></div>
    <div id="tutorial" class="card panel ui" hidden>
      <div class="tut-head">${thumbImg('coat:brown')}<b>ねこ工場へようこそ！</b></div>
      <ol>
        <li data-step="fish"><i><b>1</b>${ICON.check}</i><span>下のバーから<b>釣り場</b>を選んで、地面に置こう</span></li>
        <li data-step="market"><i><b>2</b>${ICON.check}</i><span><b>市場</b>を置くと、猫が魚を運んでコインに換えてくれる</span></li>
      </ol>
      <p class="keys touch"><span>1 本指で移動</span><span>2 本指でズーム・回転</span><span>同じ場所を 2 回タップで設置</span><span>長押しで撤去</span></p>
      <p class="keys mouse"><span><kbd>ドラッグ</kbd><kbd>WASD</kbd>移動</span><span><kbd>ホイール</kbd>ズーム</span><span><kbd>Q</kbd><kbd>E</kbd><kbd>右ドラッグ</kbd>回転</span><span><kbd>右クリック</kbd><kbd>Esc</kbd>解除</span></p>
    </div>`,
  );
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const coinPill = $('coin-pill');
  const coins = new Counter($('coins'), coinPill, 0);
  const rp = new Counter($('rp'), $('rp-pill'), 0);
  let catCount = -1;

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
  const slotFor = (type: BuildingType) => {
    const b = el('button', `slot${FACILITY[type] ? ' rest' : ''}`, `${thumbImg(`building:${type}`)}<span class="name">${BUILDINGS[type].name}</span><span class="cost"><i>${ICON.coin}</i><b></b></span><span class="lock">${ICON.lock}</span>`);
    b.onclick = () => isUnlocked(state(), type) && h.select(type);
    bar.appendChild(b);
    return { type, el: b, cost: b.querySelector('.cost b')! };
  };
  const slots = WORKS.map(slotFor);
  bar.appendChild(el('span', 'sep'));
  slots.push(...RESTS.map(slotFor));
  bar.appendChild(el('span', 'sep'));
  const hire = el('button', 'slot hire', `${thumbImg('coat:brown')}<span class="name">猫を雇う</span><span class="cost"><i>${ICON.coin}</i><b></b></span>`);
  hire.onclick = h.hire;
  const remove = el('button', 'slot remove', `<i class="big">${ICON.hammer}</i><span class="name">撤去</span><span class="cost sub">50% 返金</span>`);
  remove.onclick = () => h.select('remove');
  bar.append(hire, remove);

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
    tip.style.top = anchor === expandBtn ? `${r.bottom + 12}px` : `${r.top - th - 12}px`;
  };
  const hideTip = () => {
    tipFor = null;
    tipUntil = 0;
    tip.hidden = true;
  };
  for (const s of [...slots.map((x) => x.el), hire, remove, expandBtn]) {
    s.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && !hoverless.matches && (tipFor = s));
    s.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && hideTip());
    s.addEventListener('click', () => {
      if (!hoverless.matches || s === expandBtn) return;
      tipFor = s;
      tipUntil = performance.now() + 3000;
    });
  }

  function recipe(t: BuildingType, s: GameState) {
    const def = BUILDINGS[t];
    const fac = FACILITY[t];
    if (fac)
      return `<div class="recipe"><i class="ic">${ICON.heart}</i><span>${fac.kinds.map((k) => (k === 'sleep' ? 'お昼寝' : 'あそび')).join('・')}</span><span class="time">定員 ${fac.cap}・${fac.time}秒</span></div>`;
    const time = def.time ? `<span class="time">${ICON.clock}${(def.time / productionSpeed(s)).toFixed(1)}秒</span>` : '';
    if (t === 'market') return `<div class="recipe"><span class="any">品物</span>${ICON.arrow}<i class="ic">${ICON.coin}</i><span>価値ぶんのコイン</span></div>`;
    if (t === 'lab') return `<div class="recipe"><span class="any">品物</span>${ICON.arrow}<i class="ic">${ICON.rp}</i><span>価値÷5 RP</span>${time}</div>`;
    const ins = (Object.keys(def.inputs) as ItemId[]).map((id) => `${itemImg(id)}<b>×${def.inputs[id]}</b>`).join('<span class="plus">+</span>');
    return `<div class="recipe">${ins || '<span class="any">材料なし</span>'}${ICON.arrow}${itemImg(def.output!)}${time}</div>`;
  }
  function buildingTip(t: BuildingType, s: GameState) {
    const def = BUILDINGS[t];
    const n = buildingCount(s, t);
    const cost = buildingCost(s, t);
    const lock = !isUnlocked(s, t) ? `<p class="need">${ICON.lock}研究「${RESEARCH[def.unlock!].name}」で解放</p>` : '';
    return `<h4>${def.name}${n ? `<small>${n} 棟</small>` : ''}</h4><p>${DESC[t]}</p>${recipe(t, s)}${lock || `<p class="price ${s.coins < cost ? 'poor' : ''}"><i>${ICON.coin}</i>${fmt(cost)}</p>`}`;
  }

  // --- 情報カード ---
  const info = $('info');
  let infoId: number | null = null;
  function openInfo(b: Building, s: GameState) {
    infoId = b.id;
    catId = null;
    const def = BUILDINGS[b.type];
    const rows: string[] = [];
    if (b.type === 'lab') rows.push(`<div class="row" data-k="lab"><span class="any">品物</span><div class="meter"><i></i></div><b></b></div>`);
    for (const id of Object.keys(def.inputs) as ItemId[]) rows.push(`<div class="row" data-k="in:${id}">${itemImg(id)}<span>${ITEMS[id].name}</span><div class="meter"><i></i></div><b></b></div>`);
    if (def.output) rows.push(`<div class="row out" data-k="out">${itemImg(def.output)}<span>${ITEMS[def.output].name}</span><div class="meter"><i></i></div><b></b></div>`);
    if (def.time) rows.push(`<div class="row prog" data-k="prog"><i class="ic">${ICON.clock}</i><span>${b.type === 'lab' ? '研究' : '生産'}</span><div class="meter"><i></i></div><b></b></div>`);
    if (FACILITY[b.type]) rows.push(`<div class="row" data-k="use"><i class="ic">${ICON.cat}</i><span>使用中</span><div class="meter"><i></i></div><b></b></div>`);
    pickOpen = false;
    crewHtml = pickHtml = tierHtml = '';
    info.innerHTML = `<header>${thumbImg(`building:${b.type}`)}<div><h3>${def.name}</h3><span class="state"></span></div><button class="x" title="閉じる">${ICON.close}</button></header>
      <p class="desc">${DESC[b.type]}</p>${recipe(b.type, s)}
      <div class="stocks">${rows.join('')}</div>
      ${WORK_STAT[b.type] ? '<div class="crew"></div><div class="pick" hidden></div>' : ''}
      <div class="tier-box"></div>
      <p class="hint"></p>
      <button class="btn danger wide remove">${ICON.hammer}<span>撤去する</span><small></small></button>`;
    info.querySelector<HTMLButtonElement>('.x')!.onclick = () => h.deselect();
    info.querySelector<HTMLButtonElement>('.remove')!.onclick = () => {
      const cur = state().buildings.find((x) => x.id === infoId);
      if (cur) h.remove(cur);
    };
    info.hidden = false;
    replay(info, 'enter');
  }
  function updateInfo(s: GameState) {
    if (infoId === null) return;
    const b = s.buildings.find((x) => x.id === infoId);
    if (!b) return h.deselect();
    const def = BUILDINGS[b.type];
    const full = !!def.output && !b.running && b.output >= bufferCap(b);
    const waiting = !!def.time && !b.running && !full && !hasInputs(b);
    const fac = FACILITY[b.type];
    const used = fac ? facilityUsers(s, b) : 0;
    const [label, cls] = fac
      ? used >= facilityCap(b)
        ? ['満員', 'full']
        : used
          ? ['使用中', 'ok']
          : ['空き', 'idle']
      : b.type === 'market'
        ? ['営業中', 'ok']
        : b.type === 'lab'
          ? b.running
            ? ['研究中', 'ok']
            : ['品物待ち', 'wait']
          : full
            ? ['出力が満杯', 'full']
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
    if (b.type === 'lab') set('lab', Object.values(b.input).reduce((a, n) => a + (n ?? 0), 0), cap);
    for (const id of Object.keys(def.inputs) as ItemId[]) set(`in:${id}`, b.input[id] ?? 0, cap);
    if (def.output) set('out', b.output, cap);
    updateCrew(b, s);
    updateTier(b, s);
    if (def.time) set('prog', b.running ? b.progress / def.time : 0, 1, `${Math.floor((b.running ? b.progress / def.time : 0) * 100)}%`);
    const need = waiting ? (Object.keys(def.inputs) as ItemId[]).find((it) => (b.input[it] ?? 0) < def.inputs[it]!) : null;
    setText(
      info.querySelector('.hint')!,
      full
        ? '品物がいっぱい。猫を雇うと運び出せます'
        : need
          ? `${ITEMS[need].name}が届くのを待っています`
          : b.type === 'market'
            ? '猫が運んできた品物をその場でコインに換えます'
            : fac
              ? '疲れた猫が 10 マス以内なら歩いて来て休みます'
              : '',
    );
    setText(info.querySelector('.remove small')!, `+${fmt(refundOf(s, b))}`);
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
    const html = `<h4>職人<small>${crew.length}/${cap} ・ ${STATS[st].name}が効く</small>${total > 1 ? `<b class="boost">生産 ×${(total * tierSpeed(b)).toFixed(2)}</b>` : ''}</h4>${rows.join('')}${add}`;
    if (html !== crewHtml) box.innerHTML = crewHtml = html;
    const pick = info.querySelector<HTMLElement>('.pick')!;
    pick.hidden = !pickOpen || crew.length >= cap;
    if (pick.hidden) return;
    // その建物に効くステータスの高い順。ここの職人は出さない
    const list = s.cats.filter((c) => c.job !== b.id).sort((x, y) => y.stats[st] - x.stats[st]);
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
    const cost = max ? 0 : upgradeCost(b);
    const html = `<div class="tier-head"><span class="stars">${stars(b.tier)}</span><b>ティア ${b.tier}</b><small>${tierEffect(b.type, b.tier)}</small></div>${
      max
        ? '<p class="note">最大まで強化済み</p>'
        : `<p class="next">次: ${tierEffect(b.type, b.tier + 1)}</p>${
            locked
              ? `<p class="need">${ICON.lock}研究「${RESEARCH[TIER_RESEARCH[b.tier + 1]].name}」で解放</p>`
              : `<button class="btn primary wide upgrade ${err ? 'poor' : ''}" data-act="upgrade">${ICON.hammer}<span>ティア ${b.tier + 1} に強化</span><small><i>${ICON.coin}</i>${fmt(cost)}</small></button>`
          }`
    }`;
    if (html !== tierHtml) box.innerHTML = tierHtml = html;
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
    }
  });

  // --- 猫の情報カード ---
  let catId: number | null = null;
  function openCat(c: Cat) {
    infoId = null;
    catId = c.id;
    const key = coatKey(c);
    info.innerHTML = `<header>${thumbImg(`coat:${key}`)}<div><h3></h3><span class="state"></span></div><button class="x" title="閉じる">${ICON.close}</button></header>
      <p class="desc traits"></p>
      <div class="role"><span class="role-text"></span><button class="btn off" data-act="unassign">はずす</button></div>
      <div class="stocks">
        <div class="row energy"><i class="ic">${ICON.speed}</i><span>元気</span><div class="meter"><i></i></div><b></b></div>
        <div class="row carry"><span class="slot-it"></span><span class="carry-text"></span></div>
      </div>
      <div class="stats">${STAT_IDS.map((id) => `<div class="stat${id === c.good ? ' good' : id === c.bad ? ' bad' : ''}" data-s="${id}"><span class="sn">${STATS[id].name}</span><span class="lv"></span><div class="meter"><i></i></div><b></b></div>`).join('')}</div>
      <p class="hint"></p>
      <div class="actions"><button class="btn primary follow">${ICON.follow}<span></span></button><button class="btn wake">${ICON.heart}<span>起こす</span></button></div>`;
    info.querySelector('h3')!.textContent = c.name;
    info.querySelector('.traits')!.textContent = `${c.name} ・ ${traitText(c)}`;
    info.querySelector('header img')!.setAttribute('title', `${COAT_NAME[key]}の猫`);
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
    const [label, cls] = catMood(c);
    const chip = info.querySelector('.state')!;
    setText(chip, label);
    chip.className = `state ${cls}`;
    const e = Math.round(c.energy * 100);
    const bar = info.querySelector<HTMLElement>('.energy .meter i')!;
    bar.style.width = `${e}%`;
    bar.style.background = e > 55 ? '' : e > 25 ? 'linear-gradient(#ffd977, #f0a33c)' : 'linear-gradient(#ff9a8a, #e5574a)';
    setText(info.querySelector('.energy b')!, `${e}%`);
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
      c.rest && c.restAt && c.path.length
        ? '休憩施設へ歩いています'
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
    setText(info.querySelector('.role-text')!, job ? `職人 ・ ${BUILDINGS[job.type].name}（${catMood(c)[0]}）${good}` : '運び屋 ・ 建物の間で品物を運ぶ');
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
  function toast(msg: string, kind: 'info' | 'error' | 'good' = 'info') {
    const t = el('div', `toast panel ${kind}`, `<i>${kind === 'good' ? ICON.sparkle : kind === 'error' ? '!' : ICON.cat}</i><span></span>`);
    t.querySelector('span')!.textContent = msg;
    toasts.prepend(t);
    while (toasts.children.length > 3) toasts.lastElementChild!.remove();
    setTimeout(() => t.classList.add('out'), 2300);
    setTimeout(() => t.remove(), 2700);
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
  const stepFish = tut.querySelector('[data-step="fish"]')!;
  const stepMarket = tut.querySelector('[data-step="market"]')!;

  let current: GameState | null = null;
  const state = () => current!;
  let researchReady = -1;

  return {
    update(s: GameState, mode: Mode, dt: number) {
      current = s;
      coins.update(s.coins, dt);
      rp.update(s.rp, dt);
      setText($('rate'), `+${s.incomeRate < 10 ? s.incomeRate.toFixed(1) : fmt(s.incomeRate)}/秒`);
      if (s.cats.length !== catCount) {
        if (catCount >= 0) replay($('cat-pill'), 'bump');
        catCount = s.cats.length;
        setText($('cats'), String(catCount));
      }
      for (const b of slots) {
        const cost = buildingCost(s, b.type);
        const unlocked = isUnlocked(s, b.type);
        b.el.classList.toggle('locked', !unlocked);
        b.el.classList.toggle('poor', unlocked && s.coins < cost);
        b.el.classList.toggle('active', mode === b.type);
        setText(b.cost, fmt(cost));
      }
      const hc = hireCost(s);
      hire.classList.toggle('poor', s.coins < hc);
      setText(hire.querySelector('.cost b')!, fmt(hc));
      remove.classList.toggle('active', mode === 'remove');
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
        else if (tipFor === hire) showTip(hire, `<h4>猫を雇う<small>${s.cats.length} 匹</small></h4><p>工場の真ん中に段ボール箱で届く。建物の間で品物を運んでくれる。</p><p class="price ${s.coins < hc ? 'poor' : ''}"><i>${ICON.coin}</i>${fmt(hc)}</p>`);
        else if (tipFor === remove) showTip(remove, `<h4>撤去</h4><p>選んでから建物をクリックすると撤去する。最後に買った値段の半分が戻る。</p>`);
      }
      updateInfo(s);
      updateCat(s);
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
      tut.hidden = s.tutorialDone;
      if (!s.tutorialDone) {
        const hasFish = s.buildings.some((b) => b.type === 'fishing');
        stepFish.classList.toggle('done', hasFish);
        stepMarket.classList.toggle('now', hasFish);
        stepFish.classList.toggle('now', !hasFish);
        slots[0].el.classList.toggle('guide', !hasFish && mode !== 'fishing');
        slots[TYPES.indexOf('market')].el.classList.toggle('guide', hasFish && mode !== 'market');
      } else for (const sl of slots) sl.el.classList.remove('guide');
    },
    toast,
    ask,
    flyCoins,
    select(t: { building: Building } | { cat: Cat } | null, s: GameState) {
      if (t && 'building' in t) openInfo(t.building, s);
      else if (t) openCat(t.cat);
      else {
        infoId = catId = null;
        info.hidden = true;
      }
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
