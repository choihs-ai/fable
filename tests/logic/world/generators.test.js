import assert from 'node:assert/strict';
import { test } from 'node:test';

import { WORLD } from '../../../data/world.js';
import { Rng } from '../../../src/logic/core/prng.js';
import { toAscii } from '../../../src/logic/world/ascii.js';
import { connectRegions } from '../../../src/logic/world/connect.js';
import { buildBossLayout } from '../../../src/logic/world/gen-boss.js';
import { generateCave } from '../../../src/logic/world/gen-cave.js';
import { generateRooms } from '../../../src/logic/world/gen-rooms.js';
import { bfsDistances, labelRegions } from '../../../src/logic/world/grid.js';

const SEEDS = Array.from({ length: 40 }, (_, i) => `gen-${i}`);

function assertBorderWalls(tiles, w, h, label) {
  for (let x = 0; x < w; x++) assert.ok(tiles[x] === 0 && tiles[(h - 1) * w + x] === 0, `${label}: 위아래 테두리`);
  for (let y = 0; y < h; y++) assert.ok(tiles[y * w] === 0 && tiles[y * w + w - 1] === 0, `${label}: 좌우 테두리`);
}

// ── 방+복도 ──────────────────────────────────────────────────────────────────

test('방+복도: 방은 맵 안에 있고 서로 떨어져 있으며 전부 바닥이다', () => {
  for (const seed of SEEDS) {
    const { tiles, rooms } = generateRooms(Rng.fromSeed(seed), 44, 40, WORLD.rooms);
    assertBorderWalls(tiles, 44, 40, seed);
    assert.ok(rooms.length >= 4, `${seed}: 방 ${rooms.length}개`);
    for (const room of rooms) {
      assert.ok(room.w >= WORLD.rooms.roomMin && room.h >= WORLD.rooms.roomMin, `${seed}: 방 크기`);
      assert.ok(room.x >= 2 && room.y >= 2 && room.x + room.w <= 42 && room.y + room.h <= 38, `${seed}: 방 위치`);
      for (let y = room.y; y < room.y + room.h; y++) {
        for (let x = room.x; x < room.x + room.w; x++) assert.equal(tiles[y * 44 + x], 1, `${seed}: 방 내부`);
      }
    }
    for (let a = 0; a < rooms.length; a++) {
      for (let b = a + 1; b < rooms.length; b++) {
        const r = rooms[a];
        const o = rooms[b];
        // 사이에 벽이 최소 한 칸은 있어야 한다.
        const apart = r.x >= o.x + o.w + 1 || o.x >= r.x + r.w + 1 || r.y >= o.y + o.h + 1 || o.y >= r.y + r.h + 1;
        assert.ok(apart, `${seed}: 방 ${a} 와 ${b} 가 붙어 있음`);
      }
    }
  }
});

test('방+복도: 보정 없이도 모든 바닥이 하나로 이어져 있다', () => {
  for (const seed of SEEDS) {
    const { tiles } = generateRooms(Rng.fromSeed(seed), 56, 56, WORLD.rooms);
    assert.equal(labelRegions(tiles, 56, 56).sizes.length, 1, seed);
  }
});

test('방+복도: 같은 난수 스트림이면 같은 결과, 다르면 다른 결과', () => {
  const a = generateRooms(Rng.fromSeed('x'), 40, 40, WORLD.rooms);
  const b = generateRooms(Rng.fromSeed('x'), 40, 40, WORLD.rooms);
  const c = generateRooms(Rng.fromSeed('y'), 40, 40, WORLD.rooms);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.tiles, c.tiles);
});

// ── 동굴 ─────────────────────────────────────────────────────────────────────

test('동굴: 테두리는 벽이고, 연결 보정 뒤에는 바닥이 하나로 이어진다', () => {
  let repaired = 0;
  for (const seed of SEEDS) {
    const { tiles, rooms } = generateCave(Rng.fromSeed(seed), 48, 48, WORLD.cave);
    assert.deepEqual(rooms, []);
    assertBorderWalls(tiles, 48, 48, seed);
    if (labelRegions(tiles, 48, 48).sizes.length > 1) repaired++;

    connectRegions(tiles, 48, 48, { anchor: -1, keep: null, minRegionSize: WORLD.cave.minRegionSize });

    assertBorderWalls(tiles, 48, 48, `${seed} 보정 후`);
    const { sizes } = labelRegions(tiles, 48, 48);
    assert.equal(sizes.length, 1, seed);
    assert.ok(sizes[0] / (48 * 48) >= WORLD.cave.minOpenRatio, `${seed}: 바닥 비율 ${sizes[0] / (48 * 48)}`);
  }
  // 보정이 실제로 일을 하는 경우가 표본에 들어 있어야 이 테스트가 의미가 있다.
  assert.ok(repaired > 0, '표본 가운데 보정이 필요한 동굴이 하나도 없음');
});

test('동굴: 같은 난수 스트림이면 같은 결과, 다르면 다른 결과', () => {
  const a = generateCave(Rng.fromSeed('x'), 40, 40, WORLD.cave);
  const b = generateCave(Rng.fromSeed('x'), 40, 40, WORLD.cave);
  const c = generateCave(Rng.fromSeed('y'), 40, 40, WORLD.cave);
  assert.deepEqual(a.tiles, b.tiles);
  assert.notDeepEqual(a.tiles, c.tiles);
});

// ── 보스층 ───────────────────────────────────────────────────────────────────

for (const [name, cfg] of [['중간보스', WORLD.boss.mid], ['최종보스', WORLD.boss.final]]) {
  test(`${name} 레이아웃: 좌우 대칭이고 시작점·보스·계단이 한 구역 안의 바닥에 있다`, () => {
    const variants = new Set();
    for (const seed of SEEDS) {
      const layout = buildBossLayout(Rng.fromSeed(seed), cfg);
      const { width: w, height: h, tiles } = layout;
      const label = `${name} ${seed}\n${toAscii({ ...layout, spawns: [], eventRooms: [] })}`;
      variants.add(`${w}x${h}:${Array.from(tiles).join('')}`);

      assertBorderWalls(tiles, w, h, label);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) assert.equal(tiles[y * w + x], tiles[y * w + (w - 1 - x)], `대칭 깨짐 @${x},${y}\n${label}`);
      }
      assert.equal(labelRegions(tiles, w, h).sizes.length, 1, label);

      const dist = bfsDistances(tiles, w, h, layout.start.y * w + layout.start.x);
      assert.ok(dist[layout.boss.y * w + layout.boss.x] >= WORLD.placement.enemyMinStartDist, `보스 거리\n${label}`);
      assert.ok(layout.boss.y < layout.start.y, '보스는 시작점보다 위쪽');
      if (cfg.exit) {
        assert.ok(dist[layout.stairs.y * w + layout.stairs.x] > dist[layout.boss.y * w + layout.boss.x], `계단은 보스 뒤편\n${label}`);
        assert.equal(tiles[layout.reward.y * w + layout.reward.x], 1);
        assert.notDeepEqual(layout.reward, layout.stairs);
      } else {
        assert.equal(layout.stairs, null);
        assert.equal(layout.reward, null);
      }
      for (const room of layout.rooms) {
        assert.ok(room.x >= 1 && room.y >= 1 && room.x + room.w <= w - 1 && room.y + room.h <= h - 1, `방 범위\n${label}`);
      }
    }
    assert.ok(variants.size >= 8, `${name}: 시드별 변형이 ${variants.size}가지뿐`);
  });

  test(`${name} 레이아웃: plain 은 난수를 쓰지 않는 가장 단순한 형태다`, () => {
    const a = buildBossLayout(Rng.fromSeed('a'), cfg, { plain: true });
    const b = buildBossLayout(Rng.fromSeed('b'), cfg, { plain: true });
    assert.deepEqual(a, b);
    assert.equal(a.width, cfg.arenaW[0] + cfg.margin * 2);
  });
}

test('최종보스 결투장은 중간보스 결투장보다 크다', () => {
  const mid = buildBossLayout(Rng.fromSeed('a'), WORLD.boss.mid, { plain: true });
  const final = buildBossLayout(Rng.fromSeed('a'), WORLD.boss.final, { plain: true });
  const area = (layout) => layout.rooms[0].w * layout.rooms[0].h;
  assert.ok(area(final) > area(mid));
});
