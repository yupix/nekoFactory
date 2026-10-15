import { createEntities, type UiState } from './render/entities';
import { createScene } from './render/scene';
import * as THREE from 'three';
import { BUILDINGS, HAND, INFINITE, ITEMS, LIFT, RESEARCH, STATS, type BuildingType, type HandId, type ItemId } from './sim/data';
import { keepCat } from './sim/away';
import { clearSave, importSave, loadGame, saveGame, serialize } from './sim/save';
import { assignCat, buildingAt, buildingCost, buyResearch, canAfford, cancelHand, carrierCount, costText, expandIsland, gridSize, has, hireCat, isInfinite, isLeaving, launchRobot, level, liftAt, markCraftTip, missing, placeBlocker, placeBuilding, placeLifts, queueHand, refundOf, removeBuilding, renameCat, repairAll, repairBuilding, setKeep, setRecipe, setSell, traitText, TUTORIAL, unassignCat, upgradeBuilding, upgradeLift, wakeCat, type Building, type Cat, type GameState, type Lift } from './sim/state';
import type { GameEvent } from './sim/tick';
import type { Action, FromWorker, ToWorker } from './simWorker';
import type { Sfx } from './ui/audio';
import { createCatList } from './ui/catlist';
import { createFloaters } from './ui/float';
import { createHud, fmt, setThumb, type Mode } from './ui/hud';
import { ICON } from './ui/icons';
import { createResearchPanel } from './ui/research';
import { createStorePanel } from './ui/store';

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
let sel: { kind: 'building' | 'cat'; id: number } | { kind: 'lift'; x: number; y: number } | null = null;
/** リフトの配置: 向きと、ドラッグ中に通ったタイル */
let liftDir = 0;
let liftDrag: { x: number; y: number }[] | null = null;
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
/** 音の位置による音量（カメラから遠いほど小さい） */
const falloff = (at: THREE.Vector3) => Math.min(1, (18 / Math.max(1, at.distanceTo(view.camera.position))) ** 1.5);
const ents = createEntities(view.scene, (o) => view.noAO(o), (s, at) => audio.play(s, at ? falloff(at) : 1));
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
  const at = new THREE.Vector3(e.x + 0.5, 0.4, e.y + 0.5);
  switch (e.kind) {
    case 'coin':
    case 'rp':
    case 'bone': {
      const p = view.project(e.x + 0.5, e.kind === 'bone' ? 0.6 : 1.05, e.y + 0.5);
      spawnFloat(`+${fmt(e.amount)}`, p.x, p.y, e.kind === 'rp' ? 'rp' : 'coin');
      if (e.kind === 'rp') audio.play('rp');
      else if (e.kind === 'coin') {
        // 市場の売却は毎秒あるので、飛ぶコインは間引く
        audio.play('sell', falloff(at));
        if (performance.now() - flyAt > 700) {
          flyAt = performance.now();
          hud.flyCoins(p.x, p.y, e.amount);
        }
      } else {
        hud.flyCoins(p.x, p.y, e.amount);
        audio.play('coin');
      }
      return;
    }
    case 'fire':
      return audio.play(e.type === 'cannon' ? 'fireCannon' : e.type === 'turret' ? 'fireTurret' : 'fireWater', falloff(at));
    case 'hit':
      return audio.play(e.type === 'cannon' ? 'boom' : 'impact', falloff(at));
    case 'broken': {
      audio.play('break', Math.max(0.35, falloff(at)));
      const b = s.buildings.find((x) => x.x === e.x && x.y === e.y);
      if (b && b.type !== 'hq' && performance.now() - brokenToast > 4000) {
        brokenToast = performance.now();
        hud.toast(`${BUILDINGS[b.type].name}が壊された！ 修理するまで止まります`, 'error');
      }
      return;
    }
    case 'wave': {
      const r = s.raid.cur;
      hud.toast(`第 ${e.amount} 波！ 犬が ${r?.total ?? 0} 匹、船でやってくる`, 'raid', 3500);
      return audio.play('horn');
    }
    case 'clear':
      hud.toast(`撃退した！ クリア報酬 +${fmt(e.amount)} コイン・+${fmt(e.amount / 5)} RP`, 'good', 4000);
      hud.flyCoins(innerWidth / 2, innerHeight / 3, e.amount);
      return audio.play('fanfare');
    case 'retreat':
      hud.toast('時間切れ。犬たちは船へ帰っていった（報酬なし）', 'info', 3500);
      return;
    case 'lost':
      hud.toast(`本部が壊された！ ${fmt(e.amount)} コインを奪われた`, 'error', 4500);
      return audio.play('lose');
    case 'tip':
      hud.toast('犬が来る。水鉄砲タワーを置いて守ろう', 'raid', 7000);
      return;
    case 'away': {
      const pos = ents.catPosition(e.cat!);
      return audio.play('sadMeow', pos ? Math.max(0.5, falloff(pos)) : 1);
    }
    case 'gone':
      hud.toast(`${e.name}はどこかへ行ってしまった…`, 'info', 4500);
      return audio.play('lose');
    case 'craft': {
      const p = view.project(e.x + 0.5, 1.6, e.y + 0.5);
      spawnFloat(`+${e.amount} ${ITEMS[e.item!].name}`, p.x, p.y, 'coin');
      return audio.play('craft', Math.max(0.5, falloff(at)));
    }
  }
}
let brokenToast = 0;
let flyAt = 0;

function select(b: Building | null) {
  sel = b ? { kind: 'building', id: b.id } : null;
  hud.select(b ? { building: b } : null, state);
  view.select(b ? { x: b.x, y: b.y } : null);
}
function selectLift(l: Lift) {
  sel = { kind: 'lift', x: l.x, y: l.y };
  hud.select({ lift: l }, state);
  view.select({ x: l.x, y: l.y });
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

/** 家出しようとしている猫を引き止める */
function stay(c: Cat) {
  const swim = c.away?.phase === 'raft';
  if (!act({ kind: 'stay', id: c.id }, (s) => keepCat(s, c.id), 'happyMeow')) return;
  ents.keptCat(c.id, performance.now() / 1000);
  hud.toast(`${c.name}を引き止めた！ ${swim ? '泳いで帰ってくる' : 'しばらくは家出しない'}`, 'good');
  saveSoon();
}

/** 建物（なければリフト）を撤去する */
function removeAt(t: { x: number; y: number }) {
  if (!act({ kind: 'remove', x: t.x, y: t.y }, (s) => removeBuilding(s, t.x, t.y), 'remove')) return;
  const cur = sel;
  if (cur && (cur.kind === 'lift' ? cur.x === t.x && cur.y === t.y : cur.kind === 'building' && !state.buildings.some((b) => b.id === cur.id))) select(null);
  saveSoon();
}
const placeLiftTiles = (tiles: { x: number; y: number; d: number }[]) => act({ kind: 'lifts', tiles }, (s) => placeLifts(s, tiles), 'place') && saveSoon();
function launch() {
  if (!act({ kind: 'robot' }, launchRobot, 'select')) return;
  saveSoon();
  hud.toast('ロボ猫を起動した！ 本部から出てきて荷物を運ぶ', 'good');
}
/** 本部の手作業をキューに足す（quiet なら音とトーストを出さない） */
function queue(id: HandId, n: number, quiet = false) {
  const ok = act({ kind: 'hand', id, n }, (s) => queueHand(s, id, n), quiet ? undefined : 'select');
  if (ok) saveSoon();
  return ok;
}
const store = createStorePanel({
  audio,
  queueHand: (id, n) => queue(id, n),
  cancelHand(i) {
    if (act({ kind: 'handCancel', i }, (s) => cancelHand(s, i), 'close')) saveSoon();
  },
  setSell(item, on, keep) {
    if (act({ kind: 'sell', item, on, keep }, (s) => setSell(s, item, on, keep))) saveSoon();
  },
  setKeep(item, n) {
    if (act({ kind: 'keep', item, n }, (s) => setKeep(s, item, n))) saveSoon();
  },
  launch,
});

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

const hire = () => act({ kind: 'hire' }, hireCat, 'hire') && saveSoon();
/** 建物カード・猫カード・猫一覧で共通の配属処理 */
async function assign(c: Cat, b: Building) {
  // 最後の運び屋を職人にすると荷物が動かなくなる（ロボ猫かリフトがあれば言わない）
  if (!c.job && carrierCount(state) <= 1 && !state.lifts.length) {
    const ok = await hud.ask({ title: '運び屋がいなくなります', body: `<p>「${c.name.replace(/[<>&"]/g, '')}」を職人にすると運び屋が 0 匹になり、品物を運ぶ猫がいなくなります。</p>`, ok: '配置する', cancel: 'やめる', danger: true });
    if (!ok) return;
  }
  if (act({ kind: 'assign', cat: c.id, building: b.id }, (s) => assignCat(s, c.id, b.id), 'select')) {
    hud.toast(`${c.name}を${BUILDINGS[b.type].name}の職人にしました`, 'good');
    saveSoon();
  }
}
function unassign(c: Cat) {
  if (act({ kind: 'unassign', cat: c.id }, (s) => unassignCat(s, c.id), 'select')) saveSoon();
}

const catList = createCatList({
  audio,
  follow,
  assign,
  unassign,
  wake,
  hire,
  launch,
  rename(c, name) {
    if (act({ kind: 'rename', id: c.id, name }, (s) => renameCat(s, c.id, name), 'select')) saveSoon();
  },
});

const hud = createHud({
  audio,
  select(m) {
    mode = mode === m ? null : m;
    if (mode) select(null);
  },
  hire,
  research: () => panel.toggle(),
  cats: () => catList.toggle(),
  expand() {
    if (!act({ kind: 'expand' }, expandIsland, 'expand')) return;
    saveSoon();
    const n = gridSize(state);
    hud.toast(`島が ${n}×${n} に広がりました！`, 'good');
  },
  follow,
  following: () => followId,
  wake,
  assign,
  unassign,
  upgrade(b) {
    if (!act({ kind: 'upgrade', id: b.id }, (s) => upgradeBuilding(s, b.id), 'thud')) return;
    saveSoon();
  },
  repair(b) {
    if (act({ kind: 'repair', id: b.id }, (s) => repairBuilding(s, b.id), 'repair')) saveSoon();
  },
  repairAll() {
    if (act({ kind: 'repairAll' }, repairAll, 'repair')) saveSoon();
  },
  recipe(b, recipe) {
    if (act({ kind: 'recipe', id: b.id, recipe }, (s) => setRecipe(s, b.id, recipe), 'select')) saveSoon();
  },
  rotate: () => rotateLift(),
  liftTurn(l) {
    placeLiftTiles([{ x: l.x, y: l.y, d: (l.d + 1) % 4 }]);
  },
  liftUpgrade(l, all) {
    if (act({ kind: 'upgradeLift', x: l.x, y: l.y, all }, (s) => upgradeLift(s, l.x, l.y, all), 'thud')) saveSoon();
  },
  removeLift: (l) => removeAt(l),
  store: () => store.toggle(),
  craft: () => store.openHand(),
  hand(list) {
    const done = list.filter((e) => queue(e.id, e.n, true));
    if (!done.length) return;
    audio.play('select');
    hud.toast(`本部で手作りを始めました: ${done.map((e) => `${ITEMS[e.id].name} ×${e.n * HAND[e.id].n}`).join('・')}（倉庫 → 手作業で進み具合）`, 'good', 3500);
  },
  async reset() {
    const ok = await hud.ask({ title: '最初からやり直しますか？', body: '<p>セーブを消して、コイン 300・猫 2 匹・初期資材から始めます。</p>', ok: 'やり直す', cancel: 'やめる', danger: true });
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
    const tile = tapped && tapped.mode === mode ? { x: tapped.x, y: tapped.y } : liftDrag?.length ? liftDrag[liftDrag.length - 1] : null;
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
    const t = view.tileAt(x, y);
    if (hit) removeAt(hit);
    else if (t && liftAt(state, t.x, t.y)) removeAt(t);
  } else if (mode === 'lift') {
    const t = view.tileAt(x, y);
    if (t) placeLiftTiles([{ ...t, d: liftDir }]);
  } else if (mode) {
    const t = view.tileAt(x, y);
    const type = mode;
    const recipe = hud.placeRecipe(type);
    if (!t) return;
    if (act({ kind: 'place', type, x: t.x, y: t.y, recipe }, (s) => placeBuilding(s, type, t.x, t.y, recipe), 'place')) saveSoon();
    // 初めて歯車が足りずに建てられなかったときだけ、手作業を教える
    else if (!state.craftTip && placeBlocker(state, type, t.x, t.y)?.startsWith('資材') && missing(state, buildingCost(state, type)).gear && act({ kind: 'craftTip' }, markCraftTip)) {
      hud.toast('歯車が足りないときは本部で手作りできる（倉庫 → 手作業）', 'info', 6000);
      saveSoon();
    }
  } else {
    const ray = view.rayAt(x, y);
    const catId = ents.pickCat(ray);
    const cat = catId === null ? null : state.cats.find((c) => c.id === catId);
    if (cat) {
      if (isLeaving(cat)) stay(cat);
      else if (cat.rest === 'sleep') wake(cat);
      else audio.play('select');
      selectCat(cat);
      return;
    }
    // 家出しようとしている猫を追っている間は、どこをクリック・タップしても引き止める
    const followed = followId === null ? undefined : state.cats.find((c) => c.id === followId);
    if (followed && isLeaving(followed)) {
      stay(followed);
      selectCat(followed);
      return;
    }
    const hit = ents.pick(ray, state);
    const t = view.tileAt(x, y);
    const lift = !hit && t ? liftAt(state, t.x, t.y) : undefined;
    if (hit) {
      select(hit);
      audio.play('select');
    } else if (lift) {
      selectLift(lift);
      audio.play('select');
    } else if (sel) select(null);
  }
};
/** 通ったタイルを、飛んだ分も縦横 1 マスずつ埋めてつなぐ（戻ったら取り消す） */
function extendDrag(t: { x: number; y: number }) {
  const path = liftDrag!;
  for (let guard = 0; guard < 200; guard++) {
    const last = path[path.length - 1];
    const dx = t.x - last.x;
    const dy = t.y - last.y;
    if (!dx && !dy) return;
    const next = Math.abs(dx) >= Math.abs(dy) ? { x: last.x + Math.sign(dx), y: last.y } : { x: last.x, y: last.y + Math.sign(dy) };
    const back = path[path.length - 2];
    if (back && back.x === next.x && back.y === next.y) path.pop();
    else path.push(next);
  }
}
const dirOf = (a: { x: number; y: number }, b: { x: number; y: number }) => (b.x > a.x ? 0 : b.y > a.y ? 1 : b.x < a.x ? 2 : 3);
/** ドラッグした道筋の各タイルの向き（次のタイルへ。最後は最後に進んだ向き） */
function dragTiles() {
  const path = liftDrag ?? [];
  return path.map((p, i) => ({ ...p, d: i + 1 < path.length ? dirOf(p, path[i + 1]) : i > 0 ? dirOf(path[i - 1], p) : liftDir }));
}
function rotateLift() {
  liftDir = (liftDir + 1) % 4;
  hud.liftDir = liftDir;
  audio.play('select');
}
view.paint = (x, y, phase) => {
  if (mode !== 'lift') return false;
  const t = view.tileAt(x, y);
  if (phase === 'start') {
    if (!t) return false;
    liftDrag = [t];
    return true;
  }
  if (!liftDrag) return false;
  if (phase === 'move') {
    if (t) extendDrag(t);
    return true;
  }
  const tiles = dragTiles();
  if (tiles.length > 1) {
    liftDir = tiles[tiles.length - 1].d;
    hud.liftDir = liftDir;
  }
  liftDrag = null;
  if (tiles.length) placeLiftTiles(tiles);
  return true;
};
view.onLongPress = async (x, y) => {
  const b = ents.pick(view.rayAt(x, y), state);
  const t = view.tileAt(x, y);
  const lift = !b && t ? liftAt(state, t.x, t.y) : undefined;
  if ((!b || b.type === 'hq') && !lift) return;
  navigator.vibrate?.(15);
  const at = b ?? lift!;
  view.select(at);
  const ok = await hud.ask({
    title: `${b ? BUILDINGS[b.type].name : 'リフト'}を撤去しますか？`,
    body: b ? `<p>建設と強化の資材の半分（${costText(refundOf(state, b)) || 'なし'}）が倉庫に戻ります。</p>` : '<p>資材は全部倉庫に戻ります。</p>',
    ok: '撤去する',
    cancel: 'やめる',
    danger: true,
  });
  if (ok) removeAt(at);
  const cur = sel;
  view.select(cur?.kind === 'lift' ? cur : (state.buildings.find((x) => cur?.kind === 'building' && x.id === cur.id) ?? null));
};
view.onCancel = () => {
  if (mode) mode = null;
  else select(null);
};
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  if (e.key.toLowerCase() === 'r' && mode === 'lift') return rotateLift();
  if (e.key !== 'Escape') return;
  mode = null;
  liftDrag = null;
  panel.close();
  catList.close();
  store.close();
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
  // 襲撃の 60 秒前に警笛、30 秒前から 6 秒おきにサイレン
  const before = state.raid.next;
  const next = m.state.raid.next;
  if (!m.state.raid.cur && next < before) {
    if (before > 60 && next <= 60) {
      audio.play('horn');
      hud.toast('沖に犬の船が見えた！ あと 1 分で襲撃', 'raid', 3500);
    }
    for (const k of [30, 24, 18, 12, 6]) if (before > k && next <= k) audio.play('siren');
  }
  if (m.state.tut > state.tut) {
    const next = TUTORIAL_TEXT[m.state.tut];
    hud.toast(next ? `できた！ 次は: ${next}` : 'チュートリアル完了！ 研究で工場を広げよう', 'good', 4000);
    audio.play('research');
  }
  state = m.state;
  // 雇った猫の個性は worker の結果で知らせる（手元の state とは乱数の位置がずれていることがある）
  for (const c of state.cats)
    if (!knownCats.has(c.id)) {
      knownCats.add(c.id);
      if (c.robot) continue;
      hud.toast(`新しい猫「${c.name}」が来た！ ${traitText(c)}`, 'good');
      catList.hired(c.id);
    }
};
const TUTORIAL_TEXT = ['鉱床に採掘機を置こう', '石の炉を置いて鉄板を作ろう', '組立機で歯車を作ろう', '赤パックを研究所へ届けよう'];
if (TUTORIAL_TEXT.length !== TUTORIAL.length) throw new Error('チュートリアルの段階の数が合わない');
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
  const placing = mode && mode !== 'remove' ? mode : null;
  const lift = !hit && tile ? liftAt(state, tile.x, tile.y) : undefined;
  const canPlace = !!(
    tile &&
    (placing === 'lift'
      ? has(state, 'lift') && (!!lift || (!buildingAt(state, tile.x, tile.y) && canAfford(state, LIFT.cost)))
      : placing && !placeBlocker(state, placing as BuildingType, tile.x, tile.y))
  );
  if (placing) view.highlight(tile, canPlace ? 0xfff0a0 : 0xff5a46);
  else if (hit) view.highlight({ x: hit.x, y: hit.y }, mode === 'remove' ? 0xff7a3d : 0xffffff);
  else view.highlight(mode === 'remove' || lift ? tile : null, mode === 'remove' ? 0xff7a3d : 0xffffff);
  canvas.style.cursor = placing ? (tile ? 'cell' : 'default') : hit || lift || cat !== null ? 'pointer' : 'grab';
  const ui: UiState = { mode, hoverTile: tile, hoverId: hit?.id ?? null, canPlace, liftDir, liftPath: liftDrag ? dragTiles() : [] };
  ents.update(state, dt, t, Math.min(1, (now - snapAt) / (STEP * 1000 * 1.05)), ui);
  hud.update(state, mode, dt);
  panel.update(state);
  catList.update(state);
  store.update(state);
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
  if (loaded.migrated)
    setTimeout(
      () =>
        void hud.ask({
          title: '素材の工場に生まれ変わりました',
          body: '<p>ねこ工場はコインで建てる工場から、<b>鉱石を掘って素材で建てる</b>工場になりました。</p><p><b>引き継いだもの</b>: 猫たち（名前・個性・ステータス）、研究、島の広さ、コイン</p><p><b>新しくなったもの</b>: 建物と在庫（本部と初期資材から）</p><p>鉱床に採掘機を置くところから始めましょう。</p>',
          ok: 'はじめる',
        }),
      2100,
    );
  else if (loaded.offline > 0)
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
  // 描画で常に忙しい端末でも、1 秒待てば作る
  const idle = 'requestIdleCallback' in window ? (f: () => void) => requestIdleCallback(f, { timeout: 1000 }) : (f: () => void) => setTimeout(f, 16);
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
