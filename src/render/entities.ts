import * as THREE from 'three';
import type { GameState } from '../sim/state';
import type { GameEvent } from '../sim/tick';
import { createBuildings, type UiState } from './buildings';
import { createCats } from './cats';
import { createFx } from './fx';
import { createItems } from './layer';

export type { UiState };
export type Sound = 'meow' | 'thud' | 'research';

/** 建物・猫・アイテム・演出をまとめて state に同期する */
export function createEntities(scene: THREE.Scene, noAO: (o: THREE.Object3D) => void, sound: (s: Sound) => void) {
  const root = new THREE.Group();
  scene.add(root);
  const items = createItems(root);
  const fx = createFx(root, items, noAO);
  const buildings = createBuildings(root, items, fx, noAO, sound);
  const cats = createCats(root, items, fx, sound);
  return {
    /** sim が進んだ直後に呼ぶ（猫の補間の起点） */
    snapshot: cats.snapshot,
    /** 吹き出しのアイテム絵をサムネイルに差し替える */
    setItemIcon: buildings.setItemIcon,
    event(s: GameState, e: GameEvent) {
      if (e.kind !== 'lvup') buildings.event(e.kind, s, e.x, e.y, e.amount);
    },
    levelUp: cats.levelUp,
    pick: buildings.pick,
    pickCat: cats.pick,
    catPosition: cats.position,
    petCat: cats.pet,
    update(s: GameState, dt: number, now: number, alpha: number, ui: UiState) {
      items.begin();
      buildings.update(s, dt, now, ui);
      cats.update(s, dt, now, alpha);
      fx.update(dt);
      items.end();
    },
  };
}
