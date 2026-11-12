// 브라우저의 기본 제스처 막기: 두 번 두드려 확대, 핀치 확대, 길게 눌러 메뉴, 당겨서 새로 고침, 스크롤.
//
// 아이폰 사파리는 viewport 의 user-scalable=no 를 무시한다. 그래서 CSS(touch-action: none) 에 더해 여기서 막는다:
//   - gesturestart·gesturechange·gestureend(사파리의 핀치), dblclick: 기본 동작을 막는다.
//   - 짧은 간격(INPUT.doubleTapMs) 안에 이어진 touchend: 기본 동작(두 번 두드려 확대)을 막는다.
//     막으면 그 터치의 click 도 나가지 않으므로, 버튼 위였다면 click() 을 직접 불러 눌림을 살린다.
//   - 두 손가락 이상의 touchmove(핀치)와 화면 밖으로의 스크롤: 막는다.
// 게임의 조작은 포인터 이벤트로 받으므로 이것들을 막아도 조작에는 영향이 없다.

import { INPUT } from '../../../data/ui.js';

/**
 * @param {Document} doc
 * @param {() => number} now 시각(ms)
 * @returns {{ stats:() => object, dispose:() => void }}
 */
export function guardGestures(doc, now = () => performance.now()) {
  let lastEnd = -Infinity;
  const counts = { gesture: 0, dblclick: 0, doubleTap: 0, pinch: 0, rescued: 0 };
  const prevent = (key) => (e) => {
    if (e.cancelable) e.preventDefault();
    counts[key]++;
  };
  const onGesture = prevent('gesture');
  const onDblClick = prevent('dblclick');
  const onTouchEnd = (e) => {
    const t = now();
    if (t - lastEnd <= INPUT.doubleTapMs) {
      if (e.cancelable) e.preventDefault();
      counts.doubleTap++;
      // 버튼 입력은 살린다: 막은 터치가 버튼 위였으면 click 을 직접 보낸다.
      const target = e.target && e.target.closest ? e.target.closest('button, [data-tap]') : null;
      if (target && !target.disabled) {
        counts.rescued++;
        target.click();
      }
    }
    lastEnd = t;
  };
  const onTouchMove = (e) => {
    // 스크롤이 필요한 목록(메뉴) 안에서 한 손가락으로 끄는 것만 허용한다.
    if (e.touches && e.touches.length > 1) {
      if (e.cancelable) e.preventDefault();
      counts.pinch++;
      return;
    }
    const scroller = e.target && e.target.closest ? e.target.closest('.scroll') : null;
    if (!scroller && e.cancelable) e.preventDefault();
  };
  const onContext = (e) => {
    if (e.target && e.target.closest && e.target.closest('input, textarea')) return;
    e.preventDefault();
  };
  const opts = { passive: false, capture: true };
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) doc.addEventListener(type, onGesture, opts);
  doc.addEventListener('dblclick', onDblClick, opts);
  doc.addEventListener('touchend', onTouchEnd, opts);
  doc.addEventListener('touchmove', onTouchMove, opts);
  doc.addEventListener('contextmenu', onContext, opts);
  return {
    stats: () => ({ ...counts }),
    dispose() {
      for (const type of ['gesturestart', 'gesturechange', 'gestureend']) doc.removeEventListener(type, onGesture, opts);
      doc.removeEventListener('dblclick', onDblClick, opts);
      doc.removeEventListener('touchend', onTouchEnd, opts);
      doc.removeEventListener('touchmove', onTouchMove, opts);
      doc.removeEventListener('contextmenu', onContext, opts);
    },
  };
}
