// 플레이어 조작: 이동, 충전식 대시, 대시 공격, 입력 버퍼, 무기(에너지·교체·수동 조준), 캐릭터 스킬.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CHARACTERS } from '../../../data/characters.js';
import { PLAYER } from '../../../data/player.js';
import { WEAPONS } from '../../../data/weapons.js';
import { EVENTS } from '../../../src/logic/core/events.js';
import { PHASE } from '../../../src/logic/core/state.js';
import { dealDamage } from '../../../src/logic/combat/damage.js';
import { setInput, swapWeapon } from '../../../src/logic/combat/player.js';
import { spawnProjectile } from '../../../src/logic/combat/projectiles.js';
import { applyStatus } from '../../../src/logic/combat/statuses.js';
import { createArena, openRoom, sec } from '../../helpers/arena.js';

const ROOM = openRoom(30, 14);
const arena = (options) => createArena(ROOM, { player: { x: 10.5, y: 7.5 }, ...options });
const mageMeta = { version: 2, souls: 0, upgrades: {}, characters: { mage: true } };
/** 맞기만 하는 표적: 체력을 크게 늘리고 움직이지 못하게 한 좀비. */
function dummy(a, x, y) {
  const z = a.enemy('zombie', { x, y });
  z.maxHp = z.hp = 100000;
  z.speed = 0;
  z.mass = 1e9;
  return z;
}
/** 무기를 바꿔 든다(테스트용). */
function arm(a, first, second = null) {
  a.player.kit.weapons = [first, second];
  a.player.kit.slot = 0;
}
const hits = (a, target) => a.events(EVENTS.DAMAGE_DEALT).filter((e) => e.targetId === target.id);
const DASH_TICKS = Math.max(1, Math.round(PLAYER.dash.duration * 60));

// ── 입력과 이동 ──

test('setInput: 이동 벡터는 길이 1 로 자르고, 잘못된 값은 0·false 로 맞춘다', () => {
  const { state } = arena();
  setInput(state, { moveX: 3, moveY: 4 });
  assert.ok(Math.abs(Math.hypot(state.input.moveX, state.input.moveY) - 1) < 1e-9);
  setInput(state, { moveX: NaN, moveY: 'x', aimX: Infinity, aimY: undefined, attack: 1, dash: 'yes', skill: null });
  assert.deepEqual(state.input, { moveX: 0, moveY: 0, aimX: 0, aimY: 0, attack: false, dash: false, skill: false, skill2: false });
  setInput(state, { attack: true });
  assert.equal(state.input.attack, true);
  assert.equal(state.input.moveX, 0, '주지 않은 항목은 그대로');
});

test('이동: 1초에 speed 칸. 대각선도 같은 속도이고 바라보는 방향이 따라간다', () => {
  const a = arena();
  const speed = a.player.speed;
  a.step(sec(1), { moveX: 1, moveY: 0 });
  assert.ok(Math.abs(a.player.x - (10.5 + speed)) < 0.01, `x=${a.player.x}`);
  const b = arena();
  b.step(sec(1), { moveX: 1, moveY: 1 });
  assert.ok(Math.abs(Math.hypot(b.player.x - 10.5, b.player.y - 7.5) - speed) < 0.01);
  assert.ok(Math.abs(b.player.facingX - Math.SQRT1_2) < 1e-6 && Math.abs(b.player.facingY - Math.SQRT1_2) < 1e-6);
});

test('이동: 벽 앞에서 멈춘다', () => {
  const a = arena();
  a.step(sec(5), { moveX: -1, moveY: 0 });
  assert.ok(Math.abs(a.player.x - (1 + a.player.radius)) < 1e-6, `x=${a.player.x}`);
});

// ── 대시 ──

test('대시: 이동 방향으로 짧게 돌진하고, 0.25초 동안 피해와 상태이상을 받지 않는다', () => {
  const a = arena();
  a.step(1, { moveX: 1, moveY: 0, dash: true });
  assert.ok(a.player.dash, '돌진 중');
  assert.equal(a.events(EVENTS.PLAYER_DASHED).length, 1);
  assert.equal(a.player.invulnUntil - a.state.tick, sec(0.25) , '무적 0.25초');
  assert.equal(dealDamage(a.state, a.bus, a.player, 50, { sourceId: null }), 0);
  assert.equal(applyStatus(a.state, a.bus, a.player, 'stun'), false);
  const x0 = 10.5;
  a.step(DASH_TICKS + 2, { moveX: 0, moveY: 0 });
  assert.equal(a.player.dash, null);
  const moved = a.player.x - x0;
  assert.ok(Math.abs(moved - PLAYER.dash.speed * DASH_TICKS / 60) < 0.3, `이동 ${moved.toFixed(2)}칸`);
  assert.equal(a.events(EVENTS.PLAYER_DASH_ENDED).length, 1);
  // 무적이 끝나면 다시 맞는다.
  a.step(sec(0.3));
  assert.ok(dealDamage(a.state, a.bus, a.player, 5, { sourceId: null }) > 0);
});

test('대시: 충전식 — 두 번을 이어 쓸 수 있고, 다 쓰면 다시 찰 때까지 나가지 않는다', () => {
  const a = arena();
  const kit = a.player.kit;
  assert.equal(kit.charges, PLAYER.dash.charges);
  assert.equal(kit.maxCharges, 2);
  a.step(1, { moveX: 1, moveY: 0, dash: true });
  a.step(DASH_TICKS + 1);
  a.step(1, { dash: true });
  assert.ok(a.player.dash, '첫 대시가 끝나자마자 두 번째 대시');
  assert.equal(kit.charges, 0);
  a.step(DASH_TICKS + 1);
  a.step(1, { dash: true });
  a.step(sec(0.2));
  assert.equal(a.events(EVENTS.PLAYER_DASHED).length, 2, '충전이 없으면 나가지 않는다');
  // 충전은 하나씩 찬다.
  a.step(sec(PLAYER.dash.recharge));
  assert.ok(kit.charges >= 1);
  a.step(sec(PLAYER.dash.recharge));
  assert.equal(kit.charges, 2);
  assert.equal(kit.chargeAt, 0, '가득 차면 충전을 멈춘다');
});

test('대시: 이동 입력이 없으면 바라보는 방향으로, 적은 통과하고 벽은 통과하지 못한다', () => {
  const a = arena();
  a.step(2, { moveX: 0, moveY: -1 });
  a.step(1, { moveX: 0, moveY: 0, dash: true });
  assert.equal(a.player.dash.dirY, -1, '바라보는 방향');

  const b = arena();
  const z = dummy(b, 11.5, 7.5);
  b.step(1, { moveX: 1, moveY: 0, dash: true });
  b.step(DASH_TICKS + 1);
  assert.ok(b.player.x > z.x + 0.5, `적을 지나쳤다 x=${b.player.x.toFixed(2)}`);

  const c = createArena(ROOM, { player: { x: 2.0, y: 7.5 } });
  c.step(1, { moveX: -1, moveY: 0, dash: true });
  c.step(DASH_TICKS + 1);
  assert.ok(Math.abs(c.player.x - (1 + c.player.radius)) < 1e-6);
});

test('대시 중에는 투사체가 그냥 지나가고, 무적이 끝난 뒤의 탄은 맞는다', () => {
  const a = arena();
  const shooter = dummy(a, 20.5, 7.5);
  const fire = () => spawnProjectile(a.state, a.bus, shooter, { speed: 20, radius: 0.2, range: 30, damage: 10 }, -1, 0);
  fire();
  // 탄이 닿기 직전에 위로 대시한다.
  a.step(22);
  a.step(1, { moveX: 0, moveY: -1, dash: true });
  a.step(sec(1), { moveX: 0, moveY: 0 });
  assert.equal(hits(a, a.player).length, 0);
  a.player.y = 7.5;
  fire();
  a.step(sec(1), { moveX: 0, moveY: 0 });
  assert.equal(hits(a, a.player).length, 1);
});

test('대시는 준비·경직 중인 공격을 끊고 나간다', () => {
  const a = arena();
  arm(a, 'greatsword');
  dummy(a, 12.0, 7.5);
  a.step(1, { attack: true });
  assert.equal(a.player.action.phase, 'windup');
  a.step(1, { attack: false, moveX: 0, moveY: 1, dash: true });
  assert.equal(a.player.action, null);
  assert.ok(a.player.dash);
});

test('입력 버퍼: 지금 할 수 없는 대시 입력을 0.15초 동안 기억했다가 가능해지면 실행한다', () => {
  const a = arena();
  const kit = a.player.kit;
  kit.charges = 0;
  kit.chargeAt = a.state.tick + 6; // 6틱 뒤에 충전이 찬다.
  a.step(1, { moveX: 1, moveY: 0, dash: true });
  assert.equal(a.player.dash, null);
  assert.deepEqual(kit.buffer.kind, 'dash');
  a.step(6, { moveX: 1, moveY: 0 });
  assert.equal(a.events(EVENTS.PLAYER_DASHED).length, 1, '충전이 차는 틱에 나간다');

  // 버퍼보다 오래 걸리면 잊는다.
  const b = arena();
  b.player.kit.charges = 0;
  b.player.kit.chargeAt = b.state.tick + sec(0.15) + 4;
  b.step(1, { moveX: 1, moveY: 0, dash: true });
  b.step(sec(0.5), { moveX: 1, moveY: 0 });
  assert.equal(b.events(EVENTS.PLAYER_DASHED).length, 0);
  assert.equal(b.player.kit.buffer, null);

  // 기절 중에 누른 대시도 풀리자마자 나간다.
  const c = arena();
  applyStatus(c.state, c.bus, c.player, 'stun', { duration: 0.1 });
  c.step(2);
  c.step(1, { moveX: 1, moveY: 0, dash: true });
  c.step(6, { moveX: 1, moveY: 0 });
  assert.equal(c.events(EVENTS.PLAYER_DASHED).length, 1);
});

// ── 무기 ──

test('근접 무기: 가까운 적을 자동으로 겨눠 때리고, 재사용 대기마다 한 번씩 들어가며 에너지를 쓰지 않는다', () => {
  const a = arena();
  const z = dummy(a, 12.0, 7.5);
  const energy = a.player.kit.energy;
  a.step(sec(1), { attack: true });
  const dealt = hits(a, z);
  const expected = Math.floor(1 / WEAPONS.sword.attack.cooldown) + 1;
  assert.ok(dealt.length === expected || dealt.length === expected - 1, `${dealt.length}번 (기대 ${expected})`);
  assert.ok(a.player.facingX > 0.99, '적을 바라본다');
  assert.equal(a.player.kit.energy, energy);
  assert.ok(Math.abs(z.x - 12.0) < 1e-6, '무게가 큰 표적은 밀리지 않는다');
});

test('근접 무기: 사거리 밖·부채꼴 밖·벽 너머의 적은 맞지 않는다', () => {
  const a = arena();
  const far = dummy(a, 10.5 + WEAPONS.sword.attack.effects[0].range + 1, 7.5);
  a.step(sec(0.5), { attack: true });
  assert.equal(hits(a, far).length, 0);

  const rows = openRoom(12, 7);
  rows[3] = '#....#.....#';
  const b = createArena(rows, { player: { x: 4.5, y: 3.5 } });
  const behindWall = dummy(b, 6.5, 3.5);
  b.step(sec(0.5), { attack: true, aimX: 1, aimY: 0 });
  assert.equal(hits(b, behindWall).length, 0);
});

test('원거리 무기: 쏠 때마다 에너지를 쓰고, 투사체가 날아가 맞는다', () => {
  const a = arena();
  arm(a, 'pistol');
  const z = dummy(a, 16.5, 7.5);
  const energy = a.player.kit.energy;
  a.step(1, { attack: true });
  assert.equal(a.state.projectiles.length, 1);
  assert.equal(a.player.kit.energy, energy - WEAPONS.pistol.energy);
  a.step(sec(0.6), { attack: false });
  assert.equal(hits(a, z).length, 1);
  assert.equal(a.events(EVENTS.WEAPON_USED)[0].weapon, 'pistol');
});

test('에너지가 모자라면 쏘지 못하고 알림이 나가며, 대신 개머리판으로 친다', () => {
  const a = arena();
  arm(a, 'sniper');
  a.player.kit.energy = WEAPONS.sniper.energy - 1;
  const z = dummy(a, 11.6, 7.5);
  a.step(sec(1.2), { attack: true });
  assert.equal(a.state.projectiles.length, 0);
  assert.equal(a.events(EVENTS.PROJECTILE_FIRED).length, 0);
  assert.ok(a.events(EVENTS.ENERGY_EMPTY).length >= 1 && a.events(EVENTS.ENERGY_EMPTY).length <= 2, '알림은 가끔만');
  assert.ok(hits(a, z).length >= 2, '개머리판은 맞는다');
  assert.ok(a.events(EVENTS.WEAPON_USED).every((e) => e.bash === true));
  assert.equal(a.player.kit.energy, WEAPONS.sniper.energy - 1);
});

test('수동 조준: 조준 입력이 있으면 가까운 적이 아니라 그 방향으로 쏜다', () => {
  const a = arena();
  arm(a, 'pistol');
  dummy(a, 14.5, 7.5);
  a.step(1, { attack: true, aimX: 0, aimY: 1 });
  const p = a.state.projectiles[0];
  assert.ok(Math.abs(p.vx) < 1e-9 && p.vy > 0);
  // 조준을 놓으면 다시 자동 조준.
  a.step(sec(0.4), { attack: true, aimX: 0, aimY: 0 });
  const last = a.state.projectiles[a.state.projectiles.length - 1];
  assert.ok(last.vx > 0 && Math.abs(last.vy) < 1e-9);
});

test('무기 교체: 다른 칸의 무기를 든다. 빈 칸으로는 바꾸지 않는다', () => {
  const a = arena();
  assert.deepEqual(a.player.kit.weapons, CHARACTERS.knight.weapons);
  assert.equal(swapWeapon(a.state, a.bus), true);
  assert.equal(a.player.kit.slot, 1);
  assert.deepEqual(a.events(EVENTS.WEAPON_SWAPPED).map((e) => e.weapon), ['pistol']);
  arm(a, 'sword', null);
  assert.equal(swapWeapon(a.state, a.bus), false);
  assert.equal(a.player.kit.slot, 0);
});

test('대시 공격: 대시 직후의 공격은 더 강한 공격이 되고, 한 번뿐이다', () => {
  const a = arena();
  const z = dummy(a, 14.0, 7.5);
  a.step(1, { moveX: 1, moveY: 0, dash: true });
  a.step(DASH_TICKS + 1, { moveX: 0, moveY: 0, attack: true });
  a.step(sec(0.2), { attack: true });
  const used = a.events(EVENTS.WEAPON_USED);
  assert.equal(used[0].dash, true, '첫 공격은 대시 공격');
  assert.ok(used.slice(1).every((e) => e.dash === false), '그 뒤는 기본 공격');
  const base = WEAPONS.sword.attack.effects[0].damage;
  const first = hits(a, z)[0];
  assert.ok(first.amount > base * 1.3, `대시 공격 피해 ${first.amount}`);

  // 대시가 끝나고 한참 뒤의 공격은 기본 공격이다.
  const b = arena();
  dummy(b, 14.0, 7.5);
  b.step(1, { moveX: 1, moveY: 0, dash: true });
  b.step(DASH_TICKS + sec(PLAYER.dash.attackWindow) + 4);
  b.step(2, { attack: true });
  assert.equal(b.events(EVENTS.WEAPON_USED)[0].dash, false);
});

test('준비 시간이 없는 무기는 쏘면서 움직일 수 있고, 무거운 무기는 휘두르는 동안 서 있는다', () => {
  const a = arena();
  arm(a, 'pistol');
  dummy(a, 20.5, 7.5);
  a.step(sec(1), { moveX: 0, moveY: 1, attack: true });
  assert.ok(a.player.y > 7.5 + a.player.speed * 0.9);

  const b = arena();
  arm(b, 'greatsword');
  dummy(b, 12.0, 7.5);
  b.step(sec(1), { moveX: 0, moveY: 1, attack: true });
  assert.ok(b.player.y < 7.5 + b.player.speed * 0.8, '준비·경직 동안은 움직이지 못한다');
});

// ── 캐릭터 스킬 ──

test('기사 스킬(쌍수 사격): 지속시간 동안 다른 손의 무기도 함께 나가고 에너지를 쓰지 않는다', () => {
  const a = arena();
  const z = dummy(a, 12.0, 7.5);
  const energy = a.player.kit.energy;
  a.step(1, { skill: true });
  assert.equal(a.events(EVENTS.SKILL_USED)[0].type, 'dual');
  a.step(sec(1), { attack: true });
  const used = a.events(EVENTS.WEAPON_USED);
  assert.ok(used.some((e) => e.weapon === 'sword' && !e.offhand));
  assert.ok(used.some((e) => e.weapon === 'pistol' && e.offhand), '다른 손의 권총도 나간다');
  assert.ok(a.events(EVENTS.PROJECTILE_FIRED).length >= 2);
  assert.equal(a.player.kit.energy, energy, '에너지를 쓰지 않는다');
  assert.ok(hits(a, z).length >= 4);
  // 재사용 대기 중에는 다시 쓰지 못하고, 지속시간이 끝나면 한 손만 나간다.
  a.step(sec(CHARACTERS.knight.skills[0].duration), { attack: false, skill: true });
  assert.equal(a.events(EVENTS.SKILL_USED).length, 1);
  const before = a.events(EVENTS.WEAPON_USED).length;
  a.step(sec(0.5), { attack: true, skill: false });
  assert.ok(a.events(EVENTS.WEAPON_USED).slice(before).every((e) => !e.offhand));
});

test('마법사 스킬(시간 왜곡): 장판 안의 적과 적의 탄이 느려진다', () => {
  const a = arena({ meta: mageMeta, character: 'mage' });
  assert.equal(a.player.kit.character, 'mage');
  assert.deepEqual(a.player.kit.weapons, CHARACTERS.mage.weapons);
  const skeleton = a.enemy('skeleton', { x: 15.5, y: 7.5 }, { alerted: true });
  a.step(1, { skill: true });
  const field = a.state.hazards.find((h) => h.kind === 'warp');
  assert.ok(field, '장판이 깔린다');
  assert.ok(Math.hypot(field.x - skeleton.x, field.y - skeleton.y) < 0.5, '겨눈 적의 자리');
  a.step(3);
  assert.equal(skeleton.speedMul, CHARACTERS.mage.skills[0].slow);
  // 장판 안에서 쏜 적의 탄은 느리게 난다.
  const fast = spawnProjectile(a.state, a.bus, skeleton, { speed: 10, radius: 0.2, range: 30, damage: 1 }, 0, 1, { x: field.x, y: field.y });
  const y0 = fast.y;
  a.step(6);
  assert.ok(Math.abs(fast.y - y0 - 10 * 0.1 * CHARACTERS.mage.skills[0].slow) < 0.02, `탄이 간 거리 ${(fast.y - y0).toFixed(3)}`);
  // 장판이 사라지면 원래대로.
  a.step(sec(CHARACTERS.mage.skills[0].duration) + 20);
  assert.equal(a.state.hazards.filter((h) => h.kind === 'warp').length, 0);
  assert.equal(skeleton.speedMul, 1);
});

test('해금하지 않은 캐릭터로는 시작할 수 없다(기본 캐릭터가 된다)', () => {
  const a = arena({ character: 'mage' });
  assert.equal(a.state.run.character, 'knight');
  assert.equal(a.player.kit.character, 'knight');
});

// ── 그 밖 ──

test('기절·빙결 중에는 움직이지도 공격하지도 대시하지도 못한다', () => {
  for (const id of ['stun', 'freeze']) {
    const a = arena();
    dummy(a, 12.0, 7.5);
    applyStatus(a.state, a.bus, a.player, id, { duration: 1 });
    a.step(sec(0.5), { moveX: 1, moveY: 0, attack: true, dash: true });
    assert.equal(a.player.x, 10.5, id);
    assert.equal(a.events(EVENTS.WEAPON_USED).length, 0, id);
    assert.equal(a.events(EVENTS.PLAYER_DASHED).length, 0, id);
  }
});

test('맞으면 잠깐 무적이 되고 조금 밀려난다', () => {
  const a = arena();
  const skeleton = a.enemy('skeleton', { x: 11.4, y: 7.5 }, { alerted: true });
  a.step(sec(1.2));
  const taken = hits(a, a.player);
  assert.equal(taken.length, 1);
  assert.ok(a.player.x < 10.5, '적의 반대쪽으로 밀려났다');
  assert.ok(skeleton.x > a.player.x);
});

test('플레이어가 죽으면 게임 오버가 되고 목록에는 남는다', () => {
  const a = arena();
  dealDamage(a.state, a.bus, a.player, 99999, { sourceId: null });
  a.step(1);
  assert.equal(a.state.phase, PHASE.GAME_OVER);
  assert.ok(a.state.entities.byId[a.player.id]);
  assert.equal(a.state.run.ended, true);
  assert.equal(a.events(EVENTS.RUN_ENDED)[0].victory, false);
});
