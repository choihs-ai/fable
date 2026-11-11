// 이펙트: 투사체, 바닥 표시(장판·예고선·적이 나타날 자리), 바닥의 전리품, 광선·번개·폭발, 총구 섬광·탄피, 입자, 피해 숫자.
// 모두 풀에서 꺼내 쓰고 층이 바뀌어도 다시 쓴다.
//   - 투사체·바닥 표시·전리품: 상태를 매 프레임 그대로 비춘다(칸 채우기식 풀).
//   - 광선·번개·폭발·섬광·탄피: 이벤트로 시작해 짧게 살다 사라진다(꺼내고 돌려놓는 풀).
//   - 입자: Points 하나(버퍼 하나)에 자리를 돌려 쓴다.
//   - 피해 숫자: 스프라이트와 그 캔버스 텍스처를 풀에 두고, 숫자가 바뀔 때 캔버스만 다시 그린다.
//
// 적의 탄은 "읽을 수 있게": 크고 따뜻한 색의 빛나는 공 + 밝은 테두리 + 바닥 그림자. 플레이어의 탄은 작고 차가운 색.
// 적의 공격 준비(예고)는 바닥에 범위를 그린다: 부채꼴·원은 차오르는 면, 투사체·돌진은 진행 방향의 선.

import * as THREE from 'three';
import { LOOP, RENDER } from '../../../data/config.js';
import { ENCOUNTERS } from '../../../data/encounters.js';
import { FEEL } from '../../../data/feel.js';
import { WEAPONS } from '../../../data/weapons.js';
import { defOf } from '../../logic/entities/defs.js';
import { buildWeapon } from '../entities/models.js';
import { createPool, createSlots } from '../pool.js';

const TICK_SEC = 1 / LOOP.tickRate;
const MAX_PARTICLES = RENDER.quality.high.particles;
const MAX_NUMBERS = RENDER.quality.high.damageNumbers;
const MAX_CASINGS = RENDER.quality.high.casings;
const C = RENDER.colors;
const CHAIN_POINTS = 24;

export function createEffects({ scene, assets, rng }) {
  const added = [];
  const add = (o) => {
    scene.add(o);
    added.push(o);
    return o;
  };
  // ── 투사체 ──
  const projectiles = createSlots({
    max: RENDER.pools.projectiles,
    create() {
      const group = new THREE.Group();
      const core = new THREE.Mesh(assets.geometries.orb, assets.glow(0xffffff));
      const halo = new THREE.Mesh(assets.geometries.orb, assets.glow(0xffffff, 0.35));
      const shadow = new THREE.Mesh(assets.geometries.disc, assets.materials.shadow);
      shadow.position.y = -0.69;
      group.add(core, halo, shadow);
      group.visible = false;
      add(group);
      return { group, core, halo, shadow };
    },
    show(item, shown) {
      item.group.visible = shown;
    },
  });

  // ── 바닥 표시: 장판, 예고, 나타날 자리 ──
  const ground = createSlots({
    max: RENDER.pools.rings,
    create() {
      const mesh = new THREE.Mesh(assets.geometries.disc, assets.flat(0xffffff));
      mesh.visible = false;
      mesh.renderOrder = 2;
      add(mesh);
      return mesh;
    },
    show(mesh, shown) {
      mesh.visible = shown;
    },
  });

  // ── 바닥의 전리품 ──
  const drops = createSlots({
    max: RENDER.pools.drops,
    create() {
      const group = new THREE.Group();
      const mesh = (geometry, material, s) => {
        const m = new THREE.Mesh(assets.geometries[geometry], material);
        m.scale.setScalar(s);
        m.visible = false;
        group.add(m);
        return m;
      };
      const item = {
        group,
        gold: mesh('coin', assets.toon(C.gold), 0.16),
        energy: mesh('star', assets.glow(C.energy, 0.95), 0.16),
        health: mesh('orb', assets.toon(C.health, 0x400000), 0.17),
        boon: mesh('orb', assets.glow(C.boon.none, 0.95), 0.26),
        halo: mesh('ring', assets.glow(0xffffff, 0.4), 0.45),
        pedestal: mesh('tube', assets.toon(0x4a4a52), 0.3),
        weapons: {},
        shown: null,
      };
      item.pedestal.scale.set(0.32, 0.25, 0.32);
      item.halo.position.y = 0.02;
      group.visible = false;
      add(group);
      return item;
    },
    show(item, shown) {
      item.group.visible = shown;
    },
  });
  function showDrop(item, kind, weapon) {
    const key = kind === 'weapon' ? `w:${weapon}` : kind;
    if (item.shown === key) return;
    for (const name of ['gold', 'energy', 'health', 'boon', 'pedestal']) item[name].visible = false;
    for (const group of Object.values(item.weapons)) group.visible = false;
    if (kind === 'weapon') {
      const look = WEAPONS[weapon].look;
      if (!item.weapons[look]) {
        const built = buildWeapon(assets, look).group;
        built.rotation.z = Math.PI / 2;
        item.group.add(built);
        item.weapons[look] = built;
      }
      item.weapons[look].visible = true;
      item.pedestal.visible = true;
    } else item[kind].visible = true;
    item.halo.visible = kind === 'boon' || kind === 'weapon';
    item.shown = key;
  }

  // ── 짧게 사는 것: 광선, 폭발, 총구 섬광, 번개 ──
  const flashes = createPool({
    max: RENDER.pools.lines,
    create() {
      const mesh = new THREE.Mesh(assets.geometries.beam, assets.glow(0xffffff));
      mesh.visible = false;
      add(mesh);
      return { mesh, age: 0, life: 0, kind: 'beam', size: 1 };
    },
    activate(item) {
      item.mesh.visible = true;
      item.age = 0;
    },
    deactivate(item) {
      item.mesh.visible = false;
    },
  });
  const chains = createPool({
    max: 8,
    create() {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CHAIN_POINTS * 3), 3));
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xfff27a, transparent: true }));
      line.frustumCulled = false;
      line.visible = false;
      add(line);
      return { line, geometry, age: 0 };
    },
    activate(item) {
      item.line.visible = true;
      item.age = 0;
    },
    deactivate(item) {
      item.line.visible = false;
    },
  });

  // ── 탄피 ──
  let casingLimit = RENDER.quality.medium.casings;
  const casings = createPool({
    max: MAX_CASINGS,
    create() {
      const mesh = new THREE.Mesh(assets.geometries.cube, assets.toon(0xd8b04a));
      mesh.scale.set(0.05, 0.05, 0.1);
      mesh.visible = false;
      add(mesh);
      return { mesh, vx: 0, vy: 0, vz: 0, age: 0 };
    },
    activate(item) {
      item.mesh.visible = true;
      item.age = 0;
    },
    deactivate(item) {
      item.mesh.visible = false;
    },
  });

  // ── 입자 ──
  const positions = new Float32Array(MAX_PARTICLES * 3).fill(-999);
  const colors = new Float32Array(MAX_PARTICLES * 3);
  const velocity = new Float32Array(MAX_PARTICLES * 3);
  const life = new Float32Array(MAX_PARTICLES);
  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  particleGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const particleMaterial = new THREE.PointsMaterial({ size: 0.15, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const points = new THREE.Points(particleGeometry, particleMaterial);
  points.frustumCulled = false;
  add(points);
  let cursor = 0;
  let particleLimit = RENDER.quality.medium.particles;
  let hitParticles = RENDER.quality.medium.hitParticles;
  const tint = new THREE.Color();

  function burst(x, y, height, color, count, speedMul = 1) {
    tint.set(color);
    for (let n = 0; n < count; n++) {
      const i = cursor;
      cursor = (cursor + 1) % particleLimit;
      const angle = rng.float() * Math.PI * 2;
      const speed = (1.2 + rng.float() * 2.4) * speedMul;
      positions[i * 3] = x;
      positions[i * 3 + 1] = height;
      positions[i * 3 + 2] = y;
      velocity[i * 3] = Math.cos(angle) * speed;
      velocity[i * 3 + 1] = 1.2 + rng.float() * 2.2;
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
      add(sprite);
      return { sprite, canvas, texture, material, age: 0, big: false };
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
    ctx.font = `900 ${big ? 50 : 36}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText(text, 64, 34);
    ctx.fillStyle = color;
    ctx.fillText(text, 64, 34);
    item.texture.needsUpdate = true;
    item.sprite.position.set(x + (rng.float() - 0.5) * 0.5, height, y);
    item.big = big;
    item.sprite.scale.set(big ? 1.9 : 1.4, big ? 0.95 : 0.7, 1);
    item.material.opacity = 1;
  }

  /** 짧게 빛나는 것 하나. */
  function flash(kind, life, setup) {
    const item = flashes.acquire();
    item.kind = kind;
    item.life = life;
    setup(item.mesh);
    item.base = item.mesh.scale.clone();
    return item;
  }

  /** 바닥 표시 하나를 꺼내 모양·색·자리를 정한다. */
  function mark(geometry, material, x, y, lift, sx, sz = sx, yaw = 0) {
    const mesh = ground.next();
    if (!mesh) return;
    mesh.geometry = geometry;
    mesh.material = material;
    mesh.position.set(x, lift, y);
    mesh.scale.set(sx, 1, sz);
    mesh.rotation.set(0, yaw, 0);
  }

  /** 적의 공격 준비를 바닥에 그린다. */
  function telegraph(actor, tick) {
    const action = actor.action;
    const ability = defOf(actor).abilities[action.ability];
    if (!ability) return;
    const total = Math.max(1, Math.round((ability.windup ?? 0) * LOOP.tickRate));
    const t = 1 - Math.max(0, action.until - tick) / total;
    const yaw = Math.atan2(action.dirX, action.dirY);
    const g = assets.geometries;
    const warm = assets.flat(C.telegraph, 0.16 + 0.22 * t);
    const edge = assets.flat(C.telegraph, 0.55);
    for (const e of ability.effects) {
      if (e.type === 'arc') {
        const sector = assets.sector(e.cosHalf);
        mark(sector, assets.flat(C.telegraph, 0.18), actor.x, actor.y, 0.02, e.range, e.range, yaw);
        // 차오르는 부분: 준비가 끝나는 순간 꽉 찬다.
        mark(sector, warm, actor.x, actor.y, 0.025, e.range * t, e.range * t, yaw);
      } else if (e.type === 'circle') {
        mark(g.disc, assets.flat(C.telegraph, 0.16), actor.x, actor.y, 0.02, e.radius);
        mark(g.disc, warm, actor.x, actor.y, 0.025, e.radius * t);
        mark(g.ring, edge, actor.x, actor.y, 0.03, e.radius);
      } else if (e.type === 'projectile') {
        const length = Math.min(e.range, 11);
        for (const [c, s] of e.spread ?? [[1, 0]]) {
          const dx = action.dirX * c - action.dirY * s;
          const dy = action.dirX * s + action.dirY * c;
          mark(g.strip, assets.flat(C.telegraph, 0.12 + 0.3 * t), actor.x, actor.y, 0.03, e.radius * 2 + 0.08, length, Math.atan2(dx, dy));
        }
      } else if (e.type === 'dash') {
        mark(g.strip, warm, actor.x, actor.y, 0.03, actor.radius * 2, e.distance, yaw);
      } else if (e.type === 'hazard') {
        for (const [ox, oy] of e.offsets ?? [[0, 0]]) {
          mark(g.disc, warm, action.targetX + ox, action.targetY + oy, 0.02, e.radius);
          mark(g.ring, edge, action.targetX + ox, action.targetY + oy, 0.03, e.radius);
        }
      } else if (e.type === 'summon' || e.type === 'teleport') {
        mark(g.ring, assets.flat(0xc79bff, 0.6), actor.x, actor.y, 0.03, actor.radius + 0.6 * t + 0.2);
      }
    }
  }

  return {
    setQuality(quality) {
      particleLimit = quality.particles;
      hitParticles = quality.hitParticles;
      numberLimit = quality.damageNumbers;
      casingLimit = quality.casings;
      cursor %= particleLimit;
      for (let i = particleLimit; i < MAX_PARTICLES; i++) {
        life[i] = 0;
        positions[i * 3 + 1] = -999;
      }
      particleGeometry.attributes.position.needsUpdate = true;
    },
    /** 피해가 들어갔을 때. */
    damage(x, y, height, amount, { crit, toPlayer, proc }) {
      const color = toPlayer ? C.damagePlayer : crit ? C.damageCrit : proc ? C.damageProc : C.damage;
      showNumber(x, y, height + 0.5, String(amount), color, crit || toPlayer);
      burst(x, y, height * 0.6, toPlayer ? 0xff5a5a : crit ? 0xffd34a : 0xfff0c0, crit ? hitParticles * 2 : hitParticles);
    },
    /** 글자를 띄운다(금화, 회복, 알림). */
    text(x, y, height, text, color) {
      showNumber(x, y, height + 0.5, text, color, false);
    },
    burst,
    /** 광선: 시작점에서 끝점까지 잠깐 빛나는 기둥. */
    beam(x0, y0, x1, y1, width, faction) {
      const length = Math.hypot(x1 - x0, y1 - y0);
      flash('beam', 0.09, (mesh) => {
        mesh.material = assets.glow(faction === 'player' ? 0x7af0ff : C.enemyShot, 0.9);
        mesh.geometry = assets.geometries.beam;
        mesh.position.set(x0, 0.75, y0);
        mesh.rotation.set(0, Math.atan2(x1 - x0, y1 - y0), 0);
        mesh.scale.set(width * 1.6, width * 1.2, Math.max(0.01, length));
      });
    },
    /** 폭발: 퍼지는 고리 + 섬광 + 입자. */
    explosion(x, y, radius, faction, proc) {
      const color = proc === 'ice' ? 0x8ae4ff : proc === 'bolt' ? 0xfff27a : proc === 'steam' ? 0xf0f0ff : faction === 'player' ? 0xffa23a : C.enemyShot;
      flash('ring', 0.28, (mesh) => {
        mesh.geometry = assets.geometries.ring;
        mesh.material = assets.glow(color, 0.8);
        mesh.position.set(x, 0.05, y);
        mesh.rotation.set(0, 0, 0);
        mesh.scale.setScalar(radius);
      });
      flash('orb', 0.16, (mesh) => {
        mesh.geometry = assets.geometries.orb;
        mesh.material = assets.glow(color, 0.6);
        mesh.position.set(x, 0.5, y);
        mesh.scale.setScalar(radius * 0.6);
      });
      burst(x, y, 0.5, color, Math.round(hitParticles * 2.5), 1.4);
    },
    /** 총구 섬광. */
    muzzle(point, dirX, dirY, color = 0xffe08a) {
      if (!point) return;
      flash('muzzle', FEEL.muzzle.sec, (mesh) => {
        mesh.geometry = assets.geometries.star;
        mesh.material = assets.glow(color, 1);
        mesh.position.copy(point);
        mesh.rotation.set(0, Math.atan2(dirX, dirY), 0);
        mesh.scale.set(FEEL.muzzle.size * 0.6, FEEL.muzzle.size * 0.6, FEEL.muzzle.size * 1.3);
      });
    },
    /** 탄피 하나: 총의 옆으로 튀어 나가 바닥에 떨어진다. */
    casing(point, dirX, dirY) {
      if (!point || casingLimit <= 0) return;
      while (casings.active.length >= casingLimit) casings.release(casings.active[0]);
      const item = casings.acquire();
      // 오른쪽(진행 방향의 수직)으로 튄다.
      const side = FEEL.casing.speed * (0.7 + rng.float() * 0.6);
      item.vx = -dirY * side + (rng.float() - 0.5);
      item.vz = dirX * side + (rng.float() - 0.5);
      item.vy = FEEL.casing.up * (0.8 + rng.float() * 0.4);
      item.mesh.position.copy(point);
      item.mesh.rotation.set(rng.float() * 3, rng.float() * 3, 0);
    },
    /** 번개: 점들을 들쭉날쭉한 선으로 잇는다. */
    chain(points) {
      if (points.length < 2) return;
      const item = chains.acquire();
      const array = item.geometry.attributes.position.array;
      const per = Math.floor((CHAIN_POINTS - 1) / (points.length - 1));
      let k = 0;
      for (let p = 0; p < points.length - 1; p++) {
        const a = points[p];
        const b = points[p + 1];
        for (let s = 0; s < per; s++) {
          const t = s / per;
          const jitter = s === 0 ? 0 : (rng.float() - 0.5) * 0.45;
          array[k * 3] = a.x + (b.x - a.x) * t + jitter;
          array[k * 3 + 1] = 0.8 + (rng.float() - 0.5) * 0.3;
          array[k * 3 + 2] = a.y + (b.y - a.y) * t - jitter;
          k++;
        }
      }
      const last = points[points.length - 1];
      while (k < CHAIN_POINTS) {
        array[k * 3] = last.x;
        array[k * 3 + 1] = 0.8;
        array[k * 3 + 2] = last.y;
        k++;
      }
      item.geometry.attributes.position.needsUpdate = true;
      for (const p of points) burst(p.x, p.y, 0.8, 0xfff27a, 3, 0.8);
    },
    /**
     * 상태를 비춘다.
     * @param {object} state 로직 상태(읽기만 한다)
     * @param {number} alpha
     * @param {number} dtSec
     * @param {number} time
     */
    update(state, alpha, dtSec, time) {
      // 투사체: 이번 틱의 위치에서 속도만큼 되돌려 보간한다.
      projectiles.begin();
      const back = (1 - alpha) * TICK_SEC;
      for (const p of state.projectiles) {
        const item = projectiles.next();
        if (!item) break;
        const enemy = p.faction !== 'player';
        const x = p.x - p.vx * back;
        const y = p.y - p.vy * back;
        item.group.position.set(x, 0.7, y);
        if (enemy) {
          const pulse = 1 + Math.sin(time * 20 + p.id) * 0.08;
          item.core.material = assets.glow(C.enemyShotRim, 1);
          item.core.scale.setScalar(p.radius * 0.75);
          item.halo.material = assets.glow(C.enemyShot, 0.75);
          item.halo.scale.setScalar(p.radius * 1.45 * pulse);
          item.shadow.scale.setScalar(p.radius * 1.3);
          item.group.rotation.set(0, 0, 0);
        } else {
          // 플레이어의 탄: 날아가는 방향으로 길쭉하게.
          item.core.material = assets.glow(p.explode ? 0xffb05a : C.playerShot, 1);
          item.halo.material = assets.glow(p.explode ? 0xff7a2a : 0x3ab0ff, 0.35);
          const s = p.radius;
          item.core.scale.set(s * 0.8, s * 0.8, s * 2.4);
          item.halo.scale.set(s * 1.4, s * 1.4, s * 3.2);
          item.shadow.scale.setScalar(s);
          item.group.rotation.set(0, Math.atan2(p.vx, p.vy), 0);
        }
      }
      projectiles.end();

      // 바닥 표시.
      ground.begin();
      const g = assets.geometries;
      for (const hz of state.hazards) {
        if (hz.kind === 'warp') {
          const left = Math.max(0, hz.endAt - state.tick);
          mark(g.disc, assets.flat(C.warp, left < 60 ? 0.12 + 0.1 * Math.sin(time * 20) : 0.22), hz.x, hz.y, 0.02, hz.radius);
          mark(g.ring, assets.glow(C.warp, 0.7), hz.x, hz.y, 0.03, hz.radius * (0.96 + 0.04 * Math.sin(time * 4)), hz.radius, time * 0.6);
          continue;
        }
        // 한 번 터지고 끝나는 장판은 터지기 전까지 예고(차오르는 원)로, 남아서 되풀이하는 장판은 위험 지역으로 그린다.
        const own = hz.faction === 'player';
        if (hz.interval === 0 && state.tick < hz.nextAt) {
          const fill = 1 - Math.min(1, (hz.nextAt - state.tick) / 60);
          mark(g.disc, assets.flat(C.hazardWarn, 0.2), hz.x, hz.y, 0.02, hz.radius);
          mark(g.disc, assets.flat(C.hazardWarn, 0.45), hz.x, hz.y, 0.025, hz.radius * fill);
          mark(g.ring, assets.flat(C.hazardWarn, 0.8), hz.x, hz.y, 0.03, hz.radius);
        } else {
          mark(g.disc, own ? assets.glow(0xff7a2a, 0.35) : assets.flat(C.hazardLive, 0.32), hz.x, hz.y, 0.02, hz.radius);
        }
      }
      // 적이 나타날 자리: 붉은 고리가 조여 든다.
      if (state.encounter) {
        for (const spawn of state.encounter.pending) {
          const left = Math.max(0, spawn.at - state.tick) / Math.max(1, ENCOUNTERS.spawnWarnSec * LOOP.tickRate);
          const r = spawn.elite ? 0.9 : 0.55;
          mark(g.ring, assets.glow(C.spawnWarn, 0.8), spawn.x, spawn.y, 0.03, r + left * 1.2);
          mark(g.disc, assets.flat(C.spawnWarn, 0.25 + 0.15 * Math.sin(time * 18)), spawn.x, spawn.y, 0.02, r);
        }
      }
      for (const key of Object.keys(state.entities.byId)) {
        const actor = state.entities.byId[key];
        if (actor.dead || !actor.action || actor.action.phase !== 'windup' || actor.kind === 'player') continue;
        telegraph(actor, state.tick);
      }
      ground.end();

      // 바닥의 전리품.
      drops.begin();
      for (const drop of state.drops) {
        const item = drops.next();
        if (!item) break;
        showDrop(item, drop.kind, drop.weapon);
        const bob = Math.sin(time * 3 + drop.id) * 0.06;
        item.group.position.set(drop.x, drop.kind === 'weapon' ? 0 : 0.35 + bob, drop.y);
        item.group.rotation.y = time * (drop.kind === 'gold' ? 3 : 1.2);
        if (drop.kind === 'weapon') {
          for (const group of Object.values(item.weapons)) group.position.set(0.3, 0.75 + bob, 0);
        }
      }
      drops.end();

      // 짧게 사는 것.
      for (let i = flashes.active.length - 1; i >= 0; i--) {
        const item = flashes.active[i];
        item.age += dtSec;
        if (item.age >= item.life) {
          flashes.release(item);
          continue;
        }
        const t = item.age / item.life;
        if (item.kind === 'ring') item.mesh.scale.setScalar(item.base.x * (0.3 + 0.8 * t));
        else if (item.kind === 'beam') item.mesh.scale.set(item.base.x * (1 - t), item.base.y * (1 - t), item.base.z);
        else item.mesh.scale.copy(item.base).multiplyScalar(1 - t * 0.6);
      }
      for (let i = chains.active.length - 1; i >= 0; i--) {
        const item = chains.active[i];
        item.age += dtSec;
        if (item.age >= 0.14) chains.release(item);
        else item.line.material.opacity = 1 - item.age / 0.14;
      }
      for (let i = casings.active.length - 1; i >= 0; i--) {
        const item = casings.active[i];
        item.age += dtSec;
        if (item.age >= FEEL.casing.life) {
          casings.release(item);
          continue;
        }
        const m = item.mesh;
        item.vy -= FEEL.casing.gravity * dtSec;
        m.position.x += item.vx * dtSec;
        m.position.z += item.vz * dtSec;
        m.position.y += item.vy * dtSec;
        if (m.position.y < 0.03) {
          // 한 번 튀고 눕는다.
          m.position.y = 0.03;
          item.vy = Math.abs(item.vy) * 0.3;
          item.vx *= 0.5;
          item.vz *= 0.5;
        }
        m.rotation.x += dtSec * 14;
      }

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

      // 피해 숫자: 튀어 오르며 흐려진다.
      for (let i = numbers.active.length - 1; i >= 0; i--) {
        const item = numbers.active[i];
        item.age += dtSec;
        if (item.age >= RENDER.damageNumberSec) {
          numbers.release(item);
          continue;
        }
        const t = item.age / RENDER.damageNumberSec;
        item.sprite.position.y += dtSec * (1.8 - t * 1.6);
        const pop = item.big ? 1 + Math.max(0, 0.35 - t * 2) : 1;
        item.sprite.scale.set((item.big ? 1.9 : 1.4) * pop, (item.big ? 0.95 : 0.7) * pop, 1);
        item.material.opacity = 1 - t * t;
      }
    },
    /** 미리 컴파일용: 모든 종류를 한 번씩 보이게 한다(층에 들어갈 때 셰이더가 처음 쓰이며 멈칫하지 않도록). */
    prewarm() {
      const restore = [];
      const show = (o) => {
        restore.push([o, o.visible]);
        o.visible = true;
      };
      projectiles.begin();
      for (let i = 0; i < 2; i++) {
        const item = projectiles.next();
        if (item) {
          item.core.material = assets.glow(i === 0 ? C.enemyShotRim : C.playerShot, 1);
          item.halo.material = assets.glow(i === 0 ? C.enemyShot : 0x3ab0ff, i === 0 ? 0.75 : 0.35);
        }
      }
      projectiles.end();
      drops.begin();
      const kinds = ['gold', 'energy', 'health', 'boon', 'weapon'];
      for (const kind of kinds) {
        const item = drops.next();
        if (item) showDrop(item, kind, 'sword');
      }
      drops.end();
      flashes.forEach((item) => show(item.mesh));
      chains.forEach((item) => show(item.line));
      casings.forEach((item) => show(item.mesh));
      numbers.forEach((item) => show(item.sprite));
      return () => {
        for (const [o, v] of restore) o.visible = v;
        projectiles.begin();
        projectiles.end();
        drops.begin();
        drops.end();
      };
    },
    /** 층을 옮길 때: 떠 있는 것을 모두 거둔다(풀은 그대로 둔다). */
    clear() {
      numbers.releaseAll();
      flashes.releaseAll();
      chains.releaseAll();
      casings.releaseAll();
      life.fill(0);
      for (let i = 0; i < MAX_PARTICLES; i++) positions[i * 3 + 1] = -999;
      particleGeometry.attributes.position.needsUpdate = true;
    },
    stats() {
      return {
        projectiles: projectiles.stats(), ground: ground.stats(), drops: drops.stats(), numbers: numbers.stats(),
        flashes: flashes.stats(), chains: chains.stats(), casings: casings.stats(),
      };
    },
    dispose() {
      for (const o of added) scene.remove(o);
      numbers.forEach((item) => {
        item.texture.dispose();
        item.material.dispose();
      });
      chains.forEach((item) => {
        item.geometry.dispose();
        item.line.material.dispose();
      });
      particleGeometry.dispose();
      particleMaterial.dispose();
    },
  };
}
