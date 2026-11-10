// 맵 검증기. 생성기가 만든 층이 규칙을 모두 지키는지 생성기와 별개의 코드로 다시 확인한다.
// 생성기는 이 검증을 통과한 층만 내보내고, 테스트와 대량 검증 도구도 같은 함수를 쓴다.

import { WORLD } from '../../../data/world.js';
import { EVENT_KINDS } from './event-rooms.js';
import { FLOOR_KIND, floorPlan } from './floors.js';
import { bfsDistances } from './grid.js';
import { TILE } from './tiles.js';

const ALGORITHMS = {
  [FLOOR_KIND.NORMAL]: ['rooms', 'cave', 'fallback'],
  [FLOOR_KIND.MID_BOSS]: ['bossMid'],
  [FLOOR_KIND.FINAL_BOSS]: ['bossFinal'],
};

function isPoint(p) {
  return p !== null && typeof p === 'object' && Number.isInteger(p.x) && Number.isInteger(p.y);
}

/**
 * @param {object} map generateFloor 가 돌려주는 형태의 층
 * @returns {string[]} 위반 목록('코드: 설명'). 비어 있으면 정상.
 */
export function validateFloor(map) {
  const errors = [];
  const fail = (code, detail) => errors.push(detail === undefined ? code : `${code}: ${detail}`);

  if (map === null || typeof map !== 'object') return ['bad-map'];

  let plan;
  try {
    plan = floorPlan(map.floor);
  } catch {
    return [`bad-floor: ${map.floor}`];
  }
  const { zone } = plan;
  const cfg = WORLD.placement;

  // ── 형태 ──
  const { width: w, height: h, tiles } = map;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 3 || h < 3) return [`bad-size: ${w}x${h}`];
  if (!Array.isArray(tiles) || tiles.length !== w * h) return ['bad-tiles-length'];
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] !== TILE.WALL && tiles[i] !== TILE.FLOOR) return [`bad-tile-value: ${tiles[i]} @${i}`];
  }
  if (map.zoneId !== zone.id) fail('wrong-zone', `${map.zoneId} (기대: ${zone.id})`);
  if (map.kind !== plan.kind) fail('wrong-kind', `${map.kind} (기대: ${plan.kind})`);
  if (!ALGORITHMS[plan.kind].includes(map.algorithm)) fail('wrong-algorithm', `${map.algorithm}`);
  if (!Array.isArray(map.spawns) || !Array.isArray(map.eventRooms) || !Array.isArray(map.rooms)) {
    return [...errors, 'bad-lists'];
  }

  const inBounds = (p) => p.x >= 0 && p.y >= 0 && p.x < w && p.y < h;
  const at = (p) => p.y * w + p.x;

  // ── 테두리는 전부 벽 ──
  let openBorder = 0;
  for (let x = 0; x < w; x++) {
    if (tiles[x] !== TILE.WALL) openBorder++;
    if (tiles[(h - 1) * w + x] !== TILE.WALL) openBorder++;
  }
  for (let y = 1; y < h - 1; y++) {
    if (tiles[y * w] !== TILE.WALL) openBorder++;
    if (tiles[y * w + w - 1] !== TILE.WALL) openBorder++;
  }
  if (openBorder > 0) fail('open-border', `${openBorder}칸`);

  // ── 시작점 ──
  if (!isPoint(map.start) || !inBounds(map.start)) return [...errors, 'start-out-of-bounds'];
  if (tiles[at(map.start)] !== TILE.FLOOR) return [...errors, 'start-in-wall'];

  // ── 계단 ──
  const isFinal = plan.kind === FLOOR_KIND.FINAL_BOSS;
  let stairsOk = false;
  if (isFinal) {
    if (map.stairs !== null) fail('final-has-stairs');
  } else if (!isPoint(map.stairs) || !inBounds(map.stairs)) {
    fail('no-stairs');
  } else if (tiles[at(map.stairs)] !== TILE.FLOOR) {
    fail('stairs-in-wall');
  } else if (map.stairs.x === map.start.x && map.stairs.y === map.start.y) {
    fail('stairs-on-start');
  } else {
    stairsOk = true;
  }

  // ── 이벤트방 ──
  const blocked = new Uint8Array(w * h);
  const inEventRoom = new Uint8Array(w * h);
  const occupied = new Uint8Array(w * h);
  occupied[at(map.start)] = 1;
  if (stairsOk) occupied[at(map.stairs)] = 1;

  const eventRooms = [];
  const seenKinds = new Set();
  for (const room of map.eventRooms) {
    const label = `${room?.kind}@${room?.x},${room?.y}`;
    if (!room || !EVENT_KINDS.includes(room.kind)) {
      fail('event-room-bad-kind', label);
      continue;
    }
    if (plan.kind !== FLOOR_KIND.NORMAL) fail('event-room-on-boss-floor', label);
    if (seenKinds.has(room.kind)) fail('event-room-duplicate-kind', label);
    seenKinds.add(room.kind);
    const sizeOk = [room.x, room.y, room.w, room.h].every(Number.isInteger) && room.w >= 3 && room.h >= 3;
    if (!sizeOk || room.x < 1 || room.y < 1 || room.x + room.w > w - 1 || room.y + room.h > h - 1) {
      fail('event-room-out-of-bounds', label);
      continue;
    }
    let walls = 0;
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        if (tiles[y * w + x] !== TILE.FLOOR) walls++;
      }
    }
    if (walls > 0) fail('event-room-not-floor', `${label} 벽 ${walls}칸`);
    const contains = (p) => p.x >= room.x && p.x < room.x + room.w && p.y >= room.y && p.y < room.y + room.h;
    if (contains(map.start)) fail('event-room-on-start', label);
    if (stairsOk && contains(map.stairs)) fail('event-room-on-stairs', label);
    for (const other of eventRooms) {
      const apart = room.x >= other.x + other.w || other.x >= room.x + room.w || room.y >= other.y + other.h || other.y >= room.y + room.h;
      if (!apart) fail('event-rooms-overlap', `${label} / ${other.kind}@${other.x},${other.y}`);
    }
    // 상인/제단은 방 안쪽에 있고 둘레 8칸이 모두 방 안의 바닥이어야 길을 막지 않는다.
    const f = room.feature;
    if (!isPoint(f) || f.x <= room.x || f.x >= room.x + room.w - 1 || f.y <= room.y || f.y >= room.y + room.h - 1) {
      fail('event-feature-misplaced', label);
      continue;
    }
    if (occupied[at(f)]) fail('event-feature-overlap', label);
    occupied[at(f)] = 1;
    blocked[at(f)] = 1;
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) inEventRoom[y * w + x] = 1;
    }
    eventRooms.push(room);
  }

  // ── 도달 가능성: 상인/제단이 놓인 칸은 막힌 것으로 보고 시작점에서 퍼져 나간다 ──
  const dist = bfsDistances(tiles, w, h, at(map.start), blocked);

  if (stairsOk) {
    const d = dist[at(map.stairs)];
    if (d < 0) fail('stairs-unreachable');
    else if (d < cfg.stairsMinStartDist) fail('stairs-too-close', `${d}걸음`);
  }

  // ── 고립 구역: 시작점에서 닿지 못하는 바닥 ──
  let isolated = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === TILE.FLOOR && dist[i] < 0 && !blocked[i]) isolated++;
  }
  if (isolated > 0) fail('isolated-floor', `${isolated}칸`);

  // ── 이벤트방은 시작점에서 떨어져 있어야 한다 ──
  for (const room of eventRooms) {
    let nearest = Infinity;
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        const d = dist[y * w + x];
        if (d >= 0 && d < nearest) nearest = d;
      }
    }
    if (nearest < cfg.eventMinStartDist) fail('event-room-near-start', `${room.kind} ${nearest}걸음`);
  }

  // ── 적·아이템·보스 ──
  const enemyIds = new Set(zone.enemies.map((e) => e.id));
  let enemies = 0;
  let items = 0;
  let bosses = 0;
  for (const spawn of map.spawns) {
    const label = `${spawn?.kind}@${spawn?.x},${spawn?.y}`;
    if (!isPoint(spawn) || !inBounds(spawn)) {
      fail('spawn-out-of-bounds', label);
      continue;
    }
    const i = at(spawn);
    if (tiles[i] !== TILE.FLOOR) {
      fail('spawn-in-wall', label);
      continue;
    }
    if (occupied[i]) fail('spawn-overlap', label);
    occupied[i] = 1;
    if (inEventRoom[i]) fail('spawn-in-event-room', label);
    const d = dist[i];
    if (d < 0) fail('spawn-unreachable', label);
    if (spawn.kind === 'enemy') {
      enemies++;
      if (!enemyIds.has(spawn.id)) fail('unknown-enemy', `${spawn.id}`);
      if (d >= 0 && d < cfg.enemyMinStartDist) fail('enemy-near-start', `${label} ${d}걸음`);
    } else if (spawn.kind === 'boss') {
      bosses++;
      if (spawn.id !== zone.boss?.id) fail('wrong-boss', `${spawn.id}`);
      if (d >= 0 && d < cfg.enemyMinStartDist) fail('boss-near-start', `${label} ${d}걸음`);
    } else if (spawn.kind === 'item') {
      items++;
      if (d >= 0 && d < cfg.itemMinStartDist) fail('item-near-start', `${label} ${d}걸음`);
    } else {
      fail('unknown-spawn-kind', label);
    }
  }

  if (plan.kind === FLOOR_KIND.NORMAL) {
    if (bosses > 0) fail('unexpected-boss');
    if (enemies < zone.enemyCount[0] || enemies > zone.enemyCount[1]) fail('enemy-count', `${enemies}`);
    if (items < zone.itemCount[0] || items > zone.itemCount[1]) fail('item-count', `${items}`);
  } else {
    if (bosses !== 1) fail('boss-count', `${bosses}`);
    if (enemies > 0) fail('enemies-on-boss-floor', `${enemies}`);
  }

  return errors;
}
