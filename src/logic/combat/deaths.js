// 죽음 처리(매 틱 끝): 죽은 행동체의 사망 효과를 실행하고, 처치 보상과 축복을 적용하고, 이벤트를 내고, 목록에서 지운다.

import { COMBAT } from '../../../data/combat.js';
import { EVENTS } from '../core/events.js';
import { allActors, getActor } from '../entities/actors.js';
import { ACTOR_KIND, defOf } from '../entities/defs.js';
import { runEffects } from './abilities.js';
import { onKill, tryRevive } from './boons.js';
import { rewardKill } from './loot.js';

/**
 * @returns {{ playerDied:boolean }}
 */
export function processDeaths(state, bus) {
  const result = { playerDied: false };
  // 사망 효과(분열)·보스 사망·처치 폭발이 새 죽음을 만들 수 있으므로 더 죽는 것이 없을 때까지 돈다. 상한은 무한 루프 방지용.
  for (let pass = 0; pass < 8; pass++) {
    const dead = allActors(state).filter((a) => a.dead && !a.reaped);
    if (dead.length === 0) break;
    for (const actor of dead) {
      // 축복 "두 번째 바람": 런마다 한 번 되살아난다.
      if (actor.kind === ACTOR_KIND.PLAYER && tryRevive(state, bus, actor)) continue;
      actor.reaped = true;
      const def = defOf(actor);
      if (def.onDeath) {
        runEffects(state, bus, actor, def.onDeath, { dirX: actor.facingX, dirY: actor.facingY, targetX: actor.x, targetY: actor.y });
      }
      if (actor.kind === ACTOR_KIND.BOSS && COMBAT.bossMinionsDieWithBoss) {
        for (const other of allActors(state)) {
          if (!other.dead && other.summonerId === actor.id) {
            other.hp = 0;
            other.dead = true;
            other.killerId = actor.killerId;
            other.action = null;
            other.dash = null;
            other.statuses = {};
          }
        }
      }
      bus.emit(EVENTS.ENTITY_DIED, {
        id: actor.id, kind: actor.kind, type: actor.type, x: actor.x, y: actor.y, killerId: actor.killerId,
        elite: actor.elite, radius: actor.radius, kbX: actor.kbX, kbY: actor.kbY,
      });
      if (actor.kind === ACTOR_KIND.PLAYER) {
        // 플레이어는 목록에 남겨 둔다(렌더·UI 가 쓰러진 모습을 그릴 수 있게).
        result.playerDied = true;
      } else {
        rewardKill(state, bus, actor);
        const killer = getActor(state, actor.killerId);
        if (killer && killer.kit && !killer.dead) onKill(state, bus, killer, actor);
        delete state.entities.byId[actor.id];
      }
    }
  }
  return result;
}
