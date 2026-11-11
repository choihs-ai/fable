// 테스트용 작은 전장. 글자 그림으로 맵을 만들고 플레이어·적을 놓는다.
//   '#' 벽, 그 밖은 바닥. 'P' 는 플레이어 자리, 나머지 글자는 표식(arena.at('a') 로 좌표를 얻는다).

import { EVENTS } from '../../src/logic/core/events.js';
import { PHASE } from '../../src/logic/core/state.js';
import { TICK_RATE } from '../../src/logic/core/time.js';
import { setInput } from '../../src/logic/combat/player.js';
import { spawnEnemy, spawnPlayer } from '../../src/logic/entities/actors.js';
import { enemyDef } from '../../src/logic/entities/defs.js';
import { refreshPlayerStats } from '../../src/logic/entities/stats.js';
import { createGame, setPhase, tick } from '../../src/logic/game.js';
import { navOf } from '../../src/logic/world/nav.js';

export const DT = 1 / TICK_RATE;

export function parseRows(rows) {
  const height = rows.length;
  const width = rows[0].length;
  const tiles = [];
  const marks = {};
  rows.forEach((row, y) => {
    if (row.length !== width) throw new Error('모든 줄의 길이가 같아야 함');
    for (let x = 0; x < width; x++) {
      const ch = row[x];
      tiles.push(ch === '#' ? 0 : 1);
      if (ch !== '#' && ch !== '.') marks[ch] = { x: x + 0.5, y: y + 0.5 };
    }
  });
  return { width, height, tiles, marks };
}

/** 사방이 벽인 빈 방. */
export function openRoom(width, height) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    rows.push(y === 0 || y === height - 1 ? '#'.repeat(width) : `#${'.'.repeat(width - 2)}#`);
  }
  return rows;
}

/**
 * @param {string[]} rows
 * @param {{ seed?: string, player?: {x:number,y:number}, meta?: object, character?: string }} [options]
 */
export function createArena(rows, { seed = 'arena', player, meta, character } = {}) {
  const { width, height, tiles, marks } = parseRows(rows);
  const game = createGame({ seed, meta, character });
  const { state, bus } = game;
  // 방·문이 없는 맵: 방 전투(logic/combat/encounter.js)는 아무 일도 하지 않는다.
  state.world = { floor: 1, zoneId: 'test', kind: 'stage', algorithm: 'test', width, height, tiles, start: null, rooms: [], doors: [], links: [] };
  const log = [];
  // 이벤트 이름은 event 에 담는다(payload 에 type 이라는 항목이 따로 있는 이벤트가 있다).
  for (const event of Object.values(EVENTS)) bus.on(event, (payload) => log.push({ ...payload, event, tick: state.tick }));
  const start = player ?? marks.P;
  const p = start ? spawnPlayer(state, bus, start.x, start.y) : null;
  if (p) refreshPlayerStats(state);
  setPhase(game, PHASE.PLAYING);
  return {
    game, state, bus, log, marks, player: p,
    nav: navOf(state.world),
    at: (ch) => marks[ch],
    /**
     * 표식 자리(또는 좌표)에 적을 놓는다. 깊이별 난이도 배율은 걷어 내고 데이터의 기본 수치로 둔다
     * (전투 규칙 테스트가 난이도 곡선 수치에 흔들리지 않도록). options.scaled 를 주면 배율을 그대로 둔다.
     */
    enemy: (type, where, options = {}) => {
      const pos = typeof where === 'string' ? marks[where] : where;
      const actor = spawnEnemy(state, bus, type, pos.x, pos.y, options);
      if (!options.scaled) {
        actor.maxHp = actor.hp = enemyDef(type).hp;
        actor.power = 1;
      }
      return actor;
    },
    /** n 틱 진행한다. input 을 주면 매 틱 그 입력을 넣는다(함수면 틱마다 호출). */
    step: (n = 1, input = null) => {
      for (let i = 0; i < n; i++) {
        if (input) setInput(state, typeof input === 'function' ? input(state) : input);
        tick(game, DT);
      }
    },
    /** 지금까지 나온 이 이름의 이벤트들(payload 에 event, tick 이 덧붙는다). */
    events: (event) => log.filter((e) => e.event === event),
  };
}

/** 초 → 틱(테스트 가독성용). */
export const sec = (s) => Math.round(s * TICK_RATE);
