import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PHASE } from '../../../src/logic/core/state.js';
import { createGame, enterFloor, setPhase } from '../../../src/logic/game.js';
import { validateRunCore, validateRunState } from '../../../src/logic/save/validate.js';
import { createReport, int, list, record, shape } from '../../../src/logic/save/schema.js';
import { findSharedObject, floorGames, mutateRandom } from '../../../scripts/lib/save-sim.js';
import { Rng, play, sampleGame } from '../../helpers/save.js';

test('검증기: 실제로 교전 중인 상태는 매 순간 통과하고, 상태 안에 공유·동결 객체가 없다', () => {
  // 오탐은 곧 "저장 실패"다. 층의 적을 모두 깨워 장판·투사체·상태이상이 생기는 교전을 만든다.
  // (이 검사로 찾은 것: 맵 밖에 깔린 보스 장판, 상점에서 산 장비의 번호 겹침, 설정 객체를 그대로 가리키는 status)
  let checked = 0;
  let hazards = 0;
  for (const { game, floor } of floorGames({ seed: 'validate-live', floors: (f) => f % 3 === 0 || f === 5 || f === 25 })) {
    for (const actor of Object.values(game.state.entities.byId)) {
      if (actor.ai) actor.ai.provoked = true;
    }
    const rng = Rng.fromSeed(`validate-live:${floor}`);
    play(game, rng, 900, {
      onTick: (t) => {
        if (t % 9 !== 0 || game.state.run.ended) return;
        assert.deepEqual(validateRunState(game.state), [], `${floor}층 ${t}틱`);
        assert.equal(findSharedObject(game.state), null, `${floor}층 ${t}틱`);
        if (game.state.hazards.length > 0) hazards++;
        checked++;
      },
    });
  }
  assert.ok(checked > 800, `확인한 순간 ${checked}`);
  assert.ok(hazards > 10, `장판이 있던 순간 ${hazards}`);
});

test('검증기: 막 시작한 런(1층 진입 직후)과 일시정지 중인 런도 통과한다', () => {
  const game = createGame({ seed: '새 런' });
  enterFloor(game, 1);
  setPhase(game, PHASE.PLAYING);
  assert.deepEqual(validateRunState(game.state), []);
  setPhase(game, PHASE.PAUSED);
  assert.deepEqual(validateRunState(game.state), []);
});

test('검증기: 층에 들어가기 전 상태는 핵심만 통과한다', () => {
  const game = createGame({ seed: 'x' });
  assert.deepEqual(validateRunCore(game.state), []);
  assert.ok(validateRunState(game.state).some((p) => p.startsWith('world')));
});

test('검증기: 어떤 값을 받아도 예외를 던지지 않는다', () => {
  for (const junk of [null, undefined, 0, -1, '', 'state', true, [], [{}], {}, { version: 4 }, Object.create(null), new Date(0)]) {
    assert.doesNotThrow(() => validateRunState(junk));
    assert.ok(validateRunState(junk).length > 0);
  }
  // 실제 상태를 무작위로 망가뜨린 것 2,000개.
  const base = JSON.parse(JSON.stringify(sampleGame({ floor: 15, ticks: 200 }).state));
  const rng = Rng.fromSeed('validate-junk');
  for (let i = 0; i < 2000; i++) {
    const data = structuredClone(base);
    for (let k = rng.int(1, 4); k > 0; k--) mutateRandom(data, rng);
    assert.doesNotThrow(() => validateRunState(data), `${i}번째`);
  }
});

test('검증기: 문제 목록은 길어도 40개까지만 적는다', () => {
  const state = JSON.parse(JSON.stringify(sampleGame({ floor: 9, ticks: 60 }).state));
  for (let i = 0; i < 200; i++) state.inventory.bag.push({ kind: 'equipment' });
  state.inventory.capacity = 1000;
  const problems = validateRunState(state);
  assert.equal(problems.length, 40);
});

test('검증 도구: 필드가 없음·모르는 필드·물려받은 이름을 구분한다', () => {
  const check = shape({ a: int(0, 9) }, { b: int(0, 9) });
  const run = (value) => {
    const r = createReport();
    check(r, value, 'x');
    return r.problems;
  };
  assert.deepEqual(run({ a: 1 }), []);
  assert.deepEqual(run({ a: 1, b: 2 }), []);
  assert.deepEqual(run({}), ['x.a: 없음']);
  assert.deepEqual(run({ a: 1, c: 1 }), ['x.c: 알 수 없는 필드']);
  assert.deepEqual(run(Object.create({ a: 1 })), ['x.a: 없음'], '물려받은 필드는 없는 것으로 본다');
  assert.equal(run({ a: 1.5 }).length, 1);
  assert.equal(run({ a: '1' }).length, 1);
  assert.equal(run([1]).length, 1);

  const r = createReport();
  record((key) => key === 'ok', int(0, 1), 2)(r, { ok: 1, constructor: 1 }, 'y');
  assert.deepEqual(r.problems, ['y.constructor: 알 수 없는 이름']);
  const r2 = createReport();
  list(int(0, 1), 2)(r2, [0, 1, 1], 'z');
  assert.equal(r2.problems.length, 1);
});
