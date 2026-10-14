import * as THREE from 'three';
import type { BuildingType, ItemId } from '../sim/data';
import type { GameState } from '../sim/state';
import { createCats } from './cats';
import { createFx } from './fx';
import { createItems } from './layer';
import { toon } from './materials';
import { buildingModels, itemModels, rbox, Y0 } from './models';

export type CoatKey = 'white' | 'black' | 'brown' | 'gray' | 'calico' | 'saba';
/** サムネイルの種類。猫のアイコンは coat:brown */
export type ThumbKey = `building:${BuildingType}` | `item:${ItemId}` | `coat:${CoatKey}`;

/** 建設バーやアイコン用に、本物の 3D モデルを別のコンテキストで小さく描く。起動を待たせないよう 1 枚ずつ返す */
export function* renderThumbs(size = 160): Generator<[ThumbKey, HTMLCanvasElement]> {
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1);
  r.setSize(size, size, false);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.08;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdcecff, 0x9ab07a, 1.7));
  const sun = new THREE.DirectionalLight(0xfff3e0, 2.9);
  sun.position.set(-4, 6, 1.5);
  scene.add(sun);
  const cam = new THREE.PerspectiveCamera(22, 1, 0.05, 50);
  const mat = toon({ vertexColors: true, glow: true, cloud: false, rim: 0.2 });
  const padMat = toon({ color: 0xd2c8b8, cloud: false });
  const dir = new THREE.Vector3(Math.cos(0.62) * Math.SQRT1_2, Math.sin(0.62), Math.cos(0.62) * Math.SQRT1_2);
  const sphere = new THREE.Sphere();

  function shot(obj: THREE.Object3D, fit: number) {
    scene.add(obj);
    obj.updateMatrixWorld(true);
    new THREE.Box3().setFromObject(obj).getBoundingSphere(sphere);
    const dist = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2))) * fit;
    cam.position.copy(sphere.center).addScaledVector(dir, dist);
    cam.lookAt(sphere.center);
    r.render(scene, cam);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    c.getContext('2d')!.drawImage(r.domElement, 0, 0);
    scene.remove(obj);
    return c;
  }

  try {
    // 吹き出しに出るアイテム → HUD の猫 → 建設バーの建物 → 残りの毛色
    const geos = itemModels();
    for (const id of Object.keys(geos) as ItemId[]) yield [`item:${id}`, shot(new THREE.Mesh(geos[id], mat), 0.78)];

    // 猫: 本番と同じ描画系で、毛色ごとに座った猫を描く（サバトラは id が奇数のグレー）
    const coat = (color: string, id: number) => {
      const g = new THREE.Group();
      const items = createItems(g);
      const cats = createCats(g, items, createFx(g, items, () => {}), () => {}, Math.PI / 4 + 0.35);
      const fake = { buildings: [], cats: [{ id, x: 0, y: 0, color, state: 'idle', path: [], item: null, amount: 0, src: 0, dst: 0, rest: null }] } as unknown as GameState;
      for (let i = 0; i < 32; i++) {
        items.begin();
        cats.update(fake, 1 / 30, 0.5 + i / 30, 1);
        items.end();
      }
      return shot(g, 0.72);
    };
    yield ['coat:brown', coat('brown', 2)];

    const models = buildingModels();
    for (const t of Object.keys(models) as BuildingType[]) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(models[t].full, mat), new THREE.Mesh(rbox(0.94, Y0, 0.94, 0.035, 2).translate(0, Y0 / 2, 0), padMat));
      yield [`building:${t}`, shot(g, 0.8)];
    }

    const keys: [CoatKey, string, number][] = [['white', 'white', 2], ['black', 'black', 2], ['gray', 'gray', 2], ['calico', 'calico', 2], ['saba', 'gray', 3]];
    for (const [key, color, id] of keys) yield [`coat:${key}`, coat(color, id)];
  } finally {
    r.dispose();
    r.forceContextLoss();
  }
}
