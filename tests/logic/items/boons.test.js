import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BOONS, BOON_RULES } from '../../../data/boons.js';
import { Rng } from '../../../src/logic/core/prng.js';
import { eligibleBoons, familiesOf, rerollCost, rollBoonChoices } from '../../../src/logic/items/boons.js';

const duos = Object.keys(BOONS).filter((id) => BOONS[id].duo);

test('합성 축복은 두 계열의 축복을 하나씩 가지고 있어야 후보가 된다', () => {
  assert.ok(duos.every((id) => !eligibleBoons([]).includes(id)));
  assert.ok(!eligibleBoons(['ignite']).includes('steam'), '한 계열만으로는 안 된다');
  assert.ok(eligibleBoons(['ignite', 'frost_shot']).includes('steam'));
  assert.ok(!eligibleBoons(['ignite', 'frost_shot']).includes('plasma'));
  assert.deepEqual([...familiesOf(['ignite', 'chain', 'pierce', 'nope'])].sort(), ['bolt', 'fire']);
  const all = eligibleBoons(['ignite', 'chain', 'frost_shot']);
  for (const id of duos) assert.ok(all.includes(id), id);
});

test('후보는 셋이고 겹치지 않으며, 가진 축복은 나오지 않는다. 같은 난수면 같은 후보', () => {
  const owned = ['chain', 'pierce'];
  for (let n = 0; n < 200; n++) {
    const picked = rollBoonChoices(Rng.fromSeed(`roll-${n}`), owned);
    assert.equal(picked.length, BOON_RULES.choices);
    assert.equal(new Set(picked).size, picked.length);
    for (const id of picked) {
      assert.ok(BOONS[id] && !owned.includes(id), id);
      assert.ok(!BOONS[id].duo, '재료가 없는 합성 축복은 나오지 않는다');
    }
  }
  assert.deepEqual(rollBoonChoices(Rng.fromSeed('same'), owned), rollBoonChoices(Rng.fromSeed('same'), owned));
});

test('가중치가 높은 축복이 더 자주 나오고, 모든 축복이 나올 수 있다', () => {
  const seen = {};
  for (let n = 0; n < 3000; n++) {
    for (const id of rollBoonChoices(Rng.fromSeed(`freq-${n}`), ['ignite', 'chain', 'frost_shot'])) seen[id] = (seen[id] ?? 0) + 1;
  }
  for (const id of Object.keys(BOONS)) {
    if (['ignite', 'chain', 'frost_shot'].includes(id)) continue;
    assert.ok(seen[id] > 0, `${id} 가 한 번도 나오지 않음`);
  }
  assert.ok(seen.pierce > seen.second_wind * 1.5, `가중치 3(${seen.pierce}) > 가중치 1(${seen.second_wind})`);
});

test('남은 축복이 셋보다 적으면 있는 만큼만, 하나도 없으면 빈 목록', () => {
  const all = Object.keys(BOONS);
  assert.deepEqual(rollBoonChoices(Rng.fromSeed('x'), all), []);
  const left = rollBoonChoices(Rng.fromSeed('x'), all.slice(2));
  assert.deepEqual(left.slice().sort(), all.slice(0, 2).sort());
});

test('다시 뽑기는 방금 본 후보를 피하고, 값은 뽑을 때마다 오른다', () => {
  const first = rollBoonChoices(Rng.fromSeed('avoid'), []);
  for (let n = 0; n < 50; n++) {
    const again = rollBoonChoices(Rng.fromSeed(`avoid-${n}`), [], first);
    assert.ok(again.every((id) => !first.includes(id)));
  }
  assert.equal(rerollCost(0), BOON_RULES.reroll.base);
  assert.equal(rerollCost(2), BOON_RULES.reroll.base + 2 * BOON_RULES.reroll.step);
});
