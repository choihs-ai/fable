import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EVENTS } from '../../../src/logic/core/events.js';
import { Rng } from '../../../src/logic/core/prng.js';
import { PHASE, RNG_STREAMS, STATE_VERSION, createInitialState, rngOf } from '../../../src/logic/core/state.js';
import { createGame, setPhase, tick } from '../../../src/logic/game.js';

const DT = 1 / 60;

test('초기 상태의 기본 구조', () => {
  const state = createInitialState({ seed: 'abc' });

  assert.equal(state.version, STATE_VERSION);
  assert.equal(state.seed, 'abc');
  assert.equal(state.tick, 0);
  assert.equal(state.phase, PHASE.TITLE);
  assert.deepEqual(Object.keys(state.rng), [...RNG_STREAMS]);
  assert.equal(state.run.floor, 1);
  assert.equal(state.run.character, 'knight');
  assert.deepEqual([state.run.gold, state.run.kills, state.run.roomsCleared, state.run.depth], [0, 0, 0, 0]);
  assert.deepEqual([state.run.boons, state.run.choice], [[], null]);
  assert.deepEqual([state.meta, state.shop, state.encounter, state.drops], [null, null, null, []]);
  assert.equal(state.world, null);
  assert.deepEqual(state.entities, { nextId: 1, byId: {} });
  assert.equal(state.playerId, null);
});

test('같은 시드는 같은 초기 상태를, 다른 시드는 다른 난수 상태를 만든다', () => {
  assert.deepEqual(createInitialState({ seed: 'abc' }), createInitialState({ seed: 'abc' }));
  assert.notDeepEqual(createInitialState({ seed: 'abc' }).rng, createInitialState({ seed: 'abd' }).rng);
});

test('숫자 시드는 문자열로 정규화되어 같은 상태가 된다', () => {
  assert.deepEqual(createInitialState({ seed: 42 }), createInitialState({ seed: '42' }));
});

test('상태는 JSON 왕복 후에도 동일하다(직렬화 가능한 평범한 객체)', () => {
  const state = createInitialState({ seed: 'abc' });
  rngOf(state, 'combat').int(1, 6);

  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
});

test('rngOf 스트림은 서로 다른 수열이고 루트 시드의 fork 와 일치한다', () => {
  const state = createInitialState({ seed: 'abc' });
  const firsts = RNG_STREAMS.map((name) => rngOf(state, name).nextUint32());

  assert.equal(new Set(firsts).size, RNG_STREAMS.length);
  assert.equal(firsts[0], Rng.fromSeed('abc').fork(RNG_STREAMS[0]).nextUint32());
});

test('rngOf 로 뽑으면 상태 안의 난수 위치가 전진한다', () => {
  const state = createInitialState({ seed: 'abc' });
  const reference = Rng.fromSeed('abc').fork('combat');
  const expected = [reference.nextUint32(), reference.nextUint32(), reference.nextUint32()];

  const actual = [
    rngOf(state, 'combat').nextUint32(),
    rngOf(state, 'combat').nextUint32(),
    rngOf(state, 'combat').nextUint32(),
  ];

  assert.deepEqual(actual, expected);
});

test('한 스트림을 소비해도 다른 스트림은 영향받지 않는다', () => {
  const a = createInitialState({ seed: 'abc' });
  const b = createInitialState({ seed: 'abc' });
  for (let i = 0; i < 100; i++) rngOf(a, 'combat').nextUint32();

  assert.equal(rngOf(a, 'world').nextUint32(), rngOf(b, 'world').nextUint32());
  assert.equal(rngOf(a, 'items').nextUint32(), rngOf(b, 'items').nextUint32());
});

test('세이브/로드(JSON 왕복) 뒤에도 난수 수열이 끊기지 않고 이어진다', () => {
  const state = createInitialState({ seed: 'abc' });
  for (let i = 0; i < 5; i++) rngOf(state, 'items').nextUint32();

  const loaded = JSON.parse(JSON.stringify(state));
  const expected = [rngOf(state, 'items').nextUint32(), rngOf(state, 'items').nextUint32()];
  const actual = [rngOf(loaded, 'items').nextUint32(), rngOf(loaded, 'items').nextUint32()];

  assert.deepEqual(actual, expected);
});

test('rngOf 는 알 수 없는 스트림을 거부한다', () => {
  const state = createInitialState({ seed: 'abc' });
  assert.throws(() => rngOf(state, 'nope'), RangeError);
});

test('잘못된 시드는 거부한다', () => {
  for (const bad of [undefined, null, NaN, Infinity, {}, true]) {
    assert.throws(() => createInitialState({ seed: bad }), TypeError, `시드: ${String(bad)}`);
  }
});

test('tick 은 PLAYING 일 때만 틱을 올린다', () => {
  const game = createGame({ seed: 'abc' });

  tick(game, DT);
  assert.equal(game.state.tick, 0);

  setPhase(game, PHASE.PLAYING);
  tick(game, DT);
  tick(game, DT);
  assert.equal(game.state.tick, 2);

  setPhase(game, PHASE.PAUSED);
  tick(game, DT);
  assert.equal(game.state.tick, 2);
});

test('setPhase 는 바뀔 때만 PHASE_CHANGED 를 발행한다', () => {
  const game = createGame({ seed: 'abc' });
  const events = [];
  game.bus.on(EVENTS.PHASE_CHANGED, (payload) => events.push(payload));

  setPhase(game, PHASE.PLAYING);
  setPhase(game, PHASE.PLAYING);
  setPhase(game, PHASE.GAME_OVER);

  assert.deepEqual(events, [
    { from: PHASE.TITLE, to: PHASE.PLAYING },
    { from: PHASE.PLAYING, to: PHASE.GAME_OVER },
  ]);
  assert.throws(() => setPhase(game, 'nope'), RangeError);
});

test('같은 시드로 같은 틱 수를 돌리면 상태가 완전히 같다', () => {
  const run = () => {
    const game = createGame({ seed: 'determinism' });
    setPhase(game, PHASE.PLAYING);
    for (let i = 0; i < 600; i++) tick(game, DT);
    return game.state;
  };

  assert.deepEqual(run(), run());
});
