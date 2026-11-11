import assert from 'node:assert/strict';
import { test } from 'node:test';

import { WORLD } from '../../../data/world.js';
import { ZONES } from '../../../data/zones.js';
import { EVENTS } from '../../../src/logic/core/events.js';
import { Rng } from '../../../src/logic/core/prng.js';
import { rngOf } from '../../../src/logic/core/state.js';
import { createGame, enterFloor } from '../../../src/logic/game.js';
import { toAscii } from '../../../src/logic/world/ascii.js';
import { FLOOR_KIND, TOTAL_FLOORS, floorPlan } from '../../../src/logic/world/floors.js';
import { generateFloor, generateFloorFromRng } from '../../../src/logic/world/generate.js';
import { labelRegions } from '../../../src/logic/world/grid.js';
import { validateFloor } from '../../../src/logic/world/validate.js';

const worldRng = (seed) => Rng.fromSeed(seed).fork('world');

const FABLE_SUMMARY = [
  'rooms 40x40 open=606 start=8,35 stairs=32,17 spawns=10 events=-',
  'bossMid 21x37 open=321 start=10,33 stairs=10,3 spawns=2 events=-',
  'cave 48x48 open=1405 start=4,22 stairs=39,36 spawns=14 events=altar',
  'bossFinal 27x41 open=467 start=13,37 stairs=- spawns=1 events=-',
];

// ── 결정적 생성 ──────────────────────────────────────────────────────────────

test('같은 (시드, 층)은 항상 같은 층을 만든다', () => {
  for (const floor of [1, 5, 8, 13, 22, 30]) {
    assert.deepEqual(generateFloor({ seed: 'repeat', floor }), generateFloor({ seed: 'repeat', floor }), `${floor}층`);
  }
});

test('시드나 층이 다르면 다른 층이 나온다', () => {
  const base = generateFloor({ seed: 'a', floor: 2 });
  assert.notDeepEqual(generateFloor({ seed: 'b', floor: 2 }).tiles, base.tiles);
  assert.notDeepEqual(generateFloor({ seed: 'a', floor: 3 }).tiles, base.tiles);
  // 보스층도 시드에 따라 달라진다.
  const bosses = new Set();
  for (let n = 0; n < 20; n++) bosses.add(JSON.stringify(generateFloor({ seed: `boss-${n}`, floor: 5 }).tiles));
  assert.ok(bosses.size >= 5, `보스층 변형 ${bosses.size}가지`);
});

test('층을 만드는 순서와 횟수는 결과에 영향을 주지 않는다', () => {
  const forward = [];
  for (let floor = 1; floor <= TOTAL_FLOORS; floor++) forward.push(generateFloor({ seed: 'order', floor }));
  for (let floor = TOTAL_FLOORS; floor >= 1; floor--) {
    assert.deepEqual(generateFloor({ seed: 'order', floor }), forward[floor - 1], `${floor}층`);
  }
});

test('world 스트림을 소비하거나 다른 층을 만들어도 결과가 같고, 스트림 자체는 소비되지 않는다', () => {
  const rng = worldRng('stream');
  const before = rng.snapshot();
  const first = generateFloorFromRng(rng, 7);
  assert.deepEqual(rng.snapshot(), before, 'generateFloorFromRng 는 world 스트림을 소비하지 않는다');

  for (let i = 0; i < 50; i++) rng.nextUint32();
  generateFloorFromRng(rng, 3);
  assert.deepEqual(generateFloorFromRng(rng, 7), first);
  assert.deepEqual(generateFloor({ seed: 'stream', floor: 7 }), first);
});

test('숫자 시드와 같은 내용의 문자열 시드는 같은 층을 만든다', () => {
  assert.deepEqual(generateFloor({ seed: 2024, floor: 4 }), generateFloor({ seed: '2024', floor: 4 }));
});

// 고정값 테스트: 아래 값이 바뀌면 같은 시드의 던전이 달라진 것이다(기존 세이브·공유 시드와 어긋난다).
// 의도한 변경이면 값을 갱신하고 BUGS.md 에 기록한다.
test('고정값: 시드 "fable" 의 층 요약이 변하지 않는다', () => {
  const summary = (floor) => {
    const m = generateFloor({ seed: 'fable', floor });
    const open = m.tiles.reduce((a, b) => a + b, 0);
    return `${m.algorithm} ${m.width}x${m.height} open=${open} start=${m.start.x},${m.start.y} stairs=${m.stairs ? `${m.stairs.x},${m.stairs.y}` : '-'} spawns=${m.spawns.length} events=${m.eventRooms.map((r) => r.kind).join('+') || '-'}`;
  };
  assert.deepEqual([1, 5, 13, 30].map(summary), FABLE_SUMMARY);
});

test('맵은 JSON 으로 왕복해도 그대로다(평범한 객체·배열만 쓴다)', () => {
  for (const floor of [1, 5, 13, 30]) {
    const map = generateFloor({ seed: 'json', floor });
    assert.ok(Array.isArray(map.tiles), 'tiles 는 일반 배열');
    assert.deepEqual(JSON.parse(JSON.stringify(map)), map);
  }
});

// ── 구성 ─────────────────────────────────────────────────────────────────────

test('층의 구역·종류·크기가 층 계획과 구역 데이터를 따른다', () => {
  for (let floor = 1; floor <= TOTAL_FLOORS; floor++) {
    const plan = floorPlan(floor);
    const map = generateFloor({ seed: 'plan', floor });
    assert.equal(map.floor, floor);
    assert.equal(map.zoneId, plan.zone.id);
    assert.equal(map.kind, plan.kind);
    if (plan.kind === FLOOR_KIND.NORMAL) {
      assert.ok(['rooms', 'cave'].includes(map.algorithm));
      assert.equal(map.width, plan.zone.size.w);
      assert.equal(map.height, plan.zone.size.h);
    }
  }
});

test('보스층: 전용 레이아웃, 그 구역의 보스 한 마리, 일반 적·이벤트방 없음', () => {
  for (let floor = 1; floor <= TOTAL_FLOORS; floor++) {
    const plan = floorPlan(floor);
    if (plan.kind === FLOOR_KIND.NORMAL) continue;
    const map = generateFloor({ seed: 'bosses', floor });
    const bosses = map.spawns.filter((s) => s.kind === 'boss');

    assert.equal(map.algorithm, plan.kind === FLOOR_KIND.FINAL_BOSS ? 'bossFinal' : 'bossMid');
    assert.deepEqual(bosses.map((b) => b.id), [plan.zone.boss.id]);
    assert.equal(map.spawns.filter((s) => s.kind === 'enemy').length, 0);
    assert.deepEqual(map.eventRooms, []);
    if (plan.kind === FLOOR_KIND.FINAL_BOSS) assert.equal(map.stairs, null);
    else assert.ok(map.stairs.y < bosses[0].y && bosses[0].y < map.start.y, '시작점 → 보스 → 계단 순으로 놓인다');
  }
});

test('두 알고리즘이 모두 쓰이고, 구역별 비율이 설정을 따른다', () => {
  const counts = ZONES.map(() => ({ rooms: 0, cave: 0 }));
  for (let n = 0; n < 150; n++) {
    for (let floor = 1; floor <= TOTAL_FLOORS; floor++) {
      const plan = floorPlan(floor);
      if (plan.kind !== FLOOR_KIND.NORMAL) continue;
      counts[plan.zoneIndex][generateFloor({ seed: `ratio-${n}`, floor }).algorithm]++;
    }
  }
  ZONES.forEach((zone, i) => {
    const total = counts[i].rooms + counts[i].cave;
    const expected = zone.algorithms.rooms / (zone.algorithms.rooms + zone.algorithms.cave);
    const actual = counts[i].rooms / total;
    assert.ok(counts[i].rooms > 0 && counts[i].cave > 0, `${zone.id}: 한 알고리즘만 나옴`);
    assert.ok(Math.abs(actual - expected) < 0.08, `${zone.id}: 방+복도 비율 ${actual.toFixed(3)} (설정 ${expected.toFixed(3)})`);
  });
});

test('적은 그 구역의 적 풀에서만 나오고, 풀의 모든 적이 등장한다', () => {
  const seen = ZONES.map(() => new Set());
  for (let n = 0; n < 30; n++) {
    for (let floor = 1; floor <= TOTAL_FLOORS; floor++) {
      const plan = floorPlan(floor);
      for (const s of generateFloor({ seed: `pool-${n}`, floor }).spawns) {
        if (s.kind === 'enemy') seen[plan.zoneIndex].add(s.id);
      }
    }
  }
  ZONES.forEach((zone, i) => {
    assert.deepEqual([...seen[i]].sort(), zone.enemies.map((e) => e.id).sort(), zone.id);
  });
});

// ── 재시도 상한과 비상 레이아웃 ──────────────────────────────────────────────

test('시도가 계속 실패하면 상한(maxAttempts)에서 멈추고 비상 레이아웃을 쓴다', () => {
  for (const floor of [3, 13, 5, 30]) {
    let calls = 0;
    const rejected = [];
    const map = generateFloorFromRng(worldRng('cap'), floor, {
      build: () => {
        calls++;
        return { rejected: 'forced' };
      },
      onReject: (attempt, reasons) => rejected.push([attempt, reasons]),
    });

    assert.equal(calls, WORLD.maxAttempts, `${floor}층: 시도 횟수`);
    assert.deepEqual(rejected, Array.from({ length: WORLD.maxAttempts }, (_, i) => [i + 1, ['forced']]));
    assert.deepEqual(map.gen, { attempts: WORLD.maxAttempts, fallback: true, tunnels: 0, filled: 0 });
    assert.deepEqual(validateFloor(map), [], toAscii(map));
    assert.equal(labelRegions(map.tiles, map.width, map.height).sizes.length, 1);
    if (floorPlan(floor).kind === FLOOR_KIND.NORMAL) assert.equal(map.algorithm, 'fallback');
  }
});

test('비상 레이아웃도 결정적이다', () => {
  const build = () => ({ rejected: 'forced' });
  assert.deepEqual(
    generateFloorFromRng(worldRng('cap'), 8, { build }),
    generateFloorFromRng(worldRng('cap'), 8, { build }),
  );
});

test('검증에 실패한 시도는 버리고 다음 시도로 넘어간다', () => {
  const real = generateFloor({ seed: 'retry', floor: 2 });
  let calls = 0;
  const reasons = [];
  const map = generateFloorFromRng(worldRng('retry'), 2, {
    build: () => {
      calls++;
      if (calls <= 2) {
        // 계단을 시작점 위에 놓은 잘못된 층.
        const broken = structuredClone(real);
        broken.stairs = { ...broken.start };
        return broken;
      }
      return structuredClone(real);
    },
    onReject: (attempt, r) => reasons.push(r.join(';')),
  });

  assert.equal(calls, 3);
  assert.equal(map.gen.attempts, 3);
  assert.equal(map.gen.fallback, false);
  assert.deepEqual(reasons, ['stairs-on-start', 'stairs-on-start']);
  assert.deepEqual(map.tiles, real.tiles);
});

test('시도마다 서로 다른 난수 스트림을 받는다', () => {
  const firsts = [];
  generateFloorFromRng(worldRng('streams'), 2, {
    build: (rng) => {
      firsts.push(rng.nextUint32());
      return { rejected: 'forced' };
    },
  });
  assert.equal(new Set(firsts).size, WORLD.maxAttempts);
});

test('generateFloor 는 잘못된 층·시드를 거부한다', () => {
  assert.throws(() => generateFloor({ seed: 'a', floor: 0 }), RangeError);
  assert.throws(() => generateFloor({ seed: 'a', floor: TOTAL_FLOORS + 1 }), RangeError);
  assert.throws(() => generateFloor({ seed: undefined, floor: 1 }), TypeError);
});

// ── 게임 상태 연결 ───────────────────────────────────────────────────────────

test('enterFloor: 상태에 층 맵을 넣고 FLOOR_ENTERED 를 발행한다', () => {
  const game = createGame({ seed: 'enter' });
  const events = [];
  game.bus.on(EVENTS.FLOOR_ENTERED, (payload) => events.push(payload));
  const rngBefore = structuredClone(game.state.rng);

  enterFloor(game, 6);

  assert.deepEqual(game.state.world, generateFloor({ seed: 'enter', floor: 6 }));
  assert.equal(game.state.run.floor, 6);
  assert.deepEqual(events, [{ floor: 6, zoneId: 'sewer', kind: 'normal' }]);
  assert.deepEqual(game.state.rng, rngBefore, '맵 생성은 상태의 난수 스트림을 소비하지 않는다');
  assert.deepEqual(JSON.parse(JSON.stringify(game.state)), game.state);
});

test('enterFloor: 다른 스트림을 소비했거나 층을 되돌아와도 같은 맵이다', () => {
  const game = createGame({ seed: 'enter' });
  enterFloor(game, 2);
  const second = structuredClone(game.state.world);
  for (let i = 0; i < 20; i++) rngOf(game.state, 'combat').nextUint32();
  enterFloor(game, 3);
  enterFloor(game, 2);

  assert.deepEqual(game.state.world, second);
  assert.throws(() => enterFloor(game, 99), RangeError);
});

// ── 표본 전수 검사(전체 검증은 scripts/verify-maps.mjs) ──────────────────────

test('표본: 시드 40개 × 전 층이 모두 검증을 통과하고 고립 구역이 없다', () => {
  let maps = 0;
  for (let n = 0; n < 40; n++) {
    for (let floor = 1; floor <= TOTAL_FLOORS; floor++) {
      const map = generateFloor({ seed: `sample-${n}`, floor });
      const where = `시드 "sample-${n}" ${floor}층`;
      assert.deepEqual(validateFloor(map), [], `${where}\n${toAscii(map)}`);
      assert.equal(labelRegions(map.tiles, map.width, map.height).sizes.length, 1, where);
      assert.equal(map.gen.fallback, false, where);
      maps++;
    }
  }
  assert.equal(maps, 40 * TOTAL_FLOORS);
});
