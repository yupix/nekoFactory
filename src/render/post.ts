import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/** AO の法線パスから透明物・ビルボードを外し、内部解像度を下げた GTAO */
class AOPass extends GTAOPass {
  hide: THREE.Object3D[] = [];
  scale = 0.5;
  setSize(w: number, h: number) {
    super.setSize(Math.max(1, Math.round(w * this.scale)), Math.max(1, Math.round(h * this.scale)));
  }
  render(renderer: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget, dt: number, mask: boolean) {
    const vis = this.hide.map((o) => o.visible);
    for (const o of this.hide) o.visible = false;
    super.render(renderer, write, read, dt, mask);
    this.hide.forEach((o, i) => (o.visible = vis[i]));
  }
}

const FinishShader = {
  uniforms: { tDiffuse: { value: null }, uVignette: { value: 0.28 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float d = length((vUv - 0.5) * vec2(1.1, 1.0));
      c.rgb *= 1.0 - uVignette * smoothstep(0.3, 0.85, d);
      gl_FragColor = c;
    }`,
};

/** ポストプロセス（AO・ブルーム・ビネット）。最初の描画に要らないので遅延読み込みする。hide は AO の法線パスから外す物 */
export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, hide: THREE.Object3D[]) {
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  const ao = new AOPass(scene, camera, 1, 1);
  ao.hide = hide;
  ao.output = GTAOPass.OUTPUT.Default;
  ao.blendIntensity = 0.9;
  ao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.6, thickness: 1.2, scale: 1.25, samples: 12 });
  ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
  composer.addPass(ao);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.42, 1.2);
  composer.addPass(bloom);
  const finish = new ShaderPass(FinishShader);
  composer.addPass(finish);
  composer.addPass(new OutputPass());
  return { composer, ao, bloom, finish };
}
export type Post = ReturnType<typeof createPost>;
