// 진행 시뮬레이션의 축소판. 전체 검증은 scripts/verify-items.mjs.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { UNLOCKS } from '../../../data/meta.js';
import { TOTAL_FLOORS } from '../../../src/logic/world/floors.js';
import { checkItem, checkState, expectedRange } from '../../../scripts/lib/item-checks.js';
import { enemyStrength, effectiveHp, playerDps, simulateRun } from '../../../scripts/lib/progress-sim.js';

const ALL = { unlocked: Object.fromEntries(Object.keys(UNLOCKS).map((id) => [id, true])) };

test('진행 시뮬레이션: 30층을 도는 동안 아이템·성장 불변식이 한 번도 깨지지 않는다', () => {
  for (let n = 0; n < 12; n++) {
    const run = simulateRun({ seed: `t-progress-${n}`, meta: n % 3 === 0 ? ALL : undefined });
    assert.deepEqual(run.violations, [], `시드 "t-progress-${n}"`);
    assert.equal(run.floors.length, TOTAL_FLOORS);
    assert.deepEqual(checkState(run.state), []);
    const last = run.floors[run.floors.length - 1];
    assert.ok(last.level >= 12 && last.level <= 35, `30층 도달 레벨 ${last.level}`);
    assert.ok(last.sheet.power > 60, `30층 공격력 +${last.sheet.power}%`);
    assert.ok(last.maxHp > 180);
  }
});

test('진행 시뮬레이션은 같은 시드면 같은 결과를 낸다', () => {
  const a = simulateRun({ seed: 't-progress-same', floors: 12 });
  const b = simulateRun({ seed: 't-progress-same', floors: 12 });
  assert.deepEqual(a.state, b.state);
  assert.notDeepEqual(simulateRun({ seed: 't-progress-other', floors: 12 }).state.inventory, a.state.inventory);
});

test('전투력 곡선: 일반 층끼리 위협도가 급변하지 않는다(표본이 작아 기준은 느슨하게)', () => {
  const runs = [];
  for (let n = 0; n < 40; n++) runs.push(simulateRun({ seed: `t-curve-${n}` }).floors);
  let prev = null;
  for (let floor = 1; floor <= TOTAL_FLOORS; floor++) {
    const enemy = enemyStrength(floor);
    if (enemy.boss) continue;
    const snaps = runs.map((r) => r[floor - 1]);
    const avg = (fn) => snaps.reduce((a, s) => a + fn(s), 0) / snaps.length;
    const threat = enemy.hp / avg((s) => playerDps(s.sheet)) / (avg((s) => effectiveHp(s.maxHp, s.armor)) / enemy.dps);
    assert.ok(threat > 0.04 && threat < 0.2, `${floor}층 위협 ${threat.toFixed(3)}`);
    if (prev) assert.ok(Math.abs(threat / prev.threat - 1) < 0.2, `${prev.floor}층 → ${floor}층: 위협 ${prev.threat.toFixed(3)} → ${threat.toFixed(3)}`);
    prev = { floor, threat };
  }
});

test('검사 도구: 규칙을 어긴 장비를 실제로 잡아낸다', () => {
  const good = {
    kind: 'equipment', uid: 7, base: 'blade', slot: 'weapon', rarity: 'rare', ilvl: 5, setId: null,
    implicit: [{ stat: 'power', value: expectedRange({ min: 8, max: 12, growth: 0.11 }, 'rare', 5)[0] }],
    affixes: [{ stat: 'critChance', value: 3 }, { stat: 'haste', value: 3 }],
  };
  assert.deepEqual(checkItem(good), []);
  const broken = (change) => checkItem({ ...structuredClone(good), ...change }).join(' | ');
  assert.match(broken({ implicit: [{ stat: 'power', value: 999 }] }), /범위/);
  assert.match(broken({ affixes: [{ stat: 'critChance', value: 3 }, { stat: 'critChance', value: 3 }] }), /중복/);
  assert.match(broken({ affixes: [{ stat: 'critChance', value: 3 }] }), /옵션 수/);
  assert.match(broken({ affixes: [{ stat: 'critChance', value: 3 }, { stat: 'armor', value: 1 }] }), /붙을 수 없는/);
  assert.match(broken({ affixes: [{ stat: 'critChance', value: 0 }, { stat: 'haste', value: 3 }] }), /범위/);
  assert.match(broken({ slot: 'boots' }), /부위/);
  assert.match(broken({ setId: 'ember' }), /세트/);
  assert.match(broken({ rarity: 'common' }), /옵션 수/);
});
