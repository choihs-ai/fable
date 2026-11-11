#!/usr/bin/env node
// 테스트 러너. 의존성 없이 Node 내장 테스트 러너(node --test)로 tests/ 아래의 *.test.js 를 전부 실행한다.
//
//   node scripts/run-tests.mjs                       전체 실행
//   node scripts/run-tests.mjs prng                  경로에 "prng" 가 들어간 파일만
//   node scripts/run-tests.mjs --test-name-pattern=fork   node --test 옵션은 그대로 전달
//
// 테스트 파일을 하나도 찾지 못하면 실패로 처리한다("0개 통과"를 성공으로 오인하지 않도록).

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testsDir = join(root, 'tests');

function collect(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collect(full));
    else if (entry.name.endsWith('.test.js')) out.push(full);
  }
  return out;
}

const args = process.argv.slice(2);
const nodeOptions = args.filter((a) => a.startsWith('-'));
const filters = args.filter((a) => !a.startsWith('-'));

const all = collect(testsDir)
  .map((f) => relative(root, f).split('\\').join('/'))
  .sort();
const files = filters.length === 0 ? all : all.filter((f) => filters.some((x) => f.includes(x)));

if (files.length === 0) {
  console.error(
    filters.length === 0
      ? '테스트 파일이 없습니다: tests/**/*.test.js'
      : `필터에 맞는 테스트 파일이 없습니다: ${filters.join(', ')}`,
  );
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...nodeOptions, ...files], {
  cwd: root,
  stdio: 'inherit',
});
if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
