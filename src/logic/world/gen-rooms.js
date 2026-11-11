// 방 배치: 공간을 이진 분할(BSP)해 조각마다 방을 하나씩 두고, 마주 보는 방끼리 곧은 복도로 잇는다.
//
// 복도는 두 방의 벽 사이를 직선으로 지난다. 폭은 일정하고, 방의 모서리나 다른 복도·방에 닿지 않는 자리에만 판다.
// 그래서 복도의 양 끝 칸이 곧 "문"이 된다(world/structure.js 가 타일에서 다시 찾아낸다).

import { fillRect } from './grid.js';
import { TILE } from './tiles.js';

/** roomAt 의 값: 방 번호(0 이상), 아무것도 아님(-1), 복도(-2). */
const NONE = -1;
const CORRIDOR = -2;

/**
 * 배치 작업 공간. 생성 단계들이 함께 쓴다.
 * @returns {{ tiles:Uint8Array, w:number, h:number, roomAt:Int16Array, rooms:object[], links:object[] }}
 */
export function createLayout(w, h) {
  return { tiles: new Uint8Array(w * h), w, h, roomAt: new Int16Array(w * h).fill(NONE), rooms: [], links: [] };
}

/**
 * 직사각형 방을 판다. 모서리를 chamfer 칸만큼 깎는다(깎인 칸은 벽으로 남는다).
 * @returns {object} 방({ id, x, y, w, h, shape, chamfer })
 */
export function addRoom(layout, x, y, rw, rh, chamfer = 0) {
  const id = layout.rooms.length;
  for (let j = 0; j < rh; j++) {
    for (let i = 0; i < rw; i++) {
      if (Math.min(i, rw - 1 - i) + Math.min(j, rh - 1 - j) < chamfer) continue;
      const cell = (y + j) * layout.w + x + i;
      layout.tiles[cell] = TILE.FLOOR;
      layout.roomAt[cell] = id;
    }
  }
  const room = { id, x, y, w: rw, h: rh, shape: 'rect', chamfer };
  layout.rooms.push(room);
  return room;
}

const odd = (n) => (n % 2 === 0 ? n - 1 : n);

/** 방향(E·S·W·N)의 진행 벡터와, 그에 수직인 축의 벡터. */
const DIRS = {
  E: { dx: 1, dy: 0, px: 0, py: 1 },
  W: { dx: -1, dy: 0, px: 0, py: 1 },
  S: { dx: 0, dy: 1, px: 1, py: 0 },
  N: { dx: 0, dy: -1, px: 1, py: 0 },
};

/**
 * 방 a 의 한쪽 벽에서 곧게 나아가 다른 방에 닿는 복도 자리를 모두 찾는다.
 * 조건: 복도 칸과 그 양옆 칸이 모두 벽이고, 양 끝이 방의 바닥에 닿으며, 끝의 양옆도 그 방의 바닥이다(모서리·깎인 자리에 문이 나지 않는다).
 * @returns {{ a:number, b:number, dir:string, x:number, y:number, gap:number, width:number }[]} (x, y) 는 복도의 첫 칸(폭 방향으로 가장 작은 쪽)
 */
export function scanLinks(layout, room, dir, width, maxGap) {
  const { tiles, roomAt, w, h } = layout;
  const d = DIRS[dir];
  const out = [];
  // 벽 바로 바깥 칸의 줄과, 폭 방향으로 훑을 범위.
  const baseX = dir === 'E' ? room.x + room.w : dir === 'W' ? room.x - 1 : room.x;
  const baseY = dir === 'S' ? room.y + room.h : dir === 'N' ? room.y - 1 : room.y;
  const span = d.px === 1 ? room.w : room.h;
  const inside = (x, y) => x >= 1 && y >= 1 && x < w - 1 && y < h - 1;
  const at = (x, y) => (inside(x, y) ? roomAt[y * w + x] : CORRIDOR);
  const isWall = (x, y) => inside(x, y) && tiles[y * w + x] === TILE.WALL;

  for (let t = 1; t + width <= span - 1; t++) {
    const sx = baseX + d.px * t;
    const sy = baseY + d.py * t;
    // 출발하는 쪽: 복도 폭과 그 양옆이 모두 이 방의 바닥이어야 한다.
    let ok = true;
    for (let k = -1; k <= width && ok; k++) ok = at(sx - d.dx + d.px * k, sy - d.dy + d.py * k) === room.id;
    if (!ok) continue;
    for (let s = 0; s <= maxGap; s++) {
      const cx = sx + d.dx * s;
      const cy = sy + d.dy * s;
      let walls = 0;
      for (let k = 0; k < width; k++) if (isWall(cx + d.px * k, cy + d.py * k)) walls++;
      if (walls === width) {
        // 양옆이 벽이 아니면 다른 길과 붙어 버린다.
        if (!isWall(cx - d.px, cy - d.py) || !isWall(cx + d.px * width, cy + d.py * width)) break;
        continue;
      }
      if (walls > 0 || s < 2) break;
      const b = at(cx, cy);
      if (b < 0 || b === room.id) break;
      let lands = true;
      for (let k = -1; k <= width && lands; k++) lands = at(cx + d.px * k, cy + d.py * k) === b;
      if (lands) out.push({ a: room.id, b, dir, x: sx, y: sy, gap: s, width });
      break;
    }
  }
  return out;
}

/** 찾아 둔 자리에 복도를 판다. */
export function carveLink(layout, link) {
  const d = DIRS[link.dir];
  const cells = [];
  for (let s = 0; s < link.gap; s++) {
    for (let k = 0; k < link.width; k++) {
      const cell = (link.y + d.dy * s + d.py * k) * layout.w + link.x + d.dx * s + d.px * k;
      layout.tiles[cell] = TILE.FLOOR;
      layout.roomAt[cell] = CORRIDOR;
      cells.push(cell);
    }
  }
  const made = { rooms: [link.a, link.b], width: link.width, length: link.gap, cells };
  layout.links.push(made);
  return made;
}

export function isLinked(layout, a, b) {
  return layout.links.some((l) => (l.rooms[0] === a && l.rooms[1] === b) || (l.rooms[0] === b && l.rooms[1] === a));
}

/** 후보 가운데 가장 짧은 축에서 하나를 고른다(복도는 짧을수록 좋다). */
function pickShort(rng, candidates) {
  let min = Infinity;
  for (const c of candidates) if (c.gap < min) min = c.gap;
  return rng.pick(candidates.filter((c) => c.gap <= min + 1));
}

/**
 * 방 구역을 만든다: (ox, oy) 에서 시작하는 rw×rh 영역을 나눠 방을 놓고 복도로 잇는다.
 * @param {import('../core/prng.js').Rng} rng
 * @param {object} layout createLayout 의 결과(제자리에서 고친다)
 * @param {{ x:number, y:number, w:number, h:number }} region
 * @param {object} cfg WORLD.layout
 * @returns {{ ok:true } | { ok:false, reason:string }}
 */
export function generateRooms(rng, layout, region, cfg) {
  const width = cfg.corridorWidth;
  let failed = null;

  // 조각을 나누고, 잎마다 방을 만든 뒤, 돌아오면서 양쪽 자식을 복도 하나로 잇는다.
  const build = (x, y, lw, lh) => {
    const canSplitX = lw >= cfg.minLeafW * 2;
    const canSplitY = lh >= cfg.minLeafH * 2;
    const mustSplit = lw > cfg.maxLeaf || lh > cfg.maxLeaf;
    const stop = !mustSplit && rng.chance(cfg.stopChance);
    if ((!canSplitX && !canSplitY) || stop) {
      const maxW = lw - 2;
      const maxH = lh - 2;
      const rw = odd(rng.int(Math.max(cfg.roomMinW, Math.floor(maxW * cfg.roomFillMin)), maxW));
      const rh = odd(rng.int(Math.max(cfg.roomMinH, Math.floor(maxH * cfg.roomFillMin)), maxH));
      const chamfer = rng.int(cfg.chamfer[0], cfg.chamfer[1]);
      const room = addRoom(layout, x + 1 + rng.int(0, maxW - rw), y + 1 + rng.int(0, maxH - rh), rw, rh, chamfer);
      return [room];
    }

    let splitX;
    if (canSplitX && canSplitY) {
      if (lw >= lh * 1.25) splitX = true;
      else if (lh >= lw * 1.25) splitX = false;
      else splitX = rng.chance(0.5);
    } else {
      splitX = canSplitX;
    }

    let first;
    let second;
    if (splitX) {
      const cut = rng.int(cfg.minLeafW, lw - cfg.minLeafW);
      first = build(x, y, cut, lh);
      second = build(x + cut, y, lw - cut, lh);
    } else {
      const cut = rng.int(cfg.minLeafH, lh - cfg.minLeafH);
      first = build(x, y, lw, cut);
      second = build(x, y + cut, lw, lh - cut);
    }

    // 나눈 선을 사이에 두고 마주 보는 방 한 쌍을 잇는다.
    const others = new Set(second.map((r) => r.id));
    const candidates = [];
    for (const room of first) {
      for (const c of scanLinks(layout, room, splitX ? 'E' : 'S', width, cfg.maxGap)) {
        if (others.has(c.b)) candidates.push(c);
      }
    }
    if (candidates.length === 0) failed = failed ?? 'no-straight-link';
    else carveLink(layout, pickShort(rng, candidates));
    return first.concat(second);
  };

  const rooms = build(region.x, region.y, region.w, region.h);
  if (failed) return { ok: false, reason: failed };

  // 순환로: 아직 이어지지 않은 마주 보는 방 몇 쌍을 더 잇는다. 길이 여러 갈래가 되어 고를 수 있게 된다.
  const extra = rng.int(cfg.extraLinks[0], cfg.extraLinks[1]);
  for (let i = 0; i < extra; i++) {
    const candidates = [];
    for (const room of rooms) {
      for (const dir of ['E', 'S']) {
        for (const c of scanLinks(layout, room, dir, width, cfg.maxGap)) {
          if (!isLinked(layout, c.a, c.b)) candidates.push(c);
        }
      }
    }
    if (candidates.length === 0) break;
    carveLink(layout, pickShort(rng, candidates));
  }
  return { ok: true };
}

/**
 * 비상용 방 구역: 난수 없이 같은 크기의 방을 격자로 놓고, 이웃한 방을 모두 잇는다.
 * @returns {{ ok:true } | { ok:false, reason:string }}
 */
export function generateGridRooms(layout, region, cfg) {
  const cols = Math.max(1, Math.floor(region.w / (cfg.minLeafW + 1)));
  const rows = Math.max(1, Math.floor(region.h / (cfg.minLeafH + 4)));
  const cellW = Math.floor(region.w / cols);
  const cellH = Math.floor(region.h / rows);
  const rw = odd(cellW - 4);
  const rh = odd(cellH - 4);
  const grid = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      grid.push(addRoom(layout, region.x + i * cellW + 2, region.y + j * cellH + 2, rw, rh, 0));
    }
  }
  for (const room of grid) {
    for (const dir of ['E', 'S']) {
      const candidates = scanLinks(layout, room, dir, cfg.corridorWidth, cfg.maxGap);
      if (candidates.length === 0) continue;
      // 가운데 자리를 쓴다.
      carveLink(layout, candidates[Math.floor(candidates.length / 2)]);
    }
  }
  return grid.length >= 2 ? { ok: true } : { ok: false, reason: 'grid-too-small' };
}

export { fillRect };
