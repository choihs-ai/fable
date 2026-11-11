// 터치 조작 검증: 실제 브라우저에 터치 이벤트를 넣어(크롬 개발자 도구 프로토콜) 엣지케이스를 확인한다.
//
//   node scripts/browser/verify-touch.mjs --three <three 패키지 폴더>
//
// 확인하는 것: 조이스틱, 멀티터치(스틱+버튼 동시), 손가락이 화면 밖으로 나감, touchcancel, 화면 회전,
// 백그라운드 전환·복귀(일시정지·입력 초기화·저장), 메뉴가 열렸을 때, 감도·왼손 설정, 첫 터치 뒤 오디오 시작, 진동.
// 주의: 헤드리스 크로미움에 넣은 합성 터치다. 실제 기기의 손가락·제스처·OS 동작과 같다는 보장은 없다.

import { frames, launch, startServer, touch } from './lib.mjs';

const server = await startServer();
const { browser, devices, open } = await launch();
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
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
      cooldowns: player ? { ...player.cooldowns } : {},
      tick: state.tick,
      screen: f.ui.screens.current,
      audio: f.audio.status(),
      stickShown: document.querySelector('.pad-move').classList.contains('active'),
      padHidden: document.querySelector('.pad').classList.contains('hidden'),
    };
  });
  const center = (selector) => page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, selector);
  const settle = () => frames(page, 5);
  const idle = (s) => s.input.moveX === 0 && s.input.moveY === 0 && s.input.attack === false && s.held.pointers === 0;

  // ── 오디오: 첫 터치 전에는 꺼져 있고, 첫 터치 뒤에 켜진다 ──
  check('오디오: 첫 터치 전에는 시작하지 않는다', (await read()).audio.unlocked === false, (await read()).audio.state);
  const start = await page.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent === '새 게임');
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.touchscreen.tap(start.x, start.y);
  await settle();
  let s = await read();
  check('오디오: 첫 터치 뒤에 시작한다', s.audio.unlocked && s.audio.state === 'running', s.audio);
  check('새 게임: 플레이 중이고 조작부가 보인다', s.phase === 'playing' && !s.padHidden);

  const view = page.viewportSize();
  const stick = { x: Math.round(view.width * 0.25), y: Math.round(view.height * 0.7) };
  const attack = await center('.pad-attack');
  const skill = await center('.pad-skill1');

  // ── 조이스틱 ──
  await touch(cdp, 'touchStart', [{ id: 1, ...stick }]);
  await touch(cdp, 'touchMove', [{ id: 1, x: stick.x + 90, y: stick.y }]);
  const before = await read();
  await page.waitForTimeout(400);
  s = await read();
  check('조이스틱: 오른쪽으로 밀면 이동 입력이 들어가고 실제로 움직인다', s.input.moveX > 0.95 && Math.abs(s.input.moveY) < 0.05 && s.x > before.x + 0.5 && s.stickShown, { moveX: s.input.moveX, dx: +(s.x - before.x).toFixed(2) });

  // ── 멀티터치 ──
  await touch(cdp, 'touchStart', [{ id: 1, x: stick.x + 90, y: stick.y }, { id: 2, ...attack }]);
  await settle();
  s = await read();
  check('멀티터치: 스틱을 쥔 채 둘째 손가락으로 공격', s.input.moveX > 0.95 && s.input.attack === true && s.held.pointers === 2, s.held);
  await touch(cdp, 'touchStart', [{ id: 1, x: stick.x + 90, y: stick.y }, { id: 2, ...attack }, { id: 3, ...skill }]);
  await settle();
  s = await read();
  check('멀티터치: 셋째 손가락으로 기술 — 재사용 대기가 시작된다', s.held.pointers === 3 && (s.cooldowns.firebolt ?? 0) > s.tick, { held: s.held, firebolt: s.cooldowns.firebolt, tick: s.tick });
  await touch(cdp, 'touchEnd', [{ id: 1, x: stick.x + 90, y: stick.y }, { id: 2, ...attack }]);
  await touch(cdp, 'touchEnd', [{ id: 1, x: stick.x + 90, y: stick.y }]);
  await settle();
  s = await read();
  check('멀티터치: 버튼 손가락을 떼도 스틱은 그대로다', s.input.moveX > 0.95 && s.input.attack === false && s.held.stick !== null && s.held.buttons.length === 0, s.held);
  // 둘째 손가락이 이동 영역에 닿아도 스틱을 빼앗지 못한다.
  await touch(cdp, 'touchStart', [{ id: 1, x: stick.x + 90, y: stick.y }, { id: 4, x: stick.x - 60, y: stick.y - 200 }]);
  await touch(cdp, 'touchMove', [{ id: 1, x: stick.x + 90, y: stick.y }, { id: 4, x: stick.x - 160, y: stick.y - 200 }]);
  await settle();
  s = await read();
  check('멀티터치: 이동 영역의 둘째 손가락은 스틱에 영향을 주지 않는다', s.input.moveX > 0.95, { moveX: s.input.moveX });
  await touch(cdp, 'touchEnd', [{ id: 1, x: stick.x + 90, y: stick.y }]);

  // ── 손가락이 화면 밖으로 ──
  await touch(cdp, 'touchMove', [{ id: 1, x: -40, y: stick.y }]);
  await settle();
  s = await read();
  check('화면 밖 이탈: 왼쪽 밖으로 나가도 스틱이 유지되고 끝까지 민 것으로 본다', s.input.moveX < -0.95 && s.held.stick !== null, { moveX: s.input.moveX });
  await touch(cdp, 'touchMove', [{ id: 1, x: stick.x, y: view.height + 80 }]);
  await settle();
  s = await read();
  check('화면 밖 이탈: 아래쪽 밖', s.input.moveY > 0.95 && s.held.stick !== null, { moveY: s.input.moveY });
  await touch(cdp, 'touchEnd', []);
  await settle();
  s = await read();
  check('화면 밖 이탈: 밖에서 떼면 멈춘다', idle(s) && !s.stickShown, s.input);

  // ── touchcancel ──
  await touch(cdp, 'touchStart', [{ id: 1, ...stick }]);
  await touch(cdp, 'touchMove', [{ id: 1, x: stick.x, y: stick.y - 90 }]);
  await touch(cdp, 'touchStart', [{ id: 1, x: stick.x, y: stick.y - 90 }, { id: 2, ...attack }]);
  await settle();
  s = await read();
  const holding = s.input.moveY < -0.95 && s.input.attack;
  await touch(cdp, 'touchCancel', []);
  await settle();
  s = await read();
  check('touchcancel: 스틱과 버튼이 모두 놓이고 눌린 표시도 사라진다', holding && idle(s) && !s.stickShown && (await page.evaluate(() => document.querySelectorAll('.pad-button.down').length)) === 0, { holding, input: s.input, held: s.held });
  await touch(cdp, 'touchStart', [{ id: 1, ...stick }]);
  await touch(cdp, 'touchMove', [{ id: 1, x: stick.x + 90, y: stick.y }]);
  await settle();
  s = await read();
  check('touchcancel 뒤: 다시 닿으면 정상으로 동작한다', s.input.moveX > 0.95);

  // ── 화면 회전 ──
  await page.setViewportSize({ width: view.height, height: view.width });
  await settle();
  s = await read();
  const canvas = await page.evaluate(() => {
    const c = document.getElementById('scene');
    return { w: c.clientWidth, h: c.clientHeight, vw: innerWidth, vh: innerHeight, ratio: c.width / c.height };
  });
  check('화면 회전: 쥐고 있던 입력이 놓인다', idle(s) && !s.stickShown, { input: s.input, held: s.held });
  check('화면 회전: 캔버스가 새 화면 크기에 맞는다', canvas.w === canvas.vw && canvas.h === canvas.vh && Math.abs(canvas.ratio - canvas.vw / canvas.vh) < 0.02, canvas);
  // 회전 전에 닿아 있던 손가락이 뒤늦게 움직이거나 떼어져도 아무 일이 없다.
  await touch(cdp, 'touchMove', [{ id: 1, x: 300, y: 200 }]);
  await touch(cdp, 'touchEnd', []);
  await settle();
  s = await read();
  check('화면 회전: 회전 전의 손가락이 뒤늦게 움직여도 입력이 되살아나지 않는다', idle(s), s.input);
  const land = { x: Math.round(view.height * 0.2), y: Math.round(view.width * 0.6) };
  const attackLand = await center('.pad-attack');
  await touch(cdp, 'touchStart', [{ id: 5, ...land }]);
  await touch(cdp, 'touchMove', [{ id: 5, x: land.x, y: land.y + 90 }]);
  await touch(cdp, 'touchStart', [{ id: 5, x: land.x, y: land.y + 90 }, { id: 6, ...attackLand }]);
  await settle();
  s = await read();
  check('화면 회전: 가로 화면에서도 스틱과 버튼이 동작한다', s.input.moveY > 0.95 && s.input.attack === true, { input: s.input, attackLand });
  await page.screenshot({ path: `${process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : '.'}/touch-landscape.png` }).catch(() => {});

  // ── 백그라운드 전환 ──
  const hide = (hidden) => page.evaluate((h) => {
    Object.defineProperty(document, 'visibilityState', { value: h ? 'hidden' : 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  await hide(true);
  await settle();
  s = await read();
  const savedTick = await page.evaluate(() => JSON.parse(localStorage.getItem('fable:run') ?? '{"data":{}}').data.tick);
  const savedPhase = await page.evaluate(() => JSON.parse(localStorage.getItem('fable:run') ?? '{"data":{}}').data.phase);
  check('백그라운드 전환: 게임이 일시정지되고 일시정지 화면이 뜬다', s.phase === 'paused' && s.screen === 'pause', { phase: s.phase, screen: s.screen });
  check('백그라운드 전환: 쥐고 있던 입력이 놓인다', s.held.pointers === 0 && s.padHidden, s.held);
  check('백그라운드 전환: 그 순간이 저장된다(일시정지 상태로)', savedTick === s.tick && savedPhase === 'paused', { savedTick, tick: s.tick, savedPhase });
  check('백그라운드 전환: 소리가 멈춘다', s.audio.state !== 'running' || s.audio.scheduling === false, s.audio);
  const frozen = s.tick;
  await page.waitForTimeout(300);
  await hide(false);
  // 가려진 동안 닿아 있던 손가락이 돌아와서 떼어진다.
  await touch(cdp, 'touchEnd', []);
  await settle();
  s = await read();
  check('백그라운드 복귀: 일시정지인 채로 있고 틱이 흐르지 않았다', s.phase === 'paused' && s.tick === frozen && s.screen === 'pause', { tick: s.tick, frozen });
  const resume = await page.evaluate(() => {
    const r = [...document.querySelectorAll('button')].find((b) => b.textContent === '계속하기').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.touchscreen.tap(resume.x, resume.y);
  await settle();
  s = await read();
  check('백그라운드 복귀: "계속하기"를 누르면 이어지고, 입력은 비어 있다', s.phase === 'playing' && idle(s) && s.tick > frozen && !s.padHidden, { phase: s.phase, input: s.input });
  check('백그라운드 복귀: 소리가 다시 난다', s.audio.state === 'running' && s.audio.scheduling, s.audio);

  // ── 메뉴가 열렸을 때 ──
  await touch(cdp, 'touchStart', [{ id: 7, ...land }]);
  await touch(cdp, 'touchMove', [{ id: 7, x: land.x + 90, y: land.y }]);
  await settle();
  await page.evaluate(() => document.querySelector('[data-hud="bag"]').click());
  await settle();
  s = await read();
  check('메뉴: 가방을 열면 게임이 멈추고 쥐고 있던 입력이 놓인다', s.phase === 'paused' && s.screen === 'inventory' && s.held.pointers === 0 && s.padHidden, { phase: s.phase, held: s.held });
  await touch(cdp, 'touchEnd', []);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent === '닫기').click());
  await settle();
  s = await read();
  check('메뉴: 닫으면 이어지고 입력은 비어 있다', s.phase === 'playing' && idle(s));

  // ── 설정: 감도, 왼손 조작 ──
  const halfPush = async () => {
    await touch(cdp, 'touchStart', [{ id: 8, ...land }]);
    await touch(cdp, 'touchMove', [{ id: 8, x: land.x + 30, y: land.y }]);
    await settle();
    const value = (await read()).input.moveX;
    await touch(cdp, 'touchEnd', []);
    await settle();
    return value;
  };
  const normal = await halfPush();
  await page.evaluate(() => window.__fable.ui.pad.setSensitivity(200));
  const sensitive = await halfPush();
  check('감도: 올리면 같은 거리를 밀어도 더 크게 들어간다', sensitive > normal + 0.3 && sensitive > 0.95, { normal: +normal.toFixed(2), sensitive: +sensitive.toFixed(2) });
  const rightOfAttack = await center('.pad-attack');
  await page.evaluate(() => {
    document.querySelector('[data-hud="pause"]').click();
    [...document.querySelectorAll('button')].find((b) => b.textContent === '설정').click();
    document.querySelector('[data-row="leftHanded"] button').click();
    [...document.querySelectorAll('button')].find((b) => b.textContent === '닫기').click();
    [...document.querySelectorAll('button')].find((b) => b.textContent === '계속하기').click();
  });
  await settle();
  const leftAttack = await center('.pad-attack');
  const vw = (await page.viewportSize()).width;
  check('왼손 조작: 버튼이 왼쪽으로, 이동 영역이 오른쪽으로 옮겨진다', rightOfAttack.x > vw / 2 && leftAttack.x < vw / 2, { before: rightOfAttack.x, after: leftAttack.x });
  await touch(cdp, 'touchStart', [{ id: 9, x: Math.round(vw * 0.8), y: land.y }]);
  await touch(cdp, 'touchMove', [{ id: 9, x: Math.round(vw * 0.8) - 90, y: land.y }]);
  await touch(cdp, 'touchStart', [{ id: 9, x: Math.round(vw * 0.8) - 90, y: land.y }, { id: 10, ...leftAttack }]);
  await settle();
  s = await read();
  check('왼손 조작: 오른쪽에서 스틱, 왼쪽에서 공격', s.input.moveX < -0.95 && s.input.attack === true, s.input);
  await touch(cdp, 'touchEnd', []);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('fable:settings')).data);
  check('설정이 저장된다', stored.leftHanded === true, stored);

  // ── 진동 ──
  await page.evaluate(async () => {
    const { dealDamage } = await import('./src/logic/combat/damage.js');
    const g = window.__fable.game();
    const player = g.state.entities.byId[g.state.playerId];
    window.__vibrations.length = 0;
    dealDamage(g.state, g.bus, player, 3, { sourceId: null });
  });
  const on = await page.evaluate(() => window.__vibrations.length);
  await page.evaluate(async () => {
    const { dealDamage } = await import('./src/logic/combat/damage.js');
    const f = window.__fable;
    document.querySelector('[data-hud="pause"]').click();
    [...document.querySelectorAll('button')].find((b) => b.textContent === '설정').click();
    document.querySelector('[data-row="vibration"] button').click();
    [...document.querySelectorAll('button')].find((b) => b.textContent === '닫기').click();
    [...document.querySelectorAll('button')].find((b) => b.textContent === '계속하기').click();
    window.__vibrations.length = 0;
    const g = f.game();
    dealDamage(g.state, g.bus, g.state.entities.byId[g.state.playerId], 3, { sourceId: null });
  });
  const off = await page.evaluate(() => window.__vibrations.length);
  check('진동: 맞으면 울리고, 설정에서 끄면 울리지 않는다', on >= 1 && off === 0, { on, off });

  check('페이지 오류·console.error 없음', problems.length === 0, problems.slice(0, 4));
  await context.close();
} finally {
  await browser.close();
  server.stop();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n확인 ${results.length}개, 실패 ${failed}개`);
process.exit(failed === 0 ? 0 : 1);
