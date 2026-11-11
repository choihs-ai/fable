// 런 상태 검증기. 세이브에서 읽은 값이 "그대로 이어서 돌려도 안전한 상태"인지 확인한다.
// 여기를 통과한 상태만 이어하기에 쓰고(logic/save/codec.js), 저장할 때도 통과한 상태만 쓴다.
//
// 기준은 "로직이 이 값을 읽다가 죽거나 NaN 을 퍼뜨리지 않는가"다: 형식(타입·필드), 표에서 찾는 이름, 격자 안의 위치,
// 서로 가리키는 번호. 범위는 SAVE.limits 로 넉넉하게 잡는다 — 밸런스 수치를 조정해도 기존 세이브가 거부되지 않아야 한다.
// (그래서 수치를 고친 세이브, 곧 치트는 걸러내지 않는다.)
// 필드를 추가·삭제하면 STATE_VERSION 을 올리고 이 파일과 migrate.js 를 함께 고친다.

import { BOSSES } from '../../../data/bosses.js';
import { CONSUMABLES } from '../../../data/consumables.js';
import { ENEMIES } from '../../../data/enemies.js';
import { BASES, RARITIES, SETS, SLOTS, STATS } from '../../../data/items.js';
import { PLAYER } from '../../../data/player.js';
import { RELICS } from '../../../data/relics.js';
import { SAVE } from '../../../data/save.js';
import { ALTAR } from '../../../data/shop.js';
import { STATUSES } from '../../../data/statuses.js';
import { FILLERS, UPGRADES } from '../../../data/upgrades.js';
import { ZONES } from '../../../data/zones.js';
import { PHASE, RNG_STREAMS, STATE_VERSION } from '../core/state.js';
import { ACTOR_KIND } from '../entities/defs.js';
import { FLOOR_KIND, TOTAL_FLOORS } from '../world/floors.js';
import { circleFree } from '../world/collide.js';
import { bfsDistances } from '../world/grid.js';
import { navOf } from '../world/nav.js';
import { TILE } from '../world/tiles.js';
import {
  among, bool, createReport, int, isInt, isKeyOf, isNum, isObject, keyOf, list, nullable, num, passes, record, shape, show, text,
} from './schema.js';

const L = SAVE.limits;

/** 런 세이브의 최상위 필드. meta 는 따로 저장하므로 없어도 된다. */
export const STATE_KEYS = Object.freeze([
  'version', 'seed', 'tick', 'phase', 'rng', 'run', 'world', 'entities', 'playerId', 'projectiles', 'hazards',
  'vision', 'input', 'inventory', 'drops', 'shop', 'altar',
]);

/** 이어할 수 있는 페이즈. 그 밖은 끝난 런이거나(gameOver·victory) 아직 시작하지 않은 상태(title)다. */
export const RESUMABLE_PHASES = Object.freeze([PHASE.PLAYING, PHASE.PAUSED]);

// ── 공통 조각 ────────────────────────────────────────────────────────────────

const id = int(1, L.id);
/** "언제까지"를 뜻하는 틱 번호. 지나간 값은 괜찮지만 터무니없이 먼 미래는 손상으로 본다. */
const timer = (r, v, p) => {
  if (!isInt(v, 0, r.timerMax)) r.fail(p, `타이머 범위(0~${r.timerMax})를 벗어남 (${show(v)})`);
};
const statValue = int(-L.statValue, L.statValue);
const statRecord = record((key) => isKeyOf(STATS, key), statValue, 64);
const unit = num(-1.001, 1.001);
const coord = num(-L.mapSide, 2 * L.mapSide);
const u32Quad = list(int(0, 0xffffffff), 4, 4);
const rngData = shape({ key: u32Quad, s: u32Quad });
const statusSpec = shape({ id: keyOf(STATUSES) }, { duration: num(0, 3600), chance: num(0, 1), stacks: int(1, 99) });

// ── 아이템·인벤토리 ──────────────────────────────────────────────────────────

const option = shape({ stat: keyOf(STATS), value: statValue });
const itemShape = shape({
  kind: among(['equipment']),
  uid: id,
  base: keyOf(BASES),
  slot: among(SLOTS),
  rarity: among(RARITIES),
  ilvl: int(1, L.itemLevel),
  setId: nullable(keyOf(SETS)),
  implicit: list(option, 16),
  affixes: list(option, 16),
});

/** 장비 하나. */
export function checkItem(r, v, p) {
  if (!passes(r, itemShape, v, p)) return;
  if (BASES[v.base].slot !== v.slot) r.fail(`${p}.slot`, `${v.base} 의 부위가 아님 (${show(v.slot)})`);
}

const inventoryShape = shape({
  capacity: int(1, 1000),
  bag: list(checkItem, 1000),
  equipped: shape(Object.fromEntries(SLOTS.map((slot) => [slot, nullable(checkItem)]))),
  consumables: record((key) => isKeyOf(CONSUMABLES, key), int(1, L.count), 256),
  relics: list(keyOf(RELICS), 256),
  gold: int(0, L.gold),
});

export function checkInventory(r, v, p) {
  if (!passes(r, inventoryShape, v, p)) return;
  if (v.bag.length > v.capacity) r.fail(`${p}.bag`, `가방 칸(${v.capacity})보다 많음 (${v.bag.length})`);
  for (const slot of SLOTS) {
    const item = v.equipped[slot];
    if (item && item.slot !== slot) r.fail(`${p}.equipped.${slot}`, `다른 부위의 장비 (${item.slot})`);
  }
  if (new Set(v.relics).size !== v.relics.length) r.fail(`${p}.relics`, '같은 유물이 두 번 들어 있음');
}

// ── 런 진행 ──────────────────────────────────────────────────────────────────

const choiceOptionShape = shape({ kind: among(['upgrade', 'filler']), id: text(64) });
function checkChoiceOption(r, v, p) {
  if (!passes(r, choiceOptionShape, v, p)) return;
  if (!isKeyOf(v.kind === 'upgrade' ? UPGRADES : FILLERS, v.id)) r.fail(`${p}.id`, `알 수 없는 이름 (${show(v.id)})`);
}

export const runFields = Object.freeze({
  floor: int(1, TOTAL_FLOORS),
  level: int(1, L.level),
  xp: int(0, L.xp),
  pendingChoices: int(0, L.count),
  choice: nullable(shape({ options: list(checkChoiceOption, 16, 1) })),
  upgrades: record((key) => isKeyOf(UPGRADES, key), int(1, 99), 256),
  boons: list(shape({ source: text(64), stats: statRecord }), L.listLength),
  buffs: list(shape({ id: keyOf(CONSUMABLES), stats: statRecord, until: timer }), 256),
  kills: int(0, L.count),
  bossKills: int(0, L.count),
  reviveUsed: bool,
  regenPool: int(0, L.count),
  // 합산 능력치는 불러온 뒤에 다시 계산하므로 형식만 본다.
  sheet: (r, v, p) => {
    if (v !== null && !isObject(v)) r.fail(p, `객체가 아님 (${show(v)})`);
  },
  ended: bool,
});
const runShape = shape(runFields);

/** 런의 핵심부: 버전, 시드, 틱, 페이즈, 난수 스트림, 진행도, 인벤토리. */
function checkCore(r, state) {
  if (state.version !== STATE_VERSION) r.fail('version', `현재 버전(${STATE_VERSION})이 아님 (${show(state.version)})`);
  text(L.seedLength, 1)(r, state.seed, 'seed');
  int(0, L.tick)(r, state.tick, 'tick');
  among(Object.values(PHASE))(r, state.phase, 'phase');
  shape(Object.fromEntries(RNG_STREAMS.map((name) => [name, rngData])))(r, state.rng, 'rng');
  runShape(r, state.run, 'run');
  checkInventory(r, state.inventory, 'inventory');
}

// ── 맵 ───────────────────────────────────────────────────────────────────────

const cell = shape({ x: int(0, L.mapSide), y: int(0, L.mapSide) });
const rect = { x: int(0, L.mapSide), y: int(0, L.mapSide), w: int(0, L.mapSide), h: int(0, L.mapSide) };
const worldShape = shape({
  floor: int(1, TOTAL_FLOORS),
  zoneId: among(ZONES.map((zone) => zone.id)),
  kind: among(Object.values(FLOOR_KIND)),
  algorithm: text(32),
  width: int(3, L.mapSide),
  height: int(3, L.mapSide),
  tiles: (r, v, p) => {
    if (!Array.isArray(v)) r.fail(p, `배열이 아님 (${show(v)})`);
  },
  start: cell,
  stairs: nullable(cell),
  rooms: list(shape(rect), 1024),
  eventRooms: list(shape({ kind: among(['shop', 'altar']), ...rect, feature: cell }), 16),
  spawns: list(shape({ kind: among(['enemy', 'boss', 'item']), x: int(0, L.mapSide), y: int(0, L.mapSide) }, { id: text(64) }), 1024),
  // 생성 통계(디버그용). 로직이 읽지 않으므로 형식만 본다.
  gen: record((key) => key.length <= 32, (r, v, p) => {
    if (typeof v !== 'boolean' && !isNum(v, -L.count, L.count)) r.fail(p, `수나 참/거짓이 아님 (${show(v)})`);
  }, 16),
});

/** 0/1 만 든 길이 size 의 배열인가. */
function checkBits(r, v, p, size) {
  if (!Array.isArray(v) || v.length !== size) return r.fail(p, `길이 ${size} 의 배열이 아님 (${show(v)})`);
  for (let i = 0; i < size; i++) {
    if (v[i] !== 0 && v[i] !== 1) return r.fail(`${p}[${i}]`, `0 또는 1 이 아님 (${show(v[i])})`);
  }
  return true;
}

/** 맵을 검사한다. 통과하면 이후 검사가 쓸 격자 정보를 r.map 에 넣는다. */
function checkWorld(r, state) {
  const map = state.world;
  if (map === null) return r.fail('world', '층이 만들어지지 않음');
  if (!passes(r, worldShape, map, 'world')) return undefined;
  const { width: w, height: h, tiles } = map;
  if (checkBits(r, tiles, 'world.tiles', w * h) !== true) return undefined;
  // 테두리가 벽이어야 충돌·시야 계산이 격자 밖을 읽지 않는다.
  for (let x = 0; x < w; x++) {
    if (tiles[x] !== TILE.WALL || tiles[(h - 1) * w + x] !== TILE.WALL) return r.fail('world.tiles', '테두리가 벽이 아님');
  }
  for (let y = 0; y < h; y++) {
    if (tiles[y * w] !== TILE.WALL || tiles[y * w + w - 1] !== TILE.WALL) return r.fail('world.tiles', '테두리가 벽이 아님');
  }
  const floorAt = (c) => c.x < w && c.y < h && tiles[c.y * w + c.x] === TILE.FLOOR;
  if (!floorAt(map.start)) return r.fail('world.start', '바닥이 아님');
  if (map.stairs) {
    if (!floorAt(map.stairs)) return r.fail('world.stairs', '바닥이 아님');
    const dist = bfsDistances(tiles, w, h, map.start.y * w + map.start.x);
    if (dist[map.stairs.y * w + map.stairs.x] < 0) return r.fail('world.stairs', '시작점에서 닿을 수 없음');
  }
  for (let i = 0; i < map.spawns.length; i++) {
    if (!floorAt(map.spawns[i])) r.fail(`world.spawns[${i}]`, '바닥이 아님');
  }
  for (let i = 0; i < map.eventRooms.length; i++) {
    const f = map.eventRooms[i].feature;
    if (f.x >= w || f.y >= h) r.fail(`world.eventRooms[${i}].feature`, '맵 밖');
  }
  if (isObject(state.run) && map.floor !== state.run.floor) r.fail('world.floor', `진행 중인 층(${show(state.run.floor)})과 다름 (${map.floor})`);
  r.map = { w, h, tiles, cells: w * h, nav: navOf(map) };
  return undefined;
}

/** (x, y) 가 맵 안인가. needFloor 면 그 칸이 바닥이어야 한다. */
function checkPosition(r, x, y, p, needFloor) {
  const { w, h, tiles } = r.map;
  if (!isNum(x, 0, w) || !isNum(y, 0, h) || x >= w || y >= h) return r.fail(p, `맵 밖의 위치 (${show(x)}, ${show(y)})`);
  if (needFloor && tiles[Math.floor(y) * w + Math.floor(x)] !== TILE.FLOOR) return r.fail(p, `벽 속의 위치 (${x}, ${y})`);
  return undefined;
}

// ── 행동체 ───────────────────────────────────────────────────────────────────

/** 장판의 중심은 맵 둘레 이만큼까지 허용한다(보스 패턴의 오프셋은 최대 2.4칸). */
const HAZARD_MARGIN = 8;
/** 몸이 벽에 이만큼 파고든 것까지는 허용한다(충돌 처리의 계산 오차). */
const BODY_SLACK = 0.02;

const actionShape = shape({
  ability: text(64),
  phase: among(['windup', 'recover']),
  until: timer,
  dirX: unit,
  dirY: unit,
  targetX: coord,
  targetY: coord,
});
const dashShape = shape({
  dirX: unit,
  dirY: unit,
  speed: num(0, 100),
  endAt: timer,
  damage: num(0, L.hp),
  status: nullable(statusSpec),
  hit: list(id, L.listLength),
  stopOnWall: bool,
  stunOnWall: num(0, 3600),
  done: bool,
  wall: bool,
});
const sign = among([-1, 1]);
const aiShape = shape({
  mode: among(['idle', 'combat', 'return']),
  homeX: coord,
  homeY: coord,
  provoked: bool,
  lastSeenAt: timer,
  chaseUntil: timer,
  returnStuckSince: timer,
  nav: shape({
    path: nullable(list(int(0, L.mapSide * L.mapSide), L.listLength)),
    idx: int(0, L.listLength),
    goal: int(-1, L.mapSide * L.mapSide),
    repathAt: timer,
    failUntil: timer,
  }),
  phase: int(0, 64),
  nextPatternAt: timer,
  transitionUntil: timer,
  strafeSign: sign,
  strafeFlipAt: timer,
  orbitSign: sign,
  retreatUntil: timer,
  fled: bool,
  nextBlinkAt: timer,
});
const actorShape = shape({
  id,
  kind: among(Object.values(ACTOR_KIND)),
  type: text(64),
  faction: among(['player', 'enemy']),
  x: coord,
  y: coord,
  radius: num(0.1, 2),
  mass: num(0.01, 1000),
  facingX: unit,
  facingY: unit,
  hp: int(0, L.hp),
  maxHp: int(1, L.hp),
  armor: num(0, L.statValue),
  speed: num(0, 30),
  power: num(0, 10000),
  critChance: num(0, 1),
  critDamage: num(0, 1000),
  lifesteal: num(0, 1),
  haste: num(0, 0.95),
  regen: num(0, L.statValue),
  onHit: nullable(list(shape({ id: keyOf(STATUSES), chance: num(0, 1) }), 16)),
  moveX: unit,
  moveY: unit,
  moveScale: num(0, 4),
  moved: bool,
  hitWall: bool,
  speedMul: num(0, 4),
  disabled: bool,
  statuses: record((key) => isKeyOf(STATUSES, key), shape({ stacks: int(1, 99), until: timer, nextTick: timer, sourceId: nullable(id) }), 64),
  immuneUntil: record((key) => isKeyOf(STATUSES, key), timer, 64),
  cooldowns: record((key) => key.length <= 64, timer, 256),
  action: nullable(actionShape),
  dash: nullable(dashShape),
  invulnUntil: timer,
  dead: bool,
  reaped: bool,
  killerId: nullable(id),
  summonerId: nullable(id),
  ai: nullable(aiShape),
});

function checkActor(r, actor, p) {
  if (!passes(r, actorShape, actor, p)) return;
  // 종류와 정의.
  let def = null;
  if (actor.kind === ACTOR_KIND.PLAYER) def = actor.type === 'player' ? PLAYER : null;
  else if (actor.kind === ACTOR_KIND.ENEMY) def = isKeyOf(ENEMIES, actor.type) ? ENEMIES[actor.type] : null;
  else def = isKeyOf(BOSSES, actor.type) ? BOSSES[actor.type] : null;
  if (!def) return void r.fail(`${p}.type`, `${actor.kind} 에 없는 종류 (${show(actor.type)})`);
  const isPlayer = actor.kind === ACTOR_KIND.PLAYER;
  if (actor.faction !== (isPlayer ? 'player' : 'enemy')) r.fail(`${p}.faction`, `종류와 맞지 않음 (${actor.faction})`);

  if (passes(r, (rr, v, pp) => checkPosition(rr, actor.x, actor.y, pp, true), actor, p)) {
    // 몸이 벽과 겹쳐 있으면 충돌 처리가 맵 밖으로 밀어낼 수 있다(터무니없이 큰 반지름, 좁은 통로에 놓인 큰 몸).
    if (!circleFree(r.map.nav, actor.x, actor.y, actor.radius - BODY_SLACK)) r.fail(p, `몸이 벽과 겹침 (${actor.x}, ${actor.y}, 반지름 ${actor.radius})`);
  }
  const facing = actor.facingX * actor.facingX + actor.facingY * actor.facingY;
  if (!(facing > 0.98 && facing < 1.02)) r.fail(`${p}.facing`, `길이가 1 이 아님 (${facing})`);
  if (actor.moveX * actor.moveX + actor.moveY * actor.moveY > 2.01) r.fail(`${p}.move`, '이동 의도가 너무 큼');
  if (actor.hp > actor.maxHp) r.fail(`${p}.hp`, `최대 체력(${actor.maxHp})보다 큼 (${actor.hp})`);
  if (!actor.dead && actor.hp < 1) r.fail(`${p}.hp`, '살아 있는데 체력이 0');
  if (actor.action && !isKeyOf(def.abilities, actor.action.ability)) r.fail(`${p}.action.ability`, `${actor.type} 에 없는 기술 (${show(actor.action.ability)})`);

  if (isPlayer) {
    if (actor.ai !== null) r.fail(`${p}.ai`, '플레이어에게 AI 상태가 있음');
    return;
  }
  const { ai } = actor;
  if (ai === null) return void r.fail(`${p}.ai`, '없음');
  checkPosition(r, ai.homeX, ai.homeY, `${p}.ai.home`, false);
  const phases = actor.kind === ACTOR_KIND.BOSS ? def.phases.length : 1;
  if (ai.phase >= phases) r.fail(`${p}.ai.phase`, `페이즈 수(${phases})를 벗어남 (${ai.phase})`);
  const { path, idx, goal } = ai.nav;
  if (goal >= r.map.cells) r.fail(`${p}.ai.nav.goal`, `맵 밖의 칸 (${goal})`);
  if (path) {
    if (idx > path.length) r.fail(`${p}.ai.nav.idx`, `경로 길이(${path.length})를 벗어남 (${idx})`);
    for (let i = 0; i < path.length; i++) {
      if (path[i] >= r.map.cells) return void r.fail(`${p}.ai.nav.path[${i}]`, `맵 밖의 칸 (${path[i]})`);
    }
  }
}

// ── 투사체·장판·시야·입력·전리품·상점·제단 ───────────────────────────────────

const faction = among(['player', 'enemy']);
const projectileShape = shape({
  id, ownerId: id, faction, x: coord, y: coord, vx: num(-100, 100), vy: num(-100, 100), radius: num(0.01, 2),
  damage: num(0, L.hp), power: num(0, 10000), status: nullable(statusSpec), expiresAt: timer,
});
const hazardShape = shape({
  id, ownerId: id, faction, x: coord, y: coord, radius: num(0.01, 16), damage: num(0, L.hp), power: num(0, 10000),
  status: nullable(statusSpec), nextAt: timer, interval: int(0, L.timerAhead), endAt: timer,
});
const inputShape = shape({
  moveX: unit, moveY: unit, aimX: num(-L.count, L.count), aimY: num(-L.count, L.count), attack: bool,
  skill: int(-1, PLAYER.skills.length - 1), dodge: bool,
});

const lootShapes = {
  gold: shape({ kind: among(['gold']), amount: int(1, L.gold) }),
  consumable: shape({ kind: among(['consumable']), id: keyOf(CONSUMABLES) }),
  relic: shape({ kind: among(['relic']), id: keyOf(RELICS) }),
  equipment: shape({ kind: among(['equipment']), item: checkItem }),
};
/** 종류(kind·type)에 따라 모양이 달라지는 객체: 그 종류의 검사기를 골라 쓴다. */
const variant = (shapes, field) => (r, v, p) => {
  if (!isObject(v)) return r.fail(p, `객체가 아님 (${show(v)})`);
  if (!isKeyOf(shapes, v[field])) return r.fail(`${p}.${field}`, `알 수 없는 종류 (${show(v[field])})`);
  return shapes[v[field]](r, v, p);
};
const loot = variant(lootShapes, 'kind');
const dropShape = shape({ id, x: coord, y: coord, loot });

const price = int(0, L.gold);
const stockEntry = variant({
  equipment: shape({ kind: among(['equipment']), item: checkItem, price, sold: bool }),
  consumable: shape({ kind: among(['consumable']), id: keyOf(CONSUMABLES), price, sold: bool }),
  relic: shape({ kind: among(['relic']), id: keyOf(RELICS), price, sold: bool }),
}, 'kind');
const shopShape = shape({ floor: int(1, TOTAL_FLOORS), stock: list(stockEntry, 64), x: coord, y: coord });

const amountRule = { base: num(0, L.gold), perFloor: num(0, L.gold) };
const altarCost = variant({
  hpPct: shape({ type: among(['hpPct']), pct: int(1, 100) }),
  gold: shape({ type: among(['gold']), amount: int(0, L.gold) }, amountRule),
  maxHp: shape({ type: among(['maxHp']), amount: int(1, L.hp) }),
  curse: shape({ type: among(['curse']), stats: statRecord }),
}, 'type');
const altarReward = variant({
  stats: shape({ type: among(['stats']), stats: statRecord }),
  gold: shape({ type: among(['gold']), amount: int(0, L.gold) }, amountRule),
  heal: shape({ type: among(['heal']) }),
  upgrade: shape({ type: among(['upgrade']) }),
  relic: shape({ type: among(['relic']) }),
}, 'type');
const altarShape = shape({
  floor: int(1, TOTAL_FLOORS),
  used: bool,
  offers: list(shape({ tier: among(ALTAR.tiers), cost: altarCost, reward: altarReward }), 16),
  x: coord,
  y: coord,
});

/** 층의 진행 중 상태: 맵, 행동체, 투사체, 장판, 시야, 입력, 전리품, 상점, 제단. */
function checkFloor(r, state) {
  checkWorld(r, state);
  if (!r.map) return; // 맵이 없으면 위치를 확인할 수 없다. 어차피 이 층은 다시 만들어야 한다.

  // 일련번호: 행동체·투사체·장판·전리품·장비가 한 번호를 나눠 쓴다. 겹치거나 nextId 이상이면 손상이다.
  const used = new Set();
  const claim = (value, p) => {
    if (!isInt(value, 1, L.id)) return; // 형식 문제는 모양 검사가 이미 적었다.
    if (used.has(value)) r.fail(p, `번호가 겹침 (${value})`);
    used.add(value);
  };
  const claimItem = (item, p) => {
    if (isObject(item)) claim(item.uid, `${p}.uid`);
  };

  const { entities } = state;
  let players = 0;
  if (!isObject(entities) || !isObject(entities.byId) || Object.keys(entities).length !== 2) {
    r.fail('entities', '형식이 맞지 않음');
  } else {
    int(1, L.id)(r, entities.nextId, 'entities.nextId');
    const keys = Object.keys(entities.byId);
    if (keys.length > L.listLength) r.fail('entities.byId', `행동체가 너무 많음 (${keys.length})`);
    else {
      for (const key of keys) {
        const actor = entities.byId[key];
        const p = `entities.byId.${key.slice(0, 16)}`;
        checkActor(r, actor, p);
        if (!isObject(actor)) continue;
        if (String(actor.id) !== key) r.fail(`${p}.id`, `키와 다름 (${show(actor.id)})`);
        claim(actor.id, `${p}.id`);
        if (actor.kind === ACTOR_KIND.PLAYER) players++;
      }
    }
    const player = isInt(state.playerId, 1, L.id) && Object.hasOwn(entities.byId, String(state.playerId)) ? entities.byId[state.playerId] : null;
    if (!isObject(player) || player.kind !== ACTOR_KIND.PLAYER) r.fail('playerId', `플레이어를 가리키지 않음 (${show(state.playerId)})`);
    else if (players !== 1) r.fail('entities.byId', `플레이어가 ${players}명`);
    else if (player.dead && isObject(state.run) && state.run.ended !== true) r.fail('playerId', '플레이어가 죽었는데 런이 끝나지 않음');
  }

  if (passes(r, list(projectileShape, L.listLength), state.projectiles, 'projectiles')) {
    state.projectiles.forEach((pr, i) => {
      checkPosition(r, pr.x, pr.y, `projectiles[${i}]`, false);
      claim(pr.id, `projectiles[${i}].id`);
    });
  }
  if (passes(r, list(hazardShape, L.listLength), state.hazards, 'hazards')) {
    state.hazards.forEach((hz, i) => {
      // 장판은 대상 위치에 오프셋을 더해 깔리므로 맵 밖에 놓일 수 있다(그러면 시야선이 막혀 아무도 맞지 않는다).
      const { w, h } = r.map;
      if (!isNum(hz.x, -HAZARD_MARGIN, w + HAZARD_MARGIN) || !isNum(hz.y, -HAZARD_MARGIN, h + HAZARD_MARGIN)) {
        r.fail(`hazards[${i}]`, `맵에서 너무 먼 위치 (${show(hz.x)}, ${show(hz.y)})`);
      }
      claim(hz.id, `hazards[${i}].id`);
    });
  }

  const { vision } = state;
  if (!isObject(vision) || Object.keys(vision).length !== 4) r.fail('vision', '형식이 맞지 않음');
  else {
    num(0, L.mapSide)(r, vision.radius, 'vision.radius');
    int(-1, r.map.cells - 1)(r, vision.tile, 'vision.tile');
    checkBits(r, vision.visible, 'vision.visible', r.map.cells);
    checkBits(r, vision.explored, 'vision.explored', r.map.cells);
  }

  inputShape(r, state.input, 'input');

  if (passes(r, list(dropShape, L.listLength), state.drops, 'drops')) {
    state.drops.forEach((drop, i) => {
      checkPosition(r, drop.x, drop.y, `drops[${i}]`, false);
      claim(drop.id, `drops[${i}].id`);
      if (drop.loot.kind === 'equipment') claimItem(drop.loot.item, `drops[${i}].loot.item`);
    });
  }
  if (state.shop !== null && passes(r, shopShape, state.shop, 'shop')) {
    // 팔린 품목의 장비는 "판 물건"의 기록이라, 산 사람의 가방에 같은 번호의 사본이 있다. 팔리지 않은 것만 센다.
    state.shop.stock.forEach((entry, i) => {
      if (entry.kind === 'equipment' && !entry.sold) claimItem(entry.item, `shop.stock[${i}].item`);
    });
  }
  if (state.altar !== null) altarShape(r, state.altar, 'altar');

  if (isObject(state.inventory)) {
    if (Array.isArray(state.inventory.bag)) state.inventory.bag.forEach((item, i) => claimItem(item, `inventory.bag[${i}]`));
    if (isObject(state.inventory.equipped)) {
      for (const slot of SLOTS) claimItem(state.inventory.equipped[slot], `inventory.equipped.${slot}`);
    }
  }
  if (isObject(entities) && isInt(entities.nextId, 1, L.id)) {
    for (const value of used) {
      if (value >= entities.nextId) {
        r.fail('entities.nextId', `이미 쓴 번호(${value})보다 작거나 같음 (${entities.nextId})`);
        break;
      }
    }
  }
}

/**
 * 런 상태 전체를 검사한다.
 * @param {*} state 세이브에서 읽은 값(무엇이든 될 수 있다) 또는 실행 중인 상태
 * @returns {string[]} 문제 목록("경로: 설명"). 비어 있으면 그대로 이어서 돌릴 수 있다
 */
export function validateRunState(state) {
  return validate(state, true);
}

/**
 * 런의 핵심부(버전·시드·틱·페이즈·난수·진행도·인벤토리와 최상위 필드)만 검사한다. 층의 진행 중 상태는 보지 않는다.
 * 옛 버전에서 올라온 세이브처럼 "층은 다시 만들어야 하지만 핵심은 온전한" 경우를 가려낼 때 쓴다.
 * @returns {string[]} 문제 목록
 */
export function validateRunCore(state) {
  return validate(state, false);
}

function validate(state, withFloor) {
  const r = createReport();
  if (!isObject(state)) {
    r.fail('state', `객체가 아님 (${show(state)})`);
    return r.problems;
  }
  for (const key of STATE_KEYS) {
    if (!Object.hasOwn(state, key)) r.fail(key, '없음');
  }
  for (const key of Object.keys(state)) {
    if (key !== 'meta' && !STATE_KEYS.includes(key)) r.fail(key, '알 수 없는 필드');
  }
  r.timerMax = (isInt(state.tick, 0, L.tick) ? state.tick : 0) + L.timerAhead;
  r.map = null;
  checkCore(r, state);
  if (withFloor) checkFloor(r, state);
  return r.problems;
}
