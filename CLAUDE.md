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
node scripts/verify-items.mjs       # 아이템·성장 검증: 드롭 분포, 옵션 범위, 세트, 3택1, 전투력 곡선 (약 35초)
node scripts/verify-items.mjs --only curve       # 한 부분만: drops | ranges | sets | choices | curve
node scripts/verify-save.mjs        # 세이브 검증: 왕복, 구버전, 손상 케이스, 무작위 손상, 저장소 세션 흉내 (약 40초)
node scripts/verify-save.mjs --only fuzz         # 한 부분만: roundtrip | old | cases | fuzz | sessions
node scripts/make-old-saves.mjs     # tests/fixtures 의 구버전 세이브 표본을 옛 커밋의 코드로 다시 만든다(git 필요)

# 브라우저 검증 — Playwright 가 설치된 환경에서만 돈다(프로젝트 의존성이 아니다). CDN 에 닿지 않으면 --three 로 three@0.186.1 패키지 폴더를 준다
node scripts/browser/verify-leaks.mjs --three <폴더>    # 층 이동 100회: GPU 자원·풀·DOM·힙 추이 (약 4분, --moves N --quality low|medium|high)
node scripts/browser/verify-touch.mjs --three <폴더>    # 터치: 멀티터치, 화면 밖 이탈, touchcancel, 회전, 백그라운드 (약 40초)
node scripts/browser/verify-ui.mjs --three <폴더>       # 화면 흐름 전체 + 카메라·안개·벽 가림·품질 (약 1분, --out <갈무리 폴더>)
```

`src/logic/world/**` 나 `data/world.js`·`data/zones.js` 를 바꾸면 `verify-maps.mjs` 를 다시 돌리고, 실패 0건을 확인한 뒤 결과를 `BUGS.md` 의 검증 기록에 덧붙인다. 실패한 시드는 시드 값·층과 함께 기록한다.

`src/logic/entities/**`·`src/logic/combat/**`·`src/logic/world/{collide,los,fov,pathfind,nav}.js` 나 `data/{combat,player,enemies,bosses,statuses}.js` 를 바꾸면 `sim-combat.mjs` 를 다시 돌리고, 문제 0건을 확인한 뒤 결과를 `BUGS.md` 의 검증 기록에 덧붙인다. 문제가 나온 대결은 시드(`<종류>-<방식>-<번호>`)와 함께 기록한다.

`src/logic/items/**`·`src/logic/commands.js`·`src/logic/combat/loot.js`·`src/logic/entities/{stats,scaling}.js` 나 `data/{items,consumables,relics,upgrades,difficulty,shop,meta}.js` 를 바꾸면 `verify-items.mjs` 를 다시 돌리고, 문제 0건(급변 구간 없음 포함)을 확인한 뒤 결과를 `BUGS.md` 의 검증 기록에 덧붙인다. 전투 수치(`data/player.js`·`enemies.js`·`bosses.js`·`combat.js`)를 바꿔도 곡선이 달라지므로 함께 돌린다.

`src/logic/save/**`·`src/save/**`·`data/{save,settings}.js` 를 바꾸거나 **상태 구조를 바꾸면**(`core/state.js`, 행동체·투사체·장판·인벤토리 등의 필드 추가·삭제) `verify-save.mjs` 를 다시 돌리고, 문제 0건을 확인한 뒤 결과를 `BUGS.md` 의 검증 기록에 덧붙인다. 상태에 필드를 넣는 로직(`src/logic/**` 어디든)을 고쳤을 때도 돌린다 — 검증기가 새 상태를 손상으로 보면 그 순간부터 실제 게임의 저장이 실패한다.

`src/render/**` 를 바꾸면 `verify-leaks.mjs` 를, `src/ui/**`·`styles.css`·`index.html` 을 바꾸면 `verify-touch.mjs` 와 `verify-ui.mjs` 를, `src/main.js` 를 바꾸면 셋 다 다시 돌린다. 돌릴 수 없는 환경이면 "확인 못 함"으로 적는다. 이 스크립트들이 보는 것은 헤드리스 크로미움이다 — 실제 기기에서 본 것과 구분해 적는다.

ES 모듈은 `file://` 로 열 수 없으므로 브라우저 확인은 항상 로컬 서버를 거친다.

## 파일 구조

`(예정)` 은 아직 없는 디렉터리다. 해당 단계에서 만든다.

```
index.html                 진입 HTML. importmap(Three.js 버전 고정) + 캔버스 + ui 가 붙는 자리
styles.css                 화면 배치(HUD, 조작부, 메뉴). 세로·가로, 노치(safe-area)
package.json               "type": "module" 선언과 스크립트 별칭만. 의존성 없음
.nojekyll                  GitHub Pages 가 Jekyll 처리 없이 그대로 배포하도록
CLAUDE.md  BUGS.md  TODO.md  README.md
data/                      설정·밸런스 수치 (순수 값, data 끼리만 import)
  config.js                루프 주파수, 렌더 설정(카메라, 벽 가림, 안개 밝기, 품질 3단계, 풀 크기, 색)
  ui.js                    조작(조이스틱 반지름·불감대, 진동 길이, 키보드), 알림 시간
  audio.js                 효과음 정의, 구역별 배경음(음계·빠르기·수열)
  world.js                 맵 생성 수치: 재시도 상한, 배치 거리, 생성기·보스층 설정
  zones.js                 구역 6개: 맵 크기, 알고리즘 비율, 타일셋, 색감, 적 풀, 보스
  combat.js                전투 공통 수치: 시야, 어그로·리쉬, 길찾기
  player.js                플레이어 스탯·기술·회피 + 기술 형식 설명
  enemies.js               적 20종(행동 방식 10가지)
  bosses.js                중간보스 3종, 최종보스 1종(페이즈·패턴)
  statuses.js              상태이상 6종과 중첩·지속·면역 규칙
  items.js                 능력치 목록, 장비 등급·기본 종류·옵션 풀·세트, 드롭 규칙, 가격, 인벤토리
  consumables.js           소비 아이템 6종
  relics.js                패시브 유물 14종
  upgrades.js              레벨 곡선, 강화 17종, 3택1 규칙, 채움 보상
  difficulty.js            층별 난이도 곡선(구역별 적 체력·공격 배율, 보스 배율, 밀도)
  shop.js                  상점 품목·가격, 제단의 대가와 보상
  meta.js                  영혼석 획득량, 영구 해금 13종
  save.js                  저장소 키, 세이브 형식 이름, 검증에 쓰는 안전선(상한값)
  settings.js              사용자 설정의 목록·기본값·허용 범위
  freeze.js                설정 객체 동결 도우미
src/
  main.js                  조립 지점: 로직·렌더·UI 를 만들어 연결하는 유일한 곳
  logic/                   ── 순수 로직 (DOM·Three.js 금지, Node 테스트 대상)
    game.js                로직 최상단: 런 시작·종료, 층 진입, 틱마다 시스템 실행 순서, 세이브에서 이어하기(resumeGame)·복구(rescueGame)
    commands.js            로직 최상단: 플레이어 명령(계단 내려가기·착용·소비·사고팔기·제단·강화 선택·메타 해금)
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
    items/                 아이템과 성장 (아래 "아이템과 성장" 참고) — 평범한 객체만 다루고 행동체를 모른다
      equipment.js         장비 생성, 옵션 범위, 등급 가중치, 가격
      stats.js             능력치 합산(세트 효과 포함), 비교값
      inventory.js         가방·착용·소비 아이템·유물·금화
      drops.js             적·보스·상자의 전리품 굴림
      shop.js  altar.js    상점 품목과 거래, 제단 제안
      levelup.js           경험치, 강화 3택1
      meta.js              영혼석, 영구 해금, 런 정산
    entities/              행동체(플레이어·적·보스)
      actors.js            생성·조회, 층 배치
      defs.js              데이터 정의 찾기
      movement.js          이동·돌진, 벽 충돌, 서로 밀어내기
      vision.js            플레이어 시야(안개용 자료)
      scaling.js           층별 난이도 배율
      stats.js             합산 능력치를 플레이어 수치로 반영
    combat/                전투 (아래 "엔티티와 전투" 참고)
      damage.js            피해 처리, 보스 페이즈 전환
      statuses.js          상태이상
      abilities.js         기술 실행기(준비·발동·경직, 효과, 돌진)
      hit.js               명중 처리(피해+흡혈+상태이상)
      projectiles.js  hazards.js   투사체, 장판
      player.js            입력 → 플레이어 행동
      deaths.js            죽음 처리(사망 효과, 처치 보상, 되살아남, 정리)
      loot.js              층의 상자·상점·제단 배치, 처치 보상, 줍기, 물약 효과 만료·체력 재생
      ai/brain.js          어그로·리쉬 상태 관리
      ai/behaviors.js      행동 방식 10가지 + 보스
      ai/steer.js          조향(직선/A* 경로 따라가기, 물러나기)
    save/                  세이브 (아래 "세이브" 참고) — 글을 만들고 읽을 뿐, 저장소는 모른다
      codec.js             진입점: serializeRun/readRun, 메타·설정 쓰기·읽기
      envelope.js          봉투(형식·종류·버전·체크섬 + 본문)
      checksum.js          FNV-1a 32비트
      migrate.js           순차 마이그레이션 표(버전 n → n+1)
      validate.js          런 상태 검증기(그대로 이어서 돌려도 안전한가)
      schema.js            검증용 작은 도구(int·shape·record…)
      salvage.js           건져 내기: 망가진 세이브에서 핵심(시드·층·진행도·인벤토리)만 골라냄
      settings.js          설정 기본값·정리
  render/                  ── Three.js. 로직 상태를 읽기만 함 (아래 "렌더" 참고)
    renderer.js            렌더러·씬·카메라·조명·품질. 층이 바뀌면 앞 층의 자원을 버린다
    assets.js              공유 지오메트리·머티리얼(한 번 만들어 계속 쓴다)
    pool.js                오브젝트 풀 두 가지(꺼내고 돌려놓기 / 프레임마다 채우기) — Three.js 를 모름
    camera-rig.js          카메라 추적·벽 가림·화면 비율 계산 — Three.js 를 모름
    world/floor-view.js    한 층의 바닥·벽 InstancedMesh, 안개(인스턴스 색), 벽 가림(인스턴스 높이), 표식
    world/fog.js           안개 단계 계산 — Three.js 를 모름
    entities/actor-views.js  행동체 그리기(풀, 위치 보간, 체력 막대, 상태이상 표시)
    effects/effects.js     투사체·장판·예고·전리품·입자·피해 숫자(모두 풀)
  ui/                      ── DOM: HUD, 메뉴, 터치 입력 (아래 "조작과 UI" 참고)
    app.js                 ui 의 조립: HUD·조작부·화면을 잇는다. main.js 는 이 파일만 상대한다
    hud.js                 체력·경험치·층·금화, 보스 체력, 물약·상황 버튼, 알림
    screens.js             타이틀, 일시정지, 설정, 가방, 상점, 제단, 강화 3택1, 결과, 영구 해금
    text.js                화면에 보일 문구를 데이터에서 만든다
    dom.js  haptics.js     DOM 도우미, 진동
    input/controls.js      조작 상태 기계(포인터·키 → 이번 프레임의 입력) — DOM 을 모름
    input/touch-pad.js     가상 조이스틱·버튼을 화면에 만들고 포인터 이벤트를 넘긴다
    debug-overlay.js       개발용 상태 표시(?debug=1)
  audio/                   ── WebAudio
    engine.js              합성 효과음·배경음. 첫 입력 뒤에 장치를 만든다
  save/                    ── 저장소 어댑터. 직렬화 자체는 logic/save
    storage.js             저장소 열기(없음·차단·가득 참 처리, 메모리 대체), 예외를 결과로 바꿈
    save-store.js          런·메타·설정의 키, 백업·격리, 용량 초과 때 자리 비우기
    autosave.js            저장 시점(층 이동·일시정지·런 종료·백그라운드 전환)
scripts/
  run-tests.mjs            테스트 러너
  serve.mjs                로컬 정적 서버
  verify-maps.mjs          맵 생성 대량 검증(시드 × 전 층, 통계 출력)
  sim-combat.mjs           전투 시뮬레이션(종류 × 대결 방식, 통계 출력)
  lib/combat-sim.js        대결 차리기, 자동 조작, 매 틱 불변식 검사
  verify-items.mjs         아이템·성장 검증(드롭 분포·옵션 범위·세트·3택1·전투력 곡선)
  lib/item-checks.js       로직과 따로 구현한 계산기와 불변식 검사
  lib/progress-sim.js      진행 시뮬레이터(전투 없이 30층을 실제 로직으로 진행), 전투력 지표
  verify-save.mjs          세이브 검증(왕복·구버전·손상 케이스·무작위 손상·세션 흉내)
  lib/save-sim.js          자동 조작, 가짜 저장소, 무작위 손상기, 공유 객체·NaN 찾기
  lib/save-cases.js        손상된 세이브 목록(138가지)과 기대 결과
  make-old-saves.mjs       옛 커밋의 코드로 구버전 세이브 표본 만들기
  browser/                 브라우저 검증(Playwright 필요): lib.mjs, verify-leaks.mjs, verify-touch.mjs, verify-ui.mjs
tests/                     src 와 같은 경로 구조. *.test.js
  architecture.test.js     아래 의존 규칙을 자동 검사
  helpers/architecture.js  규칙 정의(LAYERS, LOGIC_RANK)와 검사기
  helpers/arena.js         글자 그림으로 만드는 테스트용 전장
  helpers/save.js          세이브 테스트용 표본 게임, 구버전 세이브, 앱 시작 흐름
  fixtures/state-v*.json   구버전(v1~v3) 상태 — 그 버전의 실제 코드가 만든 것
  logic/core/*.test.js
  logic/world/*.test.js
  logic/entities/*.test.js
  logic/combat/*.test.js
  logic/items/*.test.js
  logic/save/*.test.js
  logic/commands.test.js
  save/*.test.js           저장소·백업·자동 저장(가짜 저장소로 Node 에서 실행)
  render/pure.test.js      렌더에서 Three.js 를 쓰지 않는 부분(풀, 카메라 계산, 안개 단계)
  ui/controls.test.js      조작 상태 기계(멀티터치, 취소, 화면 밖 이탈, 전부 놓기)
  audio/engine.test.js     소리 엔진(가짜 AudioContext)
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

items 는 순위가 낮아서 행동체(entities)를 모른다: 인벤토리·런 진행 같은 평범한 객체만 고친다. 그 결과를 플레이어에게 반영하는 것은 `entities/stats.js`, 전투와 엮는 것은 `combat/loot.js`, 명령으로 묶는 것은 `commands.js` 다.

entities 는 "몸"(생성, 이동, 충돌, 시야)만 다루고 combat 을 모른다. 피해·상태이상·기술·AI·플레이어 조작은 모두 combat 에 있다(적 AI 는 `combat/ai/`). 격자 기하(충돌·시야선·길찾기)는 world 에 있다.

이 규칙은 `tests/architecture.test.js` 가 검사한다. 규칙을 바꿀 때는 이 문서와 `tests/helpers/architecture.js` 를 함께 고친다. 새 최상위 디렉터리나 로직 모듈을 추가하면 검사기에 등록해야 테스트가 통과한다.

## 데이터 흐름

- **로직 → 바깥**: 로직이 `EventBus` 로 "일어난 일"을 알리고, render/ui/audio 가 구독한다. 이벤트 이름은 `logic/core/events.js` 상수를 쓴다.
- **저장**: `main.js` 가 시작할 때 `store.load()` 로 읽어 두고, 타이틀의 "이어하기"에서 `resumeGame()` 으로 잇는다. 이후 `autosave` 가 이벤트(층 이동·일시정지·런 종료)를 듣고 예약해 두었다가 프레임 끝의 `autosave.flush()` 에서 쓰고, 화면이 가려지면(`visibilitychange`·`pagehide`) 곧바로 쓴다.
- **바깥 → 로직**: ui 는 상태를 직접 고치지 않는다. 매 틱의 조작은 `setInput(state, …)`, 그 밖의 행동(착용·구매·강화 선택 등)은 `logic/commands.js` 의 명령으로 넘긴다. 명령은 `{ ok:true, … }` 또는 `{ ok:false, reason }` 을 돌려준다.
- **프레임**: `main.js` 가 `requestAnimationFrame` 마다 `ui.takeInput()` → `setInput()` → 경과 시간을 `FixedStepLoop.advance()` 에 넘김 → 고정 dt 로 `tick()` 0회 이상 → `autosave.flush()` → `render(state, alpha, dt)` → `ui.update()`.
- **앱의 흐름**(`main.js`): 타이틀(층에 들어가지 않은 빈 게임, 메타만 의미가 있다) → 새 게임 또는 이어하기 → 런 → 결과 → 타이틀. 화면이 열려 있거나 탭이 가려지면 `PAUSED` 다.

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
- **틱 순서**(`logic/game.js` 의 `tick`): 상태이상 → 플레이어 조작 → 적 AI → 기술 발동 → 이동·충돌 → 돌진 명중 → 투사체 → 장판 → 죽음 처리(처치 보상) → 줍기 → 물약 만료·재생 → 시야. 순서를 바꾸면 같은 시드·같은 입력의 결과가 달라진다.
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

## 아이템과 성장

- **능력치는 항상 처음부터 다시 합산한다**(`items/stats.js` 의 `computeSheet`). 장비·유물·강화·영구 효과·물약 효과가 바뀌면 `refreshPlayerStats(state)` 를 부른다. 능력치를 더했다 빼는 식으로 고치지 않는다 — 세트 효과가 두 번 들어가거나 값이 틀어지는 일을 원천적으로 막는다.
- **능력치는 전부 정수**이고 목록·상한·하한은 `data/items.js` 의 `STATS` 에 있다. 새 능력치를 추가하면 `STATS`, `SCORE_WEIGHTS`, `entities/stats.js`(플레이어에 반영), `scripts/lib/item-checks.js`(독립 검사)를 함께 고친다.
- **장비**: `{ kind:'equipment', uid, base, slot, rarity, ilvl, setId, implicit:[{stat,value}], affixes:[{stat,value}] }`. 옵션 값의 범위는 `optionRange(옵션, 등급, 레벨)` 한 곳에서 정해진다. 등급별 옵션 수와 배율은 `RARITY`.
- **세트**: 2개 이상이면 2세트, 4개 이상이면 4세트 효과가 각각 한 번 붙는다(4개면 둘 다).
- **피해 공식**: 효과의 기본 피해 × 가해자의 `power` × (치명타면 `critDamage`) → 정면 방어 → 방어력(받는 피해 × K ÷ (K + 방어력), `COMBAT.armorK`) → 반올림. 지속 피해는 공격력·방어력과 무관하다.
- **난수**: 적 처치 보상·레벨업 후보·제단의 유물은 `rngOf(state, 'items')` 를 차례로 쓴다. 층의 상자·상점·제단은 `rngOf(state, 'items').fork(`floor:${n}`)` 에서 갈라 쓰므로 (런 시드, 층)으로 정해진다. 확률 굴림은 결과와 무관하게 같은 횟수만큼 굴린다(수치를 조정해도 뒤의 수열이 밀리지 않도록).
- **강화 3택1 규칙**은 `data/upgrades.js` 머리말이 기준이다(중복·선행 조건·배타·시너지·채움 보상).
- **난이도 곡선**은 `data/difficulty.js` 에 있고, `verify-items.mjs` 의 곡선 표로 맞춘다. 일반 층은 계산 지표(위협 = 적 하나를 잡는 시간 ÷ 버티는 시간)가, 보스는 실제 1:1 대결 승률이 층을 따라 고르게 변해야 한다. 급변 기준은 스크립트에 있다.
- **메타 진행**은 `state.meta` 에 있다. `createGame({ seed, meta })` 로 넘기면 복사해서 쓰고, 런이 끝나면(`endRun`) 영혼석과 기록이 여기에 더해진다. 런과 따로 저장된다("세이브" 참고).
- 소환·분열로 생긴 적과 플레이어가 잡지 않은 적은 경험치·전리품을 주지 않는다.

## 렌더

- **좌표**: 로직의 (x, y) 는 화면의 (x, 0, z=y) 다. 카메라는 플레이어의 남쪽(+y) 위에서 내려다보는 고정 쿼터뷰다 — 화면 위쪽이 맵의 −y.
- **자원의 수명은 둘로 나눈다.** 공유 자원(`assets.js` 의 지오메트리·머티리얼)과 풀(행동체 뷰, 투사체, 원, 전리품, 입자, 피해 숫자)은 렌더러와 함께 살고 층이 바뀌어도 다시 쓴다. 층 자원(바닥·벽 InstancedMesh, 바닥 텍스처, 표식)은 `state.world.tiles` 가 바뀌면 앞 층의 것을 `dispose()` 하고 새로 만든다. 새 메시를 추가할 때는 어느 쪽인지 정하고, 층 자원이면 `floor-view.js` 의 `dispose()` 에 넣는다.
- **지오메트리·머티리얼을 그 자리에서 `new` 하지 않는다.** `assets.geometries`, `assets.lit(색)`, `assets.flat(색, 투명도)` 를 쓴다. 자주 생겼다 사라지는 것은 `pool.js` 의 풀을 쓴다.
- **맵은 InstancedMesh 둘**(바닥, 벽)이다. 시야 안개는 인스턴스 색의 밝기(보임 1 / 탐험함 0.32 / 가 보지 않음 0)로, 벽 가림은 플레이어 남쪽 벽의 인스턴스 높이를 낮추는 것으로 한다. 둘 다 플레이어가 다른 칸으로 넘어갈 때만 바뀐 인스턴스를 고친다.
- **적·투사체·장판은 지금 보이는 칸에 있을 때만 그린다**(`isVisible`). 전리품과 표식은 탐험한 칸이면 그린다.
- **위치 보간**: 행동체는 직전 틱과 이번 틱의 위치 사이를 `alpha` 로 그린다. 처음 본 행동체·순간이동·틱을 건너뛴 경우는 보간하지 않는다.
- **이벤트로만 알 수 있는 연출**(피해 숫자, 입자)은 `renderer.attach(bus, getState)` 가 받는다. 그 밖은 매 프레임 상태를 그대로 비춘다.
- **꾸밈용 난수**(입자 방향, 바닥 무늬)는 `Rng.fromSeed('render:cosmetic')` 을 쓴다. 게임 상태의 난수와 무관하다. `Math.random` 은 여기서도 쓰지 않는다.
- **품질**(`RENDER.quality`): 해상도 배율, 그림자(높음에서만), 입자·피해 숫자 수. `renderer.setQuality()` 로 실행 중에 바꾼다.
- Three.js 를 쓰는 파일은 Node 에서 불러올 수 없다(CDN importmap). 계산은 Three.js 를 모르는 파일(`pool.js`, `camera-rig.js`, `world/fog.js`)로 빼서 Node 테스트를 붙이고, 나머지는 `scripts/browser/` 로 확인한다. `renderer.info()` 가 GPU 자원·풀 현황을 돌려준다.

## 조작과 UI

- **입력은 포인터 이벤트**로 받는다(손가락마다 `pointerId` 가 달라 멀티터치를 구분한다). 판단은 `input/controls.js` 에 있고 DOM 을 모른다 — 터치 엣지케이스는 여기에 테스트를 붙인다.
- 규칙: 스틱은 포인터 하나가 잡고(떼거나 취소되기 전에는 다른 손가락이 스틱이 될 수 없다), 버튼은 포인터마다 하나, 공격은 누르는 동안 계속, 기술·회피는 누른 순간 한 번. 손가락이 화면 밖으로 나가도 포인터 캡처로 스틱이 유지된다.
- **전부 놓기**(`ui.resetInput()`): 탭이 가려질 때, 돌아올 때, 화면 크기·방향이 바뀔 때, 창이 초점을 잃을 때, 화면(메뉴)이 열릴 때.
- **기술·회피는 누른 프레임에만 `setInput` 에 넘긴다.** 매 프레임 "없음"을 넘기면 아직 틱이 처리하지 않은 입력을 지운다(화면 주사율이 틱보다 빠를 때).
- **화면(메뉴)이 열리면 게임을 멈춘다**(`PAUSED`). 닫으면 이어진다. 화면은 상태를 읽어 그리고, 바꾸는 일은 `logic/commands.js` 의 명령과 `main.js` 가 준 actions 로만 한다.
- 강화 후보가 제시돼 있으면(`state.run.choice`) 3택1 화면이 뜬다 — 이벤트가 아니라 상태를 보므로 세이브에서 이어한 경우에도 뜬다.
- 문구는 `ui/text.js` 가 데이터의 이름·수치로 만든다. 새 효과 종류를 데이터에 추가하면 여기에 설명을 추가한다.
- `?debug=1` 이면 디버그 표시가 나오고 `window.__fable` 로 게임·렌더러·ui 를 내놓는다(브라우저 검증용).

## 소리

- 녹음된 파일 없이 합성한다(`data/audio.js` 의 정의 → 오실레이터·잡음 + 음량 곡선). 잡음은 시드 난수로 한 번 만든다.
- **AudioContext 는 첫 터치·클릭·키 입력에서 만든다**(`audio.unlock()`). 그 전의 요청은 버린다. 만들 수 없는 환경에서는 모든 함수가 아무 일도 하지 않는다.
- 탭이 가려지면 `suspend()`, 돌아오면 `resume()`. 끝난 음원은 연결을 끊는다. 같은 효과음은 `SFX_MIN_GAP` 안에 다시 내지 않는다.
- 배경음은 짧은 간격으로 조금 앞까지만 예약한다(`MUSIC.lookahead`). 구역이 바뀌면 `FLOOR_ENTERED` 로 바뀐다.

## 세이브

- **세 가지를 따로 저장한다**(localStorage 키는 `data/save.js`): 런(`fable:run`, 상태 전체에서 `meta` 를 뺀 것), 메타(`fable:meta`), 설정(`fable:settings`). 런이 망가져도 메타는 남는다. 키마다 `:bak`(바로 앞의 저장본)과 `:bad`(읽지 못한 원본)가 딸린다.
- **런 세이브는 상태를 통째로 담는다**(시드·층·플레이어·적·투사체·맵·시야·인벤토리·진행도·난수 위치). 불러오면 저장한 틱 그대로 이어지고, 같은 입력을 주면 저장하지 않은 게임과 틱마다 같다.
- **형식**: `{"format":"fable-save","kind","version","savedAt","checksum","data"}`. 체크섬은 본문 JSON 글의 FNV-1a 32비트다(잘림·변조 감지용이지 보안이 아니다). 시각은 바깥에서 넣는다.
- **버전**: 런은 `STATE_VERSION`, 메타는 `META_VERSION`, 설정은 `SETTINGS_VERSION`. 구조를 바꾸면 버전을 올리고 `migrate.js` 에 `n → n+1` 단계를 **하나** 추가하고, `validate.js` 를 고치고, `scripts/make-old-saves.mjs` 로 직전 버전의 표본을 만들어 테스트를 추가한다. 마이그레이션은 검증보다 먼저 돌므로 손상된 값을 받아도 예외를 던지면 안 된다.
- **읽기 결과는 넷**(`readRun`): `exact`(그대로 이어함) / `salvage`(핵심만 건짐 — 그 층을 시드로 다시 만들어 층의 처음부터, `damaged:false` 면 옛 버전이라 층이 없을 뿐) / `finished`(끝난 런) / `none`(쓸 수 없음 → 새 런). 최신본과 백업을 모두 읽어 더 온전한 쪽을 쓴다.
- **검증기(`validate.js`)를 통과한 상태만 쓰고, 통과한 상태만 그대로 이어한다.** 기준은 "로직이 이 값을 읽다가 죽거나 NaN 을 퍼뜨리지 않는가"다. 범위는 넉넉하다(`SAVE.limits`) — 밸런스 수치를 조정해도 기존 세이브가 거부되면 안 된다. 그래서 수치를 고친 세이브(치트)는 걸러내지 않는다.
- **검증기의 오탐은 곧 저장 실패다.** 상태에 새 필드·새 값의 범위가 생기면 검증기를 함께 고친다. `tests/logic/save/validate.test.js` 와 `verify-save.mjs` 가 실제 교전 상태로 오탐을 찾는다.
- **세이브에서 온 이름은 `Object.hasOwn(표, 이름)` 으로 확인한다.** `표[이름]` 은 `"constructor"`·`"toString"` 을 통과시킨다.
- **상태 안의 객체는 한 곳에서만 가리킨다.** 같은 객체를 두 곳에 넣거나 `data/` 의 (동결된) 설정 객체를 그대로 넣지 않는다 — 저장했다 불러오면 갈라지거나 동결이 풀려, 불러온 게임만 다르게 동작할 수 있다. 사본을 넣는다(`copyItem`, `{ ...effect.status }`).
- **저장 실패는 게임을 멈추지 않는다.** localStorage 가 없거나 막혀 있으면 메모리 저장소로 대체하고(`store.persistent === false`), 용량이 모자라면 격리본 → 런 백업 순으로 지우고 다시 쓰고, 그래도 안 되면 결과로 알릴 뿐이다. 다른 프로그램의 키는 지우지 않는다(GitHub Pages 는 같은 계정의 프로젝트끼리 저장소를 함께 쓴다).
- **틱이 예외를 던지면**(`main.js`) `rescueGame` 으로 핵심만 건져 그 층을 다시 차리고, 안 되면 타이틀로 돌아간다.
- 메타는 자동 저장 때 런과 함께 저장되고, 영구 해금을 사면 곧바로 저장된다(`actions.metaChanged`).

## 코드 규약

- **상태는 JSON 으로 그대로 직렬화되는 평범한 객체다.** 클래스 인스턴스·함수·Map/Set·순환 참조·`undefined`·NaN 을 상태에 넣지 않고, 한 객체를 두 곳에서 가리키지 않는다. 구조를 바꾸면 `STATE_VERSION` 을 올리고 마이그레이션을 추가한다("세이브" 참고).
- **난수 쓰는 법**: 모듈은 `rngOf(state, '<스트림>')` 로 자기 스트림을 꺼내 쓴다. 스트림은 `RNG_STREAMS`(world, entities, combat, items)에 있다. 층·방처럼 "언제 뽑든 결과가 같아야 하는 것"은 `rngOf(state, 'world').fork(`floor:${n}`)` 처럼 fork 한다 — fork 는 부모를 소비하지 않고 라벨만으로 결정된다.
- `tests/logic/core/prng.test.js` 와 `tests/logic/world/generate.test.js` 의 고정값 테스트가 깨지면 기존 시드·세이브의 결과가 바뀐다는 뜻이다. 의도한 변경이 아니면 구현을 되돌린다. 의도한 변경이면 값을 갱신하고 `BUGS.md` 에 적는다.
- **순수 로직에서는 `Math.sin/cos/atan2/pow/hypot/exp/log` 와 `**` 를 쓰지 않는다.** 엔진마다 마지막 자리가 다를 수 있어 같은 시드가 기기마다 다른 결과를 낼 수 있다. 사칙연산과 `Math.sqrt/floor/ceil/round/abs/min/max/imul` 만 쓴다. 각도가 필요하면 [cos, sin] 값을 `data/` 에 미리 적어 둔다(`data/bosses.js` 참고). `tests/architecture.test.js` 가 검사한다.
- 상태를 훑을 때는 `allActors(state)` 처럼 id 순서가 정해진 목록을 쓴다(순서가 곧 결과다).
- 로직 함수는 잘못된 인자에 예외를 던진다(조용히 넘어가지 않는다).
- 주석·문서·테스트 이름은 한국어로 쓴다.
