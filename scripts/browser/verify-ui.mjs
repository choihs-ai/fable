// 화면 흐름 검증: 실제 브라우저에서 타이틀 → 새 게임 → HUD → 가방·착용 → 강화 3택1 → 상점·제단 → 계단 → 사망 → 영구 해금 →
// 타이틀 → 이어하기를 차례로 밟고, 카메라 추적·시야 안개·벽 가림·그래픽 품질 3단계가 실제로 바뀌는지 본다.
//
//   node scripts/browser/verify-ui.mjs --three <three 패키지 폴더> [--out <화면 갈무리 폴더>]
//
// 상황을 만들 때(장비 지급, 경험치, 상점 곁으로 이동)는 페이지 안에서 로직 모듈을 직접 불러 쓴다. 화면 조작은 실제 클릭이다.

import { frames, launch, option, startServer } from './lib.mjs';

const OUT = option('out');
const server = await startServer();
const { browser, devices, open } = await launch();
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✖'} ${name}${detail !== '' ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}

try {
  const { context, page, problems } = await open({ ...devices['Pixel 7'] }, `${server.base}?debug=1&seed=ui-check`);
  const shot = async (name) => {
    if (OUT) await page.screenshot({ path: `${OUT}/${name}.png` });
  };
  const click = (text) => page.evaluate((t) => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent.startsWith(t));
    if (!el) throw new Error(`버튼 없음: ${t}`);
    el.click();
  }, text);
  const settle = (n = 6) => frames(page, n);
  const snap = () => page.evaluate(() => {
    const f = window.__fable;
    const { state } = f.game();
    const player = state.playerId !== null ? state.entities.byId[state.playerId] : null;
    const buttons = [...document.querySelectorAll('.screens button')].map((b) => ({ text: b.textContent, disabled: b.disabled }));
    return {
      phase: state.phase, floor: state.run.floor, tick: state.tick, seed: state.seed, screen: f.ui.screens.current,
      hp: player ? player.hp : 0, maxHp: player ? player.maxHp : 0, x: player ? player.x : 0, y: player ? player.y : 0,
      gold: state.inventory.gold, bag: state.inventory.bag.length, equipped: Object.values(state.inventory.equipped).filter(Boolean).length,
      upgrades: Object.values(state.run.upgrades).reduce((a, b) => a + b, 0), level: state.run.level, souls: state.meta.souls,
      unlocked: Object.keys(state.meta.unlocked), buttons,
      hudHidden: document.querySelector('.hud').classList.contains('hidden'),
      hpText: document.querySelector('.bar.hp .label').textContent, place: document.querySelector('.hud .place').textContent,
      context: document.querySelector('.hud .context').classList.contains('hidden') ? '' : document.querySelector('.hud .context').textContent,
      info: f.renderer.info(),
    };
  });

  // ── 타이틀 ──
  let s = await snap();
  check('타이틀: 처음에는 타이틀 화면이고 "이어하기"는 눌리지 않는다', s.screen === 'title' && s.buttons.find((b) => b.text.startsWith('이어하기')).disabled && s.hudHidden, s.buttons.map((b) => b.text));
  await shot('ui-01-title');
  await click('새 게임');
  await settle();
  s = await snap();
  check('새 게임: 1층에서 시작하고 HUD 가 보인다', s.phase === 'playing' && s.floor === 1 && !s.hudHidden && s.hpText === `${s.hp}/${s.maxHp}` && s.place.startsWith('1층'), { hp: s.hpText, place: s.place });

  // ── 시야 안개 ──
  const fog0 = s.info.floor.fog;
  check('안개: 시작할 때 보이는 곳과 가 보지 않은 곳이 나뉜다', fog0.visible > 0 && fog0.hidden > 0 && fog0.explored === 0, fog0);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(250);
  const moving = await snap();
  await page.waitForTimeout(900);
  await page.keyboard.up('KeyD');
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(900);
  await page.keyboard.up('KeyS');
  await page.waitForTimeout(400);
  s = await snap();
  const fog1 = s.info.floor.fog;
  check('안개: 돌아다니면 "탐험했지만 지금은 안 보이는 곳"이 생기고 가 보지 않은 곳이 준다', fog1.explored > 0 && fog1.hidden < fog0.hidden, fog1);

  // ── 카메라 ──
  const lag = Math.hypot(moving.info.focus.x - moving.x, moving.info.focus.y - moving.y);
  const rest = Math.hypot(s.info.focus.x - s.x, s.info.focus.y - s.y);
  check('카메라: 움직이는 동안은 조금 뒤따르고(부드러운 추적), 멈추면 플레이어 위에 선다', lag > 0.05 && lag < 3 && rest < 0.05, { lag: +lag.toFixed(3), rest: +rest.toFixed(3) });
  check('카메라: 플레이어 남쪽 위에서 내려다본다(쿼터뷰)', s.info.camera.y > 8 && s.info.camera.z > s.y + 4 && Math.abs(s.info.camera.x - s.info.focus.x) < 1e-6, s.info.camera);

  // ── 벽 가림 ──
  await page.evaluate(() => {
    const { state } = window.__fable.game();
    const { width, height, tiles } = state.world;
    const player = state.entities.byId[state.playerId];
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (tiles[y * width + x] === 1 && tiles[(y + 1) * width + x] === 0 && tiles[(y - 1) * width + x] === 1) {
          player.x = x + 0.5;
          player.y = y + 0.5;
          return;
        }
      }
    }
  });
  await settle();
  s = await snap();
  check('벽 가림: 플레이어 앞(남쪽)을 가리는 벽이 낮아진다', s.info.floor.lowered > 0, { lowered: s.info.floor.lowered });
  await shot('ui-02-cutaway');

  // ── 그래픽 품질 ──
  const quality = {};
  for (const [label, name] of [['낮음', 'low'], ['보통', 'medium'], ['높음', 'high']]) {
    await page.evaluate(() => document.querySelector('[data-hud="pause"]').click());
    await click('설정');
    await page.evaluate((l) => [...document.querySelectorAll('[data-row="quality"] button')].find((b) => b.textContent === l).click(), label);
    await click('닫기');
    await click('계속하기');
    await settle(10);
    const q = (await snap()).info;
    quality[name] = { pixelRatio: +q.pixelRatio.toFixed(2), shadows: q.shadows, width: await page.evaluate(() => document.getElementById('scene').width), particles: q.quality };
    await shot(`ui-03-quality-${name}`);
  }
  check('품질 3단계: 해상도 배율이 낮음 < 보통 < 높음', quality.low.width < quality.medium.width && quality.medium.width < quality.high.width, quality);
  check('품질 3단계: 그림자는 높음에서만 켜진다', !quality.low.shadows && !quality.medium.shadows && quality.high.shadows);
  const savedQuality = await page.evaluate(() => JSON.parse(localStorage.getItem('fable:settings')).data.quality);
  check('품질 설정이 저장된다', savedQuality === 'high', savedQuality);

  // ── 가방·착용 ──
  await page.evaluate(async () => {
    const { rollEquipment } = await import('./src/logic/items/equipment.js');
    const { addToBag } = await import('./src/logic/items/inventory.js');
    const { Rng } = await import('./src/logic/core/prng.js');
    const { state } = window.__fable.game();
    const rng = Rng.fromSeed('ui-items');
    for (const [slot, rarity] of [['weapon', 'rare'], ['armor', 'epic'], ['weapon', 'legendary']]) {
      const item = rollEquipment(rng, { ilvl: 3, rarity, slot });
      item.uid = state.entities.nextId++;
      addToBag(state.inventory, item);
    }
    state.inventory.consumables.health_potion = 2;
  });
  await page.evaluate(() => document.querySelector('[data-hud="bag"]').click());
  await settle();
  s = await snap();
  const paused = s.phase;
  await page.evaluate(() => document.querySelector('.bag .item:not(.empty)').click());
  await settle(2);
  const detail = await page.evaluate(() => document.querySelector('.detail')?.textContent ?? '');
  await shot('ui-04-inventory');
  await click('착용');
  await settle(2);
  const after = await snap();
  check('가방: 열면 게임이 멈추고, 장비를 누르면 옵션과 "착용하면" 비교가 보인다', paused === 'paused' && s.screen === 'inventory' && detail.includes('착용하면') && detail.includes('공격력'), detail.slice(0, 80));
  check('가방: 착용하면 가방에서 빠지고 능력치가 오른다', after.bag === s.bag - 1 && after.equipped === s.equipped + 1);
  await page.evaluate(() => document.querySelector('.slots .item:not(.empty)').click());
  await click('해제');
  await settle(2);
  check('가방: 해제하면 가방으로 돌아온다', (await snap()).bag === s.bag);
  await click('닫기');
  await settle();
  check('가방: 닫으면 게임이 이어진다', (await snap()).phase === 'playing');

  // ── 강화 3택1 ──
  await page.evaluate(async () => {
    const { gainXp } = await import('./src/logic/items/levelup.js');
    const { offerPendingChoice } = await import('./src/logic/combat/loot.js');
    const g = window.__fable.game();
    gainXp(g.state.run, 80);
    offerPendingChoice(g.state, g.bus);
  });
  await settle();
  s = await snap();
  const cards = await page.evaluate(() => document.querySelectorAll('.card.choice').length);
  await shot('ui-05-levelup');
  check('강화 3택1: 후보가 제시되면 화면이 뜨고 게임이 멈춘다', s.screen === 'levelup' && s.phase === 'paused' && cards === 3, { cards, level: s.level });
  let guard = 0;
  while ((await snap()).screen === 'levelup' && guard++ < 10) {
    await page.evaluate(() => document.querySelector('.card.choice').click());
    await settle(3);
  }
  const chosen = await snap();
  check('강화 3택1: 고르면 강화가 붙고, 남은 선택이 없으면 닫히고 이어진다', chosen.upgrades > s.upgrades && chosen.screen === null && chosen.phase === 'playing', { upgrades: chosen.upgrades });

  // ── 상점·제단 ──
  const goTo = (what) => page.evaluate(async (kind) => {
    const f = window.__fable;
    for (let floor = 2; floor <= 29; floor++) {
      f.enterFloor(floor);
      const { state } = f.game();
      if (state[kind]) {
        const player = state.entities.byId[state.playerId];
        const { findFreeSpot } = await import('./src/logic/entities/actors.js');
        const spot = findFreeSpot(state, state[kind].x, state[kind].y + 1, player.radius, 2) ?? { x: state[kind].x, y: state[kind].y };
        player.x = spot.x;
        player.y = spot.y;
        state.inventory.gold = 5000;
        return floor;
      }
    }
    return 0;
  }, what);
  const shopFloor = await goTo('shop');
  await settle(10);
  s = await snap();
  check('상점: 곁에 서면 "상점" 버튼이 뜬다', shopFloor > 0 && s.context === '상점', { floor: shopFloor, context: s.context });
  await page.evaluate(() => document.querySelector('.hud .context').click());
  await settle();
  await shot('ui-06-shop');
  const goldBefore = (await snap()).gold;
  await page.evaluate(() => [...document.querySelectorAll('[data-screen="shop"] .row button')].find((b) => b.textContent.includes('금화') && !b.textContent.startsWith('+') && !b.disabled).click());
  await settle(2);
  s = await snap();
  check('상점: 사면 금화가 줄고 품목이 "팔림"이 된다', s.gold < goldBefore && s.buttons.some((b) => b.text === '팔림'), { before: goldBefore, after: s.gold });
  await click('닫기');
  const altarFloor = await goTo('altar');
  await settle(10);
  s = await snap();
  check('제단: 곁에 서면 "제단" 버튼이 뜬다', altarFloor > 0 && s.context === '제단', { floor: altarFloor, context: s.context });
  await page.evaluate(() => document.querySelector('.hud .context').click());
  await settle();
  await shot('ui-07-altar');
  const offers = await page.evaluate(() => document.querySelectorAll('[data-screen="altar"] .card').length);
  await click('바친다');
  await settle(3);
  s = await snap();
  if (s.screen === 'levelup') await page.evaluate(() => document.querySelector('.card.choice').click());
  await settle(3);
  s = await snap();
  if (s.screen === 'altar') await click('닫기');
  const used = await page.evaluate(() => window.__fable.game().state.altar.used);
  check('제단: 제안 가운데 하나를 받으면 제단이 닫힌다', offers >= 2 && used === true, { offers, used });
  await settle();

  // ── 계단 ──
  const onStairs = () => page.evaluate(() => {
    const { state } = window.__fable.game();
    const player = state.entities.byId[state.playerId];
    player.x = state.world.stairs.x + 0.5;
    player.y = state.world.stairs.y + 0.5;
  });
  await page.evaluate(() => window.__fable.enterFloor(4));
  await onStairs();
  await settle(8);
  s = await snap();
  const built = s.info.floorsBuilt;
  check('계단: 위에 서면 "내려가기" 버튼이 뜬다', s.context === '내려가기' && s.floor === 4, s.context);
  await page.evaluate(() => document.querySelector('.hud .context').click());
  await settle(8);
  s = await snap();
  check('계단: 누르면 다음 층으로 가고, 앞 층의 맵은 버리고 새로 만든다', s.floor === 5 && s.info.floorsBuilt === built + 1 && s.place.startsWith('5층'), { floor: s.floor, built: s.info.floorsBuilt });
  await onStairs();
  await settle(8);
  s = await snap();
  check('계단: 보스가 살아 있으면 잠겨 있다', s.context === '계단이 잠겨 있다' && s.floor === 5, s.context);
  await shot('ui-08-boss-floor');

  // ── 사망 → 결과 → 영구 해금 ──
  await page.evaluate(async () => {
    const { dealDamage } = await import('./src/logic/combat/damage.js');
    const g = window.__fable.game();
    g.state.meta.souls = 100;
    const player = g.state.entities.byId[g.state.playerId];
    dealDamage(g.state, g.bus, player, 99999, { sourceId: null });
  });
  await page.waitForTimeout(400);
  s = await snap();
  await shot('ui-09-death');
  check('사망: 결과 화면이 뜨고 영혼석을 얻는다', s.screen === 'result' && s.phase === 'gameOver' && s.souls > 100, { screen: s.screen, souls: s.souls });
  check('사망: 런 세이브가 지워진다', (await page.evaluate(() => localStorage.getItem('fable:run'))) === null);
  await click('영구 해금');
  await settle(2);
  await shot('ui-10-unlocks');
  await page.evaluate(() => document.querySelector('[data-unlock="vigor_1"] button').click());
  await settle(2);
  s = await snap();
  const metaSaved = await page.evaluate(() => JSON.parse(localStorage.getItem('fable:meta')).data);
  check('영구 해금: 사면 영혼석이 줄고 곧바로 저장된다', s.unlocked.includes('vigor_1') && metaSaved.unlocked.vigor_1 === true && metaSaved.souls === s.souls, { souls: s.souls, saved: metaSaved.souls });
  await click('닫기');
  await click('타이틀로');
  await settle();
  s = await snap();
  check('타이틀로: 끝난 런은 이어할 수 없다', s.screen === 'title' && s.buttons.find((b) => b.text.startsWith('이어하기')).disabled && s.hudHidden);

  // ── 새 런(해금 반영) → 저장하고 타이틀로 → 이어하기 ──
  // (이어한 뒤 몇 프레임을 기다리는 동안에도 틱이 흐른다. 헤드리스 환경은 프레임이 느려 한 프레임에 여러 틱이 돈다.)
  await click('새 게임');
  await settle();
  s = await snap();
  check('영구 해금이 새 런에 반영된다(최대 체력 +10)', s.maxHp === 110, s.maxHp);
  await page.keyboard.down('KeyA');
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyA');
  await page.evaluate(() => document.querySelector('[data-hud="pause"]').click());
  await shot('ui-11-pause');
  await click('저장하고 타이틀로');
  await settle();
  const left = await page.evaluate(() => JSON.parse(localStorage.getItem('fable:run')).data);
  s = await snap();
  const cont = s.buttons.find((b) => b.text.startsWith('이어하기'));
  check('저장하고 타이틀로: "이어하기"에 층과 레벨이 보인다', s.screen === 'title' && !cont.disabled && cont.text.includes('1층'), cont.text);
  await click('이어하기');
  await settle();
  s = await snap();
  check('이어하기: 같은 시드·같은 자리에서 이어진다', s.phase === 'playing' && s.seed === left.seed && s.tick >= left.tick && s.tick < left.tick + 120 && s.screen === null, { saved: left.tick, now: s.tick });

  // ── 새로고침 뒤 이어하기 ──
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const tickAtHide = (await snap()).tick;
  await page.reload();
  await page.waitForFunction(() => window.__fable !== undefined);
  await settle();
  s = await snap();
  const cont2 = s.buttons.find((b) => b.text.startsWith('이어하기'));
  check('새로고침: 타이틀에서 "이어하기"가 켜져 있다', s.screen === 'title' && cont2 && !cont2.disabled, cont2 && cont2.text);
  await click('이어하기');
  await settle();
  s = await snap();
  check('새로고침 뒤 이어하기: 백그라운드로 갈 때 저장한 틱에서 이어진다', s.phase === 'playing' && s.tick >= tickAtHide && s.tick < tickAtHide + 120, { saved: tickAtHide, now: s.tick });

  // 가로 화면 갈무리.
  await page.setViewportSize({ width: 915, height: 412 });
  await settle(10);
  await shot('ui-12-landscape');
  const overflow = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight, vw: innerWidth, vh: innerHeight }));
  check('가로 화면: 화면 밖으로 넘치는 것이 없다', overflow.w <= overflow.vw && overflow.h <= overflow.vh, overflow);
  const offscreen = await page.evaluate(() => [...document.querySelectorAll('.pad-button, .hud .btn:not(.hidden)')].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && (r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight);
  }).map((el) => el.className));
  check('가로 화면: 버튼이 모두 화면 안에 있다', offscreen.length === 0, offscreen);

  check('페이지 오류·console.error 없음', problems.length === 0, problems.slice(0, 4));
  await context.close();
} finally {
  await browser.close();
  server.stop();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n확인 ${results.length}개, 실패 ${failed}개`);
process.exit(failed === 0 ? 0 : 1);
