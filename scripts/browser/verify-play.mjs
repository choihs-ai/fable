// 한 판 검증: 실제 브라우저에서 타이틀 → 캐릭터 → 봇이 한 판을 끝까지 → 결과 → 거점(영구 강화 구매) → 바로 다시 하기 → 저장하고 타이틀 → 이어하기.
// 그동안 화면이 제대로 그려지는지를 본다(버그 2: 맵이 조각조각 생기거나 깜빡이지 않는가).
//
//   node scripts/browser/verify-play.mjs --three <three 패키지 폴더> [--out <화면 갈무리 폴더>] [--character mage] [--seed play-check]
//
// 확인하는 것
//   - 층에 들어갈 때: 화면이 검게 가려진 상태에서 맵 메시를 만들고 셰이더를 미리 컴파일한다(첫 프레임에 veil = 1, compile 1회).
//     페이드가 걷힌 뒤로는 판이 끝날 때까지 셰이더(프로그램)가 하나도 새로 생기지 않는다 — 플레이 중 처음 보는 머티리얼 때문에 멈칫하지 않는다.
//   - 방 공개: 구역의 밝기가 0 → 1 로 여러 프레임에 걸쳐 바뀌고(끊기지 않음), 0.3초 남짓에 끝난다.
//   - 벽 낮추기: 한 프레임에 벽 높이가 크게 튀지 않는다(보간).
//   - 화면 흐름 전체가 오류 없이 돈다.
// 봇의 조작은 페이지 안에서 로직 모듈(scripts/lib/bot.js)을 불러 main.js 의 디버그 자동 조작 자리에 꽂는다. 메뉴는 실제 클릭이다.

import { frames, launch, option, startServer } from './lib.mjs';

const OUT = option('out');
const CHARACTER = option('character', 'knight');
const SEED = option('seed', 'play-check');
const server = await startServer();
const { browser, devices, open } = await launch();
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✖'} ${name}${detail !== '' ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}

try {
  const { page, problems } = await open({ ...devices['Pixel 7'] }, `${server.base}?debug=1&seed=${SEED}`);
  const shot = async (name) => {
    if (OUT) await page.screenshot({ path: `${OUT}/${name}.png` });
  };
  const click = (selector) => page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`없음: ${sel}`);
    el.click();
  }, selector);
  const snap = () => page.evaluate(() => {
    const f = window.__fable;
    const { state } = f.game();
    return { phase: state.phase, screen: f.ui.screens.current, tick: state.tick, run: state.run, souls: state.meta.souls, upgrades: state.meta.upgrades, info: f.renderer.info() };
  });

  // ── 타이틀 ──
  await frames(page, 6);
  let s = await snap();
  check('타이틀: 처음에는 타이틀 화면이고 이어할 판이 없다', s.screen === 'title' && (await page.$('[data-action="continue"]')) === null);
  await shot('play-01-title');
  await click('[data-action="new"]');
  await frames(page, 3);
  s = await snap();
  check('새 게임 → 캐릭터 고르기', s.screen === 'characters');
  await shot('play-02-characters');
  if (CHARACTER !== 'knight') {
    await page.evaluate(() => {
      window.__fable.game().state.meta.souls += 500;
    });
    await click(`[data-action="unlock-${CHARACTER}"]`);
  }

  // ── 층 진입: 화면 가림과 미리 컴파일 ──
  // 첫 프레임부터 기록한다(페이지 안에서 매 프레임 표본을 모은다).
  await page.evaluate(() => {
    window.__trace = [];
    const f = window.__fable;
    const sample = () => {
      const info = f.renderer.info();
      window.__trace.push({ veil: info.veil, programs: info.programs, compile: info.compile.count, tick: f.game().state.tick });
      if (window.__trace.length < 90) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await click(`[data-action="start-${CHARACTER}"]`);
  await frames(page, 100);
  const trace = await page.evaluate(() => window.__trace);
  const firstWorld = trace.findIndex((t) => t.compile >= 1);
  const revealedAt = trace.findIndex((t) => t.veil === 0);
  check('층 진입: 맵을 만들고 셰이더를 미리 컴파일하는 동안 화면이 완전히 가려져 있다',
    firstWorld >= 0 && trace[firstWorld].veil === 1 && trace[firstWorld + 1].veil === 1, trace.slice(Math.max(0, firstWorld - 1), firstWorld + 4));
  check('층 진입: 그 뒤 페이드가 걷힌다(0.35초 남짓)', revealedAt > firstWorld && revealedAt - firstWorld < 40, { frames: revealedAt - firstWorld });
  s = await snap();
  const programsAtReveal = s.info.programs;
  check('층 진입: 컴파일은 한 번, 시작 방이 드러나 있다', s.info.compile.count === 1 && s.info.floor.regions.seen >= 1, { compile: s.info.compile, regions: s.info.floor.regions });
  check('문 위에 다음 방의 보상 아이콘이 보인다', s.info.icons.length >= 1, s.info.icons);
  await shot('play-03-start');

  // ── 봇으로 한 판 ──
  await page.evaluate(async () => {
    const { botStep, createBot } = await import('/scripts/lib/bot.js');
    const f = window.__fable;
    const bot = createBot();
    f.setAutopilot((g) => botStep(g, bot));
    window.__seen = { screens: {}, maxPrograms: 0, programsGrew: [], fadeMax: 0, regionSteps: [], boons: 0, shops: 0 };
    // 메뉴는 실제 클릭으로 처리한다.
    window.__menus = setInterval(() => {
      const scr = f.ui.screens.current;
      if (scr) window.__seen.screens[scr] = (window.__seen.screens[scr] ?? 0) + 1;
      if (scr === 'boon') {
        window.__seen.boons++;
        document.querySelector('[data-boon]').click();
      } else if (scr === 'shop') {
        window.__seen.shops++;
        document.querySelector('[data-action="back"]').click();
      }
    }, 250);
    // 매 프레임: 프로그램 수, 구역 밝기의 변화.
    let lastPrograms = f.renderer.info().programs;
    let lastNames = f.renderer.info().programNames;
    const brightness = [];
    const loop = () => {
      const info = f.renderer.info();
      if (info.programs > lastPrograms) {
        const added = info.programNames.filter((n) => !lastNames.includes(n));
        // 새 프로그램이 무엇인지: 가장 비슷한 기존 프로그램과 다른 매개변수만 적는다.
        const keys = info.programKeys;
        const diff = added.map((name) => {
          const key = keys[info.programNames.indexOf(name)].split(',');
          let best = null;
          for (let k = 0; k < keys.length; k++) {
            if (info.programNames[k] === name) continue;
            const other = keys[k].split(',');
            const d = key.map((v, i) => (v === other[i] ? null : `${i}:${other[i]}→${v}`)).filter(Boolean);
            if (!best || d.length < best.length) best = d;
          }
          return { head: key.slice(0, 3).join(','), diff: best };
        });
        const st = f.game().state;
        window.__seen.programsGrew.push({ tick: st.tick, from: lastPrograms, to: info.programs, added, diff,
          encounter: st.encounter ? st.encounter.room : null, actors: Object.keys(st.entities.byId).length, drops: st.drops.length, phase: st.phase,
          projectiles: st.projectiles.length, hazards: st.hazards.length, effects: info.effects });
      }
      lastPrograms = info.programs;
      lastNames = info.programNames;
      const world = f.game().state.world;
      if (world) {
        const n = world.rooms.length + world.links.length;
        for (let r = 0; r < n; r++) {
          const b = f.renderer.regionBrightness(r);
          const prev = brightness[r] ?? b;
          if (b !== prev) window.__seen.regionSteps.push(b - prev);
          brightness[r] = b;
        }
      }
      if (f.game().state.phase !== 'gameOver' && f.game().state.phase !== 'victory') requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  const shots = [5, 30, 60, 90, 120];
  let elapsed = 0;
  for (let i = 0; i < 300; i++) {
    await page.waitForTimeout(2000);
    elapsed += 2;
    if (shots.includes(elapsed)) await shot(`play-04-t${elapsed}`);
    const done = await page.evaluate(() => ['gameOver', 'victory'].includes(window.__fable.game().state.phase));
    if (done) break;
  }
  await frames(page, 10);
  s = await snap();
  const seen = await page.evaluate(() => window.__seen);
  check('한 판이 끝까지 돈다(승리 또는 사망)', ['gameOver', 'victory'].includes(s.phase), { phase: s.phase, rooms: s.run.roomsCleared, kills: s.run.kills, sec: (s.tick / 60).toFixed(0) });
  check('결과 화면이 뜬다', s.screen === 'result');
  await shot('play-05-result');
  check('축복 3택1 화면을 실제로 거쳤다', seen.boons >= 1, seen.screens);
  const emptyMeshes = await page.evaluate(() => {
    const out = [];
    window.__fable.renderer.debugScene.traverse((o) => {
      if ((o.isMesh || o.isLine || o.isPoints) && !(o.geometry && o.geometry.attributes.position)) out.push(o.material ? o.material.type : '?');
    });
    return out;
  });
  check('씬에 빈 지오메트리(그려지지 않는 메시)가 없다', emptyMeshes.length === 0, emptyMeshes.slice(0, 5));
  check('플레이 중에 셰이더가 새로 컴파일되지 않았다(미리 컴파일이 다 덮었다)', seen.programsGrew.length === 0, { atReveal: programsAtReveal, grew: seen.programsGrew.slice(0, 5) });
  const steps = seen.regionSteps;
  const partial = steps.filter((d) => Math.abs(d) < 0.999).length;
  const jumps = steps.filter((d) => Math.abs(d) > 0.5).length;
  check('방 공개: 밝기가 한 번에 0 → 1 로 끊기지 않고 여러 프레임에 걸쳐 바뀐다', steps.length > 20 && partial === steps.length && jumps === 0, { changes: steps.length, partial, jumps });
  check('벽 낮추기: 칸을 넘어도 한 프레임에 목표 높이로 튀지 않는다(여러 프레임에 걸쳐 보간)',
    s.info.floor !== null && s.info.floor.maxWallFraction > 0 && s.info.floor.maxWallFraction < 0.9, { maxWallFraction: s.info.floor && s.info.floor.maxWallFraction, maxWallStep: s.info.floor && s.info.floor.maxWallStep });

  // ── 거점: 영구 강화 ──
  const soulsBefore = s.souls;
  await click('[data-action="hub"]');
  await frames(page, 3);
  s = await snap();
  check('결과 → 거점, 영혼석을 얻었다', s.screen === 'hub' && s.souls > 0, { souls: s.souls });
  const affordable = await page.evaluate(() => [...document.querySelectorAll('[data-action^="buy-"]')].filter((b) => !b.disabled).map((b) => b.dataset.action));
  if (affordable.length > 0) {
    await click(`[data-action="${affordable[0]}"]`);
    await frames(page, 2);
    s = await snap();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('fable:meta')).data.upgrades);
    check('거점: 영구 강화를 사면 영혼석이 줄고 곧바로 저장된다', s.souls < soulsBefore && Object.keys(stored).length >= 1, { souls: s.souls, stored });
  } else check('거점: 살 수 있는 강화가 있다', false, { souls: s.souls });
  await shot('play-06-hub');

  // ── 다시 하기 → 저장하고 타이틀 → 이어하기 ──
  await click('[data-action="back"]');
  await frames(page, 2);
  await click('[data-action="new"]');
  await frames(page, 2);
  await click('[data-action="start-knight"]');
  await frames(page, 30);
  await page.evaluate(async () => {
    const { botStep, createBot } = await import('/scripts/lib/bot.js');
    const bot = createBot();
    window.__fable.setAutopilot((g) => botStep(g, bot));
  });
  await page.waitForTimeout(6000);
  await page.evaluate(() => window.__fable.setAutopilot(null));
  await frames(page, 2);
  s = await snap();
  const before = { tick: s.tick, gold: s.run.gold, boons: s.run.boons.slice() };
  await page.evaluate(() => window.__fable.ui.screens.open('pause'));
  await frames(page, 2);
  await click('[data-action="title"]');
  await frames(page, 3);
  s = await snap();
  check('저장하고 타이틀로: 이어하기 버튼이 생긴다', s.screen === 'title' && (await page.$('[data-action="continue"]')) !== null);
  await page.reload();
  await page.waitForFunction(() => window.__fable !== undefined);
  await frames(page, 4);
  await click('[data-action="continue"]');
  await frames(page, 30);
  s = await snap();
  check('새로 고침 → 이어하기: 저장한 그 순간에서 이어진다', s.phase === 'playing' && s.tick >= before.tick && s.run.gold === before.gold && JSON.stringify(s.run.boons) === JSON.stringify(before.boons), { before, now: { tick: s.tick, gold: s.run.gold } });
  check('페이지 오류가 없다', problems.length === 0, problems.slice(0, 5));
} finally {
  await browser.close();
  server.stop();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length}개 가운데 실패 ${failed}개`);
process.exit(failed > 0 ? 1 : 0);
