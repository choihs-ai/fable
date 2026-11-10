// 검증기가 각 위반을 실제로 잡아내는지 확인한다. 정상 층을 하나 만든 뒤 한 군데씩 망가뜨려 본다.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { WORLD } from '../../../data/world.js';
import { toAscii } from '../../../src/logic/world/ascii.js';
import { TOTAL_FLOORS } from '../../../src/logic/world/floors.js';
import { generateFloor } from '../../../src/logic/world/generate.js';
import { bfsDistances } from '../../../src/logic/world/grid.js';
import { validateFloor } from '../../../src/logic/world/validate.js';

/** 조건에 맞는 층을 정해진 순서로 찾는다(항상 같은 층이 나온다). */
function findFloor(predicate, floors) {
  for (let n = 0; n < 300; n++) {
    for (const floor of floors) {
      const map = generateFloor({ seed: `fx-${n}`, floor });
      if (predicate(map)) return map;
    }
  }
  throw new Error('조건에 맞는 층을 찾지 못함');
}

const NORMAL_FLOORS = [1, 2, 3, 4, 6, 7, 8, 9];
const roomsMap = findFloor((m) => m.algorithm === 'rooms' && m.eventRooms.length === 2, NORMAL_FLOORS);
const caveMap = findFloor((m) => m.algorithm === 'cave' && m.eventRooms.length === 2, NORMAL_FLOORS);
const midMap = generateFloor({ seed: 'fx-0', floor: 5 });
const finalMap = generateFloor({ seed: 'fx-0', floor: TOTAL_FLOORS });

const clone = (map) => structuredClone(map);
const at = (map, p) => p.y * map.width + p.x;
const codes = (map) => validateFloor(map).map((e) => e.split(':')[0]);

/** 망가뜨린 뒤 기대한 위반 코드가 나오는지 확인한다. */
function expectViolation(base, code, mutate) {
  const map = clone(base);
  mutate(map);
  const found = codes(map);
  assert.ok(found.includes(code), `기대: ${code}, 실제: [${found.join(', ')}]\n${toAscii(map)}`);
}

/** 시작점에서 d 걸음 이내이고 비어 있는 바닥 칸 하나. */
function cellNearStart(map, maxDist) {
  const dist = bfsDistances(map.tiles, map.width, map.height, at(map, map.start));
  const taken = new Set([at(map, map.start), ...map.spawns.map((s) => at(map, s))]);
  for (let i = 0; i < dist.length; i++) {
    if (dist[i] > 0 && dist[i] <= maxDist && !taken.has(i)) return { x: i % map.width, y: Math.floor(i / map.width) };
  }
  throw new Error('시작점 근처에 빈 칸이 없음');
}

test('기준이 되는 층들은 검증을 통과한다', () => {
  for (const map of [roomsMap, caveMap, midMap, finalMap]) assert.deepEqual(validateFloor(map), [], toAscii(map));
});

test('형태가 잘못된 입력', () => {
  assert.deepEqual(validateFloor(null), ['bad-map']);
  assert.deepEqual(codes({ ...clone(roomsMap), floor: 0 }), ['bad-floor']);
  assert.deepEqual(codes({ ...clone(roomsMap), width: 2 }), ['bad-size']);
  assert.deepEqual(codes({ ...clone(roomsMap), tiles: [0, 1] }), ['bad-tiles-length']);
  expectViolation(roomsMap, 'bad-tile-value', (m) => { m.tiles[at(m, m.start)] = 7; });
  expectViolation(roomsMap, 'bad-lists', (m) => { m.spawns = null; });
});

test('구역·종류·알고리즘이 층 번호와 맞지 않으면 잡는다', () => {
  expectViolation(roomsMap, 'wrong-zone', (m) => { m.zoneId = 'citadel'; });
  expectViolation(roomsMap, 'wrong-kind', (m) => { m.kind = 'midBoss'; });
  expectViolation(roomsMap, 'wrong-algorithm', (m) => { m.algorithm = 'bossMid'; });
  expectViolation(midMap, 'wrong-algorithm', (m) => { m.algorithm = 'rooms'; });
});

test('테두리가 뚫리면 잡는다', () => {
  expectViolation(roomsMap, 'open-border', (m) => { m.tiles[3] = 1; });
  expectViolation(roomsMap, 'open-border', (m) => { m.tiles[5 * m.width + m.width - 1] = 1; });
});

test('시작점이 벽 안이거나 맵 밖이면 잡는다', () => {
  expectViolation(roomsMap, 'start-in-wall', (m) => { m.start = { x: 0, y: 0 }; });
  expectViolation(roomsMap, 'start-out-of-bounds', (m) => { m.start = { x: -1, y: 3 }; });
  expectViolation(roomsMap, 'start-out-of-bounds', (m) => { m.start = null; });
});

test('계단: 없음·벽 안·시작점과 같은 칸·너무 가까움·닿지 못함', () => {
  expectViolation(roomsMap, 'no-stairs', (m) => { m.stairs = null; });
  expectViolation(roomsMap, 'stairs-in-wall', (m) => { m.stairs = { x: 0, y: 0 }; });
  expectViolation(roomsMap, 'stairs-on-start', (m) => { m.stairs = { ...m.start }; });
  expectViolation(roomsMap, 'stairs-too-close', (m) => { m.stairs = cellNearStart(m, 3); });
  expectViolation(roomsMap, 'stairs-unreachable', (m) => {
    // 계단 둘레를 벽으로 막는다.
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) m.tiles[(m.stairs.y + dy) * m.width + m.stairs.x + dx] = 0;
  });
  expectViolation(finalMap, 'final-has-stairs', (m) => { m.stairs = { x: m.start.x, y: m.start.y - 1 }; });
});

test('고립 구역: 시작점에서 닿지 못하는 바닥이 있으면 잡는다', () => {
  for (const base of [roomsMap, caveMap]) {
    expectViolation(base, 'isolated-floor', (m) => {
      // 벽 한가운데에 바닥 한 칸을 뚫는다(둘레 8칸이 모두 벽인 곳).
      for (let y = 2; y < m.height - 2; y++) {
        for (let x = 2; x < m.width - 2; x++) {
          let walls = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) walls += m.tiles[(y + dy) * m.width + x + dx] === 0 ? 1 : 0;
          if (walls === 9) {
            m.tiles[y * m.width + x] = 1;
            return;
          }
        }
      }
      throw new Error('벽 덩어리를 찾지 못함');
    });
  }
});

test('적·아이템: 벽 안·맵 밖·겹침·시작점 근처·이벤트방 안·알 수 없는 종류', () => {
  for (const base of [roomsMap, caveMap]) {
    const enemy = base.spawns.findIndex((s) => s.kind === 'enemy');
    const item = base.spawns.findIndex((s) => s.kind === 'item');
    expectViolation(base, 'spawn-in-wall', (m) => { Object.assign(m.spawns[enemy], { x: 0, y: 0 }); });
    expectViolation(base, 'spawn-out-of-bounds', (m) => { Object.assign(m.spawns[enemy], { x: m.width, y: 1 }); });
    expectViolation(base, 'spawn-overlap', (m) => { Object.assign(m.spawns[item], { x: m.spawns[enemy].x, y: m.spawns[enemy].y }); });
    expectViolation(base, 'spawn-overlap', (m) => { Object.assign(m.spawns[enemy], m.start); });
    expectViolation(base, 'spawn-overlap', (m) => { Object.assign(m.spawns[item], m.stairs); });
    expectViolation(base, 'spawn-overlap', (m) => { Object.assign(m.spawns[item], m.eventRooms[0].feature); });
    expectViolation(base, 'enemy-near-start', (m) => { Object.assign(m.spawns[enemy], cellNearStart(m, WORLD.placement.enemyMinStartDist - 1)); });
    expectViolation(base, 'item-near-start', (m) => { Object.assign(m.spawns[item], cellNearStart(m, WORLD.placement.itemMinStartDist - 1)); });
    expectViolation(base, 'spawn-in-event-room', (m) => { Object.assign(m.spawns[enemy], { x: m.eventRooms[0].x, y: m.eventRooms[0].y }); });
    expectViolation(base, 'unknown-enemy', (m) => { m.spawns[enemy].id = 'abyss_lord'; });
    expectViolation(base, 'unknown-spawn-kind', (m) => { m.spawns[enemy].kind = 'trap'; });
  }
});

test('적·아이템 수가 구역 설정 범위를 벗어나면 잡는다', () => {
  expectViolation(roomsMap, 'enemy-count', (m) => { m.spawns = m.spawns.filter((s) => s.kind !== 'enemy'); });
  expectViolation(roomsMap, 'item-count', (m) => { m.spawns = m.spawns.filter((s) => s.kind !== 'item'); });
  expectViolation(roomsMap, 'unexpected-boss', (m) => { m.spawns[0].kind = 'boss'; });
});

test('닿지 못하는 곳에 놓인 적을 잡는다', () => {
  expectViolation(roomsMap, 'spawn-unreachable', (m) => {
    const s = m.spawns.find((sp) => sp.kind === 'enemy');
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) m.tiles[(s.y + dy) * m.width + s.x + dx] = 0;
  });
});

test('이벤트방: 종류·범위·벽·시작점/계단 포함·겹침·시작점 근처·상인 위치', () => {
  for (const base of [roomsMap, caveMap]) {
    expectViolation(base, 'event-room-bad-kind', (m) => { m.eventRooms[0].kind = 'casino'; });
    expectViolation(base, 'event-room-duplicate-kind', (m) => { m.eventRooms[1].kind = m.eventRooms[0].kind; });
    expectViolation(base, 'event-room-out-of-bounds', (m) => { m.eventRooms[0].x = 0; });
    expectViolation(base, 'event-room-out-of-bounds', (m) => { m.eventRooms[0].w = m.width; });
    expectViolation(base, 'event-room-not-floor', (m) => { m.tiles[m.eventRooms[0].y * m.width + m.eventRooms[0].x] = 0; });
    expectViolation(base, 'event-rooms-overlap', (m) => { Object.assign(m.eventRooms[1], { x: m.eventRooms[0].x + 1, y: m.eventRooms[0].y + 1 }); });
    expectViolation(base, 'event-feature-misplaced', (m) => { m.eventRooms[0].feature = { x: m.eventRooms[0].x, y: m.eventRooms[0].y }; });
    expectViolation(base, 'event-feature-misplaced', (m) => { m.eventRooms[0].feature = null; });
    expectViolation(base, 'event-room-on-stairs', (m) => { m.stairs = { x: m.eventRooms[0].x, y: m.eventRooms[0].y }; });
    expectViolation(base, 'event-room-on-start', (m) => { m.start = { x: m.eventRooms[0].x, y: m.eventRooms[0].y }; });
    expectViolation(base, 'event-room-near-start', (m) => {
      // 시작점을 이벤트방 바로 바깥(문 앞)으로 옮긴다.
      const room = m.eventRooms[0];
      const dist = bfsDistances(m.tiles, m.width, m.height, at(m, { x: room.x, y: room.y }));
      for (let i = 0; i < dist.length; i++) {
        const x = i % m.width;
        const y = Math.floor(i / m.width);
        const inside = x >= room.x && x < room.x + room.w && y >= room.y && y < room.y + room.h;
        if (!inside && dist[i] > 0 && dist[i] <= 3) {
          m.start = { x, y };
          return;
        }
      }
      throw new Error('이벤트방 근처 칸을 찾지 못함');
    });
  }
  expectViolation(midMap, 'event-room-on-boss-floor', (m) => { m.eventRooms.push(clone(roomsMap.eventRooms[0])); });
});

test('보스층: 보스 수·보스 종류·일반 적·보스 위치', () => {
  for (const base of [midMap, finalMap]) {
    expectViolation(base, 'boss-count', (m) => { m.spawns = m.spawns.filter((s) => s.kind !== 'boss'); });
    expectViolation(base, 'boss-count', (m) => { m.spawns.push({ ...m.spawns[0], x: m.spawns[0].x + 1 }); });
    expectViolation(base, 'wrong-boss', (m) => { m.spawns[0].id = 'skeleton'; });
    expectViolation(base, 'enemies-on-boss-floor', (m) => { m.spawns.push({ kind: 'enemy', id: 'skeleton', x: m.spawns[0].x + 1, y: m.spawns[0].y }); });
    expectViolation(base, 'boss-near-start', (m) => { Object.assign(m.spawns[0], { x: m.start.x, y: m.start.y - 1 }); });
  }
});

test('위반이 여러 개면 모두 보고한다', () => {
  const map = clone(roomsMap);
  map.zoneId = 'citadel';
  map.tiles[3] = 1;
  Object.assign(map.spawns[0], { x: 0, y: 0 });
  const found = codes(map);
  for (const code of ['wrong-zone', 'open-border', 'spawn-in-wall']) assert.ok(found.includes(code), `${code} 없음: ${found}`);
});
