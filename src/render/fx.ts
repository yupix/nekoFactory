import * as THREE from 'three';
import type { ItemId } from '../sim/data';
import { Layer, type Items } from './layer';
import { toon } from './materials';

/** カメラに正対する板（ビルボード）の頂点シェーダー。インスタンス行列の平行移動と拡大だけを使う */
export const BILLBOARD_VERT = /* glsl */ `
varying vec2 vUv;
vec3 billboard(vec2 xy) {
  vec3 c = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float s = length(instanceMatrix[0].xyz);
  #ifdef NK_SCREEN_SIZE
  s *= clamp(length(cameraPosition - c) / 18.0, 0.5, 1.35);
  #endif
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  return c + (right * xy.x + up * xy.y) * s;
}
`;

function glowTexture() {
  const n = 64;
  const c = document.createElement('canvas');
  c.width = n * 2;
  c.height = n;
  const g = c.getContext('2d')!;
  // 左: 4 本光の星、右: 丸い光
  const star = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  star.addColorStop(0, 'rgba(255,255,255,1)');
  star.addColorStop(0.25, 'rgba(255,255,255,0.5)');
  star.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = star;
  g.fillRect(0, 0, n, n);
  g.fillStyle = '#fff';
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const r = i % 2 ? 5 : 30;
    g.lineTo(n / 2 + Math.cos(a) * r, n / 2 + Math.sin(a) * r);
  }
  g.fill();
  const soft = g.createRadialGradient(n * 1.5, n / 2, 0, n * 1.5, n / 2, n / 2);
  soft.addColorStop(0, 'rgba(255,255,255,1)');
  soft.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  soft.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = soft;
  g.fillRect(n, 0, n, n);
  return new THREE.CanvasTexture(c);
}

/** 柔らかいスプライトのアトラス: 0 煙・土煙の丸 / 1 寝息の Z / 2 ハート / 3 「…」の吹き出し */
function softTexture() {
  const n = 64;
  const c = document.createElement('canvas');
  c.width = n * 4;
  c.height = n;
  const g = c.getContext('2d')!;
  const base = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  base.addColorStop(0, 'rgba(255,255,255,1)');
  base.addColorStop(0.62, 'rgba(255,255,255,0.92)');
  base.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = base;
  g.fillRect(0, 0, n, n);
  g.globalCompositeOperation = 'source-atop';
  const shade = g.createLinearGradient(0, 8, 0, n - 6);
  shade.addColorStop(0, 'rgba(255,255,255,0)');
  shade.addColorStop(1, 'rgba(150,140,150,0.55)');
  g.fillStyle = shade;
  g.fillRect(0, 0, n, n);
  g.globalCompositeOperation = 'source-over';
  // Z（白い縁取りの紺色）
  g.font = '900 50px "M PLUS Rounded 1c", "Arial Rounded MT Bold", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 10;
  g.strokeStyle = '#ffffff';
  g.strokeText('Z', n * 1.5, n / 2 + 2);
  g.fillStyle = '#5a6fb0';
  g.fillText('Z', n * 1.5, n / 2 + 2);
  // ハート
  g.save();
  g.translate(n * 2.5, n / 2 + 4);
  g.beginPath();
  g.moveTo(0, 18);
  g.bezierCurveTo(-30, -2, -18, -26, 0, -12);
  g.bezierCurveTo(18, -26, 30, -2, 0, 18);
  g.lineWidth = 6;
  g.strokeStyle = '#ffffff';
  g.stroke();
  g.fillStyle = '#ffffff';
  g.fill();
  g.restore();
  // 「…」の吹き出し（白い丸に、しっぽと灰色の 3 点）
  g.save();
  g.translate(n * 3.5, n / 2);
  g.beginPath();
  g.ellipse(0, -4, 27, 20, 0, 0, Math.PI * 2);
  g.moveTo(-8, 12);
  g.lineTo(-16, 27);
  g.lineTo(4, 14);
  g.fillStyle = '#ffffff';
  g.fill();
  g.fillStyle = '#6a7080';
  for (const x of [-12, 0, 12]) {
    g.beginPath();
    g.arc(x, -3, 4.2, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  return new THREE.CanvasTexture(c);
}

type Kind = 'smoke' | 'dust' | 'drop' | 'ripple' | 'spark' | 'glow' | 'coin' | 'zzz' | 'heart' | 'dots';
interface P {
  kind: Kind;
  p: THREE.Vector3;
  v: THREE.Vector3;
  age: number;
  life: number;
  size: number;
  spin: number;
  rot: number;
  color: THREE.Color;
}
interface Fly {
  id: ItemId;
  from: THREE.Vector3;
  to: THREE.Vector3;
  age: number;
  dur: number;
  arc: number;
  scale: number;
  spin: number;
  done?: () => void;
}

const GRAV: Record<Kind, number> = { smoke: 0, dust: 0, drop: -6, ripple: 0, spark: 0, glow: 0, coin: -7.5, zzz: 0, heart: 0, dots: 0 };
const DRAG: Record<Kind, number> = { smoke: 0.6, dust: 4, drop: 0.2, ripple: 0, spark: 1.5, glow: 1.2, coin: 0.4, zzz: 0.3, heart: 1.2, dots: 2 };

/** 煙・土煙・水しぶき・波紋・キラキラ・コイン・飛んでいくアイテム */
export function createFx(parent: THREE.Object3D, items: Items, noAO: (o: THREE.Object3D) => void) {
  const blob = new THREE.SphereGeometry(1, 10, 8);
  const puffs = new Layer(parent, blob, toon({ color: 0xffffff, rim: 0.3 }), 128, { color: true });
  const ring = new THREE.RingGeometry(0.82, 1, 32).rotateX(-Math.PI / 2);
  const ripples = new Layer(parent, ring, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 32, { color: true, renderOrder: 3 });
  const spriteMat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: glowTexture() } },
    vertexShader: `${BILLBOARD_VERT}
      attribute vec2 aSprite;
      varying vec3 vCol;
      varying float vKind;
      void main() {
        vUv = uv;
        vKind = aSprite.y;
        vCol = vec3(1.0);
        #ifdef USE_INSTANCING_COLOR
        vCol = instanceColor;
        #endif
        float c = cos(aSprite.x), s = sin(aSprite.x);
        vec2 xy = mat2(c, s, -s, c) * position.xy;
        gl_Position = projectionMatrix * viewMatrix * vec4(billboard(xy), 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D uTex;
      varying vec2 vUv;
      varying vec3 vCol;
      varying float vKind;
      void main() {
        vec4 t = texture2D(uTex, vec2(vUv.x * 0.5 + vKind * 0.5, vUv.y));
        gl_FragColor = vec4(vCol * t.r, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const sprites = new Layer(parent, new THREE.PlaneGeometry(1, 1), spriteMat, 128, { color: true, attrs: { aSprite: 2 }, renderOrder: 4 });
  const softMat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: softTexture() } },
    vertexShader: `${BILLBOARD_VERT}
      attribute vec3 aSprite;
      varying vec3 vCol;
      varying float vAlpha;
      void main() {
        vUv = vec2((uv.x + aSprite.z) / 4.0, uv.y);
        vAlpha = aSprite.y;
        vCol = vec3(1.0);
        #ifdef USE_INSTANCING_COLOR
        vCol = instanceColor;
        #endif
        float c = cos(aSprite.x), s = sin(aSprite.x);
        gl_Position = projectionMatrix * viewMatrix * vec4(billboard(mat2(c, s, -s, c) * position.xy), 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D uTex;
      varying vec2 vUv;
      varying vec3 vCol;
      varying float vAlpha;
      void main() {
        vec4 t = texture2D(uTex, vUv);
        gl_FragColor = vec4(vCol * t.rgb, t.a * vAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
  });
  const soft = new Layer(parent, new THREE.PlaneGeometry(1, 1), softMat, 128, { color: true, attrs: { aSprite: 3 }, renderOrder: 3 });
  noAO(soft.mesh);
  const coinGeo = new THREE.CylinderGeometry(1, 1, 0.22, 18).rotateX(Math.PI / 2);
  const coinMat = toon({ color: 0xffc83d, rim: 0.4 });
  coinMat.emissive.set(0x7a4a00);
  const coins = new Layer(parent, coinGeo, coinMat, 64, { shadow: true });
  for (const l of [ripples, sprites]) noAO(l.mesh);

  const list: P[] = [];
  const flies: Fly[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const e = new THREE.Euler();
  const c = new THREE.Color();
  const fs = new THREE.Vector3();
  const rand = (a: number, b: number) => a + Math.random() * (b - a);

  function add(kind: Kind, p: THREE.Vector3, v: THREE.Vector3, life: number, size: number, color: number) {
    if (list.length > 600) return;
    list.push({ kind, p: p.clone(), v, age: 0, life, size, spin: rand(-3, 3), rot: rand(0, 6.28), color: new THREE.Color(color) });
  }

  const api = {
    smoke(p: THREE.Vector3, tint = 0xf4f1ec) {
      add('smoke', p, new THREE.Vector3(rand(0.03, 0.09), rand(0.3, 0.38), rand(-0.03, 0.03)), rand(1.9, 2.4), rand(0.11, 0.14), tint);
    },
    dust(p: THREE.Vector3, n = 10, r = 0.45) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rand(0, 0.5);
        const o = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        add('dust', p.clone().addScaledVector(o, r * 0.6).setY(p.y + 0.06), o.multiplyScalar(rand(0.6, 1.0)).setY(rand(0.15, 0.35)), rand(0.55, 0.85), rand(0.16, 0.24), 0xeadfca);
      }
    },
    splash(p: THREE.Vector3) {
      for (let i = 0; i < 9; i++) {
        const a = rand(0, Math.PI * 2);
        add('drop', p, new THREE.Vector3(Math.cos(a) * rand(0.2, 0.5), rand(1.0, 1.6), Math.sin(a) * rand(0.2, 0.5)), rand(0.45, 0.6), rand(0.014, 0.024), 0xcff3ff);
      }
      api.ripple(p);
      api.ripple(p, 0.25);
    },
    ripple(p: THREE.Vector3, delay = 0) {
      add('ripple', p, new THREE.Vector3(), 1.0 + delay, 0.3, 0xffffff);
      list[list.length - 1].age = -delay;
    },
    sparkle(p: THREE.Vector3, color = 0xfff1a8, n = 1, spread = 0.3) {
      for (let i = 0; i < n; i++)
        add('spark', p.clone().add(new THREE.Vector3(rand(-spread, spread), rand(-spread, spread) * 0.6, rand(-spread, spread))), new THREE.Vector3(0, rand(0.15, 0.4), 0), rand(0.6, 1.0), rand(0.05, 0.09), color);
    },
    /** 寝息の Z */
    zzz(p: THREE.Vector3) {
      add('zzz', p, new THREE.Vector3(rand(0.08, 0.14), rand(0.22, 0.3), rand(-0.04, 0.04)), 1.8, 0.11, 0xffffff);
      list[list.length - 1].rot = rand(-0.3, 0.1);
      list[list.length - 1].spin = rand(-0.4, 0.4);
    },
    /** 落ち込んだ猫の頭上の「…」 */
    dots(p: THREE.Vector3) {
      add('dots', p, new THREE.Vector3(0, 0.12, 0), 1.5, 0.17, 0xffffff);
      list[list.length - 1].rot = 0;
      list[list.length - 1].spin = 0;
    },
    /** 撫でたときのハート */
    hearts(p: THREE.Vector3, n = 5) {
      for (let i = 0; i < n; i++) {
        add('heart', p, new THREE.Vector3(rand(-0.35, 0.35), rand(0.5, 0.9), rand(-0.35, 0.35)), rand(0.9, 1.3), rand(0.09, 0.13), [0xff7fa3, 0xff9fbf, 0xffb3cf][i % 3]);
        list[list.length - 1].rot = rand(-0.4, 0.4);
        list[list.length - 1].spin = rand(-1, 1);
      }
    },
    glow(p: THREE.Vector3, color: number, size = 0.5) {
      add('glow', p, new THREE.Vector3(0, 0.1, 0), 0.5, size, color);
    },
    coins(p: THREE.Vector3, n: number) {
      for (let i = 0; i < n; i++) {
        const a = rand(0, Math.PI * 2);
        add('coin', p, new THREE.Vector3(Math.cos(a) * rand(0.3, 0.7), rand(1.8, 2.5), Math.sin(a) * rand(0.3, 0.7)), rand(0.75, 0.95), 0.055, 0xffffff);
      }
      api.glow(p, 0xffd34d, 0.3);
    },
    /** アイテムを放物線で飛ばす */
    fly(id: ItemId, from: THREE.Vector3, to: THREE.Vector3, dur = 0.55, arc = 0.45, scale = 0.8, done?: () => void) {
      flies.push({ id, from: from.clone(), to: to.clone(), age: 0, dur, arc, scale, spin: rand(-6, 6), done });
    },
    update(dt: number) {
      puffs.begin();
      soft.begin();
      ripples.begin();
      sprites.begin();
      coins.begin();
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        p.age += dt;
        if (p.age >= p.life) {
          list.splice(i, 1);
          continue;
        }
        if (p.age < 0) continue;
        const t = p.age / p.life;
        p.v.y += GRAV[p.kind] * dt;
        p.v.multiplyScalar(Math.exp(-DRAG[p.kind] * dt));
        p.p.addScaledVector(p.v, dt);
        p.rot += p.spin * dt;
        switch (p.kind) {
          case 'smoke':
          case 'dust': {
            const grow = p.kind === 'smoke' ? 0.6 + 1.5 * Math.sqrt(t) : 0.7 + 0.8 * t;
            const i2 = soft.push(m.compose(p.p, q.identity(), s.setScalar(p.size * grow)));
            soft.set('aSprite', i2, p.rot * 0.3, Math.min(1, t * 6) * (1 - t) ** 1.4 * (p.kind === 'smoke' ? 0.9 : 0.8), 0);
            soft.color(i2, c.copy(p.color).multiplyScalar(p.kind === 'smoke' ? 1 - 0.12 * t : 1));
            break;
          }
          case 'zzz':
          case 'heart':
          case 'dots': {
            const grow = p.kind === 'zzz' ? 0.6 + 0.9 * t : p.kind === 'dots' ? Math.min(1, 0.5 + t * 6) : 0.7 + 0.5 * Math.sin(Math.min(1, t * 3) * Math.PI * 0.5);
            const i2 = soft.push(m.compose(p.p, q.identity(), s.setScalar(p.size * grow)));
            soft.set('aSprite', i2, p.rot, Math.min(1, t * 5) * (1 - t ** 4), p.kind === 'zzz' ? 1 : p.kind === 'heart' ? 2 : 3);
            soft.color(i2, p.color);
            break;
          }
          case 'drop': {
            const sc = p.size * Math.min(1, t * 8) * (t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1);
            const i2 = puffs.push(m.compose(p.p, q.identity(), s.setScalar(Math.max(sc, 1e-4))));
            puffs.color(i2, p.color);
            break;
          }
          case 'ripple': {
            const i2 = ripples.push(m.compose(p.p, q.identity(), s.setScalar(0.05 + p.size * t)));
            ripples.color(i2, c.copy(p.color).multiplyScalar(0.6 * (1 - t)));
            break;
          }
          case 'spark':
          case 'glow': {
            const sc = p.size * Math.sin(Math.min(1, t) * Math.PI) * (p.kind === 'glow' ? 1 + 0.5 * t : 1);
            const i2 = sprites.push(m.compose(p.p, q.identity(), s.setScalar(Math.max(sc, 1e-4))));
            sprites.set('aSprite', i2, p.rot, p.kind === 'spark' ? 0 : 1);
            sprites.color(i2, c.copy(p.color).multiplyScalar(p.kind === 'spark' ? 1.1 : 0.45 * (1 - t)));
            break;
          }
          case 'coin': {
            if (p.p.y < 0.1) {
              p.p.y = 0.1;
              p.v.y = Math.abs(p.v.y) * 0.35;
            }
            const sc = p.size * (t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1);
            coins.push(m.compose(p.p, q.setFromEuler(e.set(0.3, p.rot * 2.5, 0)), s.setScalar(Math.max(sc, 1e-4))));
            break;
          }
        }
      }
      for (let i = flies.length - 1; i >= 0; i--) {
        const f = flies[i];
        f.age += dt;
        const t = Math.min(1, f.age / f.dur);
        const pos = s.lerpVectors(f.from, f.to, t);
        pos.y += Math.sin(t * Math.PI) * f.arc;
        const pop = t < 0.15 ? 0.6 + (t / 0.15) * 0.5 : 1.1 - 0.1 * t;
        items.push(f.id, m.compose(pos, q.setFromEuler(e.set(0, f.spin * t, 0)), fs.setScalar(f.scale * pop)));
        if (t >= 1) {
          flies.splice(i, 1);
          f.done?.();
        }
      }
      puffs.end();
      soft.end();
      ripples.end();
      sprites.end();
      coins.end();
    },
  };
  return api;
}
export type Fx = ReturnType<typeof createFx>;
