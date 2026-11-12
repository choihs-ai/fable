// Three.js 렌더러. 로직 상태는 읽기만 한다 — 여기서 state 를 수정하지 않는다.
// 맵(render/world), 행동체(render/entities), 이펙트(render/effects)를 묶고, 카메라·조명·품질·화면 페이드를 맡는다.
//
// 자원의 수명:
//   - 공유 자원(지오메트리·머티리얼, assets.js)과 풀(행동체 모델, 투사체, 입자, 피해 숫자…): 렌더러와 함께 살고 층이 바뀌어도 다시 쓴다.
//   - 층 자원(바닥·벽·문·소품 InstancedMesh, 바닥 텍스처, 횃불 빛, 포털·상인): state.world 가 바뀌면 앞 층의 것을 dispose 하고 새로 만든다.
//
// 층에 들어갈 때: 화면을 검게 덮은 채로 그 층의 메시를 모두 만들고, 쓰일 머티리얼의 셰이더를 미리 컴파일(renderer.compile)한 뒤
// 페이드 인한다. 플레이 중에 맵이 조각조각 생기거나, 처음 보는 머티리얼 때문에 멈칫하는 일이 없게 한다.

import * as THREE from 'three';
import { FEEL } from '../../data/feel.js';
import { WEAPONS } from '../../data/weapons.js';
import { ZONES } from '../../data/zones.js';
import { EVENTS } from '../logic/core/events.js';
import { Rng } from '../logic/core/prng.js';
import { addShake, decayShake, distanceScale, followStep, shakeOffset } from './camera-rig.js';
import { createAssets } from './assets.js';
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
  renderer.autoClear = false;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(config.fovDeg, 1, config.near, config.far);
  const hemi = new THREE.HemisphereLight(0xbfd0ff, 0x2a2018, config.light.hemi);
  const sun = new THREE.DirectionalLight(config.light.sunColor, config.light.sun);
  // 윤곽광: 화면 안쪽(북쪽) 위에서 비춰 캐릭터의 머리·어깨 윗선을 차갑게 끊어 낸다(어두운 바탕에서 몸이 떠 보이게).
  const rim = new THREE.DirectionalLight(config.light.rimColor, config.light.rim);
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -16;
  sun.shadow.camera.right = 16;
  sun.shadow.camera.top = 16;
  sun.shadow.camera.bottom = -16;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 50;
  sun.shadow.bias = -0.0015;
  scene.add(hemi, sun, sun.target, rim, rim.target);

  // 화면 페이드: 장면 위에 덮는 검은 판(직교 카메라).
  const overlayScene = new THREE.Scene();
  const overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const veilMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 1, depthTest: false });
  const veilGeometry = new THREE.PlaneGeometry(2, 2);
  overlayScene.add(new THREE.Mesh(veilGeometry, veilMaterial));

  // 꾸밈용 난수(입자 방향, 바닥 무늬, 소품). 게임 상태의 난수와 무관하다 — Math.random 은 쓰지 않는다.
  const rng = Rng.fromSeed('render:cosmetic');
  const assets = createAssets();
  const actors = createActorViews({ scene, assets });
  const effects = createEffects({ scene, assets, rng });

  let floorView = null;
  /** 지금 그리고 있는 맵의 타일 배열. 바뀌면 층이 바뀐 것이다(층 진입, 새 런, 이어하기). */
  let shownTiles = null;
  let floorsBuilt = 0;
  let size = { width: 1, height: 1, pixelRatio: 1 };
  let level = config.quality[quality] ? quality : 'medium';
  const focus = { x: 0, y: 0 };
  let hasFocus = false;
  let clock = 0;
  /** 화면 페이드(1 = 완전히 가림)와, 페이드를 시작하기 전에 기다릴 프레임 수. */
  let veil = 1;
  let hold = 0;
  let shake = 0;
  let lastCompileMs = 0;
  let compiles = 0;

  function applyQuality() {
    const q = config.quality[level];
    renderer.setPixelRatio(Math.min(size.pixelRatio, q.pixelRatio) * q.scale);
    renderer.setSize(size.width, size.height, false);
    const shadows = q.shadows;
    if (renderer.shadowMap.enabled !== shadows) {
      renderer.shadowMap.enabled = shadows;
      sun.castShadow = shadows;
      if (!shadows && sun.shadow.map) {
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

  /** 쓰일 머티리얼을 모두 한 번씩 보이게 하고 셰이더를 미리 컴파일한다. */
  function precompile() {
    const started = performance.now();
    const restoreActors = actors.prewarm();
    const restoreEffects = effects.prewarm();
    const restoreFloor = floorView ? floorView.prewarm() : () => {};
    renderer.compile(scene, camera);
    restoreFloor();
    restoreEffects();
    restoreActors();
    lastCompileMs = performance.now() - started;
    compiles++;
  }

  function enterFloor(world) {
    leaveFloor();
    const zone = ZONES.find((z) => z.id === world.zoneId) ?? ZONES[0];
    floorView = createFloorView({ scene, assets, world, rng, quality: config.quality[level] });
    shownTiles = world.tiles;
    floorsBuilt++;
    hemi.color.set(zone.palette.ambient).lerp(new THREE.Color(0xffffff), 0.35);
    renderer.setClearColor(zone.palette.fog);
    // 화면을 가린 채로 셰이더를 준비하고, 두 프레임을 그린 뒤(버퍼 업로드까지 끝난 뒤) 걷는다.
    veil = 1;
    hold = 2;
    precompile();
  }

  return {
    /**
     * @param {object} state 로직 상태(읽기 전용)
     * @param {number} alpha 직전 틱과 이번 틱 사이의 보간 계수 [0, 1)
     * @param {number} [dtSec] 직전 프레임부터 흐른 시간(초). 카메라·애니메이션·입자에 쓴다
     */
    render(state, alpha, dtSec = 1 / 60) {
      clock += dtSec;
      const world = state.world;
      renderer.clear();
      if (!world) {
        if (floorView) leaveFloor();
        veil = 1;
        renderer.render(scene, camera);
        renderer.render(overlayScene, overlayCamera);
        return;
      }
      if (world.tiles !== shownTiles) enterFloor(world);

      actors.update(state, alpha, dtSec, clock);
      const player = state.playerId !== null ? state.entities.byId[state.playerId] : null;
      const shown = player ? actors.positionOf(player.id) : null;
      floorView.update(state, shown, dtSec, clock);
      effects.update(state, alpha, dtSec, clock);

      if (shown) {
        // 바라보는 쪽으로 카메라를 조금 앞세운다.
        const lead = { x: shown.x + player.facingX * config.camera.lead, y: shown.y + player.facingY * config.camera.lead };
        if (!hasFocus) {
          focus.x = lead.x;
          focus.y = lead.y;
          hasFocus = true;
        } else followStep(focus, lead, config.camera.followRate, dtSec, config.camera.snapDistance);
      }
      shake = decayShake(shake, FEEL.shake.decay, dtSec);
      const jolt = shakeOffset(shake, clock, FEEL.shake.frequency);
      const far = distanceScale(camera.aspect, config.camera.portraitScale);
      camera.position.set(focus.x + jolt.x, config.camera.height * far, focus.y + config.camera.back * far + jolt.y);
      camera.lookAt(focus.x + jolt.x, 0, focus.y + jolt.y);
      sun.position.set(focus.x - 7, 16, focus.y + 5);
      sun.target.position.set(focus.x, 0, focus.y);
      rim.position.set(focus.x + 3, 9, focus.y - 12);
      rim.target.position.set(focus.x, 0, focus.y);
      renderer.render(scene, camera);

      if (hold > 0) hold--;
      else if (veil > 0) veil = Math.max(0, veil - dtSec / FEEL.reveal.screenFadeSec);
      if (veil > 0) {
        veilMaterial.opacity = veil;
        renderer.render(overlayScene, overlayCamera);
      }
    },

    /** 카메라를 흔든다(세기를 더한다). */
    shake(amount) {
      shake = addShake(shake, amount, FEEL.shake.max);
    },

    /**
     * 이벤트버스에 연결한다: 피해 숫자·입자·자세처럼 "일어난 일"로만 알 수 있는 연출을 받는다.
     * @param {object} bus
     * @param {() => object} getState 그 순간의 상태(읽기만 한다)
     * @returns {() => void} 연결을 끊는 함수
     */
    attach(bus, getState) {
      const S = FEEL.shake;
      const kick = (amount) => {
        shake = addShake(shake, amount, S.max);
      };
      const offs = [
        bus.on(EVENTS.DAMAGE_DEALT, (e) => {
          const state = getState();
          const target = state.entities.byId[e.targetId];
          if (!target || !state.world || e.amount <= 0) return;
          const toPlayer = target.kind === 'player';
          actors.hurt(e.targetId, toPlayer);
          const height = target.kind === 'boss' ? 2.6 : target.elite ? 1.7 : 1.3;
          effects.damage(target.x, target.y, height, e.amount, { crit: e.crit, toPlayer, proc: Boolean(e.proc) });
          if (toPlayer) kick(S.hurt);
          else if (e.kind !== 'dot') kick(e.crit ? S.crit : S.hit);
        }),
        bus.on(EVENTS.ENTITY_DIED, (e) => {
          const state = getState();
          if (!state.world) return;
          const killer = e.killerId !== null ? state.entities.byId[e.killerId] : null;
          actors.die(e.id, { x: e.x, y: e.y, kbX: e.kbX ?? 0, kbY: e.kbY ?? 0, fromX: killer ? killer.x : e.x, fromY: killer ? killer.y + 0.01 : e.y + 1 });
          const boss = e.kind === 'boss';
          effects.burst(e.x, e.y, 0.6, boss ? 0xffb020 : e.elite ? 0xff7a4a : 0xd8dce6, boss ? 70 : e.elite ? 30 : 14, boss ? 1.8 : 1.1);
          if (e.kind !== 'player') kick(boss ? S.bossKill : S.kill);
        }),
        bus.on(EVENTS.ABILITY_USED, (e) => {
          const state = getState();
          const actor = state.entities.byId[e.actorId];
          if (actor && actor.kind !== 'player') actors.attack(e.actorId);
        }),
        bus.on(EVENTS.WEAPON_USED, (e) => {
          const state = getState();
          const id = state.playerId;
          const look = e.bash ? 'pistol' : WEAPONS[e.weapon].look;
          actors.attack(id, e.bash ? 'none' : look, e.offhand);
          if (e.kind === 'ranged' && !e.bash) {
            const point = actors.muzzleOf(id);
            effects.muzzle(point, e.dirX, e.dirY, look === 'laser' ? 0x7af0ff : look === 'staff' ? 0xb09aff : 0xffe08a);
            if (['pistol', 'smg', 'shotgun', 'sniper'].includes(look)) effects.casing(point, e.dirX, e.dirY);
            kick(look === 'shotgun' || look === 'sniper' || look === 'rocket' ? S.fire * 4 : S.fire);
          }
        }),
        bus.on(EVENTS.BEAM_FIRED, (e) => effects.beam(e.x0, e.y0, e.x1, e.y1, e.width, e.faction)),
        bus.on(EVENTS.EXPLOSION, (e) => {
          effects.explosion(e.x, e.y, e.radius, e.faction, e.proc);
          kick(S.explosion * Math.min(1, e.radius / 2));
        }),
        bus.on(EVENTS.CHAIN_LIGHTNING, (e) => effects.chain(e.points)),
        bus.on(EVENTS.BULLETS_CLEARED, (e) => effects.burst(e.x, e.y, 0.7, 0x9fe8ff, Math.min(20, 4 + e.count * 2))),
        bus.on(EVENTS.PLAYER_DASHED, () => {
          const state = getState();
          const p = state.entities.byId[state.playerId];
          if (p) effects.burst(p.x, p.y, 0.3, 0xcfe8ff, 6, 0.6);
        }),
        bus.on(EVENTS.BOSS_PHASE_CHANGED, (e) => {
          const state = getState();
          const boss = state.entities.byId[e.id];
          kick(S.bossSlam);
          if (boss) effects.burst(boss.x, boss.y, 1.2, 0xff5a2a, 40, 1.6);
        }),
        bus.on(EVENTS.DOORS_LOCKED, () => kick(S.hit * 2)),
        bus.on(EVENTS.DROP_COLLECTED, (e) => {
          const state = getState();
          const player = state.entities.byId[state.playerId];
          if (!player) return;
          if (e.kind === 'gold') effects.text(player.x, player.y, 1.3, `+${e.amount}`, '#ffd34a');
          else if (e.kind === 'health') effects.text(player.x, player.y, 1.3, `+${e.amount}`, config.colors.heal);
        }),
        bus.on(EVENTS.SECRET_FOUND, () => kick(S.explosion)),
      ];
      return () => offs.forEach((off) => off());
    },

    resize(width, height, pixelRatio) {
      size = { width, height, pixelRatio };
      applyQuality();
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    },

    /** 그래픽 품질을 바꾼다: 'low' | 'medium' | 'high'. 횃불 빛·소품 수는 다음 층부터 바뀐다. */
    setQuality(name) {
      if (!config.quality[name]) throw new RangeError(`setQuality: 알 수 없는 품질 "${name}"`);
      level = name;
      applyQuality();
    },

    /** 화면 페이드가 걷혔는가. */
    get revealed() {
      return veil === 0;
    },

    /** GPU 자원과 풀의 현황(누수·확인용). */
    info() {
      return {
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        programs: renderer.info.programs ? renderer.info.programs.length : 0,
        programNames: renderer.info.programs ? renderer.info.programs.map((p) => `#${p.id}`) : [],
        programKeys: renderer.info.programs ? renderer.info.programs.map((p) => p.cacheKey) : [],
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        sceneChildren: scene.children.length,
        floorsBuilt,
        quality: level,
        pixelRatio: renderer.getPixelRatio(),
        shadows: renderer.shadowMap.enabled,
        camera: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        focus: { x: focus.x, y: focus.y },
        shake,
        veil,
        compile: { count: compiles, lastMs: lastCompileMs },
        assets: assets.counts(),
        actors: actors.stats(),
        effects: effects.stats(),
        floor: floorView ? floorView.stats() : null,
        icons: floorView ? floorView.rewardIcons() : [],
      };
    },

    /** 씬(브라우저 검증·디버그용. 읽기만 한다). */
    get debugScene() {
      return scene;
    },

    /** 구역의 지금 밝기(방 공개 확인용). */
    regionBrightness(region) {
      return floorView ? floorView.brightnessOf(region) : null;
    },

    dispose() {
      leaveFloor();
      actors.dispose();
      effects.dispose();
      assets.dispose();
      veilGeometry.dispose();
      veilMaterial.dispose();
      if (sun.shadow.map) sun.shadow.map.dispose();
      renderer.dispose();
    },
  };
}
