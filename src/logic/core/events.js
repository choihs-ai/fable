// 이벤트 이름 모음. 문자열을 직접 쓰지 말고 여기 상수를 쓴다.
// 이름 규칙: '<영역>:<과거형 동사>' — 이미 일어난 일을 알린다.

export const EVENTS = Object.freeze({
  /** payload: { from: string, to: string } */
  PHASE_CHANGED: 'phase:changed',
  /** payload: { floor: number, zoneId: string, kind: string } — state.world 가 새 층으로 바뀐 직후 */
  FLOOR_ENTERED: 'floor:entered',
});
