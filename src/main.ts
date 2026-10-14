import { createEntities, type UiState } from './render/entities';
import { createScene } from './render/scene';
import { BUILDINGS, INFINITE, RESEARCH, STATS, type BuildingType, type ItemId } from './sim/data';
import { clearSave, importSave, loadGame, saveGame, serialize } from './sim/save';
import { assignCat, buildingAt, buildingCost, buyResearch, carrierCount, expandIsland, gridSize, hireCat, isInfinite, isUnlocked, level, placeBuilding, refundOf, removeBuilding, traitText, unassignCat, upgradeBuilding, wakeCat, type Building, type Cat, type GameState } from './sim/state';
import type { GameEvent } from './sim/tick';
import type { Action, FromWorker, ToWorker } from './simWorker';
import type { Sfx } from './ui/audio';
import { createFloaters } from './ui/float';
import { createHud, fmt, setThumb, type Mode } from './ui/hud';
import { ICON } from './ui/icons';
import { createResearchPanel } from './ui/research';

performance.mark('boot:main');
// 最初の描画に要らないものは並行して取りに行く（CSS も描画を止めないよう JS から読む）
const cssReady = import('./style.css');
const audioReady = import('./ui/audio');

/** 起動の段階: ローディング画面を更新し、1 フレーム譲ってから進む。所要時間は performance.measure に残す */
let stageName = '';
async function stage(name: string, pct: number) {
  if (stageName) performance.measure(stageName, `boot:${stageName}`);
  stageName = name;
  document.getElementById('boot-stage')!.textContent = name;
  document.getElementById('boot-bar')!.style.width = `${pct}%`;
  // タブが hidden だと rAF が来ないので時間でも進める
  await new Promise<void>((r) => {
    requestAnimationFrame(() => setTimeout(r));
    setTimeout(r, 100);
  });
  performance.mark(`boot:${name}`);
}

const STEP = 0.1;

await stage('セーブを読み込んでいます', 5);
const loaded = loadGame();
let state: GameState = loaded.state;
let mode: Mode = null;
let sel: { kind: 'building' | 'cat'; id: number } | null = null;
let followId: number | null = null;
/** タッチ: 1 回目のタップで選んだタイル（ゴーストを出し、同じタイルの 2 回目で確定） */
let tapped: { mode: Mode; x: number; y: number } | null = null;
let resetting = false;

await stage('画面を準備しています', 20);
document.body.classList.add('intro');
const view = createScene(document.getElementById('app')!);

await stage('島を作っています', 40);
view.setSize(gridSize(state));

await stage('猫を集めています', 60);
const ents = createEntities(view.scene, (o) => view.noAO(o), (s) => audio.play(s));
const spawnFloat = createFloaters();

await stage('色を塗っています', 75);
await view.postReady;
await view.renderer.compileAsync(view.scene, view.camera);

await stage('音を用意しています', 90);
const audio = (await audioReady).createAudio();

await stage('工場を開いています', 95);
await cssReady;

/** 手元の状態で即座に検証・反映し（応答を待たない）、同じ操作を Worker に送る */
function act(action: Action, run: (s: GameState) => string | null, ok?: Sfx) {
  const err = run(state);
  if (err) {
    hud.toast(err, 'error');
    audio.play('error');
    return false;
  }
  send({ kind: 'act', seq: ++sent, action });
  if (ok) audio.play(ok);
  return true;
}

function onEvent(e: GameEvent, s: GameState) {
  if (e.kind === 'lvup') {
    const pos = ents.catPosition(e.cat!);
    const p = pos ? view.project(pos.x, pos.y + 0.5, pos.z) : view.project(e.x + 0.5, 0.5, e.y + 0.5);
    spawnFloat(`Lv UP! ${STATS[e.stat!].name} Lv${e.amount}`, p.x, p.y, 'lv');
    ents.levelUp(e.cat!);
    hud.levelUp(e.cat!, e.stat!);
    audio.play('meow');
    return;
  }
  ents.event(s, e);
  const p = view.project(e.x + 0.5, 1.05, e.y + 0.5);
  spawnFloat(`+${fmt(e.amount)}`, p.x, p.y, e.kind);
  if (e.kind === 'coin') {
    hud.flyCoins(p.x, p.y, e.amount);
    audio.play('coin');
  } else audio.play('rp');
}

function select(b: Building | null) {
  sel = b ? { kind: 'building', id: b.id } : null;
  hud.select(b ? { building: b } : null, state);
  view.select(b ? { x: b.x, y: b.y } : null);
}
function selectCat(c: Cat) {
  sel = { kind: 'cat', id: c.id };
  hud.select({ cat: c }, state);
  view.select(null);
}
function follow(id: number | null) {
  followId = id;
  view.follow(id === null ? null : () => ents.catPosition(id));
}
view.onFollowEnd = () => (followId = null);
/** 寝ている猫を撫でて起こす */
function wake(c: Cat) {
  if (act({ kind: 'wake', id: c.id }, (s) => wakeCat(s, c.id), 'pet')) ents.petCat(c.id, performance.now() / 1000);
}

function removeAt(b: Building) {
  const before = state.coins;
  if (!act({ kind: 'remove', x: b.x, y: b.y }, (s) => removeBuilding(s, b.x, b.y), 'remove')) return;
  if (sel?.kind === 'building' && sel.id === b.id) select(null);
  const p = view.project(b.x + 0.5, 0.4, b.y + 0.5);
  hud.flyCoins(p.x, p.y, state.coins - before);
}

const panel = createResearchPanel({
  audio,
  buy(id) {
    if (!act({ kind: 'research', id }, (s) => buyResearch(s, id), 'research')) return;
    saveSoon();
    panel.celebrate(id);
    if (isInfinite(id)) hud.toast(`研究完了！ ${INFINITE[id].name} Lv.${level(state, id)}: ${INFINITE[id].desc}`, 'good');
    else hud.toast(`研究完了！ ${RESEARCH[id].name}: ${RESEARCH[id].desc}`, 'good');
  },
});

const hud = createHud({
  audio,
  select(m) {
    mode = mode === m ? null : m;
    if (mode) select(null);
  },
  hire: () => act({ kind: 'hire' }, hireCat, 'hire') && saveSoon(),
  research: () => panel.toggle(),
  expand() {
    if (!act({ kind: 'expand' }, expandIsland, 'expand')) return;
    saveSoon();
    const n = gridSize(state);
    hud.toast(`島が ${n}×${n} に広がりました！`, 'good');
  },
  follow,
  following: () => followId,
  wake,
  async assign(c, b) {
    // 最後の運び屋を職人にすると荷物が動かなくなる
    if (!c.job && carrierCount(state) <= 1) {
      const ok = await hud.ask({ title: '運び屋がいなくなります', body: `<p>「${c.name.replace(/[<>&"]/g, '')}」を職人にすると運び屋が 0 匹になり、品物を運ぶ猫がいなくなります。</p>`, ok: '配置する', cancel: 'やめる', danger: true });
      if (!ok) return;
    }
    if (act({ kind: 'assign', cat: c.id, building: b.id }, (s) => assignCat(s, c.id, b.id), 'select')) {
      hud.toast(`${c.name}を${BUILDINGS[b.type].name}の職人にしました`, 'good');
      saveSoon();
    }
  },
  unassign(c) {
    if (act({ kind: 'unassign', cat: c.id }, (s) => unassignCat(s, c.id), 'select')) saveSoon();
  },
  upgrade(b) {
    if (!act({ kind: 'upgrade', id: b.id }, (s) => upgradeBuilding(s, b.id), 'thud')) return;
    saveSoon();
  },
  async reset() {
    const ok = await hud.ask({ title: '最初からやり直しますか？', body: '<p>セーブを消して、コイン 300・猫 1 匹から始めます。</p>', ok: 'やり直す', cancel: 'やめる', danger: true });
    if (!ok) return;
    resetting = true;
    clearSave();
    location.reload();
  },
  exportSave() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([serialize(state, Date.now())], { type: 'application/json' }));
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    a.download = `nekoFactory-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  async importSave(file) {
    const json = await file.text();
    const ok = await hud.ask({ title: 'セーブを読み込みますか？', body: `<p>今の工場は「${file.name.replace(/[<>&"]/g, '')}」の内容に置き換わります。今の保存はバックアップに残します。</p>`, ok: '読み込む', cancel: 'やめる', danger: true });
    if (!ok) return;
    save(); // 今の状態を保存してから、それをバックアップへ退避する
    let err: string | null;
    try {
      err = importSave(json);
    } catch (e) {
      err = saveError(e);
    }
    if (err) return hud.toast(err, 'error');
    resetting = true;
    location.reload();
  },
  remove: removeAt,
  deselect: () => select(null),
  quality: { get: () => view.quality, set: (q) => view.setQuality(q) },
});
view.onQuality = (q) => {
  hud.syncQuality();
  hud.setFxNote(q.dropped ? '動作を軽くするため、画質を自動で下げました' : '');
};
let lostTimer = 0;
view.onContext = (lost) => {
  clearTimeout(lostTimer);
  if (!lost) return hud.toast('画面の描画が戻りました', 'good');
  save();
  // すぐ戻らなければ再読み込みを促す（進行は保存済み）
  lostTimer = window.setTimeout(async () => {
    const ok = await hud.ask({ title: '画面の描画が止まりました', body: '<p>端末のメモリ不足などで 3D の描画が中断されました。保存してあるので、再読み込みすると続きから遊べます。</p>', ok: '再読み込み', cancel: 'このまま待つ' });
    if (ok) location.reload();
  }, 2000);
};

function hoverInfo() {
  const m = view.mouse();
  if (!m) {
    // タッチにホバーはない。1 回目にタップしたタイルをゴーストとハイライトで見せる
    const tile = tapped && tapped.mode === mode ? { x: tapped.x, y: tapped.y } : null;
    return { tile, hit: tile && mode === 'remove' ? (buildingAt(state, tile.x, tile.y) ?? null) : null, cat: null };
  }
  const tile = view.tileAt(m.x, m.y);
  const ray = view.rayAt(m.x, m.y);
  const cat = mode ? null : ents.pickCat(ray);
  const hit = (mode && mode !== 'remove') || cat !== null ? null : ents.pick(ray, state);
  return { tile, hit, cat };
}

view.onClick = (x, y, touch) => {
  if (mode && touch) {
    const t = mode === 'remove' ? ents.pick(view.rayAt(x, y), state) : view.tileAt(x, y);
    const first = !t || tapped?.mode !== mode || tapped.x !== t.x || tapped.y !== t.y;
    tapped = t && first ? { mode, x: t.x, y: t.y } : null;
    if (first) {
      if (t) audio.play('select');
      return;
    }
  }
  if (mode === 'remove') {
    const hit = ents.pick(view.rayAt(x, y), state);
    if (hit) removeAt(hit);
  } else if (mode) {
    const t = view.tileAt(x, y);
    const type = mode;
    if (t && act({ kind: 'place', type, x: t.x, y: t.y }, (s) => placeBuilding(s, type, t.x, t.y), 'place')) saveSoon();
  } else {
    const ray = view.rayAt(x, y);
    const catId = ents.pickCat(ray);
    const cat = catId === null ? null : state.cats.find((c) => c.id === catId);
    if (cat) {
      if (cat.rest === 'sleep') wake(cat);
      else audio.play('select');
      selectCat(cat);
      return;
    }
    const hit = ents.pick(ray, state);
    if (hit) {
      select(hit);
      audio.play('select');
    } else if (sel) select(null);
  }
};
view.onLongPress = async (x, y) => {
  const b = ents.pick(view.rayAt(x, y), state);
  if (!b) return;
  navigator.vibrate?.(15);
  view.select(b);
  const ok = await hud.ask({
    title: `${BUILDINGS[b.type].name}を撤去しますか？`,
    body: `<p>最後に買った値段と強化分の半分、<b>${fmt(refundOf(state, b))}</b> コインが戻ります。</p>`,
    ok: '撤去する',
    cancel: 'やめる',
    danger: true,
  });
  if (ok) removeAt(b);
  const id = sel?.kind === 'building' ? sel.id : null;
  view.select(state.buildings.find((x) => x.id === id) ?? null);
};
view.onCancel = () => {
  if (mode) mode = null;
  else select(null);
};
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  mode = null;
  panel.close();
  follow(null);
  select(null);
});

if (loaded.source === 'backup') hud.toast('セーブが壊れていたので、バックアップから復元しました', 'error');
if (loaded.savedAt) hud.setSavedAt(loaded.savedAt);

const saveError = (e: unknown) => `保存できませんでした（${e instanceof DOMException && e.name === 'QuotaExceededError' ? '保存容量が足りません' : String(e)}）`;
/** 失敗が続く間はトーストを 1 回だけ出す */
let saveFailing = false;
function save() {
  if (resetting) return;
  try {
    hud.setSavedAt(saveGame(state));
    saveFailing = false;
  } catch (e) {
    if (!saveFailing) hud.toast(saveError(e), 'error');
    saveFailing = true;
  }
}
/** 研究・拡張・建設・雇用の直後は 1 秒まとめてから保存する */
let saveTimer = 0;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(save, 1000);
}
setInterval(save, 10_000);
document.addEventListener('visibilitychange', () => document.hidden && save());
addEventListener('pagehide', save);

// sim は Worker で 10Hz。描画は直近の状態を補間する
const worker = new Worker(new URL('./simWorker.ts', import.meta.url), { type: 'module' });
const send = (m: ToWorker) => worker.postMessage(m);
send({ kind: 'init', state });
let sent = 0;
let snapAt = performance.now();
worker.onmessage = (e: MessageEvent<FromWorker>) => {
  const m = e.data;
  for (const ev of m.events) onEvent(ev, m.state);
  for (const err of m.errors) hud.toast(err, 'error');
  if (m.acked < sent) return; // 送ったアクションをまだ反映していない古い状態
  if (m.ticks > 0) {
    ents.snapshot();
    snapAt = performance.now();
  }
  state = m.state;
  // 雇った猫の個性は worker の結果で知らせる（手元の state とは乱数の位置がずれていることがある）
  for (const c of state.cats)
    if (!knownCats.has(c.id)) {
      knownCats.add(c.id);
      hud.toast(`新しい猫「${c.name}」が来た！ ${traitText(c)}`, 'good');
    }
};
const knownCats = new Set(state.cats.map((c) => c.id));
document.addEventListener('visibilitychange', () => send({ kind: 'pause', paused: document.hidden }));

const canvas = view.renderer.domElement;
let last = performance.now();
function frame(now: number) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  const t = now / 1000;
  view.setSize(gridSize(state));
  view.update(dt, t);

  const { tile, hit, cat } = hoverInfo();
  const placing = mode && mode !== 'remove' ? (mode as BuildingType) : null;
  const canPlace = !!(placing && tile && !buildingAt(state, tile.x, tile.y) && isUnlocked(state, placing) && state.coins >= buildingCost(state, placing));
  if (placing) view.highlight(tile, canPlace ? 0xfff0a0 : 0xff5a46);
  else if (hit) view.highlight({ x: hit.x, y: hit.y }, mode === 'remove' ? 0xff7a3d : 0xffffff);
  else view.highlight(mode === 'remove' ? tile : null, 0xff7a3d);
  canvas.style.cursor = placing ? (tile ? 'cell' : 'default') : hit || cat !== null ? 'pointer' : 'grab';
  const ui: UiState = { mode, hoverTile: tile, hoverId: hit?.id ?? null, canPlace };
  ents.update(state, dt, t, Math.min(1, (now - snapAt) / (STEP * 1000 * 1.05)), ui);
  hud.update(state, mode, dt);
  panel.update(state);
  audio.update(state, view.camera, t);
  view.render();
  raf = requestAnimationFrame(frame);
  if (stageName) ready();
}
let raf = requestAnimationFrame(frame);

/** 最初のフレームを描いたら: ローディング画面を消し、サムネイルを暇なときに 1 枚ずつ作る */
function ready() {
  performance.measure(stageName, `boot:${stageName}`);
  stageName = '';
  performance.measure('ページを開いてから main.ts 開始まで', { start: 0, end: 'boot:main' });
  performance.measure('ページを開いてから操作可能まで', { start: 0 });
  const boot = document.getElementById('boot')!;
  boot.classList.add('done');
  setTimeout(() => boot.remove(), 600);
  // フライインの途中で HUD を出す（起動の長さによらず、最初のフレームから数える）
  setTimeout(() => document.body.classList.remove('intro'), 1600);
  if (loaded.offline > 0)
    setTimeout(async () => {
      await hud.ask({
        title: 'おかえりなさい！',
        body: `<p>留守のあいだに猫たちが</p><div class="big-coin"><i>${ICON.coin}</i><b>${fmt(loaded.offline)}</b></div><p>コイン稼いでくれました。</p>`,
        ok: 'うけとる',
      });
      hud.flyCoins(innerWidth / 2, innerHeight / 2, loaded.offline);
      audio.play('coin');
    }, 2100);
  if (new URLSearchParams(location.search).has('perf')) console.table(performance.getEntriesByType('measure').map((m) => ({ 段階: m.name, 開始ms: Math.round(m.startTime), 所要ms: Math.round(m.duration) })));
  void makeThumbs();
}

async function makeThumbs() {
  const t0 = performance.now();
  const { renderThumbs } = await import('./render/thumbs');
  const shots = renderThumbs();
  const idle = window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 16));
  const next = () => {
    try {
      const r = shots.next();
      if (r.done) {
        if (new URLSearchParams(location.search).has('perf')) console.log(`サムネイル: ${Math.round(performance.now() - t0)}ms（暇なときに 1 枚ずつ）`);
        return;
      }
      const [key, c] = r.value;
      setThumb(key, c.toDataURL());
      if (key.startsWith('item:')) ents.setItemIcon(key.slice(5) as ItemId, c);
    } catch (e) {
      // 作れなければプレースホルダのまま遊べる
      console.error(e);
      return;
    }
    idle(next);
  };
  idle(next);
}
// タブが hidden の間は描画ループも止める
document.addEventListener('visibilitychange', () => {
  cancelAnimationFrame(raf);
  last = performance.now();
  raf = document.hidden ? 0 : requestAnimationFrame(frame);
});

// 開発時だけ: ブラウザから状態とカメラを触れるようにする
if (import.meta.env.DEV) Object.assign(window, { neko: { view, audio, get state() { return state; } } });
