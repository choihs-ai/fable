import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ENCOUNTERS } from '../../../data/encounters.js';
import { WORLD } from '../../../data/world.js';
import { ZONES } from '../../../data/zones.js';
import { enemyDef, isBossType } from '../../../src/logic/entities/defs.js';
import { FLOOR_KIND, REWARD, ROOM_KIND, TOTAL_FLOORS, floorPlan, isFightRoom } from '../../../src/logic/world/floors.js';

test('맛보기 판은 1구역 1층이고, 층마다 구역이 순서대로 쓰인다', () => {
  assert.equal(TOTAL_FLOORS, WORLD.stages);
  assert.equal(TOTAL_FLOORS, 1);
  const plan = floorPlan(1);
  assert.deepEqual({ floor: plan.floor, zoneIndex: plan.zoneIndex, kind: plan.kind }, { floor: 1, zoneIndex: 0, kind: FLOOR_KIND.STAGE });
  assert.equal(plan.zone, ZONES[0]);
});

test('floorPlan 은 범위를 벗어난 층을 거부한다', () => {
  for (const bad of [0, -1, TOTAL_FLOORS + 1, 1.5, '1', null, undefined, NaN]) {
    assert.throws(() => floorPlan(bad), RangeError, `${bad}`);
  }
});

test('방의 종류: 시작·전투·정예·보상·상점·보스·출구·숨은 방. 적이 나오는 것은 전투·정예·보스', () => {
  assert.deepEqual(Object.values(ROOM_KIND).sort(), ['bonus', 'boss', 'combat', 'elite', 'exit', 'reward', 'shop', 'start']);
  assert.deepEqual(Object.values(ROOM_KIND).filter(isFightRoom).sort(), ['boss', 'combat', 'elite']);
  assert.deepEqual(Object.values(REWARD).sort(), ['boon', 'gold', 'health', 'weapon']);
  assert.deepEqual(Object.keys(ENCOUNTERS.rewards.weights).sort(), Object.values(REWARD).sort());
});

test('첫 구역 데이터: 적 풀의 적이 모두 정의돼 있고, 웨이브 예산으로 뽑을 수 있다', () => {
  const zone = ZONES[0];
  assert.ok(zone.id && zone.name);
  assert.ok(zone.enemies.length >= 4);
  for (const e of zone.enemies) {
    assert.ok(enemyDef(e.id) && !isBossType(e.id), e.id);
    assert.ok(e.weight > 0 && Number.isInteger(e.cost) && e.cost >= 1 && Number.isInteger(e.minDepth) && e.minDepth >= 0, e.id);
    assert.ok(e.cost <= ENCOUNTERS.budget.base, `${e.id}: 가장 작은 예산으로도 뽑을 수 있다`);
  }
  assert.ok(zone.enemies.some((e) => e.minDepth === 0), '첫 방부터 나올 적이 있다');
  assert.ok(zone.enemies.some((e) => e.minDepth === 0 && e.cost >= 2), '깊이 0 의 정예방에도 정예로 뽑을 적이 있다');
  assert.ok(new Set(zone.enemies.map((e) => enemyDef(e.id).ai)).size >= 3, '행동 방식이 셋 이상');
  assert.ok(zone.enemies.some((e) => enemyDef(e.id).ai === 'ranged'), '탄을 쏘는 적이 있다');
  assert.ok(isBossType(zone.boss.id));
  for (const key of ['floor', 'wall', 'accent', 'fog', 'ambient']) assert.ok(Number.isInteger(zone.palette[key]), `palette.${key}`);
});

test('맵 생성 수치: 전투방은 최소 11×9, 방은 8~12개, 웨이브는 2~3회', () => {
  assert.ok(WORLD.layout.roomMinW >= 11 && WORLD.layout.roomMinH >= 9);
  assert.ok(WORLD.layout.roomMinW % 2 === 1 && WORLD.layout.roomMinH % 2 === 1, '홀수(가운데 칸이 있다)');
  assert.ok(WORLD.layout.minLeafW >= WORLD.layout.roomMinW + 2 && WORLD.layout.minLeafH >= WORLD.layout.roomMinH + 2);
  assert.deepEqual(WORLD.roomCount, [8, 12]);
  assert.ok(WORLD.layout.maxGap <= 10, '복도는 짧다');
  for (const range of [ENCOUNTERS.waves.shallow, ENCOUNTERS.waves.deep, ENCOUNTERS.elite.waves]) {
    assert.ok(range[0] >= 2 && range[1] <= 3 && range[0] <= range[1], `웨이브 ${range}`);
  }
  assert.ok(WORLD.boss.bandH >= 1 + WORLD.boss.exit.h + WORLD.boss.exitGap + WORLD.boss.arenaH[1] + 2, '보스 구역에 결투장과 출구 방이 들어간다');
});

test('설정 데이터는 동결되어 있다', () => {
  assert.ok(Object.isFrozen(WORLD) && Object.isFrozen(WORLD.layout) && Object.isFrozen(WORLD.rules));
  assert.ok(Object.isFrozen(ENCOUNTERS) && Object.isFrozen(ENCOUNTERS.rewards.weights));
  assert.ok(Object.isFrozen(ZONES) && Object.isFrozen(ZONES[0].enemies[0]));
  assert.throws(() => {
    'use strict';
    WORLD.maxAttempts = 1;
  }, TypeError);
});
