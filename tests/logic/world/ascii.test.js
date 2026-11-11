import assert from 'node:assert/strict';
import { test } from 'node:test';

import { toAscii } from '../../../src/logic/world/ascii.js';
import { generateFloor } from '../../../src/logic/world/generate.js';
import { TILE } from '../../../src/logic/world/tiles.js';

test('toAscii 는 타일·문·방의 종류·시작점을 글자로 그린다', () => {
  const map = {
    width: 7,
    height: 5,
    tiles: [
      0, 0, 0, 0, 0, 0, 0,
      0, 1, 1, 2, 1, 1, 0,
      0, 1, 1, 0, 1, 1, 0,
      0, 1, 1, 1, 1, 1, 0,
      0, 0, 0, 0, 0, 0, 0,
    ],
    start: { x: 1, y: 1 },
    doors: [{ cells: [10] }, { cells: [24] }],
    rooms: [
      { kind: 'start', feature: { x: 1, y: 1 }, spawnCells: [] },
      { kind: 'combat', feature: { x: 5, y: 2 }, spawnCells: [12, 26] },
    ],
  };
  assert.equal(toAscii(map), ['#######', '#@.+..#', '#..#.c#', '#..:..#', '#######'].join('\n'));
  assert.equal(toAscii(map, { spawns: true }), ['#######', '#@.+.x#', '#..#.c#', '#..:.x#', '#######'].join('\n'));
});

test('toAscii 는 방·문 목록이 없는 맵과 맵 밖 좌표도 처리한다', () => {
  const map = { width: 3, height: 3, tiles: [0, 0, 0, 0, 1, 0, 0, 0, 0], start: { x: 9, y: 9 } };
  assert.equal(toAscii(map), '###\n#.#\n###');
});

test('실제 층: 방마다 종류 글자가 하나씩 있고, 숨은 문만 닫혀 있다', () => {
  const map = generateFloor({ seed: 'ascii', floor: 1 });
  const text = toAscii(map);
  assert.equal(text.split('\n').length, map.height);
  assert.equal((text.match(/@/g) ?? []).length, 1);
  assert.equal((text.match(/B/g) ?? []).length, 1);
  assert.equal((text.match(/X/g) ?? []).length, 1);
  assert.equal((text.match(/\+/g) ?? []).length, map.tiles.filter((t) => t === TILE.DOOR).length);
  assert.equal((text.match(/:/g) ?? []).length, map.doors.filter((d) => d.open).reduce((n, d) => n + d.cells.length, 0));
});
