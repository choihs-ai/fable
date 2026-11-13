// 행동체 그리기: 플레이어·적·보스를 로우폴리 모델로 그리고, 걷기·공격·준비·피격·대시 자세를 매 프레임 계산한다.
//
// - 위치는 직전 틱과 이번 틱 사이를 alpha 로 보간한다. 처음 본 행동체·순간이동·틱을 건너뛴 경우는 보간하지 않는다.
// - 공격·피격은 이벤트로만 알 수 있으므로 renderer 가 이벤트를 받아 attack()/hurt() 를 부른다.
// - 쓰러진 적은 목록에서 사라지지만, 그 모델은 맞은 방향으로 튕겨 나가는 연출(FEEL.corpse)을 마친 뒤에야 풀로 돌아간다.
// - 모델은 생김새(종류)별로 풀에 모아 다시 쓴다. 모델은 공유 지오메트리·머티리얼만 쓰므로 GPU 자원을 늘리지 않는다.

import * as THREE from 'three';
import { LOOP, RENDER } from '../../../data/config.js';
import { FEEL } from '../../../data/feel.js';
import { WEAPONS } from '../../../data/weapons.js';
import { defOf } from '../../logic/entities/defs.js';
import { LOOKS, buildFigure, equip, lookOf } from './models.js';
import { SWING, corpseAt, poseOf } from './pose.js';

const TICK_SEC = 1 / LOOP.tickRate;
const STATUS_COLORS = { burn: 0xff7a3a, freeze: 0x8ae4ff, slow: 0x5a8aff, stun: 0xffe14a, poison: 0x7ad35a, bleed: 0xd83a4a, warp: 0x8a7cff };
const STATUS_PRIORITY = ['freeze', 'stun', 'warp', 'burn', 'poison', 'bleed', 'slow'];
const ATTACK_SEC = 0.28;

/** 모델의 키(풀의 서랍): 생김새와 정예 여부. */
const keyOf = (type, elite) => `${type}${elite ? ':elite' : ''}`;
/** 플레이어의 생김새는 캐릭터로 정한다. */
const lookKeyOf = (actor) => (actor.kit ? actor.kit.character : actor.type);
/** 적이 쓰는 무기 모양. 플레이어는 든 무기. */
function weaponLookOf(actor, look) {
  if (actor.kit) {
    const id = actor.kit.weapons[actor.kit.slot];
    return id ? WEAPONS[id].look : null;
  }
  return look.weapon === undefined ? 'claw' : look.weapon;
}

export function createActorViews({ scene, assets }) {
  /** 키 → 쉬고 있는 모델들. */
  const free = new Map();
  /** 행동체 id → 뷰. */
  const views = new Map();
  /** 쓰러져 날아가는 중인 뷰. */
  const corpses = [];
  let created = 0;
  let lastTick = -1;
  let clock = 0;
  const barBack = [];

  function acquire(key, look, elite) {
    const list = free.get(key);
    if (list && list.length > 0) {
      const fig = list.pop();
      fig.root.visible = true;
      return fig;
    }
    created++;
    const fig = buildFigure(assets, look, { elite });
    // 체력 막대(적만 쓴다)와 상태이상 고리.
    fig.bar = new THREE.Group();
    const back = new THREE.Mesh(assets.geometries.bar, assets.materials.barBack);
    const fill = new THREE.Mesh(assets.geometries.bar, assets.materials.barFill);
    back.position.x = -0.5;
    fill.position.x = -0.5;
    back.renderOrder = 10;
    fill.renderOrder = 11;
    fig.bar.add(back, fill);
    fig.barFill = fill;
    fig.bar.visible = false;
    scene.add(fig.bar);
    barBack.push(fig.bar);
    fig.ring = new THREE.Mesh(assets.geometries.ring, assets.flat(0xffffff, 0.8));
    fig.ring.position.y = 0.02;
    fig.ring.visible = false;
    fig.root.add(fig.ring);
    scene.add(fig.root);
    return fig;
  }

  function release(view) {
    const { fig } = view;
    fig.root.visible = false;
    fig.bar.visible = false;
    setFlash(fig, false);
    if (!free.has(view.key)) free.set(view.key, []);
    free.get(view.key).push(fig);
  }

  function setFlash(fig, on) {
    if (fig.flashing === on) return;
    fig.flashing = on;
    for (const p of fig.parts) p.mesh.material = on ? assets.materials.flash : p.material;
  }

  function createView(actor) {
    const lookKey = lookKeyOf(actor);
    const look = lookOf(lookKey);
    const key = keyOf(lookKey, actor.elite);
    const fig = acquire(key, look, actor.elite);
    const view = {
      key, lookKey, fig, look, id: actor.id, kind: actor.kind,
      prevX: actor.x, prevY: actor.y, x: actor.x, y: actor.y,
      walk: 0, speed: 0, yaw: Math.atan2(actor.facingX, actor.facingY), weaponLook: undefined,
      attackAt: -1, swing: 'slash', hurtAt: -1, flashUntil: -1, offhand: false,
    };
    const size = actor.radius / 0.32;
    fig.root.scale.setScalar(look.form === 'biped' && actor.kind !== 'boss' ? Math.max(0.85, Math.min(1.3, size)) : actor.kind === 'boss' ? 1 : size);
    if (actor.elite) fig.root.scale.multiplyScalar(1.15);
    fig.shadow.scale.setScalar(actor.radius * 1.25 / fig.root.scale.x);
    return view;
  }

  function syncWeapon(view, actor) {
    const look = weaponLookOf(actor, view.look);
    if (look === view.weaponLook) return;
    view.weaponLook = look;
    equip(assets, view.fig, look);
  }

  function windupOf(actor) {
    if (!actor.action || actor.action.phase !== 'windup') return -1;
    const ability = defOf(actor).abilities[actor.action.ability];
    const total = Math.max(1, Math.round((ability && ability.windup ? ability.windup : 0) * LOOP.tickRate));
    return 1 - Math.max(0, actor.action.until - lastTick) / total;
  }

  function pose(view, actor, alpha, dtSec) {
    const { fig } = view;
    const x = view.prevX + (view.x - view.prevX) * alpha;
    const y = view.prevY + (view.y - view.prevY) * alpha;
    fig.root.position.set(x, 0, y);
    // 바라보는 방향: 짧은 쪽으로 돌린다.
    const target = Math.atan2(actor.facingX, actor.facingY);
    let d = target - view.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    view.yaw += d * Math.min(1, dtSec * 18);
    fig.root.rotation.y = view.yaw;

    // 걸음: 실제로 움직인 거리만큼 위상이 돈다.
    const moved = Math.hypot(view.x - view.prevX, view.y - view.prevY) / TICK_SEC;
    const speedNow = Math.min(1, moved / Math.max(1, actor.speed));
    view.speed += (speedNow - view.speed) * Math.min(1, dtSec * 12);
    view.walk += moved * dtSec * 4.2 / Math.max(0.6, view.look.scale);
    const attackT = view.attackAt >= 0 ? (clock - view.attackAt) / ATTACK_SEC : -1;
    if (attackT > 1) view.attackAt = -1;
    const hurt = view.hurtAt >= 0 ? Math.max(0, 1 - (clock - view.hurtAt) / 0.25) : 0;
    const p = poseOf({
      walk: view.walk, speed: view.speed, attack: attackT > 1 ? -1 : attackT, swing: view.swing, windup: windupOf(actor),
      hurt, dash: actor.dash !== null, time: clock + view.id,
    });
    const { body } = fig;
    body.position.y = (fig.form === 'bat' ? fig.hover + Math.sin(clock * 9 + view.id) * 0.08 : fig.hipY) + p.bob;
    body.rotation.set(p.lean, p.twist, 0);
    body.scale.set(1, p.squash, 1);
    if (fig.form === 'biped') {
      fig.legL.rotation.x = p.legL;
      fig.legR.rotation.x = p.legR;
      // 좀비는 두 팔을 앞으로 내밀고 걷는다.
      fig.armL.rotation.set(view.look.reach ? -1.3 + p.armL * 0.2 : p.armL, 0, -0.08);
      fig.armR.rotation.set(view.look.reach ? -1.3 + p.armR * 0.2 : p.armR, 0, p.armRSide * 0.5 + 0.08);
      if (view.offhand && attackT >= 0 && attackT <= 1) fig.armL.rotation.x = p.armR;
      if (fig.weapon) fig.weapon.position.y = -p.weaponPush;
      fig.head.rotation.x = p.head;
    } else if (fig.form === 'bat') {
      const flap = Math.sin(clock * 22 + view.id) * 0.9;
      fig.wings[0].rotation.z = flap;
      fig.wings[1].rotation.z = -flap;
    } else if (fig.form === 'blob') {
      // 말랑하게: 움직일 때는 통통 튀고, 서 있을 때는 숨 쉬듯 조금 부푼다.
      const bounce = Math.sin(view.walk * 2.2) * 0.14 * view.speed + Math.sin(clock * 3 + view.id) * 0.04;
      body.scale.set(1 - bounce * 0.6, p.squash * (1 + bounce), 1 - bounce * 0.6);
    } else if (fig.quadLegs) {
      fig.quadLegs.forEach((leg, i) => {
        leg.rotation.x = Math.sin(view.walk * 1.6 + (i % 2 === 0 ? 0 : Math.PI) + (i > 1 ? Math.PI : 0)) * 0.7 * view.speed;
      });
    }
    // 맞았을 때 하얗게 번쩍인다.
    setFlash(fig, clock < view.flashUntil);

    // 상태이상 고리.
    let status = null;
    for (const id of STATUS_PRIORITY) {
      if (actor.statuses[id]) {
        status = id;
        break;
      }
    }
    fig.ring.visible = status !== null;
    if (status) {
      fig.ring.material = assets.flat(STATUS_COLORS[status], 0.75);
      fig.ring.scale.setScalar((actor.radius + 0.18) / fig.root.scale.x);
    }
    // 체력 막대: 다친 적만.
    const showBar = actor.kind === 'enemy' && actor.hp < actor.maxHp;
    fig.bar.visible = showBar;
    if (showBar) {
      const height = (fig.height * view.look.scale + 0.2) * fig.root.scale.x;
      fig.bar.position.set(x, height, y);
      fig.bar.scale.setScalar(Math.max(0.6, actor.radius * 2));
      fig.barFill.scale.x = Math.max(0, actor.hp / actor.maxHp);
      fig.barFill.material = actor.elite ? assets.materials.barBoss : assets.materials.barFill;
    }
  }

  return {
    /**
     * @param {object} state 로직 상태(읽기만 한다)
     * @param {number} alpha
     * @param {number} dtSec
     * @param {number} time 렌더러의 시계(초)
     */
    update(state, alpha, dtSec, time) {
      clock = time;
      const tickChanged = state.tick !== lastTick;
      const seen = new Set();
      for (const key of Object.keys(state.entities.byId)) {
        const actor = state.entities.byId[key];
        seen.add(actor.id);
        let view = views.get(actor.id);
        // 탈을 바꿔 썼으면 생김새가 달라진다: 앞의 모델을 돌려놓고 새 모델로 바꾼다(자리·방향·걸음은 잇는다).
        if (view && actor.kit && view.lookKey !== actor.kit.character) {
          const old = view;
          release(old);
          view = createView(actor);
          Object.assign(view, { prevX: old.prevX, prevY: old.prevY, x: old.x, y: old.y, yaw: old.yaw, walk: old.walk, speed: old.speed });
          view.flashUntil = clock + 0.12;
          views.set(actor.id, view);
        }
        if (!view) {
          view = createView(actor);
          views.set(actor.id, view);
        } else if (tickChanged) {
          view.prevX = view.x;
          view.prevY = view.y;
          // 한 틱에 2칸 넘게 움직였으면 순간이동이다. 보간하지 않는다.
          if (Math.hypot(actor.x - view.x, actor.y - view.y) > 2 || state.tick - lastTick > 3) {
            view.prevX = actor.x;
            view.prevY = actor.y;
          }
        }
        view.x = actor.x;
        view.y = actor.y;
        syncWeapon(view, actor);
        if (actor.dead && actor.kind === 'player') {
          // 쓰러진 플레이어: 누운 자세.
          view.fig.root.position.set(actor.x, 0, actor.y);
          view.fig.body.rotation.set(-Math.PI / 2 + 0.2, 0, 0);
          view.fig.body.position.y = 0.2;
          setFlash(view.fig, false);
          continue;
        }
        pose(view, actor, alpha, dtSec);
      }
      // 목록에서 사라진 행동체: 쓰러짐 연출이 걸려 있지 않으면 바로 돌려놓는다.
      for (const [id, view] of views) {
        if (seen.has(id)) continue;
        views.delete(id);
        if (!view.dying) release(view);
      }
      // 쓰러져 날아가는 몸.
      for (let i = corpses.length - 1; i >= 0; i--) {
        const c = corpses[i];
        c.t += dtSec;
        const life = FEEL.corpse.life;
        if (c.t >= life) {
          corpses.splice(i, 1);
          c.view.dying = false;
          release(c.view);
          continue;
        }
        const at = corpseAt(c.motion, c.t);
        const { fig } = c.view;
        fig.root.position.set(c.x + at.dx, at.h, c.y + at.dz);
        fig.body.rotation.set(-at.roll, fig.body.rotation.y, 0);
        const fade = 1 - Math.max(0, (c.t - life * 0.6) / (life * 0.4));
        fig.root.scale.setScalar(c.scale * Math.max(0.05, fade));
        fig.bar.visible = false;
        fig.ring.visible = false;
        setFlash(fig, c.t < FEEL.flash.hit);
      }
      lastTick = state.tick;
    },
    /** 공격 자세를 시작한다(이벤트로 안다). weaponLook 을 주면 그 무기의 휘두름. */
    attack(id, weaponLook, offhand = false) {
      const view = views.get(id);
      if (!view) return;
      view.attackAt = clock;
      view.swing = SWING[weaponLook ?? view.weaponLook ?? 'none'] ?? 'slash';
      view.offhand = offhand;
    },
    /** 맞았다: 번쩍이고 움찔한다. */
    hurt(id, isPlayer) {
      const view = views.get(id);
      if (!view) return;
      view.hurtAt = clock;
      view.flashUntil = clock + (isPlayer ? FEEL.flash.hurt : FEEL.flash.hit);
    },
    /**
     * 쓰러졌다: 그 몸을 맞은 방향으로 튕겨 보낸다. kbX/kbY 가 작으면 fromX/fromY 의 반대쪽으로.
     */
    die(id, { x, y, kbX, kbY, fromX, fromY }) {
      const view = views.get(id);
      if (!view || view.kind === 'player') return;
      let vx = kbX * FEEL.corpse.speedMul;
      let vy = kbY * FEEL.corpse.speedMul;
      const speed = Math.hypot(vx, vy);
      if (speed < FEEL.corpse.minSpeed) {
        let dx = x - fromX;
        let dy = y - fromY;
        const d = Math.hypot(dx, dy) || 1;
        dx /= d;
        dy /= d;
        vx = dx * FEEL.corpse.minSpeed;
        vy = dy * FEEL.corpse.minSpeed;
      }
      view.dying = true;
      corpses.push({ view, x, y, t: 0, scale: view.fig.root.scale.x, motion: { vx, vy, up: FEEL.corpse.up, gravity: FEEL.corpse.gravity, spin: FEEL.corpse.spin } });
      // 같은 몸이 corpses 에 있는 동안 새 행동체에 쓰이지 않도록 views 에서 미리 뺀다.
      views.delete(id);
    },
    /** 손끝(총구) 위치: 총구 섬광·탄피용. */
    muzzleOf(id) {
      const view = views.get(id);
      if (!view || !view.fig.hand) return null;
      const v = new THREE.Vector3(0, -(view.fig.tip ?? 0.3), 0);
      view.fig.hand.localToWorld(v);
      return v;
    },
    /** 화면에 그리고 있는 위치(카메라 추적용). */
    positionOf(id) {
      const view = views.get(id);
      return view ? { x: view.fig.root.position.x, y: view.fig.root.position.z } : null;
    },
    /** 미리 컴파일용: 모든 생김새를 하나씩 만들어 둔다(층에 들어갈 때 셰이더가 처음 쓰이며 멈칫하지 않도록). */
    prewarm() {
      const made = [];
      for (const type of Object.keys(LOOKS)) {
        for (const elite of [false, true]) {
          const fig = acquire(keyOf(type, elite), LOOKS[type], elite);
          for (const look of Object.values(WEAPONS).map((w) => w.look)) equip(assets, fig, look);
          equip(assets, fig, null);
          setFlash(fig, true);
          made.push({ fig, key: keyOf(type, elite) });
        }
      }
      return () => {
        for (const { fig, key } of made) release({ fig, key });
      };
    },
    clear() {
      for (const view of views.values()) release(view);
      views.clear();
      for (const c of corpses) release(c.view);
      corpses.length = 0;
      lastTick = -1;
    },
    stats() {
      let resting = 0;
      for (const list of free.values()) resting += list.length;
      return { created, active: views.size, corpses: corpses.length, free: resting, max: RENDER.pools.actors };
    },
    dispose() {
      this.clear();
      for (const list of free.values()) for (const fig of list) scene.remove(fig.root);
      for (const bar of barBack) scene.remove(bar);
      free.clear();
    },
  };
}
