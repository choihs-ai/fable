// 검증기가 각 위반을 실제로 잡아내는지 확인한다. 정상 층을 하나 만든 뒤 한 군데씩 망가뜨려 본다.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { toAscii } from '../../../src/logic/world/ascii.js';
import { REWARD, ROOM_KIND } from '../../../src/logic/world/floors.js';
import { generateFloor } from '../../../src/logic/world/generate.js';
import { TILE } from '../../../src/logic/world/tiles.js';
import { validateFloor } from '../../../src/logic/world/validate.js';

/** 조건에 맞는 층을 정해진 순서로 찾는다(항상 같은 층이 나온다). */
function findFloor(predicate) {
  for (let n = 0; n < 400; n++) {
    const map = generateFloor({ seed: `fx-${n}`, floor: 1 });
    if (predicate(map)) return map;
  }
  throw new Error('조건에 맞는 층을 찾지 못함');
}
const has = (map, kind) => map.rooms.some((r) => r.kind === kind);
/** 모든 종류의 방이 다 있는 층. */
const base = findFloor((m) => [ROOM_KIND.SHOP, ROOM_KIND.REWARD, ROOM_KIND.ELITE, ROOM_KIND.BONUS].every((k) => has(m, k)));
const plain = findFloor((m) => !has(m, ROOM_KIND.BONUS));

const room = (map, kind) => map.rooms.find((r) => r.kind === kind);
const codes = (map) => validateFloor(map).map((e) => e.split(':')[0]);

/** 망가뜨린 뒤 기대한 위반 코드가 나오는지 확인한다. */
function expectViolation(code, mutate, source = base) {
  const map = structuredClone(source);
  mutate(map);
  const found = codes(map);
  assert.ok(found.includes(code), `기대: ${code}, 실제: [${found.join(', ')}]\n${toAscii(map)}`);
}
const wallAt = (map, x, y) => {
  map.tiles[y * map.width + x] = TILE.WALL;
};

test('기준이 되는 층들은 검증을 통과한다', () => {
  assert.deepEqual(validateFloor(base), []);
  assert.deepEqual(validateFloor(plain), []);
});

test('형태가 잘못된 입력', () => {
  for (const junk of [null, undefined, 5, 'map', []]) assert.ok(validateFloor(junk).length > 0);
  assert.deepEqual(validateFloor({ floor: 99 }), ['bad-floor: 99']);
  expectViolation('bad-size', (m) => { m.width = 2; });
  expectViolation('bad-tiles-length', (m) => { m.tiles.pop(); });
  expectViolation('bad-tile-value', (m) => { m.tiles[100] = 7; });
  expectViolation('bad-lists', (m) => { m.doors = null; });
  expectViolation('bad-lists', (m) => { m.rooms = []; });
  expectViolation('bad-room', (m) => { m.rooms[2].id = 9; });
  expectViolation('bad-room-kind', (m) => { m.rooms[2].kind = 'lobby'; });
  expectViolation('bad-room-lists', (m) => { m.rooms[2].feature = null; });
  expectViolation('room-out-of-bounds', (m) => { m.rooms[2].x = 0; });
});

test('구역·종류·알고리즘이 맞지 않으면 잡는다', () => {
  expectViolation('wrong-zone', (m) => { m.zoneId = 'sewer'; });
  expectViolation('wrong-kind', (m) => { m.kind = 'normal'; });
  expectViolation('wrong-algorithm', (m) => { m.algorithm = 'cave'; });
});

test('테두리가 뚫리면 잡는다', () => {
  expectViolation('open-border', (m) => { m.tiles[5] = TILE.FLOOR; });
  expectViolation('open-border', (m) => { m.tiles[m.width * 10] = TILE.FLOOR; });
});

test('방의 수와 종류: 시작·보스·출구는 하나씩, 방은 8~12개, 전투방이 모자라면 잡는다', () => {
  expectViolation('room-kind-count', (m) => { room(m, ROOM_KIND.START).kind = ROOM_KIND.COMBAT; });
  expectViolation('room-kind-count', (m) => { room(m, ROOM_KIND.COMBAT).kind = ROOM_KIND.BOSS; });
  expectViolation('room-kind-count', (m) => { room(m, ROOM_KIND.COMBAT).kind = ROOM_KIND.SHOP; });
  expectViolation('too-few-combat-rooms', (m) => {
    for (const r of m.rooms) if (r.kind === ROOM_KIND.COMBAT || r.kind === ROOM_KIND.ELITE) r.kind = ROOM_KIND.REWARD;
  });
  expectViolation('room-count', (m) => {
    // 방 목록 끝에 방을 더 붙여 12개를 넘긴다(타일은 그대로라 다른 위반도 함께 나온다).
    for (let i = 0; i < 6; i++) m.rooms.push({ ...structuredClone(m.rooms[2]), id: m.rooms.length });
  });
});

test('방의 크기와 모양: 전투방은 11×9 이상, 가로·세로는 홀수, 숨은 방만 동굴', () => {
  expectViolation('combat-room-too-small', (m) => { room(m, ROOM_KIND.COMBAT).h = 7; });
  expectViolation('room-even-size', (m) => { room(m, ROOM_KIND.COMBAT).w += 1; });
  expectViolation('boss-room-too-small', (m) => { room(m, ROOM_KIND.BOSS).w = 13; });
  expectViolation('room-shape', (m) => { room(m, ROOM_KIND.COMBAT).shape = 'cave'; });
  expectViolation('room-shape', (m) => { room(m, ROOM_KIND.BONUS).shape = 'rect'; });
  expectViolation('room-not-fresh', (m) => { room(m, ROOM_KIND.COMBAT).state = 'cleared'; });
  expectViolation('room-not-fresh', (m) => { room(m, ROOM_KIND.START).seen = true; });
});

test('문과 복도: 목록이 타일과 다르면 잡는다', () => {
  // 복도를 메우면 타일에서 읽은 복도 수가 줄어든다.
  expectViolation('link-count', (m) => {
    const link = m.links.find((l) => !l.secret);
    const [a, b] = link.doors.map((id) => m.doors[id]);
    const x0 = Math.min(...a.cells.concat(b.cells).map((c) => c % m.width));
    const x1 = Math.max(...a.cells.concat(b.cells).map((c) => c % m.width));
    const y0 = Math.min(...a.cells.concat(b.cells).map((c) => Math.floor(c / m.width)));
    const y1 = Math.max(...a.cells.concat(b.cells).map((c) => Math.floor(c / m.width)));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) wallAt(m, x, y);
  });
  expectViolation('bad-door', (m) => { m.doors[0].cells[0] += 1; });
  expectViolation('bad-door', (m) => { m.doors[0].room = m.doors[0].to; });
  expectViolation('bad-link', (m) => { m.links[0].rooms.reverse(); });
  expectViolation('door-target', (m) => { m.doors[0].to = (m.doors[0].to + 1) % m.rooms.length; });
  expectViolation('door-center', (m) => { m.doors[0].x += 0.5; });
  expectViolation('door-not-listed', (m) => { m.rooms[m.doors[0].room].doors = m.rooms[m.doors[0].room].doors.filter((id) => id !== 0); });
  expectViolation('room-door-mismatch', (m) => { m.rooms[m.doors[0].room].doors.push(m.doors.findIndex((d) => d.room !== m.doors[0].room)); });
  expectViolation('link-not-fresh', (m) => { m.links[0].seen = true; });
});

test('문: 열림·닫힘과 타일이 어긋나거나, 엄폐물이 문 앞을 막으면 잡는다', () => {
  const open = (m) => m.doors.find((d) => !d.secret);
  expectViolation('door-state', (m) => { open(m).open = false; });
  expectViolation('door-tile', (m) => { m.tiles[open(m).cells[0]] = TILE.DOOR; });
  expectViolation('door-state', (m) => { m.doors.find((d) => d.secret).open = true; });
  expectViolation('stray-door-tile', (m) => {
    const r = room(m, ROOM_KIND.START);
    m.tiles[r.feature.y * m.width + r.feature.x + 1] = TILE.DOOR;
  });
  expectViolation('door-blocked', (m) => {
    // 문에서 방 안쪽으로 두 번째 칸에 벽을 세운다.
    const door = open(m);
    const c = door.cells[0];
    const x = c % m.width;
    const y = Math.floor(c / m.width);
    const r = m.rooms[door.room];
    const dx = x < r.x ? 1 : x >= r.x + r.w ? -1 : 0;
    const dy = y < r.y ? 1 : y >= r.y + r.h ? -1 : 0;
    wallAt(m, x + dx * 2, y + dy * 2);
  });
});

test('방 그래프: 깊이가 틀리거나, 보스가 너무 가깝거나, 출구 방·숨은 방이 엉뚱한 곳에 달리면 잡는다', () => {
  expectViolation('room-depth', (m) => { room(m, ROOM_KIND.COMBAT).depth += 1; });
  expectViolation('room-depth', (m) => { room(m, ROOM_KIND.EXIT).depth += 1; });
  expectViolation('room-depth', (m) => { room(m, ROOM_KIND.BONUS).depth += 2; });
  expectViolation('exit-not-behind-boss', (m) => {
    // 출구 방과 보스 방의 종류를 서로 바꾼다 — 출구 방에 다른 방들이 이어지게 된다.
    const boss = room(m, ROOM_KIND.BOSS);
    const exit = room(m, ROOM_KIND.EXIT);
    boss.kind = ROOM_KIND.EXIT;
    exit.kind = ROOM_KIND.BOSS;
  });
  expectViolation('boss-too-close', (m) => {
    // 보스 방 바로 앞의 방을 시작 방으로 바꾼다.
    const boss = room(m, ROOM_KIND.BOSS);
    const exit = room(m, ROOM_KIND.EXIT);
    const next = boss.doors.map((id) => m.doors[id].to).find((id) => id !== exit.id);
    room(m, ROOM_KIND.START).kind = ROOM_KIND.COMBAT;
    m.rooms[next].kind = ROOM_KIND.START;
    m.start = { ...m.rooms[next].feature };
  });
  expectViolation('event-room-near-start', (m) => {
    const start = room(m, ROOM_KIND.START);
    const shop = room(m, ROOM_KIND.SHOP);
    start.kind = ROOM_KIND.SHOP;
    shop.kind = ROOM_KIND.START;
  });
  expectViolation('link-secret', (m) => { m.links.find((l) => l.secret).secret = false; });
});

test('시작점이 시작 방의 한가운데 자리가 아니면 잡는다', () => {
  expectViolation('start-misplaced', (m) => { m.start.x += 1; });
  expectViolation('start-misplaced', (m) => { m.start = null; });
});

test('도달 가능성: 닿지 못하는 바닥이 있거나, 숨은 방이 열려 있으면 잡는다', () => {
  expectViolation('unreachable-floor', (m) => {
    // 사방이 벽인 곳에 바닥 한 칸을 만든다.
    for (let i = m.width + 1; i < m.tiles.length - m.width - 1; i++) {
      const around = [i - 1, i + 1, i - m.width, i + m.width, i - m.width - 1, i - m.width + 1, i + m.width - 1, i + m.width + 1];
      if (m.tiles[i] === TILE.WALL && around.every((c) => m.tiles[c] === TILE.WALL) && i % m.width > 1 && i % m.width < m.width - 2) {
        m.tiles[i] = TILE.FLOOR;
        break;
      }
    }
  });
  expectViolation('secret-room-open', (m) => {
    const door = m.doors.find((d) => d.secret);
    for (const c of door.cells) m.tiles[c] = TILE.FLOOR;
  });
  expectViolation('isolated-floor', (m) => {
    // 전투방 하나의 문을 모두 닫힌 문 타일로 바꾼다 — 방이 고립된다.
    const r = m.rooms.find((x) => x.kind === ROOM_KIND.COMBAT && x.doors.every((id) => !m.doors[id].secret) && x.doors.length === 1)
      ?? m.rooms.find((x) => x.kind === ROOM_KIND.REWARD);
    for (const id of r.doors) for (const c of m.doors[id].cells) m.tiles[c] = TILE.DOOR;
  });
});

test('한가운데 자리: 방 밖이거나 벽에 붙어 있으면 잡는다', () => {
  expectViolation('feature-misplaced', (m) => { room(m, ROOM_KIND.SHOP).feature = { ...room(m, ROOM_KIND.BOSS).feature }; });
  expectViolation('feature-misplaced', (m) => {
    const r = room(m, ROOM_KIND.SHOP);
    wallAt(m, r.feature.x + 1, r.feature.y);
  });
});

test('웨이브: 횟수·빈 웨이브·모르는 적·너무 이른 적·정예 수·보스 방의 구성', () => {
  const combat = (m) => m.rooms.find((r) => r.kind === ROOM_KIND.COMBAT && r.depth <= 1) ?? room(m, ROOM_KIND.COMBAT);
  expectViolation('wave-count', (m) => { combat(m).waves = [combat(m).waves[0]]; });
  expectViolation('wave-count', (m) => { const r = combat(m); r.waves = [r.waves[0], r.waves[0], r.waves[0], r.waves[0]]; });
  expectViolation('empty-wave', (m) => { combat(m).waves[0] = []; });
  expectViolation('wave-too-big', (m) => { const r = combat(m); r.waves[0] = Array.from({ length: 12 }, () => ({ type: 'skeleton', elite: false })); });
  expectViolation('unknown-enemy', (m) => { combat(m).waves[0][0].type = 'dragon'; });
  expectViolation('unknown-enemy', (m) => { combat(m).waves[0][0].type = 'stone_golem'; });
  expectViolation('enemy-too-early', (m) => {
    const r = m.rooms.find((x) => x.kind === ROOM_KIND.COMBAT && x.depth <= 1);
    r.waves[0][0].type = 'zombie';
  }, findFloor((m) => m.rooms.some((x) => x.kind === ROOM_KIND.COMBAT && x.depth <= 1)));
  expectViolation('elite-count', (m) => { combat(m).waves[0][0].elite = true; });
  expectViolation('elite-count', (m) => { for (const s of room(m, ROOM_KIND.ELITE).waves[0]) s.elite = false; });
  expectViolation('boss-wave', (m) => { room(m, ROOM_KIND.BOSS).waves[0][0].type = 'skeleton'; });
  expectViolation('boss-wave', (m) => { room(m, ROOM_KIND.BOSS).waves.push([{ type: 'skeleton', elite: false }]); });
  expectViolation('waves-in-calm-room', (m) => { room(m, ROOM_KIND.SHOP).waves = [[{ type: 'skeleton', elite: false }]]; });
  expectViolation('waves-in-calm-room', (m) => { room(m, ROOM_KIND.START).spawnCells = [5]; });
});

test('적이 나타나는 자리: 방 밖·벽 옆·문 근처·겹침·모자람', () => {
  const combat = (m) => room(m, ROOM_KIND.COMBAT);
  expectViolation('spawn-cell-outside-room', (m) => { combat(m).spawnCells[0] = room(m, ROOM_KIND.BOSS).spawnCells[0]; });
  expectViolation('spawn-cell-out-of-bounds', (m) => { combat(m).spawnCells[0] = -4; });
  expectViolation('spawn-cell-out-of-bounds', (m) => { combat(m).spawnCells[0] = 1.5; });
  expectViolation('spawn-cell-duplicate', (m) => { combat(m).spawnCells[1] = combat(m).spawnCells[0]; });
  expectViolation('spawn-cell-cramped', (m) => {
    const c = combat(m).spawnCells[0];
    wallAt(m, (c % m.width) + 1, Math.floor(c / m.width));
  });
  expectViolation('spawn-cell-near-door', (m) => {
    const r = combat(m);
    const door = m.doors[r.doors[0]];
    const c = door.cells[0];
    const x = c % m.width;
    const y = Math.floor(c / m.width);
    const dx = x < r.x ? 1 : x >= r.x + r.w ? -1 : 0;
    const dy = y < r.y ? 1 : y >= r.y + r.h ? -1 : 0;
    r.spawnCells[0] = (y + dy) * m.width + x + dx;
  });
  expectViolation('too-few-spawn-cells', (m) => { combat(m).spawnCells.length = 3; });
});

test('보상: 방의 종류에 맞지 않는 보상, 축복 방·무기 방이 모자라면 잡는다', () => {
  expectViolation('bad-reward', (m) => { room(m, ROOM_KIND.COMBAT).reward = 'relic'; });
  expectViolation('bad-reward', (m) => { room(m, ROOM_KIND.COMBAT).reward = null; });
  expectViolation('bad-reward', (m) => { room(m, ROOM_KIND.ELITE).reward = REWARD.GOLD; });
  expectViolation('bad-reward', (m) => { room(m, ROOM_KIND.SHOP).reward = REWARD.BOON; });
  expectViolation('bad-reward', (m) => { room(m, ROOM_KIND.REWARD).reward = REWARD.HEALTH; });
  expectViolation('bad-reward', (m) => { room(m, ROOM_KIND.BONUS).reward = null; });
  expectViolation('too-few-boon-rooms', (m) => { for (const r of m.rooms) if (r.kind === ROOM_KIND.COMBAT) r.reward = REWARD.WEAPON; });
  expectViolation('too-few-weapon-rooms', (m) => { for (const r of m.rooms) if (r.kind === ROOM_KIND.COMBAT) r.reward = REWARD.BOON; });
});

test('위반이 여러 개면 모두 보고한다', () => {
  const map = structuredClone(base);
  map.zoneId = 'nope';
  map.tiles[3] = TILE.FLOOR;
  room(map, ROOM_KIND.COMBAT).reward = 'x';
  room(map, ROOM_KIND.BOSS).waves[0][0].type = 'x';
  const found = codes(map);
  for (const code of ['wrong-zone', 'open-border', 'bad-reward', 'boss-wave']) assert.ok(found.includes(code), `${code} — [${found}]`);
});
