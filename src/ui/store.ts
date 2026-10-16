import { HAND, HAND_IDS, HAND_QUEUE, ITEM_CATS, ITEM_IDS, ITEMS, type HandId, type ItemCat, type ItemId } from '../sim/data';
import { buildingCount, handBlocker, isBroken, keepOf, stock, storeCap, type GameState } from '../sim/state';
import type { GameAudio } from './audio';
import { costHtml, fmt, itemImg, replay, syncCost } from './hud';
import { ICON } from './icons';

const setText = (e: Element, t: string) => {
  if (e.textContent !== t) e.textContent = t;
};

/** 確保数の入力（本部に残す数。下回っている間は建物の出力をまず本部へ運ぶ） */
const resHtml = `<span class="st-res" title="本部に残す数。これを下回っていれば、建物の出力はまず本部へ運ばれ、超えた分を必要な機械へ配ります"><small>確保</small><input type="number" min="0" step="10" inputmode="numeric" value="10"></span>`;

/** 手作業の候補の行（材料・個数・秒と、まとめて足すボタン） */
const ADD = [1, 5, 10];
const handRow = (id: HandId) => {
  const r = HAND[id];
  const ore = ITEMS[id].cat === 'ore';
  return `<div class="hd-row" data-h="${id}">${itemImg(id)}<div class="hd-main"><b>${ore ? '手掘り' : '手作り'}: ${ITEMS[id].name}${r.n > 1 ? ` ×${r.n}` : ''}</b><span class="hd-in">${ore ? '<small>鉱床から</small>' : costHtml(r.in)}<small class="hd-t">${ICON.clock}${r.time}秒</small></span><small class="hd-why"></small></div><div class="hd-add">${ADD.map((n) => `<button class="btn" data-n="${n}">${n === 1 ? '+1' : `×${n}`}</button>`).join('')}</div></div>`;
};

/** 倉庫パネル: 在庫タブ（本部の在庫と容量を分類ごとに並べ、各行に確保数と「売る」トグルと残す量。ロボ猫は起動ボタン）と手作業タブ */
export function createStorePanel(o: {
  audio: GameAudio;
  setSell(item: ItemId, on: boolean, keep: number): void;
  setKeep(item: ItemId, n: number): void;
  launch(): void;
  queueHand(id: HandId, n: number): void;
  cancelHand(i: number): void;
}) {
  const panel = document.createElement('aside');
  panel.id = 'store';
  panel.className = 'panel';
  panel.hidden = true;
  const cats = Object.keys(ITEM_CATS) as ItemCat[];
  panel.innerHTML = `<header><h2>${ICON.box}倉庫</h2><small class="st-cap"></small><button class="x" title="閉じる">${ICON.close}</button></header>
    <div class="seg st-tabs"><button data-tab="stock" class="on">在庫</button><button data-tab="hand">手作業<em class="hd-badge" hidden></em></button></div>
    <div class="hd-box" hidden>
      <p class="note">本部の猫たちが素材から少しずつ作ります（キュー ${HAND_QUEUE} 件まで、1 個ずつ）。材料は追加したときに倉庫から使い、取り消すと戻ります</p>
      <div class="hd-now"><span class="slot-it"></span><div class="hd-main"><b class="hd-name"></b><div class="meter"><i></i></div></div><small class="hd-left"></small></div>
      <div class="hd-q"></div>
      <div class="hd-rows">${HAND_IDS.map(handRow).join('')}</div>
    </div>
    <p class="note st-note"></p>
    <div class="st-rows">${cats
      .map(
        (c) => `<h3>${ITEM_CATS[c]}</h3>${ITEM_IDS.filter((id) => ITEMS[id].cat === c)
          .map(
            (id) => `<div class="st-row" data-id="${id}">${itemImg(id)}<div class="st-main"><b>${ITEMS[id].name}</b><div class="meter"><i></i></div></div><span class="st-n"></span>${
              id === 'robot'
                ? `<button class="btn primary st-launch">${ICON.robot}<span>起動</span></button>`
                : ITEMS[id].value
                  ? `<div class="st-sell">${resHtml}<button class="toggle-s" title="市場で売る"><b>売る</b></button><span class="st-keep"><input type="number" min="0" step="10" inputmode="numeric" value="0" title="この数より多い分だけ売る"><small>個残す</small></span></div><small class="st-price"><i>${ICON.coin}</i>${ITEMS[id].value}</small>`
                  : `<div class="st-sell">${resHtml}<small class="st-nosell">${ITEMS[id].rp ? `${ITEMS[id].rp} RP` : '売れない'}</small></div>`
            }</div>`,
          )
          .join('')}`,
      )
      .join('')}</div>`;
  document.body.appendChild(panel);
  const cap = panel.querySelector('.st-cap')!;
  const note = panel.querySelector('.st-note')!;
  let state: GameState | null = null;
  const rows = new Map<ItemId, { el: HTMLElement; bar: HTMLElement; n: HTMLElement; toggle: HTMLElement | null; input: HTMLInputElement | null; res: HTMLInputElement | null }>();
  for (const el of panel.querySelectorAll<HTMLElement>('.st-row')) {
    const id = el.dataset.id as ItemId;
    const toggle = el.querySelector<HTMLElement>('.toggle-s');
    const input = el.querySelector<HTMLInputElement>('.st-keep input');
    const res = el.querySelector<HTMLInputElement>('.st-res input');
    rows.set(id, { el, bar: el.querySelector('.meter i')!, n: el.querySelector('.st-n')!, toggle, input, res });
    if (res) {
      res.onchange = () => {
        const n = Math.max(0, Math.floor(Number(res.value) || 0));
        res.value = String(n);
        o.setKeep(id, n);
      };
      res.addEventListener('keydown', (e) => e.stopPropagation());
    }
    if (toggle && input) {
      toggle.onclick = (e) => {
        e.preventDefault();
        const on = state?.sell[id] === undefined;
        o.setSell(id, on, Number(input.value) || 0);
        o.audio.play(on ? 'select' : 'close');
      };
      input.onchange = () => {
        const keep = Math.max(0, Math.floor(Number(input.value) || 0));
        input.value = String(keep);
        o.setSell(id, true, keep);
      };
      // 入力中はゲームのキー操作（WASD など）に渡さない
      input.addEventListener('keydown', (e) => e.stopPropagation());
    }
  }
  panel.querySelector<HTMLButtonElement>('.st-launch')!.onclick = () => o.launch();
  // --- 手作業タブ ---
  let tab: 'stock' | 'hand' = 'stock';
  const handBox = panel.querySelector<HTMLElement>('.hd-box')!;
  const tabs = [...panel.querySelectorAll<HTMLButtonElement>('[data-tab]')];
  function setTab(t: 'stock' | 'hand') {
    tab = t;
    for (const b of tabs) b.classList.toggle('on', b.dataset.tab === t);
    handBox.hidden = t !== 'hand';
    for (const e of panel.querySelectorAll<HTMLElement>('.st-note, .st-rows')) e.hidden = t !== 'stock';
    if (state) render(state);
  }
  for (const b of tabs)
    b.onclick = () => {
      setTab(b.dataset.tab as 'stock' | 'hand');
      o.audio.play('select');
    };
  handBox.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const add = t.closest<HTMLElement>('[data-n]');
    const row = t.closest<HTMLElement>('[data-h]');
    if (add && row) o.queueHand(row.dataset.h as HandId, Number(add.dataset.n));
    const del = t.closest<HTMLElement>('[data-del]');
    if (del) o.cancelHand(Number(del.dataset.del));
  });
  const nowRow = handBox.querySelector<HTMLElement>('.hd-now')!;
  const qBox = handBox.querySelector<HTMLElement>('.hd-q')!;
  let qHtml = '';
  let nowKey = '';
  function renderHand(s: GameState) {
    const q = s.hand.q;
    const head = q[0];
    const hq = s.buildings.find((b) => b.type === 'hq');
    const r = head && HAND[head.id];
    const full = !!r && s.hand.t >= r.time && storeCap(s) - stock(s, head.id) < r.n;
    const key = head?.id ?? '';
    if (key !== nowKey) {
      nowKey = key;
      nowRow.querySelector('.slot-it')!.innerHTML = head ? itemImg(head.id) : `<i class="ic">${ICON.box}</i>`;
    }
    nowRow.classList.toggle('idle', !head);
    setText(nowRow.querySelector('.hd-name')!, head ? `${ITEMS[head.id].name}を${ITEMS[head.id].cat === 'ore' ? '掘っています' : '作っています'}（残り ${head.n} 回）` : '手作業はありません');
    (nowRow.querySelector('.meter i') as HTMLElement).style.width = `${r ? Math.min(100, (s.hand.t / r.time) * 100) : 0}%`;
    setText(nowRow.querySelector('.hd-left')!, !head ? '' : hq && isBroken(hq) ? '本部が故障中で止まっています' : full ? '倉庫がいっぱいで入りません' : `あと ${Math.ceil(r!.time - s.hand.t)} 秒`);
    const html = q.length
      ? `<h3>キュー<small>${q.length}/${HAND_QUEUE} 件</small></h3>${q.map((e, i) => `<div class="hd-qi${i ? '' : ' cur'}">${itemImg(e.id)}<span>${ITEMS[e.id].name} ×${e.n * HAND[e.id].n}</span><button class="btn icon" data-del="${i}" title="取り消す（材料は戻る）">${ICON.close}</button></div>`).join('')}`
      : '';
    if (html !== qHtml) qBox.innerHTML = qHtml = html;
    for (const row of handBox.querySelectorAll<HTMLElement>('.hd-row')) {
      const id = row.dataset.h as HandId;
      const lock = handBlocker(s, id);
      // 研究で解放する品（弾丸）は解放されるまで出さない
      const u = HAND[id].unlock;
      row.hidden = !!u && !s.researched.includes(u);
      row.classList.toggle('off', !!lock);
      setText(row.querySelector('.hd-why')!, lock && !lock.startsWith('資材') ? lock : '');
      const box = row.querySelector('.hd-in');
      if (box && Object.keys(HAND[id].in).length) syncCost(box, HAND[id].in, s);
      for (const b of row.querySelectorAll<HTMLButtonElement>('[data-n]')) b.disabled = !!handBlocker(s, id, Number(b.dataset.n));
    }
  }
  panel.querySelector<HTMLButtonElement>('.x')!.onclick = () => close();
  let lastAt = 0;

  function render(s: GameState) {
    const badge = panel.querySelector<HTMLElement>('.hd-badge')!;
    badge.hidden = !s.hand.q.length;
    setText(badge, String(s.hand.q.length));
    if (tab === 'hand') return renderHand(s);
    const c = storeCap(s);
    const wh = buildingCount(s, 'warehouse');
    setText(cap, `容量 各 ${fmt(c)}${wh ? `（倉庫 ${wh} 棟）` : ''}`);
    const markets = buildingCount(s, 'market');
    setText(note, `「確保」は本部に残す数。これを下回っていれば、建物の出力はまず本部へ運ばれ、超えた分を必要な機械へ配ります。${markets ? `市場 ${markets} 棟が「売る」品を残す量より多い分から売ります` : '市場がないので、「売る」にしても売れません。市場を建てましょう'}`);
    for (const [id, r] of rows) {
      const n = stock(s, id);
      r.bar.style.width = `${Math.min(100, (n / c) * 100)}%`;
      r.el.classList.toggle('full', n >= c);
      r.el.classList.toggle('empty', n <= 0);
      setText(r.n, `${fmt(n)}/${fmt(c)}`);
      if (r.res && document.activeElement !== r.res && Number(r.res.value) !== keepOf(s, id)) r.res.value = String(keepOf(s, id));
      if (r.toggle && r.input) {
        const keep = s.sell[id];
        r.toggle.classList.toggle('on', keep !== undefined);
        r.el.classList.toggle('selling', keep !== undefined);
        if (keep !== undefined && document.activeElement !== r.input && Number(r.input.value) !== keep) r.input.value = String(keep);
      }
    }
    panel.querySelector<HTMLButtonElement>('.st-launch')!.disabled = stock(s, 'robot') < 1;
  }
  function open() {
    panel.hidden = false;
    replay(panel, 'enter');
    o.audio.play('open');
    if (state) render(state);
  }
  function close() {
    if (panel.hidden) return;
    (document.activeElement as HTMLElement | null)?.blur();
    panel.hidden = true;
    o.audio.play('close');
  }
  return {
    toggle() {
      if (panel.hidden) open();
      else close();
    },
    /** 手作業タブを開く（開いていればタブだけ切り替える） */
    openHand() {
      setTab('hand');
      if (panel.hidden) open();
    },
    close,
    update(s: GameState) {
      state = s;
      if (panel.hidden) return;
      const now = performance.now();
      if (now - lastAt < 300) return;
      lastAt = now;
      render(s);
    },
  };
}
