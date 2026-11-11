import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PHASE } from '../../../src/logic/core/state.js';
import { createGame, enterFloor, setPhase } from '../../../src/logic/game.js';
import { validateRunCore, validateRunState } from '../../../src/logic/save/validate.js';
import { createReport, int, list, record, shape } from '../../../src/logic/save/schema.js';
import { findSharedObject, mutateRandom } from '../../../scripts/lib/save-sim.js';
import { Rng, play, sampleGame } from '../../helpers/save.js';

test('검증기: 실제로 플레이하는 동안 매 순간 통과하고, 상태 안에 공유·동결 객체가 없다', () => {
  // 오탐은 곧 "저장 실패"다. 봇이 판을 끝까지 돌며(무작위 조작·명령을 섞어) 방 전투·축복·상점·보스전을 모두 거친다.
  let checked = 0;
  let hazards = 0;
  let encounters = 0;
  for (const [seed, character, meta] of [['validate-live-a', 'knight'], ['validate-live-b', 'mage', { version: 2, souls: 0, upgrades: {}, characters: { mage: true } }], ['validate-live-c', 'knight']]) {
    const game = createGame({ seed, meta, character });
    enterFloor(game, 1);
    setPhase(game, PHASE.PLAYING);
    play(game, Rng.fromSeed(`validate-live:${seed}`), 30000, {
      onTick: (t) => {
        if (t % 7 !== 0 || game.state.run.ended) return;
        assert.deepEqual(validateRunState(game.state), [], `${seed} ${t}틱`);
        assert.equal(findSharedObject(game.state), null, `${seed} ${t}틱`);
        if (game.state.hazards.length > 0) hazards++;
        if (game.state.encounter) encounters++;
        checked++;
      },
    });
  }
  assert.ok(checked > 2000, `확인한 순간 ${checked}`);
  assert.ok(hazards > 50, `장판이 있던 순간 ${hazards}`);
  assert.ok(encounters > 1000, `전투 중이던 순간 ${encounters}`);
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
  for (const junk of [null, undefined, 0, -1, '', 'state', true, [], [{}], {}, { version: 5 }, Object.create(null), new Date(0)]) {
    assert.doesNotThrow(() => validateRunState(junk));
    assert.ok(validateRunState(junk).length > 0);
  }
  // 실제 상태를 무작위로 망가뜨린 것 2,000개.
  const base = JSON.parse(JSON.stringify(sampleGame({ seed: 'validate-junk' }).state));
  const rng = Rng.fromSeed('validate-junk');
  for (let i = 0; i < 2000; i++) {
    const data = structuredClone(base);
    for (let k = rng.int(1, 4); k > 0; k--) mutateRandom(data, rng);
    assert.doesNotThrow(() => validateRunState(data), `${i}번째`);
  }
});

test('검증기: 문제 목록은 길어도 40개까지만 적는다', () => {
  const state = JSON.parse(JSON.stringify(sampleGame({ seed: 'validate-many' }).state));
  for (let i = 0; i < 200; i++) state.drops.push({ kind: 'bomb' });
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
