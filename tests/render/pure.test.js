// 렌더 계층에서 Three.js 를 쓰지 않는 부분(풀, 카메라 추적·벽 가림 계산, 안개 단계)의 테스트.
// Three.js 를 쓰는 부분은 Node 에서 불러올 수 없어 브라우저 검증(scripts/browser)으로 확인한다.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addShake, cutawayCells, decayShake, distanceScale, followStep, shakeOffset } from '../../src/render/camera-rig.js';
import { corpseAt, poseOf } from '../../src/render/entities/pose.js';
import { createPool, createSlots } from '../../src/render/pool.js';
import { approach, regionTargets, stepToward, wallBrightness, wallNeighbors } from '../../src/render/world/reveal.js';

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

test('방 공개: 드러난 구역만 목표 밝기 1, 페이드는 구역 전체가 같은 빠르기로 0.3초 만에 끝난다', () => {
  const world = { rooms: [{ seen: true }, { seen: false }, { seen: true }], links: [{ seen: true }, { seen: false }] };
  const target = regionTargets(world);
  assert.deepEqual(Array.from(target), [1, 0, 1, 1, 0]);
  const current = new Float32Array([1, 0, 0, 1, 0]);
  // 0.1초씩 세 번이면 다 밝아진다. 중간에는 1/3, 2/3 — 칸마다 끊기지 않고 한 값으로 바뀐다.
  assert.deepEqual(stepToward(current, target, 0.3, 0.1), [2]);
  assert.ok(Math.abs(current[2] - 1 / 3) < 1e-6);
  stepToward(current, target, 0.3, 0.1);
  assert.ok(Math.abs(current[2] - 2 / 3) < 1e-6);
  stepToward(current, target, 0.3, 0.1);
  assert.equal(current[2], 1);
  assert.deepEqual(stepToward(current, target, 0.3, 0.1), [], '다 바뀌면 고칠 것이 없다');
  // 프레임을 잘게 나눠도 같은 시간 뒤에는 같은 값이다.
  const a = new Float32Array([0]);
  const b = new Float32Array([0]);
  for (let i = 0; i < 10; i++) stepToward(a, [1], 0.3, 0.015);
  stepToward(b, [1], 0.3, 0.15);
  assert.ok(Math.abs(a[0] - b[0]) < 1e-6);
});

test('방 공개: 벽은 맞닿은 구역 가운데 가장 밝은 것을 따른다', () => {
  // 3x3 의 가운데가 벽, 왼쪽 열이 구역 0, 오른쪽 열이 구역 1.
  const regionAt = new Int16Array([0, -1, 1, 0, -1, 1, 0, -1, 1]);
  const neighbors = wallNeighbors(regionAt, 3, 3, [4, 1]);
  assert.deepEqual(neighbors[0].sort(), [0, 1]);
  assert.equal(wallBrightness(neighbors[0], new Float32Array([0, 0.5])), 0.5);
  assert.equal(wallBrightness([], new Float32Array([1])), 0);
});

test('벽 낮추기 보간: 칸을 넘는 순간 튀지 않고 부드럽게 다가가며, 충분히 가까우면 목표에 맞춘다', () => {
  let h = 1.6;
  const seen = [];
  for (let i = 0; i < 6; i++) {
    h = approach(h, 0.25, 10, 1 / 60);
    seen.push(h);
  }
  assert.ok(seen.every((v, i) => v < (i === 0 ? 1.6 : seen[i - 1])), '줄어들기만 한다');
  assert.ok(1.6 - seen[0] < 0.3, `한 프레임에 크게 튀지 않는다(${(1.6 - seen[0]).toFixed(3)})`);
  for (let i = 0; i < 200; i++) h = approach(h, 0.25, 10, 1 / 60);
  assert.equal(h, 0.25);
});

test('카메라 흔들림: 세기가 0 이면 흔들리지 않고, 더하면 상한을 넘지 않고, 시간이 지나면 잦아든다', () => {
  assert.deepEqual(shakeOffset(0, 1.3, 30), { x: 0, y: 0 });
  const o = shakeOffset(0.5, 0.37, 30);
  assert.ok(Math.abs(o.x) <= 0.5 + 1e-9 && Math.abs(o.y) <= 0.5 + 1e-9 && (o.x !== 0 || o.y !== 0));
  assert.equal(addShake(0.8, 0.5, 0.9), 0.9);
  let s = 0.9;
  for (let i = 0; i < 120; i++) s = decayShake(s, 7, 1 / 60);
  assert.equal(s, 0);
});

test('자세: 걷기는 다리가 엇갈리고, 대시·피격·공격은 몸을 기울인다', () => {
  const walk = poseOf({ walk: Math.PI / 2, speed: 1, attack: -1, swing: 'slash', windup: -1, hurt: 0, dash: false, time: 0 });
  assert.ok(walk.legL > 0.5 && walk.legR < -0.5);
  const still = poseOf({ walk: Math.PI / 2, speed: 0, attack: -1, swing: 'slash', windup: -1, hurt: 0, dash: false, time: 0 });
  assert.equal(still.legL, 0);
  const dash = poseOf({ walk: 0, speed: 1, attack: -1, swing: 'slash', windup: -1, hurt: 0, dash: true, time: 0 });
  assert.ok(dash.lean > 0.4);
  const hurt = poseOf({ walk: 0, speed: 0, attack: -1, swing: 'slash', windup: -1, hurt: 1, dash: false, time: 0 });
  assert.ok(hurt.lean < 0);
  const windup = poseOf({ walk: 0, speed: 0, attack: -1, swing: 'slash', windup: 1, hurt: 0, dash: false, time: 0 });
  assert.ok(windup.armR < -1, '준비하는 동안 무기를 크게 뒤로 당긴다(읽을 수 있게)');
  for (const swing of ['slash', 'thrust', 'smash', 'shoot', 'spin']) {
    const p = poseOf({ walk: 0, speed: 0, attack: 0.2, swing, windup: -1, hurt: 0, dash: false, time: 0 });
    for (const v of Object.values(p)) assert.ok(Number.isFinite(v), swing);
  }
});

test('처치된 몸: 맞은 방향으로 날아가며 솟았다가 바닥에 떨어지고, 바닥 아래로 내려가지 않는다', () => {
  const c = { vx: 4, vy: -2, up: 4.5, gravity: 16, spin: 9 };
  const mid = corpseAt(c, 0.14);
  assert.ok(mid.h > 0.3 && mid.dx > 0 && mid.dz < 0);
  const end = corpseAt(c, 0.6);
  assert.equal(end.h, 0);
  assert.ok(end.dx > mid.dx, '땅에 닿은 뒤에도 조금 미끄러진다');
});

test('축복의 기운: 계열마다 축복 두 개에 구슬 하나(최대 셋), 합성 축복은 두 계열을 다 세고, 축복이 쌓이면 발밑 고리가 는다', async () => {
  const { auraPlan } = await import('../../src/render/entities/aura-plan.js');
  const { BOONS } = await import('../../data/boons.js');
  const { FEEL } = await import('../../data/feel.js');
  const A = FEEL.aura;
  const empty = auraPlan([], BOONS, A);
  assert.deepEqual(empty.orbs, []);
  assert.equal(empty.rings, 0);
  assert.equal(empty.dominant, 'none');
  const of = (family) => Object.keys(BOONS).filter((id) => BOONS[id].family === family && !BOONS[id].duo);
  const fire = of('fire');
  const one = auraPlan(fire.slice(0, 1), BOONS, A);
  assert.equal(one.orbs.length, 1, '하나만 있어도 구슬 하나');
  assert.equal(one.dominant, 'fire');
  const many = auraPlan(fire, BOONS, A);
  assert.equal(many.orbs.filter((o) => o.family === 'fire').length, A.maxOrbs, '최대 수를 넘지 않는다');
  const duo = Object.keys(BOONS).find((id) => Array.isArray(BOONS[id].duo));
  const mixed = auraPlan([duo], BOONS, A);
  assert.deepEqual(Object.values(mixed.counts).filter((n) => n > 0).length, 2, '합성 축복은 두 계열');
  const all = Object.keys(BOONS);
  assert.equal(auraPlan(all.slice(0, A.ringsAt[0] - 1), BOONS, A).rings, 0);
  assert.equal(auraPlan(all.slice(0, A.ringsAt[0]), BOONS, A).rings, 1);
  assert.equal(auraPlan(all, BOONS, A).rings, A.ringsAt.length);
  assert.deepEqual(auraPlan(['없는 축복'], BOONS, A).orbs, [], '모르는 이름은 무시한다');
});
