// 건져 내기: 런 세이브가 그대로는 못 쓸 만큼 망가졌을 때, 믿을 수 있는 핵심(시드·층·캐릭터·무기·축복·금화)만 골라낸다.
// 층의 진행 중 상태(적·투사체·맵·방의 진행)는 버리고, 불러오는 쪽(logic/game.js 의 resumeGame)이 그 층을 시드로 다시 만든다.
// 항목마다 따로 검사해서 통과한 것만 받는다 — 하나가 틀렸다고 전부 버리지 않는다.

import { BOONS } from '../../../data/boons.js';
import { SAVE } from '../../../data/save.js';
import { WEAPONS } from '../../../data/weapons.js';
import { RNG_STREAMS } from '../core/state.js';
import { TOTAL_FLOORS } from '../world/floors.js';
import { createReport, isInt, isKeyOf, isNum, isObject, passes } from './schema.js';
import { runFields } from './validate.js';

const L = SAVE.limits;

/** 검사기 하나를 통과하는가. */
function good(check, value) {
  return passes(createReport(1), check, value, '');
}

/**
 * 런 본문에서 핵심을 골라낸다. 시드와 층은 반드시 올바라야 하고(없으면 그 런은 되살릴 수 없다), 나머지는 틀리면 기본값으로 둔다.
 * @param {*} data 세이브 본문 또는 실행 중이던 상태
 * @returns {{ ok:true, core:object, repaired:string[] } | { ok:false, reason:string }}
 *   core: { seed, tick, rng, run:{ floor, character, gold, boons, boonState, freeRerolls, kills, eliteKills, bossKills, roomsCleared },
 *           kit:{ weapons, slot, energy }|null, hp, nextId } — rng 는 스트림 이름 → 수열 위치(숫자 4개) 또는 null,
 *           kit 은 플레이어의 무기와 에너지 또는 null, hp 는 플레이어 체력 또는 null
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

  const run = {
    floor: rawRun.floor, character: 'knight', gold: 0, boons: [], boonState: { shots: 0, iceArmorAt: 0, steamAt: 0, revived: false },
    freeRerolls: 0, kills: 0, eliteKills: 0, bossKills: 0, roomsCleared: 0,
  };
  for (const key of ['character', 'gold', 'freeRerolls', 'kills', 'eliteKills', 'bossKills', 'roomsCleared']) {
    if (good(runFields[key], rawRun[key])) run[key] = rawRun[key];
    else repaired.push(`run.${key}`);
  }
  if (Array.isArray(rawRun.boons)) {
    for (const id of rawRun.boons.slice(0, 256)) {
      if (isKeyOf(BOONS, id) && !run.boons.includes(id)) run.boons.push(id);
      else repaired.push('run.boons[]');
    }
  } else repaired.push('run.boons');
  // 축복의 진행 상태에서는 "되살아났는가"만 가져온다(나머지는 틱에 묶인 값이라 층을 다시 만들면 의미가 없다).
  if (isObject(rawRun.boonState) && rawRun.boonState.revived === true) run.boonState.revived = true;

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
  let kit = null;
  const byId = isObject(data.entities) ? data.entities.byId : null;
  const player = isObject(byId) && isInt(data.playerId, 1, L.id) && Object.hasOwn(byId, String(data.playerId)) ? byId[data.playerId] : null;
  if (isObject(player) && isInt(player.hp, 1, L.hp)) hp = player.hp;
  else repaired.push('player.hp');
  const rawKit = isObject(player) ? player.kit : null;
  if (isObject(rawKit) && Array.isArray(rawKit.weapons) && rawKit.weapons.length === 2) {
    const weapons = rawKit.weapons.map((id) => (isKeyOf(WEAPONS, id) ? id : null));
    const slot = rawKit.slot === 1 ? 1 : 0;
    // 든 칸에는 무기가 있어야 한다.
    if (weapons[slot] !== null || weapons[1 - slot] !== null) {
      kit = { weapons, slot: weapons[slot] !== null ? slot : 1 - slot, energy: isNum(rawKit.energy, 0, L.count) ? rawKit.energy : 0 };
    }
  }
  if (kit === null) repaired.push('player.kit');

  const nextId = isObject(data.entities) && isInt(data.entities.nextId, 1, L.id) ? data.entities.nextId : 1;
  return { ok: true, core: { seed: data.seed, tick, rng, run, kit, hp, nextId }, repaired };
}
