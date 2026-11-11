// 손상된 런 세이브의 목록. 멀쩡한 세이브 하나(base)를 받아 한 군데를 망가뜨린 글을 만든다.
// tests/logic/save/corrupt.test.js 와 scripts/verify-save.mjs 가 함께 쓴다.
//
// 각 항목: { id, title, expect, corrupt(base) }
//   base    = { text, data } — 멀쩡한 세이브의 글과, 그 본문(파싱한 사본)
//   corrupt = 망가뜨린 글(또는 null = 저장소에 값이 없음)을 돌려준다
//   expect  = readRun 이 내야 하는 status:
//             'none'(쓸 수 없음 → 새 런) | 'salvage'(핵심만 건짐 → 그 층을 다시 만듦) | 'finished'(끝난 런)
// 묶음: text(글 자체가 깨짐) · envelope(봉투) · core(시드·층 등 핵심) · progress(진행도) · inventory · world · actors · floor(그 밖의 층 상태)
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
const anyItem = (d) => d.inventory.bag[0] ?? Object.values(d.inventory.equipped).find((item) => item !== null);
const freshId = (d) => d.entities.nextId++;
/** 네 이웃이 모두 벽인 벽 칸(테두리 제외). */
function sealedCell(world) {
  const { width: w, height: h, tiles } = world;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (tiles[i] === 0 && tiles[i - 1] === 0 && tiles[i + 1] === 0 && tiles[i - w] === 0 && tiles[i + w] === 0) return { x, y, i };
    }
  }
  throw new Error('막힌 칸을 찾지 못함');
}
const projectile = (d) => ({
  id: freshId(d), ownerId: d.playerId, faction: 'player', x: playerOf(d).x, y: playerOf(d).y, vx: 6, vy: 0, radius: 0.2,
  damage: 5, power: 1, status: null, expiresAt: d.tick + 60,
});
const hazard = (d) => ({
  id: freshId(d), ownerId: d.playerId, faction: 'player', x: playerOf(d).x, y: playerOf(d).y, radius: 1.5, damage: 3, power: 1,
  status: null, nextAt: d.tick + 30, interval: 30, endAt: d.tick + 120,
});

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
  { id: 'env-version-string', title: '버전이 문자열', expect: 'none', corrupt: envelope((e) => { e.version = '4'; }) },
  { id: 'env-version-zero', title: '버전이 0', expect: 'none', corrupt: envelope((e) => { e.version = 0; }) },
  { id: 'env-version-float', title: '버전이 소수', expect: 'none', corrupt: envelope((e) => { e.version = 2.5; }) },
  { id: 'env-version-future', title: '이 프로그램보다 새 버전', expect: 'none', corrupt: envelope((e) => { e.version = STATE_VERSION + 95; }) },
  { id: 'env-data-missing', title: '본문이 없음', expect: 'none', corrupt: envelope((e) => { delete e.data; }) },
  { id: 'env-data-array', title: '본문이 배열', expect: 'none', corrupt: envelope((e) => { e.data = [e.data]; }) },
  { id: 'env-checksum-missing', title: '체크섬이 없음', expect: 'salvage', corrupt: envelope((e) => { delete e.checksum; }) },
  { id: 'env-checksum-wrong', title: '체크섬이 틀림', expect: 'salvage', corrupt: envelope((e) => { e.checksum = '00000000'; }) },
  { id: 'env-version-lie', title: '봉투는 현재 버전인데 본문은 옛 버전', expect: 'salvage', corrupt: edit((d) => { d.version = STATE_VERSION - 1; }) },

  // ── 핵심(시드·층): 여기가 틀리면 그 런은 되살릴 수 없다 ──
  { id: 'core-seed-missing', title: '시드가 없음', expect: 'none', corrupt: edit((d) => { delete d.seed; }) },
  { id: 'core-seed-number', title: '시드가 숫자', expect: 'none', corrupt: edit((d) => { d.seed = 12345; }) },
  { id: 'core-seed-empty', title: '시드가 빈 문자열', expect: 'none', corrupt: edit((d) => { d.seed = ''; }) },
  { id: 'core-seed-long', title: '시드가 너무 김', expect: 'none', corrupt: edit((d) => { d.seed = 's'.repeat(5000); }) },
  { id: 'core-run-missing', title: '진행도(run)가 없음', expect: 'none', corrupt: edit((d) => { delete d.run; }) },
  { id: 'core-run-array', title: '진행도가 배열', expect: 'none', corrupt: edit((d) => { d.run = [1, 2, 3]; }) },
  { id: 'core-floor-zero', title: '층이 0', expect: 'none', corrupt: edit((d) => { d.run.floor = 0; }) },
  { id: 'core-floor-over', title: '층이 마지막 층보다 큼', expect: 'none', corrupt: edit((d) => { d.run.floor = 31; }) },
  { id: 'core-floor-string', title: '층이 문자열', expect: 'none', corrupt: edit((d) => { d.run.floor = '3'; }) },
  { id: 'core-floor-float', title: '층이 소수', expect: 'none', corrupt: edit((d) => { d.run.floor = 2.5; }) },

  // ── 진행도: 틀린 항목만 기본값으로 되돌리고 나머지는 살린다 ──
  { id: 'prog-tick-negative', title: '틱이 음수', expect: 'salvage', corrupt: edit((d) => { d.tick = -5; }) },
  { id: 'prog-tick-null', title: '틱이 null(NaN 이 저장된 경우)', expect: 'salvage', corrupt: edit((d) => { d.tick = null; }) },
  { id: 'prog-tick-string', title: '틱이 문자열', expect: 'salvage', corrupt: edit((d) => { d.tick = '120'; }) },
  { id: 'prog-phase-unknown', title: '모르는 페이즈', expect: 'salvage', corrupt: edit((d) => { d.phase = 'cutscene'; }) },
  { id: 'prog-phase-title', title: '페이즈가 타이틀', expect: 'salvage', corrupt: edit((d) => { d.phase = 'title'; }) },
  { id: 'prog-rng-missing', title: '난수 스트림 하나가 없음', expect: 'salvage', corrupt: edit((d) => { delete d.rng.combat; }) },
  { id: 'prog-rng-range', title: '난수 상태가 32비트 범위 밖', expect: 'salvage', corrupt: edit((d) => { d.rng.items.s[2] = 4294967296; }) },
  { id: 'prog-rng-short', title: '난수 상태의 길이가 다름', expect: 'salvage', corrupt: edit((d) => { d.rng.world.key.pop(); }) },
  { id: 'prog-level-zero', title: '레벨이 0', expect: 'salvage', corrupt: edit((d) => { d.run.level = 0; }) },
  { id: 'prog-xp-negative', title: '경험치가 음수', expect: 'salvage', corrupt: edit((d) => { d.run.xp = -100; }) },
  { id: 'prog-upgrade-unknown', title: '모르는 강화', expect: 'salvage', corrupt: edit((d) => { d.run.upgrades.omnipotence = 3; }) },
  { id: 'prog-upgrade-proto', title: '강화 이름이 "constructor"', expect: 'salvage', corrupt: edit((d) => { d.run.upgrades.constructor = 1; }) },
  { id: 'prog-upgrade-rank', title: '강화 단계가 0', expect: 'salvage', corrupt: edit((d) => { d.run.upgrades.sharpness = 0; }) },
  { id: 'prog-boon-stat', title: '영구 효과에 모르는 능력치', expect: 'salvage', corrupt: edit((d) => { d.run.boons.push({ source: 'x', stats: { luck: 5 } }); }) },
  { id: 'prog-choice-unknown', title: '제시된 강화 후보가 모르는 이름', expect: 'salvage', corrupt: edit((d) => { d.run.choice = { options: [{ kind: 'upgrade', id: 'nope' }] }; }) },
  { id: 'prog-field-missing', title: '진행도의 필드 하나가 없음(kills)', expect: 'salvage', corrupt: edit((d) => { delete d.run.kills; }) },
  { id: 'prog-ended', title: '끝난 런(ended)', expect: 'finished', corrupt: edit((d) => { d.run.ended = true; }) },
  { id: 'prog-game-over', title: '끝난 런(gameOver 페이즈)', expect: 'finished', corrupt: edit((d) => { d.phase = 'gameOver'; }) },

  // ── 인벤토리: 올바른 것만 남긴다 ──
  { id: 'inv-missing', title: '인벤토리가 없음', expect: 'salvage', corrupt: edit((d) => { delete d.inventory; }) },
  { id: 'inv-bag-object', title: '가방이 배열이 아님', expect: 'salvage', corrupt: edit((d) => { d.inventory.bag = { 0: 'sword' }; }) },
  { id: 'inv-item-base', title: '모르는 장비 종류', expect: 'salvage', corrupt: edit((d) => { anyItem(d).base = 'lightsaber'; }) },
  { id: 'inv-item-slot', title: '장비의 부위가 종류와 다름', expect: 'salvage', corrupt: edit((d) => { const it = anyItem(d); it.slot = it.slot === 'weapon' ? 'boots' : 'weapon'; }) },
  { id: 'inv-item-stat', title: '모르는 능력치 옵션', expect: 'salvage', corrupt: edit((d) => { anyItem(d).implicit[0].stat = 'luck'; }) },
  { id: 'inv-item-value', title: '옵션 값이 null', expect: 'salvage', corrupt: edit((d) => { anyItem(d).implicit[0].value = null; }) },
  { id: 'inv-item-huge', title: '옵션 값이 터무니없이 큼', expect: 'salvage', corrupt: edit((d) => { anyItem(d).implicit[0].value = 1e15; }) },
  { id: 'inv-item-rarity', title: '모르는 등급', expect: 'salvage', corrupt: edit((d) => { anyItem(d).rarity = 'mythic'; }) },
  { id: 'inv-item-string', title: '가방에 장비가 아닌 값', expect: 'salvage', corrupt: edit((d) => { d.inventory.bag.push('sword'); }) },
  { id: 'inv-overflow', title: '가방이 칸 수보다 많음', expect: 'salvage', corrupt: edit((d) => { d.inventory.capacity = 1; d.inventory.bag.push({ ...anyItem(d), uid: freshId(d) }, { ...anyItem(d), uid: freshId(d) }); }) },
  { id: 'inv-uid-duplicate', title: '같은 번호의 장비가 둘', expect: 'salvage', corrupt: edit((d) => { d.inventory.bag.push(structuredClone(anyItem(d))); }) },
  { id: 'inv-gold-negative', title: '금화가 음수', expect: 'salvage', corrupt: edit((d) => { d.inventory.gold = -50; }) },
  { id: 'inv-gold-float', title: '금화가 소수', expect: 'salvage', corrupt: edit((d) => { d.inventory.gold = 10.5; }) },
  { id: 'inv-gold-huge', title: '금화가 1e21', expect: 'salvage', corrupt: edit((d) => { d.inventory.gold = 1e21; }) },
  { id: 'inv-consumable-unknown', title: '모르는 소비 아이템', expect: 'salvage', corrupt: edit((d) => { d.inventory.consumables.elixir_of_bugs = 2; }) },
  { id: 'inv-consumable-zero', title: '소비 아이템이 0개', expect: 'salvage', corrupt: edit((d) => { d.inventory.consumables.health_potion = 0; }) },
  { id: 'inv-relic-unknown', title: '모르는 유물', expect: 'salvage', corrupt: edit((d) => { d.inventory.relics.push('toString'); }) },
  { id: 'inv-relic-duplicate', title: '같은 유물이 둘', expect: 'salvage', corrupt: edit((d) => { d.inventory.relics.push('whetstone', 'whetstone'); }) },
  { id: 'inv-equipped-slot', title: '착용 칸에 다른 부위의 장비', expect: 'salvage', corrupt: edit((d) => { const it = anyItem(d); d.inventory.equipped[it.slot === 'weapon' ? 'boots' : 'weapon'] = { ...it, uid: freshId(d) }; }) },
  { id: 'inv-equipped-missing', title: '착용 칸 하나가 없음', expect: 'salvage', corrupt: edit((d) => { delete d.inventory.equipped.helm; }) },

  // ── 맵 ──
  { id: 'world-null', title: '맵이 없음', expect: 'salvage', corrupt: edit((d) => { d.world = null; }) },
  { id: 'world-tiles-short', title: '타일 배열이 짧음', expect: 'salvage', corrupt: edit((d) => { d.world.tiles.length -= 10; }) },
  { id: 'world-tiles-value', title: '타일에 모르는 값', expect: 'salvage', corrupt: edit((d) => { d.world.tiles[d.world.width + 1] = 2; }) },
  { id: 'world-border', title: '테두리가 뚫림', expect: 'salvage', corrupt: edit((d) => { d.world.tiles[3] = 1; }) },
  { id: 'world-start-wall', title: '시작점이 벽 속', expect: 'salvage', corrupt: edit((d) => { d.world.start = { x: 0, y: 0 }; }) },
  { id: 'world-stairs-sealed', title: '계단이 막힌 곳에 있음', expect: 'salvage', corrupt: edit((d) => { const c = sealedCell(d.world); d.world.tiles[c.i] = 1; d.world.stairs = { x: c.x, y: c.y }; }) },
  { id: 'world-width', title: '맵 너비가 타일 수와 맞지 않음', expect: 'salvage', corrupt: edit((d) => { d.world.width += 1; }) },
  { id: 'world-size-huge', title: '맵 크기가 터무니없이 큼', expect: 'salvage', corrupt: edit((d) => { d.world.width = 1e9; }) },
  { id: 'world-floor-mismatch', title: '맵의 층이 진행 중인 층과 다름', expect: 'salvage', corrupt: edit((d) => { d.world.floor = d.run.floor === 1 ? 2 : d.run.floor - 1; }) },
  { id: 'world-zone', title: '모르는 구역', expect: 'salvage', corrupt: edit((d) => { d.world.zoneId = 'moon'; }) },

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
  { id: 'actor-hp-over', title: '체력이 최대 체력보다 큼', expect: 'salvage', corrupt: edit((d) => { enemyOf(d).hp = enemyOf(d).maxHp + 500; }) },
  { id: 'actor-hp-float', title: '체력이 소수', expect: 'salvage', corrupt: edit((d) => { playerOf(d).hp = 12.75; }) },
  { id: 'actor-maxhp-zero', title: '최대 체력이 0', expect: 'salvage', corrupt: edit((d) => { enemyOf(d).maxHp = 0; enemyOf(d).hp = 0; }) },
  { id: 'actor-facing-zero', title: '바라보는 방향이 (0, 0)', expect: 'salvage', corrupt: edit((d) => { playerOf(d).facingX = 0; playerOf(d).facingY = 0; }) },
  { id: 'actor-armor-negative', title: '방어력이 음수(나눗셈이 0 이 될 수 있음)', expect: 'salvage', corrupt: edit((d) => { enemyOf(d).armor = -30; }) },
  { id: 'actor-speed-string', title: '속도가 문자열', expect: 'salvage', corrupt: edit((d) => { enemyOf(d).speed = 'fast'; }) },
  { id: 'actor-action', title: '그 행동체에 없는 기술을 쓰는 중', expect: 'salvage', corrupt: edit((d) => { enemyOf(d).action = { ability: 'meteor', phase: 'windup', until: d.tick + 10, dirX: 1, dirY: 0, targetX: 5, targetY: 5 }; }) },
  { id: 'actor-status', title: '모르는 상태이상', expect: 'salvage', corrupt: edit((d) => { playerOf(d).statuses.petrify = { stacks: 1, until: d.tick + 60, nextTick: 0, sourceId: 1 }; }) },
  { id: 'actor-status-stacks', title: '상태이상 중첩이 0', expect: 'salvage', corrupt: edit((d) => { playerOf(d).statuses.poison = { stacks: 0, until: d.tick + 60, nextTick: d.tick + 5, sourceId: 1 }; }) },
  { id: 'actor-ai-null', title: '적의 AI 상태가 없음', expect: 'salvage', corrupt: edit((d) => { enemyOf(d).ai = null; }) },
  { id: 'actor-ai-mode', title: '모르는 AI 상태', expect: 'salvage', corrupt: edit((d) => { enemyOf(d).ai.mode = 'dancing'; }) },
  { id: 'actor-ai-phase', title: '페이즈가 범위를 벗어남', expect: 'salvage', corrupt: edit((d) => { enemyOf(d).ai.phase = 9; }) },
  { id: 'actor-ai-path', title: '경로에 맵 밖의 칸', expect: 'salvage', corrupt: edit((d) => { enemyOf(d).ai.nav.path = [5, 999999]; enemyOf(d).ai.nav.idx = 0; }) },
  { id: 'actor-ai-idx', title: '경로 위치가 길이를 벗어남', expect: 'salvage', corrupt: edit((d) => { enemyOf(d).ai.nav.path = [d.world.start.y * d.world.width + d.world.start.x]; enemyOf(d).ai.nav.idx = 7; }) },
  { id: 'actor-cooldown-far', title: '재사용 대기가 터무니없이 먼 미래', expect: 'salvage', corrupt: edit((d) => { playerOf(d).cooldowns.dodge = 1900000000; }) },
  { id: 'actor-field-missing', title: '행동체의 필드 하나가 없음(radius)', expect: 'salvage', corrupt: edit((d) => { delete enemyOf(d).radius; }) },
  { id: 'actor-field-extra', title: '행동체에 모르는 필드', expect: 'salvage', corrupt: edit((d) => { enemyOf(d).godMode = true; }) },
  { id: 'actor-next-id', title: '다음 번호가 이미 쓴 번호보다 작음', expect: 'salvage', corrupt: edit((d) => { d.entities.nextId = 1; }) },
  { id: 'actor-dead-player', title: '플레이어가 죽었는데 런이 끝나지 않음', expect: 'salvage', corrupt: edit((d) => { playerOf(d).dead = true; playerOf(d).hp = 0; }) },

  // ── 그 밖의 층 상태 ──
  { id: 'floor-projectiles-null', title: '투사체 목록이 null', expect: 'salvage', corrupt: edit((d) => { d.projectiles = null; }) },
  { id: 'floor-projectile-outside', title: '투사체가 맵 밖', expect: 'salvage', corrupt: edit((d) => { d.projectiles.push({ ...projectile(d), x: 1e7 }); }) },
  { id: 'floor-projectile-velocity', title: '투사체 속도가 null', expect: 'salvage', corrupt: edit((d) => { d.projectiles.push({ ...projectile(d), vx: null }); }) },
  { id: 'floor-projectile-status', title: '투사체에 모르는 상태이상', expect: 'salvage', corrupt: edit((d) => { d.projectiles.push({ ...projectile(d), status: { id: 'doom' } }); }) },
  { id: 'floor-hazard-interval', title: '장판의 간격이 음수', expect: 'salvage', corrupt: edit((d) => { d.hazards.push({ ...hazard(d), interval: -30 }); }) },
  { id: 'floor-hazard-radius', title: '장판의 반지름이 문자열', expect: 'salvage', corrupt: edit((d) => { d.hazards.push({ ...hazard(d), radius: 'big' }); }) },
  { id: 'floor-vision-null', title: '시야가 없음', expect: 'salvage', corrupt: edit((d) => { d.vision = null; }) },
  { id: 'floor-vision-length', title: '시야 배열의 길이가 맵과 다름', expect: 'salvage', corrupt: edit((d) => { d.vision.explored.push(1, 1, 1); }) },
  { id: 'floor-input-skill', title: '없는 기술 칸을 누른 입력', expect: 'salvage', corrupt: edit((d) => { d.input.skill = 99; }) },
  { id: 'floor-input-move', title: '이동 입력이 문자열', expect: 'salvage', corrupt: edit((d) => { d.input.moveX = 'left'; }) },
  { id: 'floor-drop-kind', title: '모르는 종류의 전리품', expect: 'salvage', corrupt: edit((d) => { d.drops.push({ id: freshId(d), x: playerOf(d).x, y: playerOf(d).y, loot: { kind: 'bomb' } }); }) },
  { id: 'floor-drop-relic', title: '전리품이 모르는 유물', expect: 'salvage', corrupt: edit((d) => { d.drops.push({ id: freshId(d), x: playerOf(d).x, y: playerOf(d).y, loot: { kind: 'relic', id: 'valueOf' } }); }) },
  { id: 'floor-shop-item', title: '상점 품목의 장비가 깨짐', expect: 'salvage', corrupt: edit((d) => { d.shop = { floor: d.run.floor, stock: [{ kind: 'equipment', item: { kind: 'equipment' }, price: 10, sold: false }], x: 5.5, y: 5.5 }; }) },
  { id: 'floor-shop-price', title: '상점 가격이 음수', expect: 'salvage', corrupt: edit((d) => { d.shop = { floor: d.run.floor, stock: [{ kind: 'consumable', id: 'health_potion', price: -999, sold: false }], x: 5.5, y: 5.5 }; }) },
  { id: 'floor-altar-tier', title: '제단에 모르는 단계', expect: 'salvage', corrupt: edit((d) => { d.altar = { floor: d.run.floor, used: false, offers: [{ tier: 'colossal', cost: { type: 'hpPct', pct: 20 }, reward: { type: 'heal' } }], x: 5.5, y: 5.5 }; }) },
  { id: 'floor-altar-cost', title: '제단에 모르는 대가', expect: 'salvage', corrupt: edit((d) => { d.altar = { floor: d.run.floor, used: false, offers: [{ tier: 'small', cost: { type: 'soul' }, reward: { type: 'heal' } }], x: 5.5, y: 5.5 }; }) },
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
