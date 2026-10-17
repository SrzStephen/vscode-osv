import semver from "semver";
import type { Comparator } from "./types.js";

const opts = { loose: true } as const;

export const semverComparator: Comparator = {
  isValid: (v) => semver.valid(v, opts) !== null,
  compare: (a, b) => semver.compare(a, b, opts),
  normalize: (v) => v.trim().replace(/^[v=]+/, ""),
  major: (v) => semver.major(v, opts),
};
