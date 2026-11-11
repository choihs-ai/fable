// 전투 시뮬레이션의 축소판. 전체 검증은 scripts/sim-combat.mjs (종류마다 2000회).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BOSSES } from '../../../data/bosses.js';
import { setInput } from '../../../src/logic/combat/player.js';
import { tick } from '../../../src/logic/game.js';
import { DT, MODES, allTypes, createBot, driveBot, runDuel, setupDuel } from '../../../scripts/lib/combat-sim.js';

const { enemies, bosses } = allTypes();
const describe = (r) => r.issues.map((i) => `${i.code}@${i.tick}: ${i.detail}`).join('\n');

test('모든 적: 방식별 대결에서 문제가 없다(끼임·멈춤·벽 겹침·상태이상 위반·예외)', () => {
  for (const type of enemies) {
    for (const [mode, count] of [[MODES.FIGHT, 3], [MODES.PASSIVE, 2], [MODES.KITE, 2], [MODES.WANDER, 2]]) {
      for (let n = 0; n < count; n++) {
        const seed = `t-${type}-${mode}-${n}`;
        const r = runDuel({ seed, type, mode });
        assert.deepEqual(r.issues, [], `시드 "${seed}"\n${describe(r)}`);
        if (mode === MODES.FIGHT) assert.ok(['enemyDead', 'playerDead'].includes(r.outcome), `시드 "${seed}": ${r.outcome}`);
        if (mode === MODES.KITE) assert.ok(['leashed', 'playerDead', 'enemyDead'].includes(r.outcome), `시드 "${seed}": ${r.outcome}`);
      }
    }
  }
});

test('모든 보스: 끝까지 싸우면 모든 페이즈를 순서대로 거치고 문제가 없다', () => {
  for (const type of bosses) {
    for (let n = 0; n < 2; n++) {
      const seed = `t-${type}-tanky-${n}`;
      const r = runDuel({ seed, type, mode: MODES.TANKY });
      assert.deepEqual(r.issues, [], `시드 "${seed}"\n${describe(r)}`);
      assert.equal(r.outcome, 'enemyDead', `시드 "${seed}"`);
      assert.equal(r.phases, BOSSES[type].phases.length - 1, `시드 "${seed}": 페이즈 전환 이벤트 수`);
      assert.deepEqual(r.stats.phaseEvents.map((e) => [e.from, e.to]), BOSSES[type].phases.slice(1).map((_, i) => [i, i + 1]));
    }
    for (const mode of [MODES.FIGHT, MODES.PASSIVE, MODES.WANDER]) {
      const seed = `t-${type}-${mode}-0`;
      const r = runDuel({ seed, type, mode });
      assert.deepEqual(r.issues, [], `시드 "${seed}"\n${describe(r)}`);
    }
  }
});

test('가만히 있는 플레이어는 어떤 적에게든 결국 잡힌다(자폭하는 적 제외)', () => {
  for (const type of [...enemies, ...bosses]) {
    const r = runDuel({ seed: `t-idle-${type}`, type, mode: MODES.PASSIVE });
    if (type === 'sporeling') assert.equal(r.outcome, 'enemyDead');
    else assert.equal(r.outcome, 'playerDead', `${type}: ${r.outcome}\n${describe(r)}`);
  }
});

test('재현성: 같은 시드의 대결은 틱 수·결과·최종 상태가 완전히 같다', () => {
  for (const [type, mode] of [['cultist', MODES.FIGHT], ['shade', MODES.WANDER], ['magma_hound', MODES.KITE], ['abyss_lord', MODES.TANKY]]) {
    const a = runDuel({ seed: `t-repeat-${type}`, type, mode, digest: true });
    const b = runDuel({ seed: `t-repeat-${type}`, type, mode, digest: true });
    assert.equal(a.digest, b.digest, type);
    assert.equal(a.ticks, b.ticks, type);
    assert.equal(a.outcome, b.outcome, type);
    const other = runDuel({ seed: `t-repeat-${type}-x`, type, mode, digest: true });
    assert.notEqual(other.digest, a.digest, '시드가 다르면 다르게 흘러간다');
  }
});

test('세이브/로드: 전투 도중의 상태를 JSON 으로 저장했다 불러와도 이후 진행이 완전히 같다', () => {
  // 자동 조작 대신 틱 번호로만 정해지는 입력을 쓴다(입력이 상태 밖의 기억에 의존하지 않도록).
  const scripted = (t) => ({
    moveX: [1, 0, -1, 0][Math.floor(t / 45) % 4],
    moveY: [0, 1, 0, -1][Math.floor(t / 45) % 4],
    attack: true,
    skill: t % 120 === 0 ? (t / 120) % 3 : -1,
    dodge: t % 200 === 199,
  });
  for (const type of ['cultist', 'ash_wraith', 'stone_golem', 'spore_mother', 'abyss_lord']) {
    const live = setupDuel({ seed: `t-save-${type}`, type, mode: MODES.TANKY });
    const run = (game, ticks) => {
      for (let i = 0; i < ticks; i++) {
        setInput(game.state, scripted(game.state.tick));
        tick(game, DT);
      }
    };
    run(live.game, 400);
    // 저장 → 불러오기: 상태만 복사하고, 이벤트버스는 새 것을 쓴다.
    const loaded = { state: JSON.parse(JSON.stringify(live.game.state)), bus: setupDuel({ seed: 'unused', type: 'rat', mode: MODES.FIGHT }).game.bus };
    run(live.game, 600);
    run(loaded, 600);
    assert.deepEqual(loaded.state, live.game.state, `${type}: 불러온 뒤의 진행이 원본과 다름`);
  }
});

test('자동 조작: 싸우는 방식은 실제로 적을 공격하고, 달아나는 방식은 공격하지 않는다', () => {
  const fight = setupDuel({ seed: 't-bot', type: 'zombie', mode: MODES.FIGHT });
  const bot = createBot(MODES.FIGHT, 't-bot');
  const enemy = fight.game.state.entities.byId[fight.enemyId];
  for (let i = 0; i < 180 && !enemy.dead; i++) {
    driveBot(fight, bot);
    tick(fight.game, DT);
  }
  assert.ok(enemy.hp < enemy.maxHp);

  const kite = runDuel({ seed: 't-bot-kite', type: 'zombie', mode: MODES.KITE });
  assert.equal(kite.stats.damageToEnemies, 0);
});
