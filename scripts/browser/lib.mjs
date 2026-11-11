// 브라우저 검증용 공통 도구. Playwright(크로미움)로 실제 페이지를 띄운다.
//
// 이 프로젝트에는 npm 의존성이 없다. Playwright 는 이 스크립트를 돌리는 환경에 따로 설치돼 있어야 한다
// (없으면 안내를 내고 끝난다). 테스트(node --test)와 달리 어디서나 돌릴 수 있는 것은 아니다.
//
//   --three <폴더>   Three.js 패키지 폴더(three@0.186.1 의 압축을 푼 것). CDN 에 닿지 않는 환경에서 CDN 요청을 이 폴더로 돌린다.
//   --port <번호>    로컬 서버 포트(기본 8765)
//   --out <폴더>     화면 갈무리를 둘 곳

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CDN = 'https://cdn.jsdelivr.net/npm/three@0.186.1/';

export function option(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

export async function loadPlaywright() {
  try {
    return createRequire(import.meta.url)('playwright');
  } catch {
    console.error('Playwright 를 찾지 못했습니다. 이 스크립트는 Playwright 가 설치된 환경에서만 돌릴 수 있습니다.');
    process.exit(2);
    return null;
  }
}

/** 로컬 정적 서버를 띄운다. @returns {Promise<{ base:string, stop:() => void }>} */
export async function startServer() {
  const port = Number(option('port', 8765));
  const child = spawn(process.execPath, ['scripts/serve.mjs', '--port', String(port)], { cwd: ROOT, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${base}package.json`);
      if (res.ok) return { base, stop: () => child.kill() };
    } catch {
      // 아직 안 떴다.
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error('로컬 서버가 뜨지 않았습니다');
}

/**
 * 브라우저를 띄운다. 헤드리스 크로미움 + 소프트웨어 WebGL.
 * @returns {Promise<{ browser, open:(contextOptions:object, url:string) => Promise<{ context, page, problems:string[], cdp }> }>}
 */
export async function launch() {
  const { chromium, devices } = await loadPlaywright();
  const three = option('three');
  const browser = await chromium.launch({
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--js-flags=--expose-gc', '--autoplay-policy=user-gesture-required'],
  });
  async function open(contextOptions, url) {
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    const problems = [];
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    if (three) {
      await page.route('https://cdn.jsdelivr.net/**', async (route) => {
        const u = route.request().url();
        if (!u.startsWith(CDN)) return route.abort();
        const body = await readFile(`${three}/${u.slice(CDN.length)}`);
        return route.fulfill({ body, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } });
      });
    }
    const cdp = await context.newCDPSession(page);
    await page.goto(url);
    await page.waitForFunction(() => window.__fable !== undefined, null, { timeout: 15000 });
    return { context, page, problems, cdp };
  }
  return { browser, devices, open };
}

/** 가비지 컬렉션을 돌린 뒤의 JS 힙 사용량(바이트). */
export async function heapUsed(cdp) {
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = await cdp.send('Runtime.getHeapUsage');
  return usedSize;
}

/** 프레임을 n 번 기다린다. */
export function frames(page, n) {
  return page.evaluate((count) => new Promise((resolve) => {
    let left = count;
    const step = () => (--left <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  }), n);
}

/** CDP 로 터치 이벤트를 보낸다(여러 손가락을 한꺼번에). points: [{ id, x, y }] */
export function touch(cdp, type, points) {
  return cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 8, radiusY: 8, force: 1 })),
  });
}
