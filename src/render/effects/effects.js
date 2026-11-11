// 이펙트: 투사체, 장판·예고 원, 바닥의 전리품, 입자, 피해 숫자. 모두 풀에서 꺼내 쓰고 층이 바뀌어도 다시 쓴다.
//   - 투사체·원·전리품: 상태를 매 프레임 그대로 비춘다(칸 채우기식 풀).
//   - 입자: Points 하나(버퍼 하나)에 자리를 돌려 쓴다.
//   - 피해 숫자: 스프라이트와 그 캔버스 텍스처를 풀에 두고, 숫자가 바뀔 때 캔버스만 다시 그린다.

import * as THREE from 'three';
import { LOOP, RENDER } from '../../../data/config.js';
import { defOf } from '../../logic/entities/defs.js';
import { isVisible } from '../../logic/entities/vision.js';
import { createPool, createSlots } from '../pool.js';

const TICK_SEC = 1 / LOOP.tickRate;
const MAX_PARTICLES = RENDER.quality.high.particles;
const MAX_NUMBERS = RENDER.quality.high.damageNumbers;
const C = RENDER.colors;

/** 기술의 예고 범위(부채꼴·원의 반지름). 없으면 0. */
function telegraphRadius(actor) {
  const ability = defOf(actor).abilities[actor.action.ability];
  let radius = 0;
  for (const effect of ability ? ability.effects : []) {
    if (effect.type === 'arc') radius = Math.max(radius, effect.range);
    else if (effect.type === 'circle') radius = Math.max(radius, effect.radius);
  }
  return radius;
}

export function createEffects({ scene, assets, rng }) {
  const meshSlots = (geometry, max) => createSlots({
    max,
    create() {
      const mesh = new THREE.Mesh(geometry, assets.flat(0xffffff));
      mesh.visible = false;
      scene.add(mesh);
      return mesh;
    },
    show(mesh, shown) {
      mesh.visible = shown;
    },
  });
  const projectiles = meshSlots(assets.geometries.orb, RENDER.pools.projectiles);
  const rings = meshSlots(assets.geometries.disc, RENDER.pools.rings);
  const drops = meshSlots(assets.geometries.gem, RENDER.pools.drops);

  // ── 입자 ──
  const positions = new Float32Array(MAX_PARTICLES * 3).fill(-999);
  const colors = new Float32Array(MAX_PARTICLES * 3);
  const velocity = new Float32Array(MAX_PARTICLES * 3);
  const life = new Float32Array(MAX_PARTICLES);
  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  particleGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const particleMaterial = new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, depthWrite: false });
  const points = new THREE.Points(particleGeometry, particleMaterial);
  points.frustumCulled = false;
  scene.add(points);
  let cursor = 0;
  let particleLimit = RENDER.quality.medium.particles;
  let hitParticles = RENDER.quality.medium.hitParticles;
  const tint = new THREE.Color();

  function burst(x, y, height, color, count) {
    tint.set(color);
    for (let n = 0; n < count; n++) {
      const i = cursor;
      cursor = (cursor + 1) % particleLimit;
      const angle = rng.float() * Math.PI * 2;
      const speed = 1.2 + rng.float() * 2.2;
      positions[i * 3] = x;
      positions[i * 3 + 1] = height;
      positions[i * 3 + 2] = y;
      velocity[i * 3] = Math.cos(angle) * speed;
      velocity[i * 3 + 1] = 1.5 + rng.float() * 2;
      velocity[i * 3 + 2] = Math.sin(angle) * speed;
      colors[i * 3] = tint.r;
      colors[i * 3 + 1] = tint.g;
      colors[i * 3 + 2] = tint.b;
      life[i] = RENDER.particleSec * (0.6 + rng.float() * 0.4);
    }
    particleGeometry.attributes.color.needsUpdate = true;
  }

  // ── 피해 숫자 ──
  let numberLimit = RENDER.quality.medium.damageNumbers;
  const numbers = createPool({
    max: MAX_NUMBERS,
    create() {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 64;
      const texture = new THREE.CanvasTexture(canvas);
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
      const sprite = new THREE.Sprite(material);
      sprite.renderOrder = 20;
      sprite.visible = false;
      scene.add(sprite);
      return { sprite, canvas, texture, material, age: 0, text: '' };
    },
    activate(item) {
      item.sprite.visible = true;
      item.age = 0;
    },
    deactivate(item) {
      item.sprite.visible = false;
    },
  });

  function showNumber(x, y, height, text, color, big) {
    // 품질이 정한 수를 넘으면 가장 오래된 것부터 거둔다.
    while (numbers.active.length >= numberLimit) numbers.release(numbers.active[0]);
    const item = numbers.acquire();
    const ctx = item.canvas.getContext('2d');
    ctx.clearRect(0, 0, 128, 64);
    ctx.font = `bold ${big ? 46 : 36}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(text, 64, 34);
    ctx.fillStyle = color;
    ctx.fillText(text, 64, 34);
    item.texture.needsUpdate = true;
    item.sprite.position.set(x + (rng.float() - 0.5) * 0.4, height, y);
    item.sprite.scale.set(1.5, 0.75, 1);
    item.material.opacity = 1;
  }

  return {
    setQuality(quality) {
      particleLimit = quality.particles;
      hitParticles = quality.hitParticles;
      numberLimit = quality.damageNumbers;
      cursor %= particleLimit;
      for (let i = particleLimit; i < MAX_PARTICLES; i++) {
        life[i] = 0;
        positions[i * 3 + 1] = -999;
      }
      particleGeometry.attributes.position.needsUpdate = true;
    },
    /** 피해가 들어갔을 때. */
    damage(x, y, height, amount, { crit, toPlayer, blocked }) {
      showNumber(x, y, height + 0.5, blocked && amount === 0 ? '막음' : String(amount), toPlayer ? C.damagePlayer : crit ? C.damageCrit : C.damage, crit);
      burst(x, y, height * 0.6, toPlayer ? 0xff6a6a : 0xfff0c0, crit ? hitParticles * 2 : hitParticles);
    },
    /** 글자를 띄운다(회복, 레벨 업 등). */
    text(x, y, height, text, color) {
      showNumber(x, y, height + 0.5, text, color, false);
    },
    burst,
    /**
     * @param {object} state 로직 상태(읽기만 한다)
     * @param {number} alpha
     * @param {number} dtSec
     */
    update(state, alpha, dtSec) {
      // 투사체: 이번 틱의 위치에서 속도만큼 되돌려 보간한다.
      projectiles.begin();
      const back = (1 - alpha) * TICK_SEC;
      for (const p of state.projectiles) {
        if (!isVisible(state, p.x, p.y)) continue;
        const mesh = projectiles.next();
        if (!mesh) break;
        mesh.material = assets.flat(p.faction === 'player' ? C.playerShot : C.enemyShot);
        mesh.scale.setScalar(p.radius);
        mesh.position.set(p.x - p.vx * back, 0.7, p.y - p.vy * back);
      }
      projectiles.end();

      // 장판(예고 중에는 노란 원이 차오른다)과 기술 예고.
      rings.begin();
      const ring = (x, y, radius, color, opacity, lift) => {
        const mesh = rings.next();
        if (!mesh) return;
        mesh.material = assets.flat(color, opacity);
        mesh.scale.setScalar(Math.max(0.01, radius));
        mesh.position.set(x, lift, y);
      };
      for (const hz of state.hazards) {
        if (!isVisible(state, hz.x, hz.y)) continue;
        // 한 번 터지고 끝나는 장판은 터지기 전까지 예고로, 남아서 되풀이하는 장판은 처음부터 위험 지역으로 그린다.
        if (hz.interval === 0 && state.tick < hz.nextAt) {
          ring(hz.x, hz.y, hz.radius, C.hazardWarn, 0.22, 0.02);
          const left = Math.min(1, (hz.nextAt - state.tick) / 60);
          ring(hz.x, hz.y, hz.radius * (1 - left), C.hazardWarn, 0.4, 0.025);
        } else {
          ring(hz.x, hz.y, hz.radius, C.hazardLive, 0.3, 0.02);
        }
      }
      for (const key of Object.keys(state.entities.byId)) {
        const actor = state.entities.byId[key];
        if (actor.dead || !actor.action || actor.action.phase !== 'windup' || actor.kind === 'player') continue;
        if (!isVisible(state, actor.x, actor.y)) continue;
        const radius = telegraphRadius(actor);
        if (radius > 0) ring(actor.x, actor.y, radius, C.telegraph, 0.18, 0.015);
      }
      rings.end();

      // 바닥의 전리품: 탐험한 칸이면 보인다.
      drops.begin();
      const bob = Math.sin(state.tick * 0.08) * 0.06;
      for (const drop of state.drops) {
        const cell = Math.floor(drop.y) * state.world.width + Math.floor(drop.x);
        if (state.vision.explored[cell] !== 1) continue;
        const mesh = drops.next();
        if (!mesh) break;
        const { loot } = drop;
        const color = loot.kind === 'gold' ? C.gold : loot.kind === 'consumable' ? C.consumable : loot.kind === 'relic' ? C.relic : C.rarity[loot.item.rarity];
        mesh.material = assets.flat(color);
        mesh.position.set(drop.x, 0.4 + bob, drop.y);
        mesh.rotation.y = state.tick * 0.03;
      }
      drops.end();

      // 입자
      let moving = false;
      for (let i = 0; i < particleLimit; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dtSec;
        moving = true;
        if (life[i] <= 0) {
          positions[i * 3 + 1] = -999;
          continue;
        }
        velocity[i * 3 + 1] -= 9 * dtSec;
        positions[i * 3] += velocity[i * 3] * dtSec;
        positions[i * 3 + 1] = Math.max(0.02, positions[i * 3 + 1] + velocity[i * 3 + 1] * dtSec);
        positions[i * 3 + 2] += velocity[i * 3 + 2] * dtSec;
      }
      if (moving) particleGeometry.attributes.position.needsUpdate = true;

      // 피해 숫자: 떠오르며 흐려진다.
      for (let i = numbers.active.length - 1; i >= 0; i--) {
        const item = numbers.active[i];
        item.age += dtSec;
        if (item.age >= RENDER.damageNumberSec) {
          numbers.release(item);
          continue;
        }
        item.sprite.position.y += dtSec * 1.4;
        item.material.opacity = 1 - (item.age / RENDER.damageNumberSec) ** 2;
      }
    },
    /** 층을 옮길 때: 떠 있는 것을 모두 거둔다(풀은 그대로 둔다). */
    clear() {
      numbers.releaseAll();
      life.fill(0);
      for (let i = 0; i < MAX_PARTICLES; i++) positions[i * 3 + 1] = -999;
      particleGeometry.attributes.position.needsUpdate = true;
    },
    stats() {
      return { projectiles: projectiles.stats(), rings: rings.stats(), drops: drops.stats(), numbers: numbers.stats() };
    },
    dispose() {
      for (const slots of [projectiles, rings, drops]) slots.forEach((mesh) => scene.remove(mesh));
      numbers.forEach((item) => {
        scene.remove(item.sprite);
        item.texture.dispose();
        item.material.dispose();
      });
      scene.remove(points);
      particleGeometry.dispose();
      particleMaterial.dispose();
    },
  };
}
