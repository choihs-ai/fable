import assert from 'node:assert/strict';
import { test } from 'node:test';

import { WORLD } from '../../../data/world.js';
import { ZONES } from '../../../data/zones.js';
import { FLOOR_KIND, TOTAL_FLOORS, floorPlan } from '../../../src/logic/world/floors.js';

test('전체 30층 이상, 구역 6개, 5층마다 구역이 바뀐다', () => {
  assert.ok(TOTAL_FLOORS >= 30, `전체 층 수 ${TOTAL_FLOORS}`);
  assert.equal(ZONES.length, 6);
  assert.equal(WORLD.floorsPerZone, 5);

  for (let floor = 1; floor <= TOTAL_FLOORS; floor++) {
    const plan = floorPlan(floor);
    assert.equal(plan.zoneIndex, Math.floor((floor - 1) / 5), `${floor}층`);
    assert.equal(plan.zone, ZONES[plan.zoneIndex]);
    assert.equal(plan.floorInZone, ((floor - 1) % 5) + 1);
  }
  assert.notEqual(floorPlan(5).zone.id, floorPlan(6).zone.id);
  assert.equal(floorPlan(6).zone.id, floorPlan(10).zone.id);
});

test('보스층: 중간보스는 구역 3곳의 마지막 층, 최종보스는 마지막 층', () => {
  const kinds = [];
  for (let floor = 1; floor <= TOTAL_FLOORS; floor++) kinds.push(floorPlan(floor).kind);

  const mid = kinds.flatMap((k, i) => (k === FLOOR_KIND.MID_BOSS ? [i + 1] : []));
  const final = kinds.flatMap((k, i) => (k === FLOOR_KIND.FINAL_BOSS ? [i + 1] : []));
  assert.equal(mid.length, 3);
  assert.ok(mid.every((floor) => floor % WORLD.floorsPerZone === 0), `중간보스층 ${mid}`);
  assert.deepEqual(final, [TOTAL_FLOORS]);
  assert.equal(kinds.filter((k) => k === FLOOR_KIND.NORMAL).length, TOTAL_FLOORS - 4);
});

test('floorPlan 은 범위를 벗어난 층을 거부한다', () => {
  for (const bad of [0, -1, TOTAL_FLOORS + 1, 1.5, NaN, '3', undefined, null]) {
    assert.throws(() => floorPlan(bad), RangeError, `층: ${String(bad)}`);
  }
});

test('구역 데이터: 타일셋·적 풀·색감이 있고 값이 유효하다', () => {
  const ids = new Set();
  for (const zone of ZONES) {
    assert.ok(!ids.has(zone.id), `구역 id 중복: ${zone.id}`);
    ids.add(zone.id);
    assert.ok(typeof zone.name === 'string' && zone.name.length > 0);
    assert.ok(Number.isInteger(zone.size.w) && Number.isInteger(zone.size.h) && zone.size.w >= 30 && zone.size.h >= 30);

    for (const key of ['floor', 'wall', 'stairs']) assert.equal(typeof zone.tileset[key], 'string', `${zone.id}.tileset.${key}`);
    assert.ok(Array.isArray(zone.tileset.props) && zone.tileset.props.length > 0);
    for (const key of ['floor', 'wall', 'accent', 'fog', 'ambient']) {
      const color = zone.palette[key];
      assert.ok(Number.isInteger(color) && color >= 0 && color <= 0xffffff, `${zone.id}.palette.${key}`);
    }

    assert.ok(zone.enemies.length >= 2, `${zone.id} 적 풀`);
    assert.equal(new Set(zone.enemies.map((e) => e.id)).size, zone.enemies.length, `${zone.id} 적 id 중복`);
    for (const enemy of zone.enemies) assert.ok(typeof enemy.id === 'string' && enemy.weight > 0);
    for (const range of [zone.enemyCount, zone.itemCount]) {
      assert.ok(Number.isInteger(range[0]) && Number.isInteger(range[1]) && range[0] >= 1 && range[0] <= range[1]);
    }

    assert.deepEqual(Object.keys(zone.algorithms).sort(), ['cave', 'rooms']);
    assert.ok(zone.algorithms.rooms > 0 && zone.algorithms.cave > 0);
    if (zone.boss) {
      assert.ok(['mid', 'final'].includes(zone.boss.kind));
      assert.equal(typeof zone.boss.id, 'string');
    }
  }
});

test('구역마다 타일셋·색감·알고리즘 비율이 서로 다르다', () => {
  const distinct = (values) => new Set(values.map((v) => JSON.stringify(v))).size;
  assert.equal(distinct(ZONES.map((z) => z.tileset)), ZONES.length);
  assert.equal(distinct(ZONES.map((z) => z.palette)), ZONES.length);
  assert.equal(distinct(ZONES.map((z) => z.enemies)), ZONES.length);
  assert.equal(distinct(ZONES.map((z) => z.algorithms.rooms / (z.algorithms.rooms + z.algorithms.cave))), ZONES.length);
});

test('설정 데이터는 동결되어 있다', () => {
  assert.ok(Object.isFrozen(ZONES) && Object.isFrozen(ZONES[0]) && Object.isFrozen(ZONES[0].enemies[0]));
  assert.ok(Object.isFrozen(WORLD) && Object.isFrozen(WORLD.placement) && Object.isFrozen(WORLD.boss.mid.entry));
  assert.throws(() => {
    'use strict';
    ZONES[0].size.w = 1;
  }, TypeError);
});
