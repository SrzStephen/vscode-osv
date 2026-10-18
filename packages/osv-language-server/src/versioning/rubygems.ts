import type { Comparator } from "./types.js";

const VERSION = /^[0-9]+(\.[0-9a-zA-Z]+)*(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

type Segment = number | string;

function parse(v: string): Segment[] {
  const parts = v.trim().replace(/-/g, ".pre.").match(/[0-9]+|[a-zA-Z]+/g) ?? [];
  return parts.map((p) => (/^[0-9]/.test(p) ? Number(p) : p));
}

function stripTrailingZeros(segs: Segment[]): Segment[] {
  let end = segs.length;
  while (end > 0 && segs[end - 1] === 0) end--;
  return segs.slice(0, end);
}

// Gem::Version#canonical_segments: zeros are dropped from the end of the numeric
// prefix and again from the end of the prerelease tail.
function canonical(v: string): Segment[] {
  const segs = parse(v);
  const firstString = segs.findIndex((s) => typeof s === "string");
  if (firstString === -1) return stripTrailingZeros(segs);
  return [...stripTrailingZeros(segs.slice(0, firstString)), ...stripTrailingZeros(segs.slice(firstString))];
}

function compareSegments(a: Segment, b: Segment): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  return typeof a === "string" ? -1 : 1;
}

export const rubygemsComparator: Comparator = {
  isValid: (v) => VERSION.test(v.trim()),
  compare: (a, b) => {
    const x = canonical(a);
    const y = canonical(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const c = compareSegments(x[i] ?? 0, y[i] ?? 0);
      if (c !== 0) return c;
    }
    return 0;
  },
  normalize: (v) => v.trim(),
  major: (v) => {
    const first = parse(v)[0];
    return typeof first === "number" ? first : 0;
  },
};
