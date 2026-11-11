// 방 전투(매 틱): 방에 들어서면 문이 잠기고, 웨이브가 차례로 나타나고, 모두 잡으면 문이 열리며 보상이 나온다.
// 방과 복도가 화면에 드러나는 것(방 단위 공개)과 숨은 문도 여기서 다룬다.

import { ENCOUNTERS } from '../../../data/encounters.js';
import { EVENTS } from '../core/events.js';
import { rngOf } from '../core/state.js';
import { ticksOf } from '../core/time.js';
import { getPlayer, opponentsOf, spawnEnemy } from '../entities/actors.js';
import { ROOM_KIND, isFightRoom } from '../world/floors.js';
import { navOf, regionAt, setTiles } from '../world/nav.js';
import { TILE } from '../world/tiles.js';
import { grantRoomReward } from './loot.js';

/** 플레이어가 있는 구역과, 거기서 보이는 곳을 드러낸다. */
function reveal(map, region) {
  if (region < map.rooms.length) {
    const room = map.rooms[region];
    room.seen = true;
    // 방에서 나가는 복도도 보인다. 숨은 문 뒤의 굴은 문을 찾은 뒤에만.
    for (const id of room.doors) {
      const door = map.doors[id];
      if (!door.secret || door.open) map.links[door.link].seen = true;
    }
  } else {
    // 복도에 서면 양쪽 방이 보인다.
    const link = map.links[region - map.rooms.length];
    link.seen = true;
    for (const id of link.rooms) map.rooms[id].seen = true;
  }
}

/** 플레이어가 방 안으로 충분히 들어섰는가(문턱에 서 있을 때 문이 닫히지 않도록). */
function deepInside(map, room, player) {
  const min = ENCOUNTERS.enterDepth;
  for (const id of room.doors) {
    const door = map.doors[id];
    const dx = door.x - player.x;
    const dy = door.y - player.y;
    if (dx * dx + dy * dy < min * min) return false;
  }
  return true;
}

/** 이번 웨이브의 적을 예고한다: 플레이어에게서 떨어진 자리를 골라 잠시 뒤에 나타나게 한다. */
function scheduleWave(state, bus, room, player) {
  const map = state.world;
  const wave = room.waves[room.wave];
  const at = state.tick + ticksOf(ENCOUNTERS.spawnWarnSec);
  const min = ENCOUNTERS.spawnMinPlayerDist;
  const cells = rngOf(state, 'entities').shuffle(room.spawnCells.slice());
  const dist2 = (c) => {
    const dx = (c % map.width) + 0.5 - player.x;
    const dy = Math.floor(c / map.width) + 0.5 - player.y;
    return dx * dx + dy * dy;
  };
  // 충분히 먼 자리를 먼저 쓰고, 모자라면 먼 순서로 채운다.
  let pool = cells.filter((c) => dist2(c) >= min * min);
  if (pool.length < wave.length) pool = cells.slice().sort((a, b) => dist2(b) - dist2(a) || a - b);
  const pending = state.encounter.pending;
  for (let i = 0; i < wave.length; i++) {
    const spawn = wave[i];
    // 보스는 방 한가운데에 나타난다.
    const cell = room.kind === ROOM_KIND.BOSS ? room.feature.y * map.width + room.feature.x : pool[i % pool.length];
    pending.push({ type: spawn.type, elite: spawn.elite === true, x: (cell % map.width) + 0.5, y: Math.floor(cell / map.width) + 0.5, at });
  }
  bus.emit(EVENTS.WAVE_STARTED, { roomId: room.id, wave: room.wave, waves: room.waves.length, count: wave.length });
}

function startEncounter(state, bus, room, player) {
  const map = state.world;
  room.state = 'active';
  room.wave = 0;
  state.run.depth = room.depth;
  const locked = [];
  for (const id of room.doors) {
    const door = map.doors[id];
    if (!door.open) continue;
    setTiles(map, door.cells, TILE.DOOR);
    door.open = false;
    locked.push(id);
  }
  state.encounter = { room: room.id, pending: [], nextWaveAt: 0 };
  bus.emit(EVENTS.ROOM_ENTERED, { roomId: room.id, kind: room.kind });
  bus.emit(EVENTS.DOORS_LOCKED, { roomId: room.id, doors: locked });
  scheduleWave(state, bus, room, player);
}

function clearRoom(state, bus, room) {
  const map = state.world;
  room.state = 'cleared';
  state.encounter = null;
  state.run.roomsCleared += 1;
  const opened = [];
  for (const id of room.doors) {
    const door = map.doors[id];
    // 아직 찾지 못한 숨은 문은 닫힌 채로 둔다.
    if (door.open || door.secret) continue;
    setTiles(map, door.cells, TILE.FLOOR);
    door.open = true;
    opened.push(id);
  }
  // 남아 있던 적의 탄과 장판은 사라진다.
  state.projectiles = state.projectiles.filter((p) => p.faction === 'player');
  state.hazards = state.hazards.filter((hz) => hz.faction === 'player');
  bus.emit(EVENTS.DOORS_OPENED, { roomId: room.id, doors: opened });
  bus.emit(EVENTS.ROOM_CLEARED, { roomId: room.id, kind: room.kind, reward: room.reward });
  grantRoomReward(state, bus, room);
}

function runEncounter(state, bus, player) {
  const map = state.world;
  const enc = state.encounter;
  const room = map.rooms[enc.room];
  // 예고가 끝난 적이 나타난다.
  if (enc.pending.length > 0) {
    const waiting = [];
    for (const spawn of enc.pending) {
      if (state.tick < spawn.at) waiting.push(spawn);
      else spawnEnemy(state, bus, spawn.type, spawn.x, spawn.y, { alerted: true, elite: spawn.elite });
    }
    enc.pending = waiting;
  }
  if (enc.pending.length > 0 || opponentsOf(state, player.faction).length > 0) return;
  if (room.wave + 1 < room.waves.length) {
    // 다음 웨이브까지 잠깐 숨을 돌린다.
    if (enc.nextWaveAt === 0) {
      enc.nextWaveAt = state.tick + ticksOf(ENCOUNTERS.waveGapSec);
    } else if (state.tick >= enc.nextWaveAt) {
      enc.nextWaveAt = 0;
      room.wave += 1;
      scheduleWave(state, bus, room, player);
    }
    return;
  }
  clearRoom(state, bus, room);
}

/** 숨은 문: 금이 간 벽에 몸을 대거나 대시로 부딪치면 열린다. */
function checkSecretDoors(state, bus, player) {
  const map = state.world;
  if (!player.hitWall && !player.dash) return;
  for (const door of map.doors) {
    if (!door.secret || door.open || map.rooms[door.room].state === 'active') continue;
    const dx = door.x - player.x;
    const dy = door.y - player.y;
    if (dx * dx + dy * dy > 1.05 * 1.05) continue;
    setTiles(map, door.cells, TILE.FLOOR);
    door.open = true;
    map.links[door.link].seen = true;
    bus.emit(EVENTS.SECRET_FOUND, { doorId: door.id, roomId: door.room });
  }
}

export function updateEncounter(state, bus) {
  const map = state.world;
  const player = getPlayer(state);
  if (!player || player.dead) return;
  const region = regionAt(navOf(map), player.x, player.y);
  if (region >= 0) reveal(map, region);

  if (state.encounter) {
    runEncounter(state, bus, player);
    return;
  }
  if (region >= 0 && region < map.rooms.length) {
    const room = map.rooms[region];
    if (room.state === 'idle') {
      if (isFightRoom(room.kind)) {
        if (deepInside(map, room, player)) startEncounter(state, bus, room, player);
      } else {
        // 싸움이 없는 방은 들어서는 것으로 끝난다. 보상 방과 숨은 방은 보상을 놓는다.
        room.state = 'cleared';
        bus.emit(EVENTS.ROOM_ENTERED, { roomId: room.id, kind: room.kind });
        if (room.kind === ROOM_KIND.REWARD || room.kind === ROOM_KIND.BONUS) grantRoomReward(state, bus, room);
      }
    }
  }
  checkSecretDoors(state, bus, player);
}

/** 플레이어가 지금 있는 방(복도에 있으면 null). */
export function currentRoom(state) {
  const player = getPlayer(state);
  if (!player || !state.world) return null;
  const region = regionAt(navOf(state.world), player.x, player.y);
  return region >= 0 && region < state.world.rooms.length ? state.world.rooms[region] : null;
}
