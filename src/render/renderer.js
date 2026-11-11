// Three.js 렌더러. 로직 상태는 읽기만 한다 — 여기서 state 를 수정하지 않는다.
// 맵(render/world), 행동체(render/entities), 이펙트(render/effects)를 묶고, 카메라·조명·품질을 맡는다.
//
// 자원의 수명:
//   - 공유 자원(지오메트리·머티리얼, assets.js)과 풀(행동체 뷰, 투사체, 입자, 피해 숫자): 렌더러와 함께 살고 층이 바뀌어도 다시 쓴다.
//   - 층 자원(바닥·벽 InstancedMesh, 바닥 텍스처, 표식): state.world 가 바뀌면 앞 층의 것을 dispose 하고 새로 만든다.

import * as THREE from 'three';
import { ZONES } from '../../data/zones.js';
import { EVENTS } from '../logic/core/events.js';
import { Rng } from '../logic/core/prng.js';
import { isVisible } from '../logic/entities/vision.js';
import { createAssets } from './assets.js';
import { distanceScale, followStep } from './camera-rig.js';
import { createEffects } from './effects/effects.js';
import { createActorViews } from './entities/actor-views.js';
import { createFloorView } from './world/floor-view.js';

/**
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas
 * @param {object} options.config data/config.js 의 RENDER
 * @param {string} [options.quality] 'low' | 'medium' | 'high'
 */
export function createRenderer({ canvas, config, quality = 'medium' }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setClearColor(config.clearColor);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(config.fovDeg, 1, config.near, config.far);
  const ambient = new THREE.AmbientLight(0xffffff, 1.5);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -14;
  sun.shadow.camera.right = 14;
  sun.shadow.camera.top = 14;
  sun.shadow.camera.bottom = -14;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 40;
  sun.shadow.bias = -0.002;
  scene.add(ambient, sun, sun.target);

  // 꾸밈용 난수(입자 방향, 바닥 무늬). 게임 상태의 난수와 무관하다 — Math.random 은 쓰지 않는다.
  const rng = Rng.fromSeed('render:cosmetic');
  const assets = createAssets();
  const actors = createActorViews({ scene, assets });
  const effects = createEffects({ scene, assets, rng });

  let floorView = null;
  /** 지금 그리고 있는 맵의 타일 배열. 바뀌면 층이 바뀐 것이다(층 이동, 새 런, 이어하기). */
  let shownTiles = null;
  let floorsBuilt = 0;
  let size = { width: 1, height: 1, pixelRatio: 1 };
  let level = config.quality[quality] ? quality : 'medium';
  const focus = { x: 0, y: 0 };
  let hasFocus = false;

  function applyQuality() {
    const q = config.quality[level];
    renderer.setPixelRatio(Math.min(size.pixelRatio, q.pixelRatio) * q.scale);
    renderer.setSize(size.width, size.height, false);
    if (renderer.shadowMap.enabled !== q.shadows) {
      renderer.shadowMap.enabled = q.shadows;
      sun.castShadow = q.shadows;
      if (!q.shadows && sun.shadow.map) {
        sun.shadow.map.dispose();
        sun.shadow.map = null;
      }
      assets.refresh();
    }
    effects.setQuality(q);
  }
  applyQuality();

  function leaveFloor() {
    if (floorView) floorView.dispose();
    floorView = null;
    shownTiles = null;
    actors.clear();
    effects.clear();
    hasFocus = false;
  }

  function enterFloor(world) {
    leaveFloor();
    const zone = ZONES.find((z) => z.id === world.zoneId) ?? ZONES[0];
    floorView = createFloorView({ scene, assets, world, rng });
    shownTiles = world.tiles;
    floorsBuilt++;
    ambient.color.set(zone.palette.ambient);
    renderer.setClearColor(zone.palette.fog);
  }

  return {
    /**
     * @param {object} state 로직 상태(읽기 전용)
     * @param {number} alpha 직전 틱과 이번 틱 사이의 보간 계수 [0, 1)
     * @param {number} [dtSec] 직전 프레임부터 흐른 시간(초). 카메라 추적·입자에 쓴다
     */
    render(state, alpha, dtSec = 1 / 60) {
      const world = state.world;
      if (!world) {
        if (floorView) leaveFloor();
        renderer.render(scene, camera);
        return;
      }
      if (world.tiles !== shownTiles) enterFloor(world);

      actors.update(state, alpha, dtSec);
      const player = state.playerId !== null ? state.entities.byId[state.playerId] : null;
      const shown = player ? actors.positionOf(player.id) : null;
      const stairsOpen = !Object.keys(state.entities.byId).some((key) => state.entities.byId[key].kind === 'boss' && !state.entities.byId[key].dead);
      floorView.update(state, player, stairsOpen);
      effects.update(state, alpha, dtSec);

      if (shown) {
        if (!hasFocus) {
          focus.x = shown.x;
          focus.y = shown.y;
          hasFocus = true;
        } else followStep(focus, shown, config.camera.followRate, dtSec, config.camera.snapDistance);
      }
      const far = distanceScale(camera.aspect, config.camera.portraitScale);
      camera.position.set(focus.x, config.camera.height * far, focus.y + config.camera.back * far);
      camera.lookAt(focus.x, 0, focus.y);
      sun.position.set(focus.x - 6, 14, focus.y + 4);
      sun.target.position.set(focus.x, 0, focus.y);
      renderer.render(scene, camera);
    },

    /**
     * 이벤트버스에 연결한다: 피해 숫자·입자처럼 "일어난 일"로만 알 수 있는 연출을 받는다.
     * @param {object} bus
     * @param {() => object} getState 그 순간의 상태(읽기만 한다)
     * @returns {() => void} 연결을 끊는 함수
     */
    attach(bus, getState) {
      const offs = [
        bus.on(EVENTS.DAMAGE_DEALT, (e) => {
          const state = getState();
          const target = state.entities.byId[e.targetId];
          if (!target || !state.world || !isVisible(state, target.x, target.y)) return;
          actors.flash(e.targetId);
          if (e.kind === 'dot' && e.amount === 0) return;
          effects.damage(target.x, target.y, target.kind === 'boss' ? 2.2 : 1.2, e.amount, { crit: e.crit, toPlayer: target.kind === 'player', blocked: e.blocked });
        }),
        bus.on(EVENTS.ENTITY_DIED, (e) => {
          const state = getState();
          if (state.world && isVisible(state, e.x, e.y)) effects.burst(e.x, e.y, 0.6, e.kind === 'boss' ? 0xffb020 : 0xd8dce6, e.kind === 'boss' ? 60 : 14);
        }),
        bus.on(EVENTS.LEVEL_UP, () => {
          const state = getState();
          const player = state.entities.byId[state.playerId];
          if (!player) return;
          effects.text(player.x, player.y, 1.4, 'LEVEL UP', config.colors.damageCrit);
          effects.burst(player.x, player.y, 0.8, 0xffe14a, 24);
        }),
        bus.on(EVENTS.DROP_COLLECTED, (e) => {
          const state = getState();
          const player = state.entities.byId[state.playerId];
          if (player && e.kind === 'gold') effects.text(player.x, player.y, 1.2, `+${e.amount}`, '#ffd34a');
        }),
      ];
      return () => offs.forEach((off) => off());
    },

    resize(width, height, pixelRatio) {
      size = { width, height, pixelRatio };
      applyQuality();
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    },

    /** 그래픽 품질을 바꾼다: 'low' | 'medium' | 'high'. */
    setQuality(name) {
      if (!config.quality[name]) throw new RangeError(`setQuality: 알 수 없는 품질 "${name}"`);
      level = name;
      applyQuality();
    },

    /** GPU 자원과 풀의 현황(누수 확인용). */
    info() {
      return {
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        programs: renderer.info.programs ? renderer.info.programs.length : 0,
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        sceneChildren: scene.children.length,
        floorsBuilt,
        quality: level,
        pixelRatio: renderer.getPixelRatio(),
        shadows: renderer.shadowMap.enabled,
        camera: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        focus: { x: focus.x, y: focus.y },
        assets: assets.counts(),
        actors: actors.stats(),
        effects: effects.stats(),
        floor: floorView ? floorView.stats() : null,
      };
    },

    dispose() {
      leaveFloor();
      actors.dispose();
      effects.dispose();
      assets.dispose();
      if (sun.shadow.map) sun.shadow.map.dispose();
      renderer.dispose();
    },
  };
}
