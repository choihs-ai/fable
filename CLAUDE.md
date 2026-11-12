# Fable — 모바일 웹 3D 방 단위 액션 로그라이트

방을 하나씩 깨며 나아가는 액션 로그라이트다(방에 들어서면 문이 잠기고, 웨이브를 모두 잡으면 문이 열리며 보상이 나온다).
대시가 전투의 중심이고, 무기 둘을 들고 바꿔 쓰며, 방을 깰 때마다 싸우는 규칙을 바꾸는 축복을 3택1 로 고른다.
죽으면 거점에서 영혼석으로 영구 강화·캐릭터 해금을 산다. 지금은 **맛보기 판**(1구역 한 층: 방 8~12개 + 중간보스 1, 약 3~6분)만 있다.

여러 단계에 걸쳐 만드는 프로젝트다. 작업을 시작하기 전에 이 문서와 `TODO.md`, `BUGS.md` 를 읽는다.
**작업 브랜치는 `pivot` 이다(main 은 건드리지 않는다).** 단계마다 커밋해서 푸시한다.

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
node scripts/run-tests.mjs boons    # 경로에 "boons" 가 들어간 테스트만
node scripts/serve.mjs              # http://127.0.0.1:8000 (--port, --host 0.0.0.0)
node scripts/verify-maps.mjs        # 맵 생성 대량 검증: 시드 5000개 (약 15초) — 방·문·복도·잠금·스폰 자리·웨이브·보상
node scripts/verify-maps.mjs --show <시드> 1 [--spawns]   # 한 층을 글자로 출력
node scripts/bot-run.mjs            # 봇으로 맛보기 판 200판 완주: 승률·시간·방마다 걸린 시간, 매 순간 상태 검증 (약 15초)
node scripts/bot-run.mjs --dodge-rate 50     # 위협의 절반만 피하는 봇(사람에 가까운 난이도 확인)
node scripts/bot-run.mjs --one <시드>        # 한 판을 다시 돌려 방마다의 기록을 출력
node scripts/verify-save.mjs        # 세이브 검증: 왕복, 구버전, 손상 케이스, 무작위 손상, 저장소 세션 흉내 (약 70초)
node scripts/verify-save.mjs --only fuzz     # 한 부분만: roundtrip | old | cases | fuzz | sessions

# 브라우저 검증 — Playwright 가 설치된 환경에서만 돈다(프로젝트 의존성이 아니다). CDN 에 닿지 않으면 --three 로 three@0.186.1 패키지 폴더를 준다
node scripts/browser/verify-play.mjs --three <폴더>     # 한 판 완주(화면 흐름) + 층 진입 페이드·셰이더 미리 컴파일·방 공개·벽 보간 (약 5분, --out <갈무리 폴더>)
node scripts/browser/verify-touch.mjs --three <폴더>    # 터치: 두 번 두드려 확대·핀치·스크롤 막기, 멀티터치, 수동 조준, 화면 밖 이탈, touchcancel, 회전, 백그라운드
node scripts/browser/verify-leaks.mjs --three <폴더>    # 새 판 100번(판마다 첫 전투방에서 7초 싸움): GPU 자원·풀·DOM·힙 추이 (약 15분, --moves N --play-ms N --quality low|medium|high)
```

`src/logic/world/**` 나 `data/world.js`·`data/zones.js`·`data/encounters.js` 를 바꾸면 `verify-maps.mjs` 를 다시 돌리고, 실패 0건을 확인한 뒤 결과를 `BUGS.md` 의 검증 기록에 덧붙인다. 실패한 시드는 시드 값과 함께 기록한다.

`src/logic/**`(world 제외) 나 `data/{combat,player,characters,weapons,boons,enemies,bosses,statuses,encounters,feel,shop,meta}.js` 를 바꾸면 `bot-run.mjs` 를 기본·`--dodge-rate 50`·`--character mage` 로 다시 돌리고, 문제 0건(예외·끝나지 않는 판·검증 실패 없음)을 확인한 뒤 결과(승률·시간)를 `BUGS.md` 에 덧붙인다. 승률은 통계일 뿐 실패 조건이 아니다 — 난이도를 바꿨으면 그 수치를 같이 적는다.

`src/logic/save/**`·`src/save/**`·`data/{save,settings}.js` 를 바꾸거나 **상태 구조를 바꾸면**(`core/state.js`, 행동체·투사체·장판·방·문 등의 필드 추가·삭제) `verify-save.mjs` 를 다시 돌리고, 문제 0건을 확인한 뒤 결과를 `BUGS.md` 의 검증 기록에 덧붙인다. 상태에 필드를 넣는 로직(`src/logic/**` 어디든)을 고쳤을 때도 돌린다 — 검증기가 새 상태를 손상으로 보면 그 순간부터 실제 게임의 저장이 실패한다.

`src/render/**` 를 바꾸면 `verify-play.mjs` 와 `verify-leaks.mjs` 를, `src/ui/**`·`styles.css`·`index.html` 을 바꾸면 `verify-touch.mjs` 와 `verify-play.mjs` 를, `src/main.js` 를 바꾸면 셋 다 다시 돌린다. 돌릴 수 없는 환경이면 "확인 못 함"으로 적는다. 이 스크립트들이 보는 것은 헤드리스 크로미움이다 — 실제 기기에서 본 것과 구분해 적는다.

ES 모듈은 `file://` 로 열 수 없으므로 브라우저 확인은 항상 로컬 서버를 거친다.

**배포**: `pivot` 에 푸시하면 `.github/workflows/pages.yml` 이 테스트를 돌리고 저장소를 그대로 GitHub Pages 에 올린다(빌드 없음).

## 파일 구조

```
index.html                 진입 HTML. importmap(Three.js 버전 고정) + 캔버스 + ui 가 붙는 자리
styles.css                 화면 배치(HUD, 조작부, 메뉴). 세로·가로, 노치(safe-area). 페이지 전체 touch-action: none
package.json               "type": "module" 선언과 스크립트 별칭만. 의존성 없음
.nojekyll                  GitHub Pages 가 Jekyll 처리 없이 그대로 배포하도록
.github/workflows/pages.yml  pivot → GitHub Pages 배포
CLAUDE.md  BUGS.md  TODO.md  README.md
data/                      설정·밸런스 수치 (순수 값, data 끼리만 import)
  config.js                루프 주파수, 렌더 설정(카메라, 벽 가림, 문, 품질 3단계, 풀 크기, 툰 셰이딩 단계, 색)
  feel.js                  손맛: 히트스톱, 카메라 흔들림, 넉백, 번쩍임, 총구 섬광·탄피, 처치 연출, 방 공개 페이드, 진동
  ui.js                    조작(조이스틱·조준 끌기 거리·연속 터치 간격·키보드), 알림 시간
  audio.js                 효과음 정의, 무기별 소리, 구역별 배경음
  world.js                 맵 생성 수치: 층 수, 방 수, 방 배치(BSP), 보스 구역, 숨은 방, 엄폐물 무늬, 구조 규칙
  encounters.js            방 전투: 웨이브 수·예산, 깊이별 난이도, 정예, 방 보상, 처치 보상, 줍기 거리
  zones.js                 구역: 적 풀(가중치·예산 몫·나오는 깊이), 색감, 보스
  combat.js                전투 공통 수치: 어그로, 길찾기, 방어력
  player.js                플레이어 공통 수치(대시·입력 버퍼·맞은 뒤 무적·에너지 없을 때의 근접) + 기술 형식 설명
  characters.js            캐릭터 2종(기사·마법사): 체력·속도·에너지·시작 무기·고유 스킬·해금 값
  weapons.js               무기 14종(근접 6·원거리 8): 기본 공격·대시 공격·에너지·등급·모양
  boons.js                 축복 28종(불·번개·얼음 계열 + 무계열 + 합성 3종), 3택1 규칙
  enemies.js               적 정의(행동 방식 10가지)
  bosses.js                보스(페이즈·패턴)
  statuses.js              상태이상 7종(시간 왜곡 포함)과 중첩·지속·면역 규칙
  shop.js                  상점: 진열 수, 값, 회복, 다시 뽑기
  meta.js                  영혼석 획득량, 영구 강화 6종, 옛 해금 환불표
  save.js                  저장소 키, 세이브 형식 이름, 검증에 쓰는 안전선(상한값)
  settings.js              사용자 설정의 목록·기본값·허용 범위
  freeze.js                설정 객체 동결 도우미
src/
  main.js                  조립 지점: 로직·렌더·UI·소리·저장을 만들어 연결하는 유일한 곳. 히트스톱, 상호작용, 판의 흐름
  logic/                   ── 순수 로직 (DOM·Three.js 금지, Node 테스트 대상)
    game.js                로직 최상단: 판 시작·종료, 층 진입, 틱마다 시스템 실행 순서, 세이브에서 이어하기·복구
    commands.js            로직 최상단: 플레이어 명령(상호작용·무기 줍기/교체·축복 고르기/다시 뽑기·상점·포털·거점 강화)
    core/                  prng.js, event-bus.js, events.js, state.js, loop.js, time.js
    world/                 맵 생성 (아래 "방 구조" 참고)
      generate.js          진입점: 방 구역 + 보스 구역 + 숨은 방 → 방 종류·깊이 → 엄폐물 → 문 → 웨이브·스폰 자리·보상
      floors.js            층 계획(층 → 구역), 방의 종류·보상 이름
      gen-rooms.js         방 배치(BSP)와 곧은 복도(scanLinks/carveLink), 비상용 격자 배치
      gen-boss.js          결투장 무늬(기둥·깎인 모서리)와 엄폐물(addCover), 보스 구역(결투장 + 출구 방)
      gen-cave.js          동굴(셀룰러 오토마타) — 숨은 방의 모양
      structure.js         구조 읽기: 타일과 방 목록에서 칸 → 방·복도 번호, 복도가 잇는 방, 문 칸을 다시 찾는다
      event-rooms.js       상점·보상 방 고르기
      validate.js          검증기: 층이 규칙을 지키는지 확인
      grid.js tiles.js ascii.js nav.js collide.js los.js pathfind.js connect.js
    items/                 boons.js(축복 후보), shop.js(진열품), meta.js(영혼석·영구 강화·캐릭터 해금·정산)
    entities/              actors.js(생성·조회·층 배치), defs.js(정의, 무기 기술), movement.js(이동·넉백·충돌), scaling.js(깊이 배율), stats.js(능력치 합산)
    combat/                전투 (아래 "전투" 참고)
      player.js            입력 → 대시(충전식)·입력 버퍼·무기 공격(에너지·대시 공격·쌍수)·스킬, 무기 교체
      encounter.js         방 전투: 방 공개, 문 잠금, 웨이브 예고·등장, 방 깨기와 보상, 숨은 문
      boons.js             축복의 효과(맞혔을 때·처치했을 때·대시할 때·맞았을 때)
      abilities.js         기술 실행기(준비·발동·경직, 부채꼴·원·투사체·광선·장판·돌진·소환·순간이동)
      hit.js damage.js     명중(피해·넉백·치명타·축복), 피해와 넉백, 보스 페이즈
      projectiles.js       투사체(꿰뚫기·폭발·도탄·분열, 시간 왜곡 안에서 느려짐, 탄 지우기)
      hazards.js           장판(터지는 것, 시간 왜곡)
      statuses.js deaths.js loot.js ai/
    save/                  세이브 (아래 "세이브" 참고)
  render/                  ── Three.js. 로직 상태를 읽기만 함 (아래 "렌더" 참고)
    renderer.js            렌더러·씬·카메라(추적·앞세우기·흔들림)·조명·품질·화면 페이드·셰이더 미리 컴파일, 이벤트 연출
    assets.js              공유 지오메트리·툰 머티리얼
    pool.js camera-rig.js  풀, 카메라 계산(흔들림 포함) — Three.js 를 모름
    world/floor-view.js    층의 바닥·벽·문·소품 InstancedMesh, 방 단위 공개, 벽 낮추기 보간, 횃불 빛, 포털·상인, 문 위 보상 아이콘
    world/reveal.js        방 공개 밝기·벽 높이 보간 계산 — Three.js 를 모름
    entities/models.js     로우폴리 모델(머리·몸·팔다리·무기 분리), 무기 14종 모양
    entities/pose.js       걷기·공격·준비·피격·대시 자세와 처치된 몸의 궤적 — Three.js 를 모름
    entities/actor-views.js  행동체 그리기(풀, 위치 보간, 자세, 번쩍임, 쓰러져 튕겨 나가는 몸)
    effects/effects.js     투사체·예고·장판·스폰 예고·전리품·광선·번개·폭발·총구 섬광·탄피·입자·피해 숫자
  ui/                      ── DOM
    app.js                 ui 의 조립. main.js 는 이 파일만 상대한다
    hud.js minimap.js      체력·에너지·무기·축복·방·보스, 미니맵
    screens.js             타이틀, 캐릭터, 거점, 축복 3택1, 상점, 일시정지, 설정, 결과
    text.js dom.js haptics.js debug-overlay.js
    input/controls.js      조작 상태 기계(포인터·키 → 이번 프레임의 입력, 공격 버튼 끌기 = 수동 조준) — DOM 을 모름
    input/touch-pad.js     가상 조이스틱·버튼
    input/gesture-guard.js 두 번 두드려 확대·핀치·스크롤 막기(아이폰 사파리용)
  audio/engine.js          합성 효과음·배경음
  save/                    storage.js, save-store.js, autosave.js
scripts/
  run-tests.mjs serve.mjs
  verify-maps.mjs          맵 대량 검증(독립 검사 포함)
  bot-run.mjs              봇으로 판 완주(통계·상태 검증·저장 왕복)
  lib/bot.js               봇: 방 고르기, 싸우기(거리 재기·피하기·대시), 줍기, 축복·상점, 포털
  verify-save.mjs lib/save-sim.js lib/save-cases.js
  browser/                 Playwright 검증: lib.mjs, verify-play.mjs, verify-touch.mjs, verify-leaks.mjs
tests/                     src 와 같은 경로 구조. *.test.js
  helpers/arena.js         글자 그림으로 만드는 테스트용 전장(방·문 없음)
  helpers/stage.js         실제 층에서 방 전투를 시험하는 도구
  helpers/save.js          세이브 테스트용 표본 게임(봇이 싸우는 순간), 옛 버전 세이브
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
core(0) ◀ world(1), items(1) ◀ entities(2) ◀ combat(3) ◀ save(4) ◀ game.js·commands.js(최상단)
```

모듈끼리 조율이 필요하면 최상단 파일(`logic/game.js`, `logic/commands.js`)이 순서대로 호출한다. 로직 모듈은 최상단 파일을 import 하지 않는다.

이 규칙은 `tests/architecture.test.js` 가 검사한다. 규칙을 바꿀 때는 이 문서와 `tests/helpers/architecture.js` 를 함께 고친다.

## 데이터 흐름

- **로직 → 바깥**: 로직이 `EventBus` 로 "일어난 일"을 알리고, render/ui/audio 가 구독한다. 이벤트 이름은 `logic/core/events.js` 상수를 쓴다.
- **바깥 → 로직**: ui 는 상태를 직접 고치지 않는다. 매 틱의 조작은 `setInput(state, { moveX, moveY, aimX, aimY, attack, dash, skill })`, 그 밖의 행동(상호작용·무기 교체·축복·상점·거점)은 `logic/commands.js` 의 명령으로 넘긴다. 명령은 `{ ok:true, … }` 또는 `{ ok:false, reason }` 을 돌려준다.
- **프레임**: `main.js` 가 `requestAnimationFrame` 마다 `ui.takeInput()` → `setInput()`(대시·스킬은 누른 프레임에만) → 교체·상호작용 명령 → (히트스톱 중이 아니면) 경과 시간을 `FixedStepLoop.advance()` 에 넘김 → 고정 dt 로 `tick()` 0회 이상 → `autosave.flush()` → `render(state, alpha, dt)` → `ui.update()`.
- **히트스톱**(`main.js`): 맞히고 잡는 순간 로직의 틱을 잠깐 멈춘다(`FEEL.hitstop`). 틱을 늦출 뿐이라 같은 입력이면 결과가 같다.
- **판의 흐름**: 타이틀 → (새 게임) 캐릭터 → 판 → 결과 → 바로 다시 / 거점 / 타이틀. 타이틀·거점에서는 층에 들어가지 않은 빈 게임(메타만 의미 있음)을 쓴다. 화면이 열려 있거나 탭이 가려지면 `PAUSED` 다.

## 방 구조

- 한 판 = `WORLD.stages` 층(지금 1층). 한 층 = **방 구역**(BSP 로 놓은 방 8~12개) + **보스 구역**(위쪽: 결투장과 그 위의 출구 방, 남는 자리에 숨은 동굴방).
- `generateFloor({ seed, floor })` 는 (판 시드, 층 번호)만으로 결정된다. 난수 흐름: 시드 → `fork('world')` → `fork('floor:N')` → `fork('attempt:K')` → `layout` / `boss` / `bonus` / `roles` / `cover` / `waves` / `rewards`. 새 난수 용도는 fork 를 추가한다(기존 결과가 밀리지 않도록).
- **방**: 가로·세로 홀수(가운데 칸이 있다), 전투방은 11×9 이상. 방끼리는 벽 두 칸 이상 떨어진다. **복도**는 곧고(폭 2, 숨은 굴은 1) 짧으며(최대 `maxGap`) 정확히 두 방을 잇는다. **문** = 복도의 양 끝 칸(방의 벽 줄). 순환로가 있어 길이 여러 갈래다.
- **방의 종류**: 시작(보스에서 가장 먼 방) / 전투 / 정예 / 보상 / 상점 / 보스(결투장) / 출구(보스 뒤, 포털) / 숨은 방(동굴, 닫힌 숨은 문 하나로만 이어짐). **깊이** = 시작 방에서 건너는 방의 수(출구·숨은 방 제외 경로).
- **엄폐물**: 전투방 안에 결투장의 기둥 무늬를 작게 돌린다. 벽에서 2칸 안쪽에만 놓아 문 앞과 벽 둘레는 항상 비고, 방이 갈라지지 않는다.
- **웨이브**: 전투방 2~3회, 정예방은 웨이브마다 정예 하나. 예산 = 깊이에 따라 커진다(`ENCOUNTERS.budget`). 적은 구역의 풀에서 `minDepth` 를 넘은 것만. **스폰 자리** = 방 안의, 둘레 8칸이 바닥이고 모든 문에서 2칸 넘게 떨어진 칸.
- **보상**: 전투방마다 축복/무기/금화/체력 가운데 하나(한 층에 축복 방 둘·무기 방 하나 이상). 정예·보스는 축복. 다음 방의 보상은 문 위에 아이콘으로 보인다.
- 맵 객체: `{ floor, zoneId, kind:'stage', algorithm, width, height, tiles, start, rooms, doors, links, gen }`. `tiles` 는 0 벽 / 1 바닥 / 2 닫힌 문. 방: `{ id, kind, x, y, w, h, shape, depth, reward, cover, feature, doors, waves, spawnCells, state, wave, seen }`, 문: `{ id, room, to, link, cells, x, y, open, secret }`, 복도: `{ id, rooms, doors, secret, seen }`. 방의 `state·wave·seen`, 문의 `open`, 복도의 `seen` 은 실행 중에 바뀐다(세이브에 들어간다).
- **구역 번호**(`world/structure.js`): 방은 방 번호, 복도는 (방의 수 + 복도 번호). 로직(`navOf(map).region`)·렌더·검증기가 같은 번호를 타일에서 다시 읽어 쓴다.
- 생성기는 `validateFloor` 를 통과한 층만 내보낸다. 실패한 시도는 버리고 다시 만들며, `WORLD.maxAttempts` 번을 넘기면 격자 모양의 비상 레이아웃으로 대체한다.
- 규칙을 추가·변경하면 `validate.js`, `tests/logic/world/validate.test.js`, `scripts/verify-maps.mjs` 의 독립 검사를 함께 고친다.

## 전투

- **실시간이다.** 위치는 칸 단위 실수, 몸은 원이다. 타이머는 정수 틱(`ticksOf()`), "언제까지"는 `state.tick` 과 비교하는 틱 번호로 저장한다.
- **틱 순서**(`logic/game.js`): 상태이상 → 플레이어 조작 → 적 AI → 기술 발동 → 이동·넉백·충돌 → 돌진 명중 → 투사체 → 장판 → 죽음 처리 → 방 전투(공개·잠금·웨이브·방 깨기) → 줍기. 순서를 바꾸면 같은 시드·같은 입력의 결과가 달라진다.
- **방 전투**(`combat/encounter.js`): 전투방에 충분히 들어서면(문턱에서는 아님) 문이 닫힌 문 타일이 되어 벽처럼 막고, 웨이브의 적이 예고(바닥의 붉은 고리, `spawnWarnSec`) 뒤에 깨어난 채 나타난다. 웨이브를 모두 잡아야 다음 웨이브, 마지막을 잡으면 문이 열리고 적의 탄·장판이 사라지며 보상이 놓인다. 싸움이 없는 방은 들어서는 것으로 끝난다.
- **대시**: 충전식(기본 2회, `recharge` 초마다 하나). 무적 0.25초, 적과 탄을 통과. 준비·경직 중에도 끊고 나간다. 대시가 끝나고 `attackWindow` 안의 공격은 그 무기의 **대시 공격**.
- **입력 버퍼**: 지금 할 수 없는 대시·스킬 입력을 0.15초 기억했다가 가능해지는 틱에 실행한다.
- **무기**: 두 칸, 교체 가능. 원거리는 쏠 때마다 에너지, 근접은 무료. 에너지가 모자라면 개머리판(약한 근접)이 대신 나간다. 기본은 자동 조준(가까운 적), 조준 입력이 있으면 그 방향(수동 조준). 무기의 기술 id 는 `w:<무기>` / `w:<무기>:dash`.
- **캐릭터 스킬**: 기사 = 쌍수 사격(지속 동안 다른 손 무기도 함께, 에너지 없음), 마법사 = 시간 왜곡 장판(안의 적과 적의 탄이 느려짐).
- **넉백**: 맞은 쪽의 반대로 밀려나는 속도(`kbX/kbY`)를 더하고 틱마다 줄인다. 무게로 나눈다. 세면 준비 중이던 공격이 끊긴다(경직). 플레이어는 맞으면 조금 밀려나고 잠깐 무적(`hurtInvuln`).
- **축복**(`combat/boons.js`): 맞혔을 때(번개 연쇄·점화·서리·과충전…), 처치했을 때(연쇄 폭발·번지는 불·흡혈), 대시(불길·정전기·빙결), 맞았을 때(얼음 갑옷), 탄(관통·분열·도탄), 피해 배율(궁지·깨뜨리기·거인 사냥꾼). 축복이 낸 피해는 다시 축복을 부르지 않는다(끝없이 되풀이되지 않도록). 확률 굴림은 결과와 무관하게 같은 횟수만큼.
- **적**: 대기 → (반경 안 + 시야, 또는 깨워짐) → 전투. 한번 싸우면 끝까지 쫓는다(리쉬 없음). 방 전투로 나온 적은 깨워진 채 나타난다. 체력·공격은 그 방의 깊이로 정해진다(`entities/scaling.js`). 정예는 크고 단단하다.
- **적의 공격은 읽을 수 있게**: 준비 시간 동안 바닥에 범위(부채꼴·원)나 진행선(투사체·돌진)이 차오른다. 적의 탄은 크고 따뜻한 색에 밝은 테두리.
- **모든 피해는 `dealDamage` 를, 모든 상태이상은 `applyStatus` 를 거친다.** 새 효과 종류는 `abilities.js` 의 `runEffects` 에 추가한다.

## 빌드와 메타

- **축복 3택1**: 가진 축복은 다시 나오지 않는다. 합성 축복은 그 두 계열의 축복을 하나씩 가져야 후보가 된다. 금화로 다시 뽑기(값이 오른다, 무료 횟수는 영구 강화). 후보가 떠 있는 동안(`state.run.choice`) ui 가 게임을 멈추고 화면을 띄운다.
- **능력치는 항상 처음부터 다시 합산한다**(`entities/stats.js`): 캐릭터 기본값 + 영구 강화 + 능력치를 바꾸는 축복(유리 대포·세 번째 숨·가속·전도). 축복을 얻거나 메타가 바뀌면 `refreshPlayerStats(state)` 를 부른다.
- **상점**: 무기 둘·축복 둘·회복. 진열품은 (판 시드, 층)으로 정해지고, 다시 뽑기는 items 스트림을 쓴다.
- **메타**(`state.meta`): 영혼석(깬 방·정예·보스·승리), 영구 강화 6종(단계마다 값이 오른다), 캐릭터 해금, 기록. 판과 따로 저장된다.
- **난수**: 처치 보상·방 보상·축복 후보·상점 다시 뽑기는 `rngOf(state, 'items')`, 치명타·상태이상 확률·흩어짐·축복 확률은 `'combat'`, 스폰 자리 섞기·소환 자리는 `'entities'`.

## 렌더

- **좌표**: 로직의 (x, y) 는 화면의 (x, 0, z=y). 카메라는 플레이어 남쪽(+y) 위에서 내려다보는 고정 쿼터뷰, 바라보는 쪽으로 조금 앞세운다.
- **층에 들어갈 때**: 화면을 검게 덮은 채로(veil = 1) 그 층의 메시를 모두 만들고, 모든 모델·이펙트 풀을 하나씩 보이게 해 `renderer.compile()` 로 셰이더를 미리 컴파일한 뒤, 두 프레임 그리고 `FEEL.reveal.screenFadeSec` 동안 페이드 인한다. 그 뒤로는 플레이 중에 셰이더가 새로 생기지 않아야 한다(`verify-play.mjs` 가 확인).
- **방 단위 공개**: 칸 단위 안개는 없다. 구역마다 밝기(0~1)를 두고, 드러나면(방에 들어섬, 복도에 섬) 구역 전체가 `FEEL.reveal.roomSec`(0.3초) 동안 함께 밝아진다. 바뀌는 구역의 인스턴스 색만 고친다.
- **벽 낮추기**: 플레이어 남쪽(카메라 쪽) 벽의 목표 높이를 낮추고, 높이는 프레임마다 보간한다(칸을 넘는 순간 튀지 않는다).
- **자원의 수명**: 공유 자원(`assets.js`)과 풀(행동체 모델, 투사체, 바닥 표시, 전리품, 섬광, 번개, 탄피, 입자, 피해 숫자)은 렌더러와 함께 산다. 층 자원(바닥·벽·문·소품 InstancedMesh, 바닥 텍스처, 횃불 빛, 포털·상인, 보상 아이콘)은 `state.world.tiles` 가 바뀌면 `dispose()` 하고 새로 만든다. 새 메시는 어느 쪽인지 정하고, 층 자원이면 `floor-view.js` 의 `dispose()` 에 넣는다.
- **지오메트리·머티리얼을 그 자리에서 `new` 하지 않는다.** `assets.geometries`, `assets.toon(색)`, `assets.flat(색, 투명도)`, `assets.glow(색, 투명도)` 를 쓴다. 새 머티리얼 종류를 추가하면 미리 컴파일(`prewarm`)에도 넣는다.
- **모델**(`entities/models.js`): 원기둥 몸통이 아니라 머리·몸통·팔다리·무기가 따로 움직이는 로우폴리 모델. 자세는 `pose.js` 가 계산(걷기·준비·공격·피격·대시). 맞으면 하얗게 번쩍이고, 쓰러진 적은 맞은 방향으로 튕겨 나가며 사라진다.
- **손맛**(`data/feel.js`): 히트스톱(main.js), 카메라 흔들림(renderer), 넉백(로직), 번쩍임·총구 섬광·탄피·처치 연출(render), 진동(ui).
- **꾸밈용 난수**(입자, 바닥 무늬, 소품)는 `Rng.fromSeed('render:cosmetic')`. `Math.random` 은 여기서도 쓰지 않는다.
- Three.js 를 쓰는 파일은 Node 에서 불러올 수 없다. 계산은 Three.js 를 모르는 파일(`pool.js`, `camera-rig.js`, `world/reveal.js`, `entities/pose.js`)로 빼서 Node 테스트를 붙이고, 나머지는 `scripts/browser/` 로 확인한다.

## 조작과 UI

- **입력은 포인터 이벤트**(손가락마다 `pointerId`). 판단은 `input/controls.js`(DOM 을 모름).
- 규칙: 스틱은 포인터 하나가 잡는다. 버튼은 포인터마다 하나. 공격은 누르는 동안 계속, **공격 버튼을 누른 채 끌면 수동 조준**(놓으면 자동 조준). 대시·스킬·교체·상호작용은 누른 순간 한 번. 손가락이 화면 밖으로 나가도 포인터 캡처로 유지된다.
- **전부 놓기**(`ui.resetInput()`): 탭이 가려질 때·돌아올 때, 화면 크기·방향이 바뀔 때, 창이 초점을 잃을 때, 화면(메뉴)이 열릴 때.
- **확대·스크롤 막기**: 페이지 전체 `touch-action: none`, 버튼은 `manipulation`, 스크롤 목록(`.scroll`)만 `pan-y`. 아이폰 사파리는 viewport 의 `user-scalable=no` 를 무시하므로 `input/gesture-guard.js` 가 gesture*·dblclick·두 손가락 이동·짧은 간격의 연속 touchend 의 기본 동작을 막고, 막은 터치가 버튼 위였으면 `click()` 을 직접 보내 버튼 입력을 살린다.
- **화면(메뉴)이 열리면 게임을 멈춘다**(`PAUSED`). 화면은 상태를 읽어 그리고, 바꾸는 일은 `logic/commands.js` 의 명령과 `main.js` 가 준 actions 로만 한다.
- `?debug=1` 이면 디버그 표시가 나오고 `window.__fable` 로 게임·렌더러·ui 와 자동 조작 자리(`setAutopilot`)를 내놓는다(브라우저 검증용).

## 소리

- 녹음된 파일 없이 합성한다(`data/audio.js`). 무기 모양마다 소리가 다르다(`WEAPON_SFX`).
- **AudioContext 는 첫 터치·클릭·키 입력에서 만든다**(`audio.unlock()`). 탭이 가려지면 `suspend()`, 돌아오면 `resume()`. 보스 방에 들어서면 배경음이 빨라진다.

## 세이브

- **세 가지를 따로 저장한다**: 판(`fable:run`, 상태 전체에서 `meta` 를 뺀 것), 메타(`fable:meta`), 설정(`fable:settings`). 키마다 `:bak`(앞의 저장본)과 `:bad`(읽지 못한 원본).
- **판 세이브는 상태를 통째로 담는다**(시드·맵과 방·문의 진행·플레이어·적·투사체·장판·방 전투·전리품·상점·난수 위치). 불러오면 저장한 틱 그대로 이어지고, 같은 입력을 주면 저장하지 않은 게임과 틱마다 같다.
- **저장 시점**: 층 진입, 방을 깰 때, 일시정지, 판 종료, 화면이 가려질 때(곧바로).
- **버전**: 판은 `STATE_VERSION`(5), 메타는 `META_VERSION`(2), 설정은 `SETTINGS_VERSION`(2). **판 v1~4(방 단위 구조 이전)는 이어하지 않는다**(`MIN_VERSION`, 읽기 결과 `none`/`retired-version`). 메타 v1 은 v2 로 올리며 옛 해금 값을 영혼석으로 돌려준다. 구조를 바꾸면 버전을 올리고 `migrate.js` 에 `n → n+1` 단계를 하나 추가하고 `validate.js` 를 고친다.
- **읽기 결과는 넷**(`readRun`): `exact` / `salvage`(핵심 — 시드·층·캐릭터·무기·에너지·축복·금화·기록 — 만 건져 그 층을 처음 방부터. 떠 있던 축복 3택1 은 다시 제시) / `finished` / `none`.
- **검증기(`validate.js`)를 통과한 상태만 쓰고, 통과한 상태만 그대로 이어한다.** 기준은 "로직이 이 값을 읽다가 죽거나 NaN 을 퍼뜨리지 않는가". 방·문·복도 번호가 서로 맞는지, 문의 열림과 타일이 맞는지, 전투 중인 방과 전투 정보가 맞는지도 본다. **검증기의 오탐은 곧 저장 실패다.**
- **세이브에서 온 이름은 `Object.hasOwn(표, 이름)` 으로 확인한다.** 상태 안의 객체는 한 곳에서만 가리킨다(`{ ...effect.status }` 처럼 사본을 넣는다).
- **저장 실패는 게임을 멈추지 않는다.** 저장소가 없으면 메모리로, 용량이 모자라면 격리본 → 판 백업 순으로 지운다.
- **틱이 예외를 던지면**(`main.js`) `rescueGame` 으로 핵심만 건져 그 층을 다시 차리고, 안 되면 타이틀로.

## 코드 규약

- **상태는 JSON 으로 그대로 직렬화되는 평범한 객체다.** 클래스 인스턴스·함수·Map/Set·순환 참조·`undefined`·NaN 을 넣지 않고, 한 객체를 두 곳에서 가리키지 않는다.
- **난수 쓰는 법**: 모듈은 `rngOf(state, '<스트림>')` 로 자기 스트림을 꺼내 쓴다(world, entities, combat, items). "언제 뽑든 결과가 같아야 하는 것"은 fork 한다.
- `tests/logic/core/prng.test.js` 와 `tests/logic/world/generate.test.js` 의 고정값 테스트가 깨지면 기존 시드·세이브의 결과가 바뀐다는 뜻이다. 의도한 변경이면 값을 갱신하고 `BUGS.md` 에 적는다.
- **순수 로직에서는 `Math.sin/cos/atan2/pow/hypot/exp/log` 와 `**` 를 쓰지 않는다.** 각도가 필요하면 [cos, sin] 값을 `data/` 에 미리 적어 둔다(`data/weapons.js`·`bosses.js` 참고). `tests/architecture.test.js` 가 검사한다.
- 상태를 훑을 때는 `allActors(state)` 처럼 id 순서가 정해진 목록을 쓴다.
- 로직 함수는 잘못된 인자에 예외를 던진다.
- 주석·문서·테스트 이름은 한국어로 쓴다.
