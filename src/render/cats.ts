import * as THREE from 'three';
import { BUILDINGS, ITEMS, WORK_STAT, type BuildingType, type ItemId } from '../sim/data';
import { isWorking, productionSpeed, statBonus, tierSpeed, type Building, type Cat, type GameState } from '../sim/state';
import type { Fx } from './fx';
import { Layer, type Items } from './layer';
import { toon } from './materials';
import { ballPos } from './buildings';
import { BED_Y, CAT, catGeometries, Geo, ITEM_H, PALLET, rbox, box, toolGeometries, TOWER_DECKS, Y0 } from './models';

const SCALE = 0.85;
const TAU = Math.PI * 2;

interface Coat {
  base: number;
  /** 0 無地 1 縞 2 三毛 */
  pattern: number;
  /** 口元・胸・足先の白 */
  marks: number;
  /** 0 黒目 1 金目 */
  eye: number;
}
const COATS: Record<string, Coat> = {
  white: { base: 0xf8f5ef, pattern: 0, marks: 0, eye: 0 },
  black: { base: 0x2f2c34, pattern: 0, marks: 0, eye: 1 },
  brown: { base: 0xd98f4e, pattern: 1, marks: 1, eye: 0 },
  gray: { base: 0x9ea5ae, pattern: 0, marks: 0, eye: 1 },
  calico: { base: 0xfbf7f0, pattern: 2, marks: 0, eye: 0 },
  saba: { base: 0xaaa8a1, pattern: 1, marks: 1, eye: 0 },
};
/** sim の毛色 5 種に加え、グレーの半数をサバトラとして描く */
export const coatOf = (c: Pick<Cat, 'id' | 'color'>) => (c.color === 'gray' && c.id % 2 ? COATS.saba : COATS[c.color]);

interface Pose {
  y: number;
  z: number;
  pitch: number;
  roll: number;
  headYaw: number;
  headPitch: number;
  legs: [number, number, number, number];
  legLen: [number, number, number, number];
  tailPitch: number;
  tailYaw: number;
  blink: number;
}
const pose = (): Pose => ({ y: 0, z: 0, pitch: 0, roll: 0, headYaw: 0, headPitch: 0, legs: [0, 0, 0, 0], legLen: [1, 1, 1, 1], tailPitch: 0, tailYaw: 0, blink: 0 });
const SIT: Pose = { y: -0.03, z: -0.035, pitch: -0.62, roll: 0, headYaw: 0, headPitch: 0.5, legs: [0.62, 0.62, -0.95, -0.95], legLen: [1.12, 1.12, 0.72, 0.72], tailPitch: -1.35, tailYaw: 0.9, blink: 0 };
const LOAF: Pose = { y: -0.075, z: 0, pitch: 0, roll: 0, headYaw: 0, headPitch: 0.12, legs: [-1.45, -1.45, -1.45, -1.45], legLen: [0.55, 0.55, 0.6, 0.6], tailPitch: -1.45, tailYaw: 1.25, blink: 0.65 };
/** 眠る: 丸くなって顔を前足に乗せ、尻尾を体に巻く */
const CURL: Pose = { y: -0.082, z: 0, pitch: 0.06, roll: 0.05, headYaw: 0.55, headPitch: 0.45, legs: [-1.5, -1.5, -1.45, -1.45], legLen: [0.5, 0.5, 0.55, 0.55], tailPitch: -1.5, tailYaw: 1.7, blink: 1 };
const STRETCH: Pose = { y: -0.035, z: 0.02, pitch: 0.32, roll: 0, headYaw: 0, headPitch: -0.45, legs: [-1.05, -1.05, 0.15, 0.15], legLen: [1.05, 1.05, 1.05, 1.05], tailPitch: 0.25, tailYaw: 0, blink: 1 };

function mixPose(a: Pose, b: Pose, t: number) {
  if (t <= 0) return;
  const l = THREE.MathUtils.lerp;
  a.y = l(a.y, b.y, t);
  a.z = l(a.z, b.z, t);
  a.pitch = l(a.pitch, b.pitch, t);
  a.roll = l(a.roll, b.roll, t);
  a.headYaw = l(a.headYaw, b.headYaw, t);
  a.headPitch = l(a.headPitch, b.headPitch, t);
  for (let i = 0; i < 4; i++) {
    a.legs[i] = l(a.legs[i], b.legs[i], t);
    a.legLen[i] = l(a.legLen[i], b.legLen[i], t);
  }
  a.tailPitch = l(a.tailPitch, b.tailPitch, t);
  a.tailYaw = l(a.tailYaw, b.tailYaw, t);
  a.blink = Math.max(a.blink, b.blink * t);
}

type Action = 'sit' | 'groom' | 'look' | 'stretch' | 'loaf' | 'wag' | 'curl' | 'chase';
const PLAY: Action[] = ['groom', 'stretch', 'chase'];

interface View {
  coat: Coat;
  seed: number;
  pos: THREE.Vector3;
  yaw: number;
  phase: number;
  walk: number;
  speed: number;
  sit: number;
  loaf: number;
  groom: number;
  stretch: number;
  look: number;
  action: Action | null;
  actionT: number;
  idleT: number;
  blinkAt: number;
  hop: number;
  dir: THREE.Vector2;
  dive: number;
  /** 施設の台やクッションの高さ */
  lift: number;
  /** 補間した sim 上の位置 */
  ix: number;
  iy: number;
  state: Cat['state'];
  item: ItemId | null;
  amount: number;
  /** 拾い上げ・届けるアニメーション */
  pick: { t: number; from: THREE.Vector3 } | null;
  drop: { t: number; to: THREE.Vector3; item: ItemId; amount: number } | null;
  born: number;
  curl: number;
  chase: number;
  zzzT: number;
  /** 撫でられた時刻 */
  petT: number;
  rest: Cat['rest'];
  /** 職人の作業（なめらかに 0〜1）、生産の進み、完了した時刻、稼働、湯気などの間隔 */
  work: number;
  wprog: number;
  doneT: number;
  wrun: number;
  wemit: number;
}

interface Crate {
  group: THREE.Group;
  body: THREE.Mesh;
  flaps: THREE.Object3D[];
  t0: number;
  x: number;
  z: number;
  meowed: boolean;
  landed: boolean;
}

/** 職人の作業: 1 秒あたりの手の動きの回数（生産 1 回に整数回入るよう丸める） */
const WORK_FREQ: Partial<Record<BuildingType, number>> = { fishing: 0.6, cannery: 1.1, packer: 0.8, yarnMill: 0.9, knitter: 1.8, workshop: 1.1, lab: 2.2 };
const smooth = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** 作業モーションの状態（姿勢と道具で共有） */
interface Work {
  b: Building;
  /** 生産の進み（0〜1、完了の瞬間が 1） */
  prog: number;
  /** 1 回の手の動きの進み（0〜1、終わりが山） */
  u: number;
  /** 完了直前の盛り上がり（0〜1） */
  climax: number;
  /** 完了直後の余韻（1 → 0） */
  rel: number;
  /** 稼働中（なめらかに） */
  run: number;
  good: boolean;
  /** 生産 1 回の手の動きの回数 */
  n: number;
}

const HEAVY = (it: ItemId | null) => !!it && ITEMS[it].value >= 80;

function crateGeometries() {
  const W = 0.36;
  const H = 0.3;
  const card = 0xcf9f66;
  const body = new Geo()
    .add(box(W, 0.02, W), 0xb98a52, { p: [0, 0.01, 0] })
    .add(rbox(W, H, 0.022, 0.006), card, { p: [0, H / 2, W / 2 - 0.011] })
    .add(rbox(W, H, 0.022, 0.006), card, { p: [0, H / 2, -W / 2 + 0.011] })
    .add(rbox(0.022, H, W - 0.04, 0.006), card, { p: [W / 2 - 0.011, H / 2, 0] })
    .add(rbox(0.022, H, W - 0.04, 0.006), card, { p: [-W / 2 + 0.011, H / 2, 0] })
    .add(box(W + 0.004, 0.05, 0.024), 0xe8c48e, { p: [0, H - 0.03, W / 2 - 0.011] })
    .add(box(W + 0.004, 0.05, 0.024), 0xe8c48e, { p: [0, H - 0.03, -W / 2 + 0.011] });
  // 側面の肉球マーク
  body.add(new THREE.CylinderGeometry(0.035, 0.035, 0.004, 14), 0x8a5a34, { p: [0, 0.12, W / 2 + 0.001], r: [Math.PI / 2, 0, 0] });
  for (const [x, y] of [[-0.04, 0.17], [-0.014, 0.185], [0.014, 0.185], [0.04, 0.17]])
    body.add(new THREE.CylinderGeometry(0.013, 0.013, 0.004, 10), 0x8a5a34, { p: [x, y, W / 2 + 0.001], r: [Math.PI / 2, 0, 0] });
  const flap = new Geo().add(rbox(W, 0.012, W / 2, 0.004), 0xd8aa70, { p: [0, 0, -W / 4] }).build();
  return { body: body.build(), flap, W, H };
}

/** state の猫を描く。パーツごとに InstancedMesh、関節の行列は CPU で組む */
export function createCats(parent: THREE.Object3D, items: Items, fx: Fx, sound: (name: 'meow' | 'thud') => void, faceYaw?: number) {
  const geo = catGeometries();
  const attrs = { aFur: 3, aCoat: 4 };
  const body = new Layer(parent, geo.body, toon({ fur: 0, rim: 0.25 }), 16, { shadow: true, attrs });
  const head = new Layer(parent, geo.head, toon({ fur: 1, rim: 0.25 }), 16, { shadow: true, attrs: { ...attrs, aBlink: 1 } });
  const legs = new Layer(parent, geo.leg, toon({ fur: 3, rim: 0.2 }), 64, { shadow: true, attrs });
  const tail = new Layer(parent, geo.tail, toon({ fur: 2, rim: 0.25 }), 16, { shadow: true, attrs });
  const wing = new Geo()
    .add(new THREE.SphereGeometry(1, 8, 5), 0xffffff, { p: [0.034, 0, 0.004], s: [0.034, 0.003, 0.026], r: [0, -0.3, 0] })
    .add(new THREE.SphereGeometry(1, 8, 5), 0xffffff, { p: [-0.034, 0, 0.004], s: [0.034, 0.003, 0.026], r: [0, 0.3, 0] })
    .add(new THREE.SphereGeometry(1, 8, 5), 0xffffff, { p: [0.026, 0, -0.022], s: [0.022, 0.003, 0.016] })
    .add(new THREE.SphereGeometry(1, 8, 5), 0xffffff, { p: [-0.026, 0, -0.022], s: [0.022, 0.003, 0.016] })
    .add(new THREE.CapsuleGeometry(0.006, 0.04, 2, 5), 0x6b5b7b, { r: [Math.PI / 2, 0, 0] })
    .build();
  const butterflies = new Layer(parent, wing, toon({ vertexColors: true, rim: 0.3, cloud: false }), 8, { shadow: true, color: true });
  const BUTTERFLY = [0xffd447, 0xff9fc6, 0x9fd3ff, 0xc9a8ff].map((c) => new THREE.Color(c));
  const crateGeo = crateGeometries();
  const crateMat = toon({ vertexColors: true });
  const crates: Crate[] = [];
  const toolGeo = toolGeometries();
  const toolMat = toon({ vertexColors: true, glow: true, rim: 0.2 });
  const tools = Object.fromEntries(Object.entries(toolGeo).map(([k, g]) => [k, new Layer(parent, g, toolMat, 8, { shadow: k !== 'line' })])) as Record<keyof typeof toolGeo, Layer>;
  let lastNow = 0;

  const views = new Map<number, View>();
  const prev = new Map<number, { x: number; y: number }>();
  let ready = false;

  const root = new THREE.Matrix4();
  const B = new THREE.Matrix4();
  const T = new THREE.Matrix4();
  const O = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const col = new THREE.Color();
  const target = new THREE.Vector3();
  const p = pose();

  const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

  function newView(c: Cat, now: number): View {
    return {
      coat: coatOf(c),
      seed: (c.id * 0.6180339) % 1,
      pos: new THREE.Vector3(c.x + 0.5, 0, c.y + 0.5),
      yaw: faceYaw ?? Math.random() * TAU,
      phase: Math.random(),
      walk: 0,
      speed: 0,
      sit: 1,
      loaf: 0,
      groom: 0,
      stretch: 0,
      look: 0,
      action: 'sit',
      actionT: 1 + Math.random() * 3,
      idleT: 5,
      blinkAt: now + Math.random() * 3,
      hop: 0,
      dir: new THREE.Vector2(0, -1),
      dive: 1,
      lift: 0,
      ix: c.x,
      iy: c.y,
      state: c.state,
      item: c.state === 'toDest' ? c.item : null,
      amount: c.amount,
      pick: null,
      drop: null,
      born: ready ? now : -1e9,
      curl: c.rest === 'sleep' ? 1 : 0,
      chase: 0,
      zzzT: Math.random(),
      petT: -9,
      rest: c.rest ?? null,
      work: 0,
      wprog: 0,
      doneT: -9,
      wrun: 0,
      wemit: 0,
    };
  }

  function chooseAction(w: View) {
    const r = Math.random();
    if (w.idleT > 9 && r < 0.45) return ['loaf', 8 + Math.random() * 8] as const;
    if (r < 0.22) return ['groom', 2.5 + Math.random() * 2] as const;
    if (r < 0.45) return ['look', 2 + Math.random() * 2] as const;
    if (r < 0.55) return ['stretch', 1.6] as const;
    if (r < 0.7) return ['wag', 2 + Math.random() * 2] as const;
    return ['sit', 2 + Math.random() * 3] as const;
  }

  function spawnCrate(c: Cat, now: number) {
    const group = new THREE.Group();
    const bodyMesh = new THREE.Mesh(crateGeo.body, crateMat);
    bodyMesh.castShadow = bodyMesh.receiveShadow = true;
    group.add(bodyMesh);
    const flaps: THREE.Object3D[] = [];
    for (let k = 0; k < 4; k++) {
      const pivot = new THREE.Group();
      pivot.rotation.y = (k * Math.PI) / 2;
      const hinge = new THREE.Group();
      hinge.position.set(0, crateGeo.H, crateGeo.W / 2);
      const f = new THREE.Mesh(crateGeo.flap, crateMat);
      f.castShadow = true;
      hinge.add(f);
      pivot.add(hinge);
      group.add(pivot);
      flaps.push(hinge);
    }
    parent.add(group);
    crates.push({ group, body: bodyMesh, flaps, t0: now, x: c.x + 0.5, z: c.y + 0.5, meowed: false, landed: false });
  }

  function updateCrates(now: number) {
    for (let i = crates.length - 1; i >= 0; i--) {
      const k = crates[i];
      const t = now - k.t0;
      const g = k.group;
      if (t < 0.45) {
        const u = t / 0.45;
        g.position.set(k.x, 5 * (1 - u * u), k.z);
        g.rotation.set(0, (1 - u) * 1.2, (1 - u) * 0.25);
        g.scale.setScalar(1);
      } else {
        if (!k.landed) {
          k.landed = true;
          fx.dust(new THREE.Vector3(k.x, 0.02, k.z), 14, 0.5);
          sound('thud');
        }
        g.position.set(k.x, 0, k.z);
        g.rotation.set(0, 0, t < 0.9 ? Math.sin((t - 0.45) * 30) * 0.05 * (1 - (t - 0.45) / 0.45) : 0);
        const sq = t < 0.75 ? Math.exp(-(t - 0.45) * 12) * Math.cos((t - 0.45) * 30) * 0.25 : 0;
        const fade = t > 1.7 ? Math.max(0, 1 - (t - 1.7) / 0.35) : 1;
        g.scale.set((1 + sq * 0.5) * fade, (1 - sq) * fade, (1 + sq * 0.5) * fade);
      }
      const open = THREE.MathUtils.clamp((t - 0.88) / 0.14, 0, 1);
      for (const f of k.flaps) f.rotation.x = t < 0.88 ? 0 : -open * 2.3 + Math.sin(t * 20) * 0.08 * (1 - open);
      if (t > 0.9 && !k.meowed) {
        k.meowed = true;
        sound('meow');
        fx.sparkle(new THREE.Vector3(k.x, 0.45, k.z), 0xfff1a8, 5, 0.25);
      }
      if (t > 2.05) {
        g.removeFromParent();
        crates.splice(i, 1);
      }
    }
  }

  /** 作業中の姿勢（前脚・体・尻尾）。生産の進みに合わせて動き、完了の瞬間に山が来る */
  function workPose(w: View, k: number, o: Work, now: number) {
    const { u, climax, rel, run } = o;
    const L = THREE.MathUtils.lerp;
    const a = u * TAU;
    const legs = (l: number, r: number) => {
      p.legs[0] = L(p.legs[0], l, k);
      p.legs[1] = L(p.legs[1], r, k);
      p.legLen[0] = L(p.legLen[0], 1, k);
      p.legLen[1] = L(p.legLen[1], 1, k);
    };
    p.headPitch += 0.22 * k;
    switch (o.b.type) {
      case 'fishing': {
        // 竿を前に構えて小さく振る。完了前は当たりで先がしなり、完了で釣り上げる
        const lift = rodAngle(o) - 0.95;
        legs(-0.85 + lift * 0.7, -0.85 + lift * 0.7);
        p.headPitch -= (0.2 * rel + 0.1 * climax) * k;
        break;
      }
      case 'cannery':
        // 両前脚で鍋をかき混ぜる（体も少し揺れる）
        legs(-0.6 + 0.2 * Math.sin(a) * run, -0.6 + 0.2 * Math.cos(a) * run);
        p.roll += 0.07 * Math.sin(a) * run * k;
        break;
      case 'packer': {
        // 箱を押し込む（ゆっくり押して素早く戻す）
        const push = pushCurve(u) * run;
        legs(-0.4 - 0.45 * push, -0.4 - 0.45 * push);
        p.pitch += 0.25 * push * k;
        p.z += 0.03 * push * k;
        break;
      }
      case 'yarnMill':
        // 左の前脚で糸車を回す
        legs(p.legs[0], -0.9 + 0.32 * Math.sin(a) * run);
        p.headYaw -= 0.25 * k;
        break;
      case 'knitter':
        // 編み針を交互に動かす
        legs(-0.95 + 0.22 * Math.sin(a) * run, -0.95 - 0.22 * Math.sin(a) * run);
        break;
      case 'workshop': {
        // リボンを結ぶ（細かく動かして、最後にきゅっと引く）
        const pull = smooth(0.7, 1, u) * run;
        const tie = Math.sin(a * 2) * 0.12 * run;
        legs(-0.7 + tie - 0.25 * pull, -0.7 - tie - 0.25 * pull);
        break;
      }
      case 'lab':
        // 右の前脚でフラスコを振る
        legs(-1.25 + Math.sin(a * 2) * (0.08 + 0.1 * climax) * run, p.legs[1]);
        p.headYaw += 0.2 * k;
        break;
    }
    // 完了の瞬間は小さく弾む
    p.y += 0.012 * rel * k;
    if (o.good) {
      // 得意な猫は尻尾を立て、目を細めて機嫌よく
      p.tailPitch = L(p.tailPitch, 0.95, k);
      p.tailYaw += Math.sin(now * 5) * 0.22 * k;
      p.roll += Math.sin(now * 2.2) * 0.04 * k;
      p.blink = Math.max(p.blink, 0.35 * k);
    }
  }
  const pushCurve = (u: number) => (u < 0.85 ? smooth(0, 0.85, u) : 1 - (u - 0.85) / 0.15);
  const rodAngle = (o: Work) => 0.95 + 0.08 * Math.sin(o.u * TAU) * o.run + o.climax * (0.14 + 0.04 * Math.sin(lastNow * 30)) - 0.8 * o.rel;

  /** 猫の座標系（足元、+z が前）で道具を置く */
  const at = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sc: number | THREE.Vector3 = 1) =>
    O.multiplyMatrices(root, T.compose(v.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), typeof sc === 'number' ? s.setScalar(sc) : s.copy(sc)));
  const sc3 = new THREE.Vector3();
  const tip = new THREE.Vector3();
  const bob = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  /** 作業の道具と完了の演出 */
  function workProps(w: View, k: number, o: Work, dt: number, done: boolean) {
    const { u, prog, rel, run } = o;
    const g = Math.min(1, k * 1.4);
    const a = u * TAU;
    const world = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(root);
    w.wemit += dt * run;
    switch (o.b.type) {
      case 'fishing': {
        const m = at(0, 0.16, 0.18, rodAngle(o), 0, 0, g);
        tools.rod.push(m);
        tip.set(0, 0.42, 0).applyMatrix4(m);
        bob.set(o.b.x + 0.5 - 0.04, Y0 + 0.09 - 0.012 * o.climax, o.b.y + 0.5 - 0.2);
        if (rel > 0.3) bob.lerp(tip, (rel - 0.3) * 0.5);
        const d = tip.clone().sub(bob);
        tools.line.push(O.compose(bob, q.setFromUnitVectors(up, d.clone().normalize()), s.set(g, d.length(), g)));
        break;
      }
      case 'cannery': {
        tools.pot.push(at(0, 0, 0.27, 0, 0, 0, g));
        const bowl = v.set(0.032 * Math.cos(a), 0.1, 0.27 + 0.032 * Math.sin(a));
        const dir = new THREE.Vector3(0, 0.17, 0.17).sub(bowl).normalize();
        tools.ladle.push(O.multiplyMatrices(root, T.compose(bowl, q.setFromUnitVectors(up, dir), s.setScalar(g))));
        if (w.wemit > 0.8) {
          w.wemit = 0;
          fx.smoke(world(0, 0.14, 0.27), 0xffffff);
        }
        if (done) for (let i = 0; i < 4; i++) fx.smoke(world((Math.random() - 0.5) * 0.06, 0.14, 0.27), 0xffffff);
        break;
      }
      case 'packer': {
        const push = pushCurve(u) * run;
        items.push('gift', at(0, 0, 0.27 + 0.05 * push, 0, 0.1, 0, sc3.set(1.25 * (1 + 0.18 * rel), 1.25 * (1 - 0.25 * rel), 1.25 * (1 + 0.18 * rel)).multiplyScalar(g)));
        if (done) fx.sparkle(world(0, 0.14, 0.3), 0xff9fbf, 4, 0.06);
        break;
      }
      case 'yarnMill':
        tools.stand.push(at(0.14, 0, 0.17, 0, 0, 0, g));
        tools.wheel.push(at(0.14, 0.13, 0.17, -prog * o.n * TAU, 0, 0, g));
        items.push('yarn', at(-0.11, 0, 0.2, 0, prog * 3, 0, (0.55 + 0.9 * prog) * g));
        if (done) fx.sparkle(world(-0.11, 0.1, 0.2), 0xff9fc6, 5, 0.06);
        break;
      case 'knitter':
        for (const kk of [0, 1]) {
          const sgn = kk ? -1 : 1;
          const d = Math.sin(a + kk * Math.PI) * 0.025 * run;
          tools.needle.push(at(0.03 * sgn, 0.19 + d, 0.2, 0.55, 0, 0.7 * sgn, g));
        }
        tools.strip.push(at(0, 0.165, 0.215, 0.12, 0, 0, sc3.set(g, (0.03 + 0.12 * prog) * g, g)));
        if (done) fx.sparkle(world(0, 0.12, 0.22), 0xc9a8ff, 5, 0.06);
        break;
      case 'workshop': {
        const pull = smooth(0.7, 1, u) * run;
        items.push('luxury', at(0, 0, 0.27, 0, 0.2, 0, 1.1 * g));
        tools.bow.push(at(0, 0.125, 0.27, 0, 0, Math.sin(a * 2) * 0.15 * run, (0.9 + 0.35 * pull + 0.3 * rel) * g));
        if (done) {
          fx.sparkle(world(0, 0.18, 0.27), 0xffe27a, 9, 0.16);
          fx.glow(world(0, 0.15, 0.27), 0xffe27a, 0.35);
        }
        break;
      }
      case 'lab': {
        const shake = Math.sin(a * 2) * (0.35 + 0.3 * o.climax) * run;
        tools.flask.push(at(-0.05, 0.19, 0.19, 0.2, 0, shake, g));
        if (w.wemit > 1.2) {
          w.wemit = 0;
          fx.sparkle(world(-0.05, 0.3, 0.19), 0xb8ffd0, 1, 0.02);
        }
        if (done) fx.sparkle(world(-0.05, 0.3, 0.19), 0xb8ffd0, 4, 0.04);
        break;
      }
    }
  }

  function draw(w: View) {
    // 関節を組む
    const S = SCALE * w.dive;
    if (S < 0.01) return;
    root.compose(w.pos, q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, w.yaw), s.setScalar(S));
    const hopY = w.hop > 0 ? Math.sin((1 - w.hop) * Math.PI) * 0.09 : 0;
    B.multiplyMatrices(root, T.compose(v.set(0, CAT.bodyY + p.y + hopY, p.z), q.setFromEuler(e.set(p.pitch, 0, p.roll)), s.setScalar(1)));
    const coat = w.coat;
    col.set(coat.base);
    const fur = (l: Layer, i: number) => {
      l.set('aFur', i, col.r, col.g, col.b);
      l.set('aCoat', i, coat.pattern, w.seed * 10, coat.marks, coat.eye);
    };
    fur(body, body.push(B));
    const hi = head.push(O.multiplyMatrices(B, T.compose(v.set(...CAT.head), q.setFromEuler(e.set(p.headPitch, p.headYaw, 0, 'YXZ')), s.setScalar(1))));
    fur(head, hi);
    head.set('aBlink', hi, p.blink);
    for (let k = 0; k < 4; k++) fur(legs, legs.push(O.multiplyMatrices(B, T.compose(v.set(...CAT.legs[k]), q.setFromEuler(e.set(p.legs[k], 0, 0)), s.set(1, p.legLen[k], 1)))));
    fur(tail, tail.push(O.multiplyMatrices(B, T.compose(v.set(...CAT.tail), q.setFromEuler(e.set(p.tailPitch, p.tailYaw, 0, 'YXZ')), s.setScalar(1)))));

    // 背中の荷物
    const it = w.item;
    if (it && !w.pick) {
      const h = ITEM_H[it] * 0.72;
      for (let k = 0; k < w.amount; k++) {
        const wob = HEAVY(it) ? Math.sin(w.phase * TAU + k) * 0.06 * w.walk : 0;
        items.push(it, O.multiplyMatrices(B, T.compose(v.set(CAT.cargo[0], CAT.cargo[1] + k * h, CAT.cargo[2]), q.setFromEuler(e.set(0, k * 0.4 + 0.2, wob)), s.setScalar(0.72 / SCALE))));
      }
    }
    if (w.pick && it) {
      const t = w.pick.t;
      const to = v.set(CAT.cargo[0], CAT.cargo[1], CAT.cargo[2]).applyMatrix4(B);
      const pos = new THREE.Vector3().lerpVectors(w.pick.from, to, t);
      pos.y += Math.sin(t * Math.PI) * 0.22;
      items.push(it, O.compose(pos, q.identity(), s.setScalar(0.72)));
    }
  }

  return {
    /** sim の状態が進んだ直後に呼ぶ。今表示している位置を次の補間の起点にする */
    snapshot() {
      prev.clear();
      for (const [id, w] of views) prev.set(id, { x: w.ix, y: w.iy });
    },
    update(st: GameState, dt: number, now: number, alpha: number) {
      body.begin();
      head.begin();
      legs.begin();
      tail.begin();
      butterflies.begin();
      for (const l of Object.values(tools)) l.begin();
      lastNow = now;
      const byId = new Map(st.buildings.map((b) => [b.id, b]));
      // 建物ごとの職人の生産ボーナス（sim と同じ）
      const bonus = new Map<number, number>();
      for (const c of st.cats) {
        const b = isWorking(c) ? byId.get(c.job) : undefined;
        if (b) bonus.set(b.id, (bonus.get(b.id) ?? 1) * statBonus(c, b.type));
      }
      const seen = new Set<number>();
      for (const c of st.cats) {
        seen.add(c.id);
        let w = views.get(c.id);
        if (!w) {
          w = newView(c, now);
          views.set(c.id, w);
          if (ready) spawnCrate(c, now);
        }
        // 補間した sim 上の位置
        const pv = prev.get(c.id) ?? c;
        const ix = THREE.MathUtils.lerp(pv.x, c.x, alpha);
        const iy = THREE.MathUtils.lerp(pv.y, c.y, alpha);
        w.ix = ix;
        w.iy = iy;
        const rest = c.rest ?? null;
        const moving = !rest && (c.path.length > 0 || Math.hypot(c.x - pv.x, c.y - pv.y) > 1e-4);
        if (rest !== w.rest) {
          // 休憩が終わったら待機モーションを選び直す
          if (!rest) w.action = null;
          w.rest = rest;
        }

        // 荷物の受け渡し
        if (w.state !== c.state) {
          if (w.state === 'toSource' && c.state === 'toDest' && c.item) {
            const src = byId.get(c.src);
            w.item = c.item;
            w.amount = c.amount;
            w.hop = 1;
            w.pick = { t: 0, from: src ? new THREE.Vector3(src.x + 0.5 + PALLET[0], Y0 + 0.12, src.y + 0.5 + PALLET[2]) : w.pos.clone() };
          } else if (w.state === 'toDest' && w.item) {
            const dst = byId.get(c.dst) ?? null;
            if (dst) w.drop = { t: 0, to: new THREE.Vector3(dst.x + 0.5, 0.25, dst.y + 0.5), item: w.item, amount: w.amount };
            w.item = null;
          }
          if (c.state === 'idle') w.item = null;
          w.state = c.state;
        }
        if (c.state !== 'toDest') w.item = null;
        else if (!w.item && c.item) {
          w.item = c.item;
          w.amount = c.amount;
        }
        if (w.pick) {
          w.pick.t += dt / 0.25;
          if (w.pick.t >= 1) w.pick = null;
        }
        if (w.drop) {
          const d = w.drop;
          d.t += dt / 0.28;
          const from = v.copy(w.pos).setY(0.3);
          const pos = new THREE.Vector3().lerpVectors(from, d.to, Math.min(1, d.t));
          pos.y += Math.sin(Math.min(1, d.t) * Math.PI) * 0.2;
          items.push(d.item, O.compose(pos, q.identity(), s.setScalar(0.72 * (1 - 0.6 * Math.min(1, d.t)))));
          if (d.t >= 1) w.drop = null;
        }

        // 表示位置は sim の位置（建物の外の待機位置まで sim が決める）。施設で休む猫は台やクッションの上
        target.set(ix + 0.5, 0, iy + 0.5);
        const fac = c.restAt && c.path.length === 0 ? byId.get(c.restAt) : undefined;
        let lift = 0;
        if (fac?.type === 'bed') lift = BED_Y + 0.005;
        else if (fac?.type === 'tower' && TOWER_DECKS[c.slot]) {
          // 台に乗れない分（ティアで増えた定員）は足元で休む
          const d = TOWER_DECKS[c.slot];
          target.set(fac.x + 0.5 + d[0], 0, fac.y + 0.5 + d[2]);
          lift = d[1];
        }
        w.lift += (lift - w.lift) * damp(lift > w.lift ? 7 : 10, dt);
        w.dive += (1 - w.dive) * damp(10, dt);
        const jump = target.distanceTo(w.pos.clone().setY(0));
        const before = w.pos.clone();
        if (jump > 0.12) w.pos.lerp(target, damp(14, dt));
        else w.pos.copy(target);

        // 雇用直後は箱の中、0.9 秒で飛び出す
        const age = now - w.born;
        if (age < 0.9) w.dive = 0;
        else if (age < 1.35) {
          const u = (age - 0.9) / 0.45;
          w.pos.y = 0.3 * (1 - u) + Math.sin(u * Math.PI) * 0.45;
          w.dive = Math.min(1, 0.6 + u);
        } else w.pos.y = w.lift;

        // 速度と向き
        const dx = w.pos.x - before.x;
        const dz = w.pos.z - before.z;
        const dist = Math.hypot(dx, dz);
        w.speed += (dist / Math.max(dt, 1e-4) - w.speed) * damp(12, dt);
        const walking = moving && w.speed > 0.15;
        if (dist > 1e-4 && moving) {
          w.yaw += wrap(Math.atan2(dx, dz) - w.yaw) * damp(14, dt);
          if (dist > 0.002) w.dir.set(dx, dz).normalize();
        }
        // 職人: 作業位置に着いたら建物（釣り場はウキ）の方を向く
        const job = !rest && c.state === 'idle' && c.work && c.job ? byId.get(c.job) : undefined;
        w.work += ((job && !walking ? 1 : 0) - w.work) * damp(5, dt);
        let wk: Work | null = null;
        if (job) {
          const fx0 = job.type === 'fishing' ? -0.04 : -0.06;
          const fz0 = job.type === 'fishing' ? -0.2 : -0.08;
          if (!walking) w.yaw += wrap(Math.atan2(job.x + 0.5 + fx0 - w.pos.x, job.y + 0.5 + fz0 - w.pos.z) - w.yaw) * damp(8, dt);
          const def = BUILDINGS[job.type];
          const rate = productionSpeed(st) * tierSpeed(job) * (bonus.get(job.id) ?? 1);
          const prog = job.running && def.time ? Math.min(1, (job.progress + alpha * 0.1 * rate) / def.time) : 0;
          if (prog < w.wprog - 0.3) w.doneT = now;
          w.wprog = prog;
          w.wrun += ((job.running ? 1 : 0) - w.wrun) * damp(4, dt);
          const good = c.good === WORK_STAT[job.type];
          const n = Math.max(1, Math.round((def.time / rate) * (WORK_FREQ[job.type] ?? 1) * (good ? 1.3 : 1)));
          wk = { b: job, prog, u: (prog * n) % 1, climax: smooth(0.8, 1, prog) * w.wrun, rel: Math.exp(-(now - w.doneT) * 3.5), run: w.wrun, good, n };
        } else w.wprog = 0;
        const heavy = HEAVY(w.item);
        w.phase += dist / (heavy ? 0.17 : 0.24);
        w.walk += ((walking ? 1 : 0) - w.walk) * damp(10, dt);
        w.hop = Math.max(0, w.hop - dt / 0.3);

        // 待機モーション（休憩中は sim の状態に合わせる）
        if (rest === 'sleep') w.action = 'curl';
        else if (rest === 'play') {
          // おもちゃ箱ではボールを追い、タワーでは毛づくろい
          if (fac?.type === 'toybox') w.action = 'chase';
          else if (fac?.type === 'tower') w.action = 'groom';
          else if (!w.action || !PLAY.includes(w.action)) w.action = PLAY[(c.id + Math.floor(now / 30)) % PLAY.length];
          w.actionT = 1;
        } else if (walking) {
          w.idleT = 0;
          w.action = null;
        } else if (wk) {
          // 作業中は座って手を動かす
          w.action = 'sit';
          w.actionT = 1;
          w.idleT = 0;
        } else {
          w.idleT += dt;
          w.actionT -= dt;
          if (w.idleT > 0.35 && (!w.action || w.actionT <= 0)) {
            const [a, d] = chooseAction(w);
            w.action = a;
            w.actionT = d;
          }
        }
        const a = w.action;
        const k = damp(5, dt);
        w.sit += ((a && a !== 'stretch' && a !== 'loaf' && a !== 'curl' ? 1 : 0) - w.sit) * k;
        w.loaf += ((a === 'loaf' ? 1 : 0) - w.loaf) * k;
        w.groom += ((a === 'groom' ? 1 : 0) - w.groom) * k;
        w.stretch += ((a === 'stretch' && (rest === 'play' || w.actionT > 0.3) ? 1 : 0) - w.stretch) * damp(4, dt);
        w.look += ((a === 'look' ? 1 : 0) - w.look) * k;
        w.curl += ((a === 'curl' ? 1 : 0) - w.curl) * damp(3, dt);
        w.chase += ((a === 'chase' ? 1 : 0) - w.chase) * k;

        // 姿勢
        Object.assign(p, pose());
        const ph = w.phase * TAU;
        const amp = (heavy ? 0.42 : 0.68) * w.walk;
        p.legs = [Math.sin(ph) * amp, Math.sin(ph + Math.PI) * amp, Math.sin(ph + Math.PI) * amp, Math.sin(ph) * amp];
        p.y = Math.abs(Math.sin(ph)) * (heavy ? 0.01 : 0.02) * w.walk - (heavy ? 0.012 : 0) * w.walk;
        p.roll = Math.sin(ph) * (heavy ? 0.12 : 0.045) * w.walk;
        p.headPitch = Math.sin(ph * 2) * 0.05 * w.walk + (heavy ? 0.16 : 0) * w.walk;
        p.tailYaw = Math.sin(ph * 0.5) * 0.35 * w.walk;
        p.tailPitch = (heavy ? -0.5 : 0.05) * w.walk;
        mixPose(p, SIT, w.sit);
        mixPose(p, LOAF, w.loaf);
        mixPose(p, STRETCH, w.stretch);
        mixPose(p, CURL, w.curl);
        if (w.curl > 0.01) {
          // 寝息でゆっくり上下し、ときどき Z が浮かぶ
          p.y += Math.sin(now * 2.1 + w.seed * 6) * 0.005 * w.curl;
          w.zzzT -= dt;
          if (w.curl > 0.8 && w.zzzT <= 0 && w.dive > 0.5) {
            w.zzzT = 1.3 + Math.random() * 0.4;
            fx.zzz(v.set(0.05, 0.3, 0.12).applyAxisAngle(THREE.Object3D.DEFAULT_UP, w.yaw).multiplyScalar(SCALE).add(w.pos));
          }
        }
        if (w.chase > 0.01) {
          // 蝶（おもちゃ箱ではボール）を目で追い、ときどき前足で払う
          const ang = now * 1.9 + w.seed * 7;
          const ball = fac?.type === 'toybox' ? ballPos(fac.x, fac.y, fac.id, now, new THREE.Vector3()) : null;
          const bx = ball ? ball.x : w.pos.x + Math.cos(ang) * 0.3;
          const bz = ball ? ball.z : w.pos.z + Math.sin(ang) * 0.3;
          const by = 0.3 + Math.sin(now * 3.1 + w.seed) * 0.09;
          const look = wrap(Math.atan2(bx - w.pos.x, bz - w.pos.z) - w.yaw);
          p.headYaw += THREE.MathUtils.clamp(look, -1.1, 1.1) * w.chase;
          p.headPitch -= 0.35 * w.chase;
          const swat = Math.max(0, Math.sin(now * 4 + w.seed * 3)) ** 3;
          p.legs[0] = THREE.MathUtils.lerp(p.legs[0], -1.9 * swat - 0.2, w.chase);
          p.y += swat * 0.025 * w.chase;
          if (!ball) {
            const flap = 0.25 + 0.75 * Math.abs(Math.sin(now * 22 + w.seed * 5));
            const bi = butterflies.push(O.compose(v.set(bx, by, bz), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, ang + Math.PI), s.set(flap * 1.3 * w.chase, 1.3 * w.chase, 1.3 * w.chase)));
            butterflies.color(bi, BUTTERFLY[c.id % BUTTERFLY.length]);
          }
        }
        // 撫でられた直後はうれしそうに目を細めて尻尾を立てる
        const pet = Math.max(0, 1 - (now - w.petT) / 1.6);
        if (pet > 0) {
          p.blink = Math.max(p.blink, 0.85 * pet);
          p.tailPitch += 0.4 * pet;
          p.headPitch -= 0.15 * pet;
        }
        const idle = 1 - w.walk;
        p.tailYaw += Math.sin(now * (a === 'wag' ? 7 : 1.6) + w.seed * 9) * (a === 'wag' ? 0.45 : 0.18) * idle;
        p.headYaw += Math.sin(now * 1.3 + w.seed * 5) * 0.75 * w.look;
        if (w.groom > 0.01) {
          p.headYaw += 0.55 * w.groom;
          p.headPitch += (0.5 + Math.sin(now * 9) * 0.12) * w.groom;
          p.legs[1] = THREE.MathUtils.lerp(p.legs[1], -1.75, w.groom);
          p.legLen[1] = THREE.MathUtils.lerp(p.legLen[1], 0.75, w.groom);
          p.blink = Math.max(p.blink, 0.8 * w.groom);
        }
        if (wk && w.work > 0.01) workPose(w, w.work, wk, now);
        // まばたき
        if (now > w.blinkAt + 0.16) w.blinkAt = now + 1.8 + Math.random() * 4;
        if (now >= w.blinkAt) p.blink = Math.max(p.blink, Math.sin(((now - w.blinkAt) / 0.16) * Math.PI));
        w.dive = Math.min(w.dive, 1);
        draw(w);
        if (wk && w.work > 0.05 && w.dive > 0.01) workProps(w, w.work, wk, dt, w.doneT === now);
      }
      for (const id of views.keys()) if (!seen.has(id)) views.delete(id);
      updateCrates(now);
      body.end();
      head.end();
      legs.end();
      tail.end();
      butterflies.end();
      for (const l of Object.values(tools)) l.end();
      ready = true;
    },
    /** ステータスの Lv UP（頭上のキラキラと、うれしそうに跳ねる） */
    levelUp(id: number) {
      const w = views.get(id);
      if (!w) return;
      w.hop = 1;
      w.petT = lastNow;
      fx.sparkle(v.set(0, 0.4, 0).add(w.pos), 0xffe27a, 10, 0.18);
      fx.glow(v.set(0, 0.35, 0).add(w.pos), 0xffe27a, 0.45);
    },
    /** 撫でる（起こした瞬間の演出） */
    pet(id: number, now: number) {
      const w = views.get(id);
      if (!w) return;
      w.petT = now;
      w.hop = 1;
      w.curl = 0.3;
      fx.hearts(v.set(0, 0.42, 0.1).applyAxisAngle(THREE.Object3D.DEFAULT_UP, w.yaw).multiplyScalar(SCALE).add(w.pos), 6);
    },
    /** レイが当たる猫（表示位置の球で判定） */
    pick(ray: THREE.Ray): number | null {
      let best: number | null = null;
      let bestD = Infinity;
      const sphere = new THREE.Sphere(new THREE.Vector3(), 0.24);
      for (const [id, w] of views) {
        if (w.dive < 0.4) continue;
        sphere.center.copy(w.pos).setY(w.pos.y + 0.17);
        const hit = ray.intersectSphere(sphere, v);
        if (!hit) continue;
        const d = hit.distanceTo(ray.origin);
        if (d < bestD) (bestD = d), (best = id);
      }
      return best;
    },
    /** 猫の表示位置（追跡カメラ用） */
    position(id: number) {
      return views.get(id)?.pos ?? null;
    },
  };
}
