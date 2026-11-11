// 층 생성 진입점. 같은 (런 시드, 층 번호)는 언제 어디서 호출해도 같은 층을 만든다.
//
// 한 층 = 방 구역(BSP 로 놓은 방들) + 보스 구역(결투장, 출구 방, 숨은 동굴방). 방은 짧은 복도로 이어지고 복도의 양 끝이 문이다.
//
// 난수 흐름: 런 시드 → fork('world') → fork(`floor:${n}`) → fork(`attempt:${k}`) / fork('fallback')
//           시도 하나 안에서는 → fork('layout') / fork('boss') / fork('bonus') / fork('roles') / fork('cover') / fork('waves') / fork('rewards')
// fork 는 부모를 소비하지 않으므로 층을 어떤 순서로 몇 번 만들든 결과가 같고,
// 웨이브·보상 수치를 바꿔도 지형(layout)은 바뀌지 않는다.

import { ENCOUNTERS } from '../../../data/encounters.js';
import { WORLD } from '../../../data/world.js';
import { Rng } from '../core/prng.js';
import { pickEventRoom } from './event-rooms.js';
import { FLOOR_KIND, REWARD, ROOM_KIND, floorPlan, isFightRoom } from './floors.js';
import { addCover, buildBossWing } from './gen-boss.js';
import { generateCave } from './gen-cave.js';
import { carveLink, createLayout, generateGridRooms, generateRooms, scanLinks } from './gen-rooms.js';
import { isClear, labelRegions } from './grid.js';
import { doorCenter, readStructure } from './structure.js';
import { TILE } from './tiles.js';
import { validateFloor } from './validate.js';

const reject = (reason) => ({ rejected: reason });

/** 숨은 보너스 방: 동굴 생성기로 모양을 만들어 보스 구역의 빈 절반에 찍고, 아래쪽 방까지 좁은 굴을 판다. 자리가 없으면 null. */
function addBonusRoom(rng, layout, band, wing) {
  const cfg = WORLD.bonus;
  if (!rng.chance(cfg.chance)) return null;
  const half = Math.floor(band.w / 2);
  const zoneX = wing.side === 'left' ? band.x + half + 1 : band.x + 1;
  const zoneW = half - 2;
  const cw = rng.int(cfg.w[0], cfg.w[1]);
  const ch = rng.int(cfg.h[0], cfg.h[1]);
  if (cw > zoneW) return null;
  const x0 = zoneX + rng.int(0, zoneW - cw);
  const y0 = band.y + band.h - 1 - ch - rng.int(0, 2);

  // 동굴에서 가장 큰 덩어리만 쓴다.
  const cave = generateCave(rng, cw, ch, WORLD.cave);
  const { labels, sizes } = labelRegions(cave.tiles, cw, ch);
  let main = -1;
  for (let r = 0; r < sizes.length; r++) if (main === -1 || sizes[r] > sizes[main]) main = r;
  if (main === -1 || sizes[main] < cfg.minCells) return null;

  const { tiles, roomAt, w } = layout;
  const id = layout.rooms.length;
  const stamped = [];
  for (let j = 0; j < ch; j++) {
    for (let i = 0; i < cw; i++) {
      if (labels[j * cw + i] !== main) continue;
      const cell = (y0 + j) * w + x0 + i;
      tiles[cell] = TILE.FLOOR;
      roomAt[cell] = id;
      stamped.push(cell);
    }
  }
  const room = { id, x: x0, y: y0, w: cw, h: ch, shape: 'cave', chamfer: 0 };
  layout.rooms.push(room);

  // 굴: 동굴의 맨 아래 칸에서 곧게 내려가 방에 닿는 자리 가운데 가장 짧은 것.
  const isWall = (x, y) => x >= 1 && y >= 1 && x < w - 1 && y < layout.h - 1 && tiles[y * w + x] === TILE.WALL;
  const candidates = [];
  for (let x = x0 + 1; x < x0 + cw - 1; x++) {
    let yb = -1;
    for (let y = y0 + ch - 1; y >= y0; y--) {
      if (roomAt[y * w + x] === id) {
        yb = y;
        break;
      }
    }
    if (yb === -1) continue;
    for (let s = 0; s <= cfg.maxTunnel; s++) {
      const y = yb + 1 + s;
      if (isWall(x, y)) {
        if (!isWall(x - 1, y) || !isWall(x + 1, y)) break;
        continue;
      }
      const b = y < layout.h ? roomAt[y * w + x] : -1;
      if (s >= 2 && b >= 0 && b !== id && roomAt[y * w + x - 1] === b && roomAt[y * w + x + 1] === b) {
        candidates.push({ a: id, b, dir: 'S', x, y: yb + 1, gap: s, width: 1 });
      }
      break;
    }
  }
  if (candidates.length === 0) {
    // 이을 수 없으면 찍은 것을 되돌린다.
    for (const cell of stamped) {
      tiles[cell] = TILE.WALL;
      roomAt[cell] = -1;
    }
    layout.rooms.pop();
    return null;
  }
  let min = Infinity;
  for (const c of candidates) if (c.gap < min) min = c.gap;
  carveLink(layout, rng.pick(candidates.filter((c) => c.gap === min)));
  return room;
}

/** 방 그래프에서 from 부터의 걸음 수. skip 에 든 방은 지나지 않는다. 닿지 못하면 -1. */
function roomHops(roomCount, links, from, skip) {
  const hops = new Array(roomCount).fill(-1);
  hops[from] = 0;
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const a = queue[head];
    for (const link of links) {
      const b = link.rooms[0] === a ? link.rooms[1] : link.rooms[1] === a ? link.rooms[0] : -1;
      if (b === -1 || hops[b] !== -1 || skip.has(b)) continue;
      hops[b] = hops[a] + 1;
      queue.push(b);
    }
  }
  return hops;
}

/** 방마다 종류와 깊이를 정한다. 규칙에 맞지 않으면 사유를 돌려준다. */
function assignRoles(rng, layout, bspRooms, wing, bonus) {
  const rules = WORLD.rules;
  const { rooms, links } = layout;
  const side = new Set([wing.exit.id]);
  if (bonus) side.add(bonus.id);
  const degree = (room) => links.filter((l) => l.rooms.includes(room.id) && !side.has(l.rooms[0]) && !side.has(l.rooms[1])).length;

  // 시작 방: 보스 방에서 가장 먼 방.
  const fromBoss = roomHops(rooms.length, links, wing.arena.id, side);
  let far = 0;
  for (const room of bspRooms) if (fromBoss[room.id] > far) far = fromBoss[room.id];
  if (far < rules.startBossMinHops) return 'boss-too-close';
  const start = rng.pick(bspRooms.filter((room) => fromBoss[room.id] === far));
  const depth = roomHops(rooms.length, links, start.id, side);
  for (const room of bspRooms) {
    if (depth[room.id] < 0) return 'room-unreachable';
    room.depth = depth[room.id];
  }
  wing.arena.depth = depth[wing.arena.id];
  wing.arena.kind = ROOM_KIND.BOSS;
  wing.exit.depth = wing.arena.depth + 1;
  wing.exit.kind = ROOM_KIND.EXIT;
  if (bonus) {
    const link = links.find((l) => l.rooms.includes(bonus.id));
    const neighbor = link.rooms[0] === bonus.id ? link.rooms[1] : link.rooms[0];
    bonus.depth = depth[neighbor] + 1;
    bonus.kind = ROOM_KIND.BONUS;
  }
  start.kind = ROOM_KIND.START;

  // 보스 방 바로 앞의 방은 전투방으로 둔다.
  let pool = bspRooms.filter((room) => room !== start && fromBoss[room.id] > 1);
  const depthOf = (room) => room.depth;
  const take = (room, kind) => {
    room.kind = kind;
    pool = pool.filter((r) => r !== room);
  };
  const shop = pickEventRoom(rng, pool, { minDepth: rules.eventMinDepth, preferLeaf: true }, depthOf, degree);
  if (shop) take(shop, ROOM_KIND.SHOP);
  const leaves = pool.filter((room) => degree(room) === 1);
  const reward = pickEventRoom(rng, leaves, { minDepth: rules.eventMinDepth, preferLeaf: true }, depthOf, degree);
  if (reward) take(reward, ROOM_KIND.REWARD);
  const eliteCandidates = rng.shuffle(pool.filter((room) => room.depth >= 2));
  // 정예방을 두더라도 보통 전투방이 셋은 남아야 한다(축복 방·무기 방을 채울 수 있도록).
  const unassigned = bspRooms.filter((room) => !room.kind).length;
  const eliteCount = Math.max(0, Math.min(eliteCandidates.length, rng.int(1, 2), unassigned - 3));
  for (let i = 0; i < eliteCount; i++) take(eliteCandidates[i], ROOM_KIND.ELITE);
  for (const room of bspRooms) if (!room.kind) room.kind = ROOM_KIND.COMBAT;

  const fights = bspRooms.filter((room) => room.kind === ROOM_KIND.COMBAT || room.kind === ROOM_KIND.ELITE).length;
  if (fights < rules.minCombatRooms) return 'too-few-combat-rooms';
  const counted = bspRooms.length + 1;
  if (counted < WORLD.roomCount[0] || counted > WORLD.roomCount[1]) return `room-count:${counted}`;
  return null;
}

/** 방 한가운데에서 가장 가까운, 둘레 8칸이 모두 바닥인 칸. */
function featureCell(layout, room, regionAt) {
  const { tiles, w } = layout;
  const cx = room.x + Math.floor(room.w / 2);
  const cy = room.y + Math.floor(room.h / 2);
  let best = null;
  let bestD = Infinity;
  for (let y = room.y + 1; y < room.y + room.h - 1; y++) {
    for (let x = room.x + 1; x < room.x + room.w - 1; x++) {
      const i = y * w + x;
      if (regionAt[i] !== room.id) continue;
      if (!isClear(tiles, w, i)) continue;
      const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  }
  return best;
}

/** 적이 나타날 수 있는 자리: 방 안의, 둘레 8칸이 모두 바닥이고 그 방의 문에서 충분히 떨어진 칸. */
function spawnCellsOf(layout, room, regionAt, doorCells) {
  const { tiles, w } = layout;
  const minDist = WORLD.rules.spawnDoorDist;
  const out = [];
  for (let y = room.y + 1; y < room.y + room.h - 1; y++) {
    for (let x = room.x + 1; x < room.x + room.w - 1; x++) {
      const i = y * w + x;
      if (regionAt[i] !== room.id) continue;
      if (!isClear(tiles, w, i)) continue;
      let near = false;
      for (const c of doorCells) {
        if (Math.max(Math.abs((c % w) - x), Math.abs(Math.floor(c / w) - y)) < minDist) {
          near = true;
          break;
        }
      }
      if (!near) out.push(i);
    }
  }
  return out;
}

/** 예산 안에서 적을 가중치로 뽑아 웨이브 하나를 채운다. */
function fillWave(rng, pool, budget, wave) {
  let left = budget;
  while (wave.length < ENCOUNTERS.maxPerWave) {
    const affordable = pool.filter((e) => e.cost <= left);
    if (affordable.length === 0) break;
    const picked = affordable[rng.weightedIndex(affordable.map((e) => e.weight))];
    wave.push({ type: picked.id, elite: false });
    left -= picked.cost;
  }
  return wave;
}

/** 방의 웨이브 구성. 깊을수록 예산이 크고, 뒤 웨이브일수록 조금 더 크다. */
function wavesOf(rng, zone, room) {
  const cfg = ENCOUNTERS;
  if (room.kind === ROOM_KIND.BOSS) return [[{ type: zone.boss.id, elite: false }]];
  const pool = zone.enemies.filter((e) => e.minDepth <= room.depth);
  const base = Math.min(cfg.budget.max, cfg.budget.base + cfg.budget.perDepth * room.depth);
  const waves = [];
  if (room.kind === ROOM_KIND.ELITE) {
    const count = rng.int(cfg.elite.waves[0], cfg.elite.waves[1]);
    // 정예는 예산에서 큰 몫을 차지하는 종류 가운데서 뽑는다.
    const heavy = pool.filter((e) => e.cost >= 2);
    for (let k = 0; k < count; k++) {
      const wave = [];
      for (let i = 0; i < cfg.elite.perWave; i++) {
        wave.push({ type: heavy[rng.weightedIndex(heavy.map((e) => e.weight))].id, elite: true });
      }
      waves.push(fillWave(rng, pool, Math.floor((base + cfg.budget.laterWaveBonus * k) * cfg.elite.budgetRatio), wave));
    }
    return waves;
  }
  const range = room.depth <= cfg.waves.shallowDepth ? cfg.waves.shallow : cfg.waves.deep;
  const count = rng.int(range[0], range[1]);
  for (let k = 0; k < count; k++) waves.push(fillWave(rng, pool, Math.floor(base + cfg.budget.laterWaveBonus * k), []));
  return waves;
}

/** 방마다 보상을 정한다. 한 층에 축복 방·무기 방이 정해진 수 이상 나오도록 맞춘다. */
function assignRewards(rng, rooms) {
  const cfg = ENCOUNTERS.rewards;
  const names = Object.keys(cfg.weights);
  const weights = names.map((name) => cfg.weights[name]);
  const combat = [];
  for (const room of rooms) {
    room.reward = null;
    if (room.kind === ROOM_KIND.COMBAT) {
      room.reward = names[rng.weightedIndex(weights)];
      combat.push(room);
    } else if (room.kind === ROOM_KIND.ELITE || room.kind === ROOM_KIND.BOSS) {
      room.reward = REWARD.BOON;
    } else if (room.kind === ROOM_KIND.REWARD) {
      room.reward = rng.chance(0.5) ? REWARD.BOON : REWARD.WEAPON;
    } else if (room.kind === ROOM_KIND.BONUS) {
      room.reward = REWARD.WEAPON;
    }
  }
  // 모자라는 보상은 다른 보상의 방을 바꿔 채운다(가까운 방부터 — 초반에 축복을 만나기 쉽게).
  const order = rng.shuffle(combat.slice()).sort((a, b) => a.depth - b.depth);
  const ensure = (reward, min, protect) => {
    let have = combat.filter((room) => room.reward === reward).length;
    for (const room of order) {
      if (have >= min) break;
      if (room.reward === reward || protect.includes(room.reward)) continue;
      room.reward = reward;
      have++;
    }
  };
  ensure(REWARD.BOON, cfg.minBoon, []);
  ensure(REWARD.WEAPON, cfg.minWeapon, [REWARD.BOON]);
  // 전투방이 모두 축복 방이라 바꿀 방이 없었다면, 축복 방이 남는 만큼만 무기 방으로 바꾼다.
  for (const room of order.slice().reverse()) {
    if (combat.filter((r) => r.reward === REWARD.WEAPON).length >= cfg.minWeapon) break;
    if (combat.filter((r) => r.reward === REWARD.BOON).length <= cfg.minBoon) break;
    if (room.reward === REWARD.BOON) room.reward = REWARD.WEAPON;
  }
}

/**
 * 층을 한 번 만들어 본다.
 * @param {Rng} rng 이 시도의 난수
 * @param {object} plan floorPlan 의 결과
 * @param {{ plain?: boolean }} [options] plain 이면 난수를 거의 쓰지 않는 격자 모양(비상용)
 * @returns {object} 맵 또는 { rejected: 사유 }
 */
export function buildStage(rng, plan, { plain = false } = {}) {
  const W = WORLD.layout.w;
  const bandH = WORLD.boss.bandH;
  const H = bandH + WORLD.layout.h;
  const layout = createLayout(W, H);
  const region = { x: 1, y: bandH, w: W - 2, h: WORLD.layout.h - 1 };
  const band = { x: 1, y: 1, w: W - 2, h: bandH - 1 };

  // 1) 방 구역
  const made = plain ? generateGridRooms(layout, region, WORLD.layout) : generateRooms(rng.fork('layout'), layout, region, WORLD.layout);
  if (!made.ok) return reject(made.reason);
  const bspRooms = layout.rooms.slice();

  // 2) 보스 구역: 결투장 + 출구 방. 결투장에서 곧게 내려와 닿는 방과 잇는다.
  const bossRng = rng.fork('boss');
  const wing = buildBossWing(bossRng, layout, band, WORLD.boss, { plain });
  const down = scanLinks(layout, wing.arena, 'S', WORLD.layout.corridorWidth, WORLD.layout.maxGap);
  if (down.length === 0) return reject('boss-not-linked');
  // 결투장 가운데에 가까운 자리를 쓴다.
  const mid = wing.arena.x + Math.floor(wing.arena.w / 2) - 1;
  down.sort((a, b) => Math.abs(a.x - mid) - Math.abs(b.x - mid) || a.x - b.x);
  carveLink(layout, down[0]);

  // 3) 숨은 방
  const bonus = plain ? null : addBonusRoom(rng.fork('bonus'), layout, band, wing);

  // 4) 방의 종류와 깊이
  const failure = assignRoles(rng.fork('roles'), layout, bspRooms, wing, bonus);
  if (failure) return reject(failure);

  // 5) 전투방의 엄폐물
  const coverRng = rng.fork('cover');
  wing.arena.cover = wing.pattern;
  for (const room of bspRooms) {
    room.cover = 'none';
    if (room.kind !== ROOM_KIND.COMBAT && room.kind !== ROOM_KIND.ELITE) continue;
    room.cover = plain ? 'corners' : WORLD.cover.patterns[coverRng.weightedIndex(WORLD.cover.weights)];
    addCover(layout, room, room.cover);
  }
  wing.exit.cover = 'none';
  if (bonus) bonus.cover = 'none';

  // 6) 구조를 타일에서 다시 읽어 문과 복도를 정한다.
  const { tiles, w } = layout;
  const structure = readStructure(tiles, w, H, layout.rooms);
  if (structure.errors.length > 0) return reject(structure.errors[0]);
  const doors = [];
  const links = [];
  const roomDoors = layout.rooms.map(() => []);
  for (const link of structure.links) {
    const secret = bonus !== null && link.rooms.includes(bonus.id);
    const ids = [];
    for (const d of link.doors) {
      const id = doors.length;
      const center = doorCenter(d.cells, w);
      const other = link.rooms[0] === d.room ? link.rooms[1] : link.rooms[0];
      // 숨은 방으로 가는 굴은 방 쪽 입구가 벽처럼 막혀 있다.
      const hidden = secret && d.room !== bonus.id;
      if (hidden) for (const c of d.cells) tiles[c] = TILE.DOOR;
      doors.push({ id, room: d.room, to: other, link: links.length, cells: d.cells, x: center.x, y: center.y, open: !hidden, secret: hidden });
      roomDoors[d.room].push(id);
      ids.push(id);
    }
    links.push({ id: links.length, rooms: link.rooms.slice(), doors: ids, secret, seen: false });
  }

  // 7) 웨이브, 적이 나타나는 자리, 보상
  const waveRng = rng.fork('waves');
  assignRewards(rng.fork('rewards'), layout.rooms);
  const rooms = [];
  for (const room of layout.rooms) {
    const feature = featureCell(layout, room, structure.regionAt);
    if (!feature) return reject('no-feature-cell');
    const fight = isFightRoom(room.kind);
    const doorCells = roomDoors[room.id].flatMap((id) => doors[id].cells);
    rooms.push({
      id: room.id, kind: room.kind, x: room.x, y: room.y, w: room.w, h: room.h, shape: room.shape,
      depth: room.depth, reward: room.reward, cover: room.cover, feature, doors: roomDoors[room.id],
      waves: fight ? wavesOf(waveRng, plan.zone, room) : [],
      spawnCells: fight ? spawnCellsOf(layout, room, structure.regionAt, doorCells) : [],
      // 실행 중에 바뀌는 값: 'idle'(아직) | 'active'(전투 중) | 'cleared'(끝남), 지금 웨이브 번호, 화면에 드러났는가.
      state: 'idle', wave: 0, seen: false,
    });
  }
  const startRoom = rooms.find((room) => room.kind === ROOM_KIND.START);

  return {
    floor: plan.floor,
    zoneId: plan.zone.id,
    kind: FLOOR_KIND.STAGE,
    algorithm: plain ? 'fallback' : 'rooms',
    width: W,
    height: H,
    tiles: Array.from(tiles),
    start: { x: startRoom.feature.x, y: startRoom.feature.y },
    rooms,
    doors,
    links,
    // 생성 과정 기록: 시도 횟수, 비상 레이아웃 여부.
    gen: { attempts: 0, fallback: false },
  };
}

/**
 * world 스트림에서 층 하나를 만든다. worldRng 는 소비하지 않는다.
 * @param {Rng} worldRng 런 시드의 'world' 서브스트림(rngOf(state, 'world'))
 * @param {number} floor
 * @param {object} [hooks] 테스트·검증용
 * @param {Function} [hooks.build] (rng, plan) => 맵 또는 { rejected } — 시도 한 번을 대신한다
 * @param {Function} [hooks.onReject] (attempt, reasons: string[]) => void — 시도가 버려질 때마다 호출
 */
export function generateFloorFromRng(worldRng, floor, hooks = {}) {
  const plan = floorPlan(floor);
  const floorRng = worldRng.fork(`floor:${floor}`);
  const build = hooks.build ?? buildStage;

  for (let attempt = 1; attempt <= WORLD.maxAttempts; attempt++) {
    const map = build(floorRng.fork(`attempt:${attempt}`), plan);
    const reasons = map.rejected ? [map.rejected] : validateFloor(map);
    if (reasons.length === 0) {
      map.gen.attempts = attempt;
      return map;
    }
    if (hooks.onReject) hooks.onReject(attempt, reasons);
  }

  // 재시도 상한을 넘겼다. 반드시 통과하는 단순한 레이아웃으로 대체한다.
  const map = buildStage(floorRng.fork('fallback'), plan, { plain: true });
  const errors = map.rejected ? [map.rejected] : validateFloor(map);
  if (errors.length > 0) {
    throw new Error(`generateFloor: ${floor}층 비상 레이아웃이 검증에 실패했습니다: ${errors.join('; ')}`);
  }
  map.gen.attempts = WORLD.maxAttempts;
  map.gen.fallback = true;
  return map;
}

/**
 * (런 시드, 층 번호)로 층을 만든다.
 * @param {{ seed: string|number, floor: number }} options
 */
export function generateFloor({ seed, floor }) {
  return generateFloorFromRng(Rng.fromSeed(seed).fork('world'), floor);
}
