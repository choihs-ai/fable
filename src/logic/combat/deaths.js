// 죽음 처리(매 틱 끝): 죽은 행동체의 사망 효과를 실행하고, 이벤트를 내고, 목록에서 지운다.

import { COMBAT } from '../../../data/combat.js';
import { RELICS } from '../../../data/relics.js';
import { ZONES } from '../../../data/zones.js';
import { EVENTS } from '../core/events.js';
import { ticksOf } from '../core/time.js';
import { allActors } from '../entities/actors.js';
import { ACTOR_KIND, defOf } from '../entities/defs.js';
import { runEffects } from './abilities.js';
import { rewardKill } from './loot.js';

/** 보스 id → 'mid' | 'final'. */
const BOSS_KIND = {};
for (const zone of ZONES) if (zone.boss) BOSS_KIND[zone.boss.id] = zone.boss.kind;

/** 되살아나게 하는 유물이 있고 아직 쓰지 않았으면 그 정의를 돌려준다. */
function reviveRelic(state) {
  if (!state.inventory || state.run.reviveUsed) return null;
  for (const id of state.inventory.relics) {
    if (RELICS[id].revive) return RELICS[id].revive;
  }
  return null;
}

/**
 * @returns {{ playerDied:boolean, finalBossDied:boolean }}
 */
export function processDeaths(state, bus) {
  const result = { playerDied: false, finalBossDied: false };
  // 사망 효과(분열)나 보스 사망이 새 죽음을 만들 수 있으므로 더 죽는 것이 없을 때까지 돈다. 상한은 무한 루프 방지용.
  for (let pass = 0; pass < 8; pass++) {
    const dead = allActors(state).filter((a) => a.dead && !a.reaped);
    if (dead.length === 0) break;
    for (const actor of dead) {
      if (actor.kind === ACTOR_KIND.PLAYER) {
        const revive = reviveRelic(state);
        if (revive) {
          // 유물로 되살아난다(런마다 한 번). 잠깐 무적이 된다.
          state.run.reviveUsed = true;
          actor.dead = false;
          actor.killerId = null;
          actor.hp = Math.max(1, Math.round((actor.maxHp * revive.hpPct) / 100));
          actor.invulnUntil = state.tick + ticksOf(2);
          bus.emit(EVENTS.PLAYER_REVIVED, { hp: actor.hp });
          continue;
        }
      }
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
      bus.emit(EVENTS.ENTITY_DIED, { id: actor.id, kind: actor.kind, type: actor.type, x: actor.x, y: actor.y, killerId: actor.killerId });
      if (actor.kind === ACTOR_KIND.PLAYER) {
        // 플레이어는 목록에 남겨 둔다(렌더·UI 가 쓰러진 모습을 그릴 수 있게).
        result.playerDied = true;
      } else {
        if (state.inventory) rewardKill(state, bus, actor);
        if (actor.kind === ACTOR_KIND.BOSS && BOSS_KIND[actor.type] === 'final') result.finalBossDied = true;
        delete state.entities.byId[actor.id];
      }
    }
  }
  return result;
}
