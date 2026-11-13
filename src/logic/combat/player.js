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
import { heal } from './damage.js';
import { refreshPlayerStats } from '../entities/stats.js';
import { hasBoon, onDashEnd } from './boons.js';
import { spawnHazard, spawnWarpField } from './hazards.js';
import { clearBullets } from './projectiles.js';

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
  if (input.skill2 !== undefined) target.skill2 = input.skill2 === true;
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
  // 축복 "유령 걸음": 대시의 무적이 길어진다.
  player.invulnUntil = Math.max(player.invulnUntil, tick + ticksOf(cfg.invuln + (hasBoon(state, 'ghost_step') ? BOONS.ghost_step.invuln : 0)));
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
  if (hasBoon(state, 'afterimage')) kit.critUntil = tick + dashTicks + ticksOf(BOONS.afterimage.windowSec);
  kit.trailAt = tick;
  bus.emit(EVENTS.PLAYER_DASHED, { id: player.id, dirX, dirY, charges: kit.charges });
}

/** 스킬의 목표 지점: 발밑(at:'self'), 겨눈 적의 자리, 적이 없으면 겨눈 쪽으로 reach 칸 앞. */
function skillTarget(player, skill, aim) {
  if (skill.at === 'self') return { x: player.x, y: player.y };
  if (aim.target) return { x: aim.target.x, y: aim.target.y };
  const reach = skill.reach ?? 1;
  return { x: player.x + aim.x * reach, y: player.y + aim.y * reach };
}

/** 탈의 index 번째 스킬(0 또는 1)을 쓴다. */
function useSkill(state, bus, player, input, index) {
  const kit = player.kit;
  const skill = CHARACTERS[kit.character].skills[index];
  player.cooldowns[skillKey(kit.character, index)] = state.tick + cooldownTicks(player, skill.cooldown);
  if (skill.type === 'cast' || skill.type === 'guard') {
    const aim = aimDirection(state, player, input);
    const at = skillTarget(player, skill, aim);
    if (skill.type === 'guard') {
      player.invulnUntil = Math.max(player.invulnUntil, state.tick + ticksOf(skill.invuln));
      if (skill.clearBullets) {
        const r2 = skill.clearBullets * skill.clearBullets;
        clearBullets(state, bus, player.faction, (p) => (p.x - player.x) * (p.x - player.x) + (p.y - player.y) * (p.y - player.y) <= r2, player.x, player.y);
      }
    }
    if (skill.effects) runEffects(state, bus, player, skill.effects, { dirX: aim.x, dirY: aim.y, targetX: at.x, targetY: at.y });
  } else if (skill.type === 'heal') {
    const healed = heal(player, (player.maxHp * skill.pct) / 100);
    bus.emit(EVENTS.PLAYER_HEALED, { id: player.id, amount: healed, x: player.x, y: player.y });
  } else if (skill.type === 'dual') {
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
  bus.emit(EVENTS.SKILL_USED, { character: kit.character, index, type: skill.type, x: player.x, y: player.y });
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
      // 쏠 수 없으면 개머리판으로 친다.
      if (isReady(state, player, 'bash')) {
        aim = aimDirection(state, player, input);
        if (startAbility(state, bus, player, 'bash', aim.x, aim.y, aim.tx, aim.ty)) {
          bus.emit(EVENTS.WEAPON_USED, {
            weapon: weaponId, slot: kit.slot, dash: false, offhand: false, bash: true, kind: 'melee', x: player.x, y: player.y, dirX: aim.x, dirY: aim.y,
          });
        }
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

/** 스킬의 재사용 대기 이름. 탈마다, 스킬마다(index 0·1) 따로 센다. */
export const skillKey = (form, index = 0) => (index === 0 ? `skill:${form}` : `skill:${form}:${index + 1}`);

/**
 * 쓰는 탈을 바꾼다: 능력치를 그 탈의 것으로 다시 합산한다. 잃은 체력·쓴 에너지는 그대로 가져간다
 * (최대치가 다른 탈로 오가며 회복하지 못하게 — 모자란 양을 유지한다).
 * 새 탈의 최대치가 모자란 양보다 작으면 체력은 1, 에너지는 0 에서 멈추고, 다 깎지 못한 양은 빚(hpDebt, energyDebt)으로 적어 둔다.
 * 다음에 탈을 바꿀 때 그 빚을 다시 얹으므로 오가도 늘지 않는다.
 */
export function wearForm(state, player, form) {
  if (!Object.hasOwn(CHARACTERS, form)) throw new RangeError(`wearForm: 알 수 없는 탈 "${form}"`);
  const kit = player.kit;
  const missingHp = player.maxHp - player.hp + kit.hpDebt;
  const missingEnergy = kit.maxEnergy - kit.energy + kit.energyDebt;
  kit.character = form;
  kit.dualUntil = 0;
  refreshPlayerStats(state);
  const hp = player.maxHp - missingHp;
  player.hp = Math.max(1, hp);
  kit.hpDebt = Math.max(0, 1 - hp);
  const energy = kit.maxEnergy - missingEnergy;
  kit.energy = Math.max(0, energy);
  kit.energyDebt = Math.max(0, -energy);
}

/**
 * 교체: 다른 칸의 무기를 든다. 그 칸에 탈이 딸려 있으면 탈도 함께 바뀌고, 교체 기술이 준비돼 있으면 새 탈의 교체 기술이 나간다.
 * 다른 칸에 무기가 없으면 아무 일도 없다.
 */
export function swapWeapon(state, bus) {
  const player = getPlayer(state);
  if (!player || player.dead) return false;
  const kit = player.kit;
  if (!kit.weapons[1 - kit.slot]) return false;
  kit.slot = 1 - kit.slot;
  kit.dashAttackUntil = 0;
  bus.emit(EVENTS.WEAPON_SWAPPED, { slot: kit.slot, weapon: kit.weapons[kit.slot] });
  const form = kit.forms[kit.slot];
  if (form !== null && form !== kit.character) {
    const from = kit.character;
    wearForm(state, player, form);
    let burst = false;
    if ((player.cooldowns.swap ?? 0) <= state.tick) {
      burst = true;
      const swap = CHARACTERS[form].swap;
      player.cooldowns.swap = state.tick + ticksOf(PLAYER.swap.cooldown);
      player.invulnUntil = Math.max(player.invulnUntil, state.tick + ticksOf(PLAYER.swap.invuln));
      const aim = aimDirection(state, player, state.input);
      if (swap.clearBullets) {
        const r2 = swap.clearBullets * swap.clearBullets;
        clearBullets(state, bus, player.faction, (p) => (p.x - player.x) * (p.x - player.x) + (p.y - player.y) * (p.y - player.y) <= r2, player.x, player.y);
      }
      runEffects(state, bus, player, swap.effects, { dirX: aim.x, dirY: aim.y, targetX: aim.tx, targetY: aim.ty });
    }
    bus.emit(EVENTS.FORM_CHANGED, { id: player.id, from, to: form, burst, picked: false, x: player.x, y: player.y });
  }
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
  else if (input.skill2) kit.buffer = { kind: 'skill2', until: tick + bufferTicks };
  input.dash = false;
  input.skill = false;
  input.skill2 = false;
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
  const wanted = kit.buffer && kit.buffer.kind === 'skill' ? 0 : kit.buffer && kit.buffer.kind === 'skill2' ? 1 : -1;
  if (wanted !== -1 && !player.action && isReady(state, player, skillKey(kit.character, wanted))) {
    kit.buffer = null;
    useSkill(state, bus, player, input, wanted);
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
