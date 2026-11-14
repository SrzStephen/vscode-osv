/**
 * Runs `fn` a few times and reports the fastest run along with the last result. The performance guards only
 * exist to catch accidentally quadratic parsing, so one slow run on a busy CI machine must not fail them.
 */
export function timed<T>(fn: () => T, runs = 3): { result: T; best: number } {
  let best = Infinity;
  let result!: T;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    result = fn();
    best = Math.min(best, performance.now() - t0);
  }
  return { result, best };
}
