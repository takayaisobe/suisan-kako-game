// 再現性のあるシード付き乱数（mulberry32）。
// rngState を state に持たせ、純粋関数として扱うため、
// 「次の状態」と「値」をペアで返す形にする。

export function nextRandom(state: number): { state: number; value: number } {
  let t = (state + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { state: t >>> 0, value };
}

/** [min, max] の整数を返す。 */
export function nextInt(
  state: number,
  min: number,
  max: number,
): { state: number; value: number } {
  const r = nextRandom(state);
  return { state: r.state, value: min + Math.floor(r.value * (max - min + 1)) };
}

/** 配列から1つ選ぶ。 */
export function pick<T>(
  state: number,
  arr: readonly T[],
): { state: number; value: T } {
  const r = nextInt(state, 0, arr.length - 1);
  return { state: r.state, value: arr[r.value] };
}
