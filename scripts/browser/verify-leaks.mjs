// 누수 검증: 층을 100번 옮기며 GPU 자원(renderer.info 의 geometries·textures·programs 와, WebGL 호출을 직접 세어 얻은
// 살아 있는 버퍼·텍스처·VAO 수), 씬의 객체 수, 풀 크기, DOM 노드 수, JS 힙(가비지 컬렉션 뒤)을 기록한다.
// 층을 옮길 때마다 늘어나는 것이 있으면 누수다.
//
//   node scripts/browser/verify-leaks.mjs --three <three 패키지 폴더> [--moves 100] [--quality high]
//
// 층마다: 적 넷을 플레이어 곁으로 불러 깨우고, 키보드로 돌아다니며 공격·기술을 써서 투사체·장판·피해 숫자·입자 풀이 실제로 돌게 하고,
// 계단과 이벤트방까지 가서 표식이 그려지게 한 뒤 다음 층으로 간다.
//
// 판정
//   - 풀(행동체 뷰, 투사체·원·전리품·피해 숫자)은 필요할 때 만들어 상한까지만 는다. 그래서 30층을 한 바퀴 도는 동안은
//     "그때까지 가장 붐볐던 순간"만큼 늘어나는 것이 정상이다. 상한을 넘지 않는지만 본다.
//   - 한 바퀴를 다 돈 뒤(30회 이후)를 앞·뒤 두 구간으로 나눠, GPU 자원·씬 객체 수·DOM 노드가 뒤 구간에서 더 늘지 않아야 한다.
//     텍스처는 풀(피해 숫자)의 몫을 뺀 수(texOther)로 본다.
//   - 힙은 출렁이므로 평균으로 본다.
//
// --heap-diff 를 주면 한 바퀴 뒤와 끝에서 힙 스냅샷을 떠서, 그 사이에 늘어난 객체를 종류별로 보여 준다(힙이 왜 느는지 볼 때).

import { frames, heapUsed, launch, option, startServer } from './lib.mjs';

const MOVES = Number(option('moves', 100));
const QUALITY = option('quality', 'high');
const server = await startServer();
const { browser, open } = await launch();
let failed = 0;
try {
  // WebGL 객체의 생성·삭제를 직접 센다. renderer.info 는 지오메트리·텍스처 수만 알려 주고,
  // 층마다 버려야 하는 InstancedMesh 의 인스턴스 버퍼는 세지 않는다.
  const countGl = () => {
    const live = { buffers: 0, textures: 0, vaos: 0, programs: 0 };
    window.__gl = live;
    const wrap = (proto, create, remove, key) => {
      const c = proto[create];
      const d = proto[remove];
      proto[create] = function created(...args) {
        live[key]++;
        return c.apply(this, args);
      };
      proto[remove] = function removed(obj) {
        if (obj) live[key]--;
        return d.call(this, obj);
      };
    };
    for (const proto of [WebGL2RenderingContext.prototype]) {
      wrap(proto, 'createBuffer', 'deleteBuffer', 'buffers');
      wrap(proto, 'createTexture', 'deleteTexture', 'textures');
      wrap(proto, 'createVertexArray', 'deleteVertexArray', 'vaos');
      wrap(proto, 'createProgram', 'deleteProgram', 'programs');
    }
  };
  const t = await open({ viewport: { width: 900, height: 600 } }, `${server.base}?debug=1&seed=leak-check`, { init: countGl });
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
      glBuffers: window.__gl.buffers,
      glTextures: window.__gl.textures,
      glVaos: window.__gl.vaos,
      phase: f.game().state.phase,
      tick: f.game().state.tick,
    };
  });

  /** 힙 스냅샷을 떠서 종류(생성자 이름)별 개수와 크기를 센다. */
  async function heapByType() {
    const chunks = [];
    const onChunk = ({ chunk }) => chunks.push(chunk);
    cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
    cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
    const snapshot = JSON.parse(chunks.join(''));
    const fields = snapshot.snapshot.meta.node_fields;
    const types = snapshot.snapshot.meta.node_types[0];
    const [iType, iName, iSize] = [fields.indexOf('type'), fields.indexOf('name'), fields.indexOf('self_size')];
    const out = new Map();
    for (let i = 0; i < snapshot.nodes.length; i += fields.length) {
      const type = types[snapshot.nodes[i + iType]];
      const name = type === 'object' || type === 'closure' ? snapshot.strings[snapshot.nodes[i + iName]] : `(${type})`;
      const entry = out.get(name) ?? { count: 0, size: 0 };
      entry.count++;
      entry.size += snapshot.nodes[i + iSize];
      out.set(name, entry);
    }
    return out;
  }
  const HEAP_DIFF = process.argv.includes('--heap-diff');
  let heapBefore = null;

  /** 화면이 열렸으면(레벨 업의 3택1 — 여러 번 이어질 수 있다) 닫는다. */
  async function closeScreens() {
    for (let i = 0; i < 12; i++) {
      const open = await page.evaluate(() => {
        const card = document.querySelector('.card.choice');
        if (card) card.click();
        return card !== null;
      });
      if (!open) return;
      await frames(page, 2);
    }
  }

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
        // 측정 중에 죽으면 런이 끝나 틱이 멈춘다. 오래 무적으로 둔다(여기서 보는 것은 자원이지 전투의 승패가 아니다).
        player.invulnUntil = state.tick + 100000;
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
    await closeScreens();
    await frames(page, 4);
    // 계단과 이벤트방(상점·제단)까지 가 본다: 표식은 탐험한 칸에서만 그려지고, 한 번도 그려지지 않은 자원은 GPU 에 올라가지 않아
    // 버리지 않아도 누수로 드러나지 않는다.
    const spots = await page.evaluate(() => {
      const { world } = window.__fable.game().state;
      const list = world.eventRooms.map((room) => ({ x: room.feature.x + 0.5, y: room.feature.y + 1.5 }));
      if (world.stairs) list.push({ x: world.stairs.x + 0.5, y: world.stairs.y + 0.5 });
      return list;
    });
    for (const spot of spots) {
      await page.evaluate(({ x, y }) => {
        const { state } = window.__fable.game();
        const player = state.entities.byId[state.playerId];
        const { width, tiles } = state.world;
        if (tiles[Math.floor(y) * width + Math.floor(x)] !== 1) return;
        player.x = x;
        player.y = y;
        player.hp = player.maxHp;
      }, spot);
      await frames(page, 4);
    }
    // 도는 사이에 레벨 업 화면이 떴을 수 있다. 닫고 몇 틱 흐른 뒤에 기록한다.
    await closeScreens();
    await frames(page, 3);
    const row = await sample();
    row.move = move;
    row.heapMB = +((await heapUsed(cdp)) / 1048576).toFixed(2);
    rows.push(row);
    if (HEAP_DIFF && move === Math.min(30, MOVES >> 1) + 1) heapBefore = await heapByType();
  }

  // 씬에서 풀이 아닌 것: 조명, 입자, 그 층의 바닥·벽·표식.
  for (const row of rows) row.sceneOther = row.scene - row.actorViews - row.pooled;
  // 피해 숫자는 스프라이트마다 캔버스 텍스처를 하나씩 갖고 풀에 남는다. 텍스처 수에서 풀의 몫을 빼야 층 자원만 남는다.
  for (const row of rows) {
    row.texOther = row.textures - row.pools.numbers.created;
    row.glTexOther = row.glTextures - row.pools.numbers.created;
  }
  const cols = ['move', 'floor', 'geometries', 'textures', 'texOther', 'programs', 'glBuffers', 'glTextures', 'glVaos', 'scene', 'actorViews', 'pooled', 'dom', 'heapMB'];
  if (option('json')) (await import('node:fs')).writeFileSync(option('json'), JSON.stringify(rows.map(({ pools, ...r }) => r)));
  console.log(`품질 ${QUALITY}, 층 이동 ${MOVES}회 (10회마다 표시)`);
  console.log(cols.map((c) => c.padStart(11)).join(''));
  for (const row of rows) {
    if (row.move % 10 === 0) console.log(cols.map((c) => String(row[c]).padStart(11)).join(''));
  }

  const WARM = Math.min(30, MOVES >> 1);
  const steady = rows.filter((r) => r.move > WARM);
  const half = steady.length >> 1;
  const max = (list, key) => Math.max(...list.map((r) => r[key]));
  const avg = (list, key) => list.reduce((a, r) => a + r[key], 0) / list.length;
  console.log(`\n판정 (한 바퀴 돈 뒤인 ${WARM + 1}회부터, 앞 구간 → 뒤 구간의 최댓값)`);
  for (const key of ['geometries', 'texOther', 'programs', 'glBuffers', 'glTexOther', 'glVaos', 'sceneOther', 'dom']) {
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
  // 측정이 실제로 플레이 중인 게임을 본 것인가: 매번 플레이 중이었고 틱이 흘렀어야 한다.
  let idle = 0;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].phase !== 'playing' || rows[i].tick <= rows[i - 1].tick) idle++;
  }
  if (idle > 0) failed++;
  console.log(`  ${idle === 0 ? '✔' : '✖'} 측정한 ${rows.length - 1}번 모두 플레이 중이었고 틱이 흘렀다${idle === 0 ? '' : ` — 아닌 경우 ${idle}번(그 층들은 제대로 측정되지 않았다)`}`);
  if (HEAP_DIFF && heapBefore) {
    const after = await heapByType();
    const growth = [];
    for (const [name, now] of after) {
      const was = heapBefore.get(name) ?? { count: 0, size: 0 };
      if (now.size - was.size > 0) growth.push({ name, count: now.count - was.count, kb: (now.size - was.size) / 1024 });
    }
    growth.sort((x, y) => y.kb - x.kb);
    console.log(`  힙 스냅샷 비교(${Math.min(30, MOVES >> 1) + 1}회 → ${MOVES}회): 늘어난 것 상위`);
    for (const g of growth.slice(0, 14)) console.log(`    ${g.kb.toFixed(1).padStart(8)} KB  ${String(g.count).padStart(7)}개  ${g.name.slice(0, 60)}`);
  }
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
