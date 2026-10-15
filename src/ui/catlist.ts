import { BUILDINGS, STAT_IDS, STATS, WEAPONS, WORK_STAT, type StatId } from '../sim/data';
import { catCount, isLeaving, MOOD_NAME, moodOf, crafterCap, craftersOf, hireCost, robotCount, statBonus, statLevel, stock, TIER_MAX, traitText, type Building, type Cat, type GameState } from '../sim/state';
import type { GameAudio } from './audio';
import { coatKey, fmt, replay, thumbImg } from './hud';
import { ICON } from './icons';

type Sort = 'name' | 'role' | 'energy' | StatId;
type Filter = 'all' | 'carrier' | 'crafter' | 'rest' | 'robot';
const SORTS: [Sort, string][] = [['name', '名前'], ['role', '役割'], ['energy', '元気'], ...STAT_IDS.map((id) => [id, STATS[id].name] as [Sort, string])];
const FILTERS: [Filter, string][] = [['all', '全部'], ['carrier', '運び屋'], ['crafter', '職人'], ['rest', '休憩中'], ['robot', 'ロボット']];
const PREF_KEY = 'nekoFactory.catList';

/** 一覧の役割の表示（文字・色・並べ替えの順位） */
function roleOf(c: Cat, byId: Map<number, Building>): [string, string, number] {
  if (c.away) return isLeaving(c) ? ['家出しようとしている！', 'full', -1] : ['帰ってくる', 'ok', -1];
  if (c.robot) return c.rest === 'charge' ? ['充電中', 'wait', 5] : c.state === 'idle' ? ['ロボ・待機', 'idle', 5] : ['ロボ・運搬中', 'carry', 5];
  const fac = c.rest && c.restAt ? byId.get(c.restAt) : undefined;
  if (fac) return [`休憩中: ${BUILDINGS[fac.type].name}`, 'wait', 2];
  if (c.rest === 'sleep') return ['寝ている', 'sleep', 3];
  if (c.rest === 'play') return ['遊んでいる', 'wait', 4];
  const job = c.job ? byId.get(c.job) : undefined;
  if (job) return [`${WEAPONS[job.type] ? '砲手' : '職人'}: ${BUILDINGS[job.type].name}`, 'ok', 0];
  return ['運び屋', 'carry', 1];
}

interface Row {
  el: HTMLElement;
  name: HTMLButtonElement;
  role: HTMLElement;
  trait: HTMLElement;
  energy: HTMLElement;
  energyText: HTMLElement;
  mood: HTMLElement;
  stats: Record<StatId, { lv: HTMLElement; bar: HTMLElement }>;
  unassign: HTMLElement;
  wake: HTMLElement;
  pick: HTMLElement;
  pickHtml: string;
  key: string;
}

const setText = (e: Element, t: string) => {
  if (e.textContent !== t) e.textContent = t;
};

/** 猫の一覧。PC は右側のパネル、狭い画面は全画面シート。開いている間は 2 Hz で更新する */
export function createCatList(o: {
  audio: GameAudio;
  follow(id: number): void;
  assign(c: Cat, b: Building): void;
  unassign(c: Cat): void;
  wake(c: Cat): void;
  hire(): void;
  launch(): void;
  rename(c: Cat, name: string): void;
}) {
  let sort: Sort = 'name';
  let filter: Filter = 'all';
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}');
    if (SORTS.some(([k]) => k === p.sort)) sort = p.sort;
    if (FILTERS.some(([k]) => k === p.filter)) filter = p.filter;
  } catch {
    /* 壊れた設定は既定値 */
  }
  const savePref = () => localStorage.setItem(PREF_KEY, JSON.stringify({ sort, filter }));

  const panel = document.createElement('aside');
  panel.id = 'cat-list';
  panel.className = 'panel';
  panel.hidden = true;
  panel.innerHTML = `<header><h2>${ICON.cat}猫の一覧</h2><small class="cl-count"></small><button class="x" title="閉じる">${ICON.close}</button></header>
    <div class="cl-ctrl">
      <div class="seg cl-filter">${FILTERS.map(([k, t]) => `<button data-f="${k}">${t}</button>`).join('')}</div>
      <label class="cl-sort"><span>並べ替え</span><select>${SORTS.map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label>
    </div>
    <div class="cl-rows"><p class="note cl-empty" hidden>この条件の猫はいません</p><div class="cl-gone" hidden><h4>いなくなった猫</h4><p></p></div></div>
    <footer><button class="btn primary cl-hire">${thumbImg('coat:brown', 'class="face" alt=""')}<span>猫を雇う</span><small><i>${ICON.coin}</i><b></b></small></button><button class="btn cl-launch">${ICON.robot}<span>ロボ猫を起動</span><small><b></b></small></button></footer>`;
  document.body.appendChild(panel);
  const list = panel.querySelector<HTMLElement>('.cl-rows')!;
  const empty = list.querySelector<HTMLElement>('.cl-empty')!;
  const gone = list.querySelector<HTMLElement>('.cl-gone')!;
  const count = panel.querySelector<HTMLElement>('.cl-count')!;
  const select = panel.querySelector('select')!;
  const hireBtn = panel.querySelector<HTMLButtonElement>('.cl-hire')!;
  const launchBtn = panel.querySelector<HTMLButtonElement>('.cl-launch')!;
  launchBtn.onclick = () => o.launch();
  select.value = sort;
  const syncFilter = () => {
    for (const b of panel.querySelectorAll<HTMLButtonElement>('[data-f]')) b.classList.toggle('on', b.dataset.f === filter);
  };
  syncFilter();
  panel.querySelector<HTMLButtonElement>('.x')!.onclick = () => close();
  select.onchange = () => {
    sort = select.value as Sort;
    savePref();
    dirty = true;
  };
  for (const b of panel.querySelectorAll<HTMLButtonElement>('[data-f]'))
    b.onclick = () => {
      filter = b.dataset.f as Filter;
      savePref();
      syncFilter();
      dirty = true;
    };
  hireBtn.onclick = () => o.hire();

  const rows = new Map<number, Row>();
  let state: GameState | null = null;
  let pickFor: number | null = null;
  let editing: number | null = null;
  /** 雇った猫（次の描画でハイライトして先頭までスクロールする） */
  let hired: number | null = null;
  let dirty = true;
  let lastAt = 0;

  function makeRow(c: Cat): Row {
    const el = document.createElement('div');
    el.className = 'cl-row';
    el.dataset.id = String(c.id);
    el.classList.toggle('robot', c.robot);
    el.innerHTML = `${thumbImg(c.robot ? 'robot' : `coat:${coatKey(c)}`, 'class="face" alt=""')}
      <div class="cl-main">
        <div class="cl-top"><button class="cl-name" data-act="rename" title="タップで名前を変える"></button><span class="state cl-role"></span></div>
        <small class="cl-trait"></small>
        <div class="cl-energy"><i class="ic">${c.robot ? ICON.bolt : ICON.speed}</i><div class="meter"><i></i></div><b></b>${c.robot ? '' : '<span class="cl-mood" title="ごきげん（低いと家出しやすい）"></span>'}</div>
      </div>
      <div class="cl-stats"${c.robot ? ' hidden' : ''}>${STAT_IDS.map((id) => `<span class="cl-st${id === c.good ? ' good' : id === c.bad ? ' bad' : ''}" data-s="${id}"><em>${STATS[id].name}</em><b></b><span class="meter"><i></i></span></span>`).join('')}</div>
      <div class="cl-acts"><button class="btn primary" data-act="look">${ICON.follow}<span>見る</span></button>${c.robot ? '' : `<button class="btn" data-act="pick">${ICON.cat}<span>配置</span></button>`}<button class="btn off" data-act="unassign">はずす</button><button class="btn wake" data-act="wake">${ICON.heart}<span>起こす</span></button></div>
      <div class="cl-pick" hidden></div>`;
    const stats = {} as Row['stats'];
    for (const id of STAT_IDS) {
      const s = el.querySelector(`[data-s="${id}"]`)!;
      stats[id] = { lv: s.querySelector('b')!, bar: s.querySelector('.meter i')! };
    }
    return {
      el,
      name: el.querySelector('.cl-name')!,
      role: el.querySelector('.cl-role')!,
      trait: el.querySelector('.cl-trait')!,
      energy: el.querySelector('.cl-energy .meter i')!,
      energyText: el.querySelector('.cl-energy b')!,
      mood: el.querySelector('.cl-mood') ?? el,
      stats,
      unassign: el.querySelector('[data-act="unassign"]')!,
      wake: el.querySelector('[data-act="wake"]')!,
      pick: el.querySelector('.cl-pick')!,
      pickHtml: '',
      key: '',
    };
  }

  function updateRow(r: Row, c: Cat, s: GameState, role: [string, string, number]) {
    if (editing !== c.id) setText(r.name, c.name);
    setText(r.trait, traitText(c));
    setText(r.role, role[0]);
    r.role.className = `state cl-role ${role[1]}`;
    const e = Math.round(c.energy * 100);
    r.energy.style.width = `${e}%`;
    r.energy.style.background = e > 55 ? '' : e > 25 ? 'linear-gradient(#ffd977, #f0a33c)' : 'linear-gradient(#ff9a8a, #e5574a)';
    setText(r.energyText, `${e}%`);
    if (!c.robot) {
      const m = moodOf(c);
      setText(r.mood, `ごきげん ${MOOD_NAME[m]}`);
      r.mood.className = `cl-mood mood-v ${m}`;
    }
    r.el.classList.toggle('leaving', isLeaving(c));
    for (const id of STAT_IDS) {
      const v = c.stats[id];
      setText(r.stats[id].lv, `Lv${statLevel(v)}`);
      r.stats[id].bar.style.width = `${v >= 100 ? 100 : (v % 10) * 10}%`;
    }
    r.unassign.hidden = !c.job;
    r.wake.hidden = c.rest !== 'sleep';
    r.el.classList.toggle('picking', pickFor === c.id);
    r.pick.hidden = pickFor !== c.id;
    if (r.pick.hidden) return;
    // 空きのある生産建物を、この猫のステータスが効く順に
    const cands = s.buildings.filter((b) => WORK_STAT[b.type] && b.id !== c.job && craftersOf(s, b).length < crafterCap(b)).sort((a, b) => statBonus(c, b.type) - statBonus(c, a.type) || a.id - b.id);
    const html = cands.length
      ? cands
          .map((b) => {
            const st = WORK_STAT[b.type]!;
            return `<button class="cand" data-act="assign" data-b="${b.id}">${thumbImg(`building:${b.type}`, 'class="face" alt=""')}<span class="nm"><b>${BUILDINGS[b.type].name}</b><span class="stars">${'★'.repeat(b.tier)}${'☆'.repeat(TIER_MAX - b.tier)}</span>${c.good === st ? `<em class="good">${ICON.sparkle}得意</em>` : ''}<small>${STATS[st].name} Lv${statLevel(c.stats[st])} ・ 空き ${crafterCap(b) - craftersOf(s, b).length}</small></span><span class="sv">×${statBonus(c, b.type).toFixed(2)}<small>${WEAPONS[b.type] ? '連射' : '生産'}</small></span></button>`;
          })
          .join('')
      : '<p class="note">空きのある生産建物がありません</p>';
    if (html !== r.pickHtml) r.pick.innerHTML = r.pickHtml = html;
  }

  function render(s: GameState) {
    const byId = new Map(s.buildings.map((b) => [b.id, b]));
    const roles = new Map(s.cats.map((c) => [c.id, roleOf(c, byId)]));
    const shown = s.cats.filter((c) => (filter === 'all' ? true : filter === 'robot' ? c.robot : filter === 'carrier' ? !c.job && !c.robot : filter === 'crafter' ? !!c.job : !!c.rest && !c.robot));
    const cmp: Record<Sort, (a: Cat, b: Cat) => number> = {
      name: (a, b) => a.name.localeCompare(b.name, 'ja'),
      role: (a, b) => roles.get(a.id)![2] - roles.get(b.id)![2] || roles.get(a.id)![0].localeCompare(roles.get(b.id)![0], 'ja'),
      energy: (a, b) => b.energy - a.energy,
      ...(Object.fromEntries(STAT_IDS.map((id) => [id, (a: Cat, b: Cat) => b.stats[id] - a.stats[id]])) as Record<StatId, (a: Cat, b: Cat) => number>),
    };
    shown.sort((a, b) => cmp[sort](a, b) || a.id - b.id);

    const alive = new Set(s.cats.map((c) => c.id));
    for (const [id, r] of rows)
      if (!alive.has(id)) {
        r.el.remove();
        rows.delete(id);
      }
    const visible = new Set(shown.map((c) => c.id));
    for (const c of s.cats) {
      let r = rows.get(c.id);
      if (!r) rows.set(c.id, (r = makeRow(c)));
      r.el.hidden = !visible.has(c.id);
      if (!r.el.hidden) updateRow(r, c, s, roles.get(c.id)!);
    }
    // 並びが変わったときだけ入れ替える（改名中は入力が外れないよう動かさない）
    const order = shown.map((c) => rows.get(c.id)!.el);
    const cur = [...list.querySelectorAll<HTMLElement>(':scope > .cl-row:not([hidden])')];
    if (editing === null && (order.length !== cur.length || order.some((e, i) => e !== cur[i]))) list.append(...order);
    for (const r of rows.values()) if (!r.el.isConnected) list.append(r.el);
    empty.hidden = shown.length > 0;
    // 家出して島を去った猫（名前だけ、新しい順に 3 件）
    gone.hidden = !s.runaway.gone.length;
    setText(gone.querySelector('p')!, s.runaway.gone.join('、'));
    if (list.lastElementChild !== gone) list.append(gone);

    const cats = catCount(s);
    const crafters = s.cats.filter((c) => c.job).length;
    const robots = robotCount(s);
    setText(count, `${cats} 匹 ・ 運び屋 ${cats - crafters} ・ 職人 ${crafters}${robots ? ` ・ ロボ ${robots}` : ''}`);
    const hc = hireCost(s);
    hireBtn.classList.toggle('poor', s.coins < hc);
    setText(hireBtn.querySelector('small b')!, fmt(hc));
    const stockRobots = stock(s, 'robot');
    launchBtn.hidden = !stockRobots && !robots;
    launchBtn.classList.toggle('poor', !stockRobots);
    setText(launchBtn.querySelector('small b')!, `在庫 ${stockRobots}`);

    if (hired !== null) {
      const r = rows.get(hired);
      if (r) {
        hired = null;
        list.scrollTo({ top: r.el.offsetTop - 6, behavior: 'smooth' });
        replay(r.el, 'new');
      }
    }
  }

  function startRename(c: Cat, r: Row) {
    editing = c.id;
    const input = document.createElement('input');
    input.className = 'cl-input';
    input.value = c.name;
    input.maxLength = 8;
    input.enterKeyHint = 'done';
    r.name.hidden = true;
    r.name.after(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      editing = null;
      const name = input.value.trim();
      input.remove();
      r.name.hidden = false;
      const cur = state?.cats.find((x) => x.id === c.id);
      if (commit && cur && name !== cur.name) o.rename(cur, input.value);
      dirty = true;
    };
    input.addEventListener('keydown', (e) => {
      // Esc は一覧を閉じずに改名だけやめる。変換中の Enter は確定にしない
      e.stopPropagation();
      if (e.key === 'Enter' && !e.isComposing) finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }

  list.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    const rowEl = t?.closest<HTMLElement>('.cl-row');
    if (!t || !rowEl || !state) return;
    const c = state.cats.find((x) => x.id === Number(rowEl.dataset.id));
    const r = c && rows.get(c.id);
    if (!c || !r) return;
    switch (t.dataset.act) {
      case 'rename':
        startRename(c, r);
        break;
      case 'look':
        o.follow(c.id);
        close();
        return;
      case 'pick':
        pickFor = pickFor === c.id ? null : c.id;
        o.audio.play(pickFor === null ? 'close' : 'open');
        break;
      case 'assign': {
        const b = state.buildings.find((x) => x.id === Number(t.dataset.b));
        pickFor = null;
        if (b) o.assign(c, b);
        break;
      }
      case 'unassign':
        o.unassign(c);
        break;
      case 'wake':
        o.wake(c);
        break;
    }
    dirty = true;
  });

  function open() {
    panel.hidden = false;
    dirty = true;
    replay(panel, 'enter');
    o.audio.play('open');
  }
  function close() {
    if (panel.hidden) return;
    (document.activeElement as HTMLElement | null)?.blur();
    panel.hidden = true;
    pickFor = null;
    o.audio.play('close');
  }

  return {
    toggle() {
      if (panel.hidden) open();
      else close();
    },
    close,
    update(s: GameState) {
      state = s;
      if (panel.hidden) return;
      const now = performance.now();
      if (!dirty && now - lastAt < 500) return;
      dirty = false;
      lastAt = now;
      render(s);
    },
    /** 雇った猫の行をハイライトする（絞り込みで隠れるなら全部に戻す） */
    hired(id: number) {
      if (panel.hidden) return;
      hired = id;
      const c = state?.cats.find((x) => x.id === id);
      if (filter !== 'all' && !(filter === 'carrier' && !c?.robot) && !(filter === 'robot' && c?.robot)) {
        filter = 'all';
        savePref();
        syncFilter();
      }
      dirty = true;
    },
  };
}
