import type { Comparator } from "./types.js";

interface Parsed {
  /** Always four numeric parts (missing = 0). */
  parts: [number, number, number, number];
  /** Lowercased prerelease identifiers; empty for a release. */
  pre: string[];
}

const VERSION = /^(\d+(?:\.\d+){0,3})(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function parse(v: string): Parsed | undefined {
  const m = VERSION.exec(v.trim());
  if (!m) return undefined;
  const nums = m[1]!.split(".").map(Number);
  while (nums.length < 4) nums.push(0);
  return { parts: nums as Parsed["parts"], pre: m[2] ? m[2].toLowerCase().split(".") : [] };
}

const isNum = (s: string) => /^\d+$/.test(s);

function comparePre(a: string[], b: string[]): number {
  // A release outranks any prerelease of the same numeric version.
  if (!a.length || !b.length) return a.length === b.length ? 0 : a.length ? -1 : 1;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x === y) continue;
    if (isNum(x) && isNum(y)) return Number(x) < Number(y) ? -1 : 1;
    if (isNum(x)) return -1;
    if (isNum(y)) return 1;
    return x < y ? -1 : 1;
  }
  return Math.sign(a.length - b.length);
}

export const nugetComparator: Comparator = {
  isValid: (v) => parse(v) !== undefined,
  compare(a, b) {
    const x = parse(a);
    const y = parse(b);
    if (!x || !y) return a < b ? -1 : a > b ? 1 : 0;
    for (let i = 0; i < 4; i++) {
      if (x.parts[i] !== y.parts[i]) return x.parts[i]! < y.parts[i]! ? -1 : 1;
    }
    return comparePre(x.pre, y.pre);
  },
  normalize: (v) => v.trim().replace(/\+.*$/, ""),
  major: (v) => parse(v)?.parts[0] ?? Number.NaN,
};
