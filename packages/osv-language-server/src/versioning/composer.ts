import type { Comparator } from "./types.js";

const VERSION = /^v?(\d+(?:\.\d+){0,3})(?:[._-]?(dev|alpha|a|beta|b|rc|patch|pl|p)[._-]?(\d*))?(?:\+\S*)?$/i;

// dev < alpha < beta < RC < stable < patch
const STABILITY: Record<string, number> = { dev: 0, alpha: 1, a: 1, beta: 2, b: 2, rc: 3, patch: 5, pl: 5, p: 5 };
const STABLE = 4;

interface Parsed {
  nums: number[];
  stability: number;
  suffixNum: number;
}

function parse(v: string): Parsed | undefined {
  const m = VERSION.exec(v.trim());
  if (!m) return undefined;
  const nums = (m[1] ?? "").split(".").map(Number);
  while (nums.length < 4) nums.push(0);
  const label = m[2]?.toLowerCase();
  return {
    nums,
    stability: label === undefined ? STABLE : (STABILITY[label] ?? STABLE),
    suffixNum: m[3] ? Number(m[3]) : 0,
  };
}

export const composerComparator: Comparator = {
  isValid: (v) => parse(v) !== undefined,
  compare: (a, b) => {
    const x = parse(a);
    const y = parse(b);
    if (!x || !y) return a < b ? -1 : a > b ? 1 : 0;
    for (let i = 0; i < 4; i++) {
      const c = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
      if (c !== 0) return c;
    }
    return x.stability - y.stability || x.suffixNum - y.suffixNum;
  },
  normalize: (v) => {
    const t = v.trim();
    const m = VERSION.exec(t);
    if (!m) return t;
    const nums = (m[1] ?? "").split(".");
    while (nums.length < 4) nums.push("0");
    const rest = t.slice(t.indexOf(m[1] ?? "") + (m[1] ?? "").length);
    return nums.join(".") + rest;
  },
  major: (v) => parse(v)?.nums[0] ?? 0,
};
