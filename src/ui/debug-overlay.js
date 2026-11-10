// 개발용 상태 표시(시드·페이즈·틱). 로직 상태는 읽기만 한다.
// TODO(ui 단계): 정식 HUD 가 생기면 ?debug=1 일 때만 보이도록 바꾼다.

/**
 * @param {{ element: HTMLElement }} options
 */
export function createDebugOverlay({ element }) {
  let last = '';
  return {
    update(state) {
      const text = `seed ${state.seed} · ${state.phase} · tick ${state.tick}`;
      if (text === last) return;
      last = text;
      element.textContent = text;
    },
  };
}
