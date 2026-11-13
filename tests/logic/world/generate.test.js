import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ENCOUNTERS } from '../../../data/encounters.js';
import { WORLD } from '../../../data/world.js';
import { ZONES } from '../../../data/zones.js';
import { EVENTS } from '../../../src/logic/core/events.js';
import { Rng } from '../../../src/logic/core/prng.js';
import { rngOf } from '../../../src/logic/core/state.js';
import { createGame, enterFloor } from '../../../src/logic/game.js';
import { toAscii } from '../../../src/logic/world/ascii.js';
import { FLOOR_KIND, REWARD, ROOM_KIND, TOTAL_FLOORS, isFightRoom } from '../../../src/logic/world/floors.js';
import { buildStage, generateFloor, generateFloorFromRng } from '../../../src/logic/world/generate.js';
import { bfsDistances } from '../../../src/logic/world/grid.js';
import { TILE } from '../../../src/logic/world/tiles.js';
import { validateFloor } from '../../../src/logic/world/validate.js';

const worldRng = (seed) => Rng.fromSeed(seed).fork('world');
const FABLE_SUMMARY = 'rooms 62x65 open=1628 start=12,31 rooms=srscecccebe rewards=-w-hbwbbbb- doors=24';
const SAMPLE = Array.from({ length: 150 }, (_, i) => generateFloor({ seed: `sample-${i}`, floor: 1 }));

/** 맵을 한 줄로 요약한다(고정값 비교용). */
function summarize(map) {
  const open = map.tiles.filter((t) => t !== TILE.WALL).length;
  const kinds = map.rooms.map((r) => r.kind[0]).join('');
  const rewards = map.rooms.map((r) => (r.reward ? r.reward[0] : '-')).join('');
  return `${map.algorithm} ${map.width}x${map.height} open=${open} start=${map.start.x},${map.start.y} rooms=${kinds} rewards=${rewards} doors=${map.doors.length}`;
}

// ── 결정적 생성 ──────────────────────────────────────────────────────────────

test('같은 (시드, 층)은 항상 같은 층을 만든다', () => {
  for (const seed of ['repeat', 'repeat-2', 12345]) {
    assert.deepEqual(generateFloor({ seed, floor: 1 }), generateFloor({ seed, floor: 1 }), `${seed}`);
  }
});

test('시드가 다르면 다른 층이 나온다', () => {
  const layouts = new Set(SAMPLE.slice(0, 40).map((map) => JSON.stringify(map.tiles)));
  assert.equal(layouts.size, 40);
});

test('world 스트림을 소비하거나 다른 일을 해도 결과가 같고, 스트림 자체는 소비되지 않는다', () => {
  const rng = worldRng('stream');
  const before = rng.snapshot();
  const first = generateFloorFromRng(rng, 1);
  assert.deepEqual(rng.snapshot(), before, 'generateFloorFromRng 는 world 스트림을 소비하지 않는다');
  for (let i = 0; i < 50; i++) rng.nextUint32();
  assert.deepEqual(generateFloorFromRng(rng, 1), first);
  assert.deepEqual(generateFloor({ seed: 'stream', floor: 1 }), first);
});

test('숫자 시드와 같은 내용의 문자열 시드는 같은 층을 만든다', () => {
  assert.deepEqual(generateFloor({ seed: 42, floor: 1 }), generateFloor({ seed: '42', floor: 1 }));
});

test('고정값: 시드 "fable" 의 층 요약이 변하지 않는다', () => {
  // 이 값이 바뀌면 기존 시드·세이브의 맵이 달라진다는 뜻이다. 의도한 변경이면 값을 갱신하고 BUGS.md 에 적는다.
  assert.equal(summarize(generateFloor({ seed: 'fable', floor: 1 })), FABLE_SUMMARY);
});

test('맵은 JSON 으로 왕복해도 그대로다(평범한 객체·배열만 쓴다)', () => {
  const map = SAMPLE[0];
  assert.deepEqual(JSON.parse(JSON.stringify(map)), map);
  assert.ok(Array.isArray(map.tiles) && !ArrayBuffer.isView(map.tiles));
});

// ── 층의 구성 ────────────────────────────────────────────────────────────────

test('표본 150개가 모두 검증을 통과하고, 비상 레이아웃을 쓰지 않는다', () => {
  for (const map of SAMPLE) {
    assert.deepEqual(validateFloor(map), [], toAscii(map));
    assert.equal(map.gen.fallback, false);
    assert.ok(map.gen.attempts >= 1 && map.gen.attempts <= WORLD.maxAttempts);
    assert.equal(map.kind, FLOOR_KIND.STAGE);
    assert.equal(map.zoneId, ZONES[0].id);
    assert.equal(map.width, WORLD.layout.w);
    assert.equal(map.height, WORLD.layout.h + WORLD.boss.bandH);
  }
});

test('방은 8~12개이고(출구 방·숨은 방 제외), 시작·보스·출구가 하나씩 있다', () => {
  const counts = new Set();
  for (const map of SAMPLE) {
    const kinds = map.rooms.map((r) => r.kind);
    const counted = kinds.filter((k) => k !== ROOM_KIND.EXIT && k !== ROOM_KIND.BONUS).length;
    counts.add(counted);
    assert.ok(counted >= WORLD.roomCount[0] && counted <= WORLD.roomCount[1], `방 ${counted}개`);
    for (const kind of [ROOM_KIND.START, ROOM_KIND.BOSS, ROOM_KIND.EXIT]) assert.equal(kinds.filter((k) => k === kind).length, 1, kind);
    assert.ok(kinds.filter((k) => k === ROOM_KIND.COMBAT || k === ROOM_KIND.ELITE).length >= WORLD.rules.minCombatRooms);
  }
  assert.ok(counts.size >= 4, `방 수가 ${[...counts].sort()} 로 다양하다`);
});

test('방의 종류가 고루 나온다: 상점·보상·정예·숨은 방이 표본의 상당수에 있다', () => {
  const has = (kind) => SAMPLE.filter((map) => map.rooms.some((r) => r.kind === kind)).length;
  assert.ok(has(ROOM_KIND.SHOP) >= SAMPLE.length * 0.9, `상점 ${has(ROOM_KIND.SHOP)}`);
  assert.ok(has(ROOM_KIND.ELITE) >= SAMPLE.length * 0.8, `정예 ${has(ROOM_KIND.ELITE)}`);
  assert.ok(has(ROOM_KIND.REWARD) >= SAMPLE.length * 0.5, `보상 ${has(ROOM_KIND.REWARD)}`);
  assert.ok(has(ROOM_KIND.BONUS) >= SAMPLE.length * 0.4, `숨은 방 ${has(ROOM_KIND.BONUS)}`);
});

test('전투방은 11×9 이상이고, 보스 방은 그보다 크며, 숨은 방만 동굴 모양이다', () => {
  for (const map of SAMPLE) {
    const boss = map.rooms.find((r) => r.kind === ROOM_KIND.BOSS);
    for (const room of map.rooms) {
      if (room.kind === ROOM_KIND.COMBAT || room.kind === ROOM_KIND.ELITE) {
        assert.ok(room.w >= 11 && room.h >= 9, `${room.kind} ${room.w}x${room.h}`);
      }
      assert.equal(room.shape, room.kind === ROOM_KIND.BONUS ? 'cave' : 'rect');
    }
    assert.ok(boss.w >= WORLD.boss.arenaW[0] && boss.h >= WORLD.boss.arenaH[0]);
  }
});

test('시작 방에서 보스 방까지는 방을 셋 이상 건너야 하고, 보스 방은 가장 깊은 축에 든다', () => {
  for (const map of SAMPLE) {
    const start = map.rooms.find((r) => r.kind === ROOM_KIND.START);
    const boss = map.rooms.find((r) => r.kind === ROOM_KIND.BOSS);
    assert.equal(start.depth, 0);
    assert.ok(boss.depth >= WORLD.rules.startBossMinHops, `보스 깊이 ${boss.depth}`);
    assert.deepEqual(map.start, start.feature);
  }
});

test('문: 방과 방 사이는 문 두 개(복도의 양 끝)로 이어지고, 문은 벽 줄에 놓여 방 안쪽 두 칸이 비어 있다', () => {
  for (const map of SAMPLE.slice(0, 60)) {
    assert.equal(map.doors.length, map.links.length * 2);
    for (const link of map.links) {
      const [a, b] = link.doors.map((id) => map.doors[id]);
      assert.deepEqual([a.room, a.to, b.room, b.to], [link.rooms[0], link.rooms[1], link.rooms[1], link.rooms[0]]);
    }
    for (const door of map.doors) {
      const room = map.rooms[door.room];
      assert.ok(door.cells.length >= 1 && door.cells.length <= 3);
      for (const c of door.cells) {
        const x = c % map.width;
        const y = Math.floor(c / map.width);
        const outside = x < room.x || x >= room.x + room.w || y < room.y || y >= room.y + room.h;
        if (room.shape === 'rect') assert.ok(outside, '문은 방의 사각형 바로 바깥(벽 줄)에 있다');
      }
      assert.ok(Number.isFinite(door.x) && Number.isFinite(door.y));
    }
    // 방마다 문이 하나 이상 있다.
    for (const room of map.rooms) assert.ok(room.doors.length >= 1, `방 ${room.id}(${room.kind})`);
  }
});

test('길이 여러 갈래다: 문이 셋 이상인 방이 있고, 대부분의 층에 순환로가 있다', () => {
  let loops = 0;
  for (const map of SAMPLE) {
    const main = map.links.filter((l) => !l.secret).length;
    const rooms = map.rooms.filter((r) => r.kind !== ROOM_KIND.BONUS).length;
    if (main > rooms - 1) loops++;
    assert.ok(map.rooms.some((r) => r.doors.length >= 3), '갈림길');
  }
  assert.ok(loops >= SAMPLE.length * 0.8, `순환로가 있는 층 ${loops}/${SAMPLE.length}`);
});

test('웨이브: 전투방은 2~3회, 깊을수록 적이 많고, 적은 그 구역의 풀에서만 나온다', () => {
  const pool = new Set(ZONES[0].enemies.map((e) => e.id));
  const seen = new Set();
  const perDepth = {};
  for (const map of SAMPLE) {
    for (const room of map.rooms) {
      if (!isFightRoom(room.kind)) {
        assert.deepEqual([room.waves, room.spawnCells], [[], []]);
        continue;
      }
      if (room.kind === ROOM_KIND.BOSS) {
        assert.deepEqual(room.waves, [[{ type: ZONES[0].boss.id, elite: false }]]);
        continue;
      }
      assert.ok(room.waves.length >= 2 && room.waves.length <= 3, `웨이브 ${room.waves.length}회`);
      for (const wave of room.waves) {
        assert.ok(wave.length >= 1 && wave.length <= ENCOUNTERS.maxPerWave + ENCOUNTERS.elite.perWave);
        for (const spawn of wave) {
          assert.ok(pool.has(spawn.type), spawn.type);
          seen.add(spawn.type);
        }
      }
      if (room.kind === ROOM_KIND.COMBAT) {
        const total = room.waves.reduce((n, wave) => n + wave.length, 0);
        (perDepth[Math.min(room.depth, 4)] ??= []).push(total);
      }
      assert.ok(room.spawnCells.length >= Math.max(...room.waves.map((w) => w.length)) + WORLD.rules.spawnSpare);
    }
  }
  assert.deepEqual([...seen].sort(), [...pool].sort(), '풀의 모든 적이 등장한다');
  const avg = (list) => list.reduce((a, b) => a + b, 0) / list.length;
  assert.ok(avg(perDepth[4]) > avg(perDepth[1]) * 1.3, `깊이 1: ${avg(perDepth[1]).toFixed(1)}마리, 깊이 4+: ${avg(perDepth[4]).toFixed(1)}마리`);
});

test('보상: 전투방마다 보상이 있고, 한 층에 축복 방 둘·무기 방 하나 이상. 네 가지 보상이 모두 나온다', () => {
  const seen = new Set();
  for (const map of SAMPLE) {
    const combat = map.rooms.filter((r) => r.kind === ROOM_KIND.COMBAT);
    for (const room of combat) seen.add(room.reward);
    assert.ok(combat.filter((r) => r.reward === REWARD.BOON).length >= ENCOUNTERS.rewards.minBoon);
    assert.ok(combat.filter((r) => r.reward === REWARD.WEAPON).length >= ENCOUNTERS.rewards.minWeapon);
    for (const room of map.rooms) {
      if (room.kind === ROOM_KIND.START || room.kind === ROOM_KIND.SHOP || room.kind === ROOM_KIND.EXIT) assert.equal(room.reward, null);
    }
  }
  assert.deepEqual([...seen].sort(), Object.values(REWARD).sort());
});

test('숨은 방: 닫힌 숨은 문 하나로만 이어지고, 그 문을 빼면 나머지 맵은 그대로 이어져 있다', () => {
  let checked = 0;
  for (const map of SAMPLE) {
    const bonus = map.rooms.find((r) => r.kind === ROOM_KIND.BONUS);
    const secrets = map.doors.filter((d) => d.secret);
    if (!bonus) {
      assert.equal(secrets.length, 0);
      assert.equal(map.tiles.includes(TILE.DOOR), false);
      continue;
    }
    checked++;
    assert.equal(secrets.length, 1);
    assert.equal(secrets[0].open, false);
    assert.equal(secrets[0].to, bonus.id);
    assert.equal(secrets[0].cells.length, 1, '좁은 굴');
    const dist = bfsDistances(map.tiles, map.width, map.height, map.start.y * map.width + map.start.x);
    assert.equal(dist[bonus.feature.y * map.width + bonus.feature.x], -1, '문이 닫혀 있으면 닿지 못한다');
  }
  assert.ok(checked > 30);
});

// ── 재시도 상한과 비상 레이아웃 ──────────────────────────────────────────────

test('시도가 계속 실패하면 상한(maxAttempts)에서 멈추고 비상 레이아웃을 쓴다', () => {
  let calls = 0;
  const rejected = [];
  const map = generateFloorFromRng(worldRng('cap'), 1, {
    build: () => {
      calls++;
      return { rejected: 'forced' };
    },
    onReject: (attempt, reasons) => rejected.push([attempt, reasons]),
  });
  assert.equal(calls, WORLD.maxAttempts);
  assert.deepEqual(rejected, Array.from({ length: WORLD.maxAttempts }, (_, i) => [i + 1, ['forced']]));
  assert.deepEqual(map.gen, { attempts: WORLD.maxAttempts, fallback: true });
  assert.equal(map.algorithm, 'fallback');
  assert.deepEqual(validateFloor(map), [], toAscii(map));
  assert.equal(map.rooms.some((r) => r.kind === ROOM_KIND.BONUS), false, '비상 레이아웃에는 숨은 방이 없다');
});

test('비상 레이아웃은 시드와 무관하게 항상 검증을 통과하고, 같은 시드면 같다', () => {
  const build = () => ({ rejected: 'forced' });
  for (const seed of ['fb-a', 'fb-b', 'fb-c', 'fb-d', 'fb-e', 'fb-f']) {
    const map = generateFloorFromRng(worldRng(seed), 1, { build });
    assert.deepEqual(validateFloor(map), [], `${seed}\n${toAscii(map)}`);
    assert.deepEqual(generateFloorFromRng(worldRng(seed), 1, { build }), map);
  }
  const plain = buildStage(Rng.fromSeed('direct'), { floor: 1, zoneIndex: 0, zone: ZONES[0], kind: FLOOR_KIND.STAGE }, { plain: true });
  assert.equal(plain.rejected, undefined);
});

test('검증에 실패한 시도는 버리고 다음 시도로 넘어간다', () => {
  const real = generateFloor({ seed: 'retry', floor: 1 });
  let calls = 0;
  const reasons = [];
  const map = generateFloorFromRng(worldRng('retry'), 1, {
    build: () => {
      calls++;
      const copy = structuredClone(real);
      // 처음 두 번은 시작점을 엉뚱한 곳에 둔 잘못된 층.
      if (calls <= 2) copy.start = { x: copy.start.x + 1, y: copy.start.y };
      return copy;
    },
    onReject: (attempt, r) => reasons.push(r.join(';')),
  });
  assert.equal(calls, 3);
  assert.equal(map.gen.attempts, 3);
  assert.equal(map.gen.fallback, false);
  assert.deepEqual(reasons, ['start-misplaced', 'start-misplaced']);
  assert.deepEqual(map.tiles, real.tiles);
});

test('시도마다 서로 다른 난수 스트림을 받는다', () => {
  const firsts = [];
  generateFloorFromRng(worldRng('streams'), 1, {
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
  game.bus.on(EVENTS.FLOOR_ENTERED, (e) => events.push(e));
  enterFloor(game, 1);
  assert.equal(game.state.run.floor, 1);
  assert.deepEqual(events, [{ floor: 1, zoneId: ZONES[0].id, kind: FLOOR_KIND.STAGE }]);
  // 시작 방이 드러난 것 말고는 갓 만든 층과 같다.
  const fresh = generateFloor({ seed: 'enter', floor: 1 });
  assert.deepEqual(game.state.world.tiles, fresh.tiles);
  assert.deepEqual(game.state.world.doors, fresh.doors);
  assert.deepEqual(game.state.world.rooms.map((r) => r.waves), fresh.rooms.map((r) => r.waves));
});

test('enterFloor: 다른 스트림을 소비했어도 같은 맵이다', () => {
  const a = createGame({ seed: 'enter-same' });
  const b = createGame({ seed: 'enter-same' });
  for (let i = 0; i < 100; i++) {
    rngOf(b.state, 'world').nextUint32();
    rngOf(b.state, 'combat').nextUint32();
    rngOf(b.state, 'items').nextUint32();
  }
  enterFloor(a, 1);
  enterFloor(b, 1);
  assert.deepEqual(a.state.world, b.state.world);
});
