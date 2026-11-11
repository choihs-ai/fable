// 생성기의 부품: 방 배치(BSP)와 복도, 결투장 무늬와 보스 구역, 동굴, 구조 읽기.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { WORLD } from '../../../data/world.js';
import { Rng } from '../../../src/logic/core/prng.js';
import { addCover, buildBossWing } from '../../../src/logic/world/gen-boss.js';
import { generateCave } from '../../../src/logic/world/gen-cave.js';
import { addRoom, carveLink, createLayout, generateGridRooms, generateRooms, isLinked, scanLinks } from '../../../src/logic/world/gen-rooms.js';
import { bfsDistances, isClear, labelRegions } from '../../../src/logic/world/grid.js';
import { readStructure } from '../../../src/logic/world/structure.js';
import { TILE } from '../../../src/logic/world/tiles.js';

const SEEDS = Array.from({ length: 60 }, (_, i) => `gen-${i}`);
const W = WORLD.layout.w;
const H = WORLD.layout.h + 2;
const REGION = { x: 1, y: 1, w: W - 2, h: H - 2 };

function layoutOf(seed) {
  const layout = createLayout(W, H);
  const result = generateRooms(Rng.fromSeed(seed), layout, REGION, WORLD.layout);
  return { layout, result };
}

function assertBorderWalls(tiles, w, h, label) {
  for (let x = 0; x < w; x++) assert.ok(tiles[x] === 0 && tiles[(h - 1) * w + x] === 0, `${label}: 위아래 테두리`);
  for (let y = 0; y < h; y++) assert.ok(tiles[y * w] === 0 && tiles[y * w + w - 1] === 0, `${label}: 좌우 테두리`);
}

// ── 방 배치 ──────────────────────────────────────────────────────────────────

test('방 배치: 방은 맵 안에 있고 서로 떨어져 있으며, 크기는 홀수이고 전투방 최소 크기 이상이다', () => {
  let made = 0;
  for (const seed of SEEDS) {
    const { layout, result } = layoutOf(seed);
    if (!result.ok) continue;
    made++;
    assertBorderWalls(layout.tiles, W, H, seed);
    for (const room of layout.rooms) {
      assert.ok(room.w >= WORLD.layout.roomMinW && room.h >= WORLD.layout.roomMinH, `${seed}: ${room.w}x${room.h}`);
      assert.ok(room.w % 2 === 1 && room.h % 2 === 1, `${seed}: 홀수 크기`);
      assert.ok(room.x >= 2 && room.y >= 2 && room.x + room.w <= W - 2 && room.y + room.h <= H - 2, `${seed}: 맵 안`);
    }
    for (let i = 0; i < layout.rooms.length; i++) {
      for (let j = i + 1; j < layout.rooms.length; j++) {
        const a = layout.rooms[i];
        const b = layout.rooms[j];
        const apart = a.x + a.w + 2 <= b.x || b.x + b.w + 2 <= a.x || a.y + a.h + 2 <= b.y || b.y + b.h + 2 <= a.y;
        assert.ok(apart, `${seed}: 방 ${i}·${j} 사이에 벽 두 칸`);
      }
    }
  }
  assert.ok(made >= SEEDS.length * 0.8, `성공한 배치 ${made}/${SEEDS.length}`);
});

test('방 배치: 모든 방이 복도로 하나로 이어지고, 복도는 곧고 짧으며 두 방만 잇는다', () => {
  for (const seed of SEEDS) {
    const { layout, result } = layoutOf(seed);
    if (!result.ok) continue;
    assert.equal(labelRegions(layout.tiles, W, H).sizes.length, 1, `${seed}: 바닥이 하나로 이어짐`);
    const structure = readStructure(layout.tiles, W, H, layout.rooms);
    assert.deepEqual(structure.errors, [], seed);
    assert.equal(structure.links.length, layout.links.length);
    assert.ok(layout.links.length >= layout.rooms.length - 1, '방을 모두 이으려면 최소 (방 수 − 1)개');
    for (const link of layout.links) {
      assert.equal(link.width, WORLD.layout.corridorWidth);
      assert.ok(link.length >= 2 && link.length <= WORLD.layout.maxGap, `${seed}: 복도 길이 ${link.length}`);
      assert.equal(link.cells.length, link.width * link.length);
    }
    for (const found of structure.links) {
      assert.equal(found.rooms.length, 2);
      for (const door of found.doors) assert.equal(door.cells.length, WORLD.layout.corridorWidth, '문의 폭 = 복도의 폭');
    }
    // 같은 두 방을 잇는 복도는 하나뿐이다.
    const pairs = layout.links.map((l) => [...l.rooms].sort((a, b) => a - b).join('-'));
    assert.equal(new Set(pairs).size, pairs.length, seed);
  }
});

test('방 배치: 같은 난수 스트림이면 같은 결과, 다르면 다른 결과', () => {
  const a = layoutOf('same').layout;
  const b = layoutOf('same').layout;
  assert.deepEqual(Array.from(a.tiles), Array.from(b.tiles));
  assert.deepEqual(a.rooms, b.rooms);
  assert.notDeepEqual(Array.from(layoutOf('other').layout.tiles), Array.from(a.tiles));
});

test('scanLinks: 마주 보는 두 방 사이의 곧은 자리만 찾고, 모서리·막힌 길·붙어 버리는 자리는 내지 않는다', () => {
  const layout = createLayout(40, 20);
  const a = addRoom(layout, 2, 4, 9, 9);
  const b = addRoom(layout, 15, 6, 9, 9);
  const found = scanLinks(layout, a, 'E', 2, 9);
  assert.ok(found.length > 0);
  for (const c of found) {
    assert.deepEqual([c.a, c.b, c.dir, c.gap, c.width], [a.id, b.id, 'E', 4, 2]);
    assert.equal(c.x, a.x + a.w);
    // 두 방의 모서리를 피한다: 복도의 두 줄과 그 양옆이 모두 두 방의 벽 안쪽에 있다.
    assert.ok(c.y - 1 >= Math.max(a.y, b.y) && c.y + 2 <= Math.min(a.y + a.h, b.y + b.h) - 1, `y=${c.y}`);
  }
  assert.deepEqual(scanLinks(layout, a, 'W', 2, 9), [], '반대쪽에는 방이 없다');
  assert.deepEqual(scanLinks(layout, a, 'E', 2, 3), [], '너무 멀면 잇지 않는다');
  // 복도를 파면 그 자리와 바로 옆 자리는 더 쓸 수 없다.
  const made = carveLink(layout, found[0]);
  assert.equal(isLinked(layout, a.id, b.id), true);
  assert.equal(isLinked(layout, b.id, a.id), true);
  assert.equal(made.cells.every((c) => layout.tiles[c] === TILE.FLOOR), true);
  const again = scanLinks(layout, a, 'E', 2, 9);
  assert.ok(again.every((c) => Math.abs(c.y - found[0].y) >= 3), '기존 복도와 벽 한 칸 이상 떨어진다');
});

test('비상용 격자 배치: 난수 없이 항상 같은 방들을 만들고 모두 이어진다', () => {
  const a = createLayout(W, H);
  const b = createLayout(W, H);
  assert.deepEqual(generateGridRooms(a, REGION, WORLD.layout), { ok: true });
  generateGridRooms(b, REGION, WORLD.layout);
  assert.deepEqual(Array.from(a.tiles), Array.from(b.tiles));
  assert.ok(a.rooms.length + 1 >= WORLD.roomCount[0] && a.rooms.length + 1 <= WORLD.roomCount[1], `방 ${a.rooms.length}개`);
  assert.equal(labelRegions(a.tiles, W, H).sizes.length, 1);
  assert.deepEqual(readStructure(a.tiles, W, H, a.rooms).errors, []);
});

// ── 결투장 무늬 ──────────────────────────────────────────────────────────────

test('엄폐물: 모든 무늬가 벽에서 2칸 안쪽에만 놓이고, 좌우·상하 대칭이며, 방을 둘로 가르지 않는다', () => {
  const patterns = [...new Set([...WORLD.cover.patterns, ...WORLD.boss.pillars])];
  for (const pattern of patterns) {
    for (const [rw, rh] of [[11, 9], [13, 9], [11, 11], [15, 13], [17, 9], [21, 15], [19, 17]]) {
      const layout = createLayout(rw + 4, rh + 4);
      const room = addRoom(layout, 2, 2, rw, rh, 0);
      const count = addCover(layout, room, pattern);
      const label = `${pattern} ${rw}x${rh}`;
      if (pattern !== 'none') assert.ok(count > 0, `${label}: 아무것도 놓이지 않음`);
      assert.ok(count <= rw * rh * 0.2, `${label}: 엄폐물이 너무 많음(${count})`);
      const w = layout.w;
      for (let y = room.y; y < room.y + rh; y++) {
        for (let x = room.x; x < room.x + rw; x++) {
          const edge = Math.min(x - room.x, room.x + rw - 1 - x, y - room.y, room.y + rh - 1 - y);
          const wall = layout.tiles[y * w + x] === TILE.WALL;
          if (edge < 2) assert.equal(wall, false, `${label}: 벽 둘레 2칸은 비어 있어야 함 @${x},${y}`);
          const mx = room.x + rw - 1 - (x - room.x);
          const my = room.y + rh - 1 - (y - room.y);
          assert.equal(layout.tiles[y * w + mx] === TILE.WALL, wall, `${label}: 좌우 대칭`);
          assert.equal(layout.tiles[my * w + x] === TILE.WALL, wall, `${label}: 상하 대칭`);
        }
      }
      assert.equal(labelRegions(layout.tiles, layout.w, layout.h).sizes.length, 1, `${label}: 방이 갈라짐`);
    }
  }
  assert.throws(() => addCover(createLayout(20, 20), { id: 0, x: 2, y: 2, w: 11, h: 9 }, 'maze'), RangeError);
});

test('보스 구역: 결투장 위에 출구 방이 있고 둘은 복도 하나로 이어진다. 결투장 한가운데는 비어 있다', () => {
  const band = { x: 1, y: 1, w: W - 2, h: WORLD.boss.bandH - 1 };
  const sides = new Set();
  const sizes = new Set();
  for (const seed of SEEDS) {
    const layout = createLayout(W, WORLD.boss.bandH + 4);
    const wing = buildBossWing(Rng.fromSeed(seed), layout, band, WORLD.boss);
    const { arena, exit } = wing;
    sides.add(wing.side);
    sizes.add(`${arena.w}x${arena.h}`);
    assert.ok(arena.w >= WORLD.boss.arenaW[0] && arena.w <= WORLD.boss.arenaW[1] && arena.w % 2 === 1, seed);
    assert.ok(arena.h >= WORLD.boss.arenaH[0] && arena.h <= WORLD.boss.arenaH[1] && arena.h % 2 === 1, seed);
    assert.deepEqual([exit.w, exit.h], [WORLD.boss.exit.w, WORLD.boss.exit.h]);
    assert.ok(exit.y >= 1 && exit.y + exit.h + WORLD.boss.exitGap === arena.y, `${seed}: 출구 방은 결투장 바로 위`);
    assert.equal(exit.x + Math.floor(exit.w / 2), arena.x + Math.floor(arena.w / 2), '가운데가 맞는다');
    assert.equal(arena.y + arena.h - 1, band.y + band.h - 2, '결투장은 구역 아래쪽에 붙고 맨 아랫줄은 벽');
    assertBorderWalls(layout.tiles, layout.w, layout.h, seed);
    const center = (arena.y + Math.floor(arena.h / 2)) * layout.w + arena.x + Math.floor(arena.w / 2);
    assert.ok(isClear(layout.tiles, layout.w, center), `${seed}: 한가운데가 비어 있다`);
    const structure = readStructure(layout.tiles, layout.w, layout.h, layout.rooms);
    assert.deepEqual(structure.errors, [], seed);
    assert.deepEqual(structure.links.map((l) => l.rooms), [[arena.id, exit.id]]);
    assert.equal(structure.links[0].doors[0].cells.length, WORLD.boss.exitWidth);
    assert.equal(labelRegions(layout.tiles, layout.w, layout.h).sizes.length, 1);
  }
  assert.deepEqual([...sides].sort(), ['left', 'right']);
  assert.ok(sizes.size >= 4, `결투장 크기 ${sizes.size}가지`);
  // 비상용: 난수를 쓰지 않는다.
  const plain = () => {
    const layout = createLayout(W, WORLD.boss.bandH + 4);
    buildBossWing(Rng.fromSeed('unused'), layout, band, WORLD.boss, { plain: true });
    return Array.from(layout.tiles);
  };
  assert.deepEqual(plain(), plain());
});

// ── 동굴 ─────────────────────────────────────────────────────────────────────

test('동굴: 테두리는 벽이고, 숨은 방으로 쓸 만한 큰 덩어리가 대부분 나온다', () => {
  let usable = 0;
  for (const seed of SEEDS) {
    const { tiles } = generateCave(Rng.fromSeed(seed), 15, 10, WORLD.cave);
    assertBorderWalls(tiles, 15, 10, seed);
    const { sizes } = labelRegions(tiles, 15, 10);
    if (Math.max(0, ...sizes) >= WORLD.bonus.minCells) usable++;
  }
  assert.ok(usable >= SEEDS.length * 0.6, `쓸 만한 동굴 ${usable}/${SEEDS.length}`);
});

test('동굴: 같은 난수 스트림이면 같은 결과, 다르면 다른 결과', () => {
  const make = (seed) => Array.from(generateCave(Rng.fromSeed(seed), 30, 24, WORLD.cave).tiles);
  assert.deepEqual(make('cave'), make('cave'));
  assert.notDeepEqual(make('cave'), make('cave-2'));
});

// ── 구조 읽기 ────────────────────────────────────────────────────────────────

test('readStructure: 칸마다 방·복도 번호를 매기고, 문과 복도가 잇는 방을 찾는다. 닫힌 문도 복도의 칸이다', () => {
  const layout = createLayout(30, 14);
  const a = addRoom(layout, 2, 2, 9, 9);
  const b = addRoom(layout, 15, 2, 9, 9);
  carveLink(layout, { a: a.id, b: b.id, dir: 'E', x: 11, y: 5, gap: 4, width: 2 });
  const read = () => readStructure(layout.tiles, layout.w, layout.h, layout.rooms);
  let s = read();
  assert.deepEqual(s.errors, []);
  assert.equal(s.regionAt[3 * 30 + 3], 0);
  assert.equal(s.regionAt[3 * 30 + 16], 1);
  assert.equal(s.regionAt[5 * 30 + 12], 2, '복도는 방 다음 번호');
  assert.equal(s.regionAt[0], -1);
  assert.deepEqual(s.links[0].rooms, [0, 1]);
  assert.deepEqual(s.links[0].doors, [{ room: 0, cells: [5 * 30 + 11, 6 * 30 + 11] }, { room: 1, cells: [5 * 30 + 14, 6 * 30 + 14] }]);
  // 문을 닫아도 구조는 같다.
  layout.tiles[5 * 30 + 11] = TILE.DOOR;
  layout.tiles[6 * 30 + 11] = TILE.DOOR;
  s = read();
  assert.deepEqual(s.errors, []);
  assert.deepEqual(s.links[0].rooms, [0, 1]);
  assert.equal(bfsDistances(layout.tiles, 30, 14, 3 * 30 + 3)[3 * 30 + 16], -1, '닫힌 문은 지나갈 수 없다');
});

test('readStructure: 방 하나에만 닿는 복도, 세 방에 닿는 복도, 구부러진 문은 오류로 알린다', () => {
  const dead = createLayout(30, 14);
  addRoom(dead, 2, 2, 9, 9);
  dead.tiles[5 * 30 + 11] = TILE.FLOOR;
  dead.tiles[5 * 30 + 12] = TILE.FLOOR;
  assert.ok(readStructure(dead.tiles, 30, 14, dead.rooms).errors.some((e) => e.startsWith('link-rooms')));

  const wide = createLayout(30, 14);
  addRoom(wide, 2, 2, 9, 9);
  addRoom(wide, 13, 2, 9, 9);
  // 두 방 사이의 벽을 통째로 터서 문이 네 칸이 된다.
  for (let y = 4; y < 8; y++) {
    wide.tiles[y * 30 + 11] = TILE.FLOOR;
    wide.tiles[y * 30 + 12] = TILE.FLOOR;
  }
  assert.ok(readStructure(wide.tiles, 30, 14, wide.rooms).errors.some((e) => e.startsWith('door-shape')));
});
