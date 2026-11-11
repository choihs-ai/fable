// 누수 검증: 층을 100번 옮기며 GPU 자원(renderer.info 의 geometries·textures·programs), 씬의 객체 수, 풀 크기,
// DOM 노드 수, JS 힙(가비지 컬렉션 뒤)을 기록한다. 층을 옮길 때마다 늘어나는 것이 있으면 누수다.
//
//   node scripts/browser/verify-leaks.mjs --three <three 패키지 폴더> [--moves 100] [--quality high]
//
// 층마다: 적 넷을 플레이어 곁으로 불러 깨우고, 키보드로 돌아다니며 공격·기술을 써서 투사체·장판·피해 숫자·입자 풀이 실제로 돌게 한 뒤 다음 층으로 간다.
//
// 판정
//   - 풀(행동체 뷰, 투사체·원·전리품·피해 숫자)은 필요할 때 만들어 상한까지만 는다. 그래서 30층을 한 바퀴 도는 동안은
//     "그때까지 가장 붐볐던 순간"만큼 늘어나는 것이 정상이다. 상한을 넘지 않는지만 본다.
//   - 한 바퀴를 다 돈 뒤(30회 이후)를 앞·뒤 두 구간으로 나눠, GPU 자원·씬 객체 수·DOM 노드가 뒤 구간에서 더 늘지 않아야 한다.
//   - 힙은 출렁이므로 평균으로 본다.

import { frames, heapUsed, launch, option, startServer } from './lib.mjs';

const MOVES = Number(option('moves', 100));
const QUALITY = option('quality', 'high');
const server = await startServer();
const { browser, open } = await launch();
let failed = 0;
try {
  const t = await open({ viewport: { width: 900, height: 600 } }, `${server.base}?debug=1&seed=leak-check`);
  const { page, cdp } = t;
  await page.getByText('새 게임').click();
  await page.evaluate((q) => window.__fable.renderer.setQuality(q), QUALITY);
  await frames(page, 30);

  const sample = () => page.evaluate(() => {
    const f = window.__fable;
    const info = f.renderer.info();
    const fx = info.effects;
    return {
      floor: f.game().state.run.floor,
      geometries: info.geometries,
      textures: info.textures,
      programs: info.programs,
      scene: info.sceneChildren,
      actorViews: info.actors.created,
      pooled: fx.projectiles.created + fx.rings.created + fx.drops.created + fx.numbers.created,
      pools: { actors: info.actors, projectiles: fx.projectiles, rings: fx.rings, drops: fx.drops, numbers: fx.numbers },
      dom: document.getElementsByTagName('*').length,
      voices: f.audio.status().voices,
      floorsBuilt: info.floorsBuilt,
    };
  });

  const rows = [];
  for (let move = 0; move <= MOVES; move++) {
    if (move > 0) {
      // 다음 층으로(30층 다음은 1층). 죽었으면 되살려 계속한다 — 여기서 보는 것은 자원이지 전투가 아니다.
      await page.evaluate(() => {
        const f = window.__fable;
        const { state } = f.game();
        const player = state.entities.byId[state.playerId];
        player.hp = player.maxHp;
        f.enterFloor((state.run.floor % 30) + 1);
      });
      // 적 넷을 플레이어 곁의 빈자리로 불러 깨운다(로직의 자리 찾기를 그대로 쓴다).
      await page.evaluate(async () => {
        const { findFreeSpot } = await import('./src/logic/entities/actors.js');
        const { state } = window.__fable.game();
        const player = state.entities.byId[state.playerId];
        let moved = 0;
        for (const actor of Object.values(state.entities.byId)) {
          if (!actor.ai || moved >= 4) continue;
          const spot = findFreeSpot(state, player.x, player.y, actor.radius, 3);
          if (!spot) continue;
          actor.x = spot.x;
          actor.y = spot.y;
          actor.ai.homeX = spot.x;
          actor.ai.homeY = spot.y;
          actor.ai.provoked = true;
          moved++;
        }
      });
    }
    // 돌아다니며 싸운다.
    for (const [key, ms] of [['KeyD', 350], ['KeyS', 350], ['KeyA', 350], ['KeyW', 350]]) {
      await page.keyboard.down(key);
      await page.keyboard.down('Space');
      await page.keyboard.press(['Digit1', 'Digit2', 'Digit3'][move % 3]);
      await page.waitForTimeout(ms);
      await page.keyboard.up(key);
    }
    await page.keyboard.up('Space');
    await page.evaluate(() => {
      // 화면이 열렸으면(레벨 업 등) 닫고, 죽지 않게 체력을 채운다.
      const f = window.__fable;
      const { state } = f.game();
      if (state.run.choice) document.querySelector('.card.choice')?.click();
      const player = state.entities.byId[state.playerId];
      if (player && !player.dead) player.hp = player.maxHp;
    });
    await frames(page, 4);
    const row = await sample();
    row.move = move;
    row.heapMB = +((await heapUsed(cdp)) / 1048576).toFixed(2);
    rows.push(row);
  }

  const cols = ['move', 'floor', 'geometries', 'textures', 'programs', 'scene', 'actorViews', 'pooled', 'dom', 'voices', 'heapMB'];
  if (option('json')) (await import('node:fs')).writeFileSync(option('json'), JSON.stringify(rows.map(({ pools, ...r }) => r)));
  console.log(`품질 ${QUALITY}, 층 이동 ${MOVES}회 (10회마다 표시)`);
  console.log(cols.map((c) => c.padStart(11)).join(''));
  for (const row of rows) {
    if (row.move % 10 === 0) console.log(cols.map((c) => String(row[c]).padStart(11)).join(''));
  }

  // 씬에서 풀이 아닌 것: 조명, 입자, 그 층의 바닥·벽·표식.
  for (const row of rows) row.sceneOther = row.scene - row.actorViews - row.pooled;
  const WARM = Math.min(30, MOVES >> 1);
  const steady = rows.filter((r) => r.move > WARM);
  const half = steady.length >> 1;
  const max = (list, key) => Math.max(...list.map((r) => r[key]));
  const avg = (list, key) => list.reduce((a, r) => a + r[key], 0) / list.length;
  console.log(`\n판정 (한 바퀴 돈 뒤인 ${WARM + 1}회부터, 앞 구간 → 뒤 구간의 최댓값)`);
  for (const key of ['geometries', 'textures', 'programs', 'sceneOther', 'dom']) {
    const a = max(steady.slice(0, half), key);
    const b = max(steady.slice(half), key);
    const ok = b <= a;
    if (!ok) failed++;
    console.log(`  ${ok ? '✔' : '✖'} ${key.padEnd(11)} ${a} → ${b}${ok ? '' : '  ← 늘어남'}   (처음 ${rows[0][key]}, 한 바퀴 뒤 ${rows[WARM][key]})`);
  }
  console.log('  풀: 만든 수 / 상한 (한 바퀴 뒤 → 끝)');
  for (const name of Object.keys(rows.at(-1).pools)) {
    const end = rows.at(-1).pools[name];
    const ok = end.created <= end.max;
    if (!ok) failed++;
    console.log(`  ${ok ? '✔' : '✖'} ${name.padEnd(11)} ${rows[WARM].pools[name].created} → ${end.created} / ${end.max}`);
  }
  // 힙: 뒤 구간의 평균이 앞 구간보다 10% 넘게 크면 누수로 본다.
  const h1 = avg(steady.slice(0, half), 'heapMB');
  const h2 = avg(steady.slice(half), 'heapMB');
  const heapOk = h2 <= h1 * 1.1;
  if (!heapOk) failed++;
  console.log(`  ${heapOk ? '✔' : '✖'} heapMB      평균 ${h1.toFixed(2)} → ${h2.toFixed(2)} (${((h2 / h1 - 1) * 100).toFixed(1)}%), 처음 ${rows[0].heapMB}, 최소 ${Math.min(...steady.map((r) => r.heapMB))}, 최대 ${max(steady, 'heapMB')}`);
  const built = rows.at(-1).floorsBuilt;
  console.log(`  만든 층 뷰 ${built}개 (층 이동 ${MOVES}회 + 처음 1개)`);
  if (built !== MOVES + 1) failed++;
  if (t.problems.length > 0) {
    failed++;
    console.log('  ✖ 페이지 오류:', t.problems.slice(0, 5));
  } else console.log('  ✔ 페이지 오류·console.error 없음');
} finally {
  await browser.close();
  server.stop();
}
console.log(failed === 0 ? '\n누수 없음' : `\n문제 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);
