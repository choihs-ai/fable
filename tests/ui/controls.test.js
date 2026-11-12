import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INPUT } from '../../data/ui.js';
import { createControls } from '../../src/ui/input/controls.js';

const R = INPUT.stick.radius;
const near = (a, b) => Math.abs(a - b) < 1e-9;

test('조이스틱: 닿은 곳이 중심, 민 방향과 거리가 이동 입력이 된다', () => {
  const c = createControls();
  assert.deepEqual(c.take(), { moveX: 0, moveY: 0, aimX: 0, aimY: 0, attack: false, dash: false, skill: false, swap: false, interact: false });
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
  assert.equal(c.buttonDown(3, 'skill'), true);
  const now = c.take();
  assert.ok(near(now.moveX, -1));
  assert.equal(now.attack, true);
  assert.equal(now.skill, true);
  assert.deepEqual(c.held(), { stick: 1, aim: 2, buttons: ['attack', 'skill'], pointers: 3 });
  // 스킬은 한 번만 나가고, 공격은 누르는 동안 계속 나간다.
  const next = c.take();
  assert.equal(next.skill, false);
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
  assert.equal(c.buttonDown(5, 'dash'), false);
  assert.equal(c.take().dash, false);
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
  assert.deepEqual(c.held(), { stick: null, aim: null, buttons: [], pointers: 0 });
});

test('전부 놓기(백그라운드 전환·화면 회전·메뉴): 쥔 것과 가져가지 않은 한 번짜리 입력을 모두 버린다', () => {
  const c = createControls();
  c.stickDown(1, 100, 300);
  c.pointerMove(1, 100 + R, 300);
  c.buttonDown(2, 'attack');
  c.buttonDown(3, 'skill');
  c.buttonDown(4, 'dash');
  c.buttonDown(5, 'swap');
  c.keyDown('KeyW');
  c.reset();
  assert.deepEqual(c.take(), { moveX: 0, moveY: 0, aimX: 0, aimY: 0, attack: false, dash: false, skill: false, swap: false, interact: false });
  assert.deepEqual(c.held(), { stick: null, aim: null, buttons: [], pointers: 0 });
  // 놓인 뒤에 늦게 도착한 이동·뗌 이벤트는 무시된다(옛 손가락이 되살아나지 않는다).
  c.pointerMove(1, 999, 999);
  c.pointerUp(2);
  assert.equal(c.take().moveX, 0);
  // 다시 닿으면 새로 시작한다.
  assert.equal(c.stickDown(1, 10, 10), true);
});

test('대시·스킬·무기 교체·상호작용은 누른 순간 한 번만: 누르고 있어도 되풀이되지 않는다', () => {
  const c = createControls();
  c.buttonDown(1, 'dash');
  assert.equal(c.take().dash, true);
  assert.equal(c.take().dash, false);
  c.pointerUp(1);
  c.buttonDown(1, 'swap');
  c.buttonDown(2, 'interact');
  const both = c.take();
  assert.equal(both.swap && both.interact, true);
  assert.equal(c.take().swap, false);
  assert.throws(() => c.buttonDown(3, 'jump'), RangeError);
});

test('수동 조준: 공격 버튼을 누른 채 끌면 그 방향으로 겨누고, 조금만 움직이거나 놓으면 자동 조준', () => {
  const c = createControls();
  c.buttonDown(1, 'attack', 300, 500);
  let a = c.take();
  assert.equal(a.attack, true);
  assert.deepEqual([a.aimX, a.aimY], [0, 0], '누르기만 하면 자동 조준');
  c.pointerMove(1, 300 + INPUT.aim.aimStart * 0.5, 500);
  assert.deepEqual([c.take().aimX, c.take().aimY], [0, 0], '조금 움직인 것은 손 떨림');
  c.pointerMove(1, 300, 500 - 80);
  a = c.take();
  assert.ok(near(a.aimX, 0) && near(a.aimY, -1), '화면 위로 끌면 -y 쪽을 겨눈다');
  assert.deepEqual(c.aimShape(), { x: 0, y: -1 });
  c.pointerMove(1, 300 + 60, 500 + 60);
  a = c.take();
  assert.ok(near(a.aimX, Math.SQRT1_2) && near(a.aimY, Math.SQRT1_2));
  // 손가락이 화면 밖으로 나가도 유지된다.
  c.pointerMove(1, 5000, 500);
  assert.ok(near(c.take().aimX, 1));
  c.pointerUp(1);
  a = c.take();
  assert.deepEqual([a.attack, a.aimX, a.aimY], [false, 0, 0]);
  assert.equal(c.aimShape(), null);
});

test('수동 조준과 이동은 서로 다른 손가락: 스틱을 움직여도 조준이 흔들리지 않고, 취소되면 조준만 풀린다', () => {
  const c = createControls();
  c.stickDown(1, 100, 500);
  c.buttonDown(2, 'attack', 600, 500);
  c.pointerMove(2, 700, 500);
  c.pointerMove(1, 100, 500 + R);
  const a = c.take();
  assert.ok(near(a.moveY, 1) && near(a.aimX, 1) && near(a.aimY, 0));
  // 둘째 공격 손가락(공격 버튼을 이미 다른 손가락이 쥐고 있음)은 조준을 빼앗지 못한다.
  c.buttonDown(3, 'attack', 0, 0);
  c.pointerMove(3, 0, -900);
  assert.ok(near(c.take().aimX, 1));
  c.pointerCancel(2);
  const b = c.take();
  assert.deepEqual([b.aimX, b.aimY], [0, 0]);
  assert.equal(b.attack, true, '셋째 손가락은 여전히 공격 버튼을 누르고 있다');
  assert.ok(near(b.moveY, 1));
});

test('키보드: 대각선은 길이 1 로 맞추고, 자동 반복은 한 번으로 보고, 스틱이 잡혀 있으면 스틱이 우선한다', () => {
  const c = createControls();
  c.keyDown('KeyD');
  c.keyDown('KeyS');
  const d = c.take();
  assert.ok(near(d.moveX * d.moveX + d.moveY * d.moveY, 1) && d.moveX > 0 && d.moveY > 0);
  c.keyDown('KeyK');
  c.keyDown('KeyK');
  assert.equal(c.take().dash, true);
  assert.equal(c.take().dash, false);
  c.keyDown('KeyE');
  c.keyDown('KeyR');
  c.keyDown('KeyL');
  const once = c.take();
  assert.deepEqual([once.interact, once.swap, once.skill], [true, true, true]);
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
