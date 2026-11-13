// 봇으로 맛보기 판을 처음부터 끝까지 돌린다(scripts/bot-run.mjs 의 작은 표본).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { playRun } from '../../../scripts/bot-run.mjs';

test('봇이 여섯 층을 완주한다: 방을 깨고, 축복을 고르고, 층마다 보스를 잡고, 마지막 포털로 나간다', () => {
  for (const seed of ['run-a', 'run-b', 'run-c']) {
    const result = playRun({ seed, resumeCheck: true });
    assert.equal(result.error, null, `${seed}: ${result.error}`);
    assert.deepEqual(result.problems, [], seed);
    assert.equal(result.outcome, 'victory', seed);
    assert.equal(result.floor, 6, seed);
    assert.ok(result.roomsCleared >= 24 && result.boons >= 10 && result.kills >= 150, `${seed}: 방 ${result.roomsCleared}, 축복 ${result.boons}, 처치 ${result.kills}`);
    assert.ok(result.reachedBoss && result.bossSec > 5, `${seed}: 보스 전투 ${result.bossSec}초`);
    assert.ok(result.sec > 8 * 60 && result.sec < 50 * 60, `${seed}: ${result.sec.toFixed(0)}초`);
    assert.equal(result.resumed, true, `${seed}: 전투 중에 저장했다 불러온 게임이 끝까지 같았다`);
  }
});

test('같은 시드의 판은 다시 돌려도 완전히 같다', () => {
  const a = playRun({ seed: 'run-repeat' });
  const b = playRun({ seed: 'run-repeat' });
  assert.deepEqual(a, b);
  const c = playRun({ seed: 'run-repeat-2' });
  assert.notDeepEqual([a.sec, a.kills, a.gold], [c.sec, c.kills, c.gold]);
});

test('마법사로도 완주하고, 보스로 곧장 가는 길로도 판이 끝난다(이기든 지든 멈추지 않는다)', () => {
  const mage = playRun({ seed: 'run-mage', character: 'mage' });
  assert.equal(mage.error, null);
  assert.deepEqual(mage.problems, []);
  assert.notEqual(mage.outcome, 'timeout');
  const short = playRun({ seed: 'run-short', plan: 'short' });
  assert.equal(short.error, null);
  assert.deepEqual(short.problems, []);
  assert.notEqual(short.outcome, 'timeout');
  assert.ok(short.reachedBoss || short.outcome === 'death');
});

test('피하지 않는 봇은 훨씬 많이 맞는다(적은 아프지만 피할 수 있다)', () => {
  let careful = 0;
  let reckless = 0;
  for (const seed of ['hurt-a', 'hurt-b', 'hurt-c', 'hurt-d']) {
    const a = playRun({ seed });
    const b = playRun({ seed, dodge: false });
    assert.equal(a.error ?? b.error, null);
    careful += a.damageTaken / Math.max(1, a.roomsCleared);
    reckless += b.damageTaken / Math.max(1, b.roomsCleared);
  }
  assert.ok(reckless > careful * 3, `방 하나당 받은 피해: 피할 때 ${careful.toFixed(1)}, 안 피할 때 ${reckless.toFixed(1)}`);
});
