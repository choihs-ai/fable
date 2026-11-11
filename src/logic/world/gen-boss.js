// 결투장 무늬와 보스 구역. 결투장(기둥·깎인 모서리)은 보스 방에도, 작은 크기로 전투방의 엄폐물에도 쓴다.
//
// 보스 구역은 아래에서 위로: (방 구역에서 올라오는 복도) → 결투장 → 짧은 복도 → 출구 방.
// 좌우 대칭이고, 시드에 따라 결투장 크기·모서리·기둥 배치가 달라진다.

import { addRoom, carveLink } from './gen-rooms.js';
import { TILE } from './tiles.js';

function oddBetween(rng, [min, max]) {
  return min + 2 * rng.int(0, Math.floor((max - min) / 2));
}

/**
 * 방 안에 기둥·엄폐물(벽 칸)을 세운다. 모든 무늬는 좌우·상하 대칭이고, 벽에서 2칸 안쪽으로만 놓는다
 * (벽 둘레 2칸은 항상 비어 있어 문이 어디에 있든 막히지 않고, 방이 둘로 갈라지지 않는다).
 * @param {object} layout createLayout 의 결과
 * @param {object} room 가로·세로가 홀수인 직사각형 방
 * @param {string} pattern 'none' | 'corners' | 'ring' | 'columns' | 'quad' | 'center' | 'bars'
 * @returns {number} 세운 칸 수
 */
export function addCover(layout, room, pattern) {
  const { tiles, roomAt, w } = layout;
  const cx = room.x + Math.floor(room.w / 2);
  const cy = room.y + Math.floor(room.h / 2);
  const halfW = Math.floor(room.w / 2);
  const halfH = Math.floor(room.h / 2);
  // 벽에서 2칸 안쪽까지만 쓸 수 있다.
  const maxX = halfW - 2;
  const maxY = halfH - 2;
  let count = 0;
  const put = (dx, dy) => {
    if (Math.abs(dx) > maxX || Math.abs(dy) > maxY) return;
    const cell = (cy + dy) * w + cx + dx;
    if (roomAt[cell] !== room.id || tiles[cell] !== TILE.FLOOR) return;
    tiles[cell] = TILE.WALL;
    count++;
  };
  const mirror = (dx, dy) => {
    put(dx, dy);
    put(-dx, dy);
    put(dx, -dy);
    put(-dx, -dy);
  };
  if (pattern === 'corners') {
    // 네 귀퉁이 쪽의 기둥. 방이 크면 2×2.
    mirror(maxX, maxY);
    if (maxX >= 5 && maxY >= 4) {
      mirror(maxX - 1, maxY);
      mirror(maxX, maxY - 1);
      mirror(maxX - 1, maxY - 1);
    }
  } else if (pattern === 'ring') {
    mirror(Math.min(4, maxX), Math.min(2, maxY));
    mirror(Math.min(2, maxX), Math.min(4, maxY));
  } else if (pattern === 'columns') {
    for (let dy = maxY; dy >= 1; dy -= 2) mirror(maxX, dy);
  } else if (pattern === 'quad') {
    // 사분면마다 낮은 담 하나.
    const qx = Math.max(2, Math.floor(maxX / 2) + 1);
    const qy = Math.max(1, Math.floor(maxY / 2) + (maxY >= 3 ? 1 : 0));
    mirror(qx, qy);
    mirror(qx - 1, qy);
    if (maxY >= 4) mirror(qx, qy - 1);
  } else if (pattern === 'center') {
    // 가운데 덩어리. 방이 크면 십자 모양.
    put(0, 0);
    mirror(1, 0);
    if (maxY >= 3) mirror(0, 1);
  } else if (pattern === 'bars') {
    // 위아래로 가로 담 두 줄(가운데는 터 둔다).
    const by = Math.max(1, maxY - 1);
    for (let dx = 2; dx <= Math.min(maxX, 4); dx++) mirror(dx, by);
  } else if (pattern !== 'none') {
    throw new RangeError(`addCover: 알 수 없는 무늬 "${pattern}"`);
  }
  return count;
}

/**
 * 보스 구역을 만든다: 결투장과 그 위의 출구 방, 둘을 잇는 복도.
 * @param {import('../core/prng.js').Rng} rng
 * @param {object} layout createLayout 의 결과(제자리에서 고친다)
 * @param {{ x:number, y:number, w:number, h:number }} band 보스 구역
 * @param {object} cfg WORLD.boss
 * @param {{ plain?: boolean }} [options] plain 이면 난수 없이 가장 단순한 형태(비상용)
 * @returns {{ arena:object, exit:object, side:'left'|'right', pattern:string }}
 */
export function buildBossWing(rng, layout, band, cfg, { plain = false } = {}) {
  const arenaW = plain ? cfg.arenaW[0] : oddBetween(rng, cfg.arenaW);
  const arenaH = plain ? cfg.arenaH[0] : oddBetween(rng, cfg.arenaH);
  const chamfer = plain ? cfg.chamfer[0] : rng.int(cfg.chamfer[0], cfg.chamfer[1]);
  const pattern = plain ? 'none' : rng.pick(cfg.pillars);
  // 결투장은 구역의 왼쪽 절반이나 오른쪽 절반에 둔다(남는 절반은 숨은 방 자리).
  const side = plain ? 'left' : rng.pick(['left', 'right']);
  const half = Math.floor(band.w / 2);
  const slack = Math.max(0, half - cfg.margin - arenaW - 1);
  const offset = plain ? 0 : rng.int(0, slack);
  const ax = side === 'left' ? band.x + cfg.margin + offset : band.x + band.w - cfg.margin - arenaW - offset;
  // 아래쪽(방 구역 쪽)에 붙인다. 구역의 맨 아랫줄은 벽으로 남긴다.
  const ay = band.y + band.h - 1 - arenaH;

  const arena = addRoom(layout, ax, ay, arenaW, arenaH, chamfer);
  addCover(layout, arena, pattern);

  const cx = ax + Math.floor(arenaW / 2);
  const ex = cx - Math.floor(cfg.exit.w / 2);
  const ey = ay - cfg.exitGap - cfg.exit.h;
  const exit = addRoom(layout, ex, ey, cfg.exit.w, cfg.exit.h, 0);
  carveLink(layout, {
    a: arena.id, b: exit.id, dir: 'N', x: cx - Math.floor(cfg.exitWidth / 2), y: ay - 1, gap: cfg.exitGap, width: cfg.exitWidth,
  });
  return { arena, exit, side, pattern };
}
