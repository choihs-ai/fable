// 플레이어 조작 단계(매 틱): state.input 을 읽어 이동 의도를 정하고, 대시·스킬·무기 공격을 시작한다.
//
// - 대시는 충전식이다. 충전이 남아 있으면 준비·경직 중에도 끊고 나간다(전투의 중심).
// - 지금 할 수 없는 대시·스킬 입력은 잠깐 기억했다가(입력 버퍼) 가능해지는 틱에 실행한다.
// - 대시가 끝난 직후의 공격은 그 무기의 "대시 공격"이 된다.
// - 원거리 무기는 쏠 때마다 에너지를 쓴다. 모자라면 나가지 않는다.

import { BOONS } from '../../../data/boons.js';
import { CHARACTERS } from '../../../data/characters.js';
import { PLAYER } from '../../../data/player.js';
import { WEAPONS } from '../../../data/weapons.js';
import { EVENTS } from '../core/events.js';
import { TICK_RATE, ticksOf } from '../core/time.js';
import { getPlayer, opponentsOf } from '../entities/actors.js';
import { weaponAbilityId } from '../entities/defs.js';
import { lineOfSight } from '../world/los.js';
import { navOf } from '../world/nav.js';
import { abilityOf, cooldownTicks, isReady, runEffects, startAbility } from './abilities.js';
import { hasBoon, onDashEnd } from './boons.js';
import { spawnHazard, spawnWarpField } from './hazards.js';

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * 입력을 다듬어 state.input 에 넣는다. 주어진 항목만 바꾼다. move 는 길이 1 이하로 자른다.
 */
export function setInput(state, input) {
  const target = state.input;
  if (input.moveX !== undefined || input.moveY !== undefined) {
    let mx = finite(input.moveX ?? target.moveX);
    let my = finite(input.moveY ?? target.moveY);
    const len = Math.sqrt(mx * mx + my * my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    target.moveX = mx;
    target.moveY = my;
  }
  if (input.aimX !== undefined) target.aimX = finite(input.aimX);
  if (input.aimY !== undefined) target.aimY = finite(input.aimY);
  if (input.attack !== undefined) target.attack = input.attack === true;
  if (input.dash !== undefined) target.dash = input.dash === true;
  if (input.skill !== undefined) target.skill = input.skill === true;
}

/** 조준 방향: 입력이 있으면 그 방향(수동 조준), 없으면 시야가 닿는 가장 가까운 적, 그것도 없으면 바라보는 방향. */
export function aimDirection(state, player, input) {
  const len = Math.sqrt(input.aimX * input.aimX + input.aimY * input.aimY);
  if (len > 1e-6) return { x: input.aimX / len, y: input.aimY / len, tx: player.x + input.aimX, ty: player.y + input.aimY, target: null };
  const nav = navOf(state.world);
  let best = null;
  let bestD2 = PLAYER.assistRange * PLAYER.assistRange;
  for (const enemy of opponentsOf(state, player.faction)) {
    const dx = enemy.x - player.x;
    const dy = enemy.y - player.y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= bestD2 || !lineOfSight(nav, player.x, player.y, enemy.x, enemy.y)) continue;
    best = enemy;
    bestD2 = d2;
  }
  if (best && bestD2 > 1e-12) {
    const d = Math.sqrt(bestD2);
    return { x: (best.x - player.x) / d, y: (best.y - player.y) / d, tx: best.x, ty: best.y, target: best };
  }
  return { x: player.facingX, y: player.facingY, tx: player.x + player.facingX, ty: player.y + player.facingY, target: null };
}

function startDash(state, bus, player, input, moveLen) {
  const kit = player.kit;
  const cfg = PLAYER.dash;
  const tick = state.tick;
  const dirX = moveLen > 1e-6 ? input.moveX / moveLen : player.facingX;
  const dirY = moveLen > 1e-6 ? input.moveY / moveLen : player.facingY;
  kit.charges -= 1;
  if (kit.chargeAt === 0) kit.chargeAt = tick + kit.rechargeTicks;
  // 준비 중이거나 경직 중이던 행동은 끊긴다.
  player.action = null;
  player.facingX = dirX;
  player.facingY = dirY;
  player.invulnUntil = Math.max(player.invulnUntil, tick + ticksOf(cfg.invuln));
  const dashTicks = Math.max(1, Math.round(cfg.duration * TICK_RATE));
  const charged = hasBoon(state, 'static_dash');
  player.dash = {
    dirX, dirY, speed: cfg.speed, endAt: tick + dashTicks,
    // 축복 "정전기 대시": 지나치는 적에게 피해와 기절.
    damage: charged ? BOONS.static_dash.damage : 0, knockback: 0,
    status: charged ? { id: 'stun', duration: BOONS.static_dash.stun } : null,
    hit: [], stopOnWall: false, stunOnWall: 0, done: false, wall: false, proc: false,
  };
  kit.dashing = true;
  kit.dashAttackUntil = tick + dashTicks + ticksOf(cfg.attackWindow);
  if (hasBoon(state, 'afterimage')) kit.critUntil = tick + dashTicks + ticksOf(BOONS.afterimage.window);
  kit.trailAt = tick;
  bus.emit(EVENTS.PLAYER_DASHED, { id: player.id, dirX, dirY, charges: kit.charges });
}

function useSkill(state, bus, player, input) {
  const kit = player.kit;
  const skill = CHARACTERS[kit.character].skill;
  player.cooldowns.skill = state.tick + cooldownTicks(player, skill.cooldown);
  if (skill.type === 'dual') {
    kit.dualUntil = state.tick + ticksOf(skill.duration);
  } else if (skill.type === 'warp') {
    // 겨눈 적의 자리에 깐다. 적이 없으면 바라보는 쪽 조금 앞.
    const aim = aimDirection(state, player, input);
    let tx = aim.target ? aim.target.x : player.x + aim.x * skill.radius * 0.5;
    let ty = aim.target ? aim.target.y : player.y + aim.y * skill.radius * 0.5;
    const dx = tx - player.x;
    const dy = ty - player.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > skill.reach) {
      tx = player.x + (dx / d) * skill.reach;
      ty = player.y + (dy / d) * skill.reach;
    }
    spawnWarpField(state, bus, player, tx, ty, skill);
  } else {
    throw new RangeError(`알 수 없는 스킬 "${skill.type}"`);
  }
  bus.emit(EVENTS.SKILL_USED, { character: kit.character, type: skill.type });
}

function emitUsed(bus, player, weaponId, slot, dash, offhand, aim) {
  bus.emit(EVENTS.WEAPON_USED, {
    weapon: weaponId, slot, dash, offhand, kind: WEAPONS[weaponId].kind, x: player.x, y: player.y, dirX: aim.x, dirY: aim.y,
  });
}

function attack(state, bus, player, input) {
  const kit = player.kit;
  const tick = state.tick;
  const weaponId = kit.weapons[kit.slot];
  if (!weaponId) return;
  const weapon = WEAPONS[weaponId];
  const dual = kit.dualUntil > tick;
  const baseId = weaponAbilityId(weaponId);
  const dashAttack = tick <= kit.dashAttackUntil;
  const abilityId = dashAttack ? weaponAbilityId(weaponId, true) : baseId;
  let aim = null;

  if (isReady(state, player, abilityId)) {
    // 쌍수 사격 중에는 에너지를 쓰지 않는다.
    const cost = dual ? 0 : weapon.energy;
    if (kit.energy < cost) {
      if (tick >= kit.emptyAt) {
        kit.emptyAt = tick + ticksOf(PLAYER.emptyNoticeSec);
        bus.emit(EVENTS.ENERGY_EMPTY, { need: cost, have: kit.energy });
      }
    } else {
      aim = aimDirection(state, player, input);
      if (startAbility(state, bus, player, abilityId, aim.x, aim.y, aim.tx, aim.ty)) {
        kit.energy -= cost;
        if (dashAttack) {
          // 대시 공격은 한 번뿐이고, 기본 공격의 재사용 대기도 함께 돈다.
          kit.dashAttackUntil = 0;
          player.cooldowns[baseId] = Math.max(player.cooldowns[baseId] ?? 0, tick + cooldownTicks(player, weapon.attack.cooldown ?? 0));
        }
        emitUsed(bus, player, weaponId, kit.slot, dashAttack, false, aim);
      }
    }
  }

  // 쌍수 사격: 다른 손의 무기가 자기 박자대로 함께 나간다(준비 시간 없이 바로 발동).
  if (dual && !player.dash) {
    const other = kit.weapons[1 - kit.slot];
    const otherId = other ? weaponAbilityId(other) : null;
    if (otherId && isReady(state, player, otherId)) {
      aim = aim ?? aimDirection(state, player, input);
      const ability = abilityOf(player, otherId);
      player.cooldowns[otherId] = tick + cooldownTicks(player, ability.cooldown ?? 0);
      runEffects(state, bus, player, ability.effects, { ability: otherId, dirX: aim.x, dirY: aim.y, targetX: aim.tx, targetY: aim.ty });
      emitUsed(bus, player, other, 1 - kit.slot, false, true, aim);
    }
  }
}

/** 든 무기를 바꾼다. 다른 칸이 비어 있으면 아무 일도 없다. */
export function swapWeapon(state, bus) {
  const player = getPlayer(state);
  if (!player || player.dead) return false;
  const kit = player.kit;
  if (!kit.weapons[1 - kit.slot]) return false;
  kit.slot = 1 - kit.slot;
  bus.emit(EVENTS.WEAPON_SWAPPED, { slot: kit.slot, weapon: kit.weapons[kit.slot] });
  return true;
}

export function controlPlayer(state, bus) {
  const player = getPlayer(state);
  if (!player || player.dead) return;
  const kit = player.kit;
  const input = state.input;
  const tick = state.tick;

  // 대시 충전
  if (kit.charges < kit.maxCharges) {
    if (kit.chargeAt === 0) kit.chargeAt = tick + kit.rechargeTicks;
    if (tick >= kit.chargeAt) {
      kit.charges += 1;
      kit.chargeAt = kit.charges < kit.maxCharges ? tick + kit.rechargeTicks : 0;
    }
  }

  // 한 번짜리 입력은 버퍼로 옮기고 지운다. 버퍼는 잠깐만 기억한다.
  const bufferTicks = ticksOf(PLAYER.inputBuffer);
  if (input.dash) kit.buffer = { kind: 'dash', until: tick + bufferTicks };
  else if (input.skill) kit.buffer = { kind: 'skill', until: tick + bufferTicks };
  input.dash = false;
  input.skill = false;
  if (kit.buffer && tick > kit.buffer.until) kit.buffer = null;

  player.moveX = 0;
  player.moveY = 0;

  if (player.dash) {
    // 축복 "불길 대시": 대시로 지나가는 자리에 불을 놓는다.
    if (kit.dashing && hasBoon(state, 'ember_trail') && tick >= kit.trailAt) {
      kit.trailAt = tick + ticksOf(BOONS.ember_trail.every);
      spawnHazard(state, bus, player, { ...BOONS.ember_trail.hazard, proc: false }, player.x, player.y);
    }
    return;
  }
  if (kit.dashing) {
    kit.dashing = false;
    bus.emit(EVENTS.PLAYER_DASH_ENDED, { id: player.id, x: player.x, y: player.y });
    onDashEnd(state, bus, player);
  }
  if (player.disabled) return;

  const moveLen = Math.sqrt(input.moveX * input.moveX + input.moveY * input.moveY);
  if (kit.buffer && kit.buffer.kind === 'dash' && kit.charges > 0) {
    kit.buffer = null;
    startDash(state, bus, player, input, moveLen);
    return;
  }
  if (kit.buffer && kit.buffer.kind === 'skill' && !player.action && isReady(state, player, 'skill')) {
    kit.buffer = null;
    useSkill(state, bus, player, input);
  }

  if (player.action) return;
  player.moveX = input.moveX;
  player.moveY = input.moveY;
  if (moveLen > 1e-6) {
    player.facingX = input.moveX / moveLen;
    player.facingY = input.moveY / moveLen;
  }

  if (input.attack) {
    attack(state, bus, player, input);
    // 준비 시간이 없는 무기는 쏘면서도 계속 움직인다.
    if (!player.action) {
      player.moveX = input.moveX;
      player.moveY = input.moveY;
    }
  }
}
