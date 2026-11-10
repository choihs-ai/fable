// 맵을 글자로 그린다(테스트 실패 메시지·검증 도구용).
//   # 벽  . 바닥  @ 시작점  > 계단  S 상점  A 제단  e 적  B 보스  i 아이템

import { TILE } from './tiles.js';

const SPAWN_CHAR = { enemy: 'e', boss: 'B', item: 'i' };
const EVENT_CHAR = { shop: 'S', altar: 'A' };

export function toAscii(map) {
  const { width, height, tiles } = map;
  const cells = new Array(width * height);
  for (let i = 0; i < cells.length; i++) cells[i] = tiles[i] === TILE.FLOOR ? '.' : '#';
  const put = (pos, ch) => {
    if (pos && pos.x >= 0 && pos.y >= 0 && pos.x < width && pos.y < height) cells[pos.y * width + pos.x] = ch;
  };
  for (const spawn of map.spawns ?? []) put(spawn, SPAWN_CHAR[spawn.kind] ?? '?');
  for (const room of map.eventRooms ?? []) put(room.feature, EVENT_CHAR[room.kind] ?? '?');
  put(map.stairs, '>');
  put(map.start, '@');
  const rows = [];
  for (let y = 0; y < height; y++) rows.push(cells.slice(y * width, (y + 1) * width).join(''));
  return rows.join('\n');
}
