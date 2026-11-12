# fable

모바일 웹 3D 방 단위 액션 로그라이트. 방에 들어서면 문이 잠기고, 웨이브를 모두 잡으면 문이 열리며 보상이 나온다.
대시, 탈(캐릭터)과 무기를 둘씩 들고 바꿔 쓰기(바꾸는 순간 교체 기술), 축복 3택1, 죽으면 거점에서 영구 강화. 지금은 맛보기 판(1구역 한 층, 방 8~12개 + 중간보스)만 있다.

Three.js, 빌드 도구 없음 — 저장소 내용이 그대로 GitHub Pages 에 배포된다(`pivot` 브랜치 → `.github/workflows/pages.yml`).

```bash
node scripts/run-tests.mjs    # 테스트 (npm 설치 불필요, Node 22 에서 확인)
node scripts/serve.mjs        # http://127.0.0.1:8000
node scripts/bot-run.mjs      # 봇으로 맛보기 판 200판
```

조작: 왼쪽 조이스틱으로 이동, 오른쪽 버튼으로 공격(누른 채 끌면 그 방향으로 조준)·대시·스킬·교체(탈과 무기)·상호작용.
키보드: WASD/방향키 이동, J·스페이스 공격, K·Shift 대시, L·Q 스킬, R·Tab 교체, E·F 상호작용.
`?seed=문자열` 을 붙이면 같은 판을 재현한다. `?debug=1` 은 디버그 표시.

구조와 작업 규칙은 [CLAUDE.md](./CLAUDE.md), 미뤄 둔 일은 [TODO.md](./TODO.md), 버그·한계 기록은 [BUGS.md](./BUGS.md).
