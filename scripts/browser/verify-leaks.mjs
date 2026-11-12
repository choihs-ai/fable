// 누수 검증: 새 층(매번 다른 시드의 맵)에 100번 들어가며 GPU 자원(renderer.info 의 geometries·textures·programs 와, WebGL 호출을 직접 세어 얻은
// 살아 있는 버퍼·텍스처·VAO 수), 씬의 객체 수, 풀 크기, DOM 노드 수, JS 힙(가비지 컬렉션 뒤)을 기록한다.
// 층에 들어갈 때마다 늘어나는 것이 있으면 누수다.
//
//   node scripts/browser/verify-leaks.mjs --three <three 패키지 폴더> [--moves 100] [--quality high]
//
// 층마다: 봇(scripts/lib/bot.js)이 몇 초 동안 방에 들어가 싸워 문·웨이브·투사체·장판·피해 숫자·입자·탄피·쓰러진 몸 풀이 실제로 돌게 한다.
// 플레이어는 무적으로 둔다(여기서 보는 것은 자원이지 승패가 아니다).
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
  await page.evaluate((q) => window.__fable.renderer.setQuality(q), QUALITY);
  await page.evaluate(async () => {
    const { botStep, createBot } = await import('/scripts/lib/bot.js');
    window.__startBot = () => {
      const bot = createBot();
      window.__fable.setAutopilot((g) => {
        const { state } = g;
        const player = state.entities.byId[state.playerId];
        if (player) player.invulnUntil = state.tick + 600;
        botStep(g, bot);
      });
    };
    // 축복 3택1·상점이 뜨면 닫는다(실제 클릭).
    setInterval(() => {
      const scr = window.__fable.ui.screens.current;
      if (scr === 'boon') document.querySelector('[data-boon]').click();
      else if (scr === 'shop') document.querySelector('[data-action="back"]').click();
    }, 200);
  });

  const sample = () => page.evaluate(() => {
    const f = window.__fable;
    const info = f.renderer.info();
    const fx = info.effects;
    return {
      run: f.game().state.seed,
      geometries: info.geometries,
      textures: info.textures,
      programs: info.programs,
      scene: info.sceneChildren,
      actorViews: info.actors.created,
      pooled: fx.projectiles.created + fx.ground.created + fx.drops.created + fx.numbers.created + fx.flashes.created + fx.chains.created + fx.casings.created,
      pools: { actors: info.actors, projectiles: fx.projectiles, ground: fx.ground, drops: fx.drops, numbers: fx.numbers, flashes: fx.flashes, chains: fx.chains, casings: fx.casings },
      dom: document.getElementsByTagName('*').length,
      voices: f.audio.status().voices,
      floorsBuilt: info.floorsBuilt,
      glBuffers: window.__gl.buffers,
      glTextures: window.__gl.textures,
      glVaos: window.__gl.vaos,
      phase: f.game().state.phase,
      tick: f.game().state.tick,
      kills: f.game().state.run.kills,
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

  const rows = [];
  let totalKills = 0;
  for (let move = 0; move <= MOVES; move++) {
    // 새 판을 시작한다(시드가 매번 달라 맵도 매번 다르다).
    await page.evaluate((m) => {
      window.__fable.startRun('knight', `leak-${m}`);
      window.__startBot();
    }, move);
    await page.waitForTimeout(2600);
    await page.evaluate(() => window.__fable.setAutopilot(null));
    await frames(page, 3);
    const row = await sample();
    row.move = move;
    totalKills += row.kills;
    row.heapMB = +((await heapUsed(cdp)) / 1048576).toFixed(2);
    rows.push(row);
    if (HEAP_DIFF && move === Math.min(30, MOVES >> 1) + 1) heapBefore = await heapByType();
  }

  // 씬에서 풀이 아닌 것: 조명, 입자, 그 층의 바닥·벽·문·소품·빛·표식. 행동체 모델은 몸과 체력 막대가 하나씩 씬에 붙는다.
  for (const row of rows) row.sceneOther = row.scene - row.actorViews * 2 - row.pooled;
  // 피해 숫자는 스프라이트마다 캔버스 텍스처를 하나씩 갖고 풀에 남는다. 텍스처 수에서 풀의 몫을 빼야 층 자원만 남는다.
  for (const row of rows) {
    row.texOther = row.textures - row.pools.numbers.created;
    row.glTexOther = row.glTextures - row.pools.numbers.created;
  }
  const cols = ['move', 'kills', 'geometries', 'textures', 'texOther', 'programs', 'glBuffers', 'glTextures', 'glVaos', 'scene', 'actorViews', 'pooled', 'dom', 'heapMB'];
  if (option('json')) (await import('node:fs')).writeFileSync(option('json'), JSON.stringify(rows.map(({ pools, ...r }) => r)));
  console.log(`품질 ${QUALITY}, 새 층 ${MOVES}회 (10회마다 표시)`);
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
  // 측정이 실제로 싸우는 게임을 본 것인가: 매번 플레이 중이었고 틱이 흘렀고, 전체로 적을 잡았어야 한다.
  let idle = 0;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].phase !== 'playing' || rows[i].tick < 60) idle++;
  }
  const fought = rows.filter((r) => r.kills > 0).length;
  console.log(`  ${fought >= rows.length * 0.6 ? '✔' : '✖'} 적을 잡은 층 ${fought}/${rows.length} (처치 합계 ${totalKills})`);
  if (fought < rows.length * 0.6) failed++;
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
  console.log(`  만든 층 뷰 ${built}개 (새 층 ${MOVES + 1}회)`);
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
