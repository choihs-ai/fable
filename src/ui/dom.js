// DOM 을 만드는 작은 도우미.

/**
 * 요소를 만든다. h('button', { class: 'primary', onclick: fn }, '확인')
 * 속성 이름이 on 으로 시작하면 이벤트 리스너, class·text 는 그대로, 나머지는 속성으로 넣는다. 값이 null·false 면 건너뛴다.
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const key of Object.keys(attrs)) {
    const value = attrs[key];
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** 값이 바뀌었을 때만 글자를 고친다(프레임마다 불러도 된다). */
export function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}
