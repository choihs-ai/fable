import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INPUT } from '../../data/ui.js';
import { createControls } from '../../src/ui/input/controls.js';

const R = INPUT.stick.radius;
const near = (a, b) => Math.abs(a - b) < 1e-9;

test('조이스틱: 닿은 곳이 중심, 민 방향과 거리가 이동 입력이 된다', () => {
  const c = createControls();
  assert.deepEqual(c.take(), { moveX: 0, moveY: 0, attack: false, skill: -1, dodge: false });
  assert.equal(c.stickDown(1, 100, 300), true);
  assert.deepEqual(c.take().moveX, 0, '닿기만 하면 움직이지 않는다');
  c.pointerMove(1, 100 + R, 300);
  assert.ok(near(c.take().moveX, 1));
  c.pointerMove(1, 100, 300 - R);
  const up = c.take();
  assert.ok(near(up.moveY, -1) && near(up.moveX, 0), '화면 위쪽 = -y');
  c.pointerMove(1, 100 + R / 2, 300);
  const half = c.take().moveX;
  assert.ok(half > 0.3 && half < 0.5, `절반쯤 밀면 절반보다 조금 작다(불감대): ${half}`);
  c.pointerUp(1);
  assert.equal(c.take().moveX, 0);
  assert.equal(c.stickShape(), null);
});

test('조이스틱: 불감대 안쪽은 0, 끝을 넘으면 1 로 잘린다(길이가 1 을 넘지 않는다)', () => {
  const c = createControls();
  c.stickDown(1, 0, 0);
  c.pointerMove(1, R * INPUT.stick.deadzone * 0.9, 0);
  assert.equal(c.take().moveX, 0);
  c.pointerMove(1, R * 40, R * 40);
  const far = c.take();
  assert.ok(near(far.moveX * far.moveX + far.moveY * far.moveY, 1));
  const shape = c.stickShape();
  assert.ok(near((shape.knobX - shape.originX) ** 2 + (shape.knobY - shape.originY) ** 2, R * R), '손잡이 그림도 끝에서 멈춘다');
});

test('감도: 높을수록 조금만 밀어도 끝까지 민 것이 된다', () => {
  const at = (sensitivity) => {
    const c = createControls({ sensitivity });
    c.stickDown(1, 0, 0);
    c.pointerMove(1, R / 2, 0);
    return c.take().moveX;
  };
  assert.ok(at(50) < at(100) && at(100) < at(200));
  assert.ok(near(at(200), 1));
  const c = createControls();
  c.stickDown(1, 0, 0);
  c.pointerMove(1, R / 2, 0);
  c.setSensitivity(200);
  assert.ok(near(c.take().moveX, 1), '쥐고 있는 중에 바꿔도 반영된다');
  assert.throws(() => c.setSensitivity(0), RangeError);
});

test('멀티터치: 스틱과 버튼을 서로 다른 손가락으로 동시에 쓴다', () => {
  const c = createControls();
  c.stickDown(1, 100, 300);
  c.pointerMove(1, 100 - R, 300);
  assert.equal(c.buttonDown(2, 'attack'), true);
  assert.equal(c.buttonDown(3, 'skill1'), true);
  const now = c.take();
  assert.ok(near(now.moveX, -1));
  assert.equal(now.attack, true);
  assert.equal(now.skill, 1);
  assert.deepEqual(c.held(), { stick: 1, buttons: ['attack', 'skill1'], pointers: 3 });
  // 기술은 한 번만 나가고, 공격은 누르는 동안 계속 나간다.
  const next = c.take();
  assert.equal(next.skill, -1);
  assert.equal(next.attack, true);
  // 버튼 손가락을 떼도 스틱은 그대로다. 스틱 손가락을 떼도 공격은 그대로다.
  c.pointerUp(3);
  c.pointerUp(1);
  const after = c.take();
  assert.equal(after.moveX, 0);
  assert.equal(after.attack, true);
  c.pointerUp(2);
  assert.equal(c.take().attack, false);
});

test('멀티터치: 스틱이 잡혀 있으면 둘째 손가락은 스틱이 될 수 없고, 첫 손가락의 스틱을 흔들지 못한다', () => {
  const c = createControls();
  assert.equal(c.stickDown(1, 100, 300), true);
  assert.equal(c.stickDown(2, 200, 300), false);
  c.pointerMove(2, 900, 900);
  assert.equal(c.take().moveX, 0);
  c.pointerUp(2);
  assert.equal(c.held().stick, 1, '둘째 손가락을 떼도 스틱은 유지된다');
  // 스틱 손가락은 버튼을 누를 수 없고, 한 손가락이 버튼 둘을 잡을 수 없다.
  assert.equal(c.buttonDown(1, 'attack'), false);
  c.buttonDown(5, 'attack');
  assert.equal(c.buttonDown(5, 'dodge'), false);
  assert.equal(c.take().dodge, false);
  // 첫 손가락을 뗀 뒤에는 다른 손가락이 스틱을 잡을 수 있다.
  c.pointerUp(1);
  assert.equal(c.stickDown(7, 50, 50), true);
});

test('손가락이 화면 밖으로 나감: 스틱은 유지되고, 떼거나 취소되면 놓인다', () => {
  const c = createControls();
  c.stickDown(1, 30, 400);
  c.pointerMove(1, -500, 400); // 화면 왼쪽 밖
  assert.ok(near(c.take().moveX, -1));
  c.pointerMove(1, Number.NaN, 400); // 좌표를 알 수 없으면 마지막 위치를 유지한다
  assert.ok(near(c.take().moveX, -1));
  c.pointerUp(1); // 화면 밖에서 뗌
  assert.equal(c.take().moveX, 0);
});

test('터치 취소(touchcancel·캡처 해제): 그 손가락이 쥔 것만 놓인다', () => {
  const c = createControls();
  c.stickDown(1, 100, 300);
  c.pointerMove(1, 100 + R, 300);
  c.buttonDown(2, 'attack');
  c.pointerCancel(1);
  const a = c.take();
  assert.equal(a.moveX, 0);
  assert.equal(a.attack, true);
  c.pointerCancel(2);
  assert.equal(c.take().attack, false);
  // 모르는 포인터의 취소·뗌은 아무 일도 없다.
  c.pointerCancel(99);
  c.pointerUp(98);
  assert.deepEqual(c.held(), { stick: null, buttons: [], pointers: 0 });
});

test('전부 놓기(백그라운드 전환·화면 회전·메뉴): 쥔 것과 가져가지 않은 기술·회피를 모두 버린다', () => {
  const c = createControls();
  c.stickDown(1, 100, 300);
  c.pointerMove(1, 100 + R, 300);
  c.buttonDown(2, 'attack');
  c.buttonDown(3, 'skill2');
  c.buttonDown(4, 'dodge');
  c.keyDown('KeyW');
  c.reset();
  assert.deepEqual(c.take(), { moveX: 0, moveY: 0, attack: false, skill: -1, dodge: false });
  assert.deepEqual(c.held(), { stick: null, buttons: [], pointers: 0 });
  // 놓인 뒤에 늦게 도착한 이동·뗌 이벤트는 무시된다(옛 손가락이 되살아나지 않는다).
  c.pointerMove(1, 999, 999);
  c.pointerUp(2);
  assert.equal(c.take().moveX, 0);
  // 다시 닿으면 새로 시작한다.
  assert.equal(c.stickDown(1, 10, 10), true);
});

test('기술·회피는 누른 순간 한 번만: 누르고 있어도 되풀이되지 않고, 한 프레임에 둘을 누르면 마지막 기술이 나간다', () => {
  const c = createControls();
  c.buttonDown(1, 'dodge');
  assert.equal(c.take().dodge, true);
  assert.equal(c.take().dodge, false);
  c.pointerUp(1);
  c.buttonDown(1, 'skill0');
  c.buttonDown(2, 'skill2');
  assert.equal(c.take().skill, 2);
  assert.throws(() => c.buttonDown(3, 'jump'), RangeError);
});

test('키보드: 대각선은 길이 1 로 맞추고, 자동 반복은 한 번으로 보고, 스틱이 잡혀 있으면 스틱이 우선한다', () => {
  const c = createControls();
  c.keyDown('KeyD');
  c.keyDown('KeyS');
  const d = c.take();
  assert.ok(near(d.moveX * d.moveX + d.moveY * d.moveY, 1) && d.moveX > 0 && d.moveY > 0);
  c.keyDown('KeyK');
  c.keyDown('KeyK');
  assert.equal(c.take().dodge, true);
  assert.equal(c.take().dodge, false);
  c.keyUp('KeyK');
  c.keyDown('Space');
  assert.equal(c.take().attack, true);
  c.stickDown(1, 0, 0);
  assert.equal(c.take().moveX, 0, '스틱을 쥐고 있으면 키 이동은 무시');
  c.pointerUp(1);
  c.keyUp('KeyD');
  c.keyUp('KeyS');
  assert.equal(c.take().moveX, 0);
});
