#!/usr/bin/env node
// 봇으로 맛보기 판을 처음부터 끝까지 돌려 본다. 시드마다 한 판씩 플레이하고 결과와 통계를 낸다.
//
//   node scripts/bot-run.mjs                       시드 200개 (약 1분)
//   node scripts/bot-run.mjs --seeds 1000          시드 수 지정
//   node scripts/bot-run.mjs --from 200            시드 번호 시작점 (시드 문자열은 "<prefix><번호>")
//   node scripts/bot-run.mjs --prefix run-         시드 접두사 (기본 "bot-")
//   node scripts/bot-run.mjs --character mage      캐릭터 (기본 knight)
//   node scripts/bot-run.mjs --plan short          보스로 곧장 가는 길만(기본 full: 갈 수 있는 방을 모두 깬다)
//   node scripts/bot-run.mjs --no-dodge            피하지 않는 봇(적이 얼마나 아픈지 본다)
//   node scripts/bot-run.mjs --dodge-rate 50       위협의 절반만 알아채는 봇(사람처럼 놓친다)
//   node scripts/bot-run.mjs --workers 1           워커 수 (기본: CPU 수, 최대 8)
//   node scripts/bot-run.mjs --one bot-17          한 판을 다시 돌려 방마다의 기록을 출력
//
// 검사 항목(판마다):
//   1. 틱이 예외를 던지지 않는가
//   2. 판이 끝나는가(승리 또는 사망). 시간 상한(게임 시간 30분)을 넘기면 "끝나지 않음"으로 센다
//   3. 주기적으로: 상태가 세이브 검증기를 통과하고(오탐 = 저장 실패), NaN·공유 객체가 없고, 살아 있는 몸이 벽 속에 있지 않은가
//   4. 중간에 저장했다 불러온 게임이 저장하지 않은 게임과 끝까지 같은가(일부 시드)
// 문제가 하나라도 있으면 종료 코드 1. 승률·시간은 통계일 뿐 실패 조건이 아니다.

import { availableParallelism } from 'node:os';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

import { EVENTS } from '../src/logic/core/events.js';
import { PHASE } from '../src/logic/core/state.js';
import { allActors, getPlayer } from '../src/logic/entities/actors.js';
import { createGame, enterFloor, resumeGame, setPhase, tick } from '../src/logic/game.js';
import { readRun, serializeRun } from '../src/logic/save/codec.js';
import { validateRunState } from '../src/logic/save/validate.js';
import { circleFree } from '../src/logic/world/collide.js';
import { navOf } from '../src/logic/world/nav.js';
import { botStep, createBot } from './lib/bot.js';
import { findBadNumber, findSharedObject } from './lib/save-sim.js';

const DT = 1 / 60;
const TICK_LIMIT = 30 * 60 * 60;
const CHECK_EVERY = 240;

function option(args, name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
}

/** 한 판을 돌린다. */
export function playRun({ seed, character = 'knight', plan = 'full', dodge = true, dodgeRate = 100, verbose = false, resumeCheck = false }) {
  const meta = character === 'knight' ? undefined : { version: 2, souls: 0, upgrades: {}, characters: { [character]: true } };
  const game = createGame({ seed, meta, character });
  const { state, bus } = game;
  const problems = [];
  const rooms = [];
  const log = (text) => {
    if (verbose) console.log(`  [${(state.tick / 60).toFixed(1)}s] ${text}`);
  };
  let roomStart = 0;
  let hpAtStart = 0;
  let damageTaken = 0;
  bus.on(EVENTS.DOORS_LOCKED, ({ roomId }) => {
    roomStart = state.tick;
    hpAtStart = getPlayer(state).hp;
    log(`방 ${roomId}(${state.world.rooms[roomId].kind}, 깊이 ${state.world.rooms[roomId].depth}) 전투 시작 — 체력 ${hpAtStart}`);
  });
  bus.on(EVENTS.ROOM_CLEARED, ({ roomId, kind, reward }) => {
    const player = getPlayer(state);
    rooms.push({ kind, sec: (state.tick - roomStart) / 60, lost: hpAtStart - player.hp });
    log(`방 ${roomId}(${kind}) 깸 — ${((state.tick - roomStart) / 60).toFixed(1)}초, 체력 ${player.hp}/${player.maxHp}, 에너지 ${player.kit.energy}, 보상 ${reward}`);
  });
  bus.on(EVENTS.DAMAGE_DEALT, ({ targetId, amount }) => {
    if (targetId === state.playerId) damageTaken += amount;
  });
  bus.on(EVENTS.BOON_CHOSEN, ({ boon }) => log(`축복: ${boon}`));
  bus.on(EVENTS.WEAPON_PICKED, ({ weapon, dropped }) => log(`무기: ${weapon}${dropped ? ` (버림: ${dropped})` : ''}`));
  bus.on(EVENTS.SHOP_PURCHASE, ({ kind, price }) => log(`상점: ${kind} ${price}금`));

  enterFloor(game, 1);
  setPhase(game, PHASE.PLAYING);
  const bot = createBot({ plan, dodge, dodgeRate });
  let error = null;
  let shadow = null;
  try {
    while (state.phase === PHASE.PLAYING && state.tick < TICK_LIMIT) {
      const input = botStep(game, bot);
      tick(game, DT);
      if (shadow) {
        // 저장했다 불러온 게임에 같은 조작을 넣어 같이 돌린다.
        const mirror = botStep(shadow.game, shadow.bot);
        tick(shadow.game, DT);
        if (shadow.ok && JSON.stringify(mirror) !== JSON.stringify(input)) {
          shadow.ok = false;
          problems.push(`resume: 틱 ${state.tick} 에서 불러온 게임의 조작이 달라짐`);
        }
      }
      if (state.tick % CHECK_EVERY === 0 && state.phase === PHASE.PLAYING) {
        const invalid = validateRunState(state);
        if (invalid.length > 0) problems.push(`validate@${state.tick}: ${invalid.slice(0, 3).join(' | ')}`);
        const nan = findBadNumber(state);
        if (nan) problems.push(`bad-number@${state.tick}: ${nan}`);
        const shared = findSharedObject({ ...state, meta: null });
        if (shared) problems.push(`shared-object@${state.tick}: ${shared}`);
        const nav = navOf(state.world);
        for (const actor of allActors(state)) {
          if (!actor.dead && !circleFree(nav, actor.x, actor.y, actor.radius - 0.02)) problems.push(`in-wall@${state.tick}: ${actor.type} (${actor.x.toFixed(2)}, ${actor.y.toFixed(2)})`);
        }
        if (problems.length > 8) break;
        // 이어하기 확인: 전투 한가운데에서 한 번 저장했다 불러온다.
        if (resumeCheck && !shadow && state.encounter && state.tick > 1200) {
          const saved = serializeRun(state, 1);
          if (!saved.ok) problems.push(`serialize@${state.tick}: ${saved.reason} ${(saved.problems ?? []).slice(0, 2).join(' | ')}`);
          else {
            const read = readRun(saved.text);
            const resumed = resumeGame({ run: read, meta: state.meta });
            if (!resumed || resumed.mode !== 'exact') problems.push(`resume@${state.tick}: ${read.status} ${read.reason ?? ''} ${(read.problems ?? []).slice(0, 2).join(' | ')}`);
            else shadow = { game: resumed.game, bot: structuredClone(bot), ok: true };
          }
        }
      }
    }
  } catch (err) {
    error = `${err && err.stack ? err.stack.split('\n').slice(0, 4).join(' / ') : err}`;
  }
  if (shadow && shadow.ok && !error) {
    const a = JSON.stringify({ ...state, meta: null });
    const b = JSON.stringify({ ...shadow.game.state, meta: null });
    if (a !== b) problems.push('resume: 저장했다 불러온 게임의 마지막 상태가 다름');
  }
  const player = getPlayer(state);
  const boss = state.world.rooms.find((r) => r.kind === 'boss');
  return {
    seed, error, problems,
    outcome: error ? 'error' : state.phase === PHASE.VICTORY ? 'victory' : state.phase === PHASE.GAME_OVER ? 'death' : 'timeout',
    sec: state.tick / 60,
    roomsCleared: state.run.roomsCleared,
    kills: state.run.kills,
    boons: state.run.boons.length,
    gold: state.run.gold,
    hp: player ? player.hp : 0,
    damageTaken,
    stuck: bot.stuck,
    reachedBoss: boss.state !== 'idle',
    bossSec: rooms.find((r) => r.kind === 'boss')?.sec ?? null,
    roomSec: rooms.filter((r) => r.kind === 'combat').map((r) => r.sec),
    roomLost: rooms.filter((r) => r.kind === 'combat').map((r) => r.lost),
    resumed: shadow !== null,
    deathAt: state.phase === PHASE.GAME_OVER ? (state.encounter ? state.world.rooms[state.encounter.room].kind : 'unknown') : null,
  };
}

function summarize(results, options) {
  const n = results.length;
  const by = (outcome) => results.filter((r) => r.outcome === outcome);
  const wins = by('victory');
  const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);
  const pct = (list, p) => {
    if (list.length === 0) return 0;
    const sorted = list.slice().sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  };
  const min = (s) => `${Math.floor(s / 60)}분 ${String(Math.round(s % 60)).padStart(2, '0')}초`;
  const roomSec = results.flatMap((r) => r.roomSec);
  const roomLost = results.flatMap((r) => r.roomLost);
  const deaths = by('death');
  const deathAt = {};
  for (const r of deaths) deathAt[r.deathAt] = (deathAt[r.deathAt] ?? 0) + 1;
  console.log(`판 수 ${n} — 캐릭터 ${options.character}, 계획 ${options.plan}${options.dodge ? (options.dodgeRate < 100 ? `, 위협의 ${options.dodgeRate}% 만 피함` : '') : ', 피하지 않음'}`);
  console.log(`  승리 ${wins.length} (${((wins.length / n) * 100).toFixed(1)}%) / 사망 ${deaths.length} / 끝나지 않음 ${by('timeout').length} / 예외 ${by('error').length}`);
  console.log(`  승리한 판의 시간: 평균 ${min(avg(wins.map((r) => r.sec)))}, 중앙 ${min(pct(wins.map((r) => r.sec), 0.5))}, 10%~90% ${min(pct(wins.map((r) => r.sec), 0.1))} ~ ${min(pct(wins.map((r) => r.sec), 0.9))}`);
  console.log(`  깬 방: 평균 ${avg(results.map((r) => r.roomsCleared)).toFixed(1)}, 축복 ${avg(results.map((r) => r.boons)).toFixed(1)}개, 처치 ${avg(results.map((r) => r.kills)).toFixed(0)}`);
  console.log(`  전투방 하나: 평균 ${avg(roomSec).toFixed(1)}초 (10%~90% ${pct(roomSec, 0.1).toFixed(1)}~${pct(roomSec, 0.9).toFixed(1)}초), 잃은 체력 평균 ${avg(roomLost).toFixed(1)}`);
  const bossSec = results.map((r) => r.bossSec).filter((s) => s !== null);
  console.log(`  보스: 도달 ${results.filter((r) => r.reachedBoss).length}판, 잡은 판의 전투 시간 평균 ${avg(bossSec).toFixed(1)}초`);
  console.log(`  받은 피해: 평균 ${avg(results.map((r) => r.damageTaken)).toFixed(0)}, 승리한 판의 남은 체력 평균 ${avg(wins.map((r) => r.hp)).toFixed(0)}`);
  console.log(`  사망한 곳: ${JSON.stringify(deathAt)}`);
  console.log(`  제자리걸음 감지: ${results.reduce((a, r) => a + r.stuck, 0)}회, 이어하기 확인: ${results.filter((r) => r.resumed).length}판`);
  const bad = results.filter((r) => r.error || r.problems.length > 0 || r.outcome === 'timeout');
  for (const r of bad.slice(0, 12)) console.log(`  문제 [${r.seed}] ${r.outcome}: ${r.error ?? ''} ${r.problems.slice(0, 3).join(' ; ')}`);
  console.log(bad.length === 0 ? '문제 0건' : `문제 ${bad.length}건`);
  return bad.length;
}

if (!isMainThread) {
  const { seeds, options } = workerData;
  for (const seed of seeds) parentPort.postMessage(playRun({ seed, ...options, resumeCheck: seed.endsWith('0') || seed.endsWith('5') }));
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const options = { character: option(args, 'character', 'knight'), plan: option(args, 'plan', 'full'), dodge: !args.includes('--no-dodge'), dodgeRate: Number(option(args, 'dodge-rate', 100)) };
  const one = option(args, 'one', null);
  if (one) {
    const result = playRun({ seed: one, ...options, verbose: true, resumeCheck: true });
    console.log(result);
    process.exit(result.error || result.problems.length > 0 ? 1 : 0);
  }
  const count = Number(option(args, 'seeds', 200));
  const from = Number(option(args, 'from', 0));
  const prefix = option(args, 'prefix', 'bot-');
  const workers = Math.max(1, Math.min(8, Number(option(args, 'workers', availableParallelism())), count));
  const seeds = Array.from({ length: count }, (_, i) => `${prefix}${from + i}`);
  const started = performance.now();
  const results = [];
  await Promise.all(Array.from({ length: workers }, (_, w) => new Promise((resolve, reject) => {
    const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { seeds: seeds.filter((_, i) => i % workers === w), options } });
    worker.on('message', (r) => results.push(r));
    worker.on('error', reject);
    worker.on('exit', resolve);
  })));
  results.sort((a, b) => a.seed.localeCompare(b.seed, 'en', { numeric: true }));
  const bad = summarize(results, options);
  console.log(`(${((performance.now() - started) / 1000).toFixed(1)}초)`);
  process.exit(bad > 0 || results.length !== count ? 1 : 0);
}
