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
  /** payload: { targetId, sourceId, amount, kind: 'hit'|'dot', hp, blocked, crit } */
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

  // ── 아이템과 성장 ──
  /** payload: { id, x, y, kind } — 바닥에 전리품이 생김 */
  DROP_SPAWNED: 'drop:spawned',
  /** payload: { id, kind, amount?, itemId?, uid? } — 전리품을 주움 */
  DROP_COLLECTED: 'drop:collected',
  /** payload: { reason } — 가방·착용·소비 아이템·유물·금화가 바뀜(ui 가 다시 그릴 때) */
  INVENTORY_CHANGED: 'inventory:changed',
  /** payload: { id } */
  CONSUMABLE_USED: 'consumable:used',
  /** payload: { amount, level, xp } */
  XP_GAINED: 'xp:gained',
  /** payload: { level } */
  LEVEL_UP: 'level:up',
  /** payload: { options } — 강화 3택1 후보가 제시됨 */
  UPGRADE_OFFERED: 'upgrade:offered',
  /** payload: { kind, id, rank? } */
  UPGRADE_CHOSEN: 'upgrade:chosen',
  /** payload: { kind, price } */
  SHOP_PURCHASE: 'shop:purchase',
  /** payload: { uid, gold } */
  SHOP_SALE: 'shop:sale',
  /** payload: { tier, cost, reward } */
  ALTAR_ACCEPTED: 'altar:accepted',
  /** payload: { hp } — 유물로 되살아남 */
  PLAYER_REVIVED: 'player:revived',
  /** payload: { victory, souls, floor, kills, bossKills } — 런이 끝나 메타 정산을 마침 */
  RUN_ENDED: 'run:ended',
  /** payload: { mode: 'exact'|'rebuilt', floor } — 세이브에서 런을 이어함. 'rebuilt' 는 층을 다시 만든 경우(render·ui 는 화면을 새로 차려야 한다) */
  GAME_RESTORED: 'game:restored',
});
