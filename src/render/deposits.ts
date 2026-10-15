import * as THREE from 'three';
import { ORES, type OreId } from '../sim/data';
import type { GameState } from '../sim/state';
import { Layer } from './layer';
import { rng, toon } from './materials';
import { depositGeometries } from './models';

/**
 * 鉱床の岩。空いたタイルは真ん中に大きな塊、建物の下は角に小さな塊を置いて覗かせる。
 * クリックは地面のタイルで判定するので岩は邪魔しない。鉱床か建物が変わったときだけ作り直す
 */
export function createDeposits(parent: THREE.Object3D) {
  const geo = depositGeometries();
  const mat = toon({ vertexColors: true, glow: true, rim: 0.2 });
  const big = {} as Record<OreId, Layer>;
  const small = {} as Record<OreId, Layer>;
  for (const k of ORES) {
    big[k] = new Layer(parent, geo.big[k], mat, 64, { shadow: true });
    small[k] = new Layer(parent, geo.small[k], mat, 128, { shadow: true });
  }
  const M = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  let key = '';
  return {
    update(st: GameState) {
      const ores = st.ores ?? [];
      const k = `${ores.length}:${st.oreSeed}:${st.layoutVersion}:${st.buildings.length}`;
      if (k === key) return;
      key = k;
      const used = new Set(st.buildings.map((b) => (b.x + 512) * 1024 + b.y + 512));
      for (const k of ORES) {
        big[k].begin();
        small[k].begin();
      }
      for (const o of ores) {
        const r = rng((o.x + 512) * 7919 + (o.y + 512) * 104729);
        const x = o.x + 0.5;
        const z = o.y + 0.5;
        const covered = used.has((o.x + 512) * 1024 + o.y + 512);
        if (!covered) {
          const sz = 0.85 + r() * 0.4;
          big[o.k].push(M.compose(v.set(x + (r() - 0.5) * 0.2, 0, z + (r() - 0.5) * 0.2), q.setFromAxisAngle(up, r() * 6.28), s.set(sz, 0.8 + r() * 0.5, sz)));
        }
        // 角の小さな塊（建物の下でも端から見える）
        const n = covered ? 2 + Math.floor(r() * 2) : 1 + Math.floor(r() * 2);
        const first = Math.floor(r() * 4);
        for (let i = 0; i < n; i++) {
          const c = (first + i) % 4;
          const sx = c & 1 ? 1 : -1;
          const sz = c & 2 ? 1 : -1;
          const k = 0.75 + r() * 0.5;
          small[o.k].push(M.compose(v.set(x + sx * (0.41 + r() * 0.05), 0, z + sz * (0.41 + r() * 0.05)), q.setFromAxisAngle(up, r() * 6.28), s.set(k, k * (0.8 + r() * 0.4), k)));
        }
      }
      for (const k of ORES) {
        big[k].end();
        small[k].end();
      }
    },
  };
}
