// 터치 조작 검증: 실제 브라우저에 터치 이벤트를 넣어(크롬 개발자 도구 프로토콜) 엣지케이스를 확인한다.
//
//   node scripts/browser/verify-touch.mjs --three <three 패키지 폴더>
//
// 확인하는 것
//   - 버그 1(두 번 두드려 확대): 게임 화면 어디를 빠르게 두 번 두드려도, 두 손가락으로 벌려도, 끌어도 확대·스크롤이 일어나지 않는다.
//     페이지 전체의 touch-action, 막은 연속 터치의 수, 두 번 빠르게 누른 메뉴 버튼이 두 번 눌리는가.
//   - 조이스틱, 공격 버튼을 끌어서 수동 조준, 대시·스킬·교체, 멀티터치(스틱+공격+대시), 손가락이 화면 밖으로 나감, touchcancel,
//     화면 회전, 백그라운드 전환·복귀(일시정지·입력 초기화·저장), 메뉴가 열렸을 때, 첫 터치 뒤 오디오 시작, 진동 호출.
// 주의: 헤드리스 크로미움에 넣은 합성 터치다. 아이폰 사파리의 확대 동작은 크로미움에서 재현되지 않는다(크로미움은 width=device-width 면
// 두 번 두드려 확대를 하지 않는다). 그래서 "막는 장치가 붙어 있고 동작하는가"를 보고, 실기기 확인은 따로 해야 한다.

import { frames, launch, startServer, touch } from './lib.mjs';

const server = await startServer();
const { browser, devices, open } = await launch();
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✖'} ${name}${detail !== '' ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}

try {
  const { context, page, cdp, problems } = await open({ ...devices['Pixel 7'] }, `${server.base}?debug=1&seed=touch-check`);
  // 진동 호출을 센다(헤드리스에는 진동 장치가 없다. 불렸는지만 본다).
  await page.evaluate(() => {
    window.__vibrations = [];
    navigator.vibrate = (pattern) => {
      window.__vibrations.push(pattern);
      return true;
    };
  });
  const read = () => page.evaluate(() => {
    const f = window.__fable;
    const { state } = f.game();
    const player = state.playerId !== null ? state.entities.byId[state.playerId] : null;
    return {
      phase: state.phase,
      input: { ...state.input },
      held: f.ui.pad.controls.held(),
      x: player ? player.x : 0,
      y: player ? player.y : 0,
      kit: player ? { ...player.kit } : null,
      facing: player ? [player.facingX, player.facingY] : null,
      tick: state.tick,
      screen: f.ui.screens.current,
      audio: f.audio.status(),
      padHidden: document.querySelector('.pad').classList.contains('hidden'),
      zoom: window.visualViewport ? window.visualViewport.scale : 1,
      scroll: [window.scrollX, window.scrollY, document.scrollingElement.scrollTop],
      guard: f.ui.guard.stats(),
    };
  });
  const center = (selector) => page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, selector);
  const settle = () => frames(page, 5);
  const idle = (s) => s.input.moveX === 0 && s.input.moveY === 0 && s.input.attack === false && s.held.pointers === 0;
  const tapAt = async (p) => {
    await touch(cdp, 'touchStart', [{ id: 9, ...p }]);
    await touch(cdp, 'touchEnd', []);
  };

  // ── 페이지 전체의 touch-action ──
  const actions = await page.evaluate(() => {
    const of = (el) => getComputedStyle(el).touchAction;
    return { html: of(document.documentElement), body: of(document.body), canvas: of(document.getElementById('scene')), ui: of(document.getElementById('ui')), button: of(document.querySelector('.btn')) };
  });
  check('touch-action: html·body·캔버스·ui 는 none, 버튼은 manipulation', actions.html === 'none' && actions.body === 'none' && actions.canvas === 'none' && actions.ui === 'none' && actions.button === 'manipulation', actions);
  const panLeft = await page.evaluate(() => [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]).filter((r) => /pan-x/.test(r.cssText)).map((r) => r.selectorText));
  check('pan-x 를 허용하는 규칙이 남아 있지 않다', panLeft.length === 0, panLeft);

  // ── 오디오: 첫 터치 전에는 꺼져 있고, 첫 터치 뒤에 켜진다 ──
  check('오디오: 첫 터치 전에는 시작하지 않는다', (await read()).audio.unlocked === false);
  await page.touchscreen.tap(...Object.values(await center('[data-action="new"]')));
  await settle();
  // 처음 하는 판이면 이야기의 시작이 먼저 뜬다 — 건너뛰기를 터치로.
  if (await page.$('[data-action="story-skip"]')) {
    await page.touchscreen.tap(...Object.values(await center('[data-action="story-skip"]')));
    await settle();
  }
  await page.touchscreen.tap(...Object.values(await center('[data-action="start-knight"]')));
  await frames(page, 40);
  let s = await read();
  check('오디오: 첫 터치 뒤에 시작한다', s.audio.unlocked && s.audio.state === 'running', s.audio);
  check('새 게임(터치로 이야기 건너뛰기 → 탈 고르기): 플레이 중이고 조작부가 보인다', s.phase === 'playing' && !s.padHidden, { phase: s.phase, screen: s.screen });

  // ── 버그 1: 두 번 두드려 확대 ──
  const view = page.viewportSize();
  const spots = [
    { x: Math.round(view.width * 0.5), y: Math.round(view.height * 0.35) }, // 게임 화면 가운데(캔버스)
    { x: Math.round(view.width * 0.2), y: Math.round(view.height * 0.8) }, // 이동 영역
    await center('.pad-attack'), await center('.pad-dash'),
    { x: 30, y: 20 }, // HUD 위
    { x: view.width - 10, y: Math.round(view.height * 0.5) }, // 화면 가장자리
  ];
  // 페이지 안에서 touchend 마다 시각과 "기본 동작이 막혔는가"를 적는다(가드는 캡처 단계에서 먼저 돈다).
  // 헤드리스에서는 합성 터치 하나가 렌더 한 프레임을 기다려 두 번째 터치가 300ms 를 넘길 때가 있다 —
  // 그래서 "몇 번 막았나"가 아니라 "간격이 짧았던 touchend 는 모두 막혔나"를 본다.
  await page.evaluate(() => {
    window.__ends = [];
    window.addEventListener('touchend', (e) => window.__ends.push({ t: performance.now(), prevented: e.defaultPrevented }), { capture: false });
  });
  for (const p of spots) {
    for (let k = 0; k < 3; k++) {
      // 네 이벤트를 기다리지 않고 한꺼번에 보낸다(순서는 지켜진다). 하나씩 기다리면 헤드리스의 느린 프레임 때문에 간격이 300ms 를 넘는다.
      await Promise.all([
        touch(cdp, 'touchStart', [{ id: 9, ...p }]),
        touch(cdp, 'touchEnd', []),
        touch(cdp, 'touchStart', [{ id: 9, ...p }]),
        touch(cdp, 'touchEnd', []),
      ]);
      await page.waitForTimeout(400);
    }
  }
  s = await read();
  check('두 번 두드리기: 어디를 빠르게 두 번 눌러도 확대·스크롤이 되지 않는다', s.zoom === 1 && s.scroll.every((v) => v === 0), { zoom: s.zoom, scroll: s.scroll });
  const ends = await page.evaluate((gapMs) => {
    const list = window.__ends;
    let quick = 0;
    let quickBlocked = 0;
    let slowBlocked = 0;
    for (let i = 1; i < list.length; i++) {
      const gap = list[i].t - list[i - 1].t;
      if (gap <= gapMs - 20) {
        quick++;
        if (list[i].prevented) quickBlocked++;
      } else if (gap > gapMs + 20 && list[i].prevented) slowBlocked++;
    }
    return { total: list.length, quick, quickBlocked, slowBlocked };
  }, 300);
  check('두 번 두드리기: 300ms 안에 이어진 touchend 는 모두 기본 동작이 막혔다', ends.quick >= spots.length && ends.quickBlocked === ends.quick, ends);
  // 핀치(두 손가락으로 벌리기)와 끌기.
  const mid = { x: Math.round(view.width / 2), y: Math.round(view.height / 2) };
  await cdp.send('Input.synthesizePinchGesture', { x: mid.x, y: mid.y, scaleFactor: 2.5, gestureSourceType: 'touch' });
  await touch(cdp, 'touchStart', [{ id: 1, x: mid.x - 40, y: mid.y }, { id: 2, x: mid.x + 40, y: mid.y }]);
  await touch(cdp, 'touchMove', [{ id: 1, x: mid.x - 150, y: mid.y - 50 }, { id: 2, x: mid.x + 150, y: mid.y + 50 }]);
  await touch(cdp, 'touchEnd', []);
  await cdp.send('Input.synthesizeScrollGesture', { x: mid.x, y: mid.y, yDistance: -600, gestureSourceType: 'touch' });
  await settle();
  s = await read();
  check('핀치·끌기: 확대되지 않고 페이지가 스크롤되지 않는다', s.zoom === 1 && s.scroll.every((v) => v === 0), { zoom: s.zoom, scroll: s.scroll, pinch: s.guard.pinch });
  await page.evaluate(() => window.__fable.ui.pad.reset());

  // 메뉴 버튼은 빠르게 두 번 눌러도 두 번 눌린다(막은 터치도 버튼 입력은 살린다).
  await page.evaluate(() => window.__fable.ui.screens.open('settings'));
  await settle();
  const vib = await center('[data-action="toggle-vibration"]');
  const vibBefore = await page.evaluate(() => window.__fable.settings().vibration);
  // 네 이벤트를 한꺼번에 보낸다(하나씩 기다리면 헤드리스의 느린 프레임 때문에 간격이 300ms 를 넘어 "빠른 두 번"이 되지 않는다).
  await Promise.all([
    touch(cdp, 'touchStart', [{ id: 9, ...vib }]),
    touch(cdp, 'touchEnd', []),
    touch(cdp, 'touchStart', [{ id: 9, ...vib }]),
    touch(cdp, 'touchEnd', []),
  ]);
  await settle();
  const vibAfter = await page.evaluate(() => window.__fable.settings().vibration);
  s = await read();
  check('메뉴 버튼을 빠르게 두 번 누르면 두 번 눌린다(켬→끔→켬)', vibAfter === vibBefore && s.guard.rescued >= 1 && s.zoom === 1, { vibBefore, vibAfter, rescued: s.guard.rescued });
  await page.evaluate(() => window.__fable.ui.screens.closeAll());
  await settle();

  // ── 조이스틱 ──
  const stick = { x: Math.round(view.width * 0.25), y: Math.round(view.height * 0.72) };
  const attack = await center('.pad-attack');
  const dash = await center('.pad-dash');
  await touch(cdp, 'touchStart', [{ id: 1, ...stick }]);
  await touch(cdp, 'touchMove', [{ id: 1, x: stick.x + 90, y: stick.y }]);
  const before = await read();
  await page.waitForTimeout(400);
  s = await read();
  check('조이스틱: 오른쪽으로 밀면 이동 입력이 들어가고 실제로 움직인다', s.input.moveX > 0.95 && s.x > before.x + 0.5, { moveX: s.input.moveX, dx: +(s.x - before.x).toFixed(2), phase: s.phase, ticks: s.tick - before.tick, screen: s.screen, x: s.x, y: s.y });

  // ── 멀티터치: 스틱 + 공격(끌어서 수동 조준) + 대시 ──
  await touch(cdp, 'touchStart', [{ id: 1, x: stick.x + 90, y: stick.y }, { id: 2, ...attack }]);
  await touch(cdp, 'touchMove', [{ id: 1, x: stick.x + 90, y: stick.y }, { id: 2, x: attack.x, y: attack.y - 80 }]);
  await settle();
  s = await read();
  check('공격 버튼을 위로 끌면 수동 조준(위쪽 = -y), 스틱 입력은 그대로', s.input.attack && Math.abs(s.input.aimX) < 0.05 && s.input.aimY < -0.95 && s.input.moveX > 0.95, { aim: [s.input.aimX, s.input.aimY], held: s.held });
  const charges = s.kit.charges;
  await touch(cdp, 'touchStart', [{ id: 1, x: stick.x + 90, y: stick.y }, { id: 2, x: attack.x, y: attack.y - 80 }, { id: 3, ...dash }]);
  await settle();
  s = await read();
  check('세 손가락: 스틱 + 공격 + 대시를 동시에, 대시 충전이 하나 줄었다', s.held.pointers === 3 && s.kit.charges === charges - 1 && s.input.attack, { held: s.held, charges: [charges, s.kit.charges] });
  await touch(cdp, 'touchEnd', [{ id: 3, ...dash }]);
  await touch(cdp, 'touchEnd', [{ id: 2, x: attack.x, y: attack.y - 80 }]);
  await settle();
  s = await read();
  check('공격 손가락을 떼면 조준이 풀리고 공격이 멈추며, 스틱은 남는다', !s.input.attack && s.input.aimX === 0 && s.input.aimY === 0 && s.input.moveX > 0.95 && s.held.stick !== null);

  // ── 화면 밖으로 나감 ──
  await touch(cdp, 'touchMove', [{ id: 1, x: -200, y: stick.y }]);
  await settle();
  s = await read();
  check('손가락이 화면 밖으로 나가도 스틱이 유지된다(왼쪽 끝까지)', s.input.moveX < -0.95 && s.held.stick !== null, { moveX: s.input.moveX });
  await touch(cdp, 'touchEnd', [{ id: 1, x: -200, y: stick.y }]);
  await settle();
  s = await read();
  check('화면 밖에서 떼면 멈춘다', idle(s), { input: s.input, held: s.held });

  // ── touchcancel ──
  await touch(cdp, 'touchStart', [{ id: 1, ...stick }, { id: 2, ...attack }]);
  await touch(cdp, 'touchMove', [{ id: 1, x: stick.x, y: stick.y - 90 }, { id: 2, ...attack }]);
  await settle();
  await touch(cdp, 'touchCancel', []);
  await settle();
  s = await read();
  check('touchcancel: 스틱과 버튼이 모두 놓인다', idle(s), { input: s.input, held: s.held });

  // ── 화면 회전 ──
  await touch(cdp, 'touchStart', [{ id: 1, ...stick }, { id: 2, ...attack }]);
  await touch(cdp, 'touchMove', [{ id: 1, x: stick.x + 90, y: stick.y }, { id: 2, ...attack }]);
  await settle();
  await page.setViewportSize({ width: view.height, height: view.width });
  await settle();
  s = await read();
  check('화면 회전: 쥐고 있던 입력이 모두 놓인다', idle(s), { input: s.input, held: s.held });
  await touch(cdp, 'touchMove', [{ id: 1, x: stick.x + 150, y: stick.y }]);
  await settle();
  s = await read();
  check('회전 전의 손가락이 늦게 움직여도 되살아나지 않는다', idle(s));
  await touch(cdp, 'touchEnd', []);
  const land = await page.evaluate(() => [...document.querySelectorAll('.pad-button:not(.hidden)')].map((b) => {
    const r = b.getBoundingClientRect();
    return r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight;
  }));
  check('가로 화면: 버튼이 모두 화면 안에 있다', land.every(Boolean), land);
  await page.setViewportSize(view);
  await settle();

  // ── 백그라운드 전환 ──
  await touch(cdp, 'touchStart', [{ id: 1, ...stick }]);
  await touch(cdp, 'touchMove', [{ id: 1, x: stick.x + 90, y: stick.y }]);
  await settle();
  const hide = (hidden) => page.evaluate((h) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  await hide(true);
  await settle();
  s = await read();
  const saved = await page.evaluate(() => localStorage.getItem('fable:run') !== null);
  const savedInput = await page.evaluate(() => {
    try {
      const doc = JSON.parse(localStorage.getItem('fable:run'));
      const state = doc.data;
      return state.input ?? null;
    } catch {
      return null;
    }
  });
  check('백그라운드: 일시정지되고, 입력이 놓이고, 저장되고, 소리가 멈춘다', s.phase === 'paused' && s.screen === 'pause' && idle(s) && saved && s.audio.state === 'suspended', { phase: s.phase, screen: s.screen, saved, audio: s.audio.state, input: s.input, held: s.held });
  check('백그라운드: 저장된 판에 쥐고 있던 이동 입력이 남지 않는다', savedInput !== null && (savedInput.moveX === 0 && savedInput.moveY === 0 && savedInput.attack === false), savedInput);
  await touch(cdp, 'touchEnd', []);
  await hide(false);
  await settle();
  s = await read();
  check('복귀: 일시정지 화면에 머문다(눌러야 이어진다)', s.phase === 'paused' && s.screen === 'pause');
  await page.touchscreen.tap(...Object.values(await center('[data-action="resume"]')));
  await settle();
  s = await read();
  check('계속하기: 다시 플레이', s.phase === 'playing' && s.screen === null && s.audio.state === 'running');

  // ── 대시 버튼으로 실제 대시, 진동 ──
  await touch(cdp, 'touchStart', [{ id: 4, ...dash }]);
  await touch(cdp, 'touchEnd', []);
  await settle();
  const vibs = await page.evaluate(() => window.__vibrations.length);
  check('진동: 대시·메뉴 등에서 진동 장치를 부른다', vibs > 0, { calls: vibs });
  check('페이지 오류가 없다', problems.length === 0, problems.slice(0, 5));
  await context.close();
} finally {
  await browser.close();
  server.stop();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length}개 가운데 실패 ${failed}개`);
process.exit(failed > 0 ? 1 : 0);
