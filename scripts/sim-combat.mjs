#!/usr/bin/env node
// 헤드리스 전투 시뮬레이션. 적·보스마다 기준 스탯 플레이어와의 1:1 대결을 수천 번 돌려 AI 문제를 찾는다.
//
//   node scripts/sim-combat.mjs                 종류마다 2000회 (적 20종 + 보스 4종)
//   node scripts/sim-combat.mjs --fights 200    종류마다 횟수 지정
//   node scripts/sim-combat.mjs --only bat,abyss_lord
//   node scripts/sim-combat.mjs --workers 2
//   node scripts/sim-combat.mjs --one bat passive 17    대결 하나를 다시 돌려 문제를 출력 (시드 = "<종류>-<방식>-<번호>")
//
// 대결 방식(횟수 비율): 적 — fight 50% / wander 20% / passive 15% / kite 15%,  보스 — fight 35% / tanky 35% / wander 10% / passive 20%
// 검사(매 틱): 벽 속·벽 겹침, 끼임(움직이려는데 제자리), 멈춤(전투 중 무행동), 시간 초과, 예외, NaN,
//   상태이상 중첩·만료·면역 위반, 연속 행동 불가, 보스 페이즈 누락·건너뜀·이벤트 불일치, 리쉬 복귀 실패, 재현성.
// 문제가 하나라도 있으면 종료 코드 1.

import { availableParallelism } from 'node:os';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

import { MODES, allTypes, runDuel } from './lib/combat-sim.js';

const TICK_RATE = 60;
const ENEMY_MIX = [[MODES.FIGHT, 0.5], [MODES.WANDER, 0.2], [MODES.PASSIVE, 0.15], [MODES.KITE, 0.15]];
const BOSS_MIX = [[MODES.FIGHT, 0.35], [MODES.TANKY, 0.35], [MODES.WANDER, 0.1], [MODES.PASSIVE, 0.2]];
/** 이만큼마다 한 번은 같은 대결을 다시 돌려 결과가 같은지 본다. */
const REPLAY_EVERY = 25;

function plan(types, fights) {
  const { bosses } = allTypes();
  const jobs = [];
  for (const type of types) {
    const mix = bosses.includes(type) ? BOSS_MIX : ENEMY_MIX;
    let given = 0;
    mix.forEach(([mode, share], i) => {
      const count = i === mix.length - 1 ? fights - given : Math.round(fights * share);
      given += count;
      for (let n = 0; n < count; n++) jobs.push({ type, mode, n });
    });
  }
  return jobs;
}

function runJobs(jobs) {
  const out = {};
  for (const job of jobs) {
    const seed = `${job.type}-${job.mode}-${job.n}`;
    parentPort?.postMessage({ progress: seed });
    const replay = job.n % REPLAY_EVERY === 0;
    const r = runDuel({ seed, type: job.type, mode: job.mode, digest: replay });
    if (replay) {
      const again = runDuel({ seed, type: job.type, mode: job.mode, digest: true });
      if (again.digest !== r.digest || again.ticks !== r.ticks || again.outcome !== r.outcome) {
        r.issues.push({ code: 'nondeterministic', detail: '같은 시드로 다시 돌린 결과가 다름', tick: r.ticks });
      }
    }
    const key = `${job.type}|${job.mode}`;
    const g = (out[key] ??= { fights: 0, replays: 0, outcomes: {}, ticks: 0, maxTicks: 0, hpSum: 0, wins: 0, phases: {}, issues: {}, examples: {}, statuses: {} });
    g.fights++;
    if (replay) g.replays++;
    g.outcomes[r.outcome] = (g.outcomes[r.outcome] ?? 0) + 1;
    g.ticks += r.ticks;
    g.maxTicks = Math.max(g.maxTicks, r.ticks);
    if (r.outcome === 'enemyDead') {
      g.wins++;
      g.hpSum += r.playerHp;
    }
    g.phases[r.phases] = (g.phases[r.phases] ?? 0) + 1;
    for (const [id, count] of Object.entries(r.stats.statusApplied ?? {})) g.statuses[id] = (g.statuses[id] ?? 0) + count;
    for (const issue of r.issues) {
      g.issues[issue.code] = (g.issues[issue.code] ?? 0) + 1;
      const list = (g.examples[issue.code] ??= []);
      if (list.length < 3) list.push({ seed, tick: issue.tick, detail: String(issue.detail).slice(0, 300) });
    }
  }
  return out;
}

function merge(parts) {
  const total = {};
  for (const part of parts) {
    for (const [key, g] of Object.entries(part)) {
      const t = (total[key] ??= { fights: 0, replays: 0, outcomes: {}, ticks: 0, maxTicks: 0, hpSum: 0, wins: 0, phases: {}, issues: {}, examples: {}, statuses: {} });
      t.fights += g.fights;
      t.replays += g.replays;
      t.ticks += g.ticks;
      t.maxTicks = Math.max(t.maxTicks, g.maxTicks);
      t.hpSum += g.hpSum;
      t.wins += g.wins;
      for (const field of ['outcomes', 'phases', 'issues', 'statuses']) {
        for (const [k, v] of Object.entries(g[field])) t[field][k] = (t[field][k] ?? 0) + v;
      }
      for (const [code, list] of Object.entries(g.examples)) {
        const dest = (t.examples[code] ??= []);
        for (const ex of list) if (dest.length < 3) dest.push(ex);
      }
    }
  }
  return total;
}

function report(total, types, { fights, workers, wallMs, hangs }) {
  const { bosses } = allTypes();
  const pct = (n, d) => (d === 0 ? '   -' : `${((n / d) * 100).toFixed(0).padStart(3)}%`);
  const sec = (ticks) => (ticks / TICK_RATE).toFixed(1);
  let allFights = 0;
  let allTicks = 0;
  let allReplays = 0;
  let issueCount = 0;
  const statusTotals = {};

  console.log(`\n전투 시뮬레이션: ${types.length}종 × ${fights}회, 워커 ${workers}개, ${(wallMs / 1000).toFixed(1)}초\n`);
  console.log('종류           방식     횟수   플레이어승  적승   리쉬  시간초과  평균(초)  최장(초)  승리 시 남은 체력  문제');
  for (const type of types) {
    for (const mode of Object.values(MODES)) {
      const g = total[`${type}|${mode}`];
      if (!g) continue;
      allFights += g.fights;
      allTicks += g.ticks;
      allReplays += g.replays;
      for (const [id, n] of Object.entries(g.statuses)) statusTotals[id] = (statusTotals[id] ?? 0) + n;
      const issues = Object.entries(g.issues).map(([code, n]) => `${code}×${n}`).join(' ');
      issueCount += Object.values(g.issues).reduce((a, b) => a + b, 0);
      console.log(
        `${type.padEnd(14)} ${mode.padEnd(8)} ${String(g.fights).padStart(4)}   ${pct(g.wins, g.fights)}       ${pct(g.outcomes.playerDead ?? 0, g.fights)}  ${pct(g.outcomes.leashed ?? 0, g.fights)}  ${pct(g.outcomes.timeout ?? 0, g.fights)}      ` +
          `${sec(g.ticks / g.fights).padStart(6)}    ${sec(g.maxTicks).padStart(6)}    ${g.wins ? pct(g.hpSum, g.wins) : '   -'}               ${issues || '-'}`,
      );
    }
  }

  console.log('\n보스 페이즈 전환(대결별 BOSS_PHASE_CHANGED 횟수 분포)');
  for (const type of types.filter((t) => bosses.includes(t))) {
    for (const mode of Object.values(MODES)) {
      const g = total[`${type}|${mode}`];
      if (!g) continue;
      const dist = Object.keys(g.phases).sort().map((k) => `${k}회 ${g.phases[k]}`).join(', ');
      console.log(`  ${type.padEnd(14)} ${mode.padEnd(8)} ${dist}  (플레이어 승 ${g.wins})`);
    }
  }

  console.log(`\n상태이상 적용 횟수: ${Object.entries(statusTotals).map(([id, n]) => `${id} ${n}`).join(', ') || '없음'}`);
  console.log(`전체: 대결 ${allFights}회, ${allTicks}틱(게임 시간 ${(allTicks / TICK_RATE / 3600).toFixed(1)}시간), 재현성 재실행 ${allReplays}회`);

  console.log(`\n문제: ${issueCount + hangs.length}건`);
  for (const hang of hangs) console.log(`  [무한 루프 의심] 대결 "${hang}" 에서 20초 넘게 응답 없음`);
  const byCode = {};
  for (const [key, g] of Object.entries(total)) {
    for (const [code, n] of Object.entries(g.issues)) {
      const c = (byCode[code] ??= { n: 0, where: [], examples: [] });
      c.n += n;
      c.where.push(`${key.replace('|', '/')}×${n}`);
      for (const ex of g.examples[code]) if (c.examples.length < 4) c.examples.push(ex);
    }
  }
  for (const [code, c] of Object.entries(byCode).sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${code}: ${c.n}건 — ${c.where.join(', ')}`);
    for (const ex of c.examples) console.log(`      시드 "${ex.seed}" ${ex.tick}틱: ${ex.detail}`);
  }
  return issueCount + hangs.length;
}

function option(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

if (!isMainThread) {
  parentPort.postMessage({ result: runJobs(workerData) });
} else if (process.argv.includes('--one')) {
  const i = process.argv.indexOf('--one');
  const [type, mode, n] = process.argv.slice(i + 1, i + 4);
  const r = runDuel({ seed: `${type}-${mode}-${n}`, type, mode, digest: true });
  console.log(JSON.stringify({ outcome: r.outcome, ticks: r.ticks, playerHp: r.playerHp, phases: r.phases, issues: r.issues, digest: r.digest }, null, 2));
  process.exit(r.issues.length > 0 ? 1 : 0);
} else {
  const { enemies, bosses } = allTypes();
  const only = option('only', '');
  const types = only ? only.split(',') : [...enemies, ...bosses];
  const fights = Number(option('fights', '2000'));
  const workers = Math.max(1, Math.min(Number(option('workers', String(Math.min(availableParallelism(), 8)))), 16));
  const jobs = plan(types, fights);
  // 오래 걸리는 종류가 한 워커에 몰리지 않도록 번갈아 나눈다.
  const slices = Array.from({ length: workers }, () => []);
  jobs.forEach((job, i) => slices[i % workers].push(job));

  const started = performance.now();
  const hangs = [];
  const results = await Promise.all(
    slices.map(
      (slice) =>
        new Promise((resolve, reject) => {
          const worker = new Worker(fileURLToPath(import.meta.url), { workerData: slice });
          let current = '';
          let lastBeat = performance.now();
          // 한 대결이 20초 넘게 끝나지 않으면 무한 루프로 보고 워커를 끊는다.
          const watchdog = setInterval(() => {
            if (performance.now() - lastBeat > 20_000) {
              clearInterval(watchdog);
              hangs.push(current);
              worker.terminate();
              resolve({});
            }
          }, 1000);
          worker.on('message', (msg) => {
            lastBeat = performance.now();
            if (msg.progress) current = msg.progress;
            if (msg.result) {
              clearInterval(watchdog);
              resolve(msg.result);
            }
          });
          worker.once('error', (err) => {
            clearInterval(watchdog);
            reject(err);
          });
        }),
    ),
  );
  const problems = report(merge(results), types, { fights, workers, wallMs: performance.now() - started, hangs });
  process.exit(problems > 0 ? 1 : 0);
}
