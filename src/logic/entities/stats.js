// 플레이어 능력치: 캐릭터의 기본값 + 영구 강화(메타) + 능력치를 바꾸는 축복을 처음부터 다시 합산해 플레이어에 반영한다.
// 축복을 얻거나 영구 강화가 바뀌면 다시 부른다. 더했다 빼는 식으로 고치지 않는다.

import { BOONS } from '../../../data/boons.js';
import { CHARACTERS } from '../../../data/characters.js';
import { PLAYER } from '../../../data/player.js';
import { ticksOf } from '../core/time.js';
import { metaBonuses } from '../items/meta.js';
import { getPlayer } from './actors.js';

/**
 * @returns {object|null} 플레이어. 없으면 null
 */
export function refreshPlayerStats(state) {
  const player = getPlayer(state);
  if (!player || !player.kit) return null;
  const character = CHARACTERS[state.run.character];
  const bonus = metaBonuses(state.meta);
  const has = (id) => state.run.boons.includes(id);
  const kit = player.kit;

  let maxHp = character.hp + bonus.maxHp;
  if (has('glass_cannon')) maxHp = Math.round(maxHp * BOONS.glass_cannon.hpMul);
  maxHp = Math.max(10, maxHp);
  if (maxHp > player.maxHp && !player.dead) player.hp += maxHp - player.maxHp; // 늘어난 만큼 현재 체력도 는다.
  player.maxHp = maxHp;
  if (player.hp > maxHp) player.hp = maxHp;

  player.speed = character.speed;
  player.power = 1 + bonus.power + (has('glass_cannon') ? BOONS.glass_cannon.power : 0);
  player.critChance = PLAYER.critChance + (has('conduct') ? BOONS.conduct.critChance : 0);
  player.critDamage = PLAYER.critDamage;

  const maxEnergy = character.energy + bonus.maxEnergy;
  if (maxEnergy > kit.maxEnergy) kit.energy += maxEnergy - kit.maxEnergy;
  kit.maxEnergy = maxEnergy;
  if (kit.energy > maxEnergy) kit.energy = maxEnergy;

  const maxCharges = PLAYER.dash.charges + bonus.dashCharges + (has('third_dash') ? BOONS.third_dash.charges : 0);
  if (maxCharges > kit.maxCharges) kit.charges += maxCharges - kit.maxCharges;
  kit.maxCharges = maxCharges;
  if (kit.charges >= maxCharges) {
    kit.charges = maxCharges;
    kit.chargeAt = 0;
  }
  const recharge = PLAYER.dash.recharge * (1 - bonus.dashRecharge) * (has('momentum') ? BOONS.momentum.rechargeMul : 1);
  kit.rechargeTicks = Math.max(1, ticksOf(recharge));
  return player;
}
