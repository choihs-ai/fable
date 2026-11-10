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
```

ES 모듈은 `file://` 로 열 수 없으므로 브라우저 확인은 항상 로컬 서버를 거친다.

## 파일 구조

`(예정)` 은 아직 없는 디렉터리다. 해당 단계에서 만든다.

```
index.html                 진입 HTML. importmap(Three.js 버전 고정) + 캔버스
package.json               "type": "module" 선언과 스크립트 별칭만. 의존성 없음
.nojekyll                  GitHub Pages 가 Jekyll 처리 없이 그대로 배포하도록
CLAUDE.md  BUGS.md  TODO.md  README.md
data/                      설정·밸런스 수치 (순수 값, import 없음)
  config.js                루프 주파수, 렌더 설정
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
    world/      (예정)     맵 생성
    items/      (예정)     아이템 정의·획득·사용
    entities/   (예정)     플레이어·적, 이동, AI
    combat/     (예정)     피해 계산, 상태이상
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
tests/                     src 와 같은 경로 구조. *.test.js
  architecture.test.js     아래 의존 규칙을 자동 검사
  helpers/architecture.js  규칙 정의(LAYERS, LOGIC_RANK)와 검사기
  logic/core/*.test.js
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

이 규칙은 `tests/architecture.test.js` 가 검사한다. 규칙을 바꿀 때는 이 문서와 `tests/helpers/architecture.js` 를 함께 고친다. 새 최상위 디렉터리나 로직 모듈을 추가하면 검사기에 등록해야 테스트가 통과한다.

## 데이터 흐름

- **로직 → 바깥**: 로직이 `EventBus` 로 "일어난 일"을 알리고, render/ui/audio 가 구독한다. 이벤트 이름은 `logic/core/events.js` 상수를 쓴다.
- **바깥 → 로직**: ui 는 상태를 직접 고치지 않는다. 입력은 커맨드로 만들어 로직에 넘긴다(입력 단계에서 구현, `TODO.md`).
- **프레임**: `main.js` 가 `requestAnimationFrame` 마다 경과 시간을 `FixedStepLoop.advance()` 에 넘김 → 고정 dt 로 `tick()` 0회 이상 → `render(state, alpha)`.

## 코드 규약

- **상태는 JSON 으로 그대로 직렬화되는 평범한 객체다.** 클래스 인스턴스·함수·Map/Set·순환 참조를 상태에 넣지 않는다. 구조를 바꾸면 `STATE_VERSION` 을 올린다.
- **난수 쓰는 법**: 모듈은 `rngOf(state, '<스트림>')` 로 자기 스트림을 꺼내 쓴다. 스트림은 `RNG_STREAMS`(world, entities, combat, items)에 있다. 층·방처럼 "언제 뽑든 결과가 같아야 하는 것"은 `rngOf(state, 'world').fork(`floor:${n}`)` 처럼 fork 한다 — fork 는 부모를 소비하지 않고 라벨만으로 결정된다.
- `tests/logic/core/prng.test.js` 의 고정값 테스트가 깨지면 기존 시드·세이브의 결과가 바뀐다는 뜻이다. 의도한 변경이 아니면 구현을 되돌린다.
- 로직 함수는 잘못된 인자에 예외를 던진다(조용히 넘어가지 않는다).
- 주석·문서·테스트 이름은 한국어로 쓴다.
