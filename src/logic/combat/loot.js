// 전리품: 층에 들어갈 때 상자·상점·제단을 만들고, 적을 잡으면 보상을 주고, 바닥의 것을 줍는다.

import { DROPS, INVENTORY } from '../../../data/items.js';
import { RELICS } from '../../../data/relics.js';
import { EVENTS } from '../core/events.js';
import { rngOf } from '../core/state.js';
import { getPlayer } from '../entities/actors.js';
import { ACTOR_KIND } from '../entities/defs.js';
import { refreshPlayerStats } from '../entities/stats.js';
import { generateAltar } from '../items/altar.js';
import { rollChestLoot, rollKillLoot } from '../items/drops.js';
import { addConsumable, addGold, addRelic, addToBag } from '../items/inventory.js';
import { gainXp, offerChoice, xpForKill } from '../items/levelup.js';
import { generateShop } from '../items/shop.js';
import { heal } from './damage.js';

/** 장비에 고유 번호를 붙인다(상태 안에서 장비를 가리킬 때 쓴다). */
export function stampItem(state, item) {
  if (!item.uid) item.uid = state.entities.nextId++;
  return item;
}

/** 전리품을 바닥에 놓는다. */
export function addDrop(state, bus, x, y, loot) {
  if (loot.kind === 'equipment') stampItem(state, loot.item);
  const drop = { id: state.entities.nextId++, x, y, loot };
  state.drops.push(drop);
  bus.emit(EVENTS.DROP_SPAWNED, { id: drop.id, x, y, kind: loot.kind });
  return drop;
}

/** 강화 후보를 제시할 것이 있으면 제시하고 이벤트를 낸다. */
export function offerPendingChoice(state, bus) {
  if (offerChoice(state.run, rngOf(state, 'items'))) {
    bus.emit(EVENTS.UPGRADE_OFFERED, { options: state.run.choice.options });
  }
}

/**
 * 층에 들어갈 때: 맵의 아이템 자리에 상자 내용물을 놓고, 이벤트방이 있으면 상점·제단을 만든다.
 * 내용은 (런 시드, 층)으로 정해진다 — 같은 층에 다시 들어와도 같다(이미 가진 유물만 빠진다).
 */
export function setupFloorLoot(state, bus) {
  const map = state.world;
  const floor = state.run.floor;
  const rng = rngOf(state, 'items').fork(`floor:${floor}`);
  const ctx = { floor, meta: state.meta, relics: state.inventory.relics };

  state.drops = [];
  const chestRng = rng.fork('chests');
  const placedRelics = [];
  for (const spawn of map.spawns) {
    if (spawn.kind !== 'item') continue;
    const loot = rollChestLoot(chestRng, { ...ctx, exclude: placedRelics });
    if (loot.kind === 'relic') placedRelics.push(loot.id);
    addDrop(state, bus, spawn.x + 0.5, spawn.y + 0.5, loot);
  }

  state.shop = null;
  state.altar = null;
  for (const room of map.eventRooms) {
    const x = room.feature.x + 0.5;
    const y = room.feature.y + 0.5;
    if (room.kind === 'shop') {
      const shop = generateShop(rng.fork('shop'), ctx);
      for (const entry of shop.stock) if (entry.kind === 'equipment') stampItem(state, entry.item);
      state.shop = { ...shop, x, y };
    } else if (room.kind === 'altar') {
      state.altar = { ...generateAltar(rng.fork('altar'), floor), x, y };
    }
  }
}

/**
 * 적을 잡은 보상: 경험치, 전리품, 처치 시 유물 효과. 플레이어가 잡은 적만, 소환·분열로 생긴 적은 제외.
 * @param {object} actor 죽은 적 또는 보스
 */
export function rewardKill(state, bus, actor) {
  const player = getPlayer(state);
  if (!player || actor.killerId !== player.id || actor.summonerId !== null) return;
  const run = state.run;
  const inv = state.inventory;
  const boss = actor.kind === ACTOR_KIND.BOSS;
  const sheet = run.sheet;
  run.kills++;
  if (boss) run.bossKills++;

  const xp = Math.round(xpForKill(actor.maxHp, boss) * (1 + (sheet ? sheet.xpGain : 0) / 100));
  const levels = gainXp(run, xp);
  bus.emit(EVENTS.XP_GAINED, { amount: xp, level: run.level, xp: run.xp });
  if (levels > 0) {
    bus.emit(EVENTS.LEVEL_UP, { level: run.level });
    offerPendingChoice(state, bus);
  }

  const loot = rollKillLoot(rngOf(state, 'items'), { floor: run.floor, meta: state.meta, relics: inv.relics, boss });
  for (const entry of loot) addDrop(state, bus, actor.x, actor.y, entry);

  for (const id of inv.relics) {
    const onKill = RELICS[id].onKill;
    if (!onKill) continue;
    if (onKill.heal && !player.dead) heal(player, onKill.heal);
    if (onKill.gold) addGold(inv, onKill.gold);
  }
}

/** 전리품 하나를 인벤토리에 넣는다. 자리가 없으면 false(바닥에 그대로 둔다). */
function take(state, loot) {
  const inv = state.inventory;
  switch (loot.kind) {
    case 'gold': {
      const bonus = state.run.sheet ? state.run.sheet.goldFind : 0;
      addGold(inv, Math.max(1, Math.round(loot.amount * (1 + bonus / 100))));
      return true;
    }
    case 'consumable':
      return addConsumable(inv, loot.id, 1) === 1;
    case 'equipment':
      return addToBag(inv, loot.item);
    case 'relic':
      // 이미 가진 유물이면 금화로 바꿔 준다.
      if (!addRelic(inv, loot.id)) addGold(inv, Math.round(RELICS[loot.id].price / 4));
      else refreshPlayerStats(state);
      return true;
    default:
      throw new RangeError(`알 수 없는 전리품 "${loot.kind}"`);
  }
}

/** 줍기 단계(매 틱): 플레이어 가까이에 있는 전리품을 줍는다. */
export function collectDrops(state, bus) {
  if (state.drops.length === 0) return;
  const player = getPlayer(state);
  if (!player || player.dead) return;
  const reach = INVENTORY.pickupRange * INVENTORY.pickupRange;
  const left = [];
  let changed = false;
  for (const drop of state.drops) {
    const dx = drop.x - player.x;
    const dy = drop.y - player.y;
    if (dx * dx + dy * dy > reach || !take(state, drop.loot)) {
      left.push(drop);
      continue;
    }
    changed = true;
    const { loot } = drop;
    bus.emit(EVENTS.DROP_COLLECTED, {
      id: drop.id, kind: loot.kind, amount: loot.amount, itemId: loot.id, uid: loot.item ? loot.item.uid : undefined,
    });
  }
  if (changed) {
    state.drops = left;
    bus.emit(EVENTS.INVENTORY_CHANGED, { reason: 'pickup' });
  }
}

/** 유지 단계(매 틱): 끝난 물약 효과를 걷어 내고, 체력 재생을 적용한다. */
export function updateUpkeep(state) {
  const run = state.run;
  if (run.buffs.length > 0 && run.buffs.some((b) => b.until <= state.tick)) {
    run.buffs = run.buffs.filter((b) => b.until > state.tick);
    refreshPlayerStats(state);
  }
  const player = getPlayer(state);
  if (!player || player.dead || player.regen <= 0 || state.tick % 60 !== 0) return;
  if (player.hp >= player.maxHp) {
    run.regenPool = 0;
    return;
  }
  run.regenPool += player.regen;
  if (run.regenPool >= 10) {
    heal(player, Math.floor(run.regenPool / 10));
    run.regenPool %= 10;
  }
}

/** 새 층에 들어갈 때의 유물 효과. */
export function applyFloorRelics(state) {
  const player = getPlayer(state);
  if (!player || player.dead) return;
  for (const id of state.inventory.relics) {
    const onFloor = RELICS[id].onFloor;
    if (onFloor && onFloor.healPct) heal(player, (player.maxHp * onFloor.healPct) / 100);
  }
}

export { DROPS };
