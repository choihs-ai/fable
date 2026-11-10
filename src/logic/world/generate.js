// 층 생성 진입점. 같은 (런 시드, 층 번호)는 언제 어디서 호출해도 같은 층을 만든다.
//
// 난수 흐름: 런 시드 → fork('world') → fork(`floor:${n}`) → fork('algorithm') / fork(`attempt:${k}`) / fork('fallback')
//           시도 하나 안에서는 → fork('layout') / fork('events') / fork('place')
// fork 는 부모를 소비하지 않으므로 층을 어떤 순서로 몇 번 만들든 결과가 같고,
// 배치 수치를 바꿔도 지형(layout)은 바뀌지 않는다.

import { WORLD } from '../../../data/world.js';
import { Rng } from '../core/prng.js';
import { connectRegions } from './connect.js';
import { EVENT_KINDS, pickEventRoom, stampEventRoom } from './event-rooms.js';
import { FLOOR_KIND, floorPlan } from './floors.js';
import { buildBossLayout } from './gen-boss.js';
import { generateCave } from './gen-cave.js';
import { generateRooms } from './gen-rooms.js';
import { bfsDistances, fillRect } from './grid.js';
import { placeSpawns } from './place.js';
import { TILE } from './tiles.js';
import { validateFloor } from './validate.js';

const reject = (reason) => ({ rejected: reason });

function finishMap(plan, algorithm, width, height, tiles, parts) {
  return {
    floor: plan.floor,
    zoneId: plan.zone.id,
    kind: plan.kind,
    algorithm,
    width,
    height,
    tiles: Array.from(tiles),
    start: parts.start,
    stairs: parts.stairs,
    rooms: parts.rooms,
    eventRooms: parts.eventRooms,
    spawns: parts.spawns,
    // 생성 과정 기록: 시도 횟수, 비상 레이아웃 여부, 연결 보정으로 판 굴·메운 구역 수.
    gen: { attempts: 0, fallback: false, tunnels: parts.tunnels ?? 0, filled: parts.filled ?? 0 },
  };
}

/** 이벤트방의 상인/제단 칸과 방 내부를 표시한 마스크를 만든다. */
function eventMasks(eventRooms, w, h) {
  const blocked = new Uint8Array(w * h);
  const inside = new Uint8Array(w * h);
  for (const room of eventRooms) {
    blocked[room.feature.y * w + room.feature.x] = 1;
    fillRect(inside, w, room.x, room.y, room.w, room.h, 1);
  }
  return { blocked, inside };
}

/** 시작점·계단·이벤트방이 정해진 뒤의 공통 마무리: 적·아이템을 놓고 맵 객체를 만든다. */
function populate(rng, plan, algorithm, w, h, tiles, rooms, start, stairs, eventRooms, repair = null) {
  const { blocked, inside } = eventMasks(eventRooms, w, h);
  const dist = bfsDistances(tiles, w, h, start.y * w + start.x, blocked);
  const occupied = blocked.slice();
  occupied[start.y * w + start.x] = 1;
  occupied[stairs.y * w + stairs.x] = 1;
  const spawns = placeSpawns(rng.fork('place'), {
    tiles, w, dist, occupied, forbidden: inside, zone: plan.zone, cfg: WORLD.placement,
  });
  return finishMap(plan, algorithm, w, h, tiles, { start, stairs, rooms, eventRooms, spawns, ...repair });
}

function buildRoomsFloor(rng, plan) {
  const { w, h } = plan.zone.size;
  const cfg = WORLD.placement;
  const { tiles, rooms } = generateRooms(rng.fork('layout'), w, h, WORLD.rooms);
  if (rooms.length < 2) return reject('too-few-rooms');

  const eventRng = rng.fork('events');
  const center = (room) => ({ x: room.x + Math.floor(room.w / 2), y: room.y + Math.floor(room.h / 2) });
  const startRoom = eventRng.pick(rooms);
  const start = center(startRoom);
  const dist = bfsDistances(tiles, w, h, start.y * w + start.x);

  // 계단: 시작 방에서 충분히 먼 방들 가운데 하나.
  let farthest = 0;
  const roomDist = new Map();
  for (const room of rooms) {
    const c = center(room);
    const d = dist[c.y * w + c.x];
    roomDist.set(room, d);
    if (room !== startRoom && d > farthest) farthest = d;
  }
  const minStairs = Math.max(cfg.stairsMinStartDist, Math.ceil(farthest * cfg.stairsFarRatio));
  const stairsRooms = rooms.filter((room) => room !== startRoom && roomDist.get(room) >= minStairs);
  if (stairsRooms.length === 0) return reject('no-stairs-room');
  const stairsRoom = eventRng.pick(stairsRooms);
  const stairs = center(stairsRoom);

  // 이벤트방: 시작 방·계단 방이 아닌 방 가운데 조건에 맞는 것.
  const excluded = new Set([startRoom, stairsRoom]);
  const eventRooms = [];
  const eventCfg = { minSize: WORLD.eventRoomSize, minStartDist: cfg.eventMinStartDist };
  for (const kind of EVENT_KINDS) {
    if (!eventRng.chance(WORLD.events[kind])) continue;
    const room = pickEventRoom(eventRng, kind, rooms, excluded, dist, w, eventCfg);
    if (room) eventRooms.push(room);
  }

  return populate(rng, plan, 'rooms', w, h, tiles, rooms, start, stairs, eventRooms);
}

function buildCaveFloor(rng, plan) {
  const { w, h } = plan.zone.size;
  const cfg = WORLD.placement;
  const { tiles } = generateCave(rng.fork('layout'), w, h, WORLD.cave);
  const firstRepair = connectRegions(tiles, w, h, { anchor: -1, keep: null, minRegionSize: WORLD.cave.minRegionSize });

  const eventRng = rng.fork('events');

  // 시작점: 둘레 8칸이 모두 바닥인 칸 가운데 하나.
  const open = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const sum =
        tiles[i - w - 1] + tiles[i - w] + tiles[i - w + 1] +
        tiles[i - 1] + tiles[i] + tiles[i + 1] +
        tiles[i + w - 1] + tiles[i + w] + tiles[i + w + 1];
      if (sum === 9 * TILE.FLOOR) open.push(i);
    }
  }
  if (open.length === 0) return reject('no-open-start');
  const startCell = eventRng.pick(open);
  const start = { x: startCell % w, y: Math.floor(startCell / w) };

  // 이벤트방을 찍고, 그 때문에 끊긴 곳을 다시 잇는다.
  const eventRooms = [];
  const stampCfg = { size: WORLD.eventRoomSize, minStartDist: cfg.eventMinStartDist, candidates: WORLD.cave.eventCandidates };
  for (const kind of EVENT_KINDS) {
    if (!eventRng.chance(WORLD.events[kind])) continue;
    const room = stampEventRoom(eventRng, kind, tiles, w, h, start, eventRooms, stampCfg);
    if (room) eventRooms.push(room);
  }
  const { blocked, inside } = eventMasks(eventRooms, w, h);
  const secondRepair = connectRegions(tiles, w, h, { anchor: startCell, keep: inside, minRegionSize: WORLD.cave.minRegionSize });
  const repair = {
    tunnels: firstRepair.tunnels + secondRepair.tunnels,
    filled: firstRepair.filled + secondRepair.filled,
  };

  let floorCount = 0;
  for (let i = 0; i < tiles.length; i++) floorCount += tiles[i];
  if (floorCount / (w * h) < WORLD.cave.minOpenRatio) return reject('too-cramped');

  // 계단: 시작점에서 충분히 먼 칸 가운데 하나(이벤트방 안은 제외).
  const dist = bfsDistances(tiles, w, h, startCell, blocked);
  let farthest = 0;
  for (let i = 0; i < dist.length; i++) if (!inside[i] && dist[i] > farthest) farthest = dist[i];
  const minStairs = Math.max(cfg.stairsMinStartDist, Math.ceil(farthest * cfg.stairsFarRatio));
  const far = [];
  for (let i = 0; i < dist.length; i++) if (!inside[i] && dist[i] >= minStairs) far.push(i);
  if (far.length === 0) return reject('no-stairs-cell');
  const stairsCell = eventRng.pick(far);
  const stairs = { x: stairsCell % w, y: Math.floor(stairsCell / w) };

  return populate(rng, plan, 'cave', w, h, tiles, [], start, stairs, eventRooms, repair);
}

function buildBossFloor(rng, plan, plain) {
  const isFinal = plan.kind === FLOOR_KIND.FINAL_BOSS;
  const layout = buildBossLayout(rng.fork('layout'), isFinal ? WORLD.boss.final : WORLD.boss.mid, { plain });
  const spawns = [{ kind: 'boss', id: plan.zone.boss.id, x: layout.boss.x, y: layout.boss.y }];
  if (layout.reward) spawns.push({ kind: 'item', x: layout.reward.x, y: layout.reward.y });
  return finishMap(plan, isFinal ? 'bossFinal' : 'bossMid', layout.width, layout.height, layout.tiles, {
    start: layout.start,
    stairs: layout.stairs,
    rooms: layout.rooms,
    eventRooms: [],
    spawns,
  });
}

/** 비상 레이아웃: 큰 방 하나. 재시도 상한을 넘겼을 때만 쓴다. */
function buildFallbackFloor(rng, plan) {
  if (plan.kind !== FLOOR_KIND.NORMAL) return buildBossFloor(rng, plan, true);
  const { w, h } = plan.zone.size;
  const tiles = new Uint8Array(w * h);
  const room = { x: 3, y: 3, w: w - 6, h: h - 6 };
  fillRect(tiles, w, room.x, room.y, room.w, room.h, TILE.FLOOR);
  const start = { x: room.x + 2, y: room.y + room.h - 3 };
  const stairs = { x: room.x + room.w - 3, y: room.y + 2 };
  return populate(rng, plan, 'fallback', w, h, tiles, [room], start, stairs, []);
}

function buildAttempt(rng, plan, algorithm) {
  if (plan.kind !== FLOOR_KIND.NORMAL) return buildBossFloor(rng, plan, false);
  return algorithm === 'cave' ? buildCaveFloor(rng, plan) : buildRoomsFloor(rng, plan);
}

function pickAlgorithm(rng, zone) {
  const names = Object.keys(zone.algorithms);
  return names[rng.weightedIndex(names.map((name) => zone.algorithms[name]))];
}

/**
 * world 스트림에서 층 하나를 만든다. worldRng 는 소비하지 않는다.
 * @param {Rng} worldRng 런 시드의 'world' 서브스트림(rngOf(state, 'world'))
 * @param {number} floor
 * @param {object} [hooks] 테스트·검증용
 * @param {Function} [hooks.build] (rng, plan, algorithm) => 맵 또는 { rejected } — 시도 한 번을 대신한다
 * @param {Function} [hooks.onReject] (attempt, reasons: string[]) => void — 시도가 버려질 때마다 호출
 */
export function generateFloorFromRng(worldRng, floor, hooks = {}) {
  const plan = floorPlan(floor);
  const floorRng = worldRng.fork(`floor:${floor}`);
  const algorithm = plan.kind === FLOOR_KIND.NORMAL ? pickAlgorithm(floorRng.fork('algorithm'), plan.zone) : plan.kind;
  const build = hooks.build ?? buildAttempt;

  for (let attempt = 1; attempt <= WORLD.maxAttempts; attempt++) {
    const map = build(floorRng.fork(`attempt:${attempt}`), plan, algorithm);
    const reasons = map.rejected ? [map.rejected] : validateFloor(map);
    if (reasons.length === 0) {
      map.gen.attempts = attempt;
      return map;
    }
    if (hooks.onReject) hooks.onReject(attempt, reasons);
  }

  // 재시도 상한을 넘겼다. 반드시 통과하는 단순한 레이아웃으로 대체한다.
  const map = buildFallbackFloor(floorRng.fork('fallback'), plan);
  const errors = validateFloor(map);
  if (errors.length > 0) {
    throw new Error(`generateFloor: ${floor}층 비상 레이아웃이 검증에 실패했습니다: ${errors.join('; ')}`);
  }
  map.gen.attempts = WORLD.maxAttempts;
  map.gen.fallback = true;
  return map;
}

/**
 * (런 시드, 층 번호)로 층을 만든다.
 * @param {{ seed: string|number, floor: number }} options
 */
export function generateFloor({ seed, floor }) {
  return generateFloorFromRng(Rng.fromSeed(seed).fork('world'), floor);
}
