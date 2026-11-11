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

const BASES = [
  { name: '9층(일반, 전투 중)', ...sampleSave({ floor: 9, ticks: 300 }) },
  { name: '15층(중간보스)', ...sampleSave({ floor: 15, ticks: 300 }) },
];

/** 읽은 결과로 이어해서 잠시 돌린다. 예외 없이 돌아야 하고, 돌린 뒤의 상태도 온전해야 한다. */
function survive(read, label) {
  const resumed = resumeGame({ run: read, meta: null });
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
  for (const group of ['text', 'env', 'core', 'prog', 'inv', 'world', 'actor', 'floor']) assert.ok(groups[group] >= 5, `${group} 묶음이 ${groups[group] ?? 0}개`);
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

test('건져 내기: 틀린 항목만 버리고 나머지(장비·금화·유물·강화·경험치)는 남긴다', () => {
  const base = BASES[0];
  const find = (id) => CASES.find((c) => c.id === id);
  const inv = base.data.inventory;

  // 장비 하나가 깨지면 그 장비만 빠진다.
  const item = readRun(find('inv-item-base').corrupt(base));
  const before = inv.bag.length + Object.values(inv.equipped).filter(Boolean).length;
  const after = item.core.inventory.bag.length + Object.values(item.core.inventory.equipped).filter(Boolean).length;
  assert.equal(after, before - 1);
  assert.equal(item.core.inventory.gold, inv.gold);
  assert.deepEqual(item.core.inventory.relics, inv.relics);
  assert.deepEqual(item.core.run.upgrades, base.data.run.upgrades);
  assert.equal(item.core.run.xp, base.data.run.xp);

  // 금화가 깨지면 금화만 0 이 된다.
  const gold = readRun(find('inv-gold-negative').corrupt(base));
  assert.equal(gold.core.inventory.gold, 0);
  assert.deepEqual(gold.core.inventory.bag, inv.bag);
  assert.ok(gold.repaired.some((r) => r.startsWith('inventory')));

  // 모르는 강화는 버리고 나머지 강화는 남는다.
  const upgrade = readRun(find('prog-upgrade-unknown').corrupt(base));
  assert.deepEqual(upgrade.core.run.upgrades, base.data.run.upgrades);

  // 체크섬이 틀린 경우: 본문의 값은 믿지 않고 검사해서 쓴다(검사를 통과한 값만 남는다).
  const digit = readRun(find('text-digit').corrupt(base));
  assert.equal(digit.checksumOk, false);
  assert.equal(digit.core.run.level, base.data.run.level);

  // 행동체가 깨졌으면 그 층을 처음부터 다시 만든다. 플레이어 체력은 저장된 값을 이어 쓴다.
  const actor = readRun(find('actor-type').corrupt(base));
  const game = resumeGame({ run: actor, meta: null }).game;
  assert.equal(game.state.phase, PHASE.PAUSED, '다시 만든 층은 일시정지로 시작한다');
  assert.equal(getPlayer(game.state).hp, Math.min(getPlayer(game.state).maxHp, base.data.entities.byId[base.data.playerId].hp));
  assert.equal(game.state.world.floor, base.data.run.floor);
});

test('건져 내기: 제시된 채로 저장된 강화 후보는 다시 제시된다', () => {
  const base = BASES[0];
  const data = structuredClone(base.data);
  data.run.choice = { options: [{ kind: 'upgrade', id: 'sharpness' }] };
  data.world.zoneId = 'moon'; // 층을 다시 만들게 한다.
  const read = readRun(JSON.stringify({ ...JSON.parse(base.text), data, checksum: 'x' }));
  assert.equal(read.status, 'salvage');
  const game = resumeGame({ run: read, meta: null }).game;
  assert.notEqual(game.state.run.choice, null);
  assert.equal(game.state.run.pendingChoices, base.data.run.pendingChoices);
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
});
