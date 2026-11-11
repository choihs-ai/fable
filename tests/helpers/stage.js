// 실제로 생성한 층에서 방 전투를 시험하는 도구: 플레이어를 방으로 옮기고, 적을 잡고, 방을 깬다.

import { EVENTS } from '../../src/logic/core/events.js';
import { PHASE } from '../../src/logic/core/state.js';
import { dealDamage } from '../../src/logic/combat/damage.js';
import { setInput } from '../../src/logic/combat/player.js';
import { getPlayer, opponentsOf } from '../../src/logic/entities/actors.js';
import { createGame, enterFloor, setPhase, tick } from '../../src/logic/game.js';
import { navOf } from '../../src/logic/world/nav.js';
import { DT } from './arena.js';

/**
 * @param {{ seed?:string, meta?:object, character?:string, need?:(map:object) => boolean }} [options]
 *   need 를 주면 그 조건에 맞는 층이 나오는 시드를 찾는다(시드 뒤에 번호를 붙여 가며).
 */
export function createStage({ seed = 'stage', meta, character, need } = {}) {
  let game;
  for (let n = 0; n < 200; n++) {
    game = createGame({ seed: need ? `${seed}-${n}` : seed, meta, character });
    const log = [];
    for (const event of Object.values(EVENTS)) game.bus.on(event, (payload) => log.push({ ...payload, event, tick: game.state.tick }));
    game.log = log;
    enterFloor(game, 1);
    if (!need || need(game.state.world)) break;
    if (n === 199) throw new Error('조건에 맞는 층을 찾지 못함');
  }
  setPhase(game, PHASE.PLAYING);
  const { state, bus, log } = game;
  const stage = {
    game, state, bus, log,
    map: state.world,
    player: getPlayer(state),
    nav: () => navOf(state.world),
    events: (event) => log.filter((e) => e.event === event),
    room: (kind) => state.world.rooms.find((r) => r.kind === kind) ?? null,
    rooms: (kind) => state.world.rooms.filter((r) => r.kind === kind),
    enemies: () => opponentsOf(state, 'player'),
    step(n = 1, input = null) {
      for (let i = 0; i < n; i++) {
        if (input) setInput(state, typeof input === 'function' ? input(state) : input);
        tick(game, DT);
      }
    },
    /** 플레이어를 방 한가운데로 옮긴다(문과 복도를 건너뛴다). */
    moveTo(room) {
      stage.player.x = room.feature.x + 0.5;
      stage.player.y = room.feature.y + 0.5;
      setInput(state, { moveX: 0, moveY: 0, attack: false });
    },
    /** 지금 있는 적을 모두 플레이어가 잡은 것으로 한다. */
    killAll() {
      for (const enemy of opponentsOf(state, 'player')) {
        enemy.invulnUntil = 0;
        // 보스는 페이즈 경계에서 멈추므로 죽을 때까지 때린다.
        for (let i = 0; i < 8 && !enemy.dead; i++) {
          enemy.invulnUntil = 0;
          dealDamage(state, bus, enemy, 1e9, { sourceId: stage.player.id });
        }
      }
    },
    /** 방에 들어가 모든 웨이브를 잡아 방을 깬다. 플레이어는 맞지 않게 한다. */
    clear(room) {
      stage.moveTo(room);
      for (let i = 0; i < 6000 && room.state !== 'cleared'; i++) {
        stage.player.invulnUntil = state.tick + 10;
        stage.killAll();
        stage.step(1);
      }
      if (room.state !== 'cleared') throw new Error(`방 ${room.id} 을 깨지 못함`);
    },
  };
  return stage;
}
