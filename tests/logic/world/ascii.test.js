import assert from 'node:assert/strict';
import { test } from 'node:test';

import { toAscii } from '../../../src/logic/world/ascii.js';

test('toAscii 는 타일과 배치를 글자로 그린다(시작점·계단이 가장 위에 그려진다)', () => {
  const map = {
    width: 7,
    height: 5,
    tiles: [
      0, 0, 0, 0, 0, 0, 0,
      0, 1, 1, 1, 1, 1, 0,
      0, 1, 1, 1, 1, 1, 0,
      0, 1, 1, 1, 1, 1, 0,
      0, 0, 0, 0, 0, 0, 0,
    ],
    start: { x: 1, y: 3 },
    stairs: { x: 5, y: 1 },
    eventRooms: [{ kind: 'shop', x: 2, y: 1, w: 3, h: 3, feature: { x: 3, y: 2 } }],
    spawns: [
      { kind: 'enemy', id: 'rat', x: 5, y: 3 },
      { kind: 'item', x: 1, y: 1 },
      { kind: 'boss', id: 'x', x: 4, y: 3 },
    ],
  };

  assert.deepEqual(toAscii(map).split('\n'), [
    '#######',
    '#i...>#',
    '#..S..#',
    '#@..Be#',
    '#######',
  ]);
});

test('toAscii 는 계단이 없는 층과 맵 밖 좌표도 처리한다', () => {
  const map = { width: 3, height: 3, tiles: [0, 0, 0, 0, 1, 0, 0, 0, 0], start: { x: 1, y: 1 }, stairs: null, spawns: [{ kind: 'enemy', x: 9, y: 9 }] };
  assert.deepEqual(toAscii(map).split('\n'), ['###', '#@#', '###']);
});
