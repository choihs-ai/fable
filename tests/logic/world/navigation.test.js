import assert from 'node:assert/strict';
import { test } from 'node:test';

import { COMBAT } from '../../../data/combat.js';
import { Rng } from '../../../src/logic/core/prng.js';
import { circleFree, moveCircle, resolveCircle } from '../../../src/logic/world/collide.js';
import { generateFloor } from '../../../src/logic/world/generate.js';
import { clearPath, lineOfSight } from '../../../src/logic/world/los.js';
import { buildNav, isWall, navOf, regionAt, setTiles } from '../../../src/logic/world/nav.js';
import { findPath } from '../../../src/logic/world/pathfind.js';
import { TILE } from '../../../src/logic/world/tiles.js';
import { openRoom, parseRows } from '../../helpers/arena.js';

function navFrom(rows) {
  const { width, height, tiles } = parseRows(rows);
  return buildNav(tiles, width, height);
}

// ── 원-격자 충돌 ─────────────────────────────────────────────────────────────

test('circleFree: 벽과 겹치면 false, 맵 밖은 벽으로 본다', () => {
  const nav = navFrom(['#####', '#...#', '#...#', '#####']);
  assert.equal(circleFree(nav, 2.5, 1.5, 0.3), true);
  assert.equal(circleFree(nav, 1.2, 1.5, 0.3), false, '왼쪽 벽에 0.1 겹침');
  assert.equal(circleFree(nav, 1.31, 1.31, 0.3), true);
  assert.equal(circleFree(nav, -3, -3, 0.3), false);
  assert.equal(isWall(nav, 99, 0), true);
});

test('circleFree: 모서리는 원의 실제 모양으로 판정한다(네모가 아니다)', () => {
  const nav = navFrom(['####', '#..#', '#.##', '####']);
  // (2,2) 벽 칸의 모서리 (2,2) 에서 대각선으로 0.28 떨어진 점: 반지름 0.3 이면 겹치고 0.25 면 안 겹친다.
  assert.equal(circleFree(nav, 1.8, 1.8, 0.3), false);
  assert.equal(circleFree(nav, 1.8, 1.8, 0.25), true);
});

test('moveCircle: 벽으로 밀고 가면 벽 앞에서 멈추고, 벽을 따라 미끄러진다', () => {
  const nav = navFrom(openRoom(8, 6));
  const p = { x: 2, y: 2 };
  let touched = false;
  for (let i = 0; i < 120; i++) touched = moveCircle(nav, p, 0.3, -0.07, 0.03) || touched;

  assert.equal(touched, true);
  assert.ok(Math.abs(p.x - 1.3) < 1e-6, `x=${p.x}`);
  assert.ok(Math.abs(p.y - 4.7) < 1e-6, `y=${p.y} — 왼쪽 벽을 타고 아래 구석까지 내려간다`);
  assert.equal(circleFree(nav, p.x, p.y, 0.3 - 1e-6), true);
});

test('moveCircle: 한 번에 크게 움직여도 벽을 뚫지 못한다', () => {
  const nav = navFrom(['########', '#..#...#', '#..#...#', '########']);
  const p = { x: 1.5, y: 1.5 };
  moveCircle(nav, p, 0.3, 4, 0);
  assert.ok(p.x < 3, `x=${p.x}`);
  assert.equal(circleFree(nav, p.x, p.y, 0.29), true);
});

test('resolveCircle: 벽 칸 안에 들어간 중심을 가까운 열린 쪽으로 꺼낸다', () => {
  const nav = navFrom(openRoom(6, 6));
  const p = { x: 0.8, y: 2.5 };
  assert.equal(resolveCircle(nav, p, 0.3), true);
  assert.ok(Math.abs(p.x - 1.3) < 1e-6 && Math.abs(p.y - 2.5) < 1e-6, `${p.x},${p.y}`);
});

test('충돌: 실제 맵에서 아무렇게나 움직여도 벽에 박히지 않는다', () => {
  for (const [seed, floor] of [['walk-a', 1], ['walk-b', 1], ['walk-c', 1], ['walk-d', 1]]) {
    const map = generateFloor({ seed, floor });
    const nav = navOf(map);
    const rng = Rng.fromSeed(`walk:${seed}`);
    for (const radius of [0.25, 0.3, 0.48]) {
      const p = { x: map.start.x + 0.5, y: map.start.y + 0.5 };
      let dx = 0;
      let dy = 0;
      for (let i = 0; i < 4000; i++) {
        if (i % 20 === 0) {
          dx = (rng.float() * 2 - 1) * 0.2;
          dy = (rng.float() * 2 - 1) * 0.2;
        }
        moveCircle(nav, p, radius, dx, dy);
        assert.ok(circleFree(nav, p.x, p.y, radius - 1e-6), `${seed} ${floor}층 r=${radius} @${p.x},${p.y} (${i}번째)`);
      }
    }
  }
});

// ── 시야선 ───────────────────────────────────────────────────────────────────

test('lineOfSight: 벽이 가로막으면 false, 방향을 바꿔도 같은 결과', () => {
  const nav = navFrom([
    '#########',
    '#...#...#',
    '#...#...#',
    '#.......#',
    '#########',
  ]);
  const cases = [
    [1.5, 1.5, 3.5, 2.5, true],
    [1.5, 1.5, 6.5, 1.5, false],
    [1.5, 3.5, 7.5, 3.5, true],
    [2.5, 1.5, 6.5, 3.5, false],
    [3.5, 3.5, 5.5, 3.5, true],
    [1.5, 1.5, 1.5, 1.5, true],
  ];
  for (const [x0, y0, x1, y1, expected] of cases) {
    assert.equal(lineOfSight(nav, x0, y0, x1, y1), expected, `${x0},${y0} → ${x1},${y1}`);
    assert.equal(lineOfSight(nav, x1, y1, x0, y0), expected, `${x1},${y1} → ${x0},${y0}`);
  }
  assert.equal(lineOfSight(nav, 1.5, 1.5, 4.5, 1.5), false, '끝점이 벽');
});

test('clearPath: 몸이 지나갈 폭이 없으면 false', () => {
  const nav = navFrom([
    '#######',
    '#.....#',
    '###.###',
    '#.....#',
    '#######',
  ]);
  // 문(3,2)을 비스듬히 지나는 선: 중심선은 통과하지만 몸 폭만큼의 양옆 선은 문설주에 걸린다.
  assert.equal(lineOfSight(nav, 2.6, 1.5, 4.4, 3.5), true);
  assert.equal(clearPath(nav, 2.6, 1.5, 4.4, 3.5, 0.3), false);
  assert.equal(clearPath(nav, 3.2, 1.5, 3.8, 3.5, 0.3), true, '조금만 비스듬하면 몸이 들어간다');
  assert.equal(clearPath(nav, 3.5, 1.5, 3.5, 3.5, 0.3), true, '문 한가운데로 똑바로 지나면 된다');
  assert.equal(clearPath(nav, 1.5, 1.5, 5.5, 1.5, 0.3), true);
});

// ── A* ───────────────────────────────────────────────────────────────────────

/** 기준 구현: 같은 이동 규칙의 다익스트라(단순 배열). 비용만 구한다. */
function referenceCost(nav, start, goal, clearance) {
  const { w, h, clear } = nav;
  const dist = new Array(w * h).fill(Infinity);
  const done = new Array(w * h).fill(false);
  dist[start] = 0;
  for (;;) {
    let cur = -1;
    for (let i = 0; i < dist.length; i++) if (!done[i] && dist[i] < Infinity && (cur === -1 || dist[i] < dist[cur])) cur = i;
    if (cur === -1) return Infinity;
    if (cur === goal) return dist[cur];
    done[cur] = true;
    const cx = cur % w;
    const cy = Math.floor(cur / w);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (clear[n] === 0 || (clear[n] < clearance && n !== goal)) continue;
        if (dx !== 0 && dy !== 0 && (clear[cy * w + nx] < clearance || clear[ny * w + cx] < clearance)) continue;
        const cost = dist[cur] + (dx !== 0 && dy !== 0 ? 14 : 10);
        if (cost < dist[n]) dist[n] = cost;
      }
    }
  }
}

function pathCost(nav, start, path) {
  let cost = 0;
  let prev = start;
  for (const cell of path) {
    const dx = Math.abs((cell % nav.w) - (prev % nav.w));
    const dy = Math.abs(Math.floor(cell / nav.w) - Math.floor(prev / nav.w));
    assert.ok(dx <= 1 && dy <= 1 && dx + dy > 0, '경로의 칸은 서로 이웃해야 함');
    cost += dx + dy === 2 ? 14 : 10;
    prev = cell;
  }
  return cost;
}

test('findPath: 벽을 돌아가는 가장 짧은 길을 찾고 모서리를 가로지르지 않는다', () => {
  const nav = navFrom([
    '#######',
    '#..#..#',
    '#..#..#',
    '#.....#',
    '#######',
  ]);
  const path = findPath(nav, 1, 1, 5, 1, 1, 1000);
  const cells = path.map((c) => `${c % nav.w},${Math.floor(c / nav.w)}`);

  assert.equal(cells[cells.length - 1], '5,1');
  assert.ok(cells.includes('3,3'), `벽 아래 통로를 지나야 함: ${cells}`);
  assert.equal(pathCost(nav, 1 * nav.w + 1, path), 10 + 14 + 10 + 10 + 14 + 10, `경로 ${cells}`);
  assert.deepEqual(findPath(nav, 2, 2, 2, 2, 1, 1000), []);
});

test('findPath: 길이 없거나 끝점이 벽이면 null, 노드 상한을 넘어도 null', () => {
  const nav = navFrom([
    '#######',
    '#..#..#',
    '#..#..#',
    '#######',
  ]);
  assert.equal(findPath(nav, 1, 1, 5, 1, 1, 1000), null);
  assert.equal(findPath(nav, 1, 1, 3, 1, 1, 1000), null);
  assert.equal(findPath(nav, 0, 0, 1, 1, 1, 1000), null);
  assert.equal(findPath(nav, 1, 1, 99, 1, 1, 1000), null);
  const big = navFrom(openRoom(30, 30));
  assert.equal(findPath(big, 1, 1, 28, 28, 1, 5), null);
  assert.ok(findPath(big, 1, 1, 28, 28, 1, 5000));
});

test('findPath: 실제 맵에서 경로가 유효하고 비용이 기준 구현(다익스트라)과 같다', () => {
  let checked = 0;
  for (const [seed, floor] of [['astar-a', 1], ['astar-b', 1], ['astar-c', 1], ['astar-d', 1], ['astar-e', 1], ['astar-f', 1]]) {
    const map = generateFloor({ seed, floor });
    const nav = navOf(map);
    const rng = Rng.fromSeed(`astar:${seed}`);
    const floorCells = [];
    for (let i = 0; i < nav.tiles.length; i++) if (nav.tiles[i] === 1) floorCells.push(i);
    for (let k = 0; k < 12; k++) {
      const start = rng.pick(floorCells);
      const goal = rng.pick(floorCells);
      for (const clearance of [1, 2]) {
        const path = findPath(nav, start % nav.w, Math.floor(start / nav.w), goal % nav.w, Math.floor(goal / nav.w), clearance, 100000);
        const expected = referenceCost(nav, start, goal, clearance);
        const where = `${seed} ${floor}층 ${start}→${goal} 여유 ${clearance}`;
        if (expected === Infinity) {
          assert.equal(path, null, where);
          continue;
        }
        assert.ok(path, `${where}: 길이 있는데 못 찾음`);
        assert.equal(pathCost(nav, start, path), expected, where);
        let prev = start;
        for (const cell of path) {
          assert.ok(nav.clear[cell] >= clearance || cell === goal, `${where}: 지나갈 수 없는 칸 ${cell}`);
          const px = prev % nav.w;
          const py = Math.floor(prev / nav.w);
          const cx = cell % nav.w;
          const cy = Math.floor(cell / nav.w);
          if (px !== cx && py !== cy) {
            assert.ok(nav.tiles[py * nav.w + cx] === 1 && nav.tiles[cy * nav.w + px] === 1, `${where}: 모서리를 가로지름`);
          }
          prev = cell;
        }
        checked++;
      }
    }
  }
  assert.ok(checked > 50, `검사한 경로 ${checked}개`);
});

test('findPath: 같은 입력이면 항상 같은 경로', () => {
  const map = generateFloor({ seed: 'astar-same', floor: 1 });
  const nav = navOf(map);
  const goal = map.rooms.find((room) => room.kind === 'boss').feature;
  const a = findPath(nav, map.start.x, map.start.y, goal.x, goal.y, 1, 100000);
  findPath(nav, goal.x, goal.y, map.start.x, map.start.y, 1, 100000);
  const b = findPath(nav, map.start.x, map.start.y, goal.x, goal.y, 1, 100000);
  assert.ok(a.length > 10);
  assert.deepEqual(a, b);
});

test('buildNav: 둘레 8칸이 모두 바닥인 칸만 여유 2', () => {
  const nav = navFrom(['#####', '#...#', '#...#', '#...#', '#####']);
  assert.equal(nav.clear[2 * 5 + 2], 2);
  assert.equal(nav.clear[1 * 5 + 1], 1);
  assert.equal(nav.clear[0], 0);
});

test('문을 닫으면 벽처럼 막히고, 열면 다시 지나갈 수 있다(setTiles)', () => {
  const map = generateFloor({ seed: 'door-nav', floor: 1 });
  const nav = navOf(map);
  const door = map.doors.find((d) => d.open);
  const [cx, cy] = [door.cells[0] % map.width, Math.floor(door.cells[0] / map.width)];
  const link = map.links[door.link];
  const [a, b] = link.rooms.map((id) => map.rooms[id].feature);
  assert.equal(isWall(nav, cx, cy), false);
  assert.ok(findPath(nav, a.x, a.y, b.x, b.y, 1, 100000), '열려 있으면 길이 있다');

  // 그 복도의 문을 닫으면 그 길로는 지나갈 수 없다(돌아가는 길이 없는 맵이면 길이 사라진다).
  setTiles(map, door.cells, TILE.DOOR);
  assert.equal(isWall(nav, cx, cy), true);
  assert.equal(map.tiles[door.cells[0]], TILE.DOOR);
  assert.equal(navOf(map), nav, '같은 nav 를 고쳐 쓴다');
  for (const c of door.cells) assert.equal(nav.clear[c], 0);
  assert.equal(lineOfSight(nav, cx + 0.5, cy - 2 + 0.5, cx + 0.5, cy + 2 + 0.5) && lineOfSight(nav, cx - 2 + 0.5, cy + 0.5, cx + 2 + 0.5, cy + 0.5), false);
  const blocked = findPath(nav, a.x, a.y, b.x, b.y, 1, 100000);
  if (blocked) assert.ok(!blocked.some((cell) => door.cells.includes(cell)), '닫힌 문을 지나는 길은 없다');

  setTiles(map, door.cells, TILE.FLOOR);
  assert.equal(isWall(nav, cx, cy), false);
  assert.deepEqual(Array.from(nav.clear), Array.from(buildNav(map.tiles, map.width, map.height).clear), '둘레의 여유도 처음과 같다');
});

test('regionAt: 플레이어가 선 칸이 어느 방·복도인지 알려 준다', () => {
  const map = generateFloor({ seed: 'region', floor: 1 });
  const nav = navOf(map);
  for (const room of map.rooms) assert.equal(regionAt(nav, room.feature.x + 0.5, room.feature.y + 0.5), room.id);
  for (const door of map.doors) {
    const region = regionAt(nav, door.x, door.y);
    assert.equal(region, map.rooms.length + door.link, '문은 복도에 속한다');
  }
  assert.equal(regionAt(nav, 0.5, 0.5), -1);
  assert.equal(regionAt(nav, -3, 999), -1);
});
