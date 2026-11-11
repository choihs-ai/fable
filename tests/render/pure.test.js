// 렌더 계층에서 Three.js 를 쓰지 않는 부분(풀, 카메라 추적·벽 가림 계산, 안개 단계)의 테스트.
// Three.js 를 쓰는 부분은 Node 에서 불러올 수 없어 브라우저 검증(scripts/browser)으로 확인한다.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cutawayCells, distanceScale, followStep } from '../../src/render/camera-rig.js';
import { createPool, createSlots } from '../../src/render/pool.js';
import { FOG, floorLevel, updateLevels, wallLevel } from '../../src/render/world/fog.js';

test('풀: 돌려놓은 것을 다시 꺼내고, 최대 수를 넘겨 만들지 않는다', () => {
  let made = 0;
  const log = [];
  const pool = createPool({ max: 3, create: () => ({ n: ++made }), activate: (i) => log.push(`+${i.n}`), deactivate: (i) => log.push(`-${i.n}`) });
  const a = pool.acquire();
  const b = pool.acquire();
  assert.equal(pool.release(a), true);
  assert.equal(pool.release(a), false, '두 번 돌려놓아도 한 번만 처리한다');
  const c = pool.acquire();
  assert.equal(c, a, '돌려놓은 것을 다시 쓴다');
  pool.acquire();
  assert.equal(made, 3);
  // 다 쓰는 중이면 가장 오래된 것(b)을 되돌려 받아 다시 쓴다.
  const e = pool.acquire();
  assert.equal(e, b);
  assert.equal(made, 3);
  assert.deepEqual(pool.stats(), { created: 3, active: 3, free: 0, recycled: 1, max: 3 });
  pool.releaseAll();
  assert.deepEqual(pool.stats(), { created: 3, active: 0, free: 3, recycled: 1, max: 3 });
  assert.equal(log.filter((x) => x.startsWith('+')).length, log.filter((x) => x.startsWith('-')).length);
  assert.throws(() => createPool({ create: () => ({}), max: 0 }), RangeError);
});

test('풀: 1만 번 꺼내고 돌려놓아도 만든 수는 그대로다', () => {
  let made = 0;
  const pool = createPool({ max: 16, create: () => ({ id: ++made }) });
  for (let i = 0; i < 10000; i++) {
    const item = pool.acquire();
    if (i % 3 !== 0) pool.release(item);
    if (i % 50 === 0) pool.releaseAll();
  }
  assert.ok(made <= 16);
  assert.equal(pool.stats().created, made);
});

test('칸 채우기식 풀: 쓴 만큼만 보이고, 줄어들면 남는 것을 숨기고, 최대 수를 넘는 것은 그리지 않는다', () => {
  const shown = new Set();
  let made = 0;
  const slots = createSlots({ max: 4, create: () => ({ id: ++made }), show: (item, on) => (on ? shown.add(item.id) : shown.delete(item.id)) });
  const frame = (n) => {
    slots.begin();
    let got = 0;
    for (let i = 0; i < n; i++) if (slots.next()) got++;
    slots.end();
    return got;
  };
  assert.equal(frame(3), 3);
  assert.deepEqual([...shown].sort(), [1, 2, 3]);
  assert.equal(frame(1), 1);
  assert.deepEqual([...shown], [1]);
  assert.equal(frame(9), 4);
  assert.equal(made, 4);
  assert.equal(slots.stats().dropped, 5);
  assert.equal(frame(0), 0);
  assert.equal(shown.size, 0);
  for (let i = 0; i < 500; i++) frame(i % 5);
  assert.equal(made, 4);
});

test('카메라 추적: 프레임을 어떻게 나눠도 같은 시간 뒤에는 같은 곳에 있고, 멀면 곧바로 옮긴다', () => {
  const target = { x: 5, y: -3 };
  const one = { x: 0, y: 0 };
  followStep(one, target, 9, 0.1, 10);
  const many = { x: 0, y: 0 };
  for (let i = 0; i < 10; i++) followStep(many, target, 9, 0.01, 10);
  assert.ok(Math.abs(one.x - many.x) < 1e-9 && Math.abs(one.y - many.y) < 1e-9);
  assert.ok(one.x > 0 && one.x < 5, '한 번에 넘어가지 않는다');
  for (let i = 0; i < 200; i++) followStep(one, target, 9, 1 / 60, 10);
  assert.ok(Math.abs(one.x - 5) < 1e-6);

  const far = { x: 0, y: 0 };
  assert.equal(followStep(far, { x: 30, y: 0 }, 9, 1 / 60, 10), true);
  assert.deepEqual(far, { x: 30, y: 0 });
  // 수가 아닌 목표는 무시한다(카메라가 NaN 으로 가지 않는다).
  assert.equal(followStep(far, { x: Number.NaN, y: 0 }, 9, 1 / 60, 10), false);
  assert.deepEqual(far, { x: 30, y: 0 });
  // 프레임 길이가 0 이거나 음수여도 움직이지 않을 뿐이다.
  followStep(far, { x: 31, y: 0 }, 9, -1, 10);
  assert.deepEqual(far, { x: 30, y: 0 });
});

test('벽 가림: 플레이어 남쪽(카메라 쪽)의 벽만 낮추고, 맵 밖과 바닥은 건드리지 않는다', () => {
  // 5×5, 가운데 줄(y=2)만 바닥.
  const w = 5;
  const tiles = new Array(25).fill(0);
  for (let x = 0; x < 5; x++) tiles[2 * w + x] = 1;
  const cells = cutawayCells(tiles, w, 5, 2.5, 2.5, 3, 1);
  assert.deepEqual(cells, [3 * w + 1, 3 * w + 2, 3 * w + 3, 4 * w + 1, 4 * w + 2, 4 * w + 3]);
  assert.ok(cells.every((c) => tiles[c] === 0));
  assert.ok(cells.every((c) => Math.floor(c / w) > 2), '북쪽 벽은 가리지 않으므로 그대로 둔다');
  assert.deepEqual(cutawayCells(tiles, w, 5, 0.5, 4.5, 3, 2), [], '맨 아래 줄에서는 더 남쪽이 없다');
  assert.deepEqual(cutawayCells(tiles, w, 5, 0.2, 2.9, 1, 1), [3 * w + 0, 3 * w + 1]);
});

test('카메라 거리: 가로 화면은 1, 세로로 길수록 멀어지되 상한을 넘지 않는다', () => {
  assert.equal(distanceScale(16 / 9, 1.35), 1);
  assert.equal(distanceScale(1, 1.35), 1);
  const tall = distanceScale(9 / 19.5, 1.35);
  assert.ok(tall > 1.3 && tall <= 1.35);
  assert.ok(distanceScale(0.8, 1.35) < tall);
  assert.equal(distanceScale(0.1, 1.35), 1.35);
  assert.equal(distanceScale(0, 1.35), 1);
  assert.equal(distanceScale(Number.NaN, 1.35), 1);
});

test('안개: 보이는 곳·탐험한 곳·가 보지 않은 곳을 구분하고, 벽은 맞닿은 바닥의 밝기를 따른다', () => {
  // 3×3: 가운데만 바닥. visible 은 가운데만, explored 는 가운데만.
  const vision = { visible: [0, 0, 0, 0, 1, 0, 0, 0, 0], explored: [0, 0, 0, 0, 1, 0, 0, 0, 0] };
  assert.equal(floorLevel(vision, 4), FOG.VISIBLE);
  assert.equal(floorLevel(vision, 0), FOG.HIDDEN);
  assert.equal(wallLevel(vision, 3, 3, 0), FOG.VISIBLE, '보이는 바닥에 맞닿은 벽');
  vision.visible[4] = 0;
  assert.equal(floorLevel(vision, 4), FOG.EXPLORED);
  assert.equal(wallLevel(vision, 3, 3, 8), FOG.EXPLORED);
  vision.explored[4] = 0;
  assert.equal(wallLevel(vision, 3, 3, 8), FOG.HIDDEN);
});

test('안개 갱신: 단계가 바뀐 인스턴스만 다시 칠한다', () => {
  const levels = new Uint8Array(4);
  const cells = [10, 11, 12, 13];
  const painted = [];
  const now = { 10: 2, 11: 1, 12: 0, 13: 2 };
  assert.equal(updateLevels(levels, cells, (c) => now[c], (i, level) => painted.push([i, level])), 3);
  assert.deepEqual(painted, [[0, 2], [1, 1], [3, 2]]);
  painted.length = 0;
  now[10] = 1;
  assert.equal(updateLevels(levels, cells, (c) => now[c], (i, level) => painted.push([i, level])), 1);
  assert.deepEqual(painted, [[0, 1]]);
  assert.equal(updateLevels(levels, cells, (c) => now[c], () => assert.fail('바뀐 것이 없다')), 0);
});
