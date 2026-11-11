// 행동체(actor)의 데이터 정의를 찾는다. 플레이어의 기술 목록은 무기 데이터에서 만든다.

import { BOSSES } from '../../../data/bosses.js';
import { ENEMIES } from '../../../data/enemies.js';
import { PLAYER } from '../../../data/player.js';
import { DASH_ATTACK, WEAPONS } from '../../../data/weapons.js';

export const ACTOR_KIND = Object.freeze({ PLAYER: 'player', ENEMY: 'enemy', BOSS: 'boss' });

/** 무기의 기술 id. 기본 공격은 `w:<무기>`, 대시 공격은 `w:<무기>:dash`. */
export function weaponAbilityId(weaponId, dash = false) {
  return dash ? `w:${weaponId}:dash` : `w:${weaponId}`;
}

/** 대시 공격을 따로 정하지 않은 무기: 기본 공격을 키워서 쓴다(준비 시간은 없앤다 — 대시에서 곧바로 이어져야 한다). */
function derivedDashAttack(attack) {
  const k = DASH_ATTACK;
  const grow = (effect) => {
    const out = { ...effect, damage: Math.round((effect.damage ?? 0) * k.damage), knockback: (effect.knockback ?? 0) * k.knockback + k.knockbackAdd };
    if (effect.type === 'arc') out.range = effect.range + k.arcRange;
    if (effect.type === 'circle') out.radius = effect.radius + k.arcRange;
    if (effect.type === 'projectile') {
      out.pierce = (effect.pierce ?? 0) + k.pierce;
      out.radius = effect.radius * k.radius;
      if (effect.explode) out.explode = { ...effect.explode, damage: Math.round(effect.explode.damage * k.damage) };
    }
    return out;
  };
  return { ...attack, windup: 0, effects: attack.effects.map(grow) };
}

const playerAbilities = {};
for (const id of Object.keys(WEAPONS)) {
  playerAbilities[weaponAbilityId(id)] = WEAPONS[id].attack;
  playerAbilities[weaponAbilityId(id, true)] = Object.freeze(WEAPONS[id].dash ?? derivedDashAttack(WEAPONS[id].attack));
}

/** 플레이어의 정의: 공통 수치 + 모든 무기의 기술. */
export const PLAYER_DEF = Object.freeze({ ...PLAYER, abilities: Object.freeze(playerAbilities) });

/** 종류 id 로 적·보스 정의를 찾는다. 없으면 null. */
export function enemyDef(type) {
  if (Object.hasOwn(ENEMIES, type)) return ENEMIES[type];
  if (Object.hasOwn(BOSSES, type)) return BOSSES[type];
  return null;
}

export function isBossType(type) {
  return Object.hasOwn(BOSSES, type);
}

/** 행동체의 데이터 정의(플레이어·적·보스). */
export function defOf(actor) {
  if (actor.kind === ACTOR_KIND.PLAYER) return PLAYER_DEF;
  return actor.kind === ACTOR_KIND.BOSS ? BOSSES[actor.type] : ENEMIES[actor.type];
}

/** 대상의 상태이상 저항(지속시간 배율). 0 이면 면역. */
export function statusResistOf(def, statusId) {
  if (def.immune && def.immune.includes(statusId)) return 0;
  const resist = def.statusResist ? def.statusResist[statusId] : undefined;
  return resist === undefined ? 1 : resist;
}
