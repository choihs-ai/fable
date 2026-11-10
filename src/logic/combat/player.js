// 플레이어 조작 단계(매 틱): state.input 을 읽어 이동 의도를 정하고, 회피·기술·기본공격을 시작한다.

import { PLAYER } from '../../../data/player.js';
import { EVENTS } from '../core/events.js';
import { TICK_RATE, ticksOf } from '../core/time.js';
import { getPlayer, opponentsOf } from '../entities/actors.js';
import { lineOfSight } from '../world/los.js';
import { navOf } from '../world/nav.js';
import { isReady, startAbility } from './abilities.js';

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * 입력을 다듬어 state.input 에 넣는다. 주어진 항목만 바꾼다.
 * move 는 길이 1 이하로 자르고, skill 은 기술 칸 번호(없으면 -1)로 맞춘다.
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
  if (input.dodge !== undefined) target.dodge = input.dodge === true;
  if (input.skill !== undefined) {
    target.skill = Number.isInteger(input.skill) && input.skill >= 0 && input.skill < PLAYER.skills.length ? input.skill : -1;
  }
}

/** 조준 방향: 입력이 있으면 그 방향, 없으면 시야가 닿는 가장 가까운 적, 그것도 없으면 바라보는 방향. */
function aimDirection(state, player, input) {
  const len = Math.sqrt(input.aimX * input.aimX + input.aimY * input.aimY);
  if (len > 1e-6) return { x: input.aimX / len, y: input.aimY / len, tx: player.x + input.aimX, ty: player.y + input.aimY };
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
    return { x: (best.x - player.x) / d, y: (best.y - player.y) / d, tx: best.x, ty: best.y };
  }
  return { x: player.facingX, y: player.facingY, tx: player.x + player.facingX, ty: player.y + player.facingY };
}

export function controlPlayer(state, bus) {
  const player = getPlayer(state);
  if (!player || player.dead) return;
  const input = state.input;
  const wantDodge = input.dodge;
  const wantSkill = input.skill;
  // 한 번짜리 입력은 처리 여부와 무관하게 이번 틱에 소비한다.
  input.dodge = false;
  input.skill = -1;
  player.moveX = 0;
  player.moveY = 0;
  if (player.disabled || player.dash) return;

  const moveLen = Math.sqrt(input.moveX * input.moveX + input.moveY * input.moveY);
  if (wantDodge && isReady(state, player, 'dodge') && !player.action) {
    const dodge = PLAYER.dodge;
    const dirX = moveLen > 1e-6 ? input.moveX / moveLen : player.facingX;
    const dirY = moveLen > 1e-6 ? input.moveY / moveLen : player.facingY;
    player.cooldowns.dodge = state.tick + ticksOf(dodge.cooldown);
    player.invulnUntil = Math.max(player.invulnUntil, state.tick + ticksOf(dodge.invuln));
    player.dash = {
      dirX, dirY, speed: dodge.speed, endAt: state.tick + Math.max(1, Math.round(dodge.duration * TICK_RATE)),
      damage: 0, status: null, hit: [], stopOnWall: false, stunOnWall: 0, done: false, wall: false,
    };
    bus.emit(EVENTS.PLAYER_DODGED, { id: player.id, dirX, dirY });
    return;
  }

  if (player.action) return;
  player.moveX = input.moveX;
  player.moveY = input.moveY;
  if (moveLen > 1e-6) {
    player.facingX = input.moveX / moveLen;
    player.facingY = input.moveY / moveLen;
  }

  const abilityId = wantSkill >= 0 ? PLAYER.skills[wantSkill] : input.attack ? PLAYER.attack : null;
  if (abilityId && isReady(state, player, abilityId)) {
    const aim = aimDirection(state, player, input);
    startAbility(state, bus, player, abilityId, aim.x, aim.y, aim.tx, aim.ty);
    // 플레이어 기술은 준비 시간이 없어 바로 발동한다. 공격하면서도 계속 움직일 수 있다.
    if (!player.action) {
      player.moveX = input.moveX;
      player.moveY = input.moveY;
    }
  }
}
