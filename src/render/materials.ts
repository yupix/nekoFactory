import * as THREE from 'three';

/** 決定的な乱数（装飾配置や毛柄の種に使う） */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 猫の頭モデルで目の中心の高さ（まばたきで縮む中心） */
export const EYE_Y = 0.07;

function cloudTexture() {
  const n = 256;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, n, n);
  const r = rng(11);
  for (let i = 0; i < 6; i++) {
    const cx = r() * n;
    const cy = r() * n;
    for (let j = 0; j < 7; j++) {
      const x = cx + (r() - 0.5) * 70;
      const y = cy + (r() - 0.5) * 34;
      const rad = 12 + r() * 20;
      // 端で繰り返しても継ぎ目が出ないよう 9 方向に描く
      for (const dx of [-n, 0, n])
        for (const dy of [-n, 0, n]) {
          const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
          gr.addColorStop(0, 'rgba(255,255,255,0.85)');
          gr.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = gr;
          g.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
        }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** トゥーンの陰影段階（柔らかい 2 階調） */
const GRADIENT = (() => {
  const n = 32;
  const d = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    const t = THREE.MathUtils.smoothstep(x, 0.4, 0.6);
    const v = 0.45 + 0.55 * t;
    d.set([v * 255, v * 255, v * 255, 255], i * 4);
  }
  const t = new THREE.DataTexture(d, n, 1);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
})();

/** 全マテリアルで共有する uniform */
export const shared = {
  uTime: { value: 0 },
  uCloudTex: { value: cloudTexture() },
  uCloudOffset: { value: new THREE.Vector2() },
  uCloudStrength: { value: 0.3 },
  uEvening: { value: 0 },
  uRimColor: { value: new THREE.Color(0xfff1dc) },
};

const furUniforms = {
  uCalicoA: { value: new THREE.Color(0xe58a35) },
  uCalicoB: { value: new THREE.Color(0x2b2522) },
  uIrisA: { value: new THREE.Color(0x1b1512) },
  uIrisB: { value: new THREE.Color(0xd8c22a) },
  uMark: { value: new THREE.Color(0xfbf7f0) },
};

export interface MatOpts {
  color?: THREE.ColorRepresentation;
  map?: THREE.Texture | null;
  vertexColors?: boolean;
  transparent?: boolean;
  opacity?: number;
  depthWrite?: boolean;
  side?: THREE.Side;
  /** aFx インスタンス属性: x 停止で色が沈む, y ホバー発光, z 撤去の赤, w 種類ごとの値（発光の脈動・ベルトの位相） */
  fx?: boolean;
  /** glow 頂点属性（窓・液体など、稼働中に光る） */
  glow?: boolean;
  /** aDmg インスタンス属性: x 傷み（ひびの量）, y 故障（黒ずみ） */
  dmg?: boolean;
  /** 風で揺れる強さ */
  wind?: number;
  /** ベルトコンベアの縞（ワールド z 方向に流れる） */
  belt?: boolean;
  /** 猫のパーツ番号（0 胴 1 頭 2 尾 3 脚） */
  fur?: number;
  rim?: number;
  /** 雲の影を受けるか */
  cloud?: boolean;
}

const VERT_DECL = /* glsl */ `
uniform float uTime;
varying vec3 vNkWorld;
#ifdef NK_FX
attribute vec4 aFx;
varying vec4 vFx;
#endif
#ifdef NK_GLOW
attribute float glow;
varying float vGlow;
#endif
#ifdef NK_DMG
attribute vec2 aDmg;
varying vec2 vDmg;
#endif
#ifdef NK_FUR
attribute vec3 aFur;
attribute vec4 aCoat;
attribute vec2 paint;
varying vec3 vFur;
varying vec4 vCoat;
varying vec2 vPaint;
varying vec3 vLocal;
#if NK_FUR == 1
attribute float aBlink;
#endif
#endif
`;

const VERT_BEGIN = /* glsl */ `
#ifdef NK_FUR
vLocal = transformed;
vFur = aFur;
vCoat = aCoat;
vPaint = paint;
#if NK_FUR == 1
if (paint.x > 1.5) transformed.y = NK_EYE_Y + (transformed.y - NK_EYE_Y) * (1.0 - 0.9 * aBlink);
#endif
#endif
#ifdef NK_FX
vFx = aFx;
#endif
#ifdef NK_GLOW
vGlow = glow;
#endif
#ifdef NK_DMG
vDmg = aDmg;
#endif
#ifdef NK_WIND
{
  vec3 ip = vec3(0.0);
  #ifdef USE_INSTANCING
  ip = instanceMatrix[3].xyz;
  #endif
  float h = max(transformed.y, 0.0);
  float w = sin(uTime * 1.7 + ip.x * 0.8 + ip.z * 0.6) * 0.7 + sin(uTime * 3.1 + ip.x * 1.7 - ip.z) * 0.3;
  transformed.xz += vec2(w, w * 0.6) * NK_WIND * h * h;
}
#endif
`;

const VERT_WORLD = /* glsl */ `
{
  vec4 nkp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  nkp = instanceMatrix * nkp;
  #endif
  vNkWorld = (modelMatrix * nkp).xyz;
}
`;

const FRAG_DECL = /* glsl */ `
uniform float uTime;
uniform sampler2D uCloudTex;
uniform vec2 uCloudOffset;
uniform float uCloudStrength;
uniform float uEvening;
uniform vec3 uRimColor;
varying vec3 vNkWorld;
#ifdef NK_FX
varying vec4 vFx;
#endif
#ifdef NK_GLOW
varying float vGlow;
#endif
#ifdef NK_DMG
varying vec2 vDmg;
float nkH2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float nkN2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(nkH2(i), nkH2(i + vec2(1, 0)), f.x), mix(nkH2(i + vec2(0, 1)), nkH2(i + vec2(1, 1)), f.x), f.y);
}
#endif
#ifdef NK_FUR
uniform vec3 uCalicoA;
uniform vec3 uCalicoB;
uniform vec3 uIrisA;
uniform vec3 uIrisB;
uniform vec3 uMark;
varying vec3 vFur;
varying vec4 vCoat;
varying vec2 vPaint;
varying vec3 vLocal;
float nkHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float nkNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(nkHash(i), nkHash(i + vec3(1, 0, 0)), f.x), mix(nkHash(i + vec3(0, 1, 0)), nkHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(nkHash(i + vec3(0, 0, 1)), nkHash(i + vec3(1, 0, 1)), f.x), mix(nkHash(i + vec3(0, 1, 1)), nkHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float nkStripe(vec3 p) {
#if NK_FUR == 0
  return sin(p.z * 70.0 + sin(p.x * 30.0) * 1.3) * step(-0.035, p.y);
#elif NK_FUR == 1
  return sin(p.x * 110.0) * step(0.095, p.y) * step(0.0, p.z + 0.02);
#elif NK_FUR == 2
  return sin((p.y - p.z) * 75.0);
#else
  return sin(p.y * 85.0);
#endif
}
#endif
`;

const FRAG_COLOR = /* glsl */ `
#ifdef NK_FUR
{
  vec3 fur = vFur;
  if (vCoat.x > 0.5 && vCoat.x < 1.5) fur = mix(fur, fur * 0.42, smoothstep(0.05, 0.55, nkStripe(vLocal)));
  else if (vCoat.x > 1.5) {
    vec3 q = vLocal * 12.0 + vec3(vCoat.y * 7.3, float(NK_FUR) * 3.1, vCoat.y * 3.9);
    float a = nkNoise(q);
    float b = nkNoise(q * 0.9 + 19.0);
    fur = mix(fur, uCalicoA, smoothstep(0.55, 0.6, a));
    fur = mix(fur, uCalicoB, smoothstep(0.62, 0.67, b));
  }
  fur = mix(fur, uMark, vPaint.y * vCoat.z);
  vec3 c = vColor.rgb;
  if (vPaint.x > 0.5 && vPaint.x < 1.5) c = fur;
  else if (vPaint.x > 1.5 && vPaint.x < 2.5) c = mix(uIrisA, uIrisB, vCoat.w);
  diffuseColor.rgb = c;
}
#endif
#ifdef NK_BELT
diffuseColor.rgb *= mix(0.45, 1.0, step(0.5, fract(vNkWorld.z * 14.0 - vFx.w)));
#endif
#ifdef NK_FX
{
  float l = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(l) * vec3(0.9, 0.94, 1.04), vFx.x * 0.5) * (1.0 - 0.16 * vFx.x);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.18, 0.12), vFx.z * 0.5);
}
#endif
#ifdef NK_DMG
if (vDmg.x > 0.01) {
  // ひび: ワールド座標のノイズの等高線を、傷むほど太く濃く
  vec3 w = vNkWorld * 6.0;
  float n = nkN2(w.xy + w.zz * 0.7) * 0.6 + nkN2(w.zy * 1.7 + 3.1) * 0.4;
  float crack = 1.0 - smoothstep(0.0, 0.012 + 0.03 * vDmg.x, abs(n - 0.5));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.14, 0.1, 0.08), crack * smoothstep(0.05, 0.5, vDmg.x) * 0.9);
}
diffuseColor.rgb *= 1.0 - 0.5 * vDmg.y;
#endif
`;

const FRAG_EMISSIVE = /* glsl */ `
#ifdef NK_FX
totalEmissiveRadiance += vec3(1.0, 0.9, 0.7) * vFx.y * (0.07 + 0.03 * sin(uTime * 5.0)) + vec3(1.0, 0.15, 0.1) * vFx.z * 0.18;
#endif
#ifdef NK_GLOW
{
  #ifdef NK_FX
  float lit = (1.0 - vFx.x) * (0.45 + 1.3 * uEvening + vFx.w * 0.9);
  #else
  float lit = 0.45 + 1.3 * uEvening;
  #endif
  totalEmissiveRadiance += vColor.rgb * vGlow * lit;
}
#endif
`;

const FRAG_CLOUD = /* glsl */ `
#ifdef NK_CLOUD
float nkCloud = 1.0 - uCloudStrength * smoothstep(0.25, 0.7, texture2D(uCloudTex, vNkWorld.xz * 0.016 + uCloudOffset).r);
#else
float nkCloud = 1.0;
#endif
`;

const FRAG_RIM = /* glsl */ `
{
  float nkR = 1.0 - saturate(dot(normal, normalize(vViewPosition)));
  outgoingLight += uRimColor * pow(nkR, 3.0) * NK_RIM * nkCloud;
}
`;

const LIGHTS = THREE.ShaderChunk.lights_fragment_begin.replace(
  'getDirectionalLightInfo( directionalLight, directLight );',
  'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= nkCloud;',
);

/** トゥーン調マテリアル。共通の雲の影・リムライトと、用途ごとのシェーダー拡張を入れる */
export function toon(o: MatOpts = {}) {
  const m = new THREE.MeshToonMaterial({
    color: o.color ?? 0xffffff,
    vertexColors: !!o.vertexColors || o.fur !== undefined,
    gradientMap: GRADIENT,
    map: o.map ?? null,
    transparent: !!o.transparent,
    opacity: o.opacity ?? 1,
    depthWrite: o.depthWrite ?? true,
    side: o.side ?? THREE.FrontSide,
  });
  const defs = [
    o.fx && '#define NK_FX',
    o.glow && '#define NK_GLOW',
    o.dmg && '#define NK_DMG',
    o.wind && `#define NK_WIND ${o.wind.toFixed(4)}`,
    o.belt && '#define NK_BELT',
    o.fur !== undefined && `#define NK_FUR ${o.fur}\n#define NK_EYE_Y ${EYE_Y.toFixed(4)}`,
    o.cloud !== false && '#define NK_CLOUD',
    `#define NK_RIM ${(o.rim ?? 0.12).toFixed(3)}`,
  ]
    .filter(Boolean)
    .join('\n');
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, o.fur !== undefined ? furUniforms : {});
    sh.vertexShader = `${defs}\n${VERT_DECL}${sh.vertexShader}`
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_BEGIN}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${VERT_WORLD}`);
    sh.fragmentShader = `${defs}\n${FRAG_DECL}${sh.fragmentShader}`
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_COLOR}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAG_EMISSIVE}`)
      .replace('#include <lights_fragment_begin>', `${FRAG_CLOUD}\n${LIGHTS}`)
      .replace('#include <opaque_fragment>', `${FRAG_RIM}\n#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => defs;
  return m;
}

/** 頂点カラーを使う建物・小物の共通マテリアル */
export const MAT = {
  solid: toon({ vertexColors: true }),
  fx: toon({ vertexColors: true, fx: true, glow: true, dmg: true }),
  belt: toon({ vertexColors: true, fx: true, belt: true }),
  glass: toon({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, rim: 1.4 }),
};
