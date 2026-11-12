import { frames, launch, option, startServer } from './lib.mjs';
const OUT = option('out');
const server = await startServer();
const { browser, devices, open } = await launch();
try {
  const { page, problems } = await open({ ...devices['Pixel 7'] }, `${server.base}?debug=1&seed=smoke`);
  await frames(page, 10);
  await page.screenshot({ path: `${OUT}/01-title.png` });
  await page.evaluate(() => document.querySelector('[data-action="new"]').click());
  await frames(page, 4);
  await page.screenshot({ path: `${OUT}/02-chars.png` });
  await page.evaluate(() => document.querySelector('[data-action="start-knight"]').click());
  await frames(page, 40);
  await page.screenshot({ path: `${OUT}/03-start.png` });
  const info = await page.evaluate(() => ({ info: window.__fable.renderer.info(), phase: window.__fable.game().state.phase }));
  console.log(JSON.stringify(info).slice(0, 1500));
  // 봇으로 조금 플레이(페이지 안에서 로직 모듈을 불러 쓴다).
  await page.evaluate(async () => {
    const { botStep, createBot } = await import('/scripts/lib/bot.js');
    const bot = createBot();
    window.__fable.setAutopilot((g) => botStep(g, bot));
  });
  await page.evaluate(() => {
    setInterval(() => {
      const scr = window.__fable.ui.screens.current;
      if (scr === 'boon') document.querySelector('[data-boon]').click();
      if (scr === 'shop') document.querySelector('[data-action="back"]').click();
    }, 300);
  });
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${OUT}/04-play-${i}.png` });
  }
  const after = await page.evaluate(() => { const s = window.__fable.game().state; return { tick: s.tick, rooms: s.run.roomsCleared, kills: s.run.kills, screen: window.__fable.ui.screens.current, info: window.__fable.renderer.info().floor }; });
  console.log(JSON.stringify(after));
  console.log('problems', problems.slice(0, 10));
} finally {
  await browser.close();
  server.stop();
}
