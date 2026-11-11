// 맵 검증기. 생성기가 만든 층이 규칙을 모두 지키는지 생성기와 별개의 코드로 다시 확인한다.
// 생성기는 이 검증을 통과한 층만 내보내고, 테스트와 대량 검증 도구도 같은 함수를 쓴다.
// 갓 만든 층(아무 방도 들어가지 않은 상태)을 대상으로 한다.

import { ENCOUNTERS } from '../../../data/encounters.js';
import { WORLD } from '../../../data/world.js';
import { FLOOR_KIND, REWARD, ROOM_KIND, floorPlan, isFightRoom } from './floors.js';
import { bfsDistances, isClear } from './grid.js';
import { doorCenter, readStructure } from './structure.js';
import { TILE } from './tiles.js';

const ROOM_KINDS = new Set(Object.values(ROOM_KIND));
const REWARDS = new Set(Object.values(REWARD));

function isPoint(p) {
  return p !== null && typeof p === 'object' && Number.isInteger(p.x) && Number.isInteger(p.y);
}

const sameList = (a, b) => Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * @param {object} map generateFloor 가 돌려주는 형태의 층
 * @returns {string[]} 위반 목록('코드: 설명'). 비어 있으면 정상.
 */
export function validateFloor(map) {
  const errors = [];
  const fail = (code, detail) => errors.push(detail === undefined ? code : `${code}: ${detail}`);

  if (map === null || typeof map !== 'object') return ['bad-map'];

  let plan;
  try {
    plan = floorPlan(map.floor);
  } catch {
    return [`bad-floor: ${map.floor}`];
  }
  const { zone } = plan;
  const rules = WORLD.rules;

  // ── 형태 ──
  const { width: w, height: h, tiles } = map;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 3 || h < 3) return [`bad-size: ${w}x${h}`];
  if (!Array.isArray(tiles) || tiles.length !== w * h) return ['bad-tiles-length'];
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] !== TILE.WALL && tiles[i] !== TILE.FLOOR && tiles[i] !== TILE.DOOR) return [`bad-tile-value: ${tiles[i]} @${i}`];
  }
  if (map.zoneId !== zone.id) fail('wrong-zone', `${map.zoneId} (기대: ${zone.id})`);
  if (map.kind !== FLOOR_KIND.STAGE) fail('wrong-kind', `${map.kind}`);
  if (map.algorithm !== 'rooms' && map.algorithm !== 'fallback') fail('wrong-algorithm', `${map.algorithm}`);
  if (!Array.isArray(map.rooms) || !Array.isArray(map.doors) || !Array.isArray(map.links) || map.rooms.length === 0) {
    return [...errors, 'bad-lists'];
  }

  const at = (p) => p.y * w + p.x;

  // ── 테두리는 전부 벽 ──
  let openBorder = 0;
  for (let x = 0; x < w; x++) {
    if (tiles[x] !== TILE.WALL) openBorder++;
    if (tiles[(h - 1) * w + x] !== TILE.WALL) openBorder++;
  }
  for (let y = 1; y < h - 1; y++) {
    if (tiles[y * w] !== TILE.WALL) openBorder++;
    if (tiles[y * w + w - 1] !== TILE.WALL) openBorder++;
  }
  if (openBorder > 0) fail('open-border', `${openBorder}칸`);

  // ── 방: 형태, 종류, 크기 ──
  const byKind = {};
  for (let r = 0; r < map.rooms.length; r++) {
    const room = map.rooms[r];
    const label = `방 ${r}`;
    if (!room || room.id !== r || ![room.x, room.y, room.w, room.h, room.depth].every(Number.isInteger)) return [...errors, `bad-room: ${label}`];
    if (!ROOM_KINDS.has(room.kind)) return [...errors, `bad-room-kind: ${label} ${room.kind}`];
    if (room.x < 1 || room.y < 1 || room.w < 3 || room.h < 3 || room.x + room.w > w - 1 || room.y + room.h > h - 1) {
      return [...errors, `room-out-of-bounds: ${label}`];
    }
    if (!Array.isArray(room.doors) || !Array.isArray(room.waves) || !Array.isArray(room.spawnCells) || !isPoint(room.feature)) {
      return [...errors, `bad-room-lists: ${label}`];
    }
    (byKind[room.kind] ??= []).push(room);
    if (room.state !== 'idle' || room.wave !== 0 || room.seen !== false) fail('room-not-fresh', label);
    const cave = room.kind === ROOM_KIND.BONUS;
    if (room.shape !== (cave ? 'cave' : 'rect')) fail('room-shape', `${label} ${room.shape}`);
    if (!cave && (room.w % 2 === 0 || room.h % 2 === 0)) fail('room-even-size', `${label} ${room.w}x${room.h}`);
    if ((room.kind === ROOM_KIND.COMBAT || room.kind === ROOM_KIND.ELITE) && (room.w < WORLD.layout.roomMinW || room.h < WORLD.layout.roomMinH)) {
      fail('combat-room-too-small', `${label} ${room.w}x${room.h}`);
    }
    if (room.kind === ROOM_KIND.BOSS && (room.w < WORLD.boss.arenaW[0] || room.h < WORLD.boss.arenaH[0])) {
      fail('boss-room-too-small', `${label} ${room.w}x${room.h}`);
    }
  }
  const count = (kind) => (byKind[kind] ? byKind[kind].length : 0);
  for (const kind of [ROOM_KIND.START, ROOM_KIND.BOSS, ROOM_KIND.EXIT]) {
    if (count(kind) !== 1) fail('room-kind-count', `${kind} ${count(kind)}개`);
  }
  for (const kind of [ROOM_KIND.SHOP, ROOM_KIND.REWARD, ROOM_KIND.BONUS]) {
    if (count(kind) > 1) fail('room-kind-count', `${kind} ${count(kind)}개`);
  }
  if (errors.length > 0) return errors;
  const counted = map.rooms.length - count(ROOM_KIND.EXIT) - count(ROOM_KIND.BONUS);
  if (counted < WORLD.roomCount[0] || counted > WORLD.roomCount[1]) fail('room-count', `${counted}`);
  if (count(ROOM_KIND.COMBAT) + count(ROOM_KIND.ELITE) < rules.minCombatRooms) fail('too-few-combat-rooms');
  const startRoom = byKind[ROOM_KIND.START][0];
  const bossRoom = byKind[ROOM_KIND.BOSS][0];
  const exitRoom = byKind[ROOM_KIND.EXIT][0];
  const bonusRoom = byKind[ROOM_KIND.BONUS] ? byKind[ROOM_KIND.BONUS][0] : null;

  // ── 구조: 타일에서 다시 읽은 방·복도·문이 맵에 적힌 것과 같아야 한다 ──
  const structure = readStructure(tiles, w, h, map.rooms);
  for (const e of structure.errors) fail('structure', e);
  if (structure.links.length !== map.links.length) return [...errors, `link-count: ${map.links.length} (타일: ${structure.links.length})`];
  let doorCount = 0;
  for (let l = 0; l < map.links.length; l++) {
    const link = map.links[l];
    const found = structure.links[l];
    const label = `복도 ${l}`;
    if (!link || link.id !== l || !sameList(link.rooms, found.rooms) || !Array.isArray(link.doors) || link.doors.length !== found.doors.length) {
      return [...errors, `bad-link: ${label}`];
    }
    if (link.seen !== false) fail('link-not-fresh', label);
    const secret = bonusRoom !== null && link.rooms.includes(bonusRoom.id);
    if (link.secret !== secret) fail('link-secret', label);
    for (let k = 0; k < link.doors.length; k++) {
      const door = map.doors[link.doors[k]];
      const real = found.doors[k];
      const dl = `문 ${link.doors[k]}`;
      if (!door || door.id !== link.doors[k] || door.link !== l || door.room !== real.room || !sameList(door.cells, real.cells)) {
        return [...errors, `bad-door: ${dl}`];
      }
      doorCount++;
      const other = link.rooms[0] === door.room ? link.rooms[1] : link.rooms[0];
      if (door.to !== other) fail('door-target', dl);
      const center = doorCenter(real.cells, w);
      if (door.x !== center.x || door.y !== center.y) fail('door-center', dl);
      if (!map.rooms[door.room].doors.includes(door.id)) fail('door-not-listed', dl);
      // 닫힌 문은 숨은 방으로 가는 굴의 방 쪽 입구뿐이다.
      const hidden = secret && door.room !== bonusRoom.id;
      if (door.secret !== hidden || door.open !== !hidden) fail('door-state', dl);
      for (const c of door.cells) {
        if (tiles[c] !== (hidden ? TILE.DOOR : TILE.FLOOR)) fail('door-tile', `${dl} @${c}`);
      }
      // 문 앞: 문 칸에서 방 안쪽으로 두 칸은 비어 있어야 한다(엄폐물이 문을 막지 않는다).
      if (map.rooms[door.room].shape === 'rect') {
        for (const c of door.cells) {
          const x = c % w;
          const y = Math.floor(c / w);
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (structure.regionAt[(y + dy) * w + x + dx] !== door.room) continue;
            if (tiles[(y + dy * 2) * w + x + dx * 2] !== TILE.FLOOR) fail('door-blocked', dl);
          }
        }
      }
    }
  }
  if (doorCount !== map.doors.length) fail('door-count', `${map.doors.length} (복도에서 센 수: ${doorCount})`);
  let doorTiles = 0;
  for (let i = 0; i < tiles.length; i++) if (tiles[i] === TILE.DOOR) doorTiles++;
  const closedCells = map.doors.reduce((n, d) => n + (d.open ? 0 : d.cells.length), 0);
  if (doorTiles !== closedCells) fail('stray-door-tile', `${doorTiles - closedCells}칸`);
  for (const room of map.rooms) {
    for (const id of room.doors) if (!map.doors[id] || map.doors[id].room !== room.id) fail('room-door-mismatch', `방 ${room.id} 문 ${id}`);
  }
  if (errors.length > 0) return errors;

  // ── 방 그래프: 깊이, 시작 방과 보스 방 사이, 출구 방·숨은 방이 달린 자리 ──
  const side = new Set([exitRoom.id]);
  if (bonusRoom) side.add(bonusRoom.id);
  const neighbors = (id) => map.links.filter((l) => l.rooms.includes(id)).map((l) => (l.rooms[0] === id ? l.rooms[1] : l.rooms[0]));
  const depth = new Array(map.rooms.length).fill(-1);
  depth[startRoom.id] = 0;
  const order = [startRoom.id];
  for (let head = 0; head < order.length; head++) {
    for (const n of neighbors(order[head])) {
      if (depth[n] !== -1 || side.has(n)) continue;
      depth[n] = depth[order[head]] + 1;
      order.push(n);
    }
  }
  for (const room of map.rooms) {
    if (side.has(room.id)) continue;
    if (depth[room.id] < 0) fail('room-unreachable', `방 ${room.id}`);
    else if (room.depth !== depth[room.id]) fail('room-depth', `방 ${room.id}: ${room.depth} (기대: ${depth[room.id]})`);
  }
  if (depth[bossRoom.id] >= 0 && depth[bossRoom.id] < rules.startBossMinHops) fail('boss-too-close', `${depth[bossRoom.id]}`);
  if (!sameList(neighbors(exitRoom.id), [bossRoom.id])) fail('exit-not-behind-boss');
  if (exitRoom.depth !== bossRoom.depth + 1) fail('room-depth', `출구 방 ${exitRoom.depth}`);
  if (bonusRoom) {
    const n = neighbors(bonusRoom.id);
    if (n.length !== 1 || side.has(n[0])) fail('bonus-link');
    else if (bonusRoom.depth !== depth[n[0]] + 1) fail('room-depth', `숨은 방 ${bonusRoom.depth}`);
  }
  for (const kind of [ROOM_KIND.SHOP, ROOM_KIND.REWARD]) {
    for (const room of byKind[kind] ?? []) if (room.depth < rules.eventMinDepth) fail('event-room-near-start', `${kind}`);
  }

  // ── 시작점 ──
  if (!isPoint(map.start) || map.start.x !== startRoom.feature.x || map.start.y !== startRoom.feature.y) return [...errors, 'start-misplaced'];

  // ── 도달 가능성 ──
  // 숨은 문이 닫힌 그대로: 숨은 방과 그 굴을 뺀 모든 바닥에 닿아야 한다. 숨은 문을 열면: 남는 바닥이 없어야 한다.
  const secretRegions = new Set();
  if (bonusRoom) {
    secretRegions.add(bonusRoom.id);
    map.links.forEach((link, l) => {
      if (link.secret) secretRegions.add(map.rooms.length + l);
    });
  }
  const dist = bfsDistances(tiles, w, h, at(map.start));
  let isolated = 0;
  let leaked = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] !== TILE.FLOOR) continue;
    const hiddenCell = secretRegions.has(structure.regionAt[i]);
    if (dist[i] < 0 && !hiddenCell) isolated++;
    if (dist[i] >= 0 && hiddenCell) leaked++;
  }
  if (isolated > 0) fail('isolated-floor', `${isolated}칸`);
  if (leaked > 0) fail('secret-room-open', `${leaked}칸`);
  const opened = tiles.map((t) => (t === TILE.DOOR ? TILE.FLOOR : t));
  const openDist = bfsDistances(opened, w, h, at(map.start));
  let unreachable = 0;
  for (let i = 0; i < opened.length; i++) if (opened[i] === TILE.FLOOR && openDist[i] < 0) unreachable++;
  if (unreachable > 0) fail('unreachable-floor', `${unreachable}칸`);

  // ── 방마다: 한가운데 자리, 웨이브, 적이 나타나는 자리, 보상 ──
  const clear = (i) => isClear(tiles, w, i);
  const pool = new Map(zone.enemies.map((e) => [e.id, e]));
  let boonRooms = 0;
  let weaponRooms = 0;
  for (const room of map.rooms) {
    const label = `방 ${room.id}(${room.kind})`;
    const f = room.feature;
    if (f.x < 1 || f.y < 1 || f.x >= w - 1 || f.y >= h - 1 || structure.regionAt[at(f)] !== room.id || !clear(at(f))) fail('feature-misplaced', label);

    const fight = isFightRoom(room.kind);
    if (!fight) {
      if (room.waves.length > 0 || room.spawnCells.length > 0) fail('waves-in-calm-room', label);
    } else {
      // 웨이브
      let largest = 0;
      if (room.kind === ROOM_KIND.BOSS) {
        const ok = room.waves.length === 1 && room.waves[0].length === 1 && room.waves[0][0].type === zone.boss?.id && room.waves[0][0].elite === false;
        if (!ok) fail('boss-wave', label);
        largest = 1;
      } else {
        const elite = room.kind === ROOM_KIND.ELITE;
        const range = elite ? ENCOUNTERS.elite.waves : room.depth <= ENCOUNTERS.waves.shallowDepth ? ENCOUNTERS.waves.shallow : ENCOUNTERS.waves.deep;
        if (room.waves.length < range[0] || room.waves.length > range[1]) fail('wave-count', `${label} ${room.waves.length}`);
        for (const wave of room.waves) {
          if (!Array.isArray(wave) || wave.length === 0) {
            fail('empty-wave', label);
            continue;
          }
          const limit = ENCOUNTERS.maxPerWave + (elite ? ENCOUNTERS.elite.perWave : 0);
          if (wave.length > limit) fail('wave-too-big', `${label} ${wave.length}`);
          if (wave.length > largest) largest = wave.length;
          let elites = 0;
          for (const spawn of wave) {
            const def = spawn ? pool.get(spawn.type) : null;
            if (!def) fail('unknown-enemy', `${label} ${spawn?.type}`);
            else if (def.minDepth > room.depth) fail('enemy-too-early', `${label} ${spawn.type}`);
            if (spawn && spawn.elite === true) elites++;
          }
          if (elites !== (elite ? ENCOUNTERS.elite.perWave : 0)) fail('elite-count', `${label} ${elites}`);
        }
      }
      // 적이 나타나는 자리
      const doorCells = room.doors.flatMap((id) => map.doors[id].cells);
      const seen = new Set();
      for (const c of room.spawnCells) {
        if (!Number.isInteger(c) || c < w || c >= tiles.length - w) {
          fail('spawn-cell-out-of-bounds', `${label} @${c}`);
          continue;
        }
        if (seen.has(c)) fail('spawn-cell-duplicate', `${label} @${c}`);
        seen.add(c);
        if (structure.regionAt[c] !== room.id) fail('spawn-cell-outside-room', `${label} @${c}`);
        else if (!clear(c)) fail('spawn-cell-cramped', `${label} @${c}`);
        const x = c % w;
        const y = Math.floor(c / w);
        for (const d of doorCells) {
          if (Math.max(Math.abs((d % w) - x), Math.abs(Math.floor(d / w) - y)) < rules.spawnDoorDist) {
            fail('spawn-cell-near-door', `${label} @${c}`);
            break;
          }
        }
        if (dist[c] < 0) fail('spawn-cell-unreachable', `${label} @${c}`);
      }
      if (room.spawnCells.length < Math.max(rules.minSpawnCells, largest + rules.spawnSpare)) fail('too-few-spawn-cells', `${label} ${room.spawnCells.length}`);
    }

    // 보상
    const r = room.reward;
    if (room.kind === ROOM_KIND.COMBAT) {
      if (!REWARDS.has(r)) fail('bad-reward', `${label} ${r}`);
      if (r === REWARD.BOON) boonRooms++;
      if (r === REWARD.WEAPON) weaponRooms++;
    } else if (room.kind === ROOM_KIND.ELITE || room.kind === ROOM_KIND.BOSS) {
      if (r !== REWARD.BOON) fail('bad-reward', `${label} ${r}`);
    } else if (room.kind === ROOM_KIND.REWARD) {
      if (r !== REWARD.BOON && r !== REWARD.WEAPON) fail('bad-reward', `${label} ${r}`);
    } else if (room.kind === ROOM_KIND.BONUS) {
      if (r !== REWARD.WEAPON) fail('bad-reward', `${label} ${r}`);
    } else if (r !== null) {
      fail('bad-reward', `${label} ${r}`);
    }
  }
  if (boonRooms < ENCOUNTERS.rewards.minBoon) fail('too-few-boon-rooms', `${boonRooms}`);
  if (weaponRooms < ENCOUNTERS.rewards.minWeapon) fail('too-few-weapon-rooms', `${weaponRooms}`);

  return errors;
}
