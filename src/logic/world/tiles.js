// 타일 종류. 맵의 tiles 는 행 우선(row-major) 배열이고 칸 (x, y) 의 인덱스는 y * width + x 다.

export const TILE = Object.freeze({
  WALL: 0,
  FLOOR: 1,
});
