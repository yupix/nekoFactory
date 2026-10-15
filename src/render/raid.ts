import * as THREE from 'three';
import type { BuildingType, DogKind } from '../sim/data';
import { boatOffset } from '../sim/raid';
import { gridSize, type Dog, type GameState } from '../sim/state';
import type { Fx } from './fx';
import { Layer, type Items } from './layer';
import { toon } from './materials';
import { boatGeometry, DOG, dogGeometries } from './models';

const COAT: Record<DogKind, number> = { puppy: 0xf3dcb0, guard: 0xa06c42, bulldog: 0xe2c8a2, boss: 0x5a5660 };
/** 種類ごとの体格（横・高さ・奥行き） */
const BUILD: Record<DogKind, [number, number, number]> = { puppy: [0.72, 0.72, 0.7], guard: [1, 1, 1], bulldog: [1.3, 0.88, 0.95], boss: [1.7, 1.7, 1.7] };
/** 弾の出る高さと、弧の高さ */
const MUZZLE_Y: Partial<Record<BuildingType, number>> = { waterGun: 0.74, turret: 0.4, cannon: 0.4 };
const ARC: Partial<Record<BuildingType, number>> = { waterGun: 0.55, turret: 0.02, cannon: 1.1 };

interface View {
  kind: DogKind;
  pos: THREE.Vector3;
  yaw: number;
  phase: number;
  walk: number;
  bite: number;
  born: number;
  barkAt: number;
  hitT: number;
  hp: number;
  seed: number;
}
interface Dying {
  kind: DogKind;
  pos: THREE.Vector3;
  yaw: number;
  t0: number;
  popped: boolean;
}

const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** 襲撃の描画: 犬（走る・噛む・倒れて骨）、船、飛んでいく弾と着弾 */
export function createRaid(parent: THREE.Object3D, items: Items, fx: Fx, bark: (at: THREE.Vector3) => void) {
  const geo = dogGeometries();
  const mat = toon({ vertexColors: true, rim: 0.28 });
  const body = new Layer(parent, geo.body, mat, 16, { shadow: true, color: true });
  const head = new Layer(parent, geo.head, mat, 16, { shadow: true, color: true });
  const legs = new Layer(parent, geo.leg, mat, 64, { shadow: true, color: true });
  const tail = new Layer(parent, geo.tail, mat, 16, { shadow: true, color: true });
  const bones = new Layer(parent, geo.bone, toon({ vertexColors: true, rim: 0.4 }), 8, { shadow: true });
  const boats = new Layer(parent, boatGeometry(), toon({ vertexColors: true, rim: 0.2 }), 4, { shadow: true });
  const drops = new Layer(parent, new THREE.SphereGeometry(1, 8, 6), toon({ color: 0x8fdcff, rim: 0.6, cloud: false }), 64, {});
  // 機関銃の曳光弾（+z に伸びた光る粒）
  const tracers = new Layer(parent, new THREE.CapsuleGeometry(0.012, 0.12, 2, 6).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe08a }), 32, {});

  const views = new Map<number, View>();
  const prev = new Map<number, { x: number; y: number }>();
  const dying: Dying[] = [];
  const docked = new Map<number, { state: string; wake: number }>();

  const root = new THREE.Matrix4();
  const B = new THREE.Matrix4();
  const T = new THREE.Matrix4();
  const O = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const col = new THREE.Color();
  const white = new THREE.Color(1, 1, 1);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();

  /** 犬を 1 匹描く（姿勢は引数で） */
  function draw(kind: DogKind, pos: THREE.Vector3, yaw: number, o: { phase: number; walk: number; bite: number; roll: number; scale: number; flash: number; now: number; seed: number }) {
    const [bx, by, bz] = BUILD[kind];
    const k = o.scale;
    root.compose(pos, q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw), s.set(bx * k, by * k, bz * k));
    const ph = o.phase * Math.PI * 2;
    const amp = 0.85 * o.walk;
    const lunge = o.bite * Math.max(0, Math.sin(o.now * 9 + o.seed * 5)) ** 2;
    const bob = Math.abs(Math.sin(ph)) * 0.025 * o.walk;
    B.multiplyMatrices(root, T.compose(v.set(0, DOG.bodyY + bob - 0.02 * o.bite, 0.03 * lunge), q.setFromEuler(e.set(0.12 * o.bite + Math.sin(ph) * 0.05 * o.walk, 0, o.roll)), s.setScalar(1)));
    col.set(COAT[kind]).lerp(white, o.flash);
    body.color(body.push(B), col);
    const hm = O.multiplyMatrices(B, T.compose(v.set(DOG.head[0], DOG.head[1], DOG.head[2] + 0.03 * lunge), q.setFromEuler(e.set(0.15 * o.bite + 0.3 * lunge + Math.sin(ph * 2) * 0.06 * o.walk, Math.sin(o.now * 1.3 + o.seed * 4) * 0.25 * (1 - o.walk - o.bite * 0.8), 0, 'YXZ')), s.setScalar(1)));
    head.color(head.push(hm), col);
    for (let i = 0; i < 4; i++) {
      // 前脚と後脚は半拍ずらした駆け足
      const swing = Math.sin(ph + (i < 2 ? 0 : Math.PI) + (i % 2) * 0.6) * amp + (i < 2 ? -0.25 * o.bite : 0.15 * o.bite);
      legs.color(legs.push(O.multiplyMatrices(B, T.compose(v.set(...DOG.legs[i]), q.setFromEuler(e.set(swing, 0, 0)), s.setScalar(1)))), col);
    }
    const wag = Math.sin(o.now * (o.bite ? 14 : 6) + o.seed * 9) * 0.5;
    tail.color(tail.push(O.multiplyMatrices(B, T.compose(v.set(...DOG.tail), q.setFromEuler(e.set(-0.75 + 0.2 * o.walk, wag, 0, 'YXZ')), s.setScalar(1)))), col);
  }

  return {
    /** sim が進んだ直後に呼ぶ（補間の起点） */
    snapshot() {
      prev.clear();
      for (const [id, w] of views) prev.set(id, { x: w.pos.x - 0.5, y: w.pos.z - 0.5 });
    },
    /** 犬が倒れた: 横倒しになってから骨になる */
    kill(id: number, x: number, y: number) {
      const w = views.get(id);
      dying.push({ kind: w?.kind ?? 'guard', pos: w ? w.pos.clone() : new THREE.Vector3(x + 0.5, 0, y + 0.5), yaw: w?.yaw ?? 0, t0: -1, popped: false });
      views.delete(id);
    },
    /** 着弾の演出 */
    hit(type: BuildingType, x: number, y: number) {
      const p = new THREE.Vector3(x + 0.5, 0.12, y + 0.5);
      if (type === 'cannon') {
        fx.glow(p.clone().setY(0.35), 0xffa040, 1.3);
        for (let k = 0; k < 6; k++) fx.smoke(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, Math.random() * 0.2, (Math.random() - 0.5) * 0.6)), 0x6a625a);
        fx.dust(p.clone().setY(0.02), 16, 0.9);
        fx.sparkle(p.clone().setY(0.3), 0xffb050, 8, 0.4);
      } else if (type === 'turret') {
        fx.sparkle(p.clone().setY(0.2), 0xffd27a, 3, 0.08);
        fx.dust(p.clone().setY(0.02), 3, 0.15);
      } else fx.splash(p);
    },
    update(st: GameState, dt: number, now: number, alpha: number) {
      for (const l of [body, head, legs, tail, bones, boats, drops, tracers]) l.begin();
      const raid = st.raid?.cur;
      const h = gridSize(st) / 2;
      const seen = new Set<number>();
      for (const d of raid?.dogs ?? []) drawDog(d);
      for (const id of views.keys()) if (!seen.has(id)) views.delete(id);

      function drawDog(d: Dog) {
        seen.add(d.id);
        let w = views.get(d.id);
        if (!w) {
          w = { kind: d.kind, pos: new THREE.Vector3(d.x + 0.5, 0, d.y + 0.5), yaw: Math.atan2(d.hx, d.hy), phase: Math.random(), walk: 0, bite: 0, born: now, barkAt: now + 0.3 + Math.random() * 2, hitT: -9, hp: d.hp, seed: Math.random() };
          views.set(d.id, w);
        }
        const pv = prev.get(d.id) ?? d;
        const before = w.pos.clone();
        w.pos.set(THREE.MathUtils.lerp(pv.x, d.x, alpha) + 0.5, 0, THREE.MathUtils.lerp(pv.y, d.y, alpha) + 0.5);
        const dist = Math.hypot(w.pos.x - before.x, w.pos.z - before.z);
        const moving = d.path.length > 0 && dist > 1e-4;
        if (moving) w.yaw += wrap(Math.atan2(w.pos.x - before.x, w.pos.z - before.z) - w.yaw) * damp(12, dt);
        else w.yaw += wrap(Math.atan2(d.hx, d.hy) - w.yaw) * damp(8, dt);
        w.phase += dist / 0.26;
        w.walk += ((moving ? 1 : 0) - w.walk) * damp(10, dt);
        w.bite += ((d.state === 'bite' ? 1 : 0) - w.bite) * damp(8, dt);
        if (d.hp < w.hp - 1e-6) w.hitT = now;
        w.hp = d.hp;
        // 船から飛び降りる弧と、敷地の柵を飛び越える弧
        const age = now - w.born;
        let y = age < 0.5 ? Math.sin((age / 0.5) * Math.PI) * 0.35 + (1 - age / 0.5) * 0.15 : 0;
        const m = Math.max(Math.abs(w.pos.x), Math.abs(w.pos.z));
        y += Math.max(0, 1 - Math.abs(m - h) / 0.35) * 0.22;
        w.pos.y = y;
        if (now > w.barkAt) {
          w.barkAt = now + 2.5 + Math.random() * 5;
          bark(w.pos);
        }
        const flash = Math.max(0, 1 - (now - w.hitT) / 0.18) * 0.8;
        draw(w.kind, w.pos, w.yaw, { phase: w.phase, walk: w.walk, bite: w.bite, roll: 0, scale: 1, flash, now, seed: w.seed });
      }

      // 倒れる → 骨がはねてコインに
      for (let i = dying.length - 1; i >= 0; i--) {
        const d = dying[i];
        if (d.t0 < 0) d.t0 = now;
        const t = now - d.t0;
        if (t < 0.7) {
          const fall = Math.min(1, t / 0.3);
          const shrink = t > 0.45 ? 1 - (t - 0.45) / 0.25 : 1;
          draw(d.kind, d.pos, d.yaw, { phase: 0, walk: 0, bite: 0, roll: (Math.PI / 2) * fall * fall, scale: Math.max(0.01, shrink), flash: Math.max(0, 0.6 - t * 3), now, seed: 0 });
        }
        if (t > 0.45) {
          if (!d.popped) {
            d.popped = true;
            fx.dust(d.pos.clone().setY(0.02), 8, 0.35);
            fx.sparkle(d.pos.clone().setY(0.3), 0xfff1a8, 5, 0.2);
          }
          const u = t - 0.45;
          if (u > 1.1 && u - dt <= 1.1) fx.coins(d.pos.clone().setY(0.35), 3);
          const sc = u < 1.1 ? Math.min(1, u / 0.15) : Math.max(0, 1 - (u - 1.1) / 0.3);
          bones.push(O.compose(v.copy(d.pos).setY(0.12 + Math.sin(Math.min(1, u / 0.6) * Math.PI) * 0.3), q.setFromEuler(e.set(0.3, u * 5, 0.2)), s.setScalar(Math.max(sc, 1e-3) * 1.4)));
        }
        if (t > 2) dying.splice(i, 1);
      }

      // 船: 沖から舳先を島に向けて来て、接岸で波しぶき。帰りは向きを変えて去る
      const live = new Set<number>();
      for (const bt of raid?.boats ?? []) {
        live.add(bt.id);
        const off = boatOffset(bt);
        const turn = bt.state === 'out' ? THREE.MathUtils.smoothstep(Math.min(1, bt.t / 1.6), 0, 1) : 0;
        const yaw = Math.atan2(-bt.dx, -bt.dy) + Math.PI * turn;
        const pos = v.set(bt.x + 0.5 + bt.dx * off, -0.2 + Math.sin(now * 1.6 + bt.id) * 0.03, bt.y + 0.5 + bt.dy * off);
        boats.push(O.compose(pos, q.setFromEuler(e.set(Math.sin(now * 1.3 + bt.id) * 0.03, yaw, Math.sin(now * 1.1 + bt.id * 2) * 0.05)), s.setScalar(1)));
        let k = docked.get(bt.id);
        if (!k) docked.set(bt.id, (k = { state: bt.state, wake: 0 }));
        const bow = a.set(pos.x - bt.dx * 0.9, -0.2, pos.z - bt.dy * 0.9);
        if (k.state === 'in' && bt.state === 'dock') {
          for (let n = 0; n < 3; n++) fx.splash(bow.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6)));
        }
        k.state = bt.state;
        k.wake -= dt;
        if (bt.state !== 'dock' && k.wake <= 0) {
          k.wake = 0.35;
          fx.ripple(bow.clone().setY(-0.19));
        }
      }
      for (const id of docked.keys()) if (!live.has(id)) docked.delete(id);

      // 飛んでいる弾（水は弧を描く水流、機関銃は曳光弾でまっすぐ、砲弾は高い放物線）
      for (const sh of raid?.shots ?? []) {
        const p = Math.min(1, (sh.t + alpha * 0.1) / sh.dur);
        a.set(sh.x + 0.5, MUZZLE_Y[sh.type] ?? 0.4, sh.y + 0.5);
        b.set(sh.tx + 0.5, 0.18, sh.ty + 0.5);
        const arc = (ARC[sh.type] ?? 0.3) + (sh.type === 'cannon' ? a.distanceTo(b) * 0.1 : 0);
        const at = (u: number, out: THREE.Vector3) => out.lerpVectors(a, b, u).setY(THREE.MathUtils.lerp(a.y, b.y, u) + 4 * u * (1 - u) * arc);
        if (sh.type === 'waterGun') {
          for (let n = 0; n < 9; n++) {
            const u = p - n * 0.05;
            if (u < 0) break;
            drops.push(O.compose(at(u, v), q.identity(), s.setScalar(0.04 * (1 - n * 0.07))));
          }
          continue;
        }
        const pos = at(p, v).clone();
        const ahead = at(Math.min(1, p + 0.02), new THREE.Vector3());
        const yaw = Math.atan2(ahead.x - pos.x, ahead.z - pos.z);
        if (sh.type === 'turret') {
          const pitch = -Math.atan2(ahead.y - pos.y, Math.hypot(ahead.x - pos.x, ahead.z - pos.z));
          tracers.push(O.compose(pos, q.setFromEuler(e.set(pitch, yaw, 0, 'YXZ')), s.setScalar(1)));
          e.order = 'XYZ';
        }
        else items.push('shell', O.compose(pos.setY(pos.y - 0.04), q.setFromEuler(e.set(now * 9, yaw, 0)), s.setScalar(1.5)));
      }
      for (const l of [body, head, legs, tail, bones, boats, drops, tracers]) l.end();
    },
  };
}
