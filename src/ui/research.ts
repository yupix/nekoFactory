import { INFINITE, RESEARCH, type InfiniteId, type ResearchId } from '../sim/data';
import { infiniteCost, isInfinite, level, researchBlocker, type GameState } from '../sim/state';
import type { GameAudio } from './audio';
import { fmt, replay, thumbImg } from './hud';
import { ICON } from './icons';

type Id = ResearchId | InfiniteId;
/** 系列ごとの行。列は前提の深さ（無限研究は右端） */
const ROWS: { label: string; ids: (Id | null)[] }[] = [
  { label: '新しい品物', ids: ['pack', 'yarn', 'luxury', null] },
  { label: '交渉', ids: [null, 'tradeInf', null, null] },
  { label: '招き猫', ids: [null, 'maneki', null, null] },
  { label: '速足', ids: ['speed1', 'speed2', 'speed3', 'speedInf'] },
  { label: '大荷物', ids: ['cargo1', 'cargo2', null, 'cargoInf'] },
  { label: '効率', ids: ['eff1', 'eff2', 'eff3', 'effInf'] },
  { label: 'やる気', ids: ['motiv1', 'motiv2', 'motiv3', 'motivInf'] },
  { label: '休憩', ids: [null, 'tower', null, null] },
  { label: '増築', ids: [null, 'tier2', 'tier3', null] },
  { label: '猫の群れ', ids: ['herd1', 'herd2', null, null] },
];
const reqOf = (id: Id) => (isInfinite(id) ? INFINITE[id].req : RESEARCH[id].req);

/** 研究ツリー。前提を線でつなぎ、買えないものは理由を出す。無限研究はレベルと次のコストを出す */
export function createResearchPanel(o: { buy(id: Id): void; audio: GameAudio }) {
  const ICONS: Record<Id, string> = {
    pack: thumbImg('building:packer'),
    yarn: thumbImg('building:yarnMill'),
    luxury: thumbImg('building:workshop'),
    maneki: ICON.maneki,
    speed1: ICON.speed,
    speed2: ICON.speed,
    speed3: ICON.speed,
    speedInf: ICON.speed,
    cargo1: ICON.cargo,
    cargo2: ICON.cargo,
    cargoInf: ICON.cargo,
    eff1: ICON.eff,
    eff2: ICON.eff,
    eff3: ICON.eff,
    effInf: ICON.eff,
    herd1: thumbImg('coat:brown'),
    herd2: thumbImg('coat:brown'),
    motiv1: ICON.motiv,
    motiv2: ICON.motiv,
    motiv3: ICON.motiv,
    motivInf: ICON.motiv,
    tradeInf: ICON.trade,
    tower: thumbImg('building:tower'),
    tier2: ICON.hammer,
    tier3: ICON.hammer,
  };

  const wrap = document.createElement('div');
  wrap.id = 'research-wrap';
  wrap.hidden = true;
  wrap.innerHTML = `<section id="research" class="panel">
      <header><h2>${ICON.flask}研究</h2><div class="pill rp"><i>${ICON.rp}</i><b></b><small>RP</small></div><button class="x" title="閉じる">${ICON.close}</button></header>
      <p class="lead">研究所に品物を届けると RP がたまる。RP を使って工場を強くしよう。</p>
      <div class="tree"><svg class="lines"></svg></div>
    </section>`;
  document.body.appendChild(wrap);
  const panel = wrap.querySelector<HTMLElement>('#research')!;
  const tree = wrap.querySelector<HTMLElement>('.tree')!;
  const svg = wrap.querySelector<SVGSVGElement>('svg.lines')!;
  const balance = wrap.querySelector('header b')!;
  wrap.querySelector<HTMLButtonElement>('.x')!.onclick = () => close();
  wrap.addEventListener('pointerdown', (e) => e.target === wrap && close());

  const cards = new Map<Id, { el: HTMLElement; btn: HTMLButtonElement; reason: HTMLElement; cost: HTMLElement; lv: HTMLElement | null }>();
  ROWS.forEach((row, r) => {
    const label = document.createElement('div');
    label.className = 'label';
    label.style.gridRow = String(r + 1);
    label.textContent = row.label;
    tree.appendChild(label);
    row.ids.forEach((id, c) => {
      if (!id) return;
      const inf = isInfinite(id);
      const def = inf ? INFINITE[id] : RESEARCH[id];
      const el = document.createElement('div');
      el.className = `node${inf ? ' inf' : ''}`;
      el.style.gridRow = String(r + 1);
      el.style.gridColumn = String(c + 2);
      el.innerHTML = `<i class="ico">${ICONS[id]}${inf ? '<span class="inf-mark">∞</span>' : ''}</i><div class="txt"><b>${def.name}${inf ? '<span class="lv"></span>' : ''}</b><small>${def.desc}</small></div>
        <button class="buy"><i>${ICON.rp}</i><span></span></button><em></em><span class="done-mark">${ICON.check}</span>`;
      const btn = el.querySelector<HTMLButtonElement>('.buy')!;
      btn.onclick = () => o.buy(id);
      tree.appendChild(el);
      cards.set(id, { el, btn, reason: el.querySelector('em')!, cost: btn.querySelector('span')!, lv: el.querySelector('.lv') });
    });
  });

  const lines = new Map<Id, SVGPathElement>();
  function layout() {
    svg.innerHTML = '';
    lines.clear();
    // offset 系は CSS の transform（開くアニメーション）の影響を受けない
    svg.setAttribute('viewBox', `0 0 ${tree.offsetWidth} ${tree.offsetHeight}`);
    for (const [id, c] of cards) {
      const req = reqOf(id);
      if (!req) continue;
      const a = cards.get(req)!.el;
      const b = c.el;
      const x1 = a.offsetLeft + a.offsetWidth;
      const y1 = a.offsetTop + a.offsetHeight / 2;
      const x2 = b.offsetLeft;
      const y2 = b.offsetTop + b.offsetHeight / 2;
      const mx = (x1 + x2) / 2;
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`);
      svg.appendChild(p);
      lines.set(id, p);
    }
  }
  window.addEventListener('resize', () => !wrap.hidden && layout());

  function open() {
    wrap.hidden = false;
    replay(panel, 'enter');
    layout();
    o.audio.play('open');
  }
  function close() {
    if (wrap.hidden) return;
    wrap.hidden = true;
    o.audio.play('close');
  }

  return {
    toggle() {
      if (wrap.hidden) open();
      else close();
    },
    close,
    get open() {
      return !wrap.hidden;
    },
    update(s: GameState) {
      if (wrap.hidden) return;
      if (balance.textContent !== fmt(s.rp)) balance.textContent = fmt(s.rp);
      for (const [id, c] of cards) {
        const blocker = researchBlocker(s, id);
        const inf = isInfinite(id);
        const done = !inf && s.researched.includes(id);
        const req = reqOf(id);
        const reqDone = !req || s.researched.includes(req);
        c.el.classList.toggle('done', done);
        c.el.classList.toggle('ready', !blocker);
        c.el.classList.toggle('locked', !!blocker && !done && !reqDone);
        c.el.classList.toggle('poor', blocker === 'RP 不足');
        c.btn.disabled = !!blocker;
        const cost = fmt(inf ? infiniteCost(s, id) : RESEARCH[id].rp);
        if (c.cost.textContent !== cost) c.cost.textContent = cost;
        if (c.lv) {
          const lv = `Lv.${level(s, id as InfiniteId)}`;
          if (c.lv.textContent !== lv) c.lv.textContent = lv;
        }
        const text = done ? '' : (blocker ?? '');
        if (c.reason.textContent !== text) c.reason.textContent = text;
        const line = lines.get(id);
        if (line) line.setAttribute('class', done || (inf && level(s, id as InfiniteId) > 0) ? 'done' : reqDone ? 'open' : '');
      }
    },
    /** 購入直後の解放演出 */
    celebrate(id: Id) {
      const c = cards.get(id);
      if (!c) return;
      replay(c.el, 'just');
      const r = c.el.getBoundingClientRect();
      const colors = ['#ffd257', '#ff8fb3', '#7fe0d2', '#b79af0', '#ffffff', '#8fd06a'];
      for (let i = 0; i < 22; i++) {
        const p = document.createElement('i');
        p.className = 'confetti';
        const a = (i / 22) * Math.PI * 2;
        p.style.left = `${r.left + r.width / 2}px`;
        p.style.top = `${r.top + r.height / 2}px`;
        p.style.background = colors[i % colors.length];
        p.style.setProperty('--dx', `${Math.cos(a) * (70 + Math.random() * 70)}px`);
        p.style.setProperty('--dy', `${Math.sin(a) * (50 + Math.random() * 60) - 40}px`);
        p.style.setProperty('--r', `${Math.random() * 720 - 360}deg`);
        document.body.appendChild(p);
        setTimeout(() => p.remove(), 1100);
      }
      for (const [cid, line] of lines) if (reqOf(cid) === id || cid === id) replay(line as unknown as HTMLElement, 'flow');
    },
  };
}
