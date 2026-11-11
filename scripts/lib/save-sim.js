// 세이브 검증용 도구: 실제 로직으로 "플레이 중인 상태"를 만들어 내는 자동 조작, 가짜 저장소, 무작위 손상기.
// tests/logic/save, tests/save 와 scripts/verify-save.mjs 가 함께 쓴다.

import { buyShopItem, chooseBoon, interact, rerollBoons, rerollShop, swapWeapons } from '../../src/logic/commands.js';
import { setInput } from '../../src/logic/combat/player.js';
import { EventBus } from '../../src/logic/core/event-bus.js';
import { Rng } from '../../src/logic/core/prng.js';
import { PHASE } from '../../src/logic/core/state.js';
import { getPlayer } from '../../src/logic/entities/actors.js';
import { createGame, enterFloor, setPhase, tick } from '../../src/logic/game.js';
import { botStep, createBot } from './bot.js';

export const DT = 1 / 60;

/** 상태를 통째로 복사해 새 이벤트버스와 묶는다. */
export function cloneGame(game) {
  return { state: structuredClone(game.state), bus: new EventBus() };
}

/** 명령 하나를 무작위로 실행한다. 거절돼도 된다(예외만 없으면 된다). */
export function randomCommand(game, rng) {
  const pick = rng.int(0, 5);
  if (pick === 0) return swapWeapons(game);
  if (pick === 1) return interact(game);
  if (pick === 2) return rerollBoons(game);
  if (pick === 3) return buyShopItem(game, rng.int(0, 5));
  if (pick === 4) return rerollShop(game);
  return game.state.run.choice ? chooseBoon(game, rng.int(0, 2)) : swapWeapons(game);
}

/**
 * 자동 조작으로 ticks 틱을 돌린다. 런이 끝나면 거기서 멈춘다.
 * 봇(scripts/lib/bot.js)이 방을 골라 싸우고, 사이사이 무작위 조작(엉뚱한 방향, 아날로그 입력, 수동 조준, 대시·스킬 난타)과
 * 무작위 명령을 섞는다 — 잘 싸우는 것이 목적이 아니라 상태가 여러 모양을 거치게 하는 것이 목적이다.
 * @param {{ commands?:boolean, wild?:boolean, bot?:object, onTick?:(t:number)=>void }} [options]
 *   wild 가 false 면 봇만 조작한다(끝까지 살아남게 할 때).
 * @returns {number} 실제로 돌린 틱 수
 */
export function play(game, rng, ticks, options = {}) {
  const bot = options.bot ?? createBot();
  const wild = options.wild !== false;
  for (let t = 0; t < ticks; t++) {
    if (game.state.phase !== PHASE.PLAYING) return t;
    botStep(game, bot);
    if (wild && rng.chance(0.15)) {
      // 아날로그 입력(크기가 1 보다 작은 값, 음수 0 포함)과 수동 조준도 섞는다.
      setInput(game.state, {
        moveX: (rng.float() * 2 - 1) * (rng.chance(0.3) ? rng.float() : 1),
        moveY: -0 + (rng.float() * 2 - 1),
        aimX: rng.chance(0.5) ? rng.float() - 0.5 : 0,
        aimY: rng.chance(0.5) ? rng.float() - 0.5 : 0,
        attack: !rng.chance(0.2),
        dash: rng.chance(0.2),
        skill: rng.chance(0.2),
      });
    }
    if (wild && options.commands !== false && rng.chance(0.03)) randomCommand(game, rng);
    tick(game, DT);
    if (options.onTick) options.onTick(t);
  }
  return ticks;
}

/**
 * 한 판을 봇으로 돌리면서 여러 순간의 게임을 떼어 낸다(전투 한가운데, 방을 깬 직후, 축복 3택1 이 떠 있을 때, 상점 등).
 * @param {{ seed:string, meta?:object, character?:string, every?:number, limit?:number }} options every 틱마다 하나씩, limit 개까지
 * @returns {{ game:object, at:number, seed:string }[]} 각 게임은 PLAYING 상태의 사본이다
 */
export function stageGames({ seed, meta, character, every = 600, limit = 12 }) {
  const game = createGame({ seed, meta, character });
  enterFloor(game, 1);
  setPhase(game, PHASE.PLAYING);
  const bot = createBot();
  const out = [];
  for (let t = 1; out.length < limit && game.state.phase === PHASE.PLAYING && t < 40000; t++) {
    // 축복 3택1 이 떠 있는 순간도 표본에 넣기 위해, 떼어 내는 틱에는 봇이 고르기 전에 뜬다.
    if (t % every === 0) out.push({ game: cloneGame(game), at: game.state.tick, seed });
    botStep(game, bot);
    tick(game, DT);
  }
  return out;
}

/** 방 전투가 한창인(적이 둘 이상 살아 있는) 게임 하나. */
export function combatGame({ seed, meta, character, minTick = 900 }) {
  const game = createGame({ seed, meta, character });
  enterFloor(game, 1);
  setPhase(game, PHASE.PLAYING);
  const bot = createBot();
  for (let t = 0; t < 30000 && game.state.phase === PHASE.PLAYING; t++) {
    botStep(game, bot);
    tick(game, DT);
    const { state } = game;
    if (state.tick < minTick || !state.encounter) continue;
    let enemies = 0;
    for (const actor of Object.values(state.entities.byId)) if (actor.faction === 'enemy' && !actor.dead) enemies++;
    if (enemies >= 2 && getPlayer(state).hp > 20) return game;
  }
  throw new Error(`전투 중인 표본을 만들지 못함: ${seed}`);
}

/**
 * 상태 안에서 같은 객체(배열 포함)를 두 곳이 가리키거나, data/** 의 동결된 설정 객체를 가리키면 그 경로를 돌려준다(없으면 null).
 * JSON 으로 저장했다 불러오면 그런 객체는 갈라지거나 동결이 풀리므로, 상태에 있으면 안 된다.
 */
export function findSharedObject(value, path = 'state', seen = new Map()) {
  if (value === null || typeof value !== 'object') return null;
  if (seen.has(value)) return `${path} (= ${seen.get(value)})`;
  // data/** 의 설정은 깊게 동결돼 있다. 동결된 객체가 상태에 있으면 설정을 그대로 가리키는 것이다.
  if (Object.isFrozen(value)) return `${path} (동결된 설정 객체)`;
  seen.set(value, path);
  for (const key of Object.keys(value)) {
    const found = findSharedObject(value[key], `${path}.${key}`, seen);
    if (found) return found;
  }
  return null;
}

/** 상태 안에 NaN·Infinity·undefined 가 있으면 그 경로를 돌려준다(없으면 null). */
export function findBadNumber(value, path = 'state') {
  if (typeof value === 'number') return Number.isFinite(value) ? null : path;
  if (value === undefined) return path;
  if (value === null || typeof value !== 'object') return null;
  for (const key of Object.keys(value)) {
    const found = findBadNumber(value[key], `${path}.${key}`);
    if (found) return found;
  }
  return null;
}

// ── 가짜 저장소 ──────────────────────────────────────────────────────────────

function quotaError() {
  const err = new Error('The quota has been exceeded.');
  err.name = 'QuotaExceededError';
  err.code = 22;
  return err;
}

/**
 * localStorage 흉내. 용량(키와 값의 글자 수 합)을 넘기면 QuotaExceededError 를 던진다.
 * @param {object} [options]
 * @param {number} [options.quota] 전체 용량(글자 수). 기본은 무제한
 * @param {object} [options.items] 처음부터 들어 있는 값
 * @param {boolean} [options.failGet] getItem 이 예외를 던진다
 * @param {boolean} [options.failSet] setItem 이 항상 용량 초과로 실패한다(예전 사파리 비공개 모드)
 * @param {boolean} [options.failRemove] removeItem 이 예외를 던진다
 */
export function createFakeStorage(options = {}) {
  const items = new Map(Object.entries(options.items ?? {}));
  const storage = {
    quota: options.quota ?? Infinity,
    failGet: options.failGet ?? false,
    failSet: options.failSet ?? false,
    failRemove: options.failRemove ?? false,
    /** 지금까지의 호출 수. */
    writes: 0,
    items,
    used() {
      let total = 0;
      for (const [key, value] of items) total += key.length + value.length;
      return total;
    },
    getItem(key) {
      if (storage.failGet) throw new Error('SecurityError');
      return items.has(key) ? items.get(key) : null;
    },
    setItem(key, value) {
      const text = String(value);
      const old = items.has(key) ? key.length + items.get(key).length : 0;
      if (storage.failSet || storage.used() - old + key.length + text.length > storage.quota) throw quotaError();
      storage.writes++;
      items.set(key, text);
    },
    removeItem(key) {
      if (storage.failRemove) throw new Error('SecurityError');
      items.delete(key);
    },
  };
  return storage;
}

// ── 무작위 손상 ──────────────────────────────────────────────────────────────

/** 손상에 쓰는 고약한 값들. JSON 에 들어갈 수 있는 것만 있다(NaN·undefined 는 JSON 에 없다). */
const NASTY = [
  null, true, false, '', 'x', 'constructor', '__proto__', 'toString', 'player', '0', -1, 0, 1, 2, 0.5, -0.5, 1e9, -1e9, 1e21, 1e308, -1e308,
  2147483648, 4294967296, 9007199254740993, [], {}, [0], [null], { a: 1 }, { x: 1, y: 1 }, 'a'.repeat(300),
];

/** 값 안의 모든 자리(부모·키 쌍)를 모은다. */
function collectSlots(value, out) {
  if (value === null || typeof value !== 'object') return;
  const keys = Array.isArray(value) ? value.keys() : Object.keys(value);
  for (const key of keys) {
    out.push([value, key]);
    collectSlots(value[key], out);
  }
}

/**
 * 본문의 한 자리를 무작위로 망가뜨린다(제자리에서 고친다).
 * 큰 0/1 배열(타일·시야)이 자리의 대부분을 차지하므로, 그 안은 드물게만 고른다.
 * @returns {string} 무엇을 했는지
 */
export function mutateRandom(data, rng) {
  const all = [];
  collectSlots(data, all);
  const slots = all.filter(([parent]) => !(Array.isArray(parent) && parent.length > 64) || rng.chance(0.002));
  const [parent, key] = rng.pick(slots);
  const before = parent[key];
  const how = rng.int(0, 9);
  if (how <= 3) {
    parent[key] = structuredClone(rng.pick(NASTY));
    return `set ${String(key)} = ${JSON.stringify(parent[key]).slice(0, 30)}`;
  }
  if (how === 4) {
    if (Array.isArray(parent)) parent.splice(key, 1);
    else delete parent[key];
    return `delete ${String(key)}`;
  }
  if (how === 5 && typeof before === 'number') {
    parent[key] = rng.pick([-before, before + 1, before - 1, before * 1000, before + 0.5, before * 1e6, Math.floor(before / 2)]);
    return `number ${String(key)} ${before} → ${parent[key]}`;
  }
  if (how === 6 && Array.isArray(before)) {
    const op = rng.int(0, 3);
    if (op === 0) before.length = Math.floor(before.length / 2);
    else if (op === 1 && before.length > 0) before.push(structuredClone(before[0]));
    else if (op === 2) before.push(structuredClone(rng.pick(NASTY)));
    else before.reverse();
    return `array ${String(key)} op ${op}`;
  }
  if (how === 7 && before !== null && typeof before === 'object' && !Array.isArray(before)) {
    before[rng.pick(['constructor', '__proto__', 'extra', 'hasOwnProperty', '0'])] = structuredClone(rng.pick(NASTY));
    return `extra key in ${String(key)}`;
  }
  if (how === 8) {
    // 다른 자리의 값을 가져다 놓는다(형식은 그럴듯하지만 뜻이 맞지 않는 값).
    const [otherParent, otherKey] = rng.pick(slots);
    parent[key] = structuredClone(otherParent[otherKey]);
    return `copy ${String(otherKey)} → ${String(key)}`;
  }
  if (typeof before === 'string') {
    parent[key] = rng.pick(['', `${before}x`, before.slice(1), before.toUpperCase(), 'constructor']);
    return `string ${String(key)} → "${parent[key].slice(0, 20)}"`;
  }
  parent[key] = structuredClone(rng.pick(NASTY));
  return `set ${String(key)} = ${JSON.stringify(parent[key]).slice(0, 30)}`;
}

/** 글의 한 군데를 무작위로 망가뜨린다(자르기, 글자 바꾸기·지우기·넣기, 구간 뒤집기). */
export function corruptText(text, rng) {
  if (text.length === 0) return rng.pick(['{', '"', 'x', '\u0000']);
  const at = rng.int(0, text.length - 1);
  const how = rng.int(0, 5);
  if (how === 0) return text.slice(0, at);
  if (how === 1) return text.slice(0, at) + rng.pick(['0', '9', 'x', '"', '{', '}', ',', ' ', '\u0000', '한']) + text.slice(at + 1);
  if (how === 2) return text.slice(0, at) + text.slice(at + 1);
  if (how === 3) return text.slice(0, at) + rng.pick(['1', '"', ':', '[', 'null', '\\']) + text.slice(at);
  if (how === 4) return text.slice(at);
  const len = rng.int(1, 200);
  return text.slice(0, at) + text.slice(at, at + len).split('').reverse().join('') + text.slice(at + len);
}

export { Rng };
