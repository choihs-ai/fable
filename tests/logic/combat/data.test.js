// 전투 데이터(data/enemies.js, bosses.js, player.js)가 서로 맞물리는지 확인한다.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BOSSES } from '../../../data/bosses.js';
import { ENEMIES } from '../../../data/enemies.js';
import { BOONS, BOON_RULES, FAMILIES } from '../../../data/boons.js';
import { CHARACTERS, CHARACTER_ORDER } from '../../../data/characters.js';
import { PLAYER } from '../../../data/player.js';
import { WEAPONS, WEAPON_ORDER } from '../../../data/weapons.js';
import { PLAYER_DEF, weaponAbilityId } from '../../../src/logic/entities/defs.js';
import { STATUSES } from '../../../data/statuses.js';
import { ZONES } from '../../../data/zones.js';
import { BEHAVIORS } from '../../../src/logic/combat/ai/behaviors.js';

const EFFECT_TYPES = ['arc', 'circle', 'projectile', 'hazard', 'dash', 'summon', 'teleport', 'die'];

function checkAbility(owner, id, ability) {
  const where = `${owner}.${id}`;
  for (const key of ['windup', 'recovery', 'cooldown', 'range', 'minRange']) {
    if (ability[key] !== undefined) assert.ok(typeof ability[key] === 'number' && ability[key] >= 0, `${where}.${key}`);
  }
  if (ability.range !== undefined && ability.minRange !== undefined) assert.ok(ability.minRange < ability.range, `${where}: minRange < range`);
  assert.ok(Array.isArray(ability.effects) && ability.effects.length > 0, `${where}.effects`);
  for (const effect of ability.effects) checkEffect(where, effect);
}

function checkEffect(where, effect) {
  assert.ok(EFFECT_TYPES.includes(effect.type), `${where}: 효과 종류 ${effect.type}`);
  if (effect.damage !== undefined) assert.ok(Number.isInteger(effect.damage) && effect.damage > 0, `${where}: 피해는 양의 정수`);
  if (effect.status) {
    assert.ok(STATUSES[effect.status.id], `${where}: 상태이상 ${effect.status.id}`);
    if (effect.status.chance !== undefined) assert.ok(effect.status.chance > 0 && effect.status.chance <= 1, `${where}: 확률`);
  }
  if (effect.type === 'arc') assert.ok(effect.range > 0 && effect.cosHalf >= -1 && effect.cosHalf <= 1, `${where}: 부채꼴`);
  if (effect.type === 'circle' || effect.type === 'hazard') assert.ok(effect.radius > 0, `${where}: 반지름`);
  if (effect.type === 'projectile') {
    assert.ok(effect.speed > 0 && effect.radius > 0 && effect.range > 0, `${where}: 투사체`);
    for (const [c, s] of effect.spread ?? []) {
      assert.ok(Math.abs(c * c + s * s - 1) < 2e-3, `${where}: 회전값 [${c}, ${s}] 의 길이가 1 이 아님`);
    }
  }
  if (effect.type === 'dash') assert.ok(effect.speed > 0 && effect.distance > 0, `${where}: 돌진`);
  if (effect.type === 'summon') {
    assert.ok(ENEMIES[effect.enemy], `${where}: 소환 대상 ${effect.enemy}`);
    assert.ok(Number.isInteger(effect.count) && effect.count > 0, `${where}: 소환 수`);
  }
  if (effect.type === 'teleport') assert.ok(effect.min >= 0 && effect.max > effect.min, `${where}: 순간이동 거리`);
}

function checkActor(id, def) {
  assert.ok(typeof def.name === 'string' && def.name.length > 0, `${id}.name`);
  assert.ok(Number.isInteger(def.hp) && def.hp > 0, `${id}.hp`);
  assert.ok(def.speed > 0, `${id}.speed`);
  assert.ok(def.radius > 0, `${id}.radius`);
  for (const status of def.immune ?? []) assert.ok(STATUSES[status], `${id}.immune ${status}`);
  for (const [status, value] of Object.entries(def.statusResist ?? {})) {
    assert.ok(STATUSES[status] && value >= 0 && value <= 1, `${id}.statusResist.${status}`);
  }
  for (const [abilityId, ability] of Object.entries(def.abilities)) checkAbility(id, abilityId, ability);
}

test('구역 데이터가 가리키는 적과 보스가 모두 정의되어 있다', () => {
  for (const zone of ZONES) {
    for (const enemy of zone.enemies) assert.ok(ENEMIES[enemy.id], `${zone.id}: 적 ${enemy.id}`);
    if (zone.boss) assert.ok(BOSSES[zone.boss.id], `${zone.id}: 보스 ${zone.boss.id}`);
  }
  assert.equal(Object.keys(ENEMIES).filter((id) => BOSSES[id]).length, 0, '적과 보스의 id 는 겹치지 않는다');
});

test('적은 8종 이상이고, 서로 다른 행동 방식이 8가지 이상이다', () => {
  const kinds = new Set(Object.values(ENEMIES).map((e) => e.ai));
  assert.ok(Object.keys(ENEMIES).length >= 8);
  assert.ok(kinds.size >= 8, `행동 방식 ${kinds.size}가지: ${[...kinds]}`);
  for (const required of ['melee', 'ranged', 'charger', 'summoner', 'skirmisher', 'exploder', 'tank', 'teleporter']) {
    assert.ok(kinds.has(required), `${required} 방식의 적이 없음`);
  }
  for (const kind of kinds) assert.equal(typeof BEHAVIORS[kind], 'function', `행동 함수 ${kind}`);
});

test('적 데이터: 수치가 유효하고, 행동 방식이 쓰는 기술이 모두 있다', () => {
  for (const [id, def] of Object.entries(ENEMIES)) {
    checkActor(id, def);
    assert.ok(def.radius < 0.5, `${id}: 일반 적의 반지름은 0.5 미만(한 칸 폭 복도를 지나야 한다)`);
    for (const [key, value] of Object.entries(def.aiParams)) {
      if (typeof value === 'string') assert.ok(def.abilities[value], `${id}.aiParams.${key} → 기술 "${value}" 없음`);
    }
    for (const effect of def.onDeath ?? []) checkEffect(`${id}.onDeath`, effect);
    if (def.block) assert.ok(def.block.factor > 0 && def.block.factor < 1 && def.block.cosHalf > -1 && def.block.cosHalf < 1, `${id}.block`);
  }
});

test('행동 방식별 필수 항목', () => {
  const need = {
    melee: ['attack'], ranged: ['attack', 'min', 'max'], charger: ['charge', 'melee'], summoner: ['summon', 'attack', 'keep', 'flee'],
    skirmisher: ['attack', 'retreatSec', 'retreatDist', 'fleeHp', 'fleeSec'], exploder: ['attack'], tank: ['bash', 'slam', 'turnRate'],
    teleporter: ['blink', 'attack', 'near', 'blinkEvery'], ambusher: ['leap', 'bite'], swooper: ['dive', 'melee', 'orbit'],
  };
  for (const [id, def] of Object.entries(ENEMIES)) {
    for (const key of need[def.ai]) assert.ok(def.aiParams[key] !== undefined, `${id}.aiParams.${key}`);
  }
});

test('거리 구간에 빈틈이 없다: 가까이 붙었을 때 쓸 기술이 반드시 있다', () => {
  for (const [id, def] of Object.entries(ENEMIES)) {
    const p = def.aiParams;
    if (def.ai === 'swooper') {
      // 강습의 최소 거리보다 가까우면 근접 공격이 닿아야 한다(그 사이 거리에서 아무것도 못 하는 구간이 없어야 한다).
      assert.ok(def.abilities[p.melee].range >= def.abilities[p.dive].minRange, `${id}: 근접 사거리 < 강습 최소 거리`);
    }
    if (def.ai === 'charger') assert.ok(def.abilities[p.melee].range <= def.abilities[p.charge].minRange, `${id}: 돌진 최소 거리 안에서는 근접`);
    if (def.ai === 'ambusher') assert.ok(def.abilities[p.bite].range <= def.abilities[p.leap].minRange, `${id}`);
    if (def.ai === 'ranged') assert.ok(p.min < p.max && def.abilities[p.attack].range >= p.max, `${id}: 유지 거리에서 쏠 수 있어야 한다`);
    if (def.ai === 'summoner') assert.ok(p.flee < p.keep && def.abilities[p.attack].range >= p.keep, `${id}`);
    if (def.ai === 'exploder') assert.ok(def.abilities[p.attack].effects.some((e) => e.type === 'die'), `${id}: 자폭 기술은 스스로 죽어야 한다`);
    // 근접 부채꼴은 "쓰는 거리"보다 조금 더 멀리 닿아야 헛치지 않는다.
    for (const [abilityId, ability] of Object.entries(def.abilities)) {
      const arc = ability.effects.find((e) => e.type === 'arc');
      if (arc && ability.range !== undefined) assert.ok(arc.range >= ability.range, `${id}.${abilityId}: 닿는 거리 < 쓰는 거리`);
    }
  }
});

test('보스: 구역마다 하나 — 중간보스 5종과 최종보스 1종, 최종보스는 페이즈가 2개 이상', () => {
  const mids = ZONES.filter((z) => z.boss?.kind === 'mid').map((z) => z.boss.id);
  const finals = ZONES.filter((z) => z.boss?.kind === 'final').map((z) => z.boss.id);
  assert.equal(mids.length, 5);
  assert.equal(finals.length, 1);
  assert.equal(new Set([...mids, ...finals]).size, 6);
  assert.equal(ZONES.at(-1).boss.kind, 'final', '마지막 구역의 보스가 최종보스');
  assert.deepEqual(Object.keys(BOSSES).sort(), [...mids, ...finals].sort());
  assert.ok(BOSSES[finals[0]].phases.length >= 2);
});

test('보스 데이터: 페이즈 경계가 내려가며 0 으로 끝나고, 패턴이 가리키는 기술이 모두 있다', () => {
  for (const [id, def] of Object.entries(BOSSES)) {
    checkActor(id, def);
    assert.ok(def.transitionSec > 0, `${id}.transitionSec`);
    assert.ok(def.phases.length >= 1);
    let previous = 1;
    def.phases.forEach((phase, i) => {
      assert.ok(phase.until < previous && phase.until >= 0, `${id} 페이즈 ${i}: until ${phase.until}`);
      previous = phase.until;
      assert.ok(['chase', 'keepAway'].includes(phase.move), `${id} 페이즈 ${i}: move`);
      if (phase.move === 'chase') assert.ok(phase.keepDist > 0, `${id} 페이즈 ${i}: keepDist`);
      else assert.ok(phase.band[0] < phase.band[1], `${id} 페이즈 ${i}: band`);
      assert.ok(phase.pauseSec >= 0);
      assert.ok(phase.patterns.length >= 2, `${id} 페이즈 ${i}: 패턴 2개 이상`);
      for (const pattern of phase.patterns) {
        assert.ok(def.abilities[pattern.ability], `${id} 페이즈 ${i}: 기술 "${pattern.ability}" 없음`);
        assert.ok(pattern.weight > 0);
      }
      // 어떤 거리에서든 쓸 수 있는 패턴이 하나는 있어야 한다(거리 조건 때문에 아무것도 못 하는 구간이 없도록).
      for (const d of [0.5, 1.5, 2.5, 3.5, 5, 8, 12]) {
        assert.ok(phase.patterns.some((pt) => d >= (pt.minDist ?? 0) && d <= (pt.maxDist ?? Infinity)), `${id} 페이즈 ${i}: 거리 ${d} 에서 쓸 패턴이 없음`);
      }
    });
    assert.equal(def.phases.at(-1).until, 0, `${id}: 마지막 페이즈는 0 에서 끝난다`);
    const used = new Set(def.phases.flatMap((p) => p.patterns.map((pt) => pt.ability)));
    for (const abilityId of Object.keys(def.abilities)) assert.ok(used.has(abilityId), `${id}: 기술 "${abilityId}" 를 쓰는 페이즈가 없음`);
  }
});

test('보스마다 고유한 패턴 구성을 가진다', () => {
  const sets = Object.values(BOSSES).map((def) => Object.keys(def.abilities).sort().join(','));
  assert.equal(new Set(sets).size, sets.length);
  // 중간보스끼리는 기술 이름이 거의 겹치지 않는다(같은 기술의 수치만 바꾼 복제가 아니다).
  const mids = ZONES.filter((z) => z.boss?.kind === 'mid').map((z) => new Set(Object.keys(BOSSES[z.boss.id].abilities)));
  for (let i = 0; i < mids.length; i++) {
    for (let j = i + 1; j < mids.length; j++) {
      const shared = [...mids[i]].filter((x) => mids[j].has(x));
      assert.ok(shared.length <= 1, `중간보스 ${i}·${j} 가 공유하는 기술: ${shared}`);
    }
  }
});

test('플레이어 데이터: 대시는 충전식이고 무적 시간이 돌진보다 길다', () => {
  assert.ok(PLAYER.radius < 0.5);
  const { dash } = PLAYER;
  assert.ok(dash.speed > 8 && dash.charges >= 2 && dash.recharge > 0 && dash.attackWindow > 0);
  assert.ok(dash.invuln >= dash.duration, '돌진하는 동안은 내내 무적');
  assert.ok(Math.abs(dash.invuln - 0.25) < 1e-9, '무적 0.25초');
  assert.ok(Math.abs(PLAYER.inputBuffer - 0.15) < 1e-9, '입력 버퍼 150ms');
  assert.ok(PLAYER.bash.effects[0].damage > 0, '에너지가 없을 때의 근접 공격');
});

test('탈(캐릭터) 데이터: 8종 이상, 시작 무기 둘, 스킬 둘과 교체 기술 — 이름이 모두 다르다', () => {
  assert.ok(CHARACTER_ORDER.length >= 8);
  assert.deepEqual([...CHARACTER_ORDER].sort(), Object.keys(CHARACTERS).sort());
  const skills = new Set();
  for (const [id, c] of Object.entries(CHARACTERS)) {
    assert.ok(c.hp > 0 && c.speed > 0 && c.energy > 0 && c.name && c.desc, id);
    assert.equal(c.weapons.length, 2, id);
    for (const w of c.weapons) assert.ok(WEAPONS[w], `${id}: 무기 ${w}`);
    assert.equal(c.skills.length, 2, `${id}: 스킬 둘`);
    for (const skill of c.skills) {
      assert.ok(skill.cooldown > 0 && skill.name && skill.desc && skill.glyph, `${id}: ${skill.name}`);
      assert.ok(['dual', 'warp', 'cast', 'heal', 'guard'].includes(skill.type), `${id}: ${skill.type}`);
      if (skill.type === 'cast') assert.ok(skill.effects.length > 0, id);
      if (skill.type === 'heal') assert.ok(skill.pct > 0 && skill.pct <= 50, id);
      if (skill.type === 'guard') assert.ok(skill.invuln > 0, id);
      skills.add(skill.name);
    }
    assert.ok(c.swap.name && c.swap.desc && c.swap.effects.length > 0, `${id}: 교체 기술`);
    skills.add(c.swap.name);
    assert.ok(Number.isInteger(c.cost) && c.cost >= 0, id);
  }
  assert.equal(skills.size, CHARACTER_ORDER.length * 3, '스킬과 교체 기술의 이름이 모두 다르다');
  assert.ok(Object.values(CHARACTERS).some((c) => c.cost === 0), '처음부터 쓸 수 있는 캐릭터가 있다');
  assert.ok(Object.values(CHARACTERS).some((c) => c.cost > 0), '해금하는 캐릭터가 있다');
});

test('무기 데이터: 20종 이상, 원거리는 에너지를 쓰고 근접은 쓰지 않는다', () => {
  assert.ok(WEAPON_ORDER.length >= 20, `무기 ${WEAPON_ORDER.length}종`);
  assert.deepEqual([...WEAPON_ORDER].sort(), Object.keys(WEAPONS).sort());
  for (const id of ['pistol', 'shotgun', 'smg', 'sniper', 'laser', 'rocket', 'bow', 'spear', 'greatsword', 'dual_blades']) assert.ok(WEAPONS[id], id);
  const types = new Set();
  for (const [id, w] of Object.entries(WEAPONS)) {
    assert.ok(w.name && w.desc && w.look, id);
    assert.ok([1, 2, 3].includes(w.tier), id);
    assert.ok(w.kind === 'melee' || w.kind === 'ranged', id);
    if (w.kind === 'melee') assert.equal(w.energy, 0, `${id}: 근접은 무료`);
    else assert.ok(Number.isInteger(w.energy) && w.energy > 0, `${id}: 원거리는 에너지 소모`);
    for (const ability of [w.attack, w.dash].filter(Boolean)) {
      assert.ok(ability.cooldown > 0 && ability.effects.length > 0, id);
      for (const e of ability.effects) {
        types.add(e.type);
        if (e.type !== 'dash') assert.ok(e.damage > 0, `${id}: 피해`);
        // 근접의 대시 공격은 길게 가르는 것(beam)도 된다(태도의 발도).
        if (w.kind === 'melee') assert.ok(['arc', 'circle', 'dash', 'beam'].includes(e.type), `${id}: 근접 효과 ${e.type}`);
        else assert.ok(['projectile', 'beam'].includes(e.type), `${id}: 원거리 효과 ${e.type}`);
      }
    }
    // 대시 공격은 무기마다 있다(따로 정하지 않으면 기본 공격을 키운 것).
    const dash = PLAYER_DEF.abilities[weaponAbilityId(id, true)];
    const base = PLAYER_DEF.abilities[weaponAbilityId(id)];
    assert.ok(dash && base, id);
    const total = (ability) => ability.effects.reduce((sum, e) => sum + (e.damage ?? 0) * (e.spread ? e.spread.length : 1) + (e.explode ? e.explode.damage : 0), 0);
    assert.ok(total(dash) > total(base), `${id}: 대시 공격이 기본 공격보다 강하다`);
    assert.ok((dash.windup ?? 0) <= (base.windup ?? 0), `${id}: 대시 공격은 준비 시간이 더 길지 않다`);
  }
  for (const type of ['arc', 'circle', 'projectile', 'beam', 'dash']) assert.ok(types.has(type), `효과 ${type} 를 쓰는 무기가 있다`);
});

test('축복 데이터: 20종 이상, 세 계열과 합성 축복', () => {
  const ids = Object.keys(BOONS);
  assert.ok(ids.length >= 20, `축복 ${ids.length}종`);
  assert.deepEqual(Object.keys(FAMILIES).sort(), ['bolt', 'fire', 'ice']);
  const perFamily = { fire: 0, bolt: 0, ice: 0 };
  const duoPairs = new Set();
  for (const [id, b] of Object.entries(BOONS)) {
    assert.ok(b.name && b.desc && b.weight > 0, id);
    if (b.family !== null) {
      assert.ok(FAMILIES[b.family], `${id}: 계열 ${b.family}`);
      perFamily[b.family]++;
    }
    if (b.duo) {
      assert.equal(b.family, null, `${id}: 합성 축복은 계열에 속하지 않는다`);
      assert.ok(b.duo.length === 2 && b.duo[0] !== b.duo[1] && FAMILIES[b.duo[0]] && FAMILIES[b.duo[1]], id);
      duoPairs.add([...b.duo].sort().join('+'));
    }
  }
  for (const family of Object.keys(perFamily)) assert.ok(perFamily[family] >= 3, `${family} 계열 ${perFamily[family]}종`);
  assert.equal(duoPairs.size, 3, '계열 두 개의 조합 셋 모두에 합성 축복이 있다');
  assert.equal(BOON_RULES.choices, 3);
});
