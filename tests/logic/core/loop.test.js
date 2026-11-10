import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FixedStepLoop } from '../../../src/logic/core/loop.js';

function makeLoop(options = {}) {
  const dts = [];
  const loop = new FixedStepLoop({
    stepMs: 10,
    maxFrameMs: 100,
    update: (dt) => dts.push(dt),
    ...options,
  });
  return { loop, dts };
}

test('경과 시간만큼 고정 길이 틱을 실행하고 남은 시간을 alpha 로 돌려준다', () => {
  const { loop, dts } = makeLoop();

  const result = loop.advance(35);

  assert.equal(result.steps, 3);
  assert.equal(result.alpha, 0.5);
  assert.deepEqual(dts, [0.01, 0.01, 0.01]);
});

test('틱 길이보다 짧은 프레임은 누적되다가 틱이 된다', () => {
  const { loop, dts } = makeLoop();

  assert.deepEqual(loop.advance(4), { steps: 0, alpha: 0.4 });
  assert.deepEqual(loop.advance(4), { steps: 0, alpha: 0.8 });
  const third = loop.advance(4);

  assert.equal(third.steps, 1);
  assert.ok(Math.abs(third.alpha - 0.2) < 1e-9);
  assert.equal(dts.length, 1);
});

test('정확히 틱 길이만큼 지나면 한 틱, alpha 는 0', () => {
  const { loop } = makeLoop();
  assert.deepEqual(loop.advance(10), { steps: 1, alpha: 0 });
});

test('프레임을 어떻게 쪼개도 총 틱 수는 같다', () => {
  const a = makeLoop();
  const b = makeLoop();

  a.loop.advance(100);
  for (let i = 0; i < 40; i++) b.loop.advance(2.5);

  assert.equal(a.dts.length, 10);
  assert.equal(b.dts.length, 10);
});

test('긴 공백은 maxFrameMs 로 잘린다', () => {
  const { loop, dts } = makeLoop();

  const result = loop.advance(60_000);

  assert.equal(result.steps, 10);
  assert.equal(result.alpha, 0);
  assert.equal(dts.length, 10);
});

test('음수·NaN·Infinity·숫자가 아닌 값은 0 으로 취급한다', () => {
  const { loop, dts } = makeLoop();
  loop.advance(5);

  for (const bad of [-50, NaN, Infinity, -Infinity, undefined, null, '20']) {
    assert.deepEqual(loop.advance(bad), { steps: 0, alpha: 0.5 }, `입력: ${String(bad)}`);
  }
  assert.equal(dts.length, 0);
});

test('reset 은 누적 시간을 버린다', () => {
  const { loop, dts } = makeLoop();
  loop.advance(9);

  loop.reset();
  const result = loop.advance(9);

  assert.deepEqual(result, { steps: 0, alpha: 0.9 });
  assert.equal(dts.length, 0);
});

test('update 에는 프레임 길이와 무관하게 항상 같은 dt(초)가 들어간다', () => {
  const dts = [];
  const loop = new FixedStepLoop({ stepMs: 1000 / 60, maxFrameMs: 250, update: (dt) => dts.push(dt) });

  for (const frame of [16.7, 33.4, 8.3, 250, 1, 120]) loop.advance(frame);

  assert.ok(dts.length > 0);
  assert.ok(dts.every((dt) => dt === 1 / 60));
});

test('60Hz 설정으로 1초를 흘리면 60틱 근처다(부동소수 누적 오차는 ±1틱 이내)', () => {
  const dts = [];
  const loop = new FixedStepLoop({ stepMs: 1000 / 60, maxFrameMs: 250, update: (dt) => dts.push(dt) });

  for (let i = 0; i < 125; i++) loop.advance(8);

  assert.ok(Math.abs(dts.length - 60) <= 1, `틱 수: ${dts.length}`);
});

test('잘못된 설정은 거부한다', () => {
  const update = () => {};
  assert.throws(() => new FixedStepLoop({ stepMs: 0, maxFrameMs: 100, update }), RangeError);
  assert.throws(() => new FixedStepLoop({ stepMs: -1, maxFrameMs: 100, update }), RangeError);
  assert.throws(() => new FixedStepLoop({ stepMs: NaN, maxFrameMs: 100, update }), RangeError);
  assert.throws(() => new FixedStepLoop({ stepMs: 10, maxFrameMs: 5, update }), RangeError);
  assert.throws(() => new FixedStepLoop({ stepMs: 10, maxFrameMs: 100 }), TypeError);
});
