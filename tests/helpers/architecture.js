// 아키텍처 규칙 검사기(테스트 전용). 소스 텍스트를 정적으로 훑어 CLAUDE.md 의 의존 규칙 위반을 찾는다.
// 규칙을 바꾸려면 CLAUDE.md 와 이 파일을 함께 고친다.

import { readdirSync } from 'node:fs';
import { join, posix } from 'node:path';

/** 계층별 허용 import. dir 아래 파일은 allow 에 있는 디렉터리와 bare 지정자만 import 할 수 있다. */
export const LAYERS = [
  { dir: 'data', allow: ['data'], bare: [], pure: true },
  { dir: 'src/logic', allow: ['src/logic', 'data'], bare: [], pure: true },
  { dir: 'src/render', allow: ['src/render', 'src/logic', 'data'], bare: ['three'], pure: false },
  { dir: 'src/ui', allow: ['src/ui', 'src/logic', 'data'], bare: [], pure: false },
  { dir: 'src/audio', allow: ['src/audio', 'src/logic', 'data'], bare: [], pure: false },
  { dir: 'src/save', allow: ['src/save', 'src/logic', 'data'], bare: [], pure: false },
];

/** 조립 지점: 모든 계층을 import 할 수 있는 유일한 파일. */
export const COMPOSITION_ROOT = 'src/main.js';

/**
 * src/logic 내부 모듈 순위. 자기보다 순위가 낮은 모듈만 import 할 수 있다(같은 순위끼리는 불가).
 * src/logic 바로 아래 파일(game.js)은 최상단이라 전부 import 할 수 있고, 어떤 모듈도 그것을 import 할 수 없다.
 */
export const LOGIC_RANK = { core: 0, world: 1, items: 1, entities: 2, combat: 3, save: 4 };

/** 순수 계층(data, src/logic)에서 쓸 수 없는 전역: DOM·브라우저 API·시계·타이머. */
const IMPURE_GLOBALS = [
  'document', 'window', 'navigator', 'location', 'localStorage', 'sessionStorage', 'indexedDB',
  'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'setInterval', 'fetch',
  'performance', 'Date', 'THREE', 'globalThis',
];
const IMPURE_RE = new RegExp(`(?<![.\\w$])(${IMPURE_GLOBALS.join('|')})\\b`, 'g');
const MATH_RANDOM_RE = /\bMath\s*\.\s*random\b/;
/**
 * 순수 계층에서 쓸 수 없는 Math 함수: 결과의 마지막 자리가 엔진마다 다를 수 있다(명세가 정확한 반올림을 요구하지 않는다).
 * 같은 시드가 기기마다 같은 결과를 내려면 사칙연산과 Math.sqrt·floor·ceil·round·abs·min·max·imul 만 쓴다.
 */
const INEXACT_MATH_RE = /\bMath\s*\.\s*(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|exp|expm1|log|log2|log10|log1p|pow|hypot|cbrt)\b/g;

const REGEX_PRECEDING_CHARS = new Set('(,=:[!&|?{};+-*%<>~^');
const REGEX_PRECEDING_WORDS = /(?:^|[^\w$.])(?:return|typeof|case|in|of|void|delete|throw|new|yield|await)$/;

/** 이 위치의 '/' 가 나눗셈이 아니라 정규식 리터럴의 시작인지, 앞선 코드로 판단한다. */
function startsRegex(codeBefore) {
  const trimmed = codeBefore.trimEnd();
  if (trimmed === '') return true;
  return REGEX_PRECEDING_CHARS.has(trimmed[trimmed.length - 1]) || REGEX_PRECEDING_WORDS.test(trimmed);
}

/**
 * 주석을 지운 소스(noComments)와, 주석과 문자열 내용까지 지운 소스(codeOnly)를 만든다.
 * 정규식 리터럴은 양쪽 모두에서 내용을 비운다(안에 든 따옴표·'//' 를 문자열·주석으로 오인하지 않도록).
 * 한계: 템플릿 리터럴의 ${} 안에 다시 백틱이 나오는 경우는 구분하지 못한다(BUGS.md 참고).
 */
export function stripSource(source) {
  let noComments = '';
  let codeOnly = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && source[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      const newlines = source.slice(i, stop).replace(/[^\n]/g, '');
      noComments += ` ${newlines}`;
      codeOnly += ` ${newlines}`;
      i = stop;
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n && source[j] !== c) j += source[j] === '\\' ? 2 : 1;
      const stop = Math.min(j + 1, n);
      noComments += source.slice(i, stop);
      codeOnly += c + c;
      i = stop;
    } else if (c === '/' && startsRegex(codeOnly)) {
      let j = i + 1;
      let inClass = false;
      while (j < n && source[j] !== '\n' && (inClass || source[j] !== '/')) {
        if (source[j] === '\\') j++;
        else if (source[j] === '[') inClass = true;
        else if (source[j] === ']') inClass = false;
        j++;
      }
      j = Math.min(j + 1, n);
      while (j < n && /[a-z]/.test(source[j])) j++;
      noComments += '/re/';
      codeOnly += '/re/';
      i = j;
    } else {
      noComments += c;
      codeOnly += c;
      i++;
    }
  }
  return { noComments, codeOnly };
}

/** import/export … from, 부수효과 import, 동적 import 의 지정자를 뽑는다. */
export function extractImports(noComments) {
  const specs = [];
  const patterns = [
    /\bfrom\s*(['"])([^'"\n]+)\1/g,
    /\bimport\s*(['"])([^'"\n]+)\1/g,
    /\bimport\s*\(\s*(['"`])([^'"`\n]+)\1/g,
  ];
  for (const re of patterns) {
    for (const m of noComments.matchAll(re)) specs.push(m[2]);
  }
  return specs;
}

function layerOf(relPath) {
  return LAYERS.find((l) => relPath.startsWith(`${l.dir}/`)) ?? null;
}

function inDir(relPath, dir) {
  return relPath.startsWith(`${dir}/`);
}

function logicModuleOf(relPath) {
  const rest = relPath.slice('src/logic/'.length);
  const slash = rest.indexOf('/');
  return slash === -1 ? null : rest.slice(0, slash);
}

/**
 * 파일 하나를 검사해 위반 메시지 목록을 돌려준다.
 * @param {string} relPath 저장소 루트 기준 경로(슬래시 구분). 예: 'src/logic/core/prng.js'
 * @param {string} source 파일 내용
 */
export function checkFile(relPath, source) {
  const violations = [];
  const { noComments, codeOnly } = stripSource(source);

  if (MATH_RANDOM_RE.test(codeOnly)) {
    violations.push(`${relPath}: Math.random 사용 금지 (시드 PRNG 를 쓸 것)`);
  }

  const isRuntime = relPath.startsWith('src/') || relPath.startsWith('data/');
  if (!isRuntime || relPath === COMPOSITION_ROOT) return violations;

  const layer = layerOf(relPath);
  if (!layer) {
    violations.push(`${relPath}: 어느 계층에도 속하지 않는 파일 (tests/helpers/architecture.js 의 LAYERS 에 계층을 추가할 것)`);
    return violations;
  }

  if (/\bimport\s*\(\s*[^'"`\s]/.test(noComments)) {
    violations.push(`${relPath}: 문자열 리터럴이 아닌 동적 import 는 검사할 수 없으므로 금지`);
  }

  if (layer.pure) {
    for (const name of new Set([...codeOnly.matchAll(INEXACT_MATH_RE)].map((m) => m[1]))) {
      violations.push(`${relPath}: 순수 계층에서 Math.${name} 사용 금지 (엔진마다 결과가 다를 수 있음 — 값을 미리 계산해 data 에 두거나 sqrt 로 푼다)`);
    }
    if (/\*\*/.test(codeOnly)) violations.push(`${relPath}: 순수 계층에서 ** 연산자 사용 금지 (Math.pow 와 같음 — 곱셈으로 쓴다)`);
    const found = new Set([...codeOnly.matchAll(IMPURE_RE)].map((m) => m[1]));
    for (const name of found) {
      violations.push(`${relPath}: 순수 계층에서 "${name}" 사용 금지 (DOM·브라우저 API·시계는 바깥 계층에서 주입)`);
    }
  }

  const selfModule = layer.dir === 'src/logic' ? logicModuleOf(relPath) : null;
  if (layer.dir === 'src/logic' && selfModule !== null && !(selfModule in LOGIC_RANK)) {
    violations.push(`${relPath}: 알 수 없는 로직 모듈 "${selfModule}" (LOGIC_RANK 에 순위를 정할 것)`);
  }

  for (const spec of extractImports(noComments)) {
    if (!spec.startsWith('.')) {
      const ok = layer.bare.some((b) => spec === b || spec.startsWith(`${b}/`));
      if (!ok) violations.push(`${relPath}: "${spec}" import 금지 (${layer.dir} 계층)`);
      continue;
    }
    const target = posix.normalize(posix.join(posix.dirname(relPath), spec));
    if (target === COMPOSITION_ROOT) {
      violations.push(`${relPath}: 조립 지점(${COMPOSITION_ROOT})은 import 할 수 없음`);
      continue;
    }
    if (!layer.allow.some((dir) => inDir(target, dir))) {
      violations.push(`${relPath}: "${spec}" → ${target} 는 ${layer.dir} 계층에서 import 할 수 없음`);
      continue;
    }
    if (layer.dir === 'src/logic' && inDir(target, 'src/logic') && selfModule !== null) {
      const targetModule = logicModuleOf(target);
      if (targetModule === null) {
        violations.push(`${relPath}: 로직 모듈은 최상단 파일(${target})을 import 할 수 없음`);
      } else if (targetModule !== selfModule && !(LOGIC_RANK[targetModule] < LOGIC_RANK[selfModule])) {
        violations.push(`${relPath}: logic/${selfModule} 는 logic/${targetModule} 을 import 할 수 없음 (순위 규칙)`);
      }
    }
  }

  return violations;
}

/** dir 아래의 .js/.mjs 파일을 저장소 루트 기준 경로(슬래시 구분)로 모은다. 디렉터리가 없으면 빈 배열. */
export function collectJsFiles(root, dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(join(root, dir), { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return out;
    throw err;
  }
  for (const entry of entries) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...collectJsFiles(root, rel));
    else if (/\.m?js$/.test(entry.name)) out.push(rel);
  }
  return out.sort();
}
