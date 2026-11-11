// 세이브 대량 검증.
//   node scripts/verify-save.mjs                 전부
//   node scripts/verify-save.mjs --only fuzz     한 부분만: roundtrip | old | cases | fuzz | sessions
//   --seeds N(왕복 시드 수, 기본 8) --fuzz N(무작위 손상 수, 기본 6000) --sessions N(세션 수, 기본 400)
//
// 1. 왕복: 시드마다 봇이 한 판을 돌며 여러 순간(시작 방·전투·웨이브 예고·3택1·상점·보스전·일시정지)에 저장 → 읽기 → 이어하기가
//    상태를 완전히 보존하는지, 이어서 같은 입력을 주면 계속 같은지.
//    저장한 순간에 무엇(장판·투사체·상태이상·보스·잠긴 문…)이 들어 있었는지 세고, 한 번도 없었던 것이 있으면 문제로 본다.
// 2. 구버전: 방 단위 구조 이전의 런(v1~v4)은 이어하지 않고 버리는지, 메타 v1 은 영혼석을 돌려받으며 올라오는지.
// 3. 손상 케이스: scripts/lib/save-cases.js 의 목록 × 여러 순간의 세이브. 기대한 결과로 읽히는지, 이어한 게임이 죽지 않는지.
// 4. 무작위 손상: 본문을 무작위로 망가뜨려(체크섬을 다시 맞춘 것과 글 자체를 망가뜨린 것) 읽고, 이어하고, 돌린다.
// 5. 세션: 저장소를 흉내 내어 "켜기 → 플레이(자동 저장) → 갑자기 끄기 → 저장소 손상·용량 부족 → 다시 켜기"를 반복한다.
// 문제가 하나라도 있으면 종료 코드 1.

import { isDeepStrictEqual } from 'node:util';
import { SAVE } from '../data/save.js';
import { LEGACY_UNLOCK_COSTS } from '../data/meta.js';
import { EventBus } from '../src/logic/core/event-bus.js';
import { getPlayer } from '../src/logic/entities/actors.js';
import { PHASE, STATE_VERSION } from '../src/logic/core/state.js';
import { createGame, endRun, enterFloor, resumeGame, setPhase, tick } from '../src/logic/game.js';
import { offerBoons } from '../src/logic/combat/loot.js';
import { setInput } from '../src/logic/combat/player.js';
import { readMeta, readRun, serializeRun } from '../src/logic/save/codec.js';
import { encodeEnvelope } from '../src/logic/save/envelope.js';
import { validateRunState } from '../src/logic/save/validate.js';
import { createAutosave } from '../src/save/autosave.js';
import { createSaveStore } from '../src/save/save-store.js';
import { openStorage } from '../src/save/storage.js';
import { createBot } from './lib/bot.js';
import { CASES, groupOf } from './lib/save-cases.js';
import {
  Rng, cloneGame, corruptText, createFakeStorage, findBadNumber, findSharedObject, mutateRandom, play, stageGames,
} from './lib/save-sim.js';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const ONLY = opt('only', null);
const SEEDS = Number(opt('seeds', 8));
const MAGE = { version: 2, souls: 0, upgrades: {}, characters: { mage: true } };
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
    const resumed = resumeGame({ run: read, meta: MAGE });
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

/** 상태에 들어 있는 요소를 센다. */
function coverageOf(state, out) {
  const add = (key, yes) => {
    if (yes) out[key] = (out[key] ?? 0) + 1;
  };
  const actors = Object.values(state.entities.byId);
  const player = state.entities.byId[state.playerId];
  add('hazards', state.hazards.some((h) => h.kind === 'blast'));
  add('warp', state.hazards.some((h) => h.kind === 'warp'));
  add('projectiles', state.projectiles.length > 0);
  add('explosive', state.projectiles.some((p) => p.explode !== null));
  add('statuses', actors.some((a) => Object.keys(a.statuses).length > 0));
  add('actions', actors.some((a) => a.action !== null));
  add('dashes', actors.some((a) => a.dash !== null));
  add('knockback', actors.some((a) => a.kbX !== 0 || a.kbY !== 0));
  add('elite', actors.some((a) => a.elite && !a.dead));
  add('boss', actors.some((a) => a.kind === 'boss' && !a.dead));
  add('encounter', state.encounter !== null);
  add('pending', state.encounter !== null && state.encounter.pending.length > 0);
  add('drops', state.drops.length > 0);
  add('weaponDrop', state.drops.some((d) => d.kind === 'weapon'));
  add('sold', state.shop !== null && state.shop.stock.some((e) => e.sold));
  add('choice', state.run.choice !== null);
  add('boons', state.run.boons.length >= 3);
  add('buffer', player && player.kit.buffer !== null);
  add('noCharges', player && player.kit.charges === 0);
  add('secretOpen', state.world.doors.some((d) => d.secret && d.open));
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
  console.log(`\n━━ 1. 저장 → 불러오기 왕복 (시드 ${SEEDS}개 × 한 판의 여러 순간) ━━`);
  const t0 = performance.now();
  let trips = 0;
  let same = 0;
  /** 저장한 순간에 무엇이 들어 있었는가(왕복이 그것을 실제로 거쳤는지 확인하려고 센다). */
  const coverage = {};
  let continued = 0;
  let textSame = 0;
  const sizes = [];
  let serializeMs = 0;
  let readMs = 0;
  const phases = {};
  for (let s = 0; s < SEEDS; s++) {
    const seed = `verify-save-${s}`;
    const mage = s % 2 === 1;
    // 160틱마다 한 순간씩, 판이 끝날 때까지.
    for (const { game, at } of stageGames({ seed, meta: mage ? MAGE : undefined, character: mage ? 'mage' : 'knight', every: 160, limit: 200 })) {
      const rng = Rng.fromSeed(`${seed}:${at}`);
      // 같은 순간을 그대로, 그리고 무작위 조작(대시·스킬 난타, 엉뚱한 방향, 명령)을 몇 틱 섞은 뒤에도 저장한다.
      if (rng.chance(0.5)) play(game, rng, rng.int(1, 12));
      if (game.state.phase !== PHASE.PLAYING) continue;
      // 봇이 잘 만들지 않는 상태도 실제 로직으로 만든다: 불길 대시로 깐 장판, 떠 있는 축복 3택1.
      const kind = rng.int(0, 5);
      if (kind === 0 && !game.state.run.boons.includes('ember_trail')) {
        game.state.run.boons.push('ember_trail');
        setInput(game.state, { moveX: 1, moveY: 0, dash: true });
        tick(game, 1 / 60);
        tick(game, 1 / 60);
      } else if (kind === 1 && game.state.run.choice === null) {
        offerBoons(game.state, game.bus);
      }
      if (game.state.phase !== PHASE.PLAYING) continue;
      if (rng.chance(0.25)) setPhase(game, PHASE.PAUSED);
      coverageOf(game.state, coverage);
      const where = `${seed} 틱 ${game.state.tick}`;
      const shared = findSharedObject(game.state);
      if (shared) report(where, `상태 안의 공유·설정 객체: ${shared}`);
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
      play(a2, Rng.fromSeed(`cont:${where}`), 150, { bot: createBot() });
      play(b2, Rng.fromSeed(`cont:${where}`), 150, { bot: createBot() });
      if (isDeepStrictEqual(a2.state, b2.state)) continued++;
      else report(where, '이어서 150틱 돌린 결과가 저장하지 않은 게임과 다름');
    }
  }
  sizes.sort((x, y) => x - y);
  const names = {
    hazards: '장판', warp: '시간 왜곡', projectiles: '투사체', explosive: '터지는 탄', statuses: '상태이상', actions: '기술 준비·경직',
    dashes: '돌진·대시', knockback: '넉백', elite: '정예', boss: '보스', encounter: '잠긴 방', pending: '웨이브 예고', drops: '바닥에 놓인 것',
    weaponDrop: '바닥의 무기', sold: '팔린 진열품', choice: '축복 3택1', boons: '축복 셋 이상', buffer: '입력 버퍼', noCharges: '대시 충전 0',
    secretOpen: '찾은 숨은 문', paused: '일시정지',
  };
  console.log(`  저장한 순간 가운데 들어 있던 것: ${Object.keys(names).map((k) => `${names[k]} ${coverage[k] ?? 0}`).join(', ')}`);
  for (const k of Object.keys(names)) {
    // 숨은 문은 봇이 일부러 찾지 않으므로 없어도 문제로 보지 않는다(테스트가 따로 확인한다).
    if (!coverage[k] && k !== 'secretOpen') report('왕복', `저장한 순간에 ${names[k]}이(가) 한 번도 없었다 — 그 부분의 왕복은 검증되지 않았다`);
  }
  const avg = sizes.reduce((x, y) => x + y, 0) / Math.max(1, sizes.length);
  console.log(`  왕복 ${trips}회: 상태 완전 일치 ${same}회, 다시 저장한 글 일치 ${textSame}회, 이어서 150틱 일치 ${continued}회`);
  console.log(`  저장한 순간의 페이즈: ${Object.entries(phases).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`  세이브 크기(글자): 평균 ${Math.round(avg).toLocaleString()}, 중앙 ${sizes[sizes.length >> 1]?.toLocaleString()}, 최대 ${sizes.at(-1)?.toLocaleString()} (localStorage 는 보통 약 500만 자)`);
  console.log(`  처리 시간: 저장(검증+직렬화) 평균 ${(serializeMs / Math.max(1, sizes.length)).toFixed(2)}ms, 읽기(파싱+검증) 평균 ${(readMs / Math.max(1, sizes.length)).toFixed(2)}ms · ${((performance.now() - t0) / 1000).toFixed(1)}초`);
}

// ── 2. 구버전 ────────────────────────────────────────────────────────────────
if (run('old')) {
  console.log('\n━━ 2. 구버전 세이브 ━━');
  for (const version of [1, 2, 3, 4]) {
    const data = { version, seed: 'old', tick: 100, phase: 'playing', run: { floor: 3, level: 2 }, world: null, entities: { nextId: 1, byId: {} }, playerId: null };
    const read = readRun(encodeEnvelope({ kind: 'run', version, data, savedAt: 1 }));
    const ok = read.status === 'none' && read.reason === 'retired-version' && resumeGame({ run: read, meta: null }) === null;
    if (!ok) report(`런 v${version}`, `읽기 결과 ${read.status} ${read.reason ?? ''}`);
    console.log(`  런 v${version}(방 단위 구조 이전): ${read.status} / ${read.reason} → ${ok ? '이어하지 않고 새 런' : '문제'}`);
  }
  const meta = { version: 1, souls: 137, unlocked: { vigor_1: true, satchel: true, constructor: true }, runs: 9, victories: 1, bestFloor: 30, totalKills: 412 };
  const read = readMeta(encodeEnvelope({ kind: 'meta', version: 1, data: meta, savedAt: 1 }));
  const expected = 137 + LEGACY_UNLOCK_COSTS.vigor_1 + LEGACY_UNLOCK_COSTS.satchel;
  if (!read.ok || read.meta.souls !== expected || read.meta.runs !== 9 || read.meta.totalKills !== 412) report('메타 v1', JSON.stringify(read).slice(0, 200));
  console.log(`  메타 v1: 영혼석 137 + 옛 해금 환불 ${expected - 137} = ${read.meta?.souls}, 기록(런 ${read.meta?.runs}·처치 ${read.meta?.totalKills}) 유지`);
}

/** 손상 케이스·무작위 손상에 쓸 바탕 세이브: 한 판의 여러 순간 가운데 방 전투 중인 것. */
function baseSaves(count) {
  const out = [];
  for (const [seed, mage] of [['verify-save-base-a', false], ['verify-save-base-b', true]]) {
    for (const { game, at } of stageGames({ seed, meta: mage ? MAGE : undefined, character: mage ? 'mage' : 'knight', every: 233, limit: 120 })) {
      // 전투 중이고 살아 있는 적이 있는 순간(웨이브 예고 중이라 적이 아직 없는 순간은 행동체 케이스가 망가뜨릴 대상이 없다).
      if (!game.state.encounter || !Object.values(game.state.entities.byId).some((a) => a.kind !== 'player' && !a.dead)) continue;
      const saved = serializeRun(game.state, 1);
      if (saved.ok) out.push({ label: `${mage ? '마법사' : '기사'} 틱 ${at}`, text: saved.text, data: JSON.parse(saved.text).data });
    }
  }
  // 고루 뽑는다.
  const step = Math.max(1, Math.floor(out.length / count));
  return out.filter((_, i) => i % step === 0).slice(0, count);
}

// ── 3. 손상 케이스 ───────────────────────────────────────────────────────────
if (run('cases')) {
  const bases = baseSaves(6);
  console.log(`\n━━ 3. 손상 케이스 ${CASES.length}가지 × 바탕 세이브 ${bases.length}개(전투 중: ${bases.map((b) => b.label).join(', ')}) ━━`);
  const byGroup = {};
  const outcomes = { none: 0, salvage: 0, finished: 0, exact: 0 };
  for (const c of CASES) {
    const group = groupOf(c);
    byGroup[group] ??= { cases: 0, ok: 0 };
    byGroup[group].cases++;
    let allOk = true;
    for (const base of bases) {
      const label = `${c.id}@${base.label}`;
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
  const names = { text: '글 자체', env: '봉투', core: '시드·층', prog: '진행도', kit: '무기·에너지', world: '맵·방·문', actor: '행동체', floor: '그 밖의 층 상태' };
  for (const [group, { cases, ok }] of Object.entries(byGroup)) console.log(`  ${names[group].padEnd(10)} ${String(cases).padStart(3)}가지: 기대대로 ${ok}가지`);
  console.log(`  결과 분포(케이스×바탕 ${CASES.length * bases.length}건): 새 런 ${outcomes.none} / 핵심만 건져 층을 다시 만듦 ${outcomes.salvage} / 끝난 런 ${outcomes.finished}`);
  console.log(`  원형 오염: ${{}.polluted === undefined ? '없음' : '있음'}`);
  if ({}.polluted !== undefined) report('cases', 'Object.prototype 이 오염됨');
}

// ── 4. 무작위 손상 ───────────────────────────────────────────────────────────
if (run('fuzz')) {
  const bases = baseSaves(10);
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
      text = encodeEnvelope({ kind: 'run', version: STATE_VERSION, data, savedAt: 1 });
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
  console.log('  "그대로 이어함"은 바뀐 값이 여전히 허용 범위 안이라(수치, 좌표, 목록에서 항목 하나 삭제 등) 정상 세이브와 구별할 수 없는 경우다.');
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
      // 플레이: 사이사이 층 다시 들어가기·일시정지·백그라운드 전환.
      for (let step = rng.int(1, 6); step > 0; step--) {
        play(game, rng, rng.int(20, 200));
        autosave.flush();
        if (game.state.run.ended) break;
        const action = rng.int(0, 5);
        if (action === 0 && rng.chance(0.3)) enterFloor(game, game.state.run.floor);
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
