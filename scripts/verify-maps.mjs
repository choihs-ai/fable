#!/usr/bin/env node
// 맵 생성 대량 검증. 시드 여러 개 × 전 층을 만들어 규칙 위반·고립 구역·재현성·생성 시간을 조사한다.
//
//   node scripts/verify-maps.mjs                      시드 5000개 × 전 층
//   node scripts/verify-maps.mjs --seeds 200          시드 수 지정
//   node scripts/verify-maps.mjs --from 5000          시드 번호 시작점 (시드 문자열은 "<prefix><번호>")
//   node scripts/verify-maps.mjs --prefix run-        시드 접두사 (기본 "sweep-")
//   node scripts/verify-maps.mjs --workers 1          워커 수 (기본: CPU 수, 최대 8)
//   node scripts/verify-maps.mjs --show sweep-12 7    한 층을 글자로 출력
//
// 검사 항목(맵마다):
//   1. 생성 중 예외가 없는가
//   2. validateFloor(로직의 검증기)를 통과하는가
//   3. 이 파일에 따로 구현한 독립 검사(도달 가능성·고립 구역·배치)를 통과하는가
//   4. 같은 시드로 다시 만들면(층 순서를 뒤집어서) 완전히 같은 결과가 나오는가
//   5. 비상 레이아웃(재시도 상한 초과)을 쓰지 않았는가
// 실패가 하나라도 있으면 종료 코드 1.

import { availableParallelism } from 'node:os';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

import { WORLD } from '../data/world.js';
import { ZONES } from '../data/zones.js';
import { Rng } from '../src/logic/core/prng.js';
import { toAscii } from '../src/logic/world/ascii.js';
import { TOTAL_FLOORS, floorPlan } from '../src/logic/world/floors.js';
import { generateFloor, generateFloorFromRng } from '../src/logic/world/generate.js';
import { validateFloor } from '../src/logic/world/validate.js';

// ── 독립 검사: validate.js·grid.js 를 쓰지 않고 따로 구현한다 ────────────────────

/** 스택 기반 채우기로 start 에서 닿는 칸까지의 걸음 수를 구한다(너비 우선, 자체 구현). */
function walk(map, blockedCells) {
  const { width: w, height: h, tiles } = map;
  const dist = new Array(w * h).fill(-1);
  let frontier = [map.start.y * w + map.start.x];
  dist[frontier[0]] = 0;
  let d = 0;
  while (frontier.length > 0) {
    d++;
    const next = [];
    for (const i of frontier) {
      const x = i % w;
      const y = (i - x) / w;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (tiles[n] !== 1 || dist[n] !== -1 || blockedCells.has(n)) continue;
        dist[n] = d;
        next.push(n);
      }
    }
    frontier = next;
  }
  return dist;
}

/** 바닥 구역 수(상하좌우 연결 기준). 1 이어야 고립 구역이 없는 것이다. */
function countRegions(map) {
  const { width: w, height: h, tiles } = map;
  const seen = new Uint8Array(w * h);
  let regions = 0;
  for (let s = 0; s < tiles.length; s++) {
    if (tiles[s] !== 1 || seen[s]) continue;
    regions++;
    const stack = [s];
    seen[s] = 1;
    while (stack.length > 0) {
      const i = stack.pop();
      const x = i % w;
      const y = (i - x) / w;
      if (x + 1 < w && tiles[i + 1] === 1 && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
      if (x > 0 && tiles[i - 1] === 1 && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
      if (y + 1 < h && tiles[i + w] === 1 && !seen[i + w]) { seen[i + w] = 1; stack.push(i + w); }
      if (y > 0 && tiles[i - w] === 1 && !seen[i - w]) { seen[i - w] = 1; stack.push(i - w); }
    }
  }
  return regions;
}

function independentCheck(map) {
  const problems = [];
  const { width: w, tiles } = map;
  const at = (p) => p.y * w + p.x;
  const plan = floorPlan(map.floor);
  const p = WORLD.placement;

  const features = new Set(map.eventRooms.map((r) => at(r.feature)));
  const dist = walk(map, features);

  // 도달 가능성
  if (plan.kind === 'finalBoss') {
    if (map.stairs !== null) problems.push('계단: 마지막 층에 계단이 있음');
  } else if (!map.stairs || tiles[at(map.stairs)] !== 1) {
    problems.push('계단: 없거나 벽 안');
  } else if (dist[at(map.stairs)] < 0) {
    problems.push('도달: 시작점에서 계단에 닿지 못함');
  }

  // 고립 구역
  const regions = countRegions(map);
  if (regions !== 1) problems.push(`고립: 바닥 구역이 ${regions}개`);
  let unreachable = 0;
  for (let i = 0; i < tiles.length; i++) if (tiles[i] === 1 && dist[i] < 0 && !features.has(i)) unreachable++;
  if (unreachable > 0) problems.push(`고립: 상인/제단을 피해서는 닿지 못하는 바닥 ${unreachable}칸`);

  // 배치
  const used = new Map();
  const claim = (i, what) => {
    if (used.has(i)) problems.push(`겹침: ${what} ↔ ${used.get(i)} @${i % w},${Math.floor(i / w)}`);
    used.set(i, what);
  };
  claim(at(map.start), '시작점');
  if (map.stairs) claim(at(map.stairs), '계단');
  const insideEvent = (pt) => map.eventRooms.some((r) => pt.x >= r.x && pt.x < r.x + r.w && pt.y >= r.y && pt.y < r.y + r.h);
  for (const room of map.eventRooms) {
    claim(at(room.feature), room.kind);
    if (insideEvent(map.start)) problems.push(`이벤트방: 시작점이 ${room.kind} 안에 있음`);
    if (map.stairs && insideEvent(map.stairs)) problems.push(`이벤트방: 계단이 ${room.kind} 안에 있음`);
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        const i = y * w + x;
        if (tiles[i] !== 1) problems.push(`이벤트방: ${room.kind} 안에 벽 @${x},${y}`);
        else if (!features.has(i) && dist[i] >= 0 && dist[i] < p.eventMinStartDist) {
          problems.push(`이벤트방: ${room.kind} 이 시작점에서 ${dist[i]}걸음`);
        }
      }
    }
  }
  for (let a = 0; a < map.eventRooms.length; a++) {
    for (let b = a + 1; b < map.eventRooms.length; b++) {
      const r = map.eventRooms[a];
      const o = map.eventRooms[b];
      if (r.x < o.x + o.w && o.x < r.x + r.w && r.y < o.y + o.h && o.y < r.y + r.h) problems.push('이벤트방: 서로 겹침');
    }
  }
  let bosses = 0;
  for (const s of map.spawns) {
    const i = at(s);
    if (s.x < 0 || s.y < 0 || s.x >= w || s.y >= map.height || tiles[i] !== 1) {
      problems.push(`배치: ${s.kind} 가 벽 안 또는 맵 밖 @${s.x},${s.y}`);
      continue;
    }
    claim(i, s.kind);
    if (dist[i] < 0) problems.push(`배치: ${s.kind} 에 닿지 못함 @${s.x},${s.y}`);
    if (insideEvent(s)) problems.push(`배치: ${s.kind} 가 이벤트방 안 @${s.x},${s.y}`);
    const min = s.kind === 'item' ? p.itemMinStartDist : p.enemyMinStartDist;
    if (dist[i] >= 0 && dist[i] < min) problems.push(`배치: ${s.kind} 가 시작점에서 ${dist[i]}걸음 @${s.x},${s.y}`);
    if (s.kind === 'boss') bosses++;
  }
  if ((plan.kind === 'normal') !== (bosses === 0)) problems.push(`보스: ${plan.kind} 층에 보스 ${bosses}마리`);
  if (plan.kind !== 'normal' && bosses !== 1) problems.push(`보스: 보스 ${bosses}마리`);

  return { problems, pathLength: map.stairs ? dist[at(map.stairs)] : -1 };
}

// ── 한 묶음 처리 ─────────────────────────────────────────────────────────────

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function emptyGroup() {
  return {
    maps: 0, times: [], attempts: {}, fallback: 0,
    openSum: 0, openMin: 1, openMax: 0,
    pathSum: 0, pathMin: Infinity, pathCount: 0,
    enemies: 0, items: 0, shops: 0, altars: 0,
    repaired: 0, tunnels: 0, filled: 0,
  };
}

function runSlice({ prefix, from, to }) {
  const out = { maps: 0, failures: [], failureCount: 0, groups: {}, zoneAlgo: {}, rejects: {}, digestXor: 0, digestSum: 0 };
  const addFailure = (seed, floor, check, detail) => {
    out.failureCount++;
    if (out.failures.length < 200) out.failures.push({ seed, floor, check, detail });
  };

  for (let n = from; n < to; n++) {
    const seed = `${prefix}${n}`;
    const worldRng = Rng.fromSeed(seed).fork('world');
    const first = new Array(TOTAL_FLOORS + 1);

    for (let floor = 1; floor <= TOTAL_FLOORS; floor++) {
      out.maps++;
      let map;
      const rejects = [];
      const t0 = performance.now();
      try {
        map = generateFloorFromRng(worldRng, floor, { onReject: (attempt, reasons) => rejects.push(reasons) });
      } catch (err) {
        addFailure(seed, floor, '예외', String(err?.message ?? err));
        continue;
      }
      const elapsed = performance.now() - t0;

      const json = JSON.stringify(map);
      first[floor] = json;
      const hash = fnv1a(json);
      out.digestXor = (out.digestXor ^ hash) >>> 0;
      out.digestSum = (out.digestSum + hash) >>> 0;

      const errors = validateFloor(JSON.parse(json));
      if (errors.length > 0) addFailure(seed, floor, '검증기', errors.join('; '));
      const { problems, pathLength } = independentCheck(map);
      if (problems.length > 0) addFailure(seed, floor, '독립 검사', problems.slice(0, 5).join('; '));
      if (map.gen.fallback) addFailure(seed, floor, '비상 레이아웃', rejects.map((r) => r[0]).join(' | '));

      for (const reasons of rejects) {
        for (const reason of reasons) {
          const code = `${map.algorithm === 'fallback' ? 'fallback' : map.algorithm}: ${reason.split(':')[0]}`;
          out.rejects[code] = (out.rejects[code] ?? 0) + 1;
        }
      }

      const g = (out.groups[map.algorithm] ??= emptyGroup());
      g.maps++;
      g.times.push(elapsed);
      g.attempts[map.gen.attempts] = (g.attempts[map.gen.attempts] ?? 0) + 1;
      if (map.gen.fallback) g.fallback++;
      if (map.gen.tunnels > 0 || map.gen.filled > 0) g.repaired++;
      g.tunnels += map.gen.tunnels;
      g.filled += map.gen.filled;
      let open = 0;
      for (let i = 0; i < map.tiles.length; i++) open += map.tiles[i];
      const ratio = open / map.tiles.length;
      g.openSum += ratio;
      g.openMin = Math.min(g.openMin, ratio);
      g.openMax = Math.max(g.openMax, ratio);
      if (pathLength >= 0) {
        g.pathSum += pathLength;
        g.pathCount++;
        g.pathMin = Math.min(g.pathMin, pathLength);
      }
      for (const s of map.spawns) {
        if (s.kind === 'enemy') g.enemies++;
        else if (s.kind === 'item') g.items++;
      }
      for (const r of map.eventRooms) {
        if (r.kind === 'shop') g.shops++;
        else g.altars++;
      }
      if (map.kind === 'normal') {
        const z = (out.zoneAlgo[map.zoneId] ??= {});
        z[map.algorithm] = (z[map.algorithm] ?? 0) + 1;
      }
    }

    // 재현성: 같은 시드를 층 순서를 뒤집어, 시드 문자열에서부터 다시 만든다.
    for (let floor = TOTAL_FLOORS; floor >= 1; floor--) {
      if (first[floor] === undefined) continue;
      let again;
      try {
        again = JSON.stringify(generateFloor({ seed, floor }));
      } catch (err) {
        addFailure(seed, floor, '재현성', `두 번째 생성에서 예외: ${err?.message ?? err}`);
        continue;
      }
      if (again !== first[floor]) addFailure(seed, floor, '재현성', '같은 시드·층인데 결과가 다름');
    }
  }
  return out;
}

// ── 합치기와 출력 ────────────────────────────────────────────────────────────

function merge(parts) {
  const total = { maps: 0, failures: [], failureCount: 0, groups: {}, zoneAlgo: {}, rejects: {}, digestXor: 0, digestSum: 0 };
  for (const part of parts) {
    total.maps += part.maps;
    total.failureCount += part.failureCount;
    total.failures.push(...part.failures);
    total.digestXor = (total.digestXor ^ part.digestXor) >>> 0;
    total.digestSum = (total.digestSum + part.digestSum) >>> 0;
    for (const [code, n] of Object.entries(part.rejects)) total.rejects[code] = (total.rejects[code] ?? 0) + n;
    for (const [zone, algos] of Object.entries(part.zoneAlgo)) {
      const z = (total.zoneAlgo[zone] ??= {});
      for (const [algo, n] of Object.entries(algos)) z[algo] = (z[algo] ?? 0) + n;
    }
    for (const [name, g] of Object.entries(part.groups)) {
      const t = (total.groups[name] ??= emptyGroup());
      t.maps += g.maps;
      t.times.push(...g.times);
      for (const [k, n] of Object.entries(g.attempts)) t.attempts[k] = (t.attempts[k] ?? 0) + n;
      t.fallback += g.fallback;
      t.openSum += g.openSum;
      t.openMin = Math.min(t.openMin, g.openMin);
      t.openMax = Math.max(t.openMax, g.openMax);
      t.pathSum += g.pathSum;
      t.pathCount += g.pathCount;
      t.pathMin = Math.min(t.pathMin, g.pathMin);
      t.enemies += g.enemies;
      t.items += g.items;
      t.shops += g.shops;
      t.altars += g.altars;
      t.repaired += g.repaired;
      t.tunnels += g.tunnels;
      t.filled += g.filled;
    }
  }
  return total;
}

const pct = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
const f = (n, digits = 3) => n.toFixed(digits);

function report(total, { seeds, prefix, from, workers, wallMs }) {
  console.log(`\n맵 생성 검증: 시드 ${seeds}개 ("${prefix}${from}" ~ "${prefix}${from + seeds - 1}") × ${TOTAL_FLOORS}층 = ${total.maps}개 맵`);
  console.log(`워커 ${workers}개, 전체 소요 ${f(wallMs / 1000, 1)}초\n`);

  console.log('알고리즘별 통계');
  console.log('  종류        맵 수    평균ms  p50ms   p95ms   p99ms   최대ms  바닥비율(평균/최소/최대)  계단까지(평균/최소)  적/층  아이템/층');
  const allTimes = [];
  for (const name of Object.keys(total.groups).sort()) {
    const g = total.groups[name];
    const t = g.times.slice().sort((a, b) => a - b);
    allTimes.push(...t);
    const avg = t.reduce((a, b) => a + b, 0) / t.length;
    const path = g.pathCount > 0 ? `${f(g.pathSum / g.pathCount, 1)}/${g.pathMin}` : '-';
    console.log(
      `  ${name.padEnd(10)} ${String(g.maps).padStart(7)}  ${f(avg).padStart(6)}  ${f(pct(t, 0.5)).padStart(6)}  ${f(pct(t, 0.95)).padStart(6)}  ${f(pct(t, 0.99)).padStart(6)}  ${f(t[t.length - 1]).padStart(6)}  ` +
        `${f(g.openSum / g.maps, 2)}/${f(g.openMin, 2)}/${f(g.openMax, 2)}`.padEnd(24) + `  ${path.padEnd(19)}  ${f(g.enemies / g.maps, 1).padStart(5)}  ${f(g.items / g.maps, 1).padStart(7)}`,
    );
  }
  allTimes.sort((a, b) => a - b);
  const allAvg = allTimes.reduce((a, b) => a + b, 0) / allTimes.length;
  console.log(`  ${'전체'.padEnd(8)} ${String(allTimes.length).padStart(7)}  ${f(allAvg).padStart(6)}  ${f(pct(allTimes, 0.5)).padStart(6)}  ${f(pct(allTimes, 0.95)).padStart(6)}  ${f(pct(allTimes, 0.99)).padStart(6)}  ${f(allTimes[allTimes.length - 1]).padStart(6)}`);

  console.log('\n구역별 알고리즘 비율(일반 층) — 실제 / 설정');
  for (const zone of ZONES) {
    const got = total.zoneAlgo[zone.id] ?? {};
    const sum = Object.values(got).reduce((a, b) => a + b, 0);
    const weightSum = Object.values(zone.algorithms).reduce((a, b) => a + b, 0);
    const parts = Object.keys(zone.algorithms).map(
      (algo) => `${algo} ${f(((got[algo] ?? 0) / sum) * 100, 1)}% / ${f((zone.algorithms[algo] / weightSum) * 100, 0)}%`,
    );
    const extra = got.fallback ? `, fallback ${got.fallback}` : '';
    console.log(`  ${zone.id.padEnd(8)} ${parts.join(',  ')}${extra}`);
  }

  console.log('\n시도 횟수 분포(재생성)');
  for (const name of Object.keys(total.groups).sort()) {
    const g = total.groups[name];
    const dist = Object.keys(g.attempts).sort((a, b) => a - b).map((k) => `${k}회 ${g.attempts[k]}`).join(', ');
    console.log(`  ${name.padEnd(10)} ${dist}${g.fallback ? `  (비상 레이아웃 ${g.fallback})` : ''}`);
  }

  console.log('\n연결 보정(생성 직후 떨어져 있던 바닥 구역을 잇거나 메운 층)');
  for (const name of Object.keys(total.groups).sort()) {
    const g = total.groups[name];
    console.log(`  ${name.padEnd(10)} 보정한 층 ${g.repaired} (${f((g.repaired / g.maps) * 100, 1)}%), 판 굴 ${g.tunnels}, 메운 구역 ${g.filled}`);
  }

  console.log('\n버려진 시도의 사유');
  const rejectCodes = Object.keys(total.rejects).sort((a, b) => total.rejects[b] - total.rejects[a]);
  if (rejectCodes.length === 0) console.log('  없음');
  for (const code of rejectCodes) console.log(`  ${String(total.rejects[code]).padStart(7)}  ${code}`);

  console.log('\n이벤트방(일반 층)');
  for (const name of ['rooms', 'cave']) {
    const g = total.groups[name];
    if (!g) continue;
    console.log(`  ${name.padEnd(6)} 상점 ${f((g.shops / g.maps) * 100, 1)}%  제단 ${f((g.altars / g.maps) * 100, 1)}%  (설정: 상점 ${WORLD.events.shop * 100}%, 제단 ${WORLD.events.altar * 100}%)`);
  }

  const hex = (n) => n.toString(16).padStart(8, '0');
  console.log(`\n결과 지문(같은 시드 범위면 실행마다 같아야 함): ${hex(total.digestXor)}-${hex(total.digestSum)}`);

  console.log(`\n실패: ${total.failureCount}건`);
  const byCheck = {};
  for (const fail of total.failures) byCheck[fail.check] = (byCheck[fail.check] ?? 0) + 1;
  for (const [check, n] of Object.entries(byCheck)) console.log(`  ${check}: ${n}건${total.failureCount > total.failures.length ? ' (수집된 범위 안에서)' : ''}`);
  for (const fail of total.failures.slice(0, 40)) {
    console.log(`  - 시드 "${fail.seed}" ${fail.floor}층 [${fail.check}] ${fail.detail}`);
  }
  if (total.failures.length > 40) console.log(`  … 외 ${total.failureCount - 40}건`);
}

// ── 진입점 ───────────────────────────────────────────────────────────────────

function option(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

if (!isMainThread) {
  parentPort.postMessage(runSlice(workerData));
} else if (process.argv.includes('--show')) {
  const i = process.argv.indexOf('--show');
  const seed = process.argv[i + 1];
  const floor = Number(process.argv[i + 2]);
  const map = generateFloor({ seed, floor });
  console.log(`시드 "${seed}" ${floor}층 — ${map.zoneId} / ${map.kind} / ${map.algorithm} / ${map.width}x${map.height} / 시도 ${map.gen.attempts}회${map.gen.fallback ? ' (비상)' : ''}`);
  console.log(toAscii(map));
  const errors = validateFloor(map);
  console.log(errors.length === 0 ? '검증 통과' : `검증 실패: ${errors.join('; ')}`);
} else {
  const seeds = Number(option('seeds', '5000'));
  const from = Number(option('from', '0'));
  const prefix = option('prefix', 'sweep-');
  const workers = Math.max(1, Math.min(Number(option('workers', String(Math.min(availableParallelism(), 8)))), seeds));
  if (!Number.isInteger(seeds) || seeds < 1 || !Number.isInteger(from) || from < 0) {
    console.error('사용법: node scripts/verify-maps.mjs [--seeds N] [--from K] [--prefix P] [--workers W]');
    process.exit(2);
  }

  const started = performance.now();
  const chunk = Math.ceil(seeds / workers);
  const jobs = [];
  for (let k = 0; k < workers; k++) {
    const a = from + k * chunk;
    const b = Math.min(from + seeds, a + chunk);
    if (a >= b) break;
    jobs.push(
      new Promise((resolve, reject) => {
        const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { prefix, from: a, to: b } });
        worker.once('message', resolve);
        worker.once('error', reject);
      }),
    );
  }
  const total = merge(await Promise.all(jobs));
  report(total, { seeds, prefix, from, workers: jobs.length, wallMs: performance.now() - started });
  process.exit(total.failureCount > 0 ? 1 : 0);
}
