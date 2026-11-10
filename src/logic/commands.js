// 플레이어 명령: 틱 바깥에서 ui 가 부르는 행동들(착용, 버리기, 소비 아이템, 사고팔기, 제단, 강화 선택, 메타 해금).
//
// 모든 명령은 { ok:true, … } 또는 { ok:false, reason } 을 돌려준다. 안 되는 일을 시켜도 예외를 던지지 않고 이유를 알려 준다
// (잘못된 형식의 인자만 예외). 명령은 인벤토리·런 진행을 고친 뒤 능력치를 다시 합산하고 이벤트를 낸다.
// 로직 최상단 파일이다(game.js 와 같은 층) — 로직 모듈은 이 파일을 import 하지 않는다.

import { CONSUMABLES } from '../../data/consumables.js';
import { INVENTORY } from '../../data/items.js';
import { PHASE } from './core/state.js';
import { EVENTS } from './core/events.js';
import { rngOf } from './core/state.js';
import { ticksOf } from './core/time.js';
import { runEffects } from './combat/abilities.js';
import { cleanse, heal } from './combat/damage.js';
import { offerPendingChoice } from './combat/loot.js';
import { getPlayer } from './entities/actors.js';
import { refreshPlayerStats } from './entities/stats.js';
import { canAccept, hpCost } from './items/altar.js';
import { rollRelic } from './items/drops.js';
import { addGold, addRelic, equipFromBag, removeFromBag, spendGold, takeConsumable, unequip } from './items/inventory.js';
import { takeChoice } from './items/levelup.js';
import { purchaseUnlock } from './items/meta.js';
import { buyFromShop, sellFromBag } from './items/shop.js';
import { compareEquipment } from './items/stats.js';

const fail = (reason) => ({ ok: false, reason });

/** 살아서 플레이 중인 플레이어를 돌려준다. 아니면 null. */
function activePlayer(game) {
  const player = getPlayer(game.state);
  return player && !player.dead && game.state.phase !== PHASE.GAME_OVER && game.state.phase !== PHASE.VICTORY ? player : null;
}

function changed(game, reason) {
  refreshPlayerStats(game.state);
  game.bus.emit(EVENTS.INVENTORY_CHANGED, { reason });
}

function validIndex(list, index) {
  return Number.isInteger(index) && index >= 0 && index < list.length;
}

/** 상인·제단이 거래할 수 있는 거리 안에 있는가. */
function nearby(player, place) {
  const dx = place.x - player.x;
  const dy = place.y - player.y;
  return dx * dx + dy * dy <= INVENTORY.interactRange * INVENTORY.interactRange;
}

// ── 장비 ─────────────────────────────────────────────────────────────────────

/** 가방의 장비를 착용한다. 끼고 있던 장비는 그 칸으로 들어간다. */
export function equipItem(game, bagIndex) {
  if (!activePlayer(game)) return fail('not-playing');
  const inv = game.state.inventory;
  if (!validIndex(inv.bag, bagIndex)) return fail('no-such-item');
  const result = equipFromBag(inv, bagIndex);
  changed(game, 'equip');
  return { ok: true, ...result };
}

/** 착용을 해제해 가방에 넣는다. */
export function unequipItem(game, slot) {
  if (!activePlayer(game)) return fail('not-playing');
  const inv = game.state.inventory;
  if (!(slot in inv.equipped)) return fail('no-such-slot');
  if (!inv.equipped[slot]) return fail('empty-slot');
  if (!unequip(inv, slot)) return fail('bag-full');
  changed(game, 'unequip');
  return { ok: true };
}

/** 가방의 장비를 버린다(사라진다). */
export function discardItem(game, bagIndex) {
  if (!activePlayer(game)) return fail('not-playing');
  const inv = game.state.inventory;
  if (!validIndex(inv.bag, bagIndex)) return fail('no-such-item');
  const item = removeFromBag(inv, bagIndex);
  changed(game, 'discard');
  return { ok: true, item };
}

/** 비교값: 가방의 장비를 끼면 능력치가 어떻게 달라지는가. */
export function compareItem(game, bagIndex) {
  const inv = game.state.inventory;
  if (!validIndex(inv.bag, bagIndex)) return fail('no-such-item');
  return { ok: true, ...compareEquipment(game.state, inv.bag[bagIndex]) };
}

// ── 소비 아이템 ──────────────────────────────────────────────────────────────

export function useConsumable(game, id) {
  const player = activePlayer(game);
  if (!player) return fail('not-playing');
  const def = CONSUMABLES[id];
  if (!def) return fail('no-such-item');
  const { state, bus } = game;
  const { effect } = def;
  // 써 봐야 소용없으면 쓰지 않는다(물약을 허비하지 않도록).
  if (effect.type === 'heal' && player.hp >= player.maxHp) return fail('full-hp');
  if (effect.type === 'cleanse' && Object.keys(player.statuses).length === 0) return fail('nothing-to-cleanse');
  if (!takeConsumable(state.inventory, id)) return fail('none-left');

  if (effect.type === 'heal') {
    heal(player, (player.maxHp * effect.pct) / 100);
  } else if (effect.type === 'cleanse') {
    cleanse(state, bus, player, 'cleansed');
  } else if (effect.type === 'buff') {
    // 같은 물약의 효과는 중첩되지 않고 시간만 갱신된다.
    const until = state.tick + ticksOf(effect.seconds);
    const active = state.run.buffs.find((b) => b.id === id);
    if (active) active.until = until;
    else state.run.buffs.push({ id, stats: { ...effect.stats }, until });
  } else if (effect.type === 'blast') {
    runEffects(state, bus, player, [{ type: 'circle', radius: effect.radius, damage: effect.damage, status: effect.status }], {
      dirX: player.facingX, dirY: player.facingY, targetX: player.x, targetY: player.y,
    });
  }
  bus.emit(EVENTS.CONSUMABLE_USED, { id });
  changed(game, 'consumable');
  return { ok: true };
}

// ── 상점 ─────────────────────────────────────────────────────────────────────

function atShop(game) {
  const player = activePlayer(game);
  if (!player) return fail('not-playing');
  if (!game.state.shop) return fail('no-shop');
  if (!nearby(player, game.state.shop)) return fail('too-far');
  return { ok: true };
}

/** 상점의 품목을 산다. */
export function buyItem(game, stockIndex) {
  const where = atShop(game);
  if (!where.ok) return where;
  const result = buyFromShop(game.state.shop, game.state.inventory, stockIndex);
  if (!result.ok) return result;
  game.bus.emit(EVENTS.SHOP_PURCHASE, { kind: result.entry.kind, price: result.entry.price });
  changed(game, 'buy');
  return result;
}

/** 가방의 장비를 상점에 판다. */
export function sellItem(game, bagIndex) {
  const where = atShop(game);
  if (!where.ok) return where;
  const inv = game.state.inventory;
  if (!validIndex(inv.bag, bagIndex)) return fail('no-such-item');
  const result = sellFromBag(inv, bagIndex);
  game.bus.emit(EVENTS.SHOP_SALE, { uid: result.item.uid, gold: result.gold });
  changed(game, 'sell');
  return { ok: true, ...result };
}

// ── 제단 ─────────────────────────────────────────────────────────────────────

/** 제단의 제안 하나를 받는다: 대가를 치르고 보상을 얻는다. 한 제단은 한 번만 쓸 수 있다. */
export function acceptAltar(game, offerIndex) {
  const player = activePlayer(game);
  if (!player) return fail('not-playing');
  const { state, bus } = game;
  const { altar, inventory: inv, run } = state;
  if (!altar) return fail('no-altar');
  if (!nearby(player, altar)) return fail('too-far');
  const check = canAccept(altar, offerIndex, { hp: player.hp, maxHp: player.maxHp, gold: inv.gold });
  if (!check.ok) return check;
  const offer = altar.offers[offerIndex];
  altar.used = true;

  const { cost, reward } = offer;
  if (cost.type === 'hpPct') player.hp -= hpCost(player.hp, cost.pct);
  else if (cost.type === 'gold') spendGold(inv, cost.amount);
  else if (cost.type === 'maxHp') run.boons.push({ source: 'altar:cost', stats: { maxHp: -cost.amount } });
  else if (cost.type === 'curse') run.boons.push({ source: 'altar:curse', stats: { ...cost.stats } });

  let granted = reward;
  if (reward.type === 'stats') {
    run.boons.push({ source: 'altar:reward', stats: { ...reward.stats } });
  } else if (reward.type === 'gold') {
    addGold(inv, reward.amount);
  } else if (reward.type === 'relic') {
    const id = rollRelic(rngOf(state, 'items'), state.meta, inv.relics);
    if (id) {
      addRelic(inv, id);
      granted = { type: 'relic', id };
    } else {
      // 얻을 유물이 더 없으면 금화로 대신한다.
      addGold(inv, 150);
      granted = { type: 'gold', amount: 150 };
    }
  } else if (reward.type === 'upgrade') {
    run.pendingChoices++;
  }
  // 능력치를 먼저 반영한 뒤에 회복한다(최대 체력이 바뀌었을 수 있다).
  changed(game, 'altar');
  if (reward.type === 'heal') heal(player, player.maxHp);
  if (reward.type === 'upgrade') offerPendingChoice(state, bus);
  bus.emit(EVENTS.ALTAR_ACCEPTED, { tier: offer.tier, cost, reward: granted });
  return { ok: true, cost, reward: granted };
}

// ── 레벨업 ───────────────────────────────────────────────────────────────────

/** 제시된 강화 후보 가운데 하나를 고른다. 쌓인 선택이 더 있으면 다음 후보가 바로 제시된다. */
export function chooseUpgrade(game, optionIndex) {
  const player = activePlayer(game);
  if (!player) return fail('not-playing');
  const { state, bus } = game;
  const { run } = state;
  if (!run.choice) return fail('no-choice');
  if (!validIndex(run.choice.options, optionIndex)) return fail('no-such-option');
  const result = takeChoice(run, optionIndex);
  changed(game, 'upgrade');
  if (result.kind === 'filler') {
    const { effect } = result;
    if (effect.type === 'heal') heal(player, (player.maxHp * effect.pct) / 100);
    else if (effect.type === 'gold') addGold(state.inventory, effect.base + effect.perLevel * run.level);
  }
  bus.emit(EVENTS.UPGRADE_CHOSEN, { kind: result.kind, id: result.id, rank: result.rank });
  offerPendingChoice(state, bus);
  return { ok: true, ...result };
}

// ── 메타 ─────────────────────────────────────────────────────────────────────

/** 영혼석으로 영구 해금을 산다. 시작 보너스와 아이템 풀 확장은 다음 런부터 적용된다. */
export function buyUnlock(game, unlockId) {
  return purchaseUnlock(game.state.meta, unlockId);
}
