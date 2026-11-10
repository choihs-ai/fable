import assert from 'node:assert/strict';
import { test } from 'node:test';

import { connectRegions } from '../../../src/logic/world/connect.js';
import { bfsDistances, fillRect, labelRegions } from '../../../src/logic/world/grid.js';

/** 글자 그림을 타일 배열로 바꾼다. '#' 은 벽, 그 밖은 바닥. */
function parse(rows) {
  const h = rows.length;
  const w = rows[0].length;
  const tiles = new Uint8Array(w * h);
  rows.forEach((row, y) => {
    assert.equal(row.length, w, '모든 줄의 길이가 같아야 함');
    for (let x = 0; x < w; x++) tiles[y * w + x] = row[x] === '#' ? 0 : 1;
  });
  return { tiles, w, h };
}

function draw(tiles, w, h) {
  const rows = [];
  for (let y = 0; y < h; y++) rows.push(Array.from(tiles.slice(y * w, (y + 1) * w), (t) => (t ? '.' : '#')).join(''));
  return rows;
}

test('bfsDistances: 상하좌우 걸음 수를 구하고 닿지 못하는 칸은 -1', () => {
  const { tiles, w, h } = parse([
    '#######',
    '#..#..#',
    '#.##..#',
    '#.....#',
    '#######',
  ]);
  const dist = bfsDistances(tiles, w, h, 1 * w + 1);
  const at = (x, y) => dist[y * w + x];

  assert.equal(at(1, 1), 0);
  assert.equal(at(2, 1), 1);
  assert.equal(at(1, 3), 2);
  assert.equal(at(5, 3), 6);
  assert.equal(at(4, 1), 7, '벽을 돌아가야 한다');
  assert.equal(at(3, 1), -1, '벽');
  assert.equal(at(0, 0), -1);
});

test('bfsDistances: 대각선으로는 지나가지 못한다', () => {
  const { tiles, w, h } = parse([
    '####',
    '#.##',
    '##.#',
    '####',
  ]);
  const dist = bfsDistances(tiles, w, h, 1 * w + 1);
  assert.equal(dist[2 * w + 2], -1);
});

test('bfsDistances: blocked 칸은 바닥이어도 지나가지 못한다', () => {
  const { tiles, w, h } = parse([
    '#####',
    '#...#',
    '#####',
  ]);
  const blocked = new Uint8Array(w * h);
  blocked[1 * w + 2] = 1;
  const dist = bfsDistances(tiles, w, h, 1 * w + 1, blocked);

  assert.equal(dist[1 * w + 2], -1);
  assert.equal(dist[1 * w + 3], -1);
});

test('bfsDistances: 시작 칸이 벽이거나 범위 밖이면 전부 -1, 테두리가 뚫린 맵에서도 범위를 넘지 않는다', () => {
  const { tiles, w, h } = parse(['...', '.#.', '...']);
  assert.ok(bfsDistances(tiles, w, h, 4).every((d) => d === -1));
  assert.ok(bfsDistances(tiles, w, h, 99).every((d) => d === -1));
  const dist = bfsDistances(tiles, w, h, 0);
  assert.equal(dist[8], 4);
  assert.equal(dist[2], 2, '줄 끝에서 다음 줄로 넘어가지 않는다');
});

test('labelRegions: 이어진 바닥끼리 묶고 크기를 센다', () => {
  const { tiles, w, h } = parse([
    '#######',
    '#..#..#',
    '#..#..#',
    '####..#',
    '#.#####',
    '#######',
  ]);
  const { labels, sizes } = labelRegions(tiles, w, h);

  assert.deepEqual(sizes.slice().sort((a, b) => a - b), [1, 4, 6]);
  assert.equal(labels[1 * w + 1], labels[2 * w + 2]);
  assert.notEqual(labels[1 * w + 1], labels[1 * w + 4]);
  assert.equal(labels[0], -1);
});

test('connectRegions: 큰 구역은 굴로 잇고 작은 구역은 메운다', () => {
  const { tiles, w, h } = parse([
    '###############',
    '#....#####....#',
    '#....#####....#',
    '#....#####....#',
    '#....###.#....#',
    '###############',
  ]);
  const result = connectRegions(tiles, w, h, { anchor: 1 * w + 1, keep: null, minRegionSize: 4 });

  assert.deepEqual(result, { tunnels: 1, filled: 1 });
  assert.equal(labelRegions(tiles, w, h).sizes.length, 1, draw(tiles, w, h).join('\n'));
  assert.equal(tiles[4 * w + 8], 0, '한 칸짜리 구역은 메워진다');
  assert.equal(tiles[1 * w + 11], 1, '오른쪽 방은 남는다');
});

test('connectRegions: anchor 가 없으면 가장 큰 구역을 기준으로 삼는다', () => {
  const { tiles, w, h } = parse([
    '###########',
    '#.##......#',
    '#.##......#',
    '###########',
  ]);
  connectRegions(tiles, w, h, { anchor: -1, keep: null, minRegionSize: 5 });

  assert.equal(tiles[1 * w + 1], 0, '작은 쪽이 메워진다');
  assert.equal(tiles[1 * w + 5], 1);
});

test('connectRegions: anchor 가 든 구역은 작아도 기준이 되고, keep 칸이 든 구역은 작아도 잇는다', () => {
  const rows = [
    '###########',
    '#.##......#',
    '#.##......#',
    '###########',
  ];
  const a = parse(rows);
  connectRegions(a.tiles, a.w, a.h, { anchor: 1 * a.w + 1, keep: null, minRegionSize: 5 });
  assert.equal(a.tiles[1 * a.w + 1], 1, 'anchor 구역은 남는다');
  assert.equal(labelRegions(a.tiles, a.w, a.h).sizes.length, 1);

  const b = parse(rows);
  const keep = new Uint8Array(b.w * b.h);
  keep[1 * b.w + 1] = 1;
  const result = connectRegions(b.tiles, b.w, b.h, { anchor: 1 * b.w + 5, keep, minRegionSize: 5 });
  assert.deepEqual(result, { tunnels: 1, filled: 0 });
  assert.equal(b.tiles[1 * b.w + 1], 1);
  assert.equal(labelRegions(b.tiles, b.w, b.h).sizes.length, 1);
});

test('connectRegions: 테두리는 절대 뚫지 않고, 이미 하나로 이어져 있으면 아무것도 바꾸지 않는다', () => {
  const { tiles, w, h } = parse([
    '#########',
    '#..###..#',
    '#########',
    '#..###..#',
    '#########',
  ]);
  connectRegions(tiles, w, h, { anchor: -1, keep: null, minRegionSize: 1 });
  assert.equal(labelRegions(tiles, w, h).sizes.length, 1);
  for (let x = 0; x < w; x++) assert.ok(tiles[x] === 0 && tiles[(h - 1) * w + x] === 0);
  for (let y = 0; y < h; y++) assert.ok(tiles[y * w] === 0 && tiles[y * w + w - 1] === 0);

  const before = tiles.slice();
  assert.deepEqual(connectRegions(tiles, w, h, { anchor: -1, keep: null, minRegionSize: 1 }), { tunnels: 0, filled: 0 });
  assert.deepEqual(tiles, before);
});

test('fillRect 는 지정한 사각형만 채운다', () => {
  const tiles = new Uint8Array(5 * 4);
  fillRect(tiles, 5, 1, 1, 3, 2, 1);
  assert.deepEqual(draw(tiles, 5, 4), ['#####', '#...#', '#...#', '#####']);
});
