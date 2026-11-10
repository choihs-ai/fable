# TODO — 현재 단계 범위 밖이라 미뤄 둔 것

단계 범위를 넘는 기능은 만들지 않고 여기에 적는다. 끝낸 항목은 지운다(버그·한계 기록은 `BUGS.md`).

## 결정 대기 (다음 단계 시작 전에 정해야 함)

- [ ] 전투 방식: 실시간 액션 / 턴제(그리드) — 엔티티·전투·입력 구조 전체가 갈린다
- [ ] 시점: 탑다운·쿼터뷰 / 3인칭 / 1인칭
- [ ] 화면 방향: 세로 고정 / 가로 고정 / 둘 다
- [ ] 조작: 가상 조이스틱+버튼 / 탭 이동 / 스와이프
- [ ] 맵 형태: 그리드 타일(방+복도) / 방 단위 연결 / 자유 형태

## world

- [ ] 맵 생성 (`src/logic/world`), 층별 시드는 `rngOf(state, 'world').fork(`floor:${n}`)`
- [ ] 맵 렌더 (`src/render/world`), `renderer.js` 의 확인용 격자 제거
- [ ] 맵 크기·방 개수 등 수치는 `data/` 에

## entities / combat / items

- [ ] 엔티티 형태 정의, `state.entities.byId` · `state.playerId` 채우기
- [ ] `logic/game.js` 의 `tick()` 에 시스템 실행 순서 넣기
- [ ] 가중치 뽑기(`Rng` 에 추가)는 전리품 테이블이 생길 때

## ui / 입력

- [ ] 입력 → 커맨드 큐 → 틱 시작 시 로직이 소비 (ui 는 상태를 직접 고치지 않는다)
- [ ] 타이틀 화면. 지금은 `main.js` 가 시작하자마자 PLAYING 으로 넘긴다
- [ ] 디버그 표시는 `?debug=1` 일 때만
- [ ] 일시정지: 탭이 가려질 때 PAUSED 로 전환

## save

- [ ] `logic/save`: 직렬화·검증·`STATE_VERSION` 마이그레이션
- [ ] `src/save`: 저장소 어댑터

## audio

- [ ] WebAudio 초기화(모바일은 첫 터치 이후에만 재생 가능)

## 플랫폼

- [ ] Three.js 로드 실패 시 안내 문구 (BUGS.md L-003)
- [ ] 오프라인 지원·홈 화면 추가(PWA) 여부 결정
- [ ] WebGL 컨텍스트 손실 복구
- [ ] 렌더 보간: `render(state, alpha)` 의 alpha 를 실제 위치 보간에 사용
