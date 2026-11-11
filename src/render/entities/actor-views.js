// 행동체(플레이어·적·보스) 그리기. 행동체마다 작은 그룹(몸통, 방향 표시, 체력 막대, 상태이상 원)을 풀에서 꺼내 쓴다.
// 지오메트리·머티리얼은 공유 자원이다. 위치는 직전 틱과 이번 틱 사이를 alpha 로 보간한다.

import * as THREE from 'three';
import { RENDER } from '../../../data/config.js';
import { isVisible } from '../../logic/entities/vision.js';
import { createPool } from '../pool.js';

const STATUS_COLORS = { poison: 0x7fd14a, burn: 0xff7a2a, bleed: 0xc0283a, slow: 0x6aa8ff, freeze: 0x9fe8ff, stun: 0xffe14a };
/** 카메라가 내려다보는 각도에 맞춰 체력 막대를 눕힌다. */
const BAR_TILT = -Math.atan2(RENDER.camera.height, RENDER.camera.back);

/** 종류 이름에서 색을 정한다(같은 종류는 언제나 같은 색). */
function colorOfType(type) {
  let hash = 0;
  for (let i = 0; i < type.length; i++) hash = Math.imul(hash ^ type.charCodeAt(i), 0x01000193) >>> 0;
  return new THREE.Color().setHSL((hash % 360) / 360, 0.42, 0.56).getHex();
}

export function createActorViews({ scene, assets }) {
  const typeColors = new Map();
  const colorFor = (actor) => {
    if (actor.kind === 'player') return RENDER.colors.player;
    if (actor.kind === 'boss') return RENDER.colors.boss;
    if (!typeColors.has(actor.type)) typeColors.set(actor.type, colorOfType(actor.type));
    return typeColors.get(actor.type);
  };

  const pool = createPool({
    max: 192,
    create() {
      const group = new THREE.Group();
      const pivot = new THREE.Group();
      const body = new THREE.Mesh(assets.geometries.body, assets.lit(0xffffff));
      const nose = new THREE.Mesh(assets.geometries.nose, assets.lit(0xffffff));
      body.castShadow = true;
      pivot.add(body, nose);
      const ring = new THREE.Mesh(assets.geometries.disc, assets.flat(0xffffff, 0.45));
      ring.position.y = 0.03;
      const barBack = new THREE.Mesh(assets.geometries.bar, assets.materials.barBack);
      const barFill = new THREE.Mesh(assets.geometries.bar, assets.materials.barFill);
      barBack.rotation.x = BAR_TILT;
      barFill.rotation.x = BAR_TILT;
      barBack.renderOrder = 10;
      barFill.renderOrder = 11;
      group.add(pivot, ring, barBack, barFill);
      scene.add(group);
      return { group, pivot, body, nose, ring, barBack, barFill, id: 0, prevX: 0, prevY: 0, x: 0, y: 0, flash: 0, fresh: true };
    },
    activate(view) {
      view.group.visible = true;
      view.fresh = true;
      view.flash = 0;
    },
    deactivate(view) {
      view.group.visible = false;
      view.id = 0;
    },
  });
  /** 행동체 id → 뷰. */
  const views = new Map();
  let lastTick = -1;

  return {
    /**
     * 상태에 맞춰 뷰를 만들고 없애고 갱신한다.
     * @param {object} state 로직 상태(읽기만 한다)
     * @param {number} alpha 직전 틱과 이번 틱 사이의 보간 계수
     * @param {number} dtSec 프레임 길이
     */
    update(state, alpha, dtSec) {
      const byId = state.entities.byId;
      const ticked = state.tick !== lastTick;
      const jumped = state.tick - lastTick !== 1;
      lastTick = state.tick;

      for (const [id, view] of views) {
        if (!Object.hasOwn(byId, id) || pool.active.indexOf(view) === -1) {
          pool.release(view);
          views.delete(id);
        }
      }
      for (const key of Object.keys(byId)) {
        const actor = byId[key];
        let view = views.get(key);
        if (!view) {
          view = pool.acquire();
          // 풀이 가득 차 다른 행동체의 뷰를 되돌려 받았다면 그쪽 연결을 끊는다.
          if (view.id) views.delete(String(view.id));
          view.id = actor.id;
          views.set(key, view);
          const r = actor.radius;
          const tall = actor.kind === 'boss' ? 1.5 + r : 0.75 + r;
          view.body.scale.set(r * 2, tall, r * 2);
          view.body.material = assets.lit(colorFor(actor));
          view.nose.material = view.body.material;
          view.nose.position.set(0, tall * 0.62, r * 0.6);
          view.ring.scale.setScalar(r * 1.5);
          view.barBack.position.set(-0.5, tall + 0.35, 0);
          view.barFill.position.set(-0.5, tall + 0.35, 0);
          view.barFill.material = actor.kind === 'boss' ? assets.materials.barBoss : assets.materials.barFill;
          view.tall = tall;
        }
        if (ticked || view.fresh) {
          const dx = actor.x - view.x;
          const dy = actor.y - view.y;
          // 처음 보는 행동체, 틱을 건너뛴 경우(불러오기), 순간이동은 보간하지 않는다.
          const snap = view.fresh || jumped || dx * dx + dy * dy > 4;
          view.prevX = snap ? actor.x : view.x;
          view.prevY = snap ? actor.y : view.y;
          view.x = actor.x;
          view.y = actor.y;
          view.fresh = false;
        }
        const x = view.prevX + (view.x - view.prevX) * alpha;
        const y = view.prevY + (view.y - view.prevY) * alpha;
        view.group.position.set(x, 0, y);
        view.pivot.rotation.y = Math.atan2(actor.facingX, actor.facingY);

        const isPlayer = actor.kind === 'player';
        view.group.visible = isPlayer || (!actor.dead && isVisible(state, actor.x, actor.y));
        // 맞았을 때 잠깐 부풀고, 죽은 플레이어는 눕는다.
        view.flash = Math.max(0, view.flash - dtSec * 6);
        const pulse = 1 + view.flash * 0.25;
        view.pivot.scale.set(pulse, actor.dead ? 0.25 : pulse, pulse);

        const hurt = !actor.dead && (actor.kind === 'boss' || (!isPlayer && actor.hp < actor.maxHp));
        view.barBack.visible = hurt;
        view.barFill.visible = hurt;
        if (hurt) view.barFill.scale.x = Math.max(0.001, actor.hp / actor.maxHp);

        const statuses = Object.keys(actor.statuses);
        view.ring.visible = statuses.length > 0 && !actor.dead;
        if (view.ring.visible) view.ring.material = assets.flat(STATUS_COLORS[statuses[0]] ?? 0xffffff, 0.45);
      }
    },
    /** 맞았다는 표시. */
    flash(id) {
      const view = views.get(String(id));
      if (view) view.flash = 1;
    },
    /** 화면에 그려지고 있는 위치(카메라가 따라갈 곳). 없으면 null. */
    positionOf(id) {
      const view = views.get(String(id));
      return view ? { x: view.group.position.x, y: view.group.position.z, tall: view.tall } : null;
    },
    /** 층을 옮길 때: 뷰를 모두 풀로 돌려놓는다(버리지 않고 다음 층에서 다시 쓴다). */
    clear() {
      pool.releaseAll();
      views.clear();
      lastTick = -1;
    },
    stats() {
      return pool.stats();
    },
    dispose() {
      pool.forEach((view) => scene.remove(view.group));
      views.clear();
    },
  };
}
