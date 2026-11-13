// 런 상태 검증기. 세이브에서 읽은 값이 "그대로 이어서 돌려도 안전한 상태"인지 확인한다.
// 여기를 통과한 상태만 이어하기에 쓰고(logic/save/codec.js), 저장할 때도 통과한 상태만 쓴다.
//
// 기준은 "로직이 이 값을 읽다가 죽거나 NaN 을 퍼뜨리지 않는가"다: 형식(타입·필드), 표에서 찾는 이름, 격자 안의 위치,
// 서로 가리키는 번호. 범위는 SAVE.limits 로 넉넉하게 잡는다 — 밸런스 수치를 조정해도 기존 세이브가 거부되지 않아야 한다.
// (그래서 수치를 고친 세이브, 곧 치트는 걸러내지 않는다.)
// 필드를 추가·삭제하면 STATE_VERSION 을 올리고 이 파일과 migrate.js 를 함께 고친다.

import { CURSE } from '../../../data/meta.js';
import { BOONS } from '../../../data/boons.js';
import { BOSSES } from '../../../data/bosses.js';
import { CHARACTERS } from '../../../data/characters.js';
import { ENEMIES } from '../../../data/enemies.js';
import { SAVE } from '../../../data/save.js';
import { STATUSES } from '../../../data/statuses.js';
import { WEAPONS } from '../../../data/weapons.js';
import { ZONES } from '../../../data/zones.js';
import { PHASE, RNG_STREAMS, STATE_VERSION } from '../core/state.js';
import { ACTOR_KIND, PLAYER_DEF, enemyDef } from '../entities/defs.js';
import { FLOOR_KIND, REWARD, ROOM_KIND, TOTAL_FLOORS } from '../world/floors.js';
import { circleFree } from '../world/collide.js';
import { navOf } from '../world/nav.js';
import { readStructure } from '../world/structure.js';
import { TILE } from '../world/tiles.js';
import {
  among, bool, createReport, int, isInt, isKeyOf, isNum, isObject, keyOf, list, nullable, num, passes, record, shape, show, text,
} from './schema.js';

const L = SAVE.limits;

/** 런 세이브의 최상위 필드. meta 는 따로 저장하므로 없어도 된다. */
export const STATE_KEYS = Object.freeze([
  'version', 'seed', 'tick', 'phase', 'rng', 'run', 'world', 'entities', 'playerId', 'projectiles', 'hazards',
  'encounter', 'input', 'drops', 'shop',
]);

/** 이어할 수 있는 페이즈. 그 밖은 끝난 런이거나(gameOver·victory) 아직 시작하지 않은 상태(title)다. */
export const RESUMABLE_PHASES = Object.freeze([PHASE.PLAYING, PHASE.PAUSED]);

// ── 공통 조각 ────────────────────────────────────────────────────────────────

const id = int(1, L.id);
/** "언제까지"를 뜻하는 틱 번호. 지나간 값은 괜찮지만 터무니없이 먼 미래는 손상으로 본다. */
const timer = (r, v, p) => {
  if (!isInt(v, 0, r.timerMax)) r.fail(p, `타이머 범위(0~${r.timerMax})를 벗어남 (${show(v)})`);
};
const count = int(0, L.count);
const unit = num(-1.001, 1.001);
const coord = num(-L.mapSide, 2 * L.mapSide);
const u32Quad = list(int(0, 0xffffffff), 4, 4);
const rngData = shape({ key: u32Quad, s: u32Quad });
const statusSpec = shape({ id: keyOf(STATUSES) }, { duration: num(0, 3600), chance: num(0, 1), stacks: int(1, 99) });
const boonId = keyOf(BOONS);
const weaponId = keyOf(WEAPONS);

/** 종류(kind)에 따라 모양이 달라지는 객체: 그 종류의 검사기를 골라 쓴다. */
const variant = (shapes, field) => (r, v, p) => {
  if (!isObject(v)) return r.fail(p, `객체가 아님 (${show(v)})`);
  if (!isKeyOf(shapes, v[field])) return r.fail(`${p}.${field}`, `알 수 없는 종류 (${show(v[field])})`);
  return shapes[v[field]](r, v, p);
};

// ── 런 진행 ──────────────────────────────────────────────────────────────────

/** 겹치지 않는 축복 id 목록. */
const boonList = (r, v, p) => {
  if (!passes(r, list(boonId, 256), v, p)) return;
  if (new Set(v).size !== v.length) r.fail(p, '같은 축복이 두 번 들어 있음');
};

export const runFields = Object.freeze({
  floor: int(1, TOTAL_FLOORS),
  character: keyOf(CHARACTERS),
  curse: int(0, CURSE.max),
  gold: int(0, L.gold),
  boons: boonList,
  boonState: shape({ shots: count, iceArmorAt: timer, steamAt: timer, furyUntil: timer, revived: bool }),
  choice: nullable(shape({ kind: among(['boon']), options: list(boonId, 16, 1), rerolls: count })),
  freeRerolls: count,
  depth: int(0, 4096),
  kills: count,
  eliteKills: count,
  bossKills: count,
  roomsCleared: count,
  ended: bool,
});
const runShape = shape(runFields);

/** 런의 핵심부: 버전, 시드, 틱, 페이즈, 난수 스트림, 진행도. */
function checkCore(r, state) {
  if (state.version !== STATE_VERSION) r.fail('version', `현재 버전(${STATE_VERSION})이 아님 (${show(state.version)})`);
  text(L.seedLength, 1)(r, state.seed, 'seed');
  int(0, L.tick)(r, state.tick, 'tick');
  among(Object.values(PHASE))(r, state.phase, 'phase');
  shape(Object.fromEntries(RNG_STREAMS.map((name) => [name, rngData])))(r, state.rng, 'rng');
  runShape(r, state.run, 'run');
}

// ── 맵 ───────────────────────────────────────────────────────────────────────

const side = int(0, L.mapSide);
const cell = shape({ x: side, y: side });
const cellIndex = int(0, L.mapSide * L.mapSide);
const roomShape = shape({
  id: int(0, 1024),
  kind: among(Object.values(ROOM_KIND)),
  x: side, y: side, w: int(1, L.mapSide), h: int(1, L.mapSide),
  shape: among(['rect', 'cave']),
  depth: int(0, 4096),
  reward: nullable(among(Object.values(REWARD))),
  cover: text(32),
  feature: cell,
  doors: list(int(0, 4096), 64),
  waves: list(list(shape({ type: text(64), elite: bool }), 64, 1), 16),
  spawnCells: list(cellIndex, L.listLength),
  state: among(['idle', 'active', 'cleared']),
  wave: int(0, 16),
  seen: bool,
});
const doorShape = shape({
  id: int(0, 4096), room: int(0, 1024), to: int(0, 1024), link: int(0, 4096), cells: list(cellIndex, 8, 1),
  x: coord, y: coord, open: bool, secret: bool,
});
const linkShape = shape({ id: int(0, 4096), rooms: list(int(0, 1024), 2, 2), doors: list(int(0, 4096), 2, 2), secret: bool, seen: bool });
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
  rooms: list(roomShape, 1024, 1),
  doors: list(doorShape, 4096),
  links: list(linkShape, 4096),
  // 생성 통계(디버그용). 로직이 읽지 않으므로 형식만 본다.
  gen: record((key) => key.length <= 32, (r, v, p) => {
    if (typeof v !== 'boolean' && !isNum(v, -L.count, L.count)) r.fail(p, `수나 참/거짓이 아님 (${show(v)})`);
  }, 16),
});

/** 맵을 검사한다. 통과하면 이후 검사가 쓸 격자 정보를 r.map 에 넣는다. */
function checkWorld(r, state) {
  const map = state.world;
  if (map === null) return r.fail('world', '층이 만들어지지 않음');
  if (!passes(r, worldShape, map, 'world')) return undefined;
  const { width: w, height: h, tiles, rooms, doors, links } = map;
  const size = w * h;
  if (tiles.length !== size) return r.fail('world.tiles', `길이 ${size} 의 배열이 아님 (${show(tiles)})`);
  for (let i = 0; i < size; i++) {
    if (tiles[i] !== TILE.WALL && tiles[i] !== TILE.FLOOR && tiles[i] !== TILE.DOOR) return r.fail(`world.tiles[${i}]`, `알 수 없는 타일 (${show(tiles[i])})`);
  }
  // 테두리가 벽이어야 충돌·시야 계산이 격자 밖을 읽지 않는다.
  for (let x = 0; x < w; x++) {
    if (tiles[x] !== TILE.WALL || tiles[(h - 1) * w + x] !== TILE.WALL) return r.fail('world.tiles', '테두리가 벽이 아님');
  }
  for (let y = 0; y < h; y++) {
    if (tiles[y * w] !== TILE.WALL || tiles[y * w + w - 1] !== TILE.WALL) return r.fail('world.tiles', '테두리가 벽이 아님');
  }
  const floorAt = (c) => c.x < w && c.y < h && tiles[c.y * w + c.x] === TILE.FLOOR;
  if (!floorAt(map.start)) return r.fail('world.start', '바닥이 아님');
  if (isObject(state.run) && map.floor !== state.run.floor) r.fail('world.floor', `진행 중인 층(${show(state.run.floor)})과 다름 (${map.floor})`);
  // 층마다 구역이 정해져 있다.
  if (Number.isInteger(map.floor) && map.floor >= 1 && map.floor <= TOTAL_FLOORS && map.zoneId !== ZONES[map.floor - 1].id) r.fail('world.zoneId', `${map.floor}층의 구역(${ZONES[map.floor - 1].id})이 아님 (${show(map.zoneId)})`);

  // 방·문·복도는 서로를 번호로 가리킨다. 번호가 어긋나면 로직이 없는 것을 읽는다.
  let active = 0;
  for (let i = 0; i < rooms.length; i++) {
    const room = rooms[i];
    const p = `world.rooms[${i}]`;
    if (room.id !== i) return r.fail(`${p}.id`, `순번과 다름 (${room.id})`);
    if (room.x + room.w > w || room.y + room.h > h) return r.fail(p, '맵 밖');
    if (!floorAt(room.feature)) r.fail(`${p}.feature`, '바닥이 아님');
    for (const d of room.doors) {
      if (d >= doors.length || doors[d].room !== i) return r.fail(`${p}.doors`, `이 방의 문이 아님 (${d})`);
    }
    for (const wave of room.waves) {
      for (const spawn of wave) if (!enemyDef(spawn.type)) r.fail(`${p}.waves`, `없는 적 (${show(spawn.type)})`);
    }
    if (room.waves.length > 0 && room.wave >= room.waves.length) r.fail(`${p}.wave`, `웨이브 수(${room.waves.length})를 벗어남 (${room.wave})`);
    for (const c of room.spawnCells) {
      if (c >= size || tiles[c] !== TILE.FLOOR) {
        r.fail(`${p}.spawnCells`, `바닥이 아닌 칸 (${c})`);
        break;
      }
    }
    if (room.waves.length > 0 && room.spawnCells.length === 0) r.fail(`${p}.spawnCells`, '적이 나타날 자리가 없음');
    if (room.state === 'active') {
      active++;
      if (room.waves.length === 0) r.fail(`${p}.state`, '웨이브가 없는 방이 전투 중');
    }
  }
  if (active > 1) r.fail('world.rooms', `전투 중인 방이 ${active}개`);
  const closed = new Uint8Array(size);
  for (let i = 0; i < doors.length; i++) {
    const door = doors[i];
    const p = `world.doors[${i}]`;
    if (door.id !== i) return r.fail(`${p}.id`, `순번과 다름 (${door.id})`);
    if (door.room >= rooms.length || door.to >= rooms.length || door.link >= links.length) return r.fail(p, '없는 방·복도를 가리킴');
    if (!rooms[door.room].doors.includes(i)) r.fail(p, '방의 문 목록에 없음');
    if (!links[door.link].doors.includes(i)) r.fail(p, '복도의 문 목록에 없음');
    for (const c of door.cells) {
      if (c >= size) return r.fail(`${p}.cells`, `맵 밖의 칸 (${c})`);
      if (tiles[c] !== (door.open ? TILE.FLOOR : TILE.DOOR)) r.fail(`${p}.cells`, `문의 상태와 타일이 다름 (@${c})`);
      if (!door.open) closed[c] = 1;
    }
  }
  for (let i = 0; i < size; i++) {
    if (tiles[i] === TILE.DOOR && !closed[i]) return r.fail(`world.tiles[${i}]`, '어느 문에도 속하지 않는 닫힌 문');
  }
  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    const p = `world.links[${i}]`;
    if (link.id !== i) return r.fail(`${p}.id`, `순번과 다름 (${link.id})`);
    if (link.rooms[0] >= rooms.length || link.rooms[1] >= rooms.length) return r.fail(`${p}.rooms`, '없는 방을 가리킴');
    if (link.doors[0] >= doors.length || link.doors[1] >= doors.length) return r.fail(`${p}.doors`, '없는 문을 가리킴');
  }
  // 타일에서 다시 읽은 구조(칸 → 방·복도)가 목록과 같아야 한다. 로직은 플레이어가 선 칸의 구역 번호로 방과 복도를 찾는다.
  const structure = readStructure(tiles, w, h, rooms);
  if (structure.links.length !== links.length) return r.fail('world.links', `타일에서 읽은 복도 수(${structure.links.length})와 다름 (${links.length})`);
  for (let i = 0; i < links.length; i++) {
    const found = structure.links[i].rooms;
    if (found.length !== 2 || found[0] !== links[i].rooms[0] || found[1] !== links[i].rooms[1]) return r.fail(`world.links[${i}].rooms`, '타일에서 읽은 것과 다름');
  }
  r.map = { w, h, tiles, cells: size, nav: navOf(map) };
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
  knockback: num(0, 1000),
  status: nullable(statusSpec),
  hit: list(id, L.listLength),
  stopOnWall: bool,
  stunOnWall: num(0, 3600),
  done: bool,
  wall: bool,
}, { proc: bool });
const sign = among([-1, 1]);
const aiShape = shape({
  mode: among(['idle', 'combat']),
  provoked: bool,
  lastSeenAt: timer,
  chaseUntil: timer,
  nav: shape({
    path: nullable(list(cellIndex, L.listLength)),
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
const kitShape = shape({
  character: keyOf(CHARACTERS),
  forms: list(nullable(keyOf(CHARACTERS)), 2, 2),
  hpDebt: int(0, L.hp),
  energyDebt: num(0, L.count),
  energy: num(0, L.count),
  maxEnergy: num(0, L.count),
  charges: int(0, 16),
  maxCharges: int(1, 16),
  chargeAt: timer,
  rechargeTicks: int(1, L.timerAhead),
  weapons: list(nullable(weaponId), 2, 2),
  slot: among([0, 1]),
  buffer: nullable(shape({ kind: among(['dash', 'skill', 'skill2']), until: timer })),
  dashing: bool,
  dashAttackUntil: timer,
  critUntil: timer,
  dualUntil: timer,
  emptyAt: timer,
  trailAt: timer,
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
  kbX: num(-1000, 1000),
  kbY: num(-1000, 1000),
  elite: bool,
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
  diedWith: list(keyOf(STATUSES), 16),
  reaped: bool,
  killerId: nullable(id),
  summonerId: nullable(id),
  ai: nullable(aiShape),
}, { kit: kitShape });

function checkActor(r, actor, p, state) {
  if (!passes(r, actorShape, actor, p)) return;
  // 종류와 정의.
  let def = null;
  if (actor.kind === ACTOR_KIND.PLAYER) def = actor.type === 'player' ? PLAYER_DEF : null;
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
    const { kit } = actor;
    if (!kit) return void r.fail(`${p}.kit`, '없음');
    if (kit.weapons[kit.slot] === null) r.fail(`${p}.kit.slot`, '든 칸에 무기가 없음');
    if (kit.charges > kit.maxCharges) r.fail(`${p}.kit.charges`, `최대치(${kit.maxCharges})보다 큼 (${kit.charges})`);
    if (kit.energy > kit.maxEnergy) r.fail(`${p}.kit.energy`, `최대치(${kit.maxEnergy})보다 큼 (${kit.energy})`);
    // 쓰고 있는 탈 = 든 칸에 딸린 탈(그 칸이 비어 있으면 다른 칸의 탈). 같은 탈을 두 칸에 들 수 없다.
    const worn = kit.forms[kit.slot] ?? kit.forms[1 - kit.slot];
    if (kit.character !== worn) r.fail(`${p}.kit.character`, `든 칸의 탈(${show(worn)})과 다름`);
    if (kit.forms[0] !== null && kit.forms[0] === kit.forms[1]) r.fail(`${p}.kit.forms`, '같은 탈이 두 칸에 있음');
    return;
  }
  if (actor.kit !== undefined) r.fail(`${p}.kit`, '적에게 플레이어의 장비가 있음');
  const { ai } = actor;
  if (ai === null) return void r.fail(`${p}.ai`, '없음');
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

// ── 투사체·장판·전투·입력·전리품·상점 ────────────────────────────────────────

const faction = among(['player', 'enemy']);
const projectileShape = shape({
  id, ownerId: id, faction, x: coord, y: coord, vx: num(-100, 100), vy: num(-100, 100), radius: num(0.01, 2),
  damage: num(0, L.hp), power: num(0, 10000), knockback: num(0, 1000), status: nullable(statusSpec), left: num(-1000, 1000),
  pierce: int(0, 64), hit: list(id, L.listLength),
  explode: nullable(shape({ radius: num(0.01, 16), damage: num(0, L.hp), knockback: num(0, 1000), status: nullable(statusSpec) })),
  bounces: int(0, 16), split: bool, proc: bool,
});
const hazardShape = shape({
  id, kind: among(['blast', 'warp']), ownerId: id, faction, x: coord, y: coord, radius: num(0.01, 16), damage: num(0, L.hp), power: num(0, 10000),
  status: nullable(statusSpec), nextAt: timer, interval: int(0, L.timerAhead), endAt: timer, slow: num(0, 1), proc: bool,
});
const encounterShape = shape({
  room: int(0, 1024),
  pending: list(shape({ type: text(64), elite: bool, x: coord, y: coord, at: timer }), 256),
  nextWaveAt: timer,
});
const inputShape = shape({
  moveX: unit, moveY: unit, aimX: num(-L.count, L.count), aimY: num(-L.count, L.count), attack: bool, dash: bool, skill: bool, skill2: bool,
});

const place = { id, x: coord, y: coord };
const dropShape = variant({
  gold: shape({ ...place, kind: among(['gold']), amount: int(0, L.gold) }),
  energy: shape({ ...place, kind: among(['energy']), amount: int(0, L.count) }),
  health: shape({ ...place, kind: among(['health']), amount: int(0, L.hp) }),
  weapon: shape({ ...place, kind: among(['weapon']), weapon: weaponId }),
  form: shape({ ...place, kind: among(['form']), form: keyOf(CHARACTERS) }),
  boon: shape({ ...place, kind: among(['boon']) }),
}, 'kind');

const price = int(0, L.gold);
const stockEntry = variant({
  weapon: shape({ kind: among(['weapon']), weapon: weaponId, price, sold: bool }),
  boon: shape({ kind: among(['boon']), boon: boonId, price, sold: bool }),
  heal: shape({ kind: among(['heal']), price, sold: bool }),
}, 'kind');
const shopShape = shape({ stock: list(stockEntry, 64), rerolls: count, heals: count });

/** 층의 진행 중 상태: 맵, 행동체, 투사체, 장판, 방 전투, 입력, 전리품, 상점. */
function checkFloor(r, state) {
  checkWorld(r, state);
  if (!r.map) return; // 맵이 없으면 위치를 확인할 수 없다. 어차피 이 층은 다시 만들어야 한다.

  // 일련번호: 행동체·투사체·장판·전리품이 한 번호를 나눠 쓴다. 겹치거나 nextId 이상이면 손상이다.
  const used = new Set();
  const claim = (value, p) => {
    if (!isInt(value, 1, L.id)) return; // 형식 문제는 모양 검사가 이미 적었다.
    if (used.has(value)) r.fail(p, `번호가 겹침 (${value})`);
    used.add(value);
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
        checkActor(r, actor, p, state);
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

  // 방 전투: 전투 중인 방이 있으면 그 방을 가리켜야 하고, 없으면 없어야 한다.
  const rooms = state.world.rooms;
  const activeRoom = rooms.find((room) => room.state === 'active') ?? null;
  if (state.encounter === null) {
    if (activeRoom) r.fail('encounter', `방 ${activeRoom.id} 이 전투 중인데 전투 정보가 없음`);
  } else if (passes(r, encounterShape, state.encounter, 'encounter')) {
    const enc = state.encounter;
    if (!activeRoom || activeRoom.id !== enc.room) r.fail('encounter.room', `전투 중인 방이 아님 (${enc.room})`);
    enc.pending.forEach((spawn, i) => {
      if (!enemyDef(spawn.type)) r.fail(`encounter.pending[${i}].type`, `없는 적 (${show(spawn.type)})`);
      checkPosition(r, spawn.x, spawn.y, `encounter.pending[${i}]`, true);
    });
  }

  inputShape(r, state.input, 'input');

  if (passes(r, list(dropShape, L.listLength), state.drops, 'drops')) {
    state.drops.forEach((drop, i) => {
      checkPosition(r, drop.x, drop.y, `drops[${i}]`, false);
      claim(drop.id, `drops[${i}].id`);
    });
  }
  if (state.shop !== null) shopShape(r, state.shop, 'shop');

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
 * 런의 핵심부(버전·시드·틱·페이즈·난수·진행도와 최상위 필드)만 검사한다. 층의 진행 중 상태는 보지 않는다.
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
