#!/usr/bin/env node
// 맵 생성 대량 검증. 시드 여러 개 × 전 층을 만들어 방 구조의 규칙 위반·재현성·생성 시간을 조사한다.
//
//   node scripts/verify-maps.mjs                      시드 5000개 × 전 층
//   node scripts/verify-maps.mjs --seeds 200          시드 수 지정
//   node scripts/verify-maps.mjs --from 5000          시드 번호 시작점 (시드 문자열은 "<prefix><번호>")
//   node scripts/verify-maps.mjs --prefix run-        시드 접두사 (기본 "sweep-")
//   node scripts/verify-maps.mjs --workers 1          워커 수 (기본: CPU 수, 최대 8)
//   node scripts/verify-maps.mjs --show sweep-12 1    한 층을 글자로 출력
//
// 검사 항목(맵마다):
//   1. 생성 중 예외가 없는가
//   2. validateFloor(로직의 검증기)를 통과하는가
//   3. 이 파일에 따로 구현한 독립 검사를 통과하는가:
//      방(수·크기·간격), 문(위치·폭·잠그면 방이 완전히 닫히는가), 복도(두 방만 잇는가),
//      도달 가능성(숨은 방을 뺀 모든 바닥, 숨은 문을 열면 전부), 적이 나타나는 자리, 웨이브, 보상
//   4. 같은 시드로 다시 만들면 완전히 같은 결과가 나오는가
//   5. 비상 레이아웃(재시도 상한 초과)을 쓰지 않았는가
// 실패가 하나라도 있으면 종료 코드 1.

import { availableParallelism } from 'node:os';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

import { ENCOUNTERS } from '../data/encounters.js';
import { WORLD } from '../data/world.js';
import { Rng } from '../src/logic/core/prng.js';
import { toAscii } from '../src/logic/world/ascii.js';
import { TOTAL_FLOORS, floorPlan } from '../src/logic/world/floors.js';
import { generateFloor, generateFloorFromRng } from '../src/logic/world/generate.js';
import { validateFloor } from '../src/logic/world/validate.js';

// ── 독립 검사: validate.js·structure.js·grid.js 를 쓰지 않고 따로 구현한다 ──────────

const FLOOR = 1;
const DOOR = 2;

/**
 * from 칸들에서 상하좌우로 퍼져 나가며 닿는 칸의 걸음 수를 구한다(자체 구현).
 * @param {(i:number) => boolean} passable 지나갈 수 있는 칸인가
 */
function flood(map, from, passable) {
  const { width: w, height: h } = map;
  const dist = new Int32Array(w * h).fill(-1);
  let frontier = [];
  for (const i of from) {
    if (dist[i] === -1 && passable(i)) {
      dist[i] = 0;
      frontier.push(i);
    }
  }
  let d = 0;
  while (frontier.length > 0) {
    d++;
    const next = [];
    for (const i of frontier) {
      const x = i % w;
      const y = (i - x) / w;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (dist[n] !== -1 || !passable(n)) continue;
        dist[n] = d;
        next.push(n);
      }
    }
    frontier = next;
  }
  return dist;
}

function independentCheck(map) {
  const problems = [];
  const { width: w, height: h, tiles, rooms, doors, links } = map;
  const plan = floorPlan(map.floor);
  const at = (p) => p.y * w + p.x;
  const xy = (i) => [i % w, Math.floor(i / w)];
  const inRect = (room, x, y) => x >= room.x && x < room.x + room.w && y >= room.y && y < room.y + room.h;
  const kindOf = (kind) => rooms.filter((r) => r.kind === kind);
  const bonus = kindOf('bonus')[0] ?? null;

  // ── 방: 수, 크기, 간격 ──
  const counted = rooms.filter((r) => r.kind !== 'exit' && r.kind !== 'bonus').length;
  if (counted < 8 || counted > 12) problems.push(`방: 방이 ${counted}개(8~12개여야 함)`);
  for (const kind of ['start', 'boss', 'exit']) if (kindOf(kind).length !== 1) problems.push(`방: ${kind} 방이 ${kindOf(kind).length}개`);
  for (const room of rooms) {
    if ((room.kind === 'combat' || room.kind === 'elite') && (room.w < 11 || room.h < 9)) problems.push(`방: 전투방 ${room.id} 가 ${room.w}x${room.h}(11x9 이상이어야 함)`);
  }
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i];
      const b = rooms[j];
      // 사이에 벽이 두 칸 이상 있어야 한다(문 두 개가 따로 설 자리).
      const apart = a.x + a.w + 2 <= b.x || b.x + b.w + 2 <= a.x || a.y + a.h + 2 <= b.y || b.y + b.h + 2 <= a.y;
      if (!apart) problems.push(`방: 방 ${i}·${j} 가 너무 붙어 있음`);
    }
  }

  // ── 칸마다 어느 방인지(사각형 안의 바닥) ──
  const roomOf = new Int16Array(w * h).fill(-1);
  for (const room of rooms) {
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) if (tiles[y * w + x] === FLOOR) roomOf[y * w + x] = room.id;
    }
  }
  const isCorridor = (i) => tiles[i] !== 0 && roomOf[i] === -1;

  // ── 문: 위치와 폭 ──
  const doorCell = new Uint8Array(w * h);
  for (const door of doors) {
    const room = rooms[door.room];
    if (door.cells.length < 1 || door.cells.length > 3) problems.push(`문: 문 ${door.id} 의 폭이 ${door.cells.length}칸`);
    let touches = 0;
    for (const c of door.cells) {
      doorCell[c] = 1;
      const [x, y] = xy(c);
      if (tiles[c] !== (door.open ? FLOOR : DOOR)) problems.push(`문: 문 ${door.id} 의 타일이 상태와 다름 @${x},${y}`);
      if (!isCorridor(c)) problems.push(`문: 문 ${door.id} 가 복도 칸이 아님 @${x},${y}`);
      // 문은 방의 사각형 바로 바깥(벽 줄)에 있고, 방 쪽 이웃은 그 방의 바닥이다.
      if (room.shape === 'rect') {
        const dx = x < room.x ? room.x - x : x >= room.x + room.w ? x - (room.x + room.w - 1) : 0;
        const dy = y < room.y ? room.y - y : y >= room.y + room.h ? y - (room.y + room.h - 1) : 0;
        if (dx + dy !== 1) problems.push(`문: 문 ${door.id} 가 방 ${room.id} 의 벽 줄에 있지 않음 @${x},${y}`);
      }
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) if (roomOf[ny * w + nx] === room.id) touches++;
    }
    if (touches < door.cells.length) problems.push(`문: 문 ${door.id} 의 일부가 방 ${room.id} 에 닿지 않음`);
    // 문 칸들은 한 줄로 붙어 있다.
    const xs = door.cells.map((c) => c % w);
    const ys = door.cells.map((c) => Math.floor(c / w));
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);
    if (!((spanX === 0 && spanY === door.cells.length - 1) || (spanY === 0 && spanX === door.cells.length - 1))) problems.push(`문: 문 ${door.id} 가 한 줄이 아님`);
    if (door.secret !== (bonus !== null && door.to === bonus.id)) problems.push(`문: 문 ${door.id} 의 숨김 표시가 맞지 않음`);
    if (door.open === door.secret) problems.push(`문: 문 ${door.id} 가 ${door.open ? '열려' : '닫혀'} 있음(숨은 문만 닫혀 있어야 함)`);
  }
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === DOOR && !doorCell[i]) problems.push(`문: 어느 문에도 속하지 않는 닫힌 문 타일 @${xy(i)}`);
  }

  // ── 문을 잠그면 방이 완전히 닫히는가: 방의 모든 문을 벽으로 보고 방 한가운데에서 퍼져 나가면 방 밖으로 나갈 수 없다 ──
  for (const room of rooms) {
    const locked = new Set(room.doors.flatMap((id) => doors[id].cells));
    const inside = flood(map, [at(room.feature)], (i) => tiles[i] !== 0 && !locked.has(i));
    let escaped = 0;
    let unreached = 0;
    for (let i = 0; i < tiles.length; i++) {
      if (inside[i] >= 0 && roomOf[i] !== room.id) escaped++;
      if (inside[i] < 0 && roomOf[i] === room.id) unreached++;
    }
    if (escaped > 0) problems.push(`잠금: 방 ${room.id}(${room.kind}) 의 문을 잠가도 밖으로 ${escaped}칸 새어 나감`);
    if (unreached > 0) problems.push(`방: 방 ${room.id}(${room.kind}) 안에 한가운데에서 닿지 못하는 바닥 ${unreached}칸(엄폐물이 방을 가름)`);
  }

  // ── 복도: 문에서 복도 칸으로만 퍼져 나가면 짝이 되는 문 하나에만 닿는다 ──
  let corridorMax = 0;
  for (const door of doors) {
    const reach = flood(map, door.cells, isCorridor);
    const found = new Set();
    for (const other of doors) {
      if (other.id !== door.id && other.cells.some((c) => reach[c] >= 0)) found.add(other.id);
    }
    const pair = [...found];
    if (pair.length !== 1 || doors[pair[0]].room !== door.to || doors[pair[0]].to !== door.room) {
      problems.push(`복도: 문 ${door.id}(방 ${door.room}→${door.to}) 의 복도가 문 [${pair}] 에 닿음`);
      continue;
    }
    const length = Math.max(...doors[pair[0]].cells.map((c) => reach[c])) + 1;
    if (length > corridorMax) corridorMax = length;
    if (!door.secret && !doors[pair[0]].secret && length > WORLD.layout.maxGap) problems.push(`복도: 문 ${door.id} 의 복도 길이 ${length}칸`);
    const link = links[door.link];
    if (!link || !link.doors.includes(door.id) || !link.doors.includes(pair[0])) problems.push(`복도: 문 ${door.id} 의 복도 번호가 맞지 않음`);
  }
  if (doors.length !== links.length * 2) problems.push(`복도: 문 ${doors.length}개, 복도 ${links.length}개`);

  // ── 도달 가능성 ──
  const start = at(map.start);
  if (roomOf[start] !== kindOf('start')[0]?.id) problems.push('시작점: 시작 방 안이 아님');
  const closed = flood(map, [start], (i) => tiles[i] === FLOOR);
  const opened = flood(map, [start], (i) => tiles[i] !== 0);
  const secretLinks = new Set(links.filter((l) => l.secret).map((l) => l.id));
  const hiddenCell = new Uint8Array(w * h);
  if (bonus) {
    for (let i = 0; i < tiles.length; i++) if (roomOf[i] === bonus.id) hiddenCell[i] = 1;
    for (const door of doors) {
      if (!secretLinks.has(door.link)) continue;
      const reach = flood(map, door.cells, isCorridor);
      for (let i = 0; i < tiles.length; i++) if (reach[i] >= 0) hiddenCell[i] = 1;
    }
  }
  let isolated = 0;
  let leaked = 0;
  let never = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === 0) continue;
    if (opened[i] < 0) never++;
    if (tiles[i] !== FLOOR) continue;
    if (closed[i] < 0 && !hiddenCell[i]) isolated++;
    if (closed[i] >= 0 && hiddenCell[i]) leaked++;
  }
  if (never > 0) problems.push(`고립: 숨은 문을 열어도 닿지 못하는 칸 ${never}칸`);
  if (isolated > 0) problems.push(`고립: 시작점에서 닿지 못하는 바닥 ${isolated}칸`);
  if (leaked > 0) problems.push(`숨은 방: 문이 닫혀 있는데 닿는 칸 ${leaked}칸`);
  const boss = kindOf('boss')[0];
  const exit = kindOf('exit')[0];
  const pathLength = boss ? closed[at(boss.feature)] : -1;
  if (boss && pathLength < 0) problems.push('도달: 시작점에서 보스 방에 닿지 못함');
  if (exit && closed[at(exit.feature)] < 0) problems.push('도달: 시작점에서 출구 방에 닿지 못함');

  // ── 방 그래프: 깊이, 보스까지의 거리 ──
  const hops = new Array(rooms.length).fill(-1);
  const startRoom = kindOf('start')[0];
  if (startRoom) {
    hops[startRoom.id] = 0;
    const queue = [startRoom.id];
    for (let head = 0; head < queue.length; head++) {
      for (const id of rooms[queue[head]].doors) {
        const to = doors[id].to;
        if (hops[to] !== -1 || rooms[to].kind === 'exit' || rooms[to].kind === 'bonus') continue;
        hops[to] = hops[queue[head]] + 1;
        queue.push(to);
      }
    }
    for (const room of rooms) {
      if (room.kind === 'exit' || room.kind === 'bonus') continue;
      if (hops[room.id] !== room.depth) problems.push(`깊이: 방 ${room.id} 의 깊이 ${room.depth}(다시 센 값 ${hops[room.id]})`);
    }
    if (boss && hops[boss.id] < WORLD.rules.startBossMinHops) problems.push(`깊이: 보스 방이 시작 방에서 ${hops[boss.id]}걸음`);
  }
  if (exit && (exit.doors.length !== 1 || doors[exit.doors[0]].to !== boss?.id)) problems.push('출구 방: 보스 방 뒤에만 이어져 있어야 함');

  // ── 방마다: 한가운데 자리, 웨이브, 적이 나타나는 자리, 보상 ──
  const pool = new Map(plan.zone.enemies.map((e) => [e.id, e]));
  const clear = (i) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (tiles[i + dy * w + dx] !== FLOOR) return false;
    return true;
  };
  let boonRooms = 0;
  let weaponRooms = 0;
  let enemies = 0;
  let waves = 0;
  let spawnMin = Infinity;
  for (const room of rooms) {
    const label = `방 ${room.id}(${room.kind})`;
    const f = at(room.feature);
    if (roomOf[f] !== room.id || !clear(f)) problems.push(`한가운데: ${label} 의 자리가 방 밖이거나 벽 옆`);
    const fight = room.kind === 'combat' || room.kind === 'elite' || room.kind === 'boss';
    if (!fight) {
      if (room.waves.length > 0 || room.spawnCells.length > 0) problems.push(`웨이브: 싸움이 없는 ${label} 에 웨이브가 있음`);
    } else {
      if (room.kind === 'boss') {
        if (room.waves.length !== 1 || room.waves[0].length !== 1 || room.waves[0][0].type !== plan.zone.boss.id) problems.push(`웨이브: ${label} 의 구성이 보스 하나가 아님`);
      } else {
        if (room.waves.length < 2 || room.waves.length > 3) problems.push(`웨이브: ${label} 의 웨이브가 ${room.waves.length}회(2~3회여야 함)`);
        for (const wave of room.waves) {
          if (wave.length === 0) problems.push(`웨이브: ${label} 에 빈 웨이브`);
          for (const spawn of wave) {
            const def = pool.get(spawn.type);
            if (!def) problems.push(`웨이브: ${label} 에 구역에 없는 적 ${spawn.type}`);
            else if (def.minDepth > room.depth) problems.push(`웨이브: ${label}(깊이 ${room.depth}) 에 너무 이른 적 ${spawn.type}`);
          }
          const elites = wave.filter((s) => s.elite).length;
          if (elites !== (room.kind === 'elite' ? ENCOUNTERS.elite.perWave : 0)) problems.push(`웨이브: ${label} 의 정예가 ${elites}마리`);
          enemies += wave.length;
        }
        waves += room.waves.length;
      }
      // 적이 나타나는 자리: 방 안, 둘레 8칸이 바닥, 문에서 두 칸 이상, 겹치지 않음, 가장 큰 웨이브보다 넉넉히 많음.
      const doorCells = room.doors.flatMap((id) => doors[id].cells);
      const seen = new Set();
      for (const c of room.spawnCells) {
        const [x, y] = xy(c);
        if (seen.has(c)) problems.push(`스폰: ${label} 에 겹치는 자리 @${x},${y}`);
        seen.add(c);
        if (!Number.isInteger(c) || !inRect(room, x, y) || roomOf[c] !== room.id) {
          problems.push(`스폰: ${label} 의 자리가 방 밖 @${x},${y}`);
          continue;
        }
        if (!clear(c)) problems.push(`스폰: ${label} 의 자리가 벽 옆 @${x},${y}`);
        if (closed[c] < 0) problems.push(`스폰: ${label} 의 자리에 닿지 못함 @${x},${y}`);
        for (const d of doorCells) {
          const [dx, dy] = xy(d);
          if (Math.max(Math.abs(dx - x), Math.abs(dy - y)) < WORLD.rules.spawnDoorDist) {
            problems.push(`스폰: ${label} 의 자리가 문 바로 앞 @${x},${y}`);
            break;
          }
        }
      }
      const largest = Math.max(...room.waves.map((wave) => wave.length));
      if (room.spawnCells.length < largest + WORLD.rules.spawnSpare) problems.push(`스폰: ${label} 의 자리가 ${room.spawnCells.length}개(가장 큰 웨이브 ${largest}마리)`);
      if (room.spawnCells.length < spawnMin) spawnMin = room.spawnCells.length;
    }
    if (room.kind === 'combat') {
      if (!['weapon', 'boon', 'gold', 'health'].includes(room.reward)) problems.push(`보상: ${label} 의 보상 ${room.reward}`);
      if (room.reward === 'boon') boonRooms++;
      if (room.reward === 'weapon') weaponRooms++;
    }
  }
  if (boonRooms < ENCOUNTERS.rewards.minBoon) problems.push(`보상: 축복 방이 ${boonRooms}개`);
  if (weaponRooms < ENCOUNTERS.rewards.minWeapon) problems.push(`보상: 무기 방이 ${weaponRooms}개`);

  return { problems, pathLength, corridorMax, enemies, waves, spawnMin, counted, loops: links.filter((l) => !l.secret).length - (rooms.length - (bonus ? 1 : 0) - 1) };
}

// ── 한 묶음 처리 ─────────────────────────────────────────────────────────────

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function emptyStats() {
  return {
    maps: 0, times: [], attempts: {}, fallback: 0, roomCount: {}, kinds: {}, rewards: {}, covers: {},
    openSum: 0, pathSum: 0, pathMin: Infinity, pathMax: 0, corridorMax: 0, enemies: 0, waves: 0, spawnMin: Infinity, loops: 0,
    combatW: [Infinity, 0], combatH: [Infinity, 0], doorsSum: 0, bossDepth: {},
  };
}

function runSlice({ prefix, from, to }) {
  const out = { failures: [], failureCount: 0, stats: emptyStats(), rejects: {}, digestXor: 0, digestSum: 0 };
  const st = out.stats;
  const addFailure = (seed, floor, check, detail) => {
    out.failureCount++;
    if (out.failures.length < 200) out.failures.push({ seed, floor, check, detail });
  };
  const bump = (table, key, n = 1) => {
    table[key] = (table[key] ?? 0) + n;
  };

  for (let n = from; n < to; n++) {
    const seed = `${prefix}${n}`;
    const worldRng = Rng.fromSeed(seed).fork('world');
    for (let floor = 1; floor <= TOTAL_FLOORS; floor++) {
      st.maps++;
      let map;
      const t0 = performance.now();
      try {
        map = generateFloorFromRng(worldRng, floor, {
          onReject: (attempt, reasons) => {
            for (const r of reasons) bump(out.rejects, r.split(':')[0]);
          },
        });
      } catch (err) {
        addFailure(seed, floor, '예외', String(err?.message ?? err));
        continue;
      }
      st.times.push(performance.now() - t0);

      const errors = validateFloor(map);
      if (errors.length > 0) addFailure(seed, floor, 'validateFloor', errors.slice(0, 4).join(' | '));
      let check;
      try {
        check = independentCheck(map);
      } catch (err) {
        addFailure(seed, floor, '독립 검사 예외', String(err?.stack ?? err).split('\n').slice(0, 2).join(' '));
        continue;
      }
      if (check.problems.length > 0) addFailure(seed, floor, '독립 검사', check.problems.slice(0, 4).join(' | '));
      if (map.gen.fallback) addFailure(seed, floor, '비상 레이아웃', `시도 ${map.gen.attempts}회 모두 실패`);

      // 재현성: 같은 (시드, 층)을 새 난수 객체로 다시 만든다.
      const text = JSON.stringify(map);
      if (JSON.stringify(generateFloor({ seed, floor })) !== text) addFailure(seed, floor, '재현성', '다시 만든 결과가 다름');
      const hash = fnv1a(text);
      out.digestXor = (out.digestXor ^ hash) >>> 0;
      out.digestSum = (out.digestSum + hash) >>> 0;

      bump(st.attempts, map.gen.attempts);
      if (map.gen.fallback) st.fallback++;
      bump(st.roomCount, check.counted);
      for (const room of map.rooms) {
        bump(st.kinds, room.kind);
        if (room.kind === 'combat') bump(st.rewards, room.reward);
        if (room.kind === 'combat' || room.kind === 'elite') {
          bump(st.covers, room.cover);
          st.combatW = [Math.min(st.combatW[0], room.w), Math.max(st.combatW[1], room.w)];
          st.combatH = [Math.min(st.combatH[0], room.h), Math.max(st.combatH[1], room.h)];
        }
        if (room.kind === 'boss') bump(st.bossDepth, room.depth);
      }
      st.openSum += map.tiles.reduce((a, t) => a + (t !== 0 ? 1 : 0), 0) / map.tiles.length;
      st.pathSum += check.pathLength;
      st.pathMin = Math.min(st.pathMin, check.pathLength);
      st.pathMax = Math.max(st.pathMax, check.pathLength);
      st.corridorMax = Math.max(st.corridorMax, check.corridorMax);
      st.enemies += check.enemies;
      st.waves += check.waves;
      st.spawnMin = Math.min(st.spawnMin, check.spawnMin);
      st.doorsSum += map.doors.length;
      if (check.loops > 0) st.loops++;
    }
  }
  return out;
}

function merge(parts) {
  const total = { failures: [], failureCount: 0, stats: emptyStats(), rejects: {}, digestXor: 0, digestSum: 0 };
  const st = total.stats;
  const add = (a, b) => {
    for (const key of Object.keys(b)) a[key] = (a[key] ?? 0) + b[key];
  };
  for (const part of parts) {
    total.failureCount += part.failureCount;
    total.failures.push(...part.failures);
    total.digestXor = (total.digestXor ^ part.digestXor) >>> 0;
    total.digestSum = (total.digestSum + part.digestSum) >>> 0;
    add(total.rejects, part.rejects);
    const s = part.stats;
    st.maps += s.maps;
    st.times.push(...s.times);
    st.fallback += s.fallback;
    for (const key of ['attempts', 'roomCount', 'kinds', 'rewards', 'covers', 'bossDepth']) add(st[key], s[key]);
    for (const key of ['openSum', 'pathSum', 'enemies', 'waves', 'doorsSum', 'loops']) st[key] += s[key];
    st.pathMin = Math.min(st.pathMin, s.pathMin);
    st.pathMax = Math.max(st.pathMax, s.pathMax);
    st.corridorMax = Math.max(st.corridorMax, s.corridorMax);
    st.spawnMin = Math.min(st.spawnMin, s.spawnMin);
    st.combatW = [Math.min(st.combatW[0], s.combatW[0]), Math.max(st.combatW[1], s.combatW[1])];
    st.combatH = [Math.min(st.combatH[0], s.combatH[0]), Math.max(st.combatH[1], s.combatH[1])];
  }
  return total;
}

const hex = (n) => n.toString(16).padStart(8, '0');

function report(total, { seeds, prefix, from, workers, wallMs }) {
  const st = total.stats;
  const n = st.maps;
  const sorted = st.times.slice().sort((a, b) => a - b);
  const pct = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0);
  const table = (obj) => Object.keys(obj).sort((a, b) => (Number(a) - Number(b)) || a.localeCompare(b)).map((k) => `${k}: ${obj[k]}`).join(', ');
  const per = (count) => (count / n).toFixed(2);
  console.log(`맵 ${n}개 (시드 ${prefix}${from} ~ ${prefix}${from + seeds - 1}, 층 ${TOTAL_FLOORS}개, 워커 ${workers}개, ${(wallMs / 1000).toFixed(1)}초)`);
  console.log(`\n생성 시간(ms): 평균 ${(sorted.reduce((a, b) => a + b, 0) / Math.max(1, sorted.length)).toFixed(2)}, 중앙 ${pct(0.5).toFixed(2)}, 99% ${pct(0.99).toFixed(2)}, 최대 ${pct(1).toFixed(2)}`);
  console.log(`시도 횟수: ${table(st.attempts)}`);
  console.log(`버려진 시도의 사유: ${table(total.rejects) || '없음'}`);
  console.log(`비상 레이아웃: ${st.fallback}`);
  console.log(`\n방 수(출구·숨은 방 제외): ${table(st.roomCount)}`);
  console.log(`방 종류(층당): ${Object.keys(st.kinds).sort().map((k) => `${k} ${per(st.kinds[k])}`).join(', ')}`);
  console.log(`전투방 크기: 가로 ${st.combatW[0]}~${st.combatW[1]}, 세로 ${st.combatH[0]}~${st.combatH[1]}`);
  console.log(`엄폐물 무늬: ${table(st.covers)}`);
  console.log(`전투방 보상: ${table(st.rewards)}`);
  console.log(`보스 방의 깊이: ${table(st.bossDepth)}`);
  console.log(`문: 층당 ${per(st.doorsSum)}개, 가장 긴 복도 ${st.corridorMax}칸, 순환로가 있는 층 ${((st.loops / n) * 100).toFixed(1)}%`);
  console.log(`웨이브: 층당 ${per(st.waves)}회, 적 ${per(st.enemies)}마리(보스 제외). 적이 나타나는 자리가 가장 적은 방: ${st.spawnMin}개`);
  console.log(`바닥 비율: 평균 ${((st.openSum / n) * 100).toFixed(1)}%. 시작점→보스 방 걸음 수: 평균 ${(st.pathSum / n).toFixed(0)}, 최소 ${st.pathMin}, 최대 ${st.pathMax}`);
  console.log(`\n결과 지문(같은 시드 범위면 실행마다 같아야 함): ${hex(total.digestXor)}-${hex(total.digestSum)}`);
  if (total.failureCount === 0) {
    console.log('\n실패 0건');
  } else {
    console.log(`\n실패 ${total.failureCount}건${total.failureCount > total.failures.length ? ` (처음 ${total.failures.length}건만 표시)` : ''}:`);
    for (const f of total.failures.slice(0, 40)) console.log(`  [${f.seed} ${f.floor}층] ${f.check}: ${f.detail}`);
  }
}

function option(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

if (!isMainThread) {
  parentPort.postMessage(runSlice(workerData));
} else if (process.argv.includes('--show')) {
  const i = process.argv.indexOf('--show');
  const seed = process.argv[i + 1];
  const floor = Number(process.argv[i + 2] ?? 1);
  const map = generateFloor({ seed, floor });
  console.log(toAscii(map, { spawns: process.argv.includes('--spawns') }));
  for (const room of map.rooms) {
    console.log(`  방 ${room.id}: ${room.kind} 깊이 ${room.depth} ${room.w}x${room.h} 엄폐 ${room.cover} 보상 ${room.reward ?? '-'} 문 ${room.doors.length} 웨이브 [${room.waves.map((wv) => wv.map((s) => (s.elite ? `*${s.type}` : s.type)).join('+')).join(' / ')}] 자리 ${room.spawnCells.length}`);
  }
  const check = independentCheck(map);
  console.log(`  검증: ${[...validateFloor(map), ...check.problems].join(' | ') || '통과'} (시도 ${map.gen.attempts}회${map.gen.fallback ? ', 비상 레이아웃' : ''})`);
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const seeds = Number(option('seeds', 5000));
  const from = Number(option('from', 0));
  const prefix = option('prefix', 'sweep-');
  const workers = Math.max(1, Math.min(8, Number(option('workers', availableParallelism())), seeds));
  if (!Number.isInteger(seeds) || seeds < 1 || !Number.isInteger(from) || from < 0) {
    console.error('사용법: node scripts/verify-maps.mjs [--seeds N] [--from N] [--prefix 글자] [--workers N] | --show <시드> <층> [--spawns]');
    process.exit(2);
  }
  const started = performance.now();
  const chunk = Math.ceil(seeds / workers);
  const parts = await Promise.all(Array.from({ length: workers }, (_, k) => new Promise((resolve, reject) => {
    const a = from + k * chunk;
    const b = Math.min(from + seeds, a + chunk);
    if (a >= b) return resolve(runSlice({ prefix, from: 0, to: 0 }));
    const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { prefix, from: a, to: b } });
    worker.on('message', resolve);
    worker.on('error', reject);
    return undefined;
  })));
  const total = merge(parts);
  report(total, { seeds, prefix, from, workers, wallMs: performance.now() - started });
  process.exit(total.failureCount > 0 ? 1 : 0);
}

export { independentCheck };
