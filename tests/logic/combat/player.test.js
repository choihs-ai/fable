import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PLAYER } from '../../../data/player.js';
import { EVENTS } from '../../../src/logic/core/events.js';
import { PHASE } from '../../../src/logic/core/state.js';
import { dealDamage } from '../../../src/logic/combat/damage.js';
import { setInput } from '../../../src/logic/combat/player.js';
import { applyStatus } from '../../../src/logic/combat/statuses.js';
import { createArena, openRoom, sec } from '../../helpers/arena.js';

const ROOM = openRoom(30, 14);
const arena = (options) => createArena(ROOM, { player: { x: 10.5, y: 7.5 }, ...options });
/** 맞기만 하는 표적: 체력을 크게 늘리고 기절시켜 둔 좀비. */
function dummy(a, x, y) {
  const z = a.enemy('zombie', { x, y });
  z.maxHp = z.hp = 100000;
  z.speed = 0;
  return z;
}

// ── 입력과 이동 ──

test('setInput: 이동 벡터는 길이 1 로 자르고, 잘못된 값은 0·-1 로 맞춘다', () => {
  const { state } = arena();
  setInput(state, { moveX: 3, moveY: 4 });
  assert.ok(Math.abs(state.input.moveX - 0.6) < 1e-12 && Math.abs(state.input.moveY - 0.8) < 1e-12);
  setInput(state, { moveX: 0.3, moveY: 0 });
  assert.equal(state.input.moveX, 0.3, '길이 1 이하의 입력은 그대로(아날로그 스틱)');
  setInput(state, { moveX: NaN, moveY: Infinity, aimX: 'x', skill: 99, attack: 1, dodge: 'yes' });
  assert.deepEqual(state.input, { moveX: 0, moveY: 0, aimX: 0, aimY: 0, attack: false, skill: -1, dodge: false });
  setInput(state, { skill: 2 });
  assert.equal(state.input.skill, 2);
  setInput(state, { skill: 1.5 });
  assert.equal(state.input.skill, -1);
});

test('이동: 1초에 speed 칸. 대각선도 같은 속도이고 바라보는 방향이 따라간다', () => {
  const straight = arena();
  straight.step(sec(1), { moveX: 1, moveY: 0 });
  assert.ok(Math.abs(straight.player.x - 10.5 - PLAYER.speed) < 1e-6);
  assert.deepEqual([straight.player.facingX, straight.player.facingY], [1, 0]);

  const diagonal = arena();
  diagonal.step(sec(1), { moveX: 1, moveY: 1 });
  const d = Math.hypot(diagonal.player.x - 10.5, diagonal.player.y - 7.5);
  assert.ok(Math.abs(d - PLAYER.speed) < 1e-6, `${d}`);

  const half = arena();
  half.step(sec(1), { moveX: 0.5, moveY: 0 });
  assert.ok(Math.abs(half.player.x - 10.5 - PLAYER.speed / 2) < 1e-6, '스틱을 반만 밀면 절반 속도');
});

test('이동: 벽 앞에서 멈춘다', () => {
  const a = arena();
  a.step(sec(5), { moveX: -1, moveY: 0 });
  assert.ok(Math.abs(a.player.x - (1 + PLAYER.radius)) < 1e-6, `x=${a.player.x}`);
  assert.equal(a.player.hitWall, true);
});

test('입력이 없으면 가만히 있고, 이전 입력은 유지된다(ui 가 바꿀 때까지)', () => {
  const a = arena();
  a.step(10);
  assert.equal(a.player.x, 10.5);
  setInput(a.state, { moveX: 1 });
  a.step(10);
  assert.ok(a.player.x > 10.5 + 0.6);
});

// ── 기본공격 ──

test('기본공격: 사거리 안의 적을 자동으로 겨눠 때리고, 재사용 대기마다 한 번씩 들어간다', () => {
  const a = arena();
  // 플레이어는 처음에 아래(0,1)를 보고 있고, 표적은 위쪽에 있다 → 자동 조준이 돼야 맞는다.
  const target = dummy(a, 10.5, 6.3);
  a.step(1, { attack: true });
  assert.equal(target.maxHp - target.hp, 6);
  assert.ok(a.player.facingY < -0.99, '공격 방향으로 돌아본다');

  a.step(sec(0.4) - 1, { attack: true });
  assert.equal(target.maxHp - target.hp, 6, '재사용 대기 중');
  a.step(1, { attack: true });
  assert.equal(target.maxHp - target.hp, 12);
  a.step(sec(2), { attack: false });
  assert.equal(target.maxHp - target.hp, 12, '버튼을 떼면 멈춘다');
});

test('기본공격: 사거리 밖·부채꼴 밖·벽 너머의 적은 맞지 않는다', () => {
  const far = arena();
  const t1 = dummy(far, 10.5, 4.5);
  far.step(sec(1), { attack: true });
  assert.equal(t1.hp, t1.maxHp, '3칸 떨어진 적');

  // 조준 입력으로 반대쪽을 겨누면 뒤에 있는 적은 맞지 않는다.
  const behind = arena();
  const t2 = dummy(behind, 10.5, 6.3);
  behind.step(sec(1), { attack: true, aimX: 0, aimY: 1 });
  assert.equal(t2.hp, t2.maxHp, '부채꼴 밖');

  const walled = createArena(['#######', '#..#..#', '#..#..#', '#######'], { player: { x: 2.6, y: 1.5 } });
  const t3 = dummy(walled, 4.4, 1.5);
  walled.step(sec(1), { attack: true, aimX: 1, aimY: 0 });
  assert.equal(t3.hp, t3.maxHp, '벽 너머');
  walled.step(1, { skill: 0 });
  walled.step(1, { skill: 2 });
  assert.equal(t3.hp, t3.maxHp, '범위 기술도 벽을 넘지 못한다');
});

test('공격하면서도 움직일 수 있다', () => {
  const a = arena();
  dummy(a, 12.5, 7.5);
  a.step(sec(0.5), { attack: true, moveX: 0, moveY: 1 });
  assert.ok(a.player.y > 7.5 + 1.5);
});

// ── 기술 ──

test('기술은 2~3개이고 저마다 재사용 대기가 있다', () => {
  assert.ok(PLAYER.skills.length >= 2 && PLAYER.skills.length <= 3);
  for (const id of [PLAYER.attack, ...PLAYER.skills]) {
    assert.ok(PLAYER.abilities[id], id);
    assert.ok(PLAYER.abilities[id].cooldown > 0, `${id} 재사용 대기`);
  }
  assert.ok(PLAYER.skills.every((id) => PLAYER.abilities[id].cooldown > PLAYER.abilities[PLAYER.attack].cooldown));
});

test('회전베기: 둘레의 모든 적에게 피해와 출혈. 재사용 대기 중에는 나가지 않는다', () => {
  const a = arena();
  const near = [dummy(a, 11.8, 7.5), dummy(a, 9.2, 7.5), dummy(a, 10.5, 9.0)];
  const far = dummy(a, 14.5, 7.5);
  a.step(1, { skill: 0 });

  for (const t of near) {
    assert.equal(t.maxHp - t.hp, 12);
    assert.equal(t.statuses.bleed.stacks, 1);
  }
  assert.equal(far.hp, far.maxHp);
  assert.equal(a.state.input.skill, -1, '기술 입력은 한 번 쓰면 지워진다');
  assert.equal(a.events(EVENTS.ABILITY_USED).filter((e) => e.ability === 'whirlwind').length, 1);

  a.step(sec(6) - 2, (s) => ({ skill: 0, moveX: 0, moveY: 0 }));
  assert.equal(a.events(EVENTS.ABILITY_USED).filter((e) => e.ability === 'whirlwind').length, 1, '재사용 대기 6초');
  a.step(2, { skill: 0 });
  assert.equal(a.events(EVENTS.ABILITY_USED).filter((e) => e.ability === 'whirlwind').length, 2);
});

test('화염탄: 투사체가 날아가 처음 닿은 적에게 피해와 화상을 주고 사라진다', () => {
  const a = arena();
  const first = dummy(a, 15.5, 7.5);
  const second = dummy(a, 17.5, 7.5);
  a.step(1, { skill: 1, aimX: 1, aimY: 0 });
  assert.equal(a.state.projectiles.length, 1);
  const fired = a.events(EVENTS.PROJECTILE_FIRED)[0];
  assert.ok(fired.vx > 0 && fired.vy === 0 && fired.ownerId === a.player.id);

  a.step(sec(0.6));
  assert.equal(a.state.projectiles.length, 0);
  assert.equal(first.maxHp - first.hp, 10);
  assert.ok(first.statuses.burn);
  assert.equal(second.hp, second.maxHp, '뒤의 적은 맞지 않는다');
});

test('화염탄: 벽에 닿거나 사거리를 다 날면 사라진다', () => {
  const wall = arena();
  wall.step(1, { skill: 1, aimX: -1, aimY: 0 });
  wall.step(sec(1));
  assert.equal(wall.state.projectiles.length, 0, '9.5칸 앞의 벽');

  const range = createArena(openRoom(40, 6), { player: { x: 2.5, y: 3.5 } });
  const t = dummy(range, 14.5, 3.5);
  range.step(1, { skill: 1, aimX: 1, aimY: 0 });
  range.step(sec(1));
  assert.equal(range.state.projectiles.length, 0);
  assert.equal(t.hp, t.maxHp, '사거리 9칸 밖의 적');
});

test('서리 폭발: 둘레의 적을 얼린다', () => {
  const a = arena();
  const t = dummy(a, 12.5, 7.5);
  a.step(1, { skill: 2 });
  assert.equal(t.maxHp - t.hp, 4);
  assert.ok(t.statuses.freeze);
  assert.equal(t.disabled, true);
});

test('없는 기술 칸은 무시된다', () => {
  const a = arena();
  a.step(1, { skill: 7 });
  assert.equal(a.events(EVENTS.ABILITY_USED).length, 0);
});

// ── 회피 ──

test('회피: 이동 방향으로 짧게 돌진하고, 그동안 피해와 상태이상을 받지 않는다', () => {
  const a = arena();
  a.step(1, { dodge: true, moveX: 1, moveY: 0 });
  assert.ok(a.player.dash, '돌진 시작');
  assert.equal(a.state.input.dodge, false, '회피 입력은 한 번 쓰면 지워진다');
  assert.deepEqual(a.events(EVENTS.PLAYER_DODGED).map((e) => [e.dirX, e.dirY]), [[1, 0]]);

  assert.equal(dealDamage(a.state, a.bus, a.player, 50), 0);
  assert.equal(applyStatus(a.state, a.bus, a.player, 'stun'), false);

  a.step(sec(PLAYER.dodge.duration) + 1, { moveX: 0, moveY: 0 });
  assert.equal(a.player.dash, null);
  const travelled = a.player.x - 10.5;
  assert.ok(travelled > 2 && travelled < 2.8, `회피 거리 ${travelled.toFixed(2)}칸`);

  a.step(sec(PLAYER.dodge.invuln));
  assert.equal(dealDamage(a.state, a.bus, a.player, 50), 50, '무적 시간이 끝나면 다시 맞는다');
});

test('회피: 재사용 대기가 있고, 이동 입력이 없으면 바라보는 방향으로 구른다', () => {
  const a = arena();
  a.step(1, { dodge: true });
  a.step(sec(0.5));
  assert.ok(a.player.y > 7.5 + 2, '처음 바라보는 방향(아래)');
  const y = a.player.y;
  a.step(1, { dodge: true });
  a.step(sec(0.3));
  assert.equal(a.player.y, y, '재사용 대기 1초가 지나지 않았다');
  a.step(sec(0.3), null);
  a.step(1, { dodge: true });
  assert.ok(a.player.dash);
  assert.equal(a.events(EVENTS.PLAYER_DODGED).length, 2);
});

test('회피: 적을 통과하고, 벽은 통과하지 못한다', () => {
  const through = arena();
  const blocker = dummy(through, 11.3, 7.5);
  through.step(1, { dodge: true, moveX: 1, moveY: 0 });
  through.step(sec(0.3), { moveX: 0, moveY: 0 });
  assert.ok(through.player.x > blocker.x + 0.5, `플레이어 x=${through.player.x.toFixed(2)}, 적 x=${blocker.x.toFixed(2)}`);

  const wall = createArena(ROOM, { player: { x: 2.0, y: 7.5 } });
  wall.step(1, { dodge: true, moveX: -1, moveY: 0 });
  wall.step(sec(0.3), { moveX: 0, moveY: 0 });
  assert.ok(Math.abs(wall.player.x - (1 + PLAYER.radius)) < 1e-6);
});

test('회피 중에는 투사체가 그냥 지나간다', () => {
  const a = createArena(openRoom(30, 8), { player: { x: 5.5, y: 4.5 } });
  a.player.maxHp = a.player.hp = 1000;
  const kobold = a.enemy('kobold', { x: 11.5, y: 4.5 }, { alerted: true });
  // 투사체가 플레이어 바로 앞까지 올 때까지 기다린다.
  let near = false;
  for (let i = 0; i < sec(3) && !near; i++) {
    a.step(1);
    near = a.state.projectiles.some((p) => p.faction === 'enemy' && p.x - a.player.x < 0.9);
  }
  assert.ok(near, '코볼트가 쏜 돌이 다가와야 함');
  const hp = a.player.hp;
  // 제자리 무적을 위해 속도 없이 무적만 준다(회피의 무적 시간과 같은 규칙).
  a.player.invulnUntil = a.state.tick + sec(0.3);
  a.step(sec(0.3));
  assert.equal(a.player.hp, hp, '무적인 동안 맞지 않는다');
  assert.ok(kobold.hp > 0);
});

// ── 행동 불가·죽음 ──

test('기절·빙결 중에는 움직이지도 공격하지도 회피하지도 못한다', () => {
  const a = arena();
  const t = dummy(a, 11.5, 7.5);
  applyStatus(a.state, a.bus, a.player, 'stun');
  a.step(sec(0.9), { moveX: 1, moveY: 0, attack: true, dodge: true });
  assert.equal(a.player.x, 10.5);
  assert.equal(t.hp, t.maxHp);
  assert.equal(a.player.dash, null);
  assert.equal(a.events(EVENTS.PLAYER_DODGED).length, 0);
});

test('플레이어가 죽으면 게임 오버가 되고 목록에는 남는다', () => {
  const a = arena();
  dealDamage(a.state, a.bus, a.player, 1000);
  a.step(1);
  assert.equal(a.state.phase, PHASE.GAME_OVER);
  assert.equal(a.state.entities.byId[a.player.id], a.player);
  assert.deepEqual(a.events(EVENTS.ENTITY_DIED).map((e) => e.kind), ['player']);
  assert.equal(a.events(EVENTS.PHASE_CHANGED).at(-1).to, PHASE.GAME_OVER);
});
