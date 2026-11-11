// 건져 내기: 런 세이브가 그대로는 못 쓸 만큼 망가졌을 때, 믿을 수 있는 핵심(시드·층·진행도·인벤토리)만 골라낸다.
// 층의 진행 중 상태(적·투사체·맵)는 버리고, 불러오는 쪽(logic/game.js 의 resumeGame)이 그 층을 시드로 다시 만든다.
// 항목마다 따로 검사해서 통과한 것만 받는다 — 하나가 틀렸다고 전부 버리지 않는다.

import { SAVE } from '../../../data/save.js';
import { INVENTORY, SLOTS } from '../../../data/items.js';
import { RELICS } from '../../../data/relics.js';
import { CONSUMABLES } from '../../../data/consumables.js';
import { UPGRADES } from '../../../data/upgrades.js';
import { RNG_STREAMS } from '../core/state.js';
import { TOTAL_FLOORS } from '../world/floors.js';
import { createReport, isInt, isKeyOf, isObject, passes } from './schema.js';
import { checkItem, runFields } from './validate.js';

const L = SAVE.limits;

/** 검사기 하나를 통과하는가. */
function good(check, value) {
  return passes(createReport(1), check, value, '');
}

/**
 * 인벤토리에서 올바른 것만 골라 새 인벤토리를 만든다.
 * @returns {{ inventory:object, dropped:number }} dropped: 버린 항목 수
 */
export function sanitizeInventory(raw) {
  const equipped = {};
  for (const slot of SLOTS) equipped[slot] = null;
  const inventory = { capacity: INVENTORY.capacity, bag: [], equipped, consumables: {}, relics: [], gold: 0 };
  if (!isObject(raw)) return { inventory, dropped: 1 };
  let dropped = 0;
  const seen = new Set();
  const usable = (item) => {
    if (!good(checkItem, item) || seen.has(item.uid)) return false;
    seen.add(item.uid);
    return true;
  };

  if (isInt(raw.capacity, 1, 1000)) inventory.capacity = raw.capacity;
  else dropped++;
  if (isObject(raw.equipped)) {
    for (const slot of SLOTS) {
      const item = raw.equipped[slot];
      if (item === null || item === undefined) continue;
      if (usable(item) && item.slot === slot) equipped[slot] = item;
      else dropped++;
    }
  } else dropped++;
  if (Array.isArray(raw.bag)) {
    for (const item of raw.bag.slice(0, L.listLength)) {
      if (inventory.bag.length < inventory.capacity && usable(item)) inventory.bag.push(item);
      else dropped++;
    }
  } else dropped++;
  if (isObject(raw.consumables)) {
    for (const key of Object.keys(raw.consumables).slice(0, 256)) {
      if (isKeyOf(CONSUMABLES, key) && isInt(raw.consumables[key], 1, L.count)) inventory.consumables[key] = raw.consumables[key];
      else dropped++;
    }
  } else dropped++;
  if (Array.isArray(raw.relics)) {
    for (const relic of raw.relics.slice(0, 256)) {
      if (isKeyOf(RELICS, relic) && !inventory.relics.includes(relic)) inventory.relics.push(relic);
      else dropped++;
    }
  } else dropped++;
  if (isInt(raw.gold, 0, L.gold)) inventory.gold = raw.gold;
  else dropped++;
  return { inventory, dropped };
}

/**
 * 런 본문에서 핵심을 골라낸다. 시드와 층은 반드시 올바라야 하고(없으면 그 런은 되살릴 수 없다), 나머지는 틀리면 기본값으로 둔다.
 * @param {*} data 세이브 본문 또는 실행 중이던 상태
 * @returns {{ ok:true, core:object, repaired:string[] } | { ok:false, reason:string }}
 *   core: { seed, tick, rng, run:{ floor, level, xp, pendingChoices, upgrades, boons, kills, bossKills, reviveUsed },
 *           inventory, hp, nextId } — rng 는 스트림 이름 → 수열 위치(숫자 4개) 또는 null, hp 는 플레이어 체력 또는 null
 *   repaired: 기본값으로 되돌린 항목
 */
export function extractCore(data) {
  if (!isObject(data)) return { ok: false, reason: 'not-object' };
  if (typeof data.seed !== 'string' || data.seed.length < 1 || data.seed.length > L.seedLength) return { ok: false, reason: 'bad-seed' };
  const rawRun = data.run;
  if (!isObject(rawRun) || !isInt(rawRun.floor, 1, TOTAL_FLOORS)) return { ok: false, reason: 'bad-floor' };

  const repaired = [];
  const tick = isInt(data.tick, 0, L.tick) ? data.tick : 0;
  if (tick !== data.tick) repaired.push('tick');

  const run = { floor: rawRun.floor, level: 1, xp: 0, pendingChoices: 0, upgrades: {}, boons: [], kills: 0, bossKills: 0, reviveUsed: false };
  for (const key of ['level', 'xp', 'pendingChoices', 'kills', 'bossKills', 'reviveUsed']) {
    if (good(runFields[key], rawRun[key])) run[key] = rawRun[key];
    else repaired.push(`run.${key}`);
  }
  // 제시된 채로 저장된 강화 후보는 다시 제시한다.
  if (rawRun.choice !== null && rawRun.choice !== undefined && run.pendingChoices < L.count) run.pendingChoices++;
  if (isObject(rawRun.upgrades)) {
    for (const key of Object.keys(rawRun.upgrades).slice(0, 256)) {
      const rank = rawRun.upgrades[key];
      if (isKeyOf(UPGRADES, key) && isInt(rank, 1, 99)) run.upgrades[key] = Math.min(rank, UPGRADES[key].maxRank);
      else repaired.push(`run.upgrades.${key.slice(0, 24)}`);
    }
  } else repaired.push('run.upgrades');
  if (Array.isArray(rawRun.boons)) {
    const boon = runFields.boons;
    for (const entry of rawRun.boons.slice(0, L.listLength)) {
      if (good(boon, [entry])) run.boons.push(entry);
      else repaired.push('run.boons[]');
    }
  } else repaired.push('run.boons');

  const { inventory, dropped } = sanitizeInventory(data.inventory);
  if (dropped > 0) repaired.push(`inventory(${dropped})`);

  // 난수: 스트림마다 수열 위치만 가져온다. 키는 불러오는 쪽이 시드에서 다시 만든다.
  let rng = {};
  for (const name of RNG_STREAMS) {
    const stream = isObject(data.rng) ? data.rng[name] : null;
    const s = isObject(stream) ? stream.s : null;
    if (Array.isArray(s) && s.length === 4 && s.every((n) => isInt(n, 0, 0xffffffff))) rng[name] = [...s];
    else rng = null;
    if (rng === null) break;
  }
  if (rng === null) repaired.push('rng');

  let hp = null;
  const byId = isObject(data.entities) ? data.entities.byId : null;
  const player = isObject(byId) && isInt(data.playerId, 1, L.id) && Object.hasOwn(byId, String(data.playerId)) ? byId[data.playerId] : null;
  if (isObject(player) && isInt(player.hp, 1, L.hp)) hp = player.hp;
  else repaired.push('player.hp');

  // 새로 만들 번호는 가진 장비의 번호와 겹치지 않아야 한다.
  let nextId = 1;
  for (const item of [...inventory.bag, ...SLOTS.map((slot) => inventory.equipped[slot])]) {
    if (item && item.uid >= nextId) nextId = item.uid + 1;
  }
  return { ok: true, core: { seed: data.seed, tick, rng, run, inventory, hp, nextId }, repaired };
}
