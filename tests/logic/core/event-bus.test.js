import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EventBus } from '../../../src/logic/core/event-bus.js';

test('emit 은 등록 순서대로 리스너를 부르고 payload 와 이벤트 이름을 넘긴다', () => {
  const bus = new EventBus();
  const calls = [];
  bus.on('hit', (payload, type) => calls.push(['a', payload, type]));
  bus.on('hit', (payload, type) => calls.push(['b', payload, type]));
  const payload = { damage: 3 };

  const called = bus.emit('hit', payload);

  assert.equal(called, 2);
  assert.deepEqual(calls, [
    ['a', payload, 'hit'],
    ['b', payload, 'hit'],
  ]);
});

test('다른 이벤트의 리스너는 호출되지 않고, 리스너가 없으면 0 을 돌려준다', () => {
  const bus = new EventBus();
  let count = 0;
  bus.on('a', () => count++);

  assert.equal(bus.emit('b'), 0);
  assert.equal(count, 0);
});

test('on 이 돌려준 함수로 해제하며, 두 번 불러도 안전하다', () => {
  const bus = new EventBus();
  let count = 0;
  const off = bus.on('a', () => count++);
  bus.on('a', () => count++);

  off();
  off();
  bus.emit('a');

  assert.equal(count, 1);
  assert.equal(bus.listenerCount('a'), 1);
});

test('같은 함수를 두 번 등록하면 두 번 호출되고 각각 따로 해제된다', () => {
  const bus = new EventBus();
  let count = 0;
  const listener = () => count++;
  const off1 = bus.on('a', listener);
  bus.on('a', listener);

  bus.emit('a');
  assert.equal(count, 2);

  off1();
  bus.emit('a');
  assert.equal(count, 3);
});

test('once 리스너는 한 번만 호출된다', () => {
  const bus = new EventBus();
  const seen = [];
  bus.once('a', (payload) => seen.push(payload));

  bus.emit('a', 1);
  bus.emit('a', 2);

  assert.deepEqual(seen, [1]);
  assert.equal(bus.listenerCount('a'), 0);
});

test('once 리스너는 호출 전에 해제할 수 있다', () => {
  const bus = new EventBus();
  let count = 0;
  const off = bus.once('a', () => count++);

  off();
  bus.emit('a');

  assert.equal(count, 0);
});

test('emit 도중 등록한 리스너는 그 emit 에서는 호출되지 않는다', () => {
  const bus = new EventBus();
  const calls = [];
  bus.on('a', () => {
    calls.push('first');
    bus.on('a', () => calls.push('late'));
  });

  bus.emit('a');
  assert.deepEqual(calls, ['first']);

  bus.emit('a');
  assert.deepEqual(calls, ['first', 'first', 'late']);
});

test('emit 도중 해제된 리스너는 그 emit 에서도 호출되지 않는다', () => {
  const bus = new EventBus();
  const calls = [];
  let offSecond;
  bus.on('a', () => {
    calls.push('first');
    offSecond();
  });
  offSecond = bus.on('a', () => calls.push('second'));
  bus.on('a', () => calls.push('third'));

  bus.emit('a');

  assert.deepEqual(calls, ['first', 'third']);
});

test('리스너 안에서 다시 emit 해도 동작한다', () => {
  const bus = new EventBus();
  const calls = [];
  bus.on('a', () => {
    calls.push('a');
    bus.emit('b');
  });
  bus.on('b', () => calls.push('b'));

  bus.emit('a');

  assert.deepEqual(calls, ['a', 'b']);
});

test('리스너가 예외를 던져도 나머지 리스너는 호출되고, emit 이 끝난 뒤 예외를 다시 던진다', () => {
  const bus = new EventBus();
  const calls = [];
  const boom = new Error('boom');
  bus.on('a', () => {
    throw boom;
  });
  bus.on('a', () => calls.push('after'));

  assert.throws(() => bus.emit('a'), (err) => err === boom);
  assert.deepEqual(calls, ['after']);
});

test('예외가 여러 개면 AggregateError 로 묶어 던진다', () => {
  const bus = new EventBus();
  const e1 = new Error('one');
  const e2 = new Error('two');
  bus.on('a', () => {
    throw e1;
  });
  bus.on('a', () => {
    throw e2;
  });

  assert.throws(
    () => bus.emit('a'),
    (err) => err instanceof AggregateError && err.errors[0] === e1 && err.errors[1] === e2,
  );
});

test('onError 가 있으면 예외를 거기로 넘기고 emit 은 던지지 않는다', () => {
  const bus = new EventBus();
  const boom = new Error('boom');
  const reported = [];
  bus.onError = (err, type, payload) => reported.push([err, type, payload]);
  bus.on('a', () => {
    throw boom;
  });
  bus.on('a', () => {});

  const called = bus.emit('a', 7);

  assert.equal(called, 2);
  assert.deepEqual(reported, [[boom, 'a', 7]]);
});

test('listenerCount 와 clear', () => {
  const bus = new EventBus();
  let count = 0;
  bus.on('a', () => count++);
  bus.on('a', () => count++);
  const offB = bus.on('b', () => count++);

  assert.equal(bus.listenerCount('a'), 2);
  assert.equal(bus.listenerCount(), 3);
  assert.equal(bus.listenerCount('none'), 0);

  bus.clear('a');
  assert.equal(bus.listenerCount('a'), 0);
  assert.equal(bus.listenerCount(), 1);

  bus.clear();
  assert.equal(bus.listenerCount(), 0);
  offB();
  bus.emit('a');
  bus.emit('b');
  assert.equal(count, 0);
});

test('잘못된 인자는 거부한다', () => {
  const bus = new EventBus();
  assert.throws(() => bus.on('', () => {}), TypeError);
  assert.throws(() => bus.on(undefined, () => {}), TypeError);
  assert.throws(() => bus.on('a', 'not a function'), TypeError);
  assert.throws(() => bus.once('a', null), TypeError);
});
