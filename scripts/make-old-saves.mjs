// 구버전 세이브 표본 만들기: 옛 단계 커밋의 실제 코드를 꺼내 돌려, 그 버전의 상태를 tests/fixtures/state-v<N>.json 에 쓴다.
// 마이그레이션 테스트가 "손으로 흉내 낸 옛 상태"가 아니라 "그 버전이 실제로 만든 상태"를 읽는지 확인하려는 것이다.
// 표본은 저장소에 들어 있으므로 평소에는 돌릴 필요가 없다. 다시 만들려면 git 이 있어야 한다.
//
//   node scripts/make-old-saves.mjs

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'tests', 'fixtures');

/** 상태 버전 → 그 버전을 만든 커밋(단계 완료 커밋). */
const COMMITS = { 1: 'be5e483', 2: 'c1e31f4', 3: 'cf3e126' };

const work = mkdtempSync(join(tmpdir(), 'fable-old-'));
const dirs = {};
for (const [version, commit] of Object.entries(COMMITS)) {
  const dir = join(work, `v${version}`);
  execFileSync('mkdir', ['-p', dir]);
  const tar = execFileSync('git', ['-C', ROOT, 'archive', commit]);
  execFileSync('tar', ['-x', '-C', dir], { input: tar });
  dirs[version] = dir;
}
const load = (version, path) => import(pathToFileURL(join(dirs[version], path)).href);
const save = (version, state) => {
  writeFileSync(join(OUT, `state-v${version}.json`), JSON.stringify(state));
  console.log(`v${version}: 필드 ${Object.keys(state).join(',')} · ${JSON.stringify(state).length}자 · 틱 ${state.tick}`);
};

try {
  // v1(0단계): 층에 들어가는 기능이 없다. 상태는 시드·틱·페이즈·난수·run.floor 뿐이다.
  {
    const g = await load(1, 'src/logic/game.js');
    const game = g.createGame({ seed: 'old-save-v1' });
    g.setPhase(game, 'playing');
    for (let i = 0; i < 90; i++) g.tick(game, 1 / 60);
    game.state.run.floor = 7; // v1 에는 층을 옮기는 로직이 없었다. 진행도가 이어지는지 보려고 손으로 넣는다.
    save(1, game.state);
  }
  // v2(1단계): 맵이 생겼다. 행동체는 아직 없다.
  {
    const g = await load(2, 'src/logic/game.js');
    const game = g.createGame({ seed: 'old-save-v2' });
    g.enterFloor(game, 12);
    g.setPhase(game, 'playing');
    for (let i = 0; i < 90; i++) g.tick(game, 1 / 60);
    save(2, game.state);
  }
  // v3(2단계): 전투 중인 상태. 그 층에 나오는 적을 플레이어 곁에 깨워 두고, 상태이상·기술 준비가 생길 때까지 싸운다.
  {
    const g = await load(3, 'src/logic/game.js');
    const actors = await load(3, 'src/logic/entities/actors.js');
    const game = g.createGame({ seed: 'old-save-v3' });
    g.enterFloor(game, 8);
    g.setPhase(game, 'playing');
    const s = game.state;
    const me = s.entities.byId[s.playerId];
    const types = [...new Set(s.world.spawns.filter((sp) => sp.kind === 'enemy').map((sp) => sp.id))].slice(0, 3);
    for (const type of types) {
      const spot = actors.findFreeSpot(s, me.x, me.y, 0.5, 4);
      if (spot) actors.spawnEnemy(s, game.bus, type, spot.x, spot.y, { alerted: true });
    }
    for (let i = 0; i < 3000 && s.phase === 'playing'; i++) {
      const p = s.entities.byId[s.playerId];
      let near = null;
      let nd = Infinity;
      for (const a of Object.values(s.entities.byId)) {
        if (a.faction !== 'enemy' || a.dead) continue;
        const d = (a.x - p.x) * (a.x - p.x) + (a.y - p.y) * (a.y - p.y);
        if (d < nd) {
          nd = d;
          near = a;
        }
      }
      s.input.moveX = near ? Math.sign(near.x - p.x) * 0.7 : 0;
      s.input.moveY = near ? Math.sign(near.y - p.y) * 0.7 : 0;
      s.input.attack = true;
      s.input.skill = i % 40 === 0 ? (i / 40) % 3 : -1;
      g.tick(game, 1 / 60);
      const fighting = Object.values(s.entities.byId).some((a) => a.faction === 'enemy' && a.ai.mode === 'combat');
      const busy = Object.values(s.entities.byId).filter((a) => a.action !== null).length;
      if (fighting && p.hp < p.maxHp && busy >= 2) break;
    }
    save(3, s);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
