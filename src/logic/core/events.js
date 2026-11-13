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
  /** payload: { id, kind, type, x, y, killerId, elite, radius, kbX, kbY } — kbX/kbY 는 죽는 순간 밀려나던 속도(튕겨 나가는 연출용) */
  ENTITY_DIED: 'entity:died',
  /** payload: { id, fromX, fromY, x, y } */
  ENTITY_TELEPORTED: 'entity:teleported',
  /** payload: { id, mode: 'idle'|'combat' } — 적이 플레이어를 알아챔 */
  AGGRO_CHANGED: 'aggro:changed',
  /** payload: { id, dirX, dirY, charges } */
  PLAYER_DASHED: 'player:dashed',
  /** payload: { id, x, y } — 대시가 끝남 */
  PLAYER_DASH_ENDED: 'player:dashEnded',
  /** payload: { weapon, slot, dash:boolean, offhand:boolean, bash?:true, kind:'melee'|'ranged', x, y, dirX, dirY } — 플레이어가 무기를 씀(bash 는 에너지가 없어 개머리판으로 친 것) */
  WEAPON_USED: 'weapon:used',
  /** payload: { slot, weapon } — 든 무기를 바꿈 */
  WEAPON_SWAPPED: 'weapon:swapped',
  /** payload: { weapon, dropped:string|null } — 무기를 주움(자리가 없으면 든 무기와 바꿈) */
  WEAPON_PICKED: 'weapon:picked',
  /** payload: { need, have } — 에너지가 모자라 쏘지 못함 */
  ENERGY_EMPTY: 'energy:empty',
  /** payload: { character, type } — 캐릭터 스킬 사용 */
  SKILL_USED: 'skill:used',
  /** 스킬로 체력을 회복했다: { id, amount, x, y }. */
  PLAYER_HEALED: 'player:healed',
  /** 쓰고 있는 탈이 바뀌었다: { id, from, to, burst:교체 기술이 나갔는가, x, y }. 주웠을 때는 picked:true. */
  FORM_CHANGED: 'form:changed',

  // ── 전투 ──
  /** payload: { targetId, sourceId, amount, kind: 'hit'|'dot', hp, blocked, crit, x, y, proc? } — proc 은 축복이 낸 피해의 이름 */
  DAMAGE_DEALT: 'damage:dealt',
  /** payload: { x0, y0, x1, y1, width, faction } — 광선이 나감 */
  BEAM_FIRED: 'beam:fired',
  /** payload: { x, y, radius, faction, proc? } — 폭발(탄, 축복) */
  EXPLOSION: 'explosion',
  /** payload: { points:[{x,y}…] } — 번개가 튐 */
  CHAIN_LIGHTNING: 'chain:lightning',
  /** payload: { count, x, y } — 적의 탄이 지워짐(대검, 탄 가르기) */
  BULLETS_CLEARED: 'bullets:cleared',
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

  // ── 방 ──
  /** payload: { roomId, kind } — 플레이어가 방에 처음 들어섬 */
  ROOM_ENTERED: 'room:entered',
  /** payload: { roomId, doors:[id…] } — 전투가 시작돼 문이 잠김 */
  DOORS_LOCKED: 'doors:locked',
  /** payload: { roomId, doors:[id…] } */
  DOORS_OPENED: 'doors:opened',
  /** payload: { roomId, wave, waves, count } — 웨이브 예고가 시작됨 */
  WAVE_STARTED: 'wave:started',
  /** payload: { roomId, kind, reward } — 방의 적을 모두 잡음 */
  ROOM_CLEARED: 'room:cleared',
  /** payload: { doorId, roomId } — 숨은 문을 찾음 */
  SECRET_FOUND: 'secret:found',

  // ── 줍기·성장 ──
  /** payload: { id, kind, x, y } */
  DROP_SPAWNED: 'drop:spawned',
  /** payload: { id, kind, amount?, x, y } */
  DROP_COLLECTED: 'drop:collected',
  /** payload: { options:[id…], rerolls } — 축복 3택1 이 제시됨 */
  BOON_OFFERED: 'boon:offered',
  /** payload: { boon } */
  BOON_CHOSEN: 'boon:chosen',
  /** payload: { kind, weapon?, boon?, price } */
  SHOP_PURCHASE: 'shop:purchase',
  /** payload: { gold } — 금화가 바뀜 */
  GOLD_CHANGED: 'gold:changed',
  /** payload: { hp } — 유물로 되살아남 */
  PLAYER_REVIVED: 'player:revived',
  /** payload: { victory, souls, floor, kills, bossKills } — 런이 끝나 메타 정산을 마침 */
  RUN_ENDED: 'run:ended',
  /** payload: { mode: 'exact'|'rebuilt', floor } — 세이브에서 런을 이어함. 'rebuilt' 는 층을 다시 만든 경우(render·ui 는 화면을 새로 차려야 한다) */
  GAME_RESTORED: 'game:restored',
});
