// 세이브 검증용 작은 도구. 검사기는 (보고서, 값, 경로) 를 받아 문제가 있으면 보고서에 적는다.
// 세이브에서 읽은 값은 무엇이든 될 수 있으므로, 여기 함수들은 어떤 값을 받아도 예외를 던지지 않는다.

/** 문제 목록. 너무 길어지지 않게 limit 개까지만 적고 개수는 계속 센다. */
export function createReport(limit = 40) {
  return {
    problems: [],
    count: 0,
    fail(path, message) {
      this.count++;
      if (this.problems.length < limit) this.problems.push(`${path}: ${message}`);
    },
  };
}

export function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isInt(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

/** 유한한 수이고 범위 안인가(NaN·Infinity 는 비교에서 걸러진다). */
export function isNum(value, min, max) {
  return typeof value === 'number' && value >= min && value <= max;
}

/** 표의 자기 키인가. `표[id]` 로 확인하면 "constructor" 같은 물려받은 이름이 통과하므로 반드시 이 함수를 쓴다. */
export function isKeyOf(table, key) {
  return typeof key === 'string' && Object.hasOwn(table, key);
}

/** 문제 문구에 넣을 짧은 표현. */
export function show(value) {
  if (typeof value === 'string') return value.length > 24 ? `"${value.slice(0, 24)}…"` : `"${value}"`;
  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) return String(value);
  return Array.isArray(value) ? `배열(${value.length})` : typeof value;
}

/** 검사기를 돌려 그 사이에 문제가 새로 생기지 않았으면 true. */
export function passes(report, check, value, path) {
  const before = report.count;
  check(report, value, path);
  return report.count === before;
}

export const int = (min, max) => (r, v, p) => {
  if (!isInt(v, min, max)) r.fail(p, `${min}~${max} 범위의 정수가 아님 (${show(v)})`);
};

export const num = (min, max) => (r, v, p) => {
  if (!isNum(v, min, max)) r.fail(p, `${min}~${max} 범위의 수가 아님 (${show(v)})`);
};

export const bool = (r, v, p) => {
  if (typeof v !== 'boolean') r.fail(p, `참/거짓이 아님 (${show(v)})`);
};

export const text = (maxLength, minLength = 0) => (r, v, p) => {
  if (typeof v !== 'string' || v.length < minLength || v.length > maxLength) r.fail(p, `길이 ${minLength}~${maxLength} 의 문자열이 아님 (${show(v)})`);
};

/** 주어진 값들 가운데 하나. */
export const among = (values) => (r, v, p) => {
  if (!values.includes(v)) r.fail(p, `허용되지 않는 값 (${show(v)})`);
};

/** 표(객체)의 키 가운데 하나. */
export const keyOf = (table) => (r, v, p) => {
  if (!isKeyOf(table, v)) r.fail(p, `알 수 없는 이름 (${show(v)})`);
};

export const nullable = (check) => (r, v, p) => {
  if (v !== null) check(r, v, p);
};

export const list = (check, maxLength, minLength = 0) => (r, v, p) => {
  if (!Array.isArray(v)) return r.fail(p, `배열이 아님 (${show(v)})`);
  if (v.length < minLength || v.length > maxLength) return r.fail(p, `길이가 ${minLength}~${maxLength} 를 벗어남 (${v.length})`);
  for (let i = 0; i < v.length; i++) check(r, v[i], `${p}[${i}]`);
  return undefined;
};

/**
 * 정해진 필드를 가진 객체. fields 는 반드시 있어야 하고, optional 은 있어도 되고 없어도 된다.
 * 그 밖의 필드가 있으면 문제로 본다.
 */
export const shape = (fields, optional = {}) => (r, v, p) => {
  if (!isObject(v)) return r.fail(p, `객체가 아님 (${show(v)})`);
  for (const key of Object.keys(fields)) {
    if (!Object.hasOwn(v, key)) r.fail(`${p}.${key}`, '없음');
    else fields[key](r, v[key], `${p}.${key}`);
  }
  for (const key of Object.keys(v)) {
    if (Object.hasOwn(fields, key)) continue;
    if (Object.hasOwn(optional, key)) optional[key](r, v[key], `${p}.${key}`);
    else r.fail(`${p}.${key}`, '알 수 없는 필드');
  }
  return undefined;
};

/** 키가 정해져 있지 않은 객체(이름 → 값). keyOk(key) 가 false 인 키는 문제로 본다. */
export const record = (keyOk, check, maxKeys) => (r, v, p) => {
  if (!isObject(v)) return r.fail(p, `객체가 아님 (${show(v)})`);
  const keys = Object.keys(v);
  if (keys.length > maxKeys) return r.fail(p, `항목이 너무 많음 (${keys.length})`);
  for (const key of keys) {
    if (!keyOk(key)) r.fail(`${p}.${key}`, '알 수 없는 이름');
    else check(r, v[key], `${p}.${key}`);
  }
  return undefined;
};
