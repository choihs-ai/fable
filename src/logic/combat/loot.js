// 줍는 것: 적을 잡으면 떨어지는 금화·에너지·체력 구슬, 방을 깨면 나오는 보상(무기·축복·금화·체력).
// 금화·에너지·체력은 가까이 가면 저절로 주워지고, 축복은 닿으면 3택1 이 열린다. 무기는 상호작용으로 줍는다(commands.js).

import { CHARACTER_ORDER } from '../../../data/characters.js';
import { BOON_RULES } from '../../../data/boons.js';
import { ENCOUNTERS } from '../../../data/encounters.js';
import { WEAPON_UPGRADE } from '../../../data/weapons.js';
import { EVENTS } from '../core/events.js';
import { rngOf } from '../core/state.js';
import { getActor, getPlayer } from '../entities/actors.js';
import { ACTOR_KIND } from '../entities/defs.js';
import { rollBoonChoices } from '../items/boons.js';
import { rollWeapon } from '../items/shop.js';
import { REWARD, ROOM_KIND } from '../world/floors.js';
import { heal } from './damage.js';

/** 바닥에 무언가를 놓는다. */
export function addDrop(state, bus, x, y, drop) {
  const made = { id: state.entities.nextId++, x, y, ...drop };
  // 무기는 늘 강화 단계를 갖고 놓인다(새 무기는 0).
  if (made.kind === 'weapon' && made.level === undefined) made.level = 0;
  state.drops.push(made);
  bus.emit(EVENTS.DROP_SPAWNED, { id: made.id, kind: made.kind, x, y });
  return made;
}

export function addGold(state, bus, amount) {
  state.run.gold = Math.max(0, state.run.gold + amount);
  bus.emit(EVENTS.GOLD_CHANGED, { gold: state.run.gold });
}

/**
 * 축복 3택1 을 제시한다. 고를 축복이 남아 있지 않으면 금화를 준다.
 * @returns {boolean} 제시했으면 true
 */
export function offerBoons(state, bus) {
  const options = rollBoonChoices(rngOf(state, 'items'), state.run.boons);
  if (options.length === 0) {
    addGold(state, bus, BOON_RULES.emptyGold);
    return false;
  }
  state.run.choice = { kind: 'boon', options, rerolls: 0 };
  bus.emit(EVENTS.BOON_OFFERED, { options: options.slice(), rerolls: 0 });
  return true;
}

/** 처치 보상. 소환된 적과 플레이어가 잡지 않은 적은 아무것도 주지 않는다. 확률 굴림은 결과와 무관하게 같은 횟수만큼 굴린다. */
export function rewardKill(state, bus, actor) {
  if (actor.summonerId !== null) return;
  const killer = getActor(state, actor.killerId);
  if (!killer || killer.kind !== ACTOR_KIND.PLAYER) return;
  const run = state.run;
  run.kills += 1;
  if (actor.elite) run.eliteKills += 1;
  if (actor.kind === ACTOR_KIND.BOSS) run.bossKills += 1;

  const cfg = ENCOUNTERS.kill;
  const rng = rngOf(state, 'items');
  const goldRoll = rng.chance(cfg.gold.chance);
  const goldAmount = rng.int(cfg.gold.amount[0], cfg.gold.amount[1]);
  const energyRoll = rng.chance(cfg.energy.chance);
  const healthRoll = rng.chance(cfg.health.chance);
  const eliteGold = rng.int(cfg.eliteGold[0], cfg.eliteGold[1]);
  const ox = rng.float() * 0.8 - 0.4;
  const oy = rng.float() * 0.8 - 0.4;
  if (actor.kind === ACTOR_KIND.BOSS) return; // 보스의 보상은 방 보상으로 나온다.
  if (actor.elite) addDrop(state, bus, actor.x, actor.y, { kind: 'gold', amount: eliteGold });
  else if (goldRoll) addDrop(state, bus, actor.x + ox, actor.y + oy, { kind: 'gold', amount: goldAmount });
  if (energyRoll) addDrop(state, bus, actor.x - ox, actor.y - oy, { kind: 'energy', amount: cfg.energy.amount });
  if (healthRoll) addDrop(state, bus, actor.x + oy, actor.y - ox, { kind: 'health', amount: cfg.health.amount });
}

/** 방 보상: 방을 깼을 때(또는 싸움 없는 보상 방·숨은 방에 처음 들어섰을 때) 방 한가운데에 놓는다. */
export function grantRoomReward(state, bus, room) {
  const cfg = ENCOUNTERS.rewards;
  const rng = rngOf(state, 'items');
  const player = getPlayer(state);
  const cx = room.feature.x + 0.5;
  const cy = room.feature.y + 0.5;
  // 굴림은 방의 종류와 무관하게 같은 횟수만큼 한다.
  const clearGold = rng.int(cfg.clearGold[0], cfg.clearGold[1]);
  const roomGold = rng.int(cfg.gold[0], cfg.gold[1]);
  const eliteGold = rng.int(cfg.eliteGold[0], cfg.eliteGold[1]);
  const bossGold = rng.int(cfg.bossGold[0], cfg.bossGold[1]);
  const bonusGold = rng.int(cfg.bonusGold[0], cfg.bonusGold[1]);
  const fresh = rollWeapon(rng, player ? player.kit.weapons.filter(Boolean) : []);
  // 무기 보상은 가끔 든 무기(최고 단계가 아닌 것)를 내놓는다 — 주우면 강해진다. 굴림은 늘 두 번 한다.
  const upgradeRoll = rng.float();
  const upgradePick = rng.float();
  const upgradable = player ? player.kit.weapons.filter((id, i) => id !== null && player.kit.levels[i] < WEAPON_UPGRADE.max) : [];
  const weapon = upgradable.length > 0 && upgradeRoll < WEAPON_UPGRADE.offerChance ? upgradable[Math.floor(upgradePick * upgradable.length)] : fresh;

  if (room.kind === ROOM_KIND.COMBAT || room.kind === ROOM_KIND.ELITE || room.kind === ROOM_KIND.BOSS) {
    addGold(state, bus, clearGold);
    if (player) player.kit.energy = Math.min(player.kit.maxEnergy, player.kit.energy + Math.round((player.kit.maxEnergy * cfg.clearEnergyPct) / 100));
  }
  if (room.reward === REWARD.BOON) addDrop(state, bus, cx, cy, { kind: 'boon' });
  else if (room.reward === REWARD.WEAPON) addDrop(state, bus, cx, cy, { kind: 'weapon', weapon, level: 0 });
  else if (room.reward === REWARD.GOLD) addDrop(state, bus, cx, cy, { kind: 'gold', amount: roomGold });
  else if (room.reward === REWARD.HEALTH) {
    addDrop(state, bus, cx, cy, { kind: 'health', amount: player ? Math.round((player.maxHp * cfg.healthPct) / 100) : 0 });
  }
  if (room.kind === ROOM_KIND.ELITE) {
    addDrop(state, bus, cx + 1, cy, { kind: 'gold', amount: eliteGold });
    // 정예 방은 탈을 하나 떨어뜨린다(지금 들고 있지 않은 것 가운데).
    const carried = player ? player.kit.forms : [];
    const pool = CHARACTER_ORDER.filter((id) => !carried.includes(id));
    if (pool.length > 0) addDrop(state, bus, cx - 1, cy, { kind: 'form', form: rng.pick(pool) });
  }
  if (room.kind === ROOM_KIND.BOSS) addDrop(state, bus, cx + 1, cy, { kind: 'gold', amount: bossGold });
  if (room.kind === ROOM_KIND.BONUS) addDrop(state, bus, cx + 1, cy, { kind: 'gold', amount: bonusGold });
}

/** 줍기 단계(매 틱). */
export function collectDrops(state, bus) {
  if (state.drops.length === 0) return;
  const player = getPlayer(state);
  if (!player || player.dead) return;
  const kit = player.kit;
  const near = ENCOUNTERS.pickupRadius * ENCOUNTERS.pickupRadius;
  const left = [];
  for (const drop of state.drops) {
    const dx = drop.x - player.x;
    const dy = drop.y - player.y;
    const d2 = dx * dx + dy * dy;
    let taken = false;
    if (d2 <= near) {
      if (drop.kind === 'gold') {
        addGold(state, bus, drop.amount);
        taken = true;
      } else if (drop.kind === 'energy' && kit.energy < kit.maxEnergy) {
        kit.energy = Math.min(kit.maxEnergy, kit.energy + drop.amount);
        taken = true;
      } else if (drop.kind === 'health' && player.hp < player.maxHp) {
        heal(player, drop.amount);
        taken = true;
      } else if (drop.kind === 'boon' && d2 <= 1 && state.run.choice === null) {
        // 닿으면 3택1 이 열린다. 전투 중에는 열리지 않는다.
        if (state.encounter === null) {
          offerBoons(state, bus);
          taken = true;
        }
      }
    }
    if (taken) bus.emit(EVENTS.DROP_COLLECTED, { id: drop.id, kind: drop.kind, amount: drop.amount, x: drop.x, y: drop.y });
    else left.push(drop);
  }
  state.drops = left;
}
