// 이벤트 이름 모음. 문자열을 직접 쓰지 말고 여기 상수를 쓴다.
// 이름 규칙: '<영역>:<과거형 동사>' — 이미 일어난 일을 알린다.

export const EVENTS = Object.freeze({
  /** payload: { from: string, to: string } */
  PHASE_CHANGED: 'phase:changed',
  /** payload: { floor: number, zoneId: string, kind: string } — state.world 가 새 층으로 바뀐 직후 */
  FLOOR_ENTERED: 'floor:entered',

  // ── 행동체 ──
  /** payload: { id, kind, type, x, y, summonerId? } */
  ENTITY_SPAWNED: 'entity:spawned',
  /** payload: { id, kind, type, x, y, killerId } */
  ENTITY_DIED: 'entity:died',
  /** payload: { id, fromX, fromY, x, y } */
  ENTITY_TELEPORTED: 'entity:teleported',
  /** payload: { id, mode: 'idle'|'combat'|'return' } — 적의 어그로 상태가 바뀜 */
  AGGRO_CHANGED: 'aggro:changed',
  /** payload: { id, dirX, dirY } */
  PLAYER_DODGED: 'player:dodged',

  // ── 전투 ──
  /** payload: { targetId, sourceId, amount, kind: 'hit'|'dot', hp, blocked } */
  DAMAGE_DEALT: 'damage:dealt',
  /** payload: { targetId, status, stacks, ticks } */
  STATUS_APPLIED: 'status:applied',
  /** payload: { targetId, status, reason: 'expired'|'removed'|'cleansed' } */
  STATUS_ENDED: 'status:ended',
  /** payload: { actorId, ability, ticks, x, y, dirX, dirY, targetX, targetY } — 예고(텔레그래프) 시작 */
  ABILITY_WINDUP: 'ability:windup',
  /** payload: { actorId, ability } */
  ABILITY_USED: 'ability:used',
  /** payload: { actorId, ability } — 기절·빙결·페이즈 전환으로 준비 동작이 끊김 */
  ABILITY_INTERRUPTED: 'ability:interrupted',
  /** payload: { id, ownerId, x, y, vx, vy, radius } */
  PROJECTILE_FIRED: 'projectile:fired',
  /** payload: { id, ownerId, x, y, radius, armTicks, lastsTicks } — 장판 예고 */
  HAZARD_SPAWNED: 'hazard:spawned',
  /** payload: { id, x, y, radius } */
  HAZARD_TRIGGERED: 'hazard:triggered',
  /** payload: { id, type, from, to, phases, ticks } — 보스 페이즈 전환(연출용). ticks 동안 보스는 무적 */
  BOSS_PHASE_CHANGED: 'boss:phaseChanged',
});
