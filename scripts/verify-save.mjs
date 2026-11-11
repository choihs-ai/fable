// 세이브 대량 검증.
//   node scripts/verify-save.mjs                 전부
//   node scripts/verify-save.mjs --only fuzz     한 부분만: roundtrip | old | cases | fuzz | sessions
//   --seeds N(왕복 시드 수, 기본 6) --fuzz N(무작위 손상 수, 기본 6000) --sessions N(세션 수, 기본 400)
//
// 1. 왕복: 시드 × 30층 × 여러 순간에 저장 → 읽기 → 이어하기가 상태를 완전히 보존하는지, 이어서 같은 입력을 주면 계속 같은지.
//    저장한 순간에 무엇(장판·투사체·상태이상·보스·상점…)이 들어 있었는지 세고, 한 번도 없었던 것이 있으면 문제로 본다.
// 2. 구버전: tests/fixtures 의 v1~v3 세이브(옛 코드가 실제로 만든 것)를 읽어 이어하고 돌린다.
// 3. 손상 케이스: scripts/lib/save-cases.js 의 목록 × 여러 층의 세이브. 기대한 결과로 읽히는지, 이어한 게임이 죽지 않는지.
// 4. 무작위 손상: 본문을 무작위로 망가뜨려(체크섬을 다시 맞춘 것과 글 자체를 망가뜨린 것) 읽고, 이어하고, 돌린다.
// 5. 세션: 저장소를 흉내 내어 "켜기 → 플레이(자동 저장) → 갑자기 끄기 → 저장소 손상·용량 부족 → 다시 켜기"를 반복한다.
// 문제가 하나라도 있으면 종료 코드 1.

import { isDeepStrictEqual } from 'node:util';
import { SAVE } from '../data/save.js';
import { acceptAltar, buyItem } from '../src/logic/commands.js';
import { EventBus } from '../src/logic/core/event-bus.js';
import { getPlayer } from '../src/logic/entities/actors.js';
import { PHASE } from '../src/logic/core/state.js';
import { createGame, endRun, enterFloor, resumeGame, setPhase } from '../src/logic/game.js';
import { readRun, serializeRun } from '../src/logic/save/codec.js';
import { encodeEnvelope } from '../src/logic/save/envelope.js';
import { validateRunState } from '../src/logic/save/validate.js';
import { TOTAL_FLOORS } from '../src/logic/world/floors.js';
import { createAutosave } from '../src/save/autosave.js';
import { createSaveStore } from '../src/save/save-store.js';
import { openStorage } from '../src/save/storage.js';
import { CASES, groupOf } from './lib/save-cases.js';
import {
  Rng, cloneGame, corruptText, createFakeStorage, findBadNumber, findSharedObject, floorGames, mutateRandom, play,
} from './lib/save-sim.js';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const ONLY = opt('only', null);
const SEEDS = Number(opt('seeds', 6));
const FUZZ = Number(opt('fuzz', 6000));
const SESSIONS = Number(opt('sessions', 400));
const run = (name) => ONLY === null || ONLY === name;

const problems = [];
const report = (where, what) => {
  problems.push(`${where}: ${what}`);
  if (problems.length <= 30) console.log(`  ✖ ${where}: ${what}`);
};
const pct = (n, total) => `${((100 * n) / Math.max(1, total)).toFixed(1)}%`;
const started = performance.now();

/** 이어한 게임을 잠시 돌려 보고, 문제가 있으면 문구를 돌려준다. */
function surviveCheck(read, label, ticks = 120) {
  try {
    const resumed = resumeGame({ run: read, meta: null });
    if (!resumed) return null;
    const { game } = resumed;
    setPhase(game, PHASE.PLAYING);
    play(game, Rng.fromSeed(`survive:${label}`), ticks);
    if (!game.state.run.ended) {
      const invalid = validateRunState(game.state);
      if (invalid.length > 0) return `이어서 돌린 뒤 상태가 망가짐: ${invalid[0]}`;
    }
    const nan = findBadNumber(game.state);
    if (nan) return `이어서 돌린 뒤 수가 아닌 값: ${nan}`;
    return null;
  } catch (err) {
    return `예외: ${String(err && err.stack).split('\n').slice(0, 2).join(' | ')}`;
  }
}

/** 상점에서 살 수 있는 것을 다 사고, 제단의 제안 하나를 받는다. */
function useFacilities(game) {
  const { state } = game;
  const player = getPlayer(state);
  if (state.shop) {
    player.x = state.shop.x;
    player.y = state.shop.y;
    state.shop.stock.forEach((_, i) => buyItem(game, i));
  }
  if (state.altar) {
    player.x = state.altar.x;
    player.y = state.altar.y;
    for (let i = 0; i < state.altar.offers.length && !state.altar.used; i++) acceptAltar(game, i);
  }
}

/** 상태에 들어 있는 요소를 센다. */
function coverageOf(state, out) {
  const add = (key, yes) => {
    if (yes) out[key] = (out[key] ?? 0) + 1;
  };
  const actors = Object.values(state.entities.byId);
  add('hazards', state.hazards.length > 0);
  add('projectiles', state.projectiles.length > 0);
  add('statuses', actors.some((a) => Object.keys(a.statuses).length > 0));
  add('actions', actors.some((a) => a.action !== null));
  add('dashes', actors.some((a) => a.dash !== null));
  add('boss', actors.some((a) => a.kind === 'boss' && !a.dead));
  add('drops', state.drops.length > 0);
  add('shop', state.shop !== null);
  add('sold', state.shop !== null && state.shop.stock.some((e) => e.sold && e.kind === 'equipment'));
  add('altar', state.altar !== null);
  add('altarUsed', state.altar !== null && state.altar.used);
  add('choice', state.run.choice !== null);
  add('buffs', state.run.buffs.length > 0);
  add('bag', state.inventory.bag.length > 0);
  add('relics', state.inventory.relics.length > 0);
  add('paused', state.phase === PHASE.PAUSED);
}

/** 저장 → 읽기 → 이어하기. */
function roundTrip(game) {
  const saved = serializeRun(game.state, 1);
  if (!saved.ok) return { error: `저장 거절 ${saved.reason} ${(saved.problems ?? []).slice(0, 2).join(' / ')}` };
  const read = readRun(saved.text);
  if (read.status !== 'exact') return { error: `읽기 ${read.status} ${(read.problems ?? []).slice(0, 2).join(' / ')}` };
  const resumed = resumeGame({ run: read, meta: structuredClone(game.state.meta) });
  return { text: saved.text, game: resumed.game };
}

// ── 1. 왕복 ──────────────────────────────────────────────────────────────────
if (run('roundtrip')) {
  console.log(`\n━━ 1. 저장 → 불러오기 왕복 (시드 ${SEEDS}개 × ${TOTAL_FLOORS}층 × 4순간) ━━`);
  const t0 = performance.now();
  let trips = 0;
  let same = 0;
  /** 저장한 순간에 무엇이 들어 있었는가(왕복이 그것을 실제로 거쳤는지 확인하려고 센다). */
  const coverage = {};
  let continued = 0;
  let textSame = 0;
  let ended = 0;
  const sizes = [];
  let serializeMs = 0;
  let readMs = 0;
  const phases = {};
  for (let s = 0; s < SEEDS; s++) {
    const seed = `verify-save-${s}`;
    for (const { game, floor } of floorGames({ seed })) {
      const rng = Rng.fromSeed(`${seed}:${floor}`);
      const memo = {};
      // 층에 들어선 뒤 40·110·200틱째에 저장한다.
      // 층에 들어선 뒤 40·110·200틱째에 저장하고, 마지막으로 적을 모두 깨워 장판이 깔린 순간을 찾아(최대 900틱) 한 번 더 저장한다.
      for (const span of [40, 70, 90, 'busy']) {
        if (span === 'busy') {
          // 층의 적을 모두 깨워(맞았을 때와 같은 표시) 교전이 일어나게 한다.
          for (const actor of Object.values(game.state.entities.byId)) {
            if (actor.ai && !actor.dead) actor.ai.provoked = true;
          }
          for (let t = 0; t < 900 && game.state.phase === PHASE.PLAYING; t += 3) {
            if (game.state.hazards.length > 0) break;
            play(game, rng, 3, { memo, commands: false });
          }
        } else play(game, rng, span, { memo });
        // 두 번째 저장 전에 상점·제단을 실제 명령으로 쓴다(진행 시뮬레이션처럼 그 자리로 옮겨 가서).
        if (span === 70 && game.state.phase === PHASE.PLAYING) useFacilities(game);
        if (game.state.phase !== PHASE.PLAYING) {
          ended++;
          break;
        }
        if (rng.chance(0.25)) setPhase(game, PHASE.PAUSED);
        coverageOf(game.state, coverage);
        const shared = findSharedObject(game.state);
        if (shared) report(`${seed} ${floor}층 ${game.state.tick}틱`, `상태 안의 공유·설정 객체: ${shared}`);
        phases[game.state.phase] = (phases[game.state.phase] ?? 0) + 1;
        const a = performance.now();
        const saved = serializeRun(game.state, 1);
        const b = performance.now();
        serializeMs += b - a;
        if (saved.ok) {
          readRun(saved.text);
          readMs += performance.now() - b;
          sizes.push(saved.text.length);
        }
        const trip = roundTrip(game);
        const where = `${seed} ${floor}층 ${game.state.tick}틱`;
        if (trip.error) {
          report(where, trip.error);
          continue;
        }
        trips++;
        if (isDeepStrictEqual(trip.game.state, game.state)) same++;
        else report(where, '불러온 상태가 저장한 상태와 다름');
        if (serializeRun(trip.game.state, 1).text === trip.text) textSame++;
        else report(where, '다시 저장한 글이 다름');
        // 같은 입력으로 이어서 돌리면 계속 같아야 한다.
        const a2 = cloneGame(game);
        const b2 = trip.game;
        for (const g of [a2, b2]) {
          if (g.state.phase === PHASE.PAUSED) setPhase(g, PHASE.PLAYING);
        }
        play(a2, Rng.fromSeed(`cont:${where}`), 150);
        play(b2, Rng.fromSeed(`cont:${where}`), 150);
        if (isDeepStrictEqual(a2.state, b2.state)) continued++;
        else report(where, '이어서 150틱 돌린 결과가 저장하지 않은 게임과 다름');
        if (game.state.phase === PHASE.PAUSED) setPhase(game, PHASE.PLAYING);
      }
    }
  }
  sizes.sort((x, y) => x - y);
  const names = {
    hazards: '장판', projectiles: '투사체', statuses: '상태이상', actions: '기술 준비·경직', dashes: '돌진', boss: '보스',
    drops: '바닥 전리품', shop: '상점', sold: '팔린 장비', altar: '제단', altarUsed: '쓴 제단', choice: '강화 후보', buffs: '물약 효과', bag: '가방 장비', relics: '유물', paused: '일시정지',
  };
  console.log(`  저장한 순간 가운데 들어 있던 것: ${Object.keys(names).map((k) => `${names[k]} ${coverage[k] ?? 0}`).join(', ')}`);
  for (const k of Object.keys(names)) {
    if (!coverage[k]) report('왕복', `저장한 순간에 ${names[k]}이(가) 한 번도 없었다 — 그 부분의 왕복은 검증되지 않았다`);
  }
  const avg = sizes.reduce((x, y) => x + y, 0) / Math.max(1, sizes.length);
  console.log(`  왕복 ${trips}회: 상태 완전 일치 ${same}회, 다시 저장한 글 일치 ${textSame}회, 이어서 150틱 일치 ${continued}회`);
  console.log(`  저장한 순간의 페이즈: ${Object.entries(phases).map(([k, v]) => `${k} ${v}`).join(', ')} / 그 전에 런이 끝난 층 ${ended}`);
  console.log(`  세이브 크기(글자): 평균 ${Math.round(avg).toLocaleString()}, 중앙 ${sizes[sizes.length >> 1]?.toLocaleString()}, 최대 ${sizes.at(-1)?.toLocaleString()} (localStorage 는 보통 약 500만 자)`);
  console.log(`  처리 시간: 저장(검증+직렬화) 평균 ${(serializeMs / Math.max(1, sizes.length)).toFixed(2)}ms, 읽기(파싱+검증) 평균 ${(readMs / Math.max(1, sizes.length)).toFixed(2)}ms · ${((performance.now() - t0) / 1000).toFixed(1)}초`);
}

// ── 2. 구버전 ────────────────────────────────────────────────────────────────
if (run('old')) {
  console.log('\n━━ 2. 구버전 세이브 (옛 단계의 실제 코드가 만든 상태) ━━');
  for (const version of [1, 2, 3]) {
    const data = JSON.parse(readFileSync(new URL(`../tests/fixtures/state-v${version}.json`, import.meta.url), 'utf8'));
    const read = readRun(encodeEnvelope({ kind: 'run', version, data, savedAt: 1 }));
    const how = read.status === 'salvage' ? `층을 다시 만듦(손상 ${read.damaged ? '있음' : '없음'})` : read.status;
    const fail = surviveCheck(read, `old-v${version}`, 600);
    if (read.status !== (version === 3 ? 'exact' : 'salvage') || read.damaged) report(`v${version}`, `읽기 결과 ${read.status} 손상 ${read.damaged}`);
    if (fail) report(`v${version}`, fail);
    console.log(`  v${version}: 마이그레이션 ${read.migrated?.map((v) => `v${v}→v${v + 1}`).join(', ')} → ${how}, 시드 ${data.seed}, ${data.run.floor}층 · 600틱 이어서 돌림 ${fail ? '실패' : '이상 없음'}`);
  }
}

/** 손상 케이스·무작위 손상에 쓸 바탕 세이브(층마다 하나, 전투 중). */
function baseSaves(floors) {
  const out = [];
  for (const { game, floor } of floorGames({ seed: 'verify-save-base', floors: (f) => floors.includes(f) })) {
    play(game, Rng.fromSeed(`base:${floor}`), 300);
    const saved = serializeRun(game.state, 1);
    if (saved.ok) out.push({ floor, text: saved.text, data: JSON.parse(saved.text).data });
  }
  return out;
}

// ── 3. 손상 케이스 ───────────────────────────────────────────────────────────
if (run('cases')) {
  const bases = baseSaves([1, 5, 9, 15, 22, 30]);
  console.log(`\n━━ 3. 손상 케이스 ${CASES.length}가지 × 바탕 세이브 ${bases.length}개(${bases.map((b) => `${b.floor}층`).join('·')}) ━━`);
  const byGroup = {};
  const outcomes = { none: 0, salvage: 0, finished: 0, exact: 0 };
  for (const c of CASES) {
    const group = groupOf(c);
    byGroup[group] ??= { cases: 0, ok: 0 };
    byGroup[group].cases++;
    let allOk = true;
    for (const base of bases) {
      const label = `${c.id}@${base.floor}층`;
      let read;
      try {
        read = readRun(c.corrupt(base));
      } catch (err) {
        report(label, `읽다가 예외 ${err.message}`);
        allOk = false;
        continue;
      }
      outcomes[read.status]++;
      if (read.status !== c.expect) {
        report(label, `기대 ${c.expect}, 실제 ${read.status} ${read.reason ?? ''}`);
        allOk = false;
      }
      if (read.status === 'salvage' && (!read.damaged || read.core.seed !== base.data.seed || read.core.run.floor !== base.data.run.floor)) {
        report(label, '건진 핵심이 원래 런과 다름');
        allOk = false;
      }
      const fail = read.status === 'salvage' || read.status === 'exact' ? surviveCheck(read, label) : null;
      if (fail) {
        report(label, fail);
        allOk = false;
      }
    }
    if (allOk) byGroup[group].ok++;
  }
  const names = { text: '글 자체', env: '봉투', core: '시드·층', prog: '진행도', inv: '인벤토리', world: '맵', actor: '행동체', floor: '그 밖의 층 상태' };
  for (const [group, { cases, ok }] of Object.entries(byGroup)) console.log(`  ${names[group].padEnd(10)} ${String(cases).padStart(3)}가지: 기대대로 ${ok}가지`);
  console.log(`  결과 분포(케이스×바탕 ${CASES.length * bases.length}건): 새 런 ${outcomes.none} / 핵심만 건져 층을 다시 만듦 ${outcomes.salvage} / 끝난 런 ${outcomes.finished}`);
  console.log(`  원형 오염: ${{}.polluted === undefined ? '없음' : '있음'}`);
  if ({}.polluted !== undefined) report('cases', 'Object.prototype 이 오염됨');
}

// ── 4. 무작위 손상 ───────────────────────────────────────────────────────────
if (run('fuzz')) {
  const bases = baseSaves([2, 5, 11, 15, 19, 25, 28, 30]);
  const textCount = Math.floor(FUZZ / 3);
  console.log(`\n━━ 4. 무작위 손상: 본문 손상 ${FUZZ.toLocaleString()}건(체크섬을 다시 맞춤) + 글 손상 ${textCount.toLocaleString()}건 ━━`);
  const rng = Rng.fromSeed('verify-save-fuzz');
  const outcome = { exact: 0, salvage: 0, none: 0, finished: 0 };
  const reasons = {};
  const t0 = performance.now();
  for (let i = 0; i < FUZZ + textCount; i++) {
    const base = rng.pick(bases);
    let text;
    if (i < FUZZ) {
      const data = structuredClone(base.data);
      for (let k = rng.int(1, 3); k > 0; k--) mutateRandom(data, rng);
      text = encodeEnvelope({ kind: 'run', version: 4, data, savedAt: 1 });
    } else {
      text = base.text;
      for (let k = rng.int(1, 2); k > 0; k--) text = corruptText(text, rng);
    }
    let read;
    try {
      read = readRun(text);
    } catch (err) {
      report(`fuzz#${i}`, `읽다가 예외 ${err.message}`);
      continue;
    }
    outcome[read.status]++;
    if (read.status === 'none') reasons[read.reason] = (reasons[read.reason] ?? 0) + 1;
    const fail = read.status === 'salvage' || read.status === 'exact' ? surviveCheck(read, `fuzz#${i}`) : null;
    if (fail) report(`fuzz#${i}`, fail);
  }
  const total = FUZZ + textCount;
  console.log(`  읽은 결과: 그대로 이어함 ${outcome.exact} (${pct(outcome.exact, total)}) / 핵심만 건짐 ${outcome.salvage} (${pct(outcome.salvage, total)}) / 새 런 ${outcome.none} (${pct(outcome.none, total)}) / 끝난 런 ${outcome.finished}`);
  console.log(`  새 런이 된 사유: ${Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log('  "그대로 이어함"은 바뀐 값이 여전히 허용 범위 안이라(옵션·능력치 수치, 좌표, 목록에서 항목 하나 삭제 등) 정상 세이브와 구별할 수 없는 경우다.');
  console.log(`  이어할 수 있는 것은 전부 120틱 이어서 돌려 상태 검증·NaN 검사를 했다 · ${((performance.now() - t0) / 1000).toFixed(1)}초`);
}

// ── 5. 세션 ──────────────────────────────────────────────────────────────────
if (run('sessions')) {
  console.log(`\n━━ 5. 세션 흉내 ${SESSIONS}회: 켜기 → 플레이(자동 저장) → 갑자기 끄기 → 저장소 손상·용량 부족 → 다시 켜기 ━━`);
  const rng = Rng.fromSeed('verify-save-sessions');
  const stats = { exact: 0, rebuilt: 0, new: 0, mismatch: 0, saves: 0, saveFailed: {}, damage: {}, envs: {} };
  let backend = createFakeStorage();
  let lastSaved = null; // 마지막으로 저장에 성공한 런 글
  let runSeed = 0;
  for (let s = 0; s < SESSIONS; s++) {
    // 저장소 환경: 대부분 정상, 가끔 막힘·가득 참·용량이 작음.
    const env = rng.pick(['ok', 'ok', 'ok', 'ok', 'ok', 'small', 'full', 'blocked', 'missing']);
    stats.envs[env] = (stats.envs[env] ?? 0) + 1;
    backend.quota = env === 'small' ? backend.used() + rng.int(0, 60000) : Infinity;
    backend.failSet = env === 'full';
    const provider = env === 'blocked' ? () => { throw new Error('SecurityError'); } : env === 'missing' ? () => undefined : () => backend;
    let game;
    let store;
    try {
      store = createSaveStore({ storage: openStorage(provider), now: () => s });
      const loaded = store.load();
      const bus = new EventBus();
      const resumed = resumeGame({ run: loaded.run.result, meta: loaded.meta.meta, bus });
      if (resumed) {
        game = resumed.game;
        stats[resumed.mode]++;
        // 저장소가 멀쩡하고 손상도 없었다면, 마지막으로 저장한 그대로여야 한다.
        if (resumed.mode === 'exact' && env !== 'blocked' && env !== 'missing' && lastSaved && loaded.run.source === 'primary') {
          const expected = readRun(lastSaved);
          if (expected.status === 'exact') {
            const { meta: _m, ...state } = game.state;
            if (!isDeepStrictEqual(state, expected.state)) {
              stats.mismatch++;
              report(`세션 ${s}`, '이어한 상태가 마지막으로 저장한 상태와 다름');
            }
          }
        }
      } else {
        game = createGame({ seed: `session-run-${runSeed++}`, meta: loaded.meta.meta, bus });
        enterFloor(game, 1);
        stats.new++;
      }
      setPhase(game, PHASE.PLAYING);
      const autosave = createAutosave({
        getGame: () => game,
        store,
        onResult: ({ run: r }) => {
          if (r.ok) {
            stats.saves++;
            if (store.persistent) lastSaved = backend.items.get(SAVE.keys.run) ?? null;
          } else if (r.reason !== 'run-ended') {
            stats.saveFailed[r.reason] = (stats.saveFailed[r.reason] ?? 0) + 1;
            // 정상 플레이 중의 상태가 검증을 통과하지 못했다 = 검증기의 오탐이거나 로직의 버그다.
            if (r.reason === 'invalid-state') report(`세션 ${s}`, `저장 거절(검증 실패): ${(r.problems ?? []).slice(0, 2).join(' / ')}`);
          }
          if (r.reason === 'run-ended') lastSaved = null;
        },
      });
      autosave.attach(game.bus);
      // 플레이: 사이사이 층 이동·일시정지·백그라운드 전환.
      for (let step = rng.int(1, 6); step > 0; step--) {
        play(game, rng, rng.int(20, 200));
        autosave.flush();
        if (game.state.run.ended) break;
        const action = rng.int(0, 5);
        if (action === 0 && game.state.run.floor < TOTAL_FLOORS) enterFloor(game, game.state.run.floor + 1);
        else if (action === 1) setPhase(game, PHASE.PAUSED);
        else if (action === 2) autosave.saveNow('background');
        else if (action === 3 && rng.chance(0.08)) endRun(game, false);
        autosave.flush();
        if (game.state.phase === PHASE.PAUSED) setPhase(game, PHASE.PLAYING);
      }
      if (!store.persistent) lastSaved = null; // 메모리 저장소는 페이지와 함께 사라진다.
    } catch (err) {
      report(`세션 ${s} (${env})`, `예외: ${String(err && err.stack).split('\n').slice(0, 2).join(' | ')}`);
    }
    // 갑자기 끔. 다음 세션 전에 저장소가 망가질 수 있다.
    if (rng.chance(0.3)) {
      const key = rng.pick([SAVE.keys.run, SAVE.keys.meta, SAVE.keys.settings, SAVE.keys.run + SAVE.backupSuffix]);
      const value = backend.items.get(key);
      const how = rng.pick(['truncate', 'garbage', 'delete', 'flip']);
      stats.damage[how] = (stats.damage[how] ?? 0) + 1;
      if (how === 'delete') backend.items.delete(key);
      else if (how === 'garbage') backend.items.set(key, rng.pick(['', '{', 'null', '[]', 'undefined', '\u0000\u0000']));
      else if (value !== undefined) backend.items.set(key, how === 'truncate' ? value.slice(0, rng.int(0, value.length)) : corruptText(value, rng));
      if (key === SAVE.keys.run || key === SAVE.keys.run + SAVE.backupSuffix) lastSaved = null;
    }
    // 가끔 저장소가 통째로 비워진다(사용자가 사이트 데이터를 지움).
    if (rng.chance(0.02)) {
      backend = createFakeStorage();
      lastSaved = null;
    }
  }
  console.log(`  저장소 환경: ${Object.entries(stats.envs).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`  시작: 그대로 이어함 ${stats.exact} / 층을 다시 만들어 이어함 ${stats.rebuilt} / 새 런 ${stats.new}`);
  console.log(`  저장 성공 ${stats.saves}회, 실패 ${Object.entries(stats.saveFailed).map(([k, v]) => `${k} ${v}`).join(', ') || '없음'}`);
  console.log(`  끈 뒤 저장소 손상: ${Object.entries(stats.damage).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`  마지막 저장과 이어한 상태의 불일치: ${stats.mismatch}회`);
}

console.log(`\n소요 ${((performance.now() - started) / 1000).toFixed(1)}초`);
console.log(`문제: ${problems.length}건`);
process.exit(problems.length === 0 ? 0 : 1);
