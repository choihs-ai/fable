// 타일 종류. 바닥(FLOOR)이 아닌 칸은 모두 막힌 칸이다.
// 맵의 tiles 는 행 우선(row-major) 배열이고 칸 (x, y) 의 인덱스는 y * width + x 다.

export const TILE = Object.freeze({
  WALL: 0,
  FLOOR: 1,
  /** 닫힌 문. 몸·투사체·시야를 벽처럼 막는다. 열리면 FLOOR 로 바뀐다(world/doors.js). */
  DOOR: 2,
});
