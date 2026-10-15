import * as THREE from 'three';
import type { GameState } from '../sim/state';
import type { GameEvent } from '../sim/tick';
import { createBuildings, type UiState } from './buildings';
import { createCats } from './cats';
import { createDeposits } from './deposits';
import { createFx } from './fx';
import { createItems } from './layer';
import { createLifts } from './lifts';
import { createRaid } from './raid';

export type { UiState };
export type Sound = 'meow' | 'thud' | 'research' | 'bark' | 'robotBoot' | 'splash';

/** 建物・鉱床・リフト・猫・犬・アイテム・演出をまとめて state に同期する。at は音の出る位置（距離で減衰させる） */
export function createEntities(scene: THREE.Scene, noAO: (o: THREE.Object3D) => void, sound: (s: Sound, at?: THREE.Vector3) => void) {
  const root = new THREE.Group();
  scene.add(root);
  const items = createItems(root);
  const fx = createFx(root, items, noAO);
  const buildings = createBuildings(root, items, fx, noAO, (s) => sound(s));
  const cats = createCats(root, items, fx, (s) => sound(s));
  const lifts = createLifts(root, items, noAO);
  const deposits = createDeposits(root);
  const raid = createRaid(root, items, fx, (at) => sound('bark', at));
  return {
    /** sim が進んだ直後に呼ぶ（猫と犬の補間の起点） */
    snapshot() {
      cats.snapshot();
      raid.snapshot();
    },
    /** 吹き出しのアイテム絵をサムネイルに差し替える */
    setItemIcon: buildings.setItemIcon,
    event(s: GameState, e: GameEvent) {
      if (e.kind === 'coin' || e.kind === 'rp') buildings.event(e.kind, s, e.x, e.y, e.amount);
      else if (e.kind === 'fire') buildings.fired(e.x, e.y, e.amount);
      else if (e.kind === 'hit') raid.hit(e.type!, e.x, e.y);
      else if (e.kind === 'bone') raid.kill(e.dog!, e.x, e.y);
    },
    levelUp: cats.levelUp,
    pick: buildings.pick,
    pickCat: cats.pick,
    catPosition: cats.position,
    petCat: cats.pet,
    keptCat: cats.kept,
    update(s: GameState, dt: number, now: number, alpha: number, ui: UiState) {
      items.begin();
      deposits.update(s);
      buildings.update(s, dt, now, ui);
      lifts.update(s, dt, now, alpha, ui);
      cats.update(s, dt, now, alpha);
      raid.update(s, dt, now, alpha);
      fx.update(dt);
      items.end();
    },
  };
}
