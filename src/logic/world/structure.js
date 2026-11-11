// 방 구조 읽기: 타일과 방 목록만 보고 칸마다 어느 방·복도에 속하는지, 복도가 어느 방들을 잇는지, 문이 어디인지를 알아낸다.
// 생성기가 기록한 것을 믿지 않고 타일에서 다시 찾으므로 생성기·검증기·실행 중 로직이 같은 답을 쓴다.
//
// - 방의 칸: 방의 사각형 안에 있는 막히지 않은 칸.
// - 복도: 어느 방에도 속하지 않는 막히지 않은 칸의 덩어리(상하좌우로 이어진 것). 닫힌 문도 복도의 칸이다.
// - 문: 복도의 칸 가운데 방의 칸과 맞닿은 것. 한 복도가 한 방과 맞닿는 문 칸들은 한 줄로 붙어 있어야 한다.
// - 구역(region) 번호: 방은 방 번호, 복도는 (방의 수 + 복도 번호).

import { TILE } from './tiles.js';

/**
 * @param {ArrayLike<number>} tiles
 * @param {number} w
 * @param {number} h
 * @param {{ x:number, y:number, w:number, h:number }[]} rooms
 * @returns {{
 *   regionAt: Int16Array,
 *   links: { rooms:number[], cells:number[], doors:{ room:number, cells:number[] }[] }[],
 *   errors: string[]
 * }} regionAt 은 칸별 구역 번호(막힌 칸은 -1). errors 는 구조가 규칙에 맞지 않는 점.
 */
export function readStructure(tiles, w, h, rooms) {
  const size = w * h;
  const regionAt = new Int16Array(size).fill(-1);
  const errors = [];
  const open = (i) => tiles[i] !== TILE.WALL;

  for (let r = 0; r < rooms.length; r++) {
    const room = rooms[r];
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        const i = y * w + x;
        if (tiles[i] !== TILE.FLOOR) continue;
        if (regionAt[i] !== -1) errors.push(`rooms-overlap: ${regionAt[i]}/${r}`);
        regionAt[i] = r;
      }
    }
  }

  const links = [];
  const queue = new Int32Array(size);
  const NEIGHBORS = [-w, w, -1, 1];
  for (let s = 0; s < size; s++) {
    if (!open(s) || regionAt[s] !== -1) continue;
    const region = rooms.length + links.length;
    const cells = [];
    /** 방 번호 → 그 방과 맞닿은 문 칸들. */
    const doorCells = new Map();
    let head = 0;
    let tail = 0;
    regionAt[s] = region;
    queue[tail++] = s;
    while (head < tail) {
      const i = queue[head++];
      cells.push(i);
      const x = i % w;
      for (const step of NEIGHBORS) {
        if ((step === -1 && x === 0) || (step === 1 && x === w - 1)) continue;
        const n = i + step;
        if (n < 0 || n >= size || !open(n)) continue;
        const other = regionAt[n];
        if (other === -1) {
          regionAt[n] = region;
          queue[tail++] = n;
        } else if (other < rooms.length) {
          if (!doorCells.has(other)) doorCells.set(other, []);
          const list = doorCells.get(other);
          if (!list.includes(i)) list.push(i);
        }
      }
    }
    cells.sort((a, b) => a - b);
    const doors = [...doorCells.entries()].sort((a, b) => a[0] - b[0]).map(([room, list]) => ({ room, cells: list.sort((a, b) => a - b) }));
    for (const door of doors) {
      // 문 칸들은 가로 또는 세로 한 줄로 붙어 있어야 한다.
      const first = door.cells[0];
      const stride = door.cells.length > 1 ? door.cells[1] - first : 1;
      const straight = (stride === 1 || stride === w) && door.cells.every((c, k) => c === first + stride * k);
      if (!straight || door.cells.length > 3) errors.push(`door-shape: 방 ${door.room} 복도 ${links.length}`);
    }
    if (doors.length !== 2) errors.push(`link-rooms: 복도 ${links.length} 가 방 ${doors.length}개와 닿음`);
    links.push({ rooms: doors.map((d) => d.room), cells, doors });
  }
  return { regionAt, links, errors };
}

/** 문 칸 목록의 한가운데(칸 좌표, 실수). */
export function doorCenter(cells, w) {
  let sx = 0;
  let sy = 0;
  for (const c of cells) {
    sx += (c % w) + 0.5;
    sy += Math.floor(c / w) + 0.5;
  }
  return { x: sx / cells.length, y: sy / cells.length };
}
