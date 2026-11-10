// CLAUDE.md 의 고정 조건(계층 의존 방향, 순수 로직, Math.random 금지, Three.js 버전 고정)을 검사한다.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkFile, collectJsFiles, extractImports, stripSource } from './helpers/architecture.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

// ── 실제 저장소 검사 ─────────────────────────────────────────────────────────

test('저장소의 모든 소스가 계층 규칙을 지킨다', () => {
  const files = ['data', 'src', 'scripts', 'tests'].flatMap((dir) => collectJsFiles(root, dir));
  // 검사 대상이 비어 있으면 통과해도 의미가 없으므로 핵심 파일이 잡히는지 먼저 확인한다.
  for (const expected of ['data/config.js', 'src/main.js', 'src/logic/core/prng.js', 'src/render/renderer.js']) {
    assert.ok(files.includes(expected), `검사 대상에 ${expected} 가 없음`);
  }

  const violations = files.flatMap((rel) => checkFile(rel, read(rel)));

  assert.deepEqual(violations, []);
});

test('index.html: Three.js 는 importmap 으로 정확한 버전을 고정해 불러온다', () => {
  const html = read('index.html');
  const match = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  assert.ok(match, 'importmap 이 없음');
  const { imports } = JSON.parse(match[1]);

  const core = imports.three?.match(/^https:\/\/[^@]+\/three@(\d+\.\d+\.\d+)\/build\/three\.module\.js$/);
  assert.ok(core, `three 주소에 정확한 버전(x.y.z)이 없음: ${imports.three}`);
  const addons = imports['three/addons/']?.match(/^https:\/\/[^@]+\/three@(\d+\.\d+\.\d+)\/examples\/jsm\/$/);
  assert.ok(addons, `three/addons/ 주소에 정확한 버전이 없음: ${imports['three/addons/']}`);
  assert.equal(addons[1], core[1], 'three 와 three/addons/ 의 버전이 다름');

  assert.ok(html.indexOf('type="importmap"') < html.indexOf('type="module"'), 'importmap 은 모듈 스크립트보다 앞에 있어야 함');
  assert.ok(!/Math\s*\.\s*random/.test(html), 'index.html 에 Math.random 이 있음');
  assert.ok(!/(src|href)="\//.test(html), 'GitHub Pages 하위 경로에서 깨지는 절대 경로(/…)가 있음');
});

// ── 검사기 자체 검증: 위반을 실제로 잡아내는지 ───────────────────────────────

const has = (violations, text) => violations.some((v) => v.includes(text));

test('검사기: 로직이 three·DOM·시계를 쓰면 잡는다', () => {
  assert.ok(has(checkFile('src/logic/world/gen.js', `import * as THREE from 'three';`), '"three" import 금지'));
  assert.ok(has(checkFile('src/logic/world/gen.js', `const el = document.body;`), '"document"'));
  assert.ok(has(checkFile('src/logic/world/gen.js', `const t = Date.now();`), '"Date"'));
  assert.ok(has(checkFile('src/logic/world/gen.js', `const t = performance.now();`), '"performance"'));
  assert.ok(has(checkFile('src/logic/world/gen.js', `window.addEventListener('x', f);`), '"window"'));
  assert.ok(has(checkFile('data/enemies.js', `export const w = window.innerWidth;`), '"window"'));
});

test('검사기: 로직이 바깥 계층을 import 하면 잡는다', () => {
  assert.ok(has(checkFile('src/logic/world/gen.js', `import { x } from '../../render/renderer.js';`), 'import 할 수 없음'));
  assert.ok(has(checkFile('src/logic/world/gen.js', `import { x } from '../../ui/hud.js';`), 'import 할 수 없음'));
  assert.ok(has(checkFile('src/logic/world/gen.js', `export { x } from '../../main.js';`), '조립 지점'));
  assert.ok(has(checkFile('src/logic/world/gen.js', `import fs from 'node:fs';`), '"node:fs" import 금지'));
  assert.ok(has(checkFile('src/logic/world/gen.js', `const m = await import('../../audio/sfx.js');`), 'import 할 수 없음'));
  assert.ok(has(checkFile('src/logic/world/gen.js', `const m = await import(path);`), '동적 import'));
});

test('검사기: 로직 내부 모듈 순위를 어기면 잡는다', () => {
  assert.ok(has(checkFile('src/logic/core/state.js', `import { x } from '../world/gen.js';`), '순위 규칙'));
  assert.ok(has(checkFile('src/logic/world/gen.js', `import { x } from '../items/loot.js';`), '순위 규칙'));
  assert.ok(has(checkFile('src/logic/entities/spawn.js', `import { x } from '../combat/hit.js';`), '순위 규칙'));
  assert.ok(has(checkFile('src/logic/combat/hit.js', `import { tick } from '../game.js';`), '최상단 파일'));
  assert.ok(has(checkFile('src/logic/quests/q.js', `export const x = 1;`), '알 수 없는 로직 모듈'));
});

test('검사기: 허용된 로직 import 는 통과시킨다', () => {
  assert.deepEqual(checkFile('src/logic/world/gen.js', `import { Rng } from '../core/prng.js';\nimport { MAP } from '../../../data/map.js';`), []);
  assert.deepEqual(checkFile('src/logic/world/gen.js', `import { helper } from './rooms.js';`), []);
  assert.deepEqual(checkFile('src/logic/combat/hit.js', `import { a } from '../entities/e.js';\nimport { b } from '../items/i.js';`), []);
  assert.deepEqual(checkFile('src/logic/game.js', `import { a } from './combat/hit.js';\nimport { b } from './core/state.js';`), []);
});

test('검사기: 바깥 계층끼리의 import 와 미등록 계층을 잡는다', () => {
  assert.ok(has(checkFile('src/render/world/map.js', `import { x } from '../../ui/hud.js';`), 'import 할 수 없음'));
  assert.ok(has(checkFile('src/ui/hud.js', `import * as THREE from 'three';`), '"three" import 금지'));
  assert.ok(has(checkFile('src/audio/sfx.js', `import { x } from '../render/renderer.js';`), 'import 할 수 없음'));
  assert.ok(has(checkFile('src/net/socket.js', `export const x = 1;`), '어느 계층에도 속하지 않는'));
  assert.deepEqual(
    checkFile('src/render/world/map.js', `import * as THREE from 'three';\nimport { OrbitControls } from 'three/addons/controls/OrbitControls.js';\nimport { PHASE } from '../../logic/core/state.js';\nconst c = document.createElement('canvas');`),
    [],
  );
  assert.deepEqual(checkFile('src/main.js', `import { a } from './render/renderer.js';\nimport { b } from './ui/hud.js';\nconst t = Date.now();`), []);
});

test('검사기: Math.random 은 어느 계층에서든 잡는다', () => {
  assert.ok(has(checkFile('src/render/fx.js', `const r = Math.random();`), 'Math.random'));
  assert.ok(has(checkFile('src/main.js', `const r = Math . random();`), 'Math.random'));
  assert.ok(has(checkFile('src/logic/items/loot.js', `const { random } = Math; const r = Math.random;`), 'Math.random'));
  assert.ok(has(checkFile('tests/foo.test.js', `const r = Math.random();`), 'Math.random'));
});

test('검사기: 주석과 문자열 안의 언급은 위반으로 보지 않는다', () => {
  const source = [
    `// Math.random 과 document 는 쓰지 않는다. import x from 'three'`,
    `/* window.location, Date.now()`,
    `   import y from '../../render/renderer.js' */`,
    `const message = 'Math.random 금지, document 금지';`,
    'const other = `window 와 Date 도 금지`;',
    `const url = "http://example.com/a//b";`,
    `export const windowSize = 3, dated = message.window;`,
  ].join('\n');

  assert.deepEqual(checkFile('src/logic/core/x.js', source), []);
});

test('검사기: 정규식 리터럴 안의 따옴표·// 때문에 뒤따르는 코드를 놓치지 않는다', () => {
  assert.ok(has(checkFile('src/render/fx.js', `const re = /['"]/g;\nconst r = Math.random();`), 'Math.random'));
  assert.ok(has(checkFile('src/logic/core/x.js', `const re = /https?:\\/\\//;\nconst el = document.body;`), '"document"'));
  assert.ok(has(checkFile('src/logic/core/x.js', `const ok = /[/'"]+/.test(s);\nimport('../../ui/hud.js');`), 'import 할 수 없음'));
  assert.ok(has(checkFile('src/logic/core/x.js', `function f(s) { return /'/.test(s); }\nconst t = Date.now();`), '"Date"'));
  // 나눗셈은 정규식으로 오인하지 않는다.
  assert.ok(has(checkFile('src/render/fx.js', `const half = a / 2; const q = (b) / c;\nconst r = Math.random(); // d / e`), 'Math.random'));
  // 정규식 내용 자체는 위반이 아니다.
  assert.deepEqual(checkFile('src/logic/core/x.js', `export const re = /document|window|Math.random/;`), []);
});

test('stripSource/extractImports 기본 동작', () => {
  const { noComments, codeOnly } = stripSource(`import a from './a.js'; // './c.js'\nconst s = "it's // not a comment";`);
  assert.ok(noComments.includes(`"it's // not a comment"`));
  assert.ok(!noComments.includes('c.js'));
  assert.ok(!codeOnly.includes('a.js'));
  assert.ok(!codeOnly.includes('not a comment'));

  assert.deepEqual(
    extractImports(`import a from './a.js';\nimport './b.js';\nexport * from "./c.js";\nconst d = import('./d.js');\nimport {\n  e,\n} from './e.js';`).sort(),
    ['./a.js', './b.js', './c.js', './d.js', './e.js'],
  );
});
