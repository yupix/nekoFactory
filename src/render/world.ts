import * as THREE from 'three';
import { decoGeometries } from './models';
import { rng, shared, toon } from './materials';

/** 敷地の外側に広がる装飾帯の幅（タイル） */
export const RING = 7.5;
const CORNER = 5;

/** 角丸正方形の符号付き距離（外側が正） */
function sdRound(x: number, z: number, half: number, r: number) {
  const qx = Math.abs(x) - half + r;
  const qz = Math.abs(z) - half + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
}

function roundedOutline(half: number, r: number, perCorner = 10) {
  const pts: THREE.Vector2[] = [];
  const corners: [number, number, number][] = [
    [half - r, half - r, 0],
    [-(half - r), half - r, Math.PI / 2],
    [-(half - r), -(half - r), Math.PI],
    [half - r, -(half - r), (Math.PI * 3) / 2],
  ];
  for (const [cx, cz, a0] of corners)
    for (let i = 0; i <= perCorner; i++) {
      const a = a0 + (i / perCorner) * (Math.PI / 2);
      pts.push(new THREE.Vector2(cx + Math.cos(a) * r, cz + Math.sin(a) * r));
    }
  return pts;
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!] as const;
}

function texture(c: HTMLCanvasElement, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** 敷地の芝: タイルごとに少しずつ色が違い、薄い目地が入る */
function siteTexture(n: number) {
  const px = 40;
  const [c, g] = canvas(n * px, n * px);
  const r = rng(n * 7 + 3);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const hue = 92 + (r() - 0.5) * 5;
      const light = 60 + (r() - 0.5) * 2.4 + ((i + j) % 2 ? 0.6 : -0.6);
      g.fillStyle = `hsl(${hue}, 40%, ${light}%)`;
      g.fillRect(i * px, j * px, px, px);
      // 柔らかい濃淡のむら
      for (let k = 0; k < 2; k++) {
        const x = i * px + r() * px;
        const y = j * px + r() * px;
        const rad = 6 + r() * 10;
        const gr = g.createRadialGradient(x, y, 0, x, y, rad);
        gr.addColorStop(0, r() < 0.5 ? 'rgba(255,255,220,0.13)' : 'rgba(70,120,50,0.1)');
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.fillRect(i * px, j * px, px, px);
      }
      // 小さな草の芽（ハの字）
      for (let k = 0; k < 3; k++) {
        const x = i * px + 5 + r() * (px - 10);
        const y = j * px + 6 + r() * (px - 10);
        g.strokeStyle = r() < 0.6 ? 'rgba(80,140,55,0.32)' : 'rgba(215,245,170,0.4)';
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(x - 1.6, y - 2.6);
        g.lineTo(x, y);
        g.lineTo(x + 1.6, y - 2.8);
        g.stroke();
      }
      g.strokeStyle = 'rgba(60,100,40,0.11)';
      g.lineWidth = 1;
      g.strokeRect(i * px + 0.5, j * px + 0.5, px - 1, px - 1);
    }
  const t = texture(c);
  t.magFilter = THREE.LinearFilter;
  return t;
}

/** 外周の野原: 継ぎ目なく繰り返す濃淡のある芝 */
function meadowTexture() {
  const n = 256;
  const [c, g] = canvas(n, n);
  g.fillStyle = 'hsl(96, 40%, 54%)';
  g.fillRect(0, 0, n, n);
  const r = rng(5);
  for (let i = 0; i < 70; i++) {
    const x = r() * n;
    const y = r() * n;
    const rad = 10 + r() * 30;
    const light = r() < 0.5;
    for (const dx of [-n, 0, n])
      for (const dy of [-n, 0, n]) {
        const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
        gr.addColorStop(0, light ? 'rgba(190,230,120,0.22)' : 'rgba(60,120,50,0.18)');
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
      }
  }
  for (let i = 0; i < 900; i++) {
    const x = r() * n;
    const y = r() * n;
    g.strokeStyle = r() < 0.5 ? 'rgba(60,120,45,0.35)' : 'rgba(210,245,160,0.3)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (r() - 0.5) * 3, y - 3 - r() * 4);
    g.stroke();
  }
  return texture(c, true);
}

/** 敷地の門の看板 */
function signTexture() {
  const [c, g] = canvas(512, 160);
  g.fillStyle = '#fff6e6';
  g.beginPath();
  g.roundRect(8, 8, 496, 144, 40);
  g.fill();
  g.lineWidth = 10;
  g.strokeStyle = '#c8956a';
  g.stroke();
  g.fillStyle = '#5a3d2b';
  g.font = '900 84px "M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Yu Gothic UI", "Meiryo", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('ねこ工場', 280, 84);
  // 猫の顔
  g.fillStyle = '#f0a050';
  g.beginPath();
  g.arc(78, 88, 34, 0, Math.PI * 2);
  g.moveTo(50, 70);
  g.lineTo(52, 36);
  g.lineTo(76, 58);
  g.moveTo(106, 70);
  g.lineTo(104, 36);
  g.lineTo(80, 58);
  g.fill();
  g.fillStyle = '#3a2a20';
  for (const x of [66, 90]) {
    g.beginPath();
    g.ellipse(x, 86, 4, 6, 0, 0, Math.PI * 2);
    g.fill();
  }
  return texture(c);
}

const SEA_VERT = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const SEA_FRAG = /* glsl */ `
uniform float uTime;
uniform float uHalf;
uniform float uCorner;
uniform float uFade0;
uniform float uFade1;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform vec3 uSun;
varying vec3 vW;
float sdRound(vec2 p, float b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec2 p = vW.xz;
  float shore = sdRound(p, uHalf, uCorner) - 0.75;
  float n = noise(p * 0.5 + vec2(uTime * 0.11, uTime * 0.07)) * 0.6 + noise(p * 1.3 - vec2(uTime * 0.09, -uTime * 0.12)) * 0.4;
  vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 10.0, shore + n * 1.5));
  col *= 0.9 + 0.2 * n;
  float sp = noise(p * 3.2 + vec2(uTime * 0.5, uTime * 0.35)) * noise(p * 2.1 - uTime * 0.3);
  col += uSun * smoothstep(0.66, 0.92, sp) * 0.22;
  float edge = 1.0 - smoothstep(0.0, 0.3 + 0.25 * n, shore);
  float wave = smoothstep(0.86, 1.0, sin(shore * 2.6 - uTime * 1.4 + n * 2.5)) * (1.0 - smoothstep(0.4, 3.2, shore));
  float foam = clamp(max(edge, wave * 0.8), 0.0, 1.0);
  col = mix(col, uFoam, foam);
  float alpha = mix(0.62, 0.95, smoothstep(0.0, 2.5, shore));
  alpha = max(alpha, foam);
  alpha *= 1.0 - smoothstep(uFade0, uFade1, length(p));
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const POND_VERT = /* glsl */ `
varying vec3 vW;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 w = vec4(position, 1.0);
  #ifdef USE_INSTANCING
  w = instanceMatrix * w;
  #endif
  w = modelMatrix * w;
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const POND_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uSun;
varying vec3 vW;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec2 p = vW.xz * 9.0;
  float n = noise(p + vec2(uTime * 0.8, uTime * 0.5)) * 0.5 + noise(p * 1.7 - uTime * 0.6) * 0.5;
  vec2 e = abs(vUv - 0.5) * 2.0;
  float edge = max(e.x, e.y);
  vec3 col = mix(uDeep, uShallow, smoothstep(0.35, 1.0, edge) * 0.7 + n * 0.25);
  col += uSun * smoothstep(0.72, 0.9, n) * 0.4;
  col = mix(col, vec3(0.92, 0.98, 1.0), smoothstep(0.86, 0.98, edge + n * 0.05) * 0.8);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export const pondMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uTime: shared.uTime,
    uDeep: { value: new THREE.Color(0x2f8fbf) },
    uShallow: { value: new THREE.Color(0x7fd6e8) },
    uSun: { value: new THREE.Color(0xffffff) },
  },
  vertexShader: POND_VERT,
  fragmentShader: POND_FRAG,
});

/** 島（敷地・野原・砂浜）、海、柵と門、外周の装飾、遠景の雲 */
export function createWorld(scene: THREE.Scene) {
  const deco = decoGeometries();
  const meadow = meadowTexture();
  const sign = signTexture();

  const sea = new THREE.Mesh(
    new THREE.CircleGeometry(1, 96).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      uniforms: {
        uTime: shared.uTime,
        uHalf: { value: 10 },
        uCorner: { value: CORNER },
        uFade0: { value: 40 },
        uFade1: { value: 80 },
        uDeep: { value: new THREE.Color(0x2f8fc4) },
        uShallow: { value: new THREE.Color(0x8fe3e6) },
        uFoam: { value: new THREE.Color(0xffffff) },
        uSun: { value: new THREE.Color(0xffffff) },
      },
      vertexShader: SEA_VERT,
      fragmentShader: SEA_FRAG,
      transparent: true,
      depthWrite: false,
    }),
  );
  sea.position.y = -0.22;
  sea.renderOrder = -1;
  scene.add(sea);
  const seaU = (sea.material as THREE.ShaderMaterial).uniforms;

  // 遠景の雲（島の外の上空をゆっくり周回する）
  const cloudMat = toon({ color: 0xffffff, rim: 0.35, cloud: false });
  cloudMat.emissive.set(0x5d6878);
  const clouds = new THREE.InstancedMesh(deco.cloud, cloudMat, 10);
  clouds.frustumCulled = false;
  scene.add(clouds);
  const cr = rng(99);
  const cloudData = Array.from({ length: 10 }, (_, i) => ({ a: (i / 10) * Math.PI * 2 + cr() * 0.4, d: cr(), y: 3.5 + cr() * 4, s: 0.9 + cr() * 0.9, spin: cr() * 6 }));

  let group: THREE.Group | null = null;
  let half = 0;
  /** 画質「低」: 雲と外周の装飾を半分にする */
  let lite = false;
  function applyLite() {
    clouds.count = lite ? cloudData.length / 2 : cloudData.length;
    group?.traverse((o) => {
      if (o instanceof THREE.InstancedMesh && o.userData.full) o.count = lite ? Math.ceil(o.userData.full / 2) : o.userData.full;
    });
  }

  const keep = new Set<unknown>([...Object.values(deco), meadow, sign]);
  function dispose(o: THREE.Object3D) {
    o.traverse((m) => {
      if (!(m instanceof THREE.Mesh)) return;
      if (!keep.has(m.geometry)) m.geometry.dispose();
      const mat = m.material as THREE.MeshToonMaterial;
      if (mat.map && !keep.has(mat.map)) mat.map.dispose();
      mat.dispose();
      if (m instanceof THREE.InstancedMesh) m.dispose();
    });
  }

  /** 島が広がるとき: 新しい島を水中からせり上げ、上がりきったら古い島を外す */
  let rising: { group: THREE.Group; old: THREE.Group; t: number; from: number; to: number } | null = null;

  function build(n: number) {
    group = new THREE.Group();
    const h = n / 2;
    half = h + RING;

    // 敷地の芝
    const siteMat = toon({ map: siteTexture(n) });
    const site = new THREE.Mesh(new THREE.PlaneGeometry(n, n).rotateX(-Math.PI / 2), siteMat);
    site.receiveShadow = true;
    group.add(site);

    // 野原（敷地の部分は穴）
    const shape = new THREE.Shape(roundedOutline(half, CORNER));
    shape.holes.push(new THREE.Path([new THREE.Vector2(-h, -h), new THREE.Vector2(h, -h), new THREE.Vector2(h, h), new THREE.Vector2(-h, h)]));
    meadow.repeat.set(0.25, 0.25);
    const land = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2), toon({ map: meadow }));
    land.receiveShadow = true;
    group.add(land);

    // 砂浜から水中へ下る帯
    const rings: [number, number, number][] = [
      [0, 0, 0x8fca63],
      [0.25, -0.02, 0xe9d9a4],
      [1.0, -0.18, 0xf1e0ad],
      [1.8, -0.42, 0xd9c48e],
      [3.6, -1.2, 0x7fb3a6],
    ];
    const outlines = rings.map(([off]) => roundedOutline(half + off, CORNER + off));
    const verts: number[] = [];
    const cols: number[] = [];
    const idx: number[] = [];
    const col = new THREE.Color();
    const per = outlines[0].length;
    outlines.forEach((ring, k) => {
      col.set(rings[k][2]);
      for (const p of ring) {
        verts.push(p.x, rings[k][1], p.y);
        cols.push(col.r, col.g, col.b);
      }
    });
    for (let k = 0; k < rings.length - 1; k++)
      for (let i = 0; i < per; i++) {
        const j = (i + 1) % per;
        const a = k * per;
        const b = (k + 1) * per;
        idx.push(a + i, b + j, b + i, a + i, a + j, b + j);
      }
    const beachGeo = new THREE.BufferGeometry();
    beachGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    beachGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    beachGeo.setIndex(idx);
    beachGeo.computeVertexNormals();
    const beach = new THREE.Mesh(beachGeo, toon({ vertexColors: true, side: THREE.DoubleSide }));
    beach.receiveShadow = true;
    group.add(beach);

    // 柵と門（門は手前の辺の中央）
    const posts: THREE.Vector3[] = [];
    const rails: { x: number; z: number; ry: number }[] = [];
    const gate = (x: number, z: number) => z === h && Math.abs(x) < 1.01;
    for (let i = -h; i <= h; i++) {
      for (const z of [-h, h]) if (!gate(i, z)) posts.push(new THREE.Vector3(i, 0, z));
      if (i > -h && i < h) for (const x of [-h, h]) posts.push(new THREE.Vector3(x, 0, i));
    }
    for (let i = -h; i < h; i++) {
      for (const z of [-h, h]) if (!(gate(i, z) && gate(i + 1, z))) rails.push({ x: i + 0.5, z, ry: 0 });
      for (const x of [-h, h]) rails.push({ x, z: i + 0.5, ry: Math.PI / 2 });
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const fenceMat = toon({ vertexColors: true });
    const postMesh = new THREE.InstancedMesh(deco.post, fenceMat, posts.length);
    posts.forEach((p, i) => postMesh.setMatrixAt(i, m.makeTranslation(p.x, 0, p.z)));
    const railMesh = new THREE.InstancedMesh(deco.rail, fenceMat, rails.length * 2);
    rails.forEach((r, i) => {
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, r.ry);
      for (const [k, y] of [0.13, 0.25].entries()) railMesh.setMatrixAt(i * 2 + k, m.compose(new THREE.Vector3(r.x, y, r.z), q, one));
    });
    for (const im of [postMesh, railMesh]) {
      im.castShadow = im.receiveShadow = true;
      group.add(im);
    }
    // 門柱・横木・看板
    const gateGeo = new THREE.CylinderGeometry(0.07, 0.08, 1.1, 10);
    const gateMat = toon({ color: 0xb87d52 });
    for (const x of [-1.05, 1.05]) {
      const p = new THREE.Mesh(gateGeo, gateMat);
      p.position.set(x, 0.55, h);
      p.castShadow = true;
      group.add(p);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), toon({ color: 0xe8505b }));
      knob.position.set(x, 1.13, h);
      knob.castShadow = true;
      group.add(knob);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.1, 0.1), gateMat);
    beam.position.set(0, 1.0, h);
    beam.castShadow = true;
    group.add(beam);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.5), toon({ map: sign, side: THREE.DoubleSide, rim: 0 }));
    board.position.set(0, 0.72, h + 0.06);
    board.castShadow = true;
    group.add(board);

    // 外周の装飾
    const r = rng(n * 13 + 1);
    const inRing = (x: number, z: number, margin: number) => {
      const out = sdRound(x, z, half, CORNER);
      return Math.max(Math.abs(x), Math.abs(z)) > h + 0.6 + margin && out < -0.5 - margin;
    };
    const bigs: [number, number, number][] = [];
    const free = (x: number, z: number, rad: number) => bigs.every(([bx, bz, br]) => Math.hypot(bx - x, bz - z) > br + rad) && !(Math.abs(x) < 1.6 && z > h);
    const area = (2 * half) ** 2 - n * n;
    type Inst = { x: number; z: number; s: number; ry: number; c: THREE.Color };
    const place = (count: number, rad: number, margin: number, tint: () => THREE.Color, scale: () => number) => {
      const out: Inst[] = [];
      for (let t = 0; t < count * 30 && out.length < count; t++) {
        const x = (r() * 2 - 1) * half;
        const z = (r() * 2 - 1) * half;
        const s = scale();
        if (!inRing(x, z, rad * s * 0.5) || !free(x, z, rad * s)) continue;
        if (rad > 0.15) bigs.push([x, z, rad * s]);
        out.push({ x, z, s, ry: r() * Math.PI * 2, c: tint() });
      }
      return out;
    };
    const greenTint = () => new THREE.Color().setHSL(0, 0, 1).multiplyScalar(0.88 + r() * 0.24);
    const groups: [THREE.BufferGeometry, Inst[], number][] = [
      [deco.tree, place(Math.round(area / 15), 0.5, 0.3, greenTint, () => 0.75 + r() * 0.5), 0.012],
      [deco.pine, place(Math.round(area / 30), 0.45, 0.3, greenTint, () => 0.8 + r() * 0.5), 0.008],
      [deco.bush, place(Math.round(area / 14), 0.3, 0.1, greenTint, () => 0.7 + r() * 0.6), 0.03],
      [deco.rock, place(Math.round(area / 35), 0.3, 0.1, () => new THREE.Color(1, 1, 1).multiplyScalar(0.9 + r() * 0.2), () => 0.6 + r() * 0.9), 0],
      [deco.mushroom, place(Math.round(area / 45), 0.08, 0, () => new THREE.Color(1, 1, 1), () => 0.8 + r() * 0.6), 0],
      [deco.tuft, place(Math.round(area / 2.5), 0.05, -0.2, greenTint, () => 0.7 + r() * 0.8), 0.6],
    ];
    // 花は群生させる
    const flowers: Inst[] = [];
    const palette = [0xff8fb3, 0xffffff, 0xffd447, 0xb79af0, 0xff6f6f, 0x8fd0ff];
    for (let p = 0; p < area / 14; p++) {
      const cx = (r() * 2 - 1) * half;
      const cz = (r() * 2 - 1) * half;
      if (!inRing(cx, cz, 0)) continue;
      const c = new THREE.Color(palette[Math.floor(r() * palette.length)]);
      for (let k = 0; k < 9; k++) {
        const x = cx + (r() - 0.5) * 1.4;
        const z = cz + (r() - 0.5) * 1.4;
        if (inRing(x, z, 0) && free(x, z, 0.02)) flowers.push({ x, z, s: 0.8 + r() * 0.5, ry: r() * 6, c });
      }
    }
    groups.push([deco.petals, flowers, 0.9], [deco.stem, flowers, 0.9]);
    const e = new THREE.Euler();
    for (const [geo, list, wind] of groups) {
      if (!list.length) continue;
      const tinted = geo !== deco.stem;
      const mat = toon({ vertexColors: true, wind: wind || undefined });
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((it, i) => {
        im.setMatrixAt(i, m.compose(new THREE.Vector3(it.x, 0, it.z), q.setFromEuler(e.set(0, it.ry, 0)), new THREE.Vector3(it.s, it.s, it.s)));
        if (tinted) im.setColorAt(i, it.c);
      });
      im.userData.full = list.length;
      im.castShadow = geo !== deco.tuft && geo !== deco.petals && geo !== deco.stem;
      im.receiveShadow = true;
      group.add(im);
    }

    scene.add(group);
    applyLite();
    seaU.uHalf.value = half;
    seaU.uFade0.value = half + 4;
    seaU.uFade1.value = half + 19;
    sea.scale.setScalar(half + 21);
  }

  const cm = new THREE.Matrix4();
  const cq = new THREE.Quaternion();
  const cs = new THREE.Vector3();
  const cp = new THREE.Vector3();
  return {
    setSize(n: number) {
      if (n / 2 + RING === half) return;
      const old = group;
      const from = half;
      if (rising) {
        scene.remove(rising.old);
        dispose(rising.old);
        rising.group.position.y = 0;
      }
      build(n);
      if (old && half > from) {
        rising = { group: group!, old, t: 0, from, to: half };
        group!.position.y = -1.3;
        seaU.uHalf.value = from;
      } else if (old) {
        scene.remove(old);
        dispose(old);
      }
    },
    set lite(on: boolean) {
      lite = on;
      applyLite();
    },
    /** 島の半径（装飾帯込み） */
    get half() {
      return half;
    },
    /** せり上がり中の揺れの強さ（0〜1） */
    get shake() {
      return rising ? Math.sin(Math.min(1, rising.t) * Math.PI) : 0;
    },
    update(time: number, sunColor: THREE.Color, dt = 0) {
      if (rising) {
        rising.t += dt / 2.2;
        const t = Math.min(1, rising.t);
        rising.group.position.y = -1.3 * (1 - t) ** 3;
        seaU.uHalf.value = THREE.MathUtils.lerp(rising.from, rising.to, 1 - (1 - t) ** 3);
        if (t >= 1) {
          scene.remove(rising.old);
          dispose(rising.old);
          rising.group.position.y = 0;
          rising = null;
        }
      }
      (seaU.uSun.value as THREE.Color).copy(sunColor);
      (pondMaterial.uniforms.uSun.value as THREE.Color).copy(sunColor);
      cloudData.forEach((c, i) => {
        const a = c.a + time * 0.004;
        const d = half + 4 + c.d * 12;
        cp.set(Math.cos(a) * d, c.y, Math.sin(a) * d);
        cq.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, c.spin + time * 0.01);
        clouds.setMatrixAt(i, cm.compose(cp, cq, cs.setScalar(c.s)));
      });
      clouds.instanceMatrix.needsUpdate = true;
    },
  };
}
