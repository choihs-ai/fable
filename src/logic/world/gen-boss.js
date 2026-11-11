// 보스층 전용 레이아웃. 아래에서 위로: 입구 방 → 회랑 → 결투장 → (중간보스) 계단 방 / (최종보스) 옥좌.
// 좌우 대칭이고, 시드에 따라 결투장 크기·회랑 길이·기둥 배치가 달라진다.

import { fillRect } from './grid.js';
import { TILE } from './tiles.js';

function oddBetween(rng, [min, max]) {
  return min + 2 * rng.int(0, Math.floor((max - min) / 2));
}

/** 결투장 안에 기둥(벽)을 세운다. 가운데 세로줄·가로줄은 항상 비워 둔다. */
function addPillars(tiles, w, pattern, cx, cy, halfW, halfH) {
  const put = (dx, dy) => {
    tiles[(cy + dy) * w + (cx + dx)] = TILE.WALL;
  };
  const mirror = (dx, dy) => {
    put(dx, dy);
    put(-dx, dy);
    put(dx, -dy);
    put(-dx, -dy);
  };
  if (pattern === 'corners') {
    const dx = halfW - 3;
    const dy = halfH - 3;
    mirror(dx, dy);
    mirror(dx - 1, dy);
    mirror(dx, dy - 1);
    mirror(dx - 1, dy - 1);
  } else if (pattern === 'ring') {
    mirror(4, 2);
    mirror(2, 4);
  } else if (pattern === 'columns') {
    const dx = halfW - 2;
    for (let dy = 2; dy <= halfH - 2; dy += 2) mirror(dx, dy);
  }
}

/**
 * @param {import('../core/prng.js').Rng} rng
 * @param {object} cfg WORLD.boss.mid 또는 WORLD.boss.final
 * @param {{ plain?: boolean }} [options] plain 이면 난수 없이 가장 단순한 형태(비상용)
 * @returns {{ width:number, height:number, tiles:Uint8Array, rooms:object[],
 *   start:{x:number,y:number}, stairs:{x:number,y:number}|null, boss:{x:number,y:number}, reward:{x:number,y:number}|null }}
 */
export function buildBossLayout(rng, cfg, { plain = false } = {}) {
  const arenaW = plain ? cfg.arenaW[0] : oddBetween(rng, cfg.arenaW);
  const arenaH = plain ? cfg.arenaH[0] : oddBetween(rng, cfg.arenaH);
  const hallLength = plain ? cfg.hallLength[0] : rng.int(cfg.hallLength[0], cfg.hallLength[1]);
  const chamfer = plain ? cfg.chamfer[0] : rng.int(cfg.chamfer[0], cfg.chamfer[1]);
  const pattern = plain ? 'none' : rng.pick(cfg.pillars);

  const topSpace = cfg.exit ? cfg.exit.h + cfg.exit.hallLength : cfg.throne ? cfg.throne.h : 0;
  const width = arenaW + cfg.margin * 2;
  const height = 1 + topSpace + arenaH + hallLength + cfg.entry.h + 1;
  const tiles = new Uint8Array(width * height);
  const cx = Math.floor(width / 2);
  const rooms = [];

  // 결투장
  const ax = cfg.margin;
  const ay = 1 + topSpace;
  for (let j = 0; j < arenaH; j++) {
    for (let i = 0; i < arenaW; i++) {
      if (Math.min(i, arenaW - 1 - i) + Math.min(j, arenaH - 1 - j) < chamfer) continue;
      tiles[(ay + j) * width + ax + i] = TILE.FLOOR;
    }
  }
  const halfW = Math.floor(arenaW / 2);
  const halfH = Math.floor(arenaH / 2);
  const acy = ay + halfH;
  addPillars(tiles, width, pattern, cx, acy, halfW, halfH);
  rooms.push({ x: ax, y: ay, w: arenaW, h: arenaH });

  // 진입 회랑과 입구 방
  const hallX = cx - Math.floor(cfg.hallWidth / 2);
  const hallY = ay + arenaH;
  fillRect(tiles, width, hallX, hallY, cfg.hallWidth, hallLength, TILE.FLOOR);
  if (cfg.alcoves) {
    for (let y = hallY + 1; y + 1 < hallY + hallLength; y += 4) {
      fillRect(tiles, width, hallX - 2, y, 2, 2, TILE.FLOOR);
      fillRect(tiles, width, hallX + cfg.hallWidth, y, 2, 2, TILE.FLOOR);
    }
  }
  const entryX = cx - Math.floor(cfg.entry.w / 2);
  const entryY = hallY + hallLength;
  fillRect(tiles, width, entryX, entryY, cfg.entry.w, cfg.entry.h, TILE.FLOOR);
  rooms.push({ x: entryX, y: entryY, w: cfg.entry.w, h: cfg.entry.h });
  const start = { x: cx, y: entryY + Math.floor(cfg.entry.h / 2) };

  // 결투장 위쪽: 계단 방(중간보스) 또는 옥좌(최종보스)
  let stairs = null;
  let reward = null;
  let boss = { x: cx, y: acy };
  if (cfg.exit) {
    const exitX = cx - Math.floor(cfg.exit.w / 2);
    fillRect(tiles, width, exitX, 1, cfg.exit.w, cfg.exit.h, TILE.FLOOR);
    fillRect(tiles, width, cx, 1 + cfg.exit.h, 1, cfg.exit.hallLength, TILE.FLOOR);
    rooms.push({ x: exitX, y: 1, w: cfg.exit.w, h: cfg.exit.h });
    stairs = { x: cx, y: 1 + Math.floor(cfg.exit.h / 2) };
    reward = { x: cx + 1, y: stairs.y };
  }
  if (cfg.throne) {
    const throneX = cx - Math.floor(cfg.throne.w / 2);
    fillRect(tiles, width, throneX, 1, cfg.throne.w, cfg.throne.h, TILE.FLOOR);
    rooms.push({ x: throneX, y: 1, w: cfg.throne.w, h: cfg.throne.h });
    boss = { x: cx, y: ay + Math.floor(arenaH / 3) };
  }

  return { width, height, tiles, rooms, start, stairs, boss, reward };
}
