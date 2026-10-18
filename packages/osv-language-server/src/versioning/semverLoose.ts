import semver from "semver";
import type { Comparator } from "./types.js";

const opts = { loose: true } as const;

/** Coerces partial or prefixed versions ("41", "v4.1") to full semver; null when nothing numeric is found. */
const coerce = (v: string): semver.SemVer | null => semver.coerce(v, opts);

function coerced(v: string): semver.SemVer {
  const c = coerce(v);
  if (!c) throw new TypeError(`Invalid version: ${v}`);
  return c;
}

/** Semver over coerced versions, for ecosystems whose tags are often partial (GitHub Actions "v4", Pub). */
export const semverLooseComparator: Comparator = {
  isValid: (v) => coerce(v) !== null,
  compare: (a, b) => semver.compare(coerced(a), coerced(b), opts),
  normalize: (v) => v.trim().replace(/^[v=]+/, ""),
  major: (v) => coerced(v).major,
};
