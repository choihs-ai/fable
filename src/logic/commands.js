// 플레이어 명령: 틱 바깥에서 ui 가 부르는 행동들(상호작용, 무기 줍기·바꾸기, 축복 고르기, 상점, 출구 포털, 거점의 영구 강화).
//
// 모든 명령은 { ok:true, … } 또는 { ok:false, reason } 을 돌려준다. 안 되는 일을 시켜도 예외를 던지지 않고 이유를 알려 준다
// (잘못된 형식의 인자만 예외). 명령은 런 진행·플레이어를 고친 뒤 능력치를 다시 합산하고 이벤트를 낸다.
// 로직 최상단 파일이다(game.js 와 같은 층) — 로직 모듈은 이 파일을 import 하지 않는다.

import { BOONS } from '../../data/boons.js';
import { ENCOUNTERS } from '../../data/encounters.js';
import { SHOP } from '../../data/shop.js';
import { WEAPONS } from '../../data/weapons.js';
import { EVENTS } from './core/events.js';
import { PHASE, rngOf } from './core/state.js';
import { heal } from './combat/damage.js';
import { currentRoom } from './combat/encounter.js';
import { addDrop, addGold } from './combat/loot.js';
import { swapWeapon, wearForm } from './combat/player.js';
import { getPlayer } from './entities/actors.js';
import { refreshPlayerStats } from './entities/stats.js';
import { endRun, enterFloor } from './game.js';
import { rerollCost, rollBoonChoices } from './items/boons.js';
import { buyUpgrade, metaBonuses, setCurse, unlockCharacter } from './items/meta.js';
import { healPrice, rollShopStock, shopRerollCost } from './items/shop.js';
import { ROOM_KIND, TOTAL_FLOORS } from './world/floors.js';

const fail = (reason) => ({ ok: false, reason });

/** 살아서 플레이 중인 플레이어를 돌려준다. 아니면 null. */
function activePlayer(game) {
  const player = getPlayer(game.state);
  return player && !player.dead && game.state.phase !== PHASE.GAME_OVER && game.state.phase !== PHASE.VICTORY ? player : null;
}

function validIndex(list, index) {
  return Number.isInteger(index) && index >= 0 && index < list.length;
}

function within(player, x, y, radius) {
  const dx = x - player.x;
  const dy = y - player.y;
  return dx * dx + dy * dy <= radius * radius;
}

// ── 상호작용 ─────────────────────────────────────────────────────────────────

/**
 * 지금 상호작용할 수 있는 것. ui 가 상호작용 버튼을 보일지 정할 때도 쓴다(상태를 바꾸지 않는다).
 * @returns {{ type:'weapon', dropId:number, weapon:string } | { type:'form', dropId:number, form:string } | { type:'shop' } | { type:'portal' } | null}
 */
export function interactTarget(state) {
  const player = getPlayer(state);
  if (!player || player.dead || !state.world || state.phase === PHASE.GAME_OVER || state.phase === PHASE.VICTORY) return null;
  const radius = ENCOUNTERS.interactRadius;
  // 가장 가까운 무기 또는 탈.
  let best = null;
  let bestD2 = radius * radius;
  for (const drop of state.drops) {
    if (drop.kind !== 'weapon' && drop.kind !== 'form') continue;
    const dx = drop.x - player.x;
    const dy = drop.y - player.y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      best = drop;
      bestD2 = d2;
    }
  }
  if (best && best.kind === 'form') return { type: 'form', dropId: best.id, form: best.form };
  if (best) return { type: 'weapon', dropId: best.id, weapon: best.weapon };
  const room = currentRoom(state);
  if (!room || state.encounter) return null;
  if (!within(player, room.feature.x + 0.5, room.feature.y + 0.5, radius)) return null;
  if (room.kind === ROOM_KIND.SHOP) return { type: 'shop' };
  if (room.kind === ROOM_KIND.EXIT) return { type: 'portal' };
  return null;
}

/** 무기를 쥔다: 빈 칸이 있으면 거기에, 없으면 든 무기와 바꾸고 원래 무기는 그 자리에 놓는다. */
function takeWeapon(game, player, weaponId, x, y) {
  const kit = player.kit;
  const empty = kit.weapons.indexOf(null);
  let dropped = null;
  if (empty !== -1) {
    kit.weapons[empty] = weaponId;
    kit.slot = empty;
  } else {
    dropped = kit.weapons[kit.slot];
    kit.weapons[kit.slot] = weaponId;
    addDrop(game.state, game.bus, x, y, { kind: 'weapon', weapon: dropped });
  }
  kit.dashAttackUntil = 0;
  game.bus.emit(EVENTS.WEAPON_PICKED, { weapon: weaponId, dropped });
  return dropped;
}

/**
 * 탈을 쓴다: 주운 탈은 지금 든 칸에 들어가고 곧바로 쓴다. 쓰고 있던 탈은 다른 칸이 비어 있으면 그리로 가고,
 * 둘 다 차 있으면 그 자리에 놓인다. 이미 들고 있는 탈이면 그 칸의 것과 자리를 바꾸지 않고 그대로 둔다(줍지 않는다).
 * @returns {string|null} 바닥에 놓인 탈
 */
function takeForm(game, player, form, x, y) {
  const { state, bus } = game;
  const kit = player.kit;
  const from = kit.character;
  const here = kit.slot;
  let dropped = null;
  if (kit.forms[here] === null) kit.forms[here] = form;
  else if (kit.forms[1 - here] === null) {
    kit.forms[1 - here] = kit.forms[here];
    kit.forms[here] = form;
  } else {
    dropped = kit.forms[here];
    kit.forms[here] = form;
    addDrop(state, bus, x, y, { kind: 'form', form: dropped });
  }
  wearForm(state, player, form);
  bus.emit(EVENTS.FORM_CHANGED, { id: player.id, from, to: form, burst: false, picked: true, x: player.x, y: player.y });
  return dropped;
}

/**
 * 가까이 있는 것과 상호작용한다: 무기는 줍고, 상인 앞이면 상점을 열라고 알리고, 포털이면 나간다.
 * @returns {{ ok:true, type:string, … } | { ok:false, reason:string }} reason: 'not-playing' | 'nothing' | 'owned-form'(이미 들고 있는 탈)
 */
export function interact(game) {
  const player = activePlayer(game);
  if (!player) return fail('not-playing');
  const target = interactTarget(game.state);
  if (!target) return fail('nothing');
  if (target.type === 'weapon') {
    const { state } = game;
    const drop = state.drops.find((d) => d.id === target.dropId);
    state.drops = state.drops.filter((d) => d !== drop);
    game.bus.emit(EVENTS.DROP_COLLECTED, { id: drop.id, kind: drop.kind, x: drop.x, y: drop.y });
    const dropped = takeWeapon(game, player, drop.weapon, drop.x, drop.y);
    return { ok: true, type: 'weapon', weapon: drop.weapon, dropped };
  }
  if (target.type === 'form') {
    const { state } = game;
    const drop = state.drops.find((d) => d.id === target.dropId);
    if (player.kit.forms.includes(drop.form)) return fail('owned-form');
    state.drops = state.drops.filter((d) => d !== drop);
    game.bus.emit(EVENTS.DROP_COLLECTED, { id: drop.id, kind: drop.kind, x: drop.x, y: drop.y });
    const dropped = takeForm(game, player, drop.form, drop.x, drop.y);
    return { ok: true, type: 'form', form: drop.form, dropped };
  }
  if (target.type === 'shop') return { ok: true, type: 'shop' };
  return usePortal(game);
}

/** 든 무기를 바꾼다. reason: 'not-playing' | 'no-weapon'(다른 칸이 비어 있다) */
export function swapWeapons(game) {
  if (!activePlayer(game)) return fail('not-playing');
  return swapWeapon(game.state, game.bus) ? { ok: true, slot: getPlayer(game.state).kit.slot } : fail('no-weapon');
}

/**
 * 출구 포털로 나간다. 다음 층이 있으면 다음 층으로, 마지막 층이면 런이 승리로 끝난다.
 * reason: 'not-playing' | 'too-far'
 */
export function usePortal(game) {
  const player = activePlayer(game);
  if (!player) return fail('not-playing');
  const target = interactTarget(game.state);
  if (!target || target.type !== 'portal') return fail('too-far');
  const floor = game.state.run.floor;
  if (floor >= TOTAL_FLOORS) {
    endRun(game, true);
    return { ok: true, type: 'portal', victory: true };
  }
  enterFloor(game, floor + 1);
  return { ok: true, type: 'portal', victory: false, floor: floor + 1 };
}

// ── 축복 3택1 ────────────────────────────────────────────────────────────────

function grantBoon(game, id) {
  game.state.run.boons.push(id);
  refreshPlayerStats(game.state);
  game.bus.emit(EVENTS.BOON_CHOSEN, { boon: id });
}

/** 제시된 축복 가운데 하나를 고른다. reason: 'not-playing' | 'no-choice' | 'bad-index' */
export function chooseBoon(game, index) {
  if (!activePlayer(game)) return fail('not-playing');
  const choice = game.state.run.choice;
  if (!choice || choice.kind !== 'boon') return fail('no-choice');
  if (!validIndex(choice.options, index)) return fail('bad-index');
  const id = choice.options[index];
  game.state.run.choice = null;
  grantBoon(game, id);
  return { ok: true, boon: id };
}

/** 후보를 다시 뽑는 값. 무료 다시 뽑기가 남아 있으면 0. */
export function boonRerollCost(state) {
  if (!state.run.choice) return 0;
  return state.run.freeRerolls > 0 ? 0 : rerollCost(state.run.choice.rerolls);
}

/** 후보를 다시 뽑는다. reason: 'not-playing' | 'no-choice' | 'no-gold' */
export function rerollBoons(game) {
  if (!activePlayer(game)) return fail('not-playing');
  const { state } = game;
  const choice = state.run.choice;
  if (!choice || choice.kind !== 'boon') return fail('no-choice');
  const cost = boonRerollCost(state);
  if (state.run.gold < cost) return fail('no-gold');
  if (cost === 0) state.run.freeRerolls -= 1;
  else {
    addGold(state, game.bus, -cost);
    choice.rerolls += 1;
  }
  choice.options = rollBoonChoices(rngOf(state, 'items'), state.run.boons, choice.options);
  game.bus.emit(EVENTS.BOON_OFFERED, { options: choice.options.slice(), rerolls: choice.rerolls });
  return { ok: true, cost, options: choice.options.slice() };
}

// ── 상점 ─────────────────────────────────────────────────────────────────────

/** 상점 방에 있고 싸우는 중이 아닌가. */
function inShop(game) {
  const room = currentRoom(game.state);
  return room !== null && room.kind === ROOM_KIND.SHOP && game.state.shop !== null && game.state.encounter === null;
}

/** 진열품의 지금 값(회복은 살 때마다 비싸진다). */
export function shopPrice(state, item) {
  const base = item.kind === 'heal' ? healPrice(state.shop.heals) : item.price;
  // 영구 강화 "단골": 값을 %로 깎는다(0 원이던 기본 무기는 그대로 0).
  const discount = metaBonuses(state.meta).shopDiscount;
  return base === 0 ? 0 : Math.max(1, Math.round((base * (100 - discount)) / 100));
}

/**
 * 상점에서 진열품을 산다.
 * reason: 'not-playing' | 'no-shop' | 'bad-index' | 'sold' | 'no-gold' | 'owned'(이미 가진 축복) | 'full-hp'
 */
export function buyShopItem(game, index) {
  const player = activePlayer(game);
  if (!player) return fail('not-playing');
  if (!inShop(game)) return fail('no-shop');
  const { state, bus } = game;
  const { stock } = state.shop;
  if (!validIndex(stock, index)) return fail('bad-index');
  const item = stock[index];
  if (item.sold) return fail('sold');
  const price = shopPrice(state, item);
  if (state.run.gold < price) return fail('no-gold');
  if (item.kind === 'boon' && state.run.boons.includes(item.boon)) return fail('owned');
  if (item.kind === 'heal' && player.hp >= player.maxHp) return fail('full-hp');

  addGold(state, bus, -price);
  if (item.kind === 'weapon') {
    item.sold = true;
    takeWeapon(game, player, item.weapon, player.x, player.y);
  } else if (item.kind === 'boon') {
    item.sold = true;
    grantBoon(game, item.boon);
  } else {
    // 회복은 여러 번 살 수 있다.
    state.shop.heals += 1;
    heal(player, (player.maxHp * SHOP.healPct) / 100);
  }
  bus.emit(EVENTS.SHOP_PURCHASE, { kind: item.kind, weapon: item.weapon, boon: item.boon, price });
  return { ok: true, kind: item.kind, price };
}

/** 진열품을 다시 뽑는다(회복은 그대로). reason: 'not-playing' | 'no-shop' | 'no-gold' */
export function rerollShop(game) {
  const player = activePlayer(game);
  if (!player) return fail('not-playing');
  if (!inShop(game)) return fail('no-shop');
  const { state, bus } = game;
  const cost = shopRerollCost(state.shop.rerolls);
  if (state.run.gold < cost) return fail('no-gold');
  addGold(state, bus, -cost);
  state.shop.rerolls += 1;
  state.shop.stock = rollShopStock(rngOf(state, 'items'), state.run.boons, player.kit.weapons.filter(Boolean));
  return { ok: true, cost };
}

// ── 거점(메타) ───────────────────────────────────────────────────────────────

/** 영혼석으로 영구 강화를 한 단계 올린다. 다음 런부터 적용된다. reason: 'unknown' | 'maxed' | 'no-souls' */
export function buyMetaUpgrade(game, id) {
  if (typeof id !== 'string') throw new TypeError('buyMetaUpgrade: 강화 id 는 문자열이어야 합니다');
  return buyUpgrade(game.state.meta, id);
}

/** 다음 판에 걸 저주 단계를 고른다(열린 단계까지). reason: 'locked' */
export function setMetaCurse(game, level) {
  return setCurse(game.state.meta, level);
}

/** 영혼석으로 캐릭터를 해금한다. reason: 'unknown' | 'owned' | 'no-souls' */
export function unlockMetaCharacter(game, id) {
  if (typeof id !== 'string') throw new TypeError('unlockMetaCharacter: 캐릭터 id 는 문자열이어야 합니다');
  return unlockCharacter(game.state.meta, id);
}

/** ui 가 쓰는 정의 찾기(이름·설명). 모르는 id 면 null. */
export function describeBoon(id) {
  return Object.hasOwn(BOONS, id) ? BOONS[id] : null;
}

export function describeWeapon(id) {
  return Object.hasOwn(WEAPONS, id) ? WEAPONS[id] : null;
}
