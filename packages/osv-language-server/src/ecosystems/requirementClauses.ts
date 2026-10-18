/** One `<op> <version>` clause of a requirement; shared by the RubyGems and Hex requirement rewriters. */
export interface Clause {
  raw: string;
  op: string | undefined;
  gap: string;
  version: string;
}

export type ClauseParser = (raw: string) => Clause | undefined;
export type VersionCompare = (a: string, b: string) => number;

/** Whether the clause bounds versions from below: bare `X`, `=`/`==`, `>=` or `~>`. */
function boundsBelow(op: string | undefined): boolean {
  return op === undefined || op === "=" || op === "==" || op === ">=" || op === "~>";
}

/** Highest bound among the clauses that bound from below; undefined when none does. */
export function clausesLowerBound(reqs: string[], parse: ClauseParser, cmp: VersionCompare): string | undefined {
  let best: string | undefined;
  for (const raw of reqs) {
    const c = parse(raw);
    if (!c || !boundsBelow(c.op)) continue;
    if (best === undefined || cmp(c.version, best) > 0) best = c.version;
  }
  return best;
}

/** The leading numeric release segments of `v`, and the prerelease/build text after them (`-rc.1`, `.beta1`). */
function release(v: string): { segs: number[]; rest: string } {
  const head = /^\d+(?:\.\d+)*/.exec(v)?.[0] ?? "";
  return { segs: head === "" ? [] : head.split(".").map(Number), rest: v.slice(head.length) };
}

/** The first version `~> v` excludes: drop the last release segment, then bump the one before it. */
function pessimisticUpper(v: string): string {
  const { segs } = release(v);
  if (segs.length <= 1) return String((segs[0] ?? 0) + 1);
  const head = segs.slice(0, -1);
  head[head.length - 1] = (head[head.length - 1] ?? 0) + 1;
  return head.join(".");
}

/**
 * `target` cut (or zero-padded) to `n` release segments. When that drops a prerelease and lands above
 * the target, the prerelease is kept, or the target is used whole when its release has more segments.
 */
function truncate(target: string, n: number, cmp: VersionCompare): string {
  const { segs, rest } = release(target);
  const kept = segs.slice(0, n);
  while (kept.length < n) kept.push(0);
  const cut = kept.join(".");
  if (cmp(cut, target) <= 0) return cut;
  return segs.length <= n ? cut + rest : target;
}

const fmt = (c: Clause, version: string): string =>
  c.op === undefined ? version : `${c.op}${c.gap || " "}${version}`;

/**
 * Rewrites the AND-ed clauses of one requirement so they admit `target` and nothing below it.
 * `~>` keeps its precision (the upper bound moves, `widened`) and gains `>= target` when truncation
 * would admit lower versions; an unparseable clause is kept as written.
 */
export function rewriteClauses(reqs: string[], target: string, parse: ClauseParser, cmp: VersionCompare): { reqs: string[]; widened: boolean } {
  const out: string[] = [];
  let widened = false;
  for (const raw of reqs) {
    const c = parse(raw);
    if (!c) {
      out.push(raw);
      continue;
    }
    switch (c.op) {
      case undefined:
      case "=":
      case "==":
      case ">=":
        out.push(fmt(c, target));
        break;
      case "~>": {
        const n = Math.max(release(c.version).segs.length, 1);
        if (cmp(target, pessimisticUpper(c.version)) >= 0) widened = true;
        const truncated = truncate(target, n, cmp);
        out.push(fmt(c, truncated));
        if (cmp(truncated, target) !== 0) out.push(`>= ${target}`);
        break;
      }
      case "<":
        if (cmp(target, c.version) < 0) out.push(raw);
        else widened = true;
        break;
      case "<=":
        if (cmp(target, c.version) <= 0) out.push(raw);
        else widened = true;
        break;
      case ">":
        // A strict lower bound would still admit versions below the target.
        if (cmp(target, c.version) <= 0) widened = true;
        out.push(`>= ${target}`);
        break;
      case "!=":
        if (cmp(target, c.version) !== 0) out.push(raw);
        else widened = true;
        break;
    }
  }
  if (!out.some((raw) => boundsBelow(parse(raw)?.op))) out.push(`>= ${target}`);
  // Merge duplicate `>=` clauses into the highest, kept at the first one's position.
  const merged: string[] = [];
  let ge: { index: number; version: string } | undefined;
  for (const raw of out) {
    const c = parse(raw);
    if (c?.op !== ">=") {
      merged.push(raw);
    } else if (!ge) {
      ge = { index: merged.length, version: c.version };
      merged.push(raw);
    } else if (cmp(c.version, ge.version) > 0) {
      merged[ge.index] = raw;
      ge.version = c.version;
    }
  }
  return { reqs: merged, widened };
}
