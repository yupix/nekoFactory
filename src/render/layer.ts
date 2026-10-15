import * as THREE from 'three';
import { ITEM_IDS, type ItemId } from '../sim/data';
import { toon } from './materials';
import { itemModels } from './models';

interface LayerOpts {
  shadow?: boolean;
  receive?: boolean;
  color?: boolean;
  /** インスタンスごとの追加属性（名前 → 要素数） */
  attrs?: Record<string, number>;
  renderOrder?: number;
}

function flag(a: THREE.BufferAttribute, n: number) {
  a.clearUpdateRanges();
  a.addUpdateRange(0, Math.max(1, n) * a.itemSize);
  a.needsUpdate = true;
}

/** 毎フレーム先頭から詰め直す InstancedMesh。足りなければ容量を倍にする */
export class Layer {
  mesh: THREE.InstancedMesh;
  n = 0;
  private attrs: [string, number][];

  constructor(
    private parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    cap: number,
    private opts: LayerOpts = {},
  ) {
    this.attrs = Object.entries(opts.attrs ?? {});
    this.mesh = this.make(geo, mat, cap);
  }

  private make(geo: THREE.BufferGeometry, mat: THREE.Material, cap: number) {
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.frustumCulled = false;
    m.castShadow = !!this.opts.shadow;
    m.receiveShadow = this.opts.receive ?? true;
    m.renderOrder = this.opts.renderOrder ?? 0;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (this.opts.color) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3).setUsage(THREE.DynamicDrawUsage);
    for (const [name, size] of this.attrs) {
      const old = geo.getAttribute(name) as THREE.InstancedBufferAttribute | undefined;
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * size), size).setUsage(THREE.DynamicDrawUsage);
      if (old) a.array.set(old.array.subarray(0, Math.min(old.array.length, a.array.length)));
      geo.setAttribute(name, a);
    }
    m.count = 0;
    this.parent.add(m);
    return m;
  }

  begin() {
    this.n = 0;
  }

  push(matrix: THREE.Matrix4) {
    if (this.n >= this.mesh.instanceMatrix.count) this.grow();
    this.mesh.setMatrixAt(this.n, matrix);
    return this.n++;
  }

  set(name: string, i: number, a: number, b = 0, c = 0, d = 0) {
    const attr = this.mesh.geometry.getAttribute(name) as THREE.InstancedBufferAttribute;
    const s = attr.itemSize;
    const arr = attr.array as Float32Array;
    arr[i * s] = a;
    if (s > 1) arr[i * s + 1] = b;
    if (s > 2) arr[i * s + 2] = c;
    if (s > 3) arr[i * s + 3] = d;
  }

  color(i: number, c: THREE.Color) {
    this.mesh.setColorAt(i, c);
  }

  end() {
    const m = this.mesh;
    m.count = this.n;
    m.visible = this.n > 0;
    if (!this.n) return;
    flag(m.instanceMatrix, this.n);
    if (m.instanceColor) flag(m.instanceColor, this.n);
    for (const [name] of this.attrs) flag(m.geometry.getAttribute(name) as THREE.BufferAttribute, this.n);
  }

  private grow() {
    const old = this.mesh;
    const cap = old.instanceMatrix.count * 2;
    const next = this.make(old.geometry, old.material as THREE.Material, cap);
    (next.instanceMatrix.array as Float32Array).set(old.instanceMatrix.array);
    if (old.instanceColor && next.instanceColor) (next.instanceColor.array as Float32Array).set(old.instanceColor.array);
    next.visible = old.visible;
    old.removeFromParent();
    old.dispose();
    this.mesh = next;
  }
}

export { ITEM_IDS };

/** アイテムの小さなモデル。在庫の山・猫の荷物・飛んでいく品を毎フレームまとめて描く */
export function createItems(parent: THREE.Object3D) {
  const geos = itemModels();
  const mat = toon({ vertexColors: true, glow: true, rim: 0.18 });
  const layers = Object.fromEntries(ITEM_IDS.map((id) => [id, new Layer(parent, geos[id], mat, 64, { shadow: true })])) as Record<ItemId, Layer>;
  return {
    begin() {
      for (const l of Object.values(layers)) l.begin();
    },
    push(id: ItemId, m: THREE.Matrix4) {
      layers[id].push(m);
    },
    end() {
      for (const l of Object.values(layers)) l.end();
    },
  };
}
export type Items = ReturnType<typeof createItems>;
