import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PHASE } from '../../../src/logic/core/state.js';
import { getPlayer } from '../../../src/logic/entities/actors.js';
import { resumeGame, setPhase } from '../../../src/logic/game.js';
import { readRun } from '../../../src/logic/save/codec.js';
import { validateRunState } from '../../../src/logic/save/validate.js';
import { CASES, groupOf } from '../../../scripts/lib/save-cases.js';
import { findBadNumber } from '../../../scripts/lib/save-sim.js';
import { Rng, play, sampleSave } from '../../helpers/save.js';

/** 캐릭터 해금이 들어 있는 메타(마법사 표본을 이어하려면 필요하다). */
const META = { version: 2, souls: 0, upgrades: {}, characters: { mage: true } };

const BASES = [
  { name: '기사, 전투 중', ...sampleSave({ seed: 'corrupt-a' }) },
  { name: '마법사, 판 후반의 전투', ...sampleSave({ seed: 'corrupt-b', minTick: 6000, character: 'mage', meta: { version: 2, souls: 0, upgrades: {}, characters: { mage: true } } }) },
];

/** 읽은 결과로 이어해서 잠시 돌린다. 예외 없이 돌아야 하고, 돌린 뒤의 상태도 온전해야 한다. */
function survive(read, label) {
  const resumed = resumeGame({ run: read, meta: META });
  if (!resumed) return null;
  const { game } = resumed;
  setPhase(game, PHASE.PLAYING);
  play(game, Rng.fromSeed(`survive:${label}`), 180);
  if (!game.state.run.ended) assert.deepEqual(validateRunState(game.state), [], label);
  assert.equal(findBadNumber(game.state), null, label);
  return game;
}

test(`손상 케이스 ${CASES.length}가지: 묶음마다 충분히 있다`, () => {
  const groups = {};
  for (const c of CASES) groups[groupOf(c)] = (groups[groupOf(c)] ?? 0) + 1;
  assert.ok(CASES.length >= 20);
  assert.equal(new Set(CASES.map((c) => c.id)).size, CASES.length, 'id 가 겹친다');
  for (const group of ['text', 'env', 'core', 'prog', 'kit', 'world', 'actor', 'floor']) assert.ok(groups[group] >= 5, `${group} 묶음이 ${groups[group] ?? 0}개`);
});

for (const base of BASES) {
  test(`손상 케이스 전부(${base.name}): 기대한 대로 읽히고, 이어한 게임이 죽지 않는다`, () => {
    for (const c of CASES) {
      const label = `${c.id} (${c.title})`;
      const text = c.corrupt(base);
      let read;
      assert.doesNotThrow(() => { read = readRun(text); }, label);
      assert.equal(read.status, c.expect, `${label}: ${read.reason ?? ''} ${(read.problems ?? []).slice(0, 2).join(' / ')}`);
      if (read.status === 'none') assert.equal(typeof read.reason, 'string', label);
      if (read.status === 'salvage') {
        assert.equal(read.damaged, true, `${label}: 손상으로 표시돼야 한다`);
        assert.ok(read.problems.length > 0, `${label}: 무엇이 틀렸는지 알려야 한다`);
        // 핵심(시드·층)은 원래 것이다.
        assert.equal(read.core.seed, base.data.seed, label);
        assert.equal(read.core.run.floor, base.data.run.floor, label);
      }
      if (read.status === 'salvage' || read.status === 'exact') {
        const game = survive(read, label);
        assert.equal(game.state.seed, base.data.seed, label);
        assert.equal(game.state.run.floor, base.data.run.floor, label);
      }
    }
  });
}

test('손상 세이브의 "__proto__"·"constructor" 같은 키가 객체 원형을 오염시키지 않는다', () => {
  for (const c of CASES.filter((x) => /proto|constructor/.test(x.id + x.title))) readRun(c.corrupt(BASES[0]));
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
});

test('건져 내기: 틀린 항목만 버리고 나머지(무기·축복·금화·기록)는 남긴다', () => {
  const base = BASES[1];
  const find = (id) => CASES.find((c) => c.id === id);
  const run = base.data.run;
  const kit = base.data.entities.byId[base.data.playerId].kit;
  assert.ok(run.boons.length > 0 && run.gold > 0, '표본에 축복과 금화가 있다');

  // 금화가 깨지면 금화만 0 이 된다.
  const gold = readRun(find('prog-gold-negative').corrupt(base));
  assert.equal(gold.core.run.gold, 0);
  assert.deepEqual(gold.core.run.boons, run.boons);
  assert.deepEqual(gold.core.kit.weapons, kit.weapons);
  assert.deepEqual(gold.repaired, ['run.gold']);

  // 모르는 축복·겹친 축복은 버리고 나머지 축복은 남는다.
  for (const id of ['prog-boon-unknown', 'prog-boon-proto', 'prog-boon-duplicate']) {
    const read = readRun(find(id).corrupt(base));
    assert.deepEqual(read.core.run.boons.filter((b) => run.boons.includes(b)), run.boons, id);
    assert.equal(new Set(read.core.run.boons).size, read.core.run.boons.length, id);
    assert.equal(read.core.run.gold, run.gold, id);
  }

  // 모르는 무기는 그 칸만 비우고, 든 칸이 비면 다른 칸을 든다.
  const weapon = readRun(find('kit-weapon-unknown').corrupt(base));
  assert.deepEqual(weapon.core.kit.weapons, [null, kit.weapons[1]]);
  assert.equal(weapon.core.kit.slot, 1);
  // 무기가 하나도 남지 않으면 캐릭터의 시작 무기로 돌아간다.
  const none = readRun(find('kit-weapons-empty').corrupt(base));
  assert.equal(none.core.kit, null);
  const rebuilt = resumeGame({ run: none, meta: META }).game;
  assert.deepEqual(getPlayer(rebuilt.state).kit.weapons, ['staff', 'dagger']);

  // 모르는 캐릭터는 기본 캐릭터가 된다.
  const character = readRun(find('prog-character-unknown').corrupt(base));
  assert.equal(character.core.run.character, 'knight');

  // 체크섬이 틀린 경우: 본문의 값은 믿지 않고 검사해서 쓴다(검사를 통과한 값만 남는다).
  const digit = readRun(find('text-digit').corrupt(base));
  assert.equal(digit.checksumOk, false);
  assert.deepEqual(digit.core.run.boons, run.boons);

  // 행동체가 깨졌으면 그 층을 처음부터 다시 만든다. 플레이어의 체력·무기·에너지·축복·금화는 저장된 값을 이어 쓴다.
  const actor = readRun(find('actor-type').corrupt(base));
  const game = resumeGame({ run: actor, meta: META }).game;
  const player = getPlayer(game.state);
  const saved = base.data.entities.byId[base.data.playerId];
  assert.equal(game.state.phase, PHASE.PAUSED, '다시 만든 층은 일시정지로 시작한다');
  assert.equal(player.hp, Math.min(player.maxHp, saved.hp));
  assert.deepEqual(player.kit.weapons, saved.kit.weapons);
  assert.equal(player.kit.slot, saved.kit.slot);
  assert.equal(player.kit.energy, Math.min(player.kit.maxEnergy, saved.kit.energy));
  assert.deepEqual(game.state.run.boons, run.boons);
  assert.equal(game.state.run.gold, run.gold);
  assert.equal(game.state.run.character, 'mage');
  assert.equal(game.state.run.roomsCleared, run.roomsCleared);
  // 방의 진행은 처음으로 돌아간다: 플레이어는 시작 방에 있고 전투 중인 방이 없다.
  assert.equal(game.state.encounter, null);
  assert.ok(game.state.world.rooms.every((r) => r.state !== 'active'));
  assert.deepEqual([player.x, player.y], [game.state.world.start.x + 0.5, game.state.world.start.y + 0.5]);
  assert.deepEqual(validateRunState(game.state), []);
});

test('건져 내기: 해금이 사라진 캐릭터의 런은 기본 캐릭터로 이어한다', () => {
  const base = BASES[1];
  const read = readRun(CASES.find((c) => c.id === 'actor-type').corrupt(base));
  const game = resumeGame({ run: read, meta: null }).game;
  assert.equal(game.state.run.character, 'knight');
  // 시작 캐릭터의 탈은 기본 캐릭터의 것으로 바뀐다. 판 중에 주운 다른 탈은 그대로 남는다.
  const { kit } = getPlayer(game.state);
  assert.ok(!kit.forms.includes('mage') && kit.character !== 'mage');
  assert.ok(kit.forms.includes('knight'));
  assert.deepEqual(validateRunState(game.state), []);
});

test('건져 내기: 제시된 채로 저장된 축복 3택1 은 다시 제시된다', () => {
  const base = BASES[0];
  const data = structuredClone(base.data);
  data.run.choice = { kind: 'boon', options: ['chain', 'pierce', 'split'], rerolls: 1 };
  data.world.zoneId = 'moon'; // 층을 다시 만들게 한다.
  const read = readRun(JSON.stringify({ ...JSON.parse(base.text), data, checksum: 'x' }));
  assert.equal(read.status, 'salvage');
  assert.equal(read.core.pendingChoice, true);
  const game = resumeGame({ run: read, meta: null }).game;
  assert.notEqual(game.state.run.choice, null);
  assert.equal(game.state.run.choice.options.length, 3);
  assert.equal(game.state.run.choice.rerolls, 0);
});

test('건져 낸 런의 난수 수열은 저장된 위치에서 이어진다(키는 시드에서 다시 만든다)', () => {
  const base = BASES[0];
  const read = readRun(CASES.find((c) => c.id === 'actor-type').corrupt(base));
  assert.deepEqual(read.core.rng.items, base.data.rng.items.s);
  // 키가 망가져 있어도 시드에서 다시 만든 키를 쓴다.
  const data = structuredClone(base.data);
  data.rng.items.key = [1, 2, 3, 4];
  data.world = null;
  const again = readRun(JSON.stringify({ ...JSON.parse(base.text), data, checksum: 'x' }));
  const game = resumeGame({ run: again, meta: null }).game;
  assert.deepEqual(game.state.rng.items.key, base.data.rng.items.key);
  assert.deepEqual(game.state.rng.combat.s, base.data.rng.combat.s);
});
