// 탈 교체: 판 중에 탈을 주워 둘까지 들고, 교체하면 탈과 무기가 함께 바뀌며 교체 기술이 나간다.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CHARACTERS, CHARACTER_ORDER } from '../../data/characters.js';
import { PLAYER } from '../../data/player.js';
import { interact, interactTarget, swapWeapons } from '../../src/logic/commands.js';
import { addDrop, grantRoomReward } from '../../src/logic/combat/loot.js';
import { setInput, skillKey } from '../../src/logic/combat/player.js';
import { EVENTS } from '../../src/logic/core/events.js';
import { STATE_VERSION } from '../../src/logic/core/state.js';
import { ticksOf } from '../../src/logic/core/time.js';
import { spawnEnemy } from '../../src/logic/entities/actors.js';
import { migrate } from '../../src/logic/save/migrate.js';
import { readRun, serializeRun } from '../../src/logic/save/codec.js';
import { validateRunState } from '../../src/logic/save/validate.js';
import { resumeGame } from '../../src/logic/game.js';
import { ROOM_KIND } from '../../src/logic/world/floors.js';
import { createStage } from '../helpers/stage.js';

/** 발밑에 탈을 놓고 줍는다. */
function pick(s, form) {
  addDrop(s.state, s.bus, s.player.x + 0.3, s.player.y, { kind: 'form', form });
  return interact(s.game);
}

test('처음에는 고른 캐릭터의 탈 하나만 들고 있고, 교체해도 무기만 바뀐다', () => {
  const s = createStage({ seed: 'form-start' });
  const kit = s.player.kit;
  assert.deepEqual(kit.forms, ['knight', null]);
  assert.equal(kit.character, 'knight');
  assert.deepEqual(swapWeapons(s.game), { ok: true, slot: 1 });
  assert.equal(kit.character, 'knight');
  assert.equal(s.events(EVENTS.FORM_CHANGED).length, 0);
  assert.deepEqual(validateRunState(s.state), []);
});

test('탈 줍기: 주운 탈을 곧바로 쓰고, 쓰던 탈은 빈 칸으로 간다. 능력치가 그 탈의 것이 된다', () => {
  const s = createStage({ seed: 'form-pick' });
  const kit = s.player.kit;
  assert.deepEqual(interactTarget(s.state), null);
  const result = pick(s, 'brute');
  assert.deepEqual(result, { ok: true, type: 'form', form: 'brute', dropped: null });
  assert.deepEqual(kit.forms, ['brute', 'knight']);
  assert.equal(kit.character, 'brute');
  assert.equal(s.player.maxHp, CHARACTERS.brute.hp);
  assert.equal(s.player.speed, CHARACTERS.brute.speed);
  assert.equal(kit.maxEnergy, CHARACTERS.brute.energy);
  assert.equal(s.state.drops.length, 0);
  assert.equal(s.events(EVENTS.FORM_CHANGED).at(-1).picked, true);
  assert.deepEqual(validateRunState(s.state), []);
});

test('탈 줍기: 둘 다 차 있으면 쓰던 탈이 바닥에 놓이고, 이미 든 탈은 줍지 않는다', () => {
  const s = createStage({ seed: 'form-full' });
  pick(s, 'mage');
  const result = pick(s, 'rogue');
  assert.equal(result.dropped, 'mage');
  assert.deepEqual(s.player.kit.forms, ['rogue', 'knight']);
  assert.deepEqual(s.state.drops.map((d) => [d.kind, d.form]), [['form', 'mage']]);
  s.state.drops = [];
  assert.deepEqual(pick(s, 'knight'), { ok: false, reason: 'owned-form' });
  assert.deepEqual(validateRunState(s.state), []);
});

test('교체: 탈과 무기가 함께 바뀌고 교체 기술이 나간다. 교체 기술은 대기 시간이 있고 교체 자체는 언제나 된다', () => {
  const s = createStage({ seed: 'form-swap' });
  const kit = s.player.kit;
  pick(s, 'mage'); // [mage, knight], 칸 0
  const foe = spawnEnemy(s.state, s.bus, 'zombie', s.player.x + 1.2, s.player.y, { depth: 0 });
  const hpBefore = foe.hp;
  assert.deepEqual(swapWeapons(s.game), { ok: true, slot: 1 });
  assert.equal(kit.character, 'knight');
  const first = s.events(EVENTS.FORM_CHANGED).at(-1);
  assert.deepEqual([first.from, first.to, first.burst, first.picked], ['mage', 'knight', true, false]);
  assert.ok(foe.hp < hpBefore, '기사의 교체 기술(방패 밀치기)이 곁의 적을 때렸다');
  assert.ok(s.player.invulnUntil >= s.state.tick + ticksOf(PLAYER.swap.invuln) - 1, '교체 기술이 나가는 순간 잠깐 무적');
  assert.equal(s.player.cooldowns.swap, s.state.tick + ticksOf(PLAYER.swap.cooldown));
  // 곧바로 다시 교체: 탈은 바뀌지만 교체 기술은 나가지 않는다.
  swapWeapons(s.game);
  assert.equal(kit.character, 'mage');
  assert.equal(s.events(EVENTS.FORM_CHANGED).at(-1).burst, false);
  // 대기 시간이 지나면 다시 나간다.
  foe.dead = true;
  s.step(ticksOf(PLAYER.swap.cooldown) + 1);
  swapWeapons(s.game);
  assert.equal(s.events(EVENTS.FORM_CHANGED).at(-1).burst, true);
  assert.deepEqual(validateRunState(s.state), []);
});

test('교체로 체력·에너지를 회복할 수 없다: 잃은 양을 그대로 가져간다', () => {
  const s = createStage({ seed: 'form-hp' });
  const kit = s.player.kit;
  pick(s, 'brute'); // [brute, knight]
  s.player.hp = s.player.maxHp - 50;
  kit.energy = kit.maxEnergy - 30;
  for (let i = 0; i < 6; i++) {
    swapWeapons(s.game);
    assert.equal(s.player.maxHp - s.player.hp, 50, `교체 ${i + 1}회`);
    assert.equal(kit.maxEnergy - kit.energy, 30, `교체 ${i + 1}회`);
  }
  // 새 탈의 최대 체력이 잃은 양보다 작으면 1 에서 멈추고, 돌아오면 원래 체력이다(오가며 늘지 않는다).
  assert.equal(kit.character, 'brute');
  s.player.hp = 5;
  kit.energy = 0;
  swapWeapons(s.game);
  assert.equal(s.player.hp, 1);
  assert.equal(kit.hpDebt, 130 - (CHARACTERS.knight.hp - 1));
  for (let i = 0; i < 5; i++) swapWeapons(s.game);
  assert.equal(kit.character, 'brute');
  assert.equal(s.player.hp, 5);
  assert.equal(kit.energy, 0);
  assert.equal(kit.hpDebt, 0);
  assert.deepEqual(validateRunState(s.state), []);
});

test('스킬의 재사용 대기는 탈마다 따로 센다', () => {
  const s = createStage({ seed: 'form-skill' });
  pick(s, 'rogue'); // [rogue, knight]
  s.step(1, { skill: true });
  s.step(2);
  assert.ok(s.player.cooldowns[skillKey('rogue')] > s.state.tick, '도적의 스킬을 썼다');
  assert.ok(s.state.projectiles.length >= 7, '칼날 부채: 칼날 일곱 자루');
  swapWeapons(s.game);
  setInput(s.state, { skill: true });
  s.step(3);
  assert.ok(s.player.kit.dualUntil > s.state.tick, '기사의 스킬(쌍수 사격)은 따로 준비돼 있다');
});

test('정예 방을 깨면 들고 있지 않은 탈이 하나 떨어진다', () => {
  const s = createStage({ seed: 'form-elite', need: (map) => map.rooms.some((r) => r.kind === ROOM_KIND.ELITE) });
  grantRoomReward(s.state, s.bus, s.room(ROOM_KIND.ELITE));
  const forms = s.state.drops.filter((d) => d.kind === 'form');
  assert.equal(forms.length, 1);
  assert.ok(CHARACTER_ORDER.includes(forms[0].form) && forms[0].form !== 'knight');
  assert.deepEqual(validateRunState(s.state), []);
});

test('저장 왕복: 탈 둘을 든 판이 그대로 이어진다', () => {
  const s = createStage({ seed: 'form-save' });
  pick(s, 'mage');
  swapWeapons(s.game);
  const saved = serializeRun(s.state, 1);
  assert.equal(saved.ok, true);
  const read = readRun(saved.text);
  assert.equal(read.status, 'exact');
  const game = resumeGame({ run: read, meta: s.state.meta }).game;
  const kit = game.state.entities.byId[game.state.playerId].kit;
  assert.deepEqual(kit.forms, ['mage', 'knight']);
  assert.equal(kit.character, 'knight');
});

test('v5 세이브(탈 교체 이전)는 v6 으로 올라온다: 쓰던 캐릭터가 든 칸의 탈이 되고 스킬 대기가 옮겨진다', () => {
  const s = createStage({ seed: 'form-migrate' });
  s.player.cooldowns[skillKey('knight')] = s.state.tick + 100;
  const old = JSON.parse(JSON.stringify(s.state));
  delete old.meta;
  old.version = 5;
  const kit = old.entities.byId[old.playerId].kit;
  delete kit.forms;
  old.entities.byId[old.playerId].cooldowns = { skill: old.tick + 100 };
  const moved = migrate('run', old, 5);
  assert.equal(moved.ok, true);
  assert.equal(moved.data.version, STATE_VERSION);
  assert.deepEqual(moved.data.entities.byId[old.playerId].kit.forms, ['knight', null]);
  assert.deepEqual(moved.data.entities.byId[old.playerId].cooldowns, { [skillKey('knight')]: old.tick + 100 });
  assert.deepEqual(validateRunState({ ...moved.data, meta: s.state.meta }), []);
});

// ── 스킬 둘 ──

/** 이 탈을 쓴 채로 시작하는 무대(해금은 건너뛴다). */
function stageAs(form, seed) {
  const s = createStage({ seed, meta: { version: 2, souls: 0, upgrades: {}, characters: { knight: true, [form]: true } }, character: form });
  assert.equal(s.player.kit.character, form);
  return s;
}

test('탈마다 스킬이 둘이고, 두 번째 스킬은 skill2 입력으로 나가며 대기 시간을 따로 센다', () => {
  for (const form of CHARACTER_ORDER) {
    const s = stageAs(form, `skill2-${form}`);
    s.step(1, { skill2: true });
    s.step(2);
    assert.ok(s.player.cooldowns[skillKey(form, 1)] > s.state.tick, `${form}: 두 번째 스킬의 대기가 돈다`);
    assert.equal(s.player.cooldowns[skillKey(form, 0)] ?? 0, 0, `${form}: 첫 번째 스킬은 그대로 준비돼 있다`);
    assert.equal(s.events(EVENTS.SKILL_USED).at(-1).index, 1);
    assert.equal(s.state.input.skill2, false, '한 번 처리되면 지워진다');
    s.step(24); // 돌진하는 스킬(투사의 돌격, 광대의 재주넘기)이 끝날 때까지 기다린다 — 돌진 중에 누른 입력은 버퍼가 끝나면 사라진다.
    setInput(s.state, { skill: true });
    s.step(40);
    assert.ok(s.player.cooldowns[skillKey(form, 0)] > 0, `${form}: 첫 번째 스킬도 나간다`);
    assert.deepEqual(validateRunState(s.state), [], `${form}: 스킬을 쓴 뒤의 상태가 저장된다`);
  }
});

test('회복 스킬(무당의 굿): 최대 체력의 정해진 비율만큼 회복한다', () => {
  const s = stageAs('shaman', 'skill-heal');
  s.player.hp = 30;
  s.step(1, { skill: true });
  s.step(2);
  assert.equal(s.player.hp, 30 + Math.round((s.player.maxHp * CHARACTERS.shaman.skills[0].pct) / 100));
  assert.equal(s.events(EVENTS.PLAYER_HEALED).length, 1);
});

test('수호 스킬(기사): 잠깐 무적이 되고 둘레의 적 탄이 지워진다', () => {
  const s = stageAs('knight', 'skill-guard');
  const skill = CHARACTERS.knight.skills[1];
  s.state.projectiles.push({
    id: s.state.entities.nextId++, ownerId: 999, faction: 'enemy', x: s.player.x + 1, y: s.player.y, vx: 0, vy: 0, radius: 0.2, damage: 5, power: 1,
    knockback: 0, status: null, left: 5, pierce: 0, hit: [], explode: null, bounces: 0, split: false, proc: true,
  });
  s.step(1, { skill2: true });
  s.step(1);
  assert.ok(s.player.invulnUntil >= s.state.tick + ticksOf(skill.invuln) - 3);
  assert.equal(s.state.projectiles.filter((p) => p.faction === 'enemy').length, 0);
});

test('발밑에 까는 스킬(포수의 화약통): 장판이 플레이어 자리에 깔리고 잠시 뒤 터져 곁의 적을 다치게 한다', () => {
  const s = stageAs('gunner', 'skill-self');
  const foe = spawnEnemy(s.state, s.bus, 'zombie', s.player.x + 1.5, s.player.y, { depth: 0 });
  const before = foe.hp;
  const px = s.player.x;
  s.step(1, { skill2: true });
  s.step(1);
  const hz = s.state.hazards.at(-1);
  assert.ok(Math.abs(hz.x - px) < 0.2 && hz.faction === 'player');
  s.step(ticksOf(CHARACTERS.gunner.skills[1].effects[0].delay) + 4);
  assert.ok(foe.hp < before || foe.dead);
});

test('v6 세이브(스킬 하나)는 v7 로 올라온다: 입력에 skill2 가 생긴다', () => {
  const s = createStage({ seed: 'form-migrate7' });
  const old = JSON.parse(JSON.stringify(s.state));
  delete old.meta;
  old.version = 6;
  delete old.input.skill2;
  const moved = migrate('run', old, 6);
  assert.equal(moved.ok, true);
  assert.equal(moved.data.input.skill2, false);
  assert.deepEqual(validateRunState({ ...moved.data, meta: s.state.meta }), []);
});
