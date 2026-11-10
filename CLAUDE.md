# Fable — 모바일 웹 3D 로그라이크 던전

여러 단계에 걸쳐 만드는 프로젝트다. 작업을 시작하기 전에 이 문서와 `TODO.md`, `BUGS.md` 를 읽는다.

## 고정 조건 (바꾸지 않는다)

- **Three.js, 빌드 도구 없음.** `index.html` + ES 모듈을 GitHub Pages 에 그대로 배포한다. 번들러·트랜스파일러·npm 의존성을 추가하지 않는다.
- **Three.js 는 importmap 으로 CDN 에서 로드하고 버전을 고정한다.** 주소는 `index.html` 의 importmap 한 곳에만 있다. 현재 `three@0.186.1`.
- **모듈**: core(게임루프·상태·이벤트버스), world(맵생성·렌더), entities, combat, items, ui, save, audio.
- **순수 로직(`src/logic/**`)은 DOM·Three.js 를 import 하지 않는다.** Node 에서 단독으로 테스트할 수 있어야 한다. 시계(`Date`, `performance`)와 타이머도 쓰지 않는다 — 시간은 바깥에서 인자로 받는다.
- **렌더링(`src/render/**`)은 로직 상태를 읽기만 한다.** 상태를 바꾸는 코드는 `src/logic/**` 에만 둔다.
- **모든 랜덤은 시드 PRNG 하나로 통일한다(서브스트림 분기 방식). `Math.random` 은 어디에서도 쓰지 않는다.**
- **테스트는 npm 설치 없이 `node --test` 로 실행한다.**
- 모든 경로는 상대 경로(`./…`)로 쓴다. GitHub Pages 는 하위 경로(`/fable/`)에서 서비스된다.

## 작업 규칙

1. **단계마다 끝에 테스트를 전부 실행한다. 실패가 0이어야 완료다.** 실패가 남아 있으면 완료라고 보고하지 않는다.
2. **보고는 "실행해서 확인한 것 / 확인 못 한 것"을 구분한다.** 실제로 돌려 본 것만 확인했다고 쓴다. 추정·미실행·환경 때문에 못 본 것은 따로 적는다.
3. **발견한 버그·수정·한계는 `BUGS.md` 에 누적 기록한다.** 지우지 않고 덧붙인다. 고친 버그도 남긴다.
4. **현재 단계 범위를 넘는 기능은 만들지 않고 TODO 로 남긴다.** `TODO.md` 에 적고, 코드 위치가 분명하면 `// TODO(단계): …` 주석을 함께 둔다.
5. **밸런스 수치는 `data/` 폴더 설정 파일로 분리한다.** 로직·렌더 코드에 수치를 직접 박지 않는다.

## 명령어

```bash
node scripts/run-tests.mjs          # 전체 테스트 (= node --test, npm test)
node scripts/run-tests.mjs prng     # 경로에 "prng" 가 들어간 테스트만
node scripts/serve.mjs              # http://127.0.0.1:8000 (--port, --host 0.0.0.0)
node scripts/verify-maps.mjs        # 맵 생성 대량 검증: 시드 5000개 × 전 층 (약 40초)
node scripts/verify-maps.mjs --show <시드> <층>   # 한 층을 글자로 출력
node scripts/sim-combat.mjs         # 전투 시뮬레이션: 적·보스마다 1:1 대결 2000회 (약 70초)
node scripts/sim-combat.mjs --one <종류> <방식> <번호>   # 대결 하나를 다시 돌려 문제를 출력
```

`src/logic/world/**` 나 `data/world.js`·`data/zones.js` 를 바꾸면 `verify-maps.mjs` 를 다시 돌리고, 실패 0건을 확인한 뒤 결과를 `BUGS.md` 의 검증 기록에 덧붙인다. 실패한 시드는 시드 값·층과 함께 기록한다.

`src/logic/entities/**`·`src/logic/combat/**`·`src/logic/world/{collide,los,fov,pathfind,nav}.js` 나 `data/{combat,player,enemies,bosses,statuses}.js` 를 바꾸면 `sim-combat.mjs` 를 다시 돌리고, 문제 0건을 확인한 뒤 결과를 `BUGS.md` 의 검증 기록에 덧붙인다. 문제가 나온 대결은 시드(`<종류>-<방식>-<번호>`)와 함께 기록한다.

ES 모듈은 `file://` 로 열 수 없으므로 브라우저 확인은 항상 로컬 서버를 거친다.

## 파일 구조

`(예정)` 은 아직 없는 디렉터리다. 해당 단계에서 만든다.

```
index.html                 진입 HTML. importmap(Three.js 버전 고정) + 캔버스
package.json               "type": "module" 선언과 스크립트 별칭만. 의존성 없음
.nojekyll                  GitHub Pages 가 Jekyll 처리 없이 그대로 배포하도록
CLAUDE.md  BUGS.md  TODO.md  README.md
data/                      설정·밸런스 수치 (순수 값, data 끼리만 import)
  config.js                루프 주파수, 렌더 설정
  world.js                 맵 생성 수치: 재시도 상한, 배치 거리, 생성기·보스층 설정
  zones.js                 구역 6개: 맵 크기, 알고리즘 비율, 타일셋, 색감, 적 풀, 보스
  combat.js                전투 공통 수치: 시야, 어그로·리쉬, 길찾기
  player.js                플레이어 스탯·기술·회피 + 기술 형식 설명
  enemies.js               적 20종(행동 방식 10가지)
  bosses.js                중간보스 3종, 최종보스 1종(페이즈·패턴)
  statuses.js              상태이상 6종과 중첩·지속·면역 규칙
  freeze.js                설정 객체 동결 도우미
src/
  main.js                  조립 지점: 로직·렌더·UI 를 만들어 연결하는 유일한 곳
  logic/                   ── 순수 로직 (DOM·Three.js 금지, Node 테스트 대상)
    game.js                로직 최상단: 상태+버스 묶음, 틱마다 시스템 실행 순서 결정
    core/
      prng.js              시드 PRNG(sfc32) + fork 서브스트림
      event-bus.js         동기식 이벤트버스
      events.js            이벤트 이름 상수
      state.js             게임 상태 구조, 페이즈, RNG 스트림
      loop.js              고정 타임스텝 루프 (시간은 주입)
      time.js              초 → 틱 변환
    world/                 맵 생성 (아래 "맵 생성" 참고)
      generate.js          진입점: generateFloor, 재시도 상한, 비상 레이아웃
      floors.js            층 계획: 층 → 구역·종류(일반/중간보스/최종보스)
      gen-rooms.js         방+복도(BSP)
      gen-cave.js          동굴형(셀룰러 오토마타)
      gen-boss.js          보스층 전용 레이아웃
      connect.js           연결 보정: 떨어진 구역을 잇거나 메움
      event-rooms.js       이벤트방(상점·제단)
      place.js             적·아이템 배치
      validate.js          검증기: 층이 규칙을 지키는지 확인
      grid.js  tiles.js    격자 탐색 도구, 타일 종류
      ascii.js             맵을 글자로 출력(디버그)
      nav.js               맵에서 뽑은 이동·탐색용 자료(캐시)
      collide.js           원-격자 충돌
      los.js               시야선(DDA), 몸 폭을 고려한 직선 통과 판정
      fov.js               시야 계산(레이캐스트)
      pathfind.js          격자 A*
    items/      (예정)     아이템 정의·획득·사용
    entities/              행동체(플레이어·적·보스)
      actors.js            생성·조회, 층 배치
      defs.js              데이터 정의 찾기
      movement.js          이동·돌진, 벽 충돌, 서로 밀어내기
      vision.js            플레이어 시야(안개용 자료)
    combat/                전투 (아래 "엔티티와 전투" 참고)
      damage.js            피해 처리, 보스 페이즈 전환
      statuses.js          상태이상
      abilities.js         기술 실행기(준비·발동·경직, 효과, 돌진)
      hit.js               명중 처리(피해+흡혈+상태이상)
      projectiles.js  hazards.js   투사체, 장판
      player.js            입력 → 플레이어 행동
      deaths.js            죽음 처리(사망 효과, 정리)
      ai/brain.js          어그로·리쉬 상태 관리
      ai/behaviors.js      행동 방식 10가지 + 보스
      ai/steer.js          조향(직선/A* 경로 따라가기, 물러나기)
    save/       (예정)     상태 직렬화·버전 마이그레이션
  render/                  ── Three.js. 로직 상태를 읽기만 함
    renderer.js            렌더러·씬·카메라
    world/      (예정)     맵 메시
    entities/   (예정)     엔티티 메시·애니메이션
  ui/                      ── DOM: HUD, 메뉴, 터치 입력
    debug-overlay.js       개발용 상태 표시
  audio/        (예정)     ── WebAudio
  save/         (예정)     ── 저장소 어댑터(localStorage 등). 직렬화 자체는 logic/save
scripts/
  run-tests.mjs            테스트 러너
  serve.mjs                로컬 정적 서버
  verify-maps.mjs          맵 생성 대량 검증(시드 × 전 층, 통계 출력)
  sim-combat.mjs           전투 시뮬레이션(종류 × 대결 방식, 통계 출력)
  lib/combat-sim.js        대결 차리기, 자동 조작, 매 틱 불변식 검사
tests/                     src 와 같은 경로 구조. *.test.js
  architecture.test.js     아래 의존 규칙을 자동 검사
  helpers/architecture.js  규칙 정의(LAYERS, LOGIC_RANK)와 검사기
  helpers/arena.js         글자 그림으로 만드는 테스트용 전장
  logic/core/*.test.js
  logic/world/*.test.js
  logic/entities/*.test.js
  logic/combat/*.test.js
```

모듈과 디렉터리의 대응: core·entities·combat·items 는 `src/logic/<모듈>`, world 는 `src/logic/world`(생성) + `src/render/world`(그리기), save 는 `src/logic/save`(직렬화) + `src/save`(저장소), ui·audio 는 `src/ui`·`src/audio`.

## 의존 방향

화살표는 "import 할 수 있다"는 뜻이다. 반대 방향은 금지다.

```
main.js ──▶ render ─┐
   │    ──▶ ui ─────┤
   │    ──▶ audio ──┼──▶ logic ──▶ data
   │    ──▶ save ───┘
   └──────────────────▶ logic, data
```

- `data/**` — 아무것도 import 하지 않는다(같은 data 끼리만).
- `src/logic/**` — `src/logic`, `data` 만. bare import(`three`, `node:*`) 금지.
- `src/render/**` — `src/render`, `src/logic`, `data`, 그리고 `three`·`three/addons/`.
- `src/ui/**`, `src/audio/**`, `src/save/**` — 자기 디렉터리, `src/logic`, `data`. `three` 금지.
- render·ui·audio·save 는 서로 import 하지 않는다. 서로 알아야 하면 `main.js` 가 연결한다.
- `src/main.js` — 전부 import 할 수 있다. 아무도 `main.js` 를 import 하지 않는다.

로직 내부 순위(낮은 쪽만 import 가능, 같은 순위끼리는 불가):

```
core(0) ◀ world(1), items(1) ◀ entities(2) ◀ combat(3) ◀ save(4) ◀ game.js(최상단)
```

모듈끼리 조율이 필요하면 `logic/game.js` 가 순서대로 호출한다. 로직 모듈은 `game.js` 를 import 하지 않는다.

entities 는 "몸"(생성, 이동, 충돌, 시야)만 다루고 combat 을 모른다. 피해·상태이상·기술·AI·플레이어 조작은 모두 combat 에 있다(적 AI 는 `combat/ai/`). 격자 기하(충돌·시야선·길찾기)는 world 에 있다.

이 규칙은 `tests/architecture.test.js` 가 검사한다. 규칙을 바꿀 때는 이 문서와 `tests/helpers/architecture.js` 를 함께 고친다. 새 최상위 디렉터리나 로직 모듈을 추가하면 검사기에 등록해야 테스트가 통과한다.

## 데이터 흐름

- **로직 → 바깥**: 로직이 `EventBus` 로 "일어난 일"을 알리고, render/ui/audio 가 구독한다. 이벤트 이름은 `logic/core/events.js` 상수를 쓴다.
- **바깥 → 로직**: ui 는 상태를 직접 고치지 않는다. 입력은 커맨드로 만들어 로직에 넘긴다(입력 단계에서 구현, `TODO.md`).
- **프레임**: `main.js` 가 `requestAnimationFrame` 마다 경과 시간을 `FixedStepLoop.advance()` 에 넘김 → 고정 dt 로 `tick()` 0회 이상 → `render(state, alpha)`.

## 맵 생성

- 전체 30층 = 구역 6개 × 5층(`data/zones.js` 순서대로). 구역 마지막 층은 `zone.boss` 가 있으면 보스층이다(지금은 5·15·25층 중간보스, 30층 최종보스).
- `generateFloor({ seed, floor })` 는 (런 시드, 층 번호)만으로 결정된다. 층을 만드는 순서·횟수와 무관하고, 상태의 난수 스트림을 소비하지 않는다.
- 난수 흐름: 런 시드 → `fork('world')` → `fork('floor:N')` → `fork('algorithm')` / `fork('attempt:K')` / `fork('fallback')`, 시도 안에서는 `fork('layout')` / `fork('events')` / `fork('place')`. 새 난수 용도가 생기면 기존 스트림에 끼워 넣지 말고 fork 를 추가한다(기존 결과가 밀리지 않도록).
- 맵은 격자 타일이다. `tiles[y * width + x]` 가 `0`(벽) 또는 `1`(바닥)이고, 이동·연결은 상하좌우 4방향으로만 센다.
- 맵 객체: `{ floor, zoneId, kind, algorithm, width, height, tiles, start, stairs, rooms, eventRooms, spawns, gen }`. 최종보스층은 `stairs` 가 `null` 이다. `spawns` 는 `{ kind: 'enemy'|'boss'|'item', id?, x, y }`.
- 생성기는 `validateFloor` 를 통과한 층만 내보낸다. 실패한 시도는 버리고 다시 만들며, `WORLD.maxAttempts` 번을 넘기면 큰 방 하나짜리 비상 레이아웃으로 대체한다.
- 규칙(전부 `validate.js` 가 검사): 테두리는 벽 / 시작점에서 모든 바닥에 닿을 수 있음(상인·제단 칸은 막힌 것으로 봄) / 계단·적·아이템·이벤트방은 시작점에서 정해진 걸음 수 이상 / 같은 칸에 둘 이상 놓지 않음 / 이벤트방 안에는 적·아이템·시작점·계단이 없음.
- 규칙을 추가·변경하면 `validate.js`, `tests/logic/world/validate.test.js`, `scripts/verify-maps.mjs` 의 독립 검사를 함께 고친다.

## 엔티티와 전투

- **실시간이다.** 위치는 칸 단위 실수이고 칸 (x, y) 는 [x, x+1) × [y, y+1) 을 차지한다. 몸은 원이다(일반 적은 반지름 0.5 미만, 보스는 그보다 크다).
- **틱 순서**(`logic/game.js` 의 `tick`): 상태이상 → 플레이어 조작 → 적 AI → 기술 발동 → 이동·충돌 → 돌진 명중 → 투사체 → 장판 → 죽음 처리 → 시야. 순서를 바꾸면 같은 시드·같은 입력의 결과가 달라진다.
- **타이머는 정수 틱이다.** 데이터의 시간은 초로 적고 `ticksOf()` 로 바꾼다. "언제까지"는 `state.tick` 과 비교하는 틱 번호로 저장한다(실수 시간을 누적하지 않는다).
- **입력**: ui 는 `setInput(state, { moveX, moveY, aimX, aimY, attack, skill, dodge })` 만 부른다. 조준이 0 이면 가까운 적을 자동으로 겨눈다.
- **기술**은 플레이어·적·보스가 같은 형식(`data/player.js` 머리말)과 같은 실행기(`combat/abilities.js`)를 쓴다. 새 효과 종류는 `runEffects` 에 추가한다.
- **모든 피해는 `dealDamage` 를, 모든 상태이상은 `applyStatus` 를 거친다.** 직접 `hp` 나 `statuses` 를 고치지 않는다.
- **상태이상 규칙**은 `data/statuses.js` 머리말이 기준이다(중첩 방식 3가지, 지속 피해 주기, 면역·저항, 풀린 뒤 면역 시간, 화상↔빙결).
- **어그로·리쉬**(`combat/ai/brain.js`): 대기 → (반경 안 + 시야, 또는 피격) → 전투 → (플레이어가 적의 자리에서 leashRadius 넘게 멀어짐, 또는 loseSight 초 동안 못 봄) → 복귀(빠르게 이동, 체력 회복) → 대기. 리쉬는 **플레이어와 적의 자리 사이 거리**로 잰다. 보스는 리쉬가 없다.
- **보스 페이즈**: 체력이 페이즈 경계에 닿으면 그 아래로 내려가지 않고 멈춘 뒤 전환한다(건너뛸 수 없다). 전환 중 무적, 상태이상 정화, `BOSS_PHASE_CHANGED` 발행.
- **범위 공격(부채꼴·원·장판)은 벽 너머를 맞히지 못한다.** 투사체는 벽에서 사라진다.
- **같은 편끼리는 겹쳐 지나갈 수 있고**(약하게만 밀어냄), 플레이어와 적은 겹치지 않는다. 돌진·회피 중인 몸은 다른 몸을 통과한다.
- 렌더가 읽을 것: `state.entities.byId`(행동체), `state.projectiles`, `state.hazards`, `state.vision.visible/explored`(안개), 그리고 이벤트(`core/events.js`).
- 새 적을 추가하려면 `data/enemies.js` 에 정의하고 구역의 적 풀에 넣는다. 새 행동 방식은 `combat/ai/behaviors.js` 에 함수를 추가한다. `tests/logic/combat/data.test.js` 가 빠진 항목과 "아무것도 못 하는 거리 구간"을 잡아 준다.

## 코드 규약

- **상태는 JSON 으로 그대로 직렬화되는 평범한 객체다.** 클래스 인스턴스·함수·Map/Set·순환 참조를 상태에 넣지 않는다. 구조를 바꾸면 `STATE_VERSION` 을 올린다.
- **난수 쓰는 법**: 모듈은 `rngOf(state, '<스트림>')` 로 자기 스트림을 꺼내 쓴다. 스트림은 `RNG_STREAMS`(world, entities, combat, items)에 있다. 층·방처럼 "언제 뽑든 결과가 같아야 하는 것"은 `rngOf(state, 'world').fork(`floor:${n}`)` 처럼 fork 한다 — fork 는 부모를 소비하지 않고 라벨만으로 결정된다.
- `tests/logic/core/prng.test.js` 와 `tests/logic/world/generate.test.js` 의 고정값 테스트가 깨지면 기존 시드·세이브의 결과가 바뀐다는 뜻이다. 의도한 변경이 아니면 구현을 되돌린다. 의도한 변경이면 값을 갱신하고 `BUGS.md` 에 적는다.
- **순수 로직에서는 `Math.sin/cos/atan2/pow/hypot/exp/log` 와 `**` 를 쓰지 않는다.** 엔진마다 마지막 자리가 다를 수 있어 같은 시드가 기기마다 다른 결과를 낼 수 있다. 사칙연산과 `Math.sqrt/floor/ceil/round/abs/min/max/imul` 만 쓴다. 각도가 필요하면 [cos, sin] 값을 `data/` 에 미리 적어 둔다(`data/bosses.js` 참고). `tests/architecture.test.js` 가 검사한다.
- 상태를 훑을 때는 `allActors(state)` 처럼 id 순서가 정해진 목록을 쓴다(순서가 곧 결과다).
- 로직 함수는 잘못된 인자에 예외를 던진다(조용히 넘어가지 않는다).
- 주석·문서·테스트 이름은 한국어로 쓴다.
