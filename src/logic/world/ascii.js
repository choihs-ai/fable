// 맵을 글자로 그린다(테스트 실패 메시지·검증 도구용).
//   # 벽  . 바닥  + 닫힌 문  : 열린 문  @ 시작점  x 적이 나타나는 자리
//   방 한가운데의 글자: c 전투  E 정예  R 보상  S 상점  B 보스  X 출구  ? 숨은 방

import { ROOM_KIND } from './floors.js';
import { TILE } from './tiles.js';

const ROOM_CHAR = {
  [ROOM_KIND.COMBAT]: 'c', [ROOM_KIND.ELITE]: 'E', [ROOM_KIND.REWARD]: 'R', [ROOM_KIND.SHOP]: 'S',
  [ROOM_KIND.BOSS]: 'B', [ROOM_KIND.EXIT]: 'X', [ROOM_KIND.BONUS]: '?',
};

export function toAscii(map, { spawns = false } = {}) {
  const { width, height, tiles } = map;
  const cells = new Array(width * height);
  for (let i = 0; i < cells.length; i++) cells[i] = tiles[i] === TILE.FLOOR ? '.' : tiles[i] === TILE.DOOR ? '+' : '#';
  const put = (pos, ch) => {
    if (pos && pos.x >= 0 && pos.y >= 0 && pos.x < width && pos.y < height) cells[pos.y * width + pos.x] = ch;
  };
  for (const door of map.doors ?? []) {
    for (const c of door.cells) if (tiles[c] === TILE.FLOOR) cells[c] = ':';
  }
  for (const room of map.rooms ?? []) {
    if (spawns) for (const c of room.spawnCells ?? []) cells[c] = 'x';
    if (ROOM_CHAR[room.kind]) put(room.feature, ROOM_CHAR[room.kind]);
  }
  put(map.start, '@');
  const rows = [];
  for (let y = 0; y < height; y++) rows.push(cells.slice(y * width, (y + 1) * width).join(''));
  return rows.join('\n');
}
