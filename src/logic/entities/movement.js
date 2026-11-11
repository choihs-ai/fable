// 이동 단계: 각 행동체의 이동 의도(moveX/moveY)나 돌진, 넉백을 위치에 반영하고, 벽과 서로에게서 밀어낸다.

import { COMBAT } from '../../../data/combat.js';
import { FEEL } from '../../../data/feel.js';
import { moveCircle, resolveCircle } from '../world/collide.js';
import { navOf } from '../world/nav.js';
import { allActors } from './actors.js';

/**
 * @param {object} state
 * @param {number} dtSec 고정 틱 길이(초)
 */
export function integrateMovement(state, dtSec) {
  const nav = navOf(state.world);
  const actors = allActors(state).filter((a) => !a.dead);

  for (const a of actors) {
    a.hitWall = false;
    a.moved = false;
    let vx = 0;
    let vy = 0;
    if (a.dash) {
      vx = a.dash.dirX * a.dash.speed;
      vy = a.dash.dirY * a.dash.speed;
      // 돌진 중에는 밀려나지 않는다.
      a.kbX = 0;
      a.kbY = 0;
    } else {
      if (!a.disabled) {
        const speed = a.speed * a.speedMul * a.moveScale;
        vx = a.moveX * speed;
        vy = a.moveY * speed;
      }
      // 넉백: 밀려나는 속도를 더하고 틱마다 줄인다. 행동 불가 상태에서도 밀려난다.
      if (a.kbX !== 0 || a.kbY !== 0) {
        vx += a.kbX;
        vy += a.kbY;
        a.kbX *= FEEL.knockback.decay;
        a.kbY *= FEEL.knockback.decay;
        if (a.kbX * a.kbX + a.kbY * a.kbY < FEEL.knockback.stop * FEEL.knockback.stop) {
          a.kbX = 0;
          a.kbY = 0;
        }
      }
    }
    if (vx !== 0 || vy !== 0) {
      const ox = a.x;
      const oy = a.y;
      a.hitWall = moveCircle(nav, a, a.radius, vx * dtSec, vy * dtSec);
      const dx = a.x - ox;
      const dy = a.y - oy;
      a.moved = dx * dx + dy * dy > 1e-8;
    }
    if (a.dash && (state.tick >= a.dash.endAt || (a.hitWall && a.dash.stopOnWall))) {
      // 돌진 끝. 피해·기절 같은 뒷처리는 전투 단계(resolveDashes)가 하고 dash 를 지운다.
      a.dash.done = true;
      a.dash.wall = a.hitWall;
    }
  }

  // 서로 겹친 몸을 밀어낸다. 돌진 중인 몸은 다른 몸을 통과한다.
  for (let i = 0; i < actors.length; i++) {
    const a = actors[i];
    if (a.dash) continue;
    for (let j = i + 1; j < actors.length; j++) {
      const b = actors[j];
      if (b.dash) continue;
      const min = a.radius + b.radius;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min) continue;
      let d = Math.sqrt(d2);
      if (d < 1e-6) {
        // 완전히 겹쳤으면 id 순서로 정해진 방향으로 벌린다.
        dx = 1;
        dy = 0;
        d = 1;
      }
      // 같은 편: 살짝 겹쳤을 때 가장 세게, 깊이 겹칠수록 약하게 민다(d/min 을 곱한다).
      // 서로 마주 보고 밀고 들어오면 통과할 수 있고, 나란히 있을 때는 벌어진다.
      const overlap = a.faction === b.faction ? (min - d) * COMBAT.allySeparation * (d / min) : min - d;
      const shareA = b.mass / (a.mass + b.mass);
      a.x -= (dx / d) * overlap * shareA;
      a.y -= (dy / d) * overlap * shareA;
      b.x += (dx / d) * overlap * (1 - shareA);
      b.y += (dy / d) * overlap * (1 - shareA);
      resolveCircle(nav, a, a.radius);
      resolveCircle(nav, b, b.radius);
    }
  }
}
