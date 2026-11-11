// 격자 A*. 8방향으로 움직이되 벽 모서리를 대각선으로 가로지르지 않는다.
// 비용은 정수(직선 10, 대각선 14)라서 플랫폼이 달라도 같은 경로가 나온다.

/** 힙: f 값과 칸 번호를 한 수로 묶어(f × 65536 + 칸) 비교하므로 f 가 같으면 칸 번호가 작은 쪽이 먼저 나온다. */
function heapPush(heap, value) {
  let i = heap.length;
  heap.push(value);
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (heap[parent] <= value) break;
    heap[i] = heap[parent];
    i = parent;
  }
  heap[i] = value;
}

function heapPop(heap) {
  const top = heap[0];
  const last = heap.pop();
  const n = heap.length;
  if (n > 0) {
    let i = 0;
    for (;;) {
      let child = i * 2 + 1;
      if (child >= n) break;
      if (child + 1 < n && heap[child + 1] < heap[child]) child++;
      if (heap[child] >= last) break;
      heap[i] = heap[child];
      i = child;
    }
    heap[i] = last;
  }
  return top;
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

/**
 * @param {object} nav navOf(map)
 * @param {number} sx 출발 칸
 * @param {number} sy
 * @param {number} gx 도착 칸
 * @param {number} gy
 * @param {number} clearance 1 = 반지름 0.5 이하, 2 = 그보다 큰 몸(둘레 8칸까지 바닥인 칸만 지난다). 출발·도착 칸은 예외로 허용
 * @param {number} maxNodes 펼칠 노드 수 상한
 * @returns {number[]|null} 출발 칸을 뺀 칸 번호 목록(도착 칸 포함). 길이 없으면 null
 */
export function findPath(nav, sx, sy, gx, gy, clearance, maxNodes) {
  const { w, h, clear, g, from, seen, closed } = nav;
  if (sx < 0 || sy < 0 || sx >= w || sy >= h || gx < 0 || gy < 0 || gx >= w || gy >= h) return null;
  const start = sy * w + sx;
  const goal = gy * w + gx;
  if (clear[start] === 0 || clear[goal] === 0) return null;
  if (start === goal) return [];
  if (w * h > 65536) throw new RangeError('findPath: 맵이 너무 큽니다(칸 수 65536 초과)');

  const stamp = ++nav.stamp;
  const heap = [];
  g[start] = 0;
  from[start] = -1;
  seen[start] = stamp;
  heapPush(heap, start);
  let expanded = 0;

  while (heap.length > 0) {
    const cur = heapPop(heap) % 65536;
    if (closed[cur] === stamp) continue;
    closed[cur] = stamp;
    if (cur === goal) {
      const path = [];
      for (let n = goal; n !== start; n = from[n]) path.push(n);
      path.reverse();
      return path;
    }
    if (++expanded > maxNodes) return null;
    const cx = cur % w;
    const cy = (cur - cx) / w;
    for (let k = 0; k < 8; k++) {
      const nx = cx + DX[k];
      const ny = cy + DY[k];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      if (closed[n] === stamp) continue;
      if (clear[n] < clearance && n !== goal) continue;
      if (clear[n] === 0) continue;
      if (k >= 4) {
        // 대각선: 양옆 칸이 모두 지나갈 수 있어야 한다.
        const a = cy * w + nx;
        const b = ny * w + cx;
        if (clear[a] < clearance || clear[b] < clearance) continue;
      }
      const ng = g[cur] + (k >= 4 ? 14 : 10);
      if (seen[n] === stamp && ng >= g[n]) continue;
      g[n] = ng;
      from[n] = cur;
      seen[n] = stamp;
      const ax = Math.abs(nx - gx);
      const ay = Math.abs(ny - gy);
      const heuristic = 10 * (ax + ay) - 6 * Math.min(ax, ay);
      heapPush(heap, (ng + heuristic) * 65536 + n);
    }
  }
  return null;
}
