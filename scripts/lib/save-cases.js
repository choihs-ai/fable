// 손상된 런 세이브의 목록. 멀쩡한 세이브 하나(base)를 받아 한 군데를 망가뜨린 글을 만든다.
// tests/logic/save/corrupt.test.js 와 scripts/verify-save.mjs 가 함께 쓴다.
//
// 각 항목: { id, title, expect, corrupt(base) }
//   base    = { text, data } — 멀쩡한 세이브의 글과, 그 본문(파싱한 사본)
//   corrupt = 망가뜨린 글(또는 null = 저장소에 값이 없음)을 돌려준다
//   expect  = readRun 이 내야 하는 status:
//             'none'(쓸 수 없음 → 새 런) | 'salvage'(핵심만 건짐 → 그 층을 다시 만듦) | 'finished'(끝난 런)
// 묶음: text(글 자체가 깨짐) · env(봉투) · core(시드·층 등 핵심) · prog(진행도) · kit(무기·에너지·대시) · world(맵·방·문) · actor(행동체) · floor(그 밖의 층 상태)
// "체크섬이 맞는 손상"(본문을 고친 뒤 다시 봉함)이 대부분이다 — 체크섬이 걸러 주지 않아도 검증기가 잡아내는지를 본다.

import { SAVE } from '../../data/save.js';
import { STATE_VERSION } from '../../src/logic/core/state.js';
import { encodeEnvelope } from '../../src/logic/save/envelope.js';

const seal = (data, version = STATE_VERSION) => encodeEnvelope({ kind: 'run', version, data, savedAt: 1 });

/** 본문을 고친 뒤 올바른 체크섬으로 다시 봉한다. */
const edit = (fn) => ({ data }) => {
  const copy = structuredClone(data);
  fn(copy);
  return seal(copy);
};
/** 봉투의 필드를 고친다(본문은 그대로). */
const envelope = (fn) => ({ text }) => {
  const parsed = JSON.parse(text);
  fn(parsed);
  return JSON.stringify(parsed);
};

const playerOf = (d) => d.entities.byId[d.playerId];
const enemyOf = (d) => Object.values(d.entities.byId).find((a) => a.kind !== 'player');
const kitOf = (d) => playerOf(d).kit;
const roomOf = (d, kind) => d.world.rooms.find((r) => r.kind === kind);
/** 전투 중인 방. */
const activeRoom = (d) => d.world.rooms[d.encounter.room];
const freshId = (d) => d.entities.nextId++;
/** 오른쪽 이웃이 벽인 바닥 칸. */
function cellBesideWall(world) {
  const { width: w, height: h, tiles } = world;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (tiles[y * w + x] === 1 && tiles[y * w + x + 1] === 0) return { x, y };
    }
  }
  throw new Error('벽 옆 칸을 찾지 못함');
}
const projectile = (d) => ({
  id: freshId(d), ownerId: d.playerId, faction: 'player', x: playerOf(d).x, y: playerOf(d).y, vx: 6, vy: 0, radius: 0.2,
  damage: 5, power: 1, knockback: 0, status: null, left: 8, pierce: 0, hit: [], explode: null, bounces: 0, split: false, proc: true,
});
const hazard = (d) => ({
  id: freshId(d), kind: 'blast', ownerId: d.playerId, faction: 'player', x: playerOf(d).x, y: playerOf(d).y, radius: 1.5, damage: 3, power: 1,
  status: null, nextAt: d.tick + 30, interval: 30, endAt: d.tick + 120, slow: 1, proc: true,
});
const drop = (d, extra) => ({ id: freshId(d), x: playerOf(d).x, y: playerOf(d).y, ...extra });

export const CASES = [
  // ── 글 자체가 깨짐 ──
  { id: 'text-missing', title: '저장소에 값이 없음', expect: 'none', corrupt: () => null },
  { id: 'text-empty', title: '빈 문자열', expect: 'none', corrupt: () => '' },
  { id: 'text-blank', title: '공백뿐', expect: 'none', corrupt: () => ' \n\t ' },
  { id: 'text-half', title: '절반에서 잘림', expect: 'none', corrupt: ({ text }) => text.slice(0, text.length >> 1) },
  { id: 'text-last-char', title: '마지막 한 글자가 잘림', expect: 'none', corrupt: ({ text }) => text.slice(0, -1) },
  { id: 'text-first-char', title: '첫 글자가 잘림', expect: 'none', corrupt: ({ text }) => text.slice(1) },
  { id: 'text-not-json', title: 'JSON 이 아닌 글', expect: 'none', corrupt: () => 'fable save file' },
  { id: 'text-number', title: 'JSON 이지만 숫자', expect: 'none', corrupt: () => '12345' },
  { id: 'text-array', title: 'JSON 이지만 배열', expect: 'none', corrupt: ({ text }) => `[${text}]` },
  { id: 'text-null', title: 'JSON null', expect: 'none', corrupt: () => 'null' },
  { id: 'text-double', title: '두 번 감싼 JSON(문자열 속의 JSON)', expect: 'none', corrupt: ({ text }) => JSON.stringify(text) },
  { id: 'text-nan', title: '숫자 자리에 NaN', expect: 'none', corrupt: ({ text }) => text.replace(/"tick":\d+/, '"tick":NaN') },
  { id: 'text-nul', title: '맨 앞에 NUL 문자', expect: 'none', corrupt: ({ text }) => `\u0000${text}` },
  { id: 'text-trailing', title: '끝에 쓰레기가 붙음', expect: 'none', corrupt: ({ text }) => `${text}}}garbage` },
  { id: 'text-huge', title: '터무니없이 긴 글', expect: 'none', corrupt: ({ text }) => text + ' '.repeat(SAVE.maxTextLength) },
  { id: 'text-digit', title: '본문의 숫자 한 자리가 바뀜(체크섬 불일치)', expect: 'salvage', corrupt: ({ text }) => text.replace(/"tick":(\d+)/, (m, n) => `"tick":${Number(n) + 1}`) },
  // 올바른 JSON 으로 남는 손상: 난수 상태 배열의 앞 두 값을 맞바꾼다(체크섬만이 알아챌 수 있다).
  { id: 'text-swap', title: '본문의 두 값이 뒤바뀜(체크섬 불일치)', expect: 'salvage', corrupt: ({ text }) => text.replace(/"s":\[(\d+),(\d+),/, '"s":[$2,$1,') },

  // ── 봉투 ──
  { id: 'env-format', title: '형식 이름이 다름', expect: 'none', corrupt: envelope((e) => { e.format = 'other-game'; }) },
  { id: 'env-kind', title: '다른 종류의 세이브(meta)', expect: 'none', corrupt: envelope((e) => { e.kind = 'meta'; }) },
  { id: 'env-version-missing', title: '버전이 없음', expect: 'none', corrupt: envelope((e) => { delete e.version; }) },
  { id: 'env-version-string', title: '버전이 문자열', expect: 'none', corrupt: envelope((e) => { e.version = String(STATE_VERSION); }) },
  { id: 'env-version-zero', title: '버전이 0', expect: 'none', corrupt: envelope((e) => { e.version = 0; }) },
  { id: 'env-version-float', title: '버전이 소수', expect: 'none', corrupt: envelope((e) => { e.version = 2.5; }) },
  { id: 'env-version-future', title: '이 프로그램보다 새 버전', expect: 'none', corrupt: envelope((e) => { e.version = STATE_VERSION + 95; }) },
  { id: 'env-data-missing', title: '본문이 없음', expect: 'none', corrupt: envelope((e) => { delete e.data; }) },
  { id: 'env-data-array', title: '본문이 배열', expect: 'none', corrupt: envelope((e) => { e.data = [e.data]; }) },
  { id: 'env-checksum-missing', title: '체크섬이 없음', expect: 'salvage', corrupt: envelope((e) => { delete e.checksum; }) },
  { id: 'env-checksum-wrong', title: '체크섬이 틀림', expect: 'salvage', corrupt: envelope((e) => { e.checksum = '00000000'; }) },
  { id: 'env-version-lie', title: '봉투는 현재 버전인데 본문은 옛 버전', expect: 'salvage', corrupt: edit((d) => { d.version = STATE_VERSION - 1; }) },
  { id: 'env-version-retired', title: '방 단위 구조 이전의 런(버전 4)', expect: 'none', corrupt: envelope((e) => { e.version = 4; }) },
  { id: 'env-version-one', title: '아주 옛 버전(버전 1)', expect: 'none', corrupt: envelope((e) => { e.version = 1; }) },

    // ── 핵심(시드·층): 여기가 틀리면 그 런은 되살릴 수 없다 ──
  { id: 'core-seed-missing', title: '시드가 없음', expect: 'none', corrupt: edit((d) => { delete d.seed; }) },
  { id: 'core-seed-number', title: '시드가 숫자', expect: 'none', corrupt: edit((d) => { d.seed = 12345; }) },
  { id: 'core-seed-empty', title: '시드가 빈 문자열', expect: 'none', corrupt: edit((d) => { d.seed = ''; }) },
  { id: 'core-seed-long', title: '시드가 너무 김', expect: 'none', corrupt: edit((d) => { d.seed = 's'.repeat(5000); }) },
  { id: 'core-run-missing', title: '진행도(run)가 없음', expect: 'none', corrupt: edit((d) => { delete d.run; }) },
  { id: 'core-run-array', title: '진행도가 배열', expect: 'none', corrupt: edit((d) => { d.run = [1, 2, 3]; }) },
  { id: 'core-floor-zero', title: '층이 0', expect: 'none', corrupt: edit((d) => { d.run.floor = 0; }) },
  { id: 'core-floor-over', title: '층이 마지막 층보다 큼', expect: 'none', corrupt: edit((d) => { d.run.floor = 31; }) },
  { id: 'core-floor-string', title: '층이 문자열', expect: 'none', corrupt: edit((d) => { d.run.floor = '1'; }) },
  { id: 'core-floor-float', title: '층이 소수', expect: 'none', corrupt: edit((d) => { d.run.floor = 1.5; }) },

  // ── 진행도: 틀린 항목만 기본값으로 되돌리고 나머지는 살린다 ──
  { id: 'prog-tick-negative', title: '틱이 음수', expect: 'salvage', corrupt: edit((d) => { d.tick = -5; }) },
  { id: 'prog-tick-null', title: '틱이 null(NaN 이 저장된 경우)', expect: 'salvage', corrupt: edit((d) => { d.tick = null; }) },
  { id: 'prog-tick-string', title: '틱이 문자열', expect: 'salvage', corrupt: edit((d) => { d.tick = '120'; }) },
  { id: 'prog-phase-unknown', title: '모르는 페이즈', expect: 'salvage', corrupt: edit((d) => { d.phase = 'cutscene'; }) },
  { id: 'prog-phase-title', title: '페이즈가 타이틀', expect: 'salvage', corrupt: edit((d) => { d.phase = 'title'; }) },
  { id: 'prog-rng-missing', title: '난수 스트림 하나가 없음', expect: 'salvage', corrupt: edit((d) => { delete d.rng.combat; }) },
  { id: 'prog-rng-range', title: '난수 상태가 32비트 범위 밖', expect: 'salvage', corrupt: edit((d) => { d.rng.items.s[2] = 4294967296; }) },
  { id: 'prog-rng-short', title: '난수 상태의 길이가 다름', expect: 'salvage', corrupt: edit((d) => { d.rng.world.key.pop(); }) },
  { id: 'prog-character-unknown', title: '모르는 캐릭터', expect: 'salvage', corrupt: edit((d) => { d.run.character = 'ninja'; }) },
  { id: 'prog-character-proto', title: '캐릭터 이름이 "constructor"', expect: 'salvage', corrupt: edit((d) => { d.run.character = 'constructor'; }) },
  { id: 'prog-gold-negative', title: '금화가 음수', expect: 'salvage', corrupt: edit((d) => { d.run.gold = -50; }) },
  { id: 'prog-gold-float', title: '금화가 소수', expect: 'salvage', corrupt: edit((d) => { d.run.gold = 10.5; }) },
  { id: 'prog-gold-huge', title: '금화가 1e21', expect: 'salvage', corrupt: edit((d) => { d.run.gold = 1e21; }) },
  { id: 'prog-boon-unknown', title: '모르는 축복', expect: 'salvage', corrupt: edit((d) => { d.run.boons.push('omnipotence'); }) },
  { id: 'prog-boon-proto', title: '축복 이름이 "toString"', expect: 'salvage', corrupt: edit((d) => { d.run.boons.push('toString'); }) },
  { id: 'prog-boon-duplicate', title: '같은 축복이 둘', expect: 'salvage', corrupt: edit((d) => { d.run.boons.push('chain', 'chain'); }) },
  { id: 'prog-boons-object', title: '축복 목록이 배열이 아님', expect: 'salvage', corrupt: edit((d) => { d.run.boons = { chain: true }; }) },
  { id: 'prog-boonstate-missing', title: '축복의 진행 상태가 없음', expect: 'salvage', corrupt: edit((d) => { delete d.run.boonState; }) },
  { id: 'prog-boonstate-far', title: '축복의 재사용 대기가 터무니없이 먼 미래', expect: 'salvage', corrupt: edit((d) => { d.run.boonState.iceArmorAt = 1900000000; }) },
  { id: 'prog-choice-unknown', title: '제시된 축복 후보가 모르는 이름', expect: 'salvage', corrupt: edit((d) => { d.run.choice = { kind: 'boon', options: ['nope'], rerolls: 0 }; }) },
  { id: 'prog-choice-empty', title: '제시된 후보가 비어 있음', expect: 'salvage', corrupt: edit((d) => { d.run.choice = { kind: 'boon', options: [], rerolls: 0 }; }) },
  { id: 'prog-choice-kind', title: '모르는 종류의 3택1', expect: 'salvage', corrupt: edit((d) => { d.run.choice = { kind: 'relic', options: ['chain'], rerolls: 0 }; }) },
  { id: 'prog-depth-negative', title: '방의 깊이가 음수', expect: 'salvage', corrupt: edit((d) => { d.run.depth = -1; }) },
  { id: 'prog-field-missing', title: '진행도의 필드 하나가 없음(kills)', expect: 'salvage', corrupt: edit((d) => { delete d.run.kills; }) },
  { id: 'prog-field-old', title: '옛 구조의 필드가 섞여 있음(level)', expect: 'salvage', corrupt: edit((d) => { d.run.level = 3; }) },
  { id: 'prog-ended', title: '끝난 런(ended)', expect: 'finished', corrupt: edit((d) => { d.run.ended = true; }) },
  { id: 'prog-game-over', title: '끝난 런(gameOver 페이즈)', expect: 'finished', corrupt: edit((d) => { d.phase = 'gameOver'; }) },
  { id: 'prog-victory', title: '끝난 런(victory 페이즈)', expect: 'finished', corrupt: edit((d) => { d.phase = 'victory'; }) },

  // ── 플레이어의 무기·에너지·대시: 올바른 것만 남긴다 ──
  { id: 'kit-missing', title: '플레이어의 장비 묶음(kit)이 없음', expect: 'salvage', corrupt: edit((d) => { delete playerOf(d).kit; }) },
  { id: 'kit-weapon-unknown', title: '모르는 무기', expect: 'salvage', corrupt: edit((d) => { kitOf(d).weapons[0] = 'lightsaber'; }) },
  { id: 'kit-weapon-proto', title: '무기 이름이 "constructor"', expect: 'salvage', corrupt: edit((d) => { kitOf(d).weapons[1] = 'constructor'; }) },
  { id: 'kit-weapons-three', title: '무기 칸이 셋', expect: 'salvage', corrupt: edit((d) => { kitOf(d).weapons.push('bow'); }) },
  { id: 'kit-weapons-empty', title: '무기가 하나도 없음', expect: 'salvage', corrupt: edit((d) => { kitOf(d).weapons = [null, null]; }) },
  { id: 'kit-slot-empty', title: '든 칸이 빈 칸', expect: 'salvage', corrupt: edit((d) => { kitOf(d).weapons = ['sword', null]; kitOf(d).slot = 1; }) },
  { id: 'kit-slot-range', title: '든 칸 번호가 범위 밖', expect: 'salvage', corrupt: edit((d) => { kitOf(d).slot = 2; }) },
  { id: 'kit-energy-negative', title: '에너지가 음수', expect: 'salvage', corrupt: edit((d) => { kitOf(d).energy = -10; }) },
  { id: 'kit-energy-over', title: '에너지가 최대치보다 큼', expect: 'salvage', corrupt: edit((d) => { kitOf(d).energy = kitOf(d).maxEnergy + 500; }) },
  { id: 'kit-energy-null', title: '에너지가 null(NaN 이 저장된 경우)', expect: 'salvage', corrupt: edit((d) => { kitOf(d).energy = null; }) },
  { id: 'kit-charges-over', title: '대시 충전이 최대치보다 큼', expect: 'salvage', corrupt: edit((d) => { kitOf(d).charges = 9; }) },
  { id: 'kit-charges-negative', title: '대시 충전이 음수', expect: 'salvage', corrupt: edit((d) => { kitOf(d).charges = -1; }) },
  { id: 'kit-recharge-zero', title: '대시 충전 시간이 0(끝없이 충전)', expect: 'salvage', corrupt: edit((d) => { kitOf(d).rechargeTicks = 0; }) },
  { id: 'kit-buffer-kind', title: '입력 버퍼에 모르는 입력', expect: 'salvage', corrupt: edit((d) => { kitOf(d).buffer = { kind: 'jump', until: d.tick + 5 }; }) },
  { id: 'kit-character', title: '플레이어의 캐릭터가 런의 캐릭터와 다름', expect: 'salvage', corrupt: edit((d) => { kitOf(d).character = d.run.character === 'knight' ? 'mage' : 'knight'; }) },
  { id: 'kit-timer-far', title: '쌍수 사격이 터무니없이 먼 미래까지', expect: 'salvage', corrupt: edit((d) => { kitOf(d).dualUntil = 1900000000; }) },
  { id: 'kit-on-enemy', title: '적에게 플레이어의 장비 묶음이 있음', expect: 'salvage', corrupt: edit((d) => { enemyOf(d).kit = structuredClone(kitOf(d)); }) },

  // ── 맵·방·문 ──
  { id: 'world-null', title: '맵이 없음', expect: 'salvage', corrupt: edit((d) => { d.world = null; }) },
  { id: 'world-tiles-short', title: '타일 배열이 짧음', expect: 'salvage', corrupt: edit((d) => { d.world.tiles.length -= 10; }) },
  { id: 'world-tiles-value', title: '타일에 모르는 값', expect: 'salvage', corrupt: edit((d) => { d.world.tiles[d.world.width + 1] = 7; }) },
  { id: 'world-border', title: '테두리가 뚫림', expect: 'salvage', corrupt: edit((d) => { d.world.tiles[3] = 1; }) },
  { id: 'world-start-wall', title: '시작점이 벽 속', expect: 'salvage', corrupt: edit((d) => { d.world.start = { x: 0, y: 0 }; }) },
  { id: 'world-width', title: '맵 너비가 타일 수와 맞지 않음', expect: 'salvage', corrupt: edit((d) => { d.world.width += 1; }) },
  { id: 'world-size-huge', title: '맵 크기가 터무니없이 큼', expect: 'salvage', corrupt: edit((d) => { d.world.width = 1e9; }) },
  { id: 'world-floor-mismatch', title: '맵의 층이 진행 중인 층과 다름', expect: 'salvage', corrupt: edit((d) => { d.world.floor = 2; }) },
  { id: 'world-zone', title: '모르는 구역', expect: 'salvage', corrupt: edit((d) => { d.world.zoneId = 'moon'; }) },
  { id: 'world-rooms-empty', title: '방 목록이 비어 있음', expect: 'salvage', corrupt: edit((d) => { d.world.rooms = []; }) },
  { id: 'world-room-id', title: '방의 번호가 순번과 다름', expect: 'salvage', corrupt: edit((d) => { d.world.rooms[2].id = 7; }) },
  { id: 'world-room-kind', title: '모르는 종류의 방', expect: 'salvage', corrupt: edit((d) => { d.world.rooms[2].kind = 'lobby'; }) },
  { id: 'world-room-outside', title: '방이 맵 밖으로 나감', expect: 'salvage', corrupt: edit((d) => { d.world.rooms[2].w = 400; }) },
  { id: 'world-room-state', title: '모르는 방 상태', expect: 'salvage', corrupt: edit((d) => { d.world.rooms[2].state = 'haunted'; }) },
  { id: 'world-room-two-active', title: '전투 중인 방이 둘', expect: 'salvage', corrupt: edit((d) => {
    // 아직 들어가지 않은 전투방을 전투 중으로 바꾼다. 판의 끝 무렵이라 그런 방이 없으면 이미 깬 전투방을 쓴다.
    const rooms = d.world.rooms.filter((r) => r.waves.length > 0 && r.state !== 'active');
    (rooms.find((r) => r.state === 'idle') ?? rooms[0]).state = 'active';
  }) },
  { id: 'world-room-wave', title: '웨이브 번호가 웨이브 수를 벗어남', expect: 'salvage', corrupt: edit((d) => { activeRoom(d).wave = 9; }) },
  { id: 'world-room-enemy', title: '웨이브에 없는 적', expect: 'salvage', corrupt: edit((d) => { roomOf(d, 'boss').waves[0][0].type = 'dragon_god'; }) },
  { id: 'world-room-enemy-proto', title: '웨이브의 적 이름이 "constructor"', expect: 'salvage', corrupt: edit((d) => { roomOf(d, 'boss').waves[0][0].type = 'constructor'; }) },
  { id: 'world-room-spawn-wall', title: '적이 나타나는 자리가 벽', expect: 'salvage', corrupt: edit((d) => { roomOf(d, 'boss').spawnCells[0] = 0; }) },
  { id: 'world-room-spawn-none', title: '웨이브는 있는데 나타날 자리가 없음', expect: 'salvage', corrupt: edit((d) => { roomOf(d, 'boss').spawnCells = []; }) },
  { id: 'world-room-feature', title: '방의 한가운데 자리가 벽 속', expect: 'salvage', corrupt: edit((d) => { roomOf(d, 'shop').feature = { x: 0, y: 0 }; }) },
  { id: 'world-room-reward', title: '모르는 보상', expect: 'salvage', corrupt: edit((d) => { d.world.rooms[2].reward = 'relic'; }) },
  { id: 'world-room-door', title: '방의 문 목록에 다른 방의 문', expect: 'salvage', corrupt: edit((d) => { const r = d.world.rooms[2]; r.doors.push(d.world.doors.findIndex((x) => x.room !== r.id)); }) },
  { id: 'world-door-range', title: '문이 없는 방을 가리킴', expect: 'salvage', corrupt: edit((d) => { d.world.doors[0].to = 99; }) },
  { id: 'world-door-link', title: '문이 없는 복도를 가리킴', expect: 'salvage', corrupt: edit((d) => { d.world.doors[0].link = 999; }) },
  { id: 'world-door-cell', title: '문의 칸이 맵 밖', expect: 'salvage', corrupt: edit((d) => { d.world.doors[0].cells[0] = 9999999; }) },
  { id: 'world-door-open-lie', title: '잠긴 문인데 열려 있다고 적힘', expect: 'salvage', corrupt: edit((d) => { d.world.doors[activeRoom(d).doors[0]].open = true; }) },
  { id: 'world-door-tile-lie', title: '열린 문인데 타일은 닫혀 있음', expect: 'salvage', corrupt: edit((d) => { const door = d.world.doors.find((x) => x.open); d.world.tiles[door.cells[0]] = 2; }) },
  { id: 'world-door-stray', title: '어느 문에도 속하지 않는 닫힌 문 타일', expect: 'salvage', corrupt: edit((d) => { const f = d.world.rooms[2].feature; d.world.tiles[f.y * d.world.width + f.x] = 2; }) },
  { id: 'world-links-short', title: '복도 목록이 타일보다 적음(플레이어가 선 복도를 찾지 못한다)', expect: 'salvage', corrupt: edit((d) => { d.world.links.pop(); }) },
  { id: 'world-link-rooms', title: '복도가 잇는 방이 타일과 다름', expect: 'salvage', corrupt: edit((d) => { d.world.links[0].rooms.reverse(); }) },
  { id: 'world-wall-in-corridor', title: '복도가 벽으로 막혀 구조가 달라짐', expect: 'salvage', corrupt: edit((d) => { const door = d.world.doors.find((x) => x.open && !x.secret); for (const c of door.cells) d.world.tiles[c] = 0; }) },

  // ── 행동체 ──
  { id: 'actor-entities-missing', title: '행동체 목록이 없음', expect: 'salvage', corrupt: edit((d) => { delete d.entities; }) },
  { id: 'actor-byid-array', title: '행동체 목록이 배열', expect: 'salvage', corrupt: edit((d) => { d.entities.byId = Object.values(d.entities.byId); }) },
  { id: 'actor-id-mismatch', title: '행동체의 번호가 키와 다름', expect: 'salvage', corrupt: edit((d) => { enemyOf(d).id += 1000; }) },
  { id: 'actor-no-player', title: '플레이어가 없음', expect: 'salvage', corrupt: edit((d) => { delete d.entities.byId[d.playerId]; }) },
  { id: 'actor-two-players', title: '플레이어가 둘', expect: 'salvage', corrupt: edit((d) => { const id = freshId(d); d.entities.byId[id] = { ...structuredClone(playerOf(d)), id }; }) },
  { id: 'actor-player-id', title: 'playerId 가 적을 가리킴', expect: 'salvage', corrupt: edit((d) => { d.playerId = enemyOf(d).id; }) },
  { id: 'actor-player-id-null', title: 'playerId 가 null', expect: 'salvage', corrupt: edit((d) => { d.playerId = null; }) },
  { id: 'actor-type', title: '모르는 적 종류', expect: 'salvage', corrupt: edit((d) => { enemyOf(d).type = 'dragon_god'; }) },
  { id: 'actor-type-proto', title: '적 종류가 "constructor"', expect: 'salvage', corrupt: edit((d) => { enemyOf(d).type = 'constructor'; }) },
  { id: 'actor-kind', title: '플레이어인데 종류가 적', expect: 'salvage', corrupt: edit((d) => { playerOf(d).type = 'bat'; }) },
  { id: 'actor-x-null', title: '위치가 null(NaN 이 저장된 경우)', expect: 'salvage', corrupt: edit((d) => { enemyOf(d).x = null; }) },
  { id: 'actor-outside', title: '맵 밖의 위치', expect: 'salvage', corrupt: edit((d) => { playerOf(d).x = -40; }) },
  { id: 'actor-in-wall', title: '벽 속의 위치', expect: 'salvage', corrupt: edit((d) => { playerOf(d).x = 0.5; playerOf(d).y = 0.5; }) },
  { id: 'actor-in-door', title: '잠긴 문 속의 위치', expect: 'salvage', corrupt: edit((d) => { const c = d.world.doors[activeRoom(d).doors[0]].cells[0]; playerOf(d).x = (c % d.world.width) + 0.5; playerOf(d).y = Math.floor(c / d.world.width) + 0.5; }) },
  { id: 'actor-body-wall', title: '몸이 벽과 겹침(벽 옆 칸에서 반지름이 커짐)', expect: 'salvage', corrupt: edit((d) => { const c = cellBesideWall(d.world); Object.assign(playerOf(d), { x: c.x + 0.5, y: c.y + 0.5, radius: 1.5 }); }) },
  { id: 'actor-hp-over', title: '체력이 최대 체력보다 큼', expect: 'salvage', corrupt: edit((d) => { enemyOf(d).hp = enemyOf(d).maxHp + 500; }) },
  { id: 'actor-hp-float', title: '체력이 소수', expect: 'salvage', corrupt: edit((d) => { playerOf(d).hp = 12.75; }) },
  { id: 'actor-maxhp-zero', title: '최대 체력이 0', expect: 'salvage', corrupt: edit((d) => { enemyOf(d).maxHp = 0; enemyOf(d).hp = 0; }) },
  { id: 'actor-facing-zero', title: '바라보는 방향이 (0, 0)', expect: 'salvage', corrupt: edit((d) => { playerOf(d).facingX = 0; playerOf(d).facingY = 0; }) },
  { id: 'actor-armor-negative', title: '방어력이 음수(나눗셈이 0 이 될 수 있음)', expect: 'salvage', corrupt: edit((d) => { enemyOf(d).armor = -30; }) },
  { id: 'actor-mass-zero', title: '무게가 0(넉백이 무한대가 된다)', expect: 'salvage', corrupt: edit((d) => { enemyOf(d).mass = 0; }) },
  { id: 'actor-knockback-null', title: '넉백 속도가 null(NaN 이 저장된 경우)', expect: 'salvage', corrupt: edit((d) => { enemyOf(d).kbX = null; }) },
  { id: 'actor-knockback-huge', title: '넉백 속도가 터무니없이 큼', expect: 'salvage', corrupt: edit((d) => { enemyOf(d).kbY = 1e12; }) },
  { id: 'actor-elite-string', title: '정예 표시가 문자열', expect: 'salvage', corrupt: edit((d) => { enemyOf(d).elite = 'yes'; }) },
  { id: 'actor-speed-string', title: '속도가 문자열', expect: 'salvage', corrupt: edit((d) => { enemyOf(d).speed = 'fast'; }) },
  { id: 'actor-action', title: '그 행동체에 없는 기술을 쓰는 중', expect: 'salvage', corrupt: edit((d) => { enemyOf(d).action = { ability: 'meteor', phase: 'windup', until: d.tick + 10, dirX: 1, dirY: 0, targetX: 1, targetY: 1 }; }) },
  { id: 'actor-action-weapon', title: '플레이어가 없는 무기의 기술을 쓰는 중', expect: 'salvage', corrupt: edit((d) => { playerOf(d).action = { ability: 'w:lightsaber', phase: 'recover', until: d.tick + 10, dirX: 1, dirY: 0, targetX: 1, targetY: 1 }; }) },
  { id: 'actor-status', title: '모르는 상태이상', expect: 'salvage', corrupt: edit((d) => { playerOf(d).statuses.petrify = { stacks: 1, until: d.tick + 60, nextTick: 0, sourceId: 1 }; }) },
  { id: 'actor-status-stacks', title: '상태이상 중첩이 0', expect: 'salvage', corrupt: edit((d) => { playerOf(d).statuses.poison = { stacks: 0, until: d.tick + 60, nextTick: d.tick + 5, sourceId: 1 }; }) },
  { id: 'actor-died-with', title: '죽을 때의 상태이상 목록에 모르는 이름', expect: 'salvage', corrupt: edit((d) => { enemyOf(d).diedWith = ['petrify']; }) },
  { id: 'actor-ai-null', title: '적의 AI 상태가 없음', expect: 'salvage', corrupt: edit((d) => { enemyOf(d).ai = null; }) },
  { id: 'actor-ai-mode', title: '모르는 AI 상태(옛 구조의 "복귀")', expect: 'salvage', corrupt: edit((d) => { enemyOf(d).ai.mode = 'return'; }) },
  { id: 'actor-ai-phase', title: '페이즈가 범위를 벗어남', expect: 'salvage', corrupt: edit((d) => { enemyOf(d).ai.phase = 9; }) },
  { id: 'actor-ai-path', title: '경로에 맵 밖의 칸', expect: 'salvage', corrupt: edit((d) => { enemyOf(d).ai.nav.path = [5, 999999]; enemyOf(d).ai.nav.idx = 0; }) },
  { id: 'actor-ai-idx', title: '경로 위치가 길이를 벗어남', expect: 'salvage', corrupt: edit((d) => { enemyOf(d).ai.nav.path = [d.world.start.y * d.world.width + d.world.start.x]; enemyOf(d).ai.nav.idx = 5; }) },
  { id: 'actor-cooldown-far', title: '재사용 대기가 터무니없이 먼 미래', expect: 'salvage', corrupt: edit((d) => { playerOf(d).cooldowns.skill = 1900000000; }) },
  { id: 'actor-field-missing', title: '행동체의 필드 하나가 없음(radius)', expect: 'salvage', corrupt: edit((d) => { delete enemyOf(d).radius; }) },
  { id: 'actor-field-extra', title: '행동체에 모르는 필드', expect: 'salvage', corrupt: edit((d) => { enemyOf(d).godMode = true; }) },
  { id: 'actor-next-id', title: '다음 번호가 이미 쓴 번호보다 작음', expect: 'salvage', corrupt: edit((d) => { d.entities.nextId = 1; }) },
  { id: 'actor-dead-player', title: '플레이어가 죽었는데 런이 끝나지 않음', expect: 'salvage', corrupt: edit((d) => { playerOf(d).dead = true; playerOf(d).hp = 0; }) },

  // ── 그 밖의 층 상태 ──
  { id: 'floor-projectiles-null', title: '투사체 목록이 null', expect: 'salvage', corrupt: edit((d) => { d.projectiles = null; }) },
  { id: 'floor-projectile-outside', title: '투사체가 맵 밖', expect: 'salvage', corrupt: edit((d) => { d.projectiles.push({ ...projectile(d), x: 1e7 }); }) },
  { id: 'floor-projectile-velocity', title: '투사체 속도가 null', expect: 'salvage', corrupt: edit((d) => { d.projectiles.push({ ...projectile(d), vx: null }); }) },
  { id: 'floor-projectile-status', title: '투사체에 모르는 상태이상', expect: 'salvage', corrupt: edit((d) => { d.projectiles.push({ ...projectile(d), status: { id: 'doom' } }); }) },
  { id: 'floor-projectile-explode', title: '투사체의 폭발 반지름이 문자열', expect: 'salvage', corrupt: edit((d) => { d.projectiles.push({ ...projectile(d), explode: { radius: 'big', damage: 5, knockback: 0, status: null } }); }) },
  { id: 'floor-projectile-pierce', title: '투사체의 꿰뚫는 수가 음수', expect: 'salvage', corrupt: edit((d) => { d.projectiles.push({ ...projectile(d), pierce: -1 }); }) },
  { id: 'floor-projectile-old', title: '옛 구조의 투사체(expiresAt)', expect: 'salvage', corrupt: edit((d) => { const p = projectile(d); delete p.left; p.expiresAt = d.tick + 60; d.projectiles.push(p); }) },
  { id: 'floor-hazard-interval', title: '장판의 간격이 음수', expect: 'salvage', corrupt: edit((d) => { d.hazards.push({ ...hazard(d), interval: -30 }); }) },
  { id: 'floor-hazard-radius', title: '장판의 반지름이 문자열', expect: 'salvage', corrupt: edit((d) => { d.hazards.push({ ...hazard(d), radius: 'big' }); }) },
  { id: 'floor-hazard-kind', title: '모르는 종류의 장판', expect: 'salvage', corrupt: edit((d) => { d.hazards.push({ ...hazard(d), kind: 'vortex' }); }) },
  { id: 'floor-hazard-slow', title: '시간 왜곡의 배율이 음수(탄이 거꾸로 난다)', expect: 'salvage', corrupt: edit((d) => { d.hazards.push({ ...hazard(d), kind: 'warp', slow: -2 }); }) },
  { id: 'floor-encounter-null', title: '전투 중인 방이 있는데 전투 정보가 없음', expect: 'salvage', corrupt: edit((d) => { d.encounter = null; }) },
  { id: 'floor-encounter-room', title: '전투 정보가 다른 방을 가리킴', expect: 'salvage', corrupt: edit((d) => { d.encounter.room = roomOf(d, 'start').id; }) },
  { id: 'floor-encounter-range', title: '전투 정보가 없는 방을 가리킴', expect: 'salvage', corrupt: edit((d) => { d.encounter.room = 500; }) },
  { id: 'floor-encounter-pending', title: '예고 중인 적이 모르는 종류', expect: 'salvage', corrupt: edit((d) => { d.encounter.pending.push({ type: 'dragon_god', elite: false, x: playerOf(d).x, y: playerOf(d).y, at: d.tick + 30 }); }) },
  { id: 'floor-encounter-pending-wall', title: '예고 중인 적의 자리가 벽 속', expect: 'salvage', corrupt: edit((d) => { d.encounter.pending.push({ type: 'skeleton', elite: false, x: 0.5, y: 0.5, at: d.tick + 30 }); }) },
  { id: 'floor-encounter-stray', title: '전투 중인 방이 없는데 전투 정보가 있음', expect: 'salvage', corrupt: edit((d) => { activeRoom(d).state = 'cleared'; }) },
  { id: 'floor-input-old', title: '옛 구조의 입력(skill 이 숫자, dodge)', expect: 'salvage', corrupt: edit((d) => { d.input = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, attack: false, skill: -1, dodge: false }; }) },
  { id: 'floor-input-move', title: '이동 입력이 문자열', expect: 'salvage', corrupt: edit((d) => { d.input.moveX = 'left'; }) },
  { id: 'floor-drop-kind', title: '모르는 종류의 전리품', expect: 'salvage', corrupt: edit((d) => { d.drops.push(drop(d, { kind: 'bomb' })); }) },
  { id: 'floor-drop-weapon', title: '바닥에 놓인 무기가 모르는 무기', expect: 'salvage', corrupt: edit((d) => { d.drops.push(drop(d, { kind: 'weapon', weapon: 'valueOf' })); }) },
  { id: 'floor-drop-amount', title: '금화 전리품의 양이 음수', expect: 'salvage', corrupt: edit((d) => { d.drops.push(drop(d, { kind: 'gold', amount: -5 })); }) },
  { id: 'floor-drop-id', title: '전리품의 번호가 행동체와 겹침', expect: 'salvage', corrupt: edit((d) => { d.drops.push({ ...drop(d, { kind: 'boon' }), id: d.playerId }); }) },
  { id: 'floor-shop-weapon', title: '상점에 모르는 무기', expect: 'salvage', corrupt: edit((d) => { d.shop.stock[0] = { kind: 'weapon', weapon: 'lightsaber', price: 10, sold: false }; }) },
  { id: 'floor-shop-price', title: '상점 가격이 음수', expect: 'salvage', corrupt: edit((d) => { d.shop.stock[0].price = -999; }) },
  { id: 'floor-shop-kind', title: '상점에 모르는 종류의 품목', expect: 'salvage', corrupt: edit((d) => { d.shop.stock.push({ kind: 'relic', id: 'x', price: 5, sold: false }); }) },
  { id: 'floor-shop-old', title: '옛 구조의 상점(floor·x·y)', expect: 'salvage', corrupt: edit((d) => { d.shop = { floor: 1, stock: [], x: 3.5, y: 3.5 }; }) },
  { id: 'floor-old-field', title: '옛 구조의 최상위 필드(inventory·vision·altar)', expect: 'salvage', corrupt: edit((d) => { d.inventory = { bag: [], gold: 5 }; d.vision = null; d.altar = null; }) },
  { id: 'floor-top-extra', title: '최상위에 모르는 필드', expect: 'salvage', corrupt: edit((d) => { d.cheats = { godMode: true }; }) },
  { id: 'floor-proto-key', title: '본문에 "__proto__" 키', expect: 'salvage', corrupt: ({ data }) => {
    const copy = structuredClone(data);
    Object.defineProperty(copy, '__proto__', { value: { polluted: true }, enumerable: true, writable: true, configurable: true });
    return seal(copy);
  } },
];

/** 묶음 이름(id 의 앞부분). */
export function groupOf(testCase) {
  return testCase.id.slice(0, testCase.id.indexOf('-'));
}
