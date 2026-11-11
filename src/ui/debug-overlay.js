// 개발용 상태 표시(시드·페이즈·틱·현재 층). 로직 상태는 읽기만 한다.
// TODO(ui 단계): 정식 HUD 가 생기면 ?debug=1 일 때만 보이도록 바꾼다.

/**
 * @param {{ element: HTMLElement }} options
 */
export function createDebugOverlay({ element }) {
  let last = '';
  return {
    /**
     * @param {object} state
     * @param {string} [note] 덧붙일 한 줄(저장 상태 등)
     */
    update(state, note = '') {
      const world = state.world;
      const where = world ? ` · ${world.floor}F ${world.zoneId}/${world.algorithm} ${world.width}x${world.height}` : '';
      const text = `seed ${state.seed} · ${state.phase} · tick ${state.tick}${where}${note ? ` · ${note}` : ''}`;
      if (text === last) return;
      last = text;
      element.textContent = text;
    },
  };
}
