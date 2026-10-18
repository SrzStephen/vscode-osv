import { semverComparator } from "../../versioning/semver.js";
import { clausesLowerBound, rewriteClauses, type Clause } from "../requirementClauses.js";
import type { RewriteResult } from "../types.js";

const CLAUSE = /^\s*(==|!=|>=|<=|>|<|~>)?(\s*)([0-9][0-9A-Za-z.-]*)\s*$/;

function parseClause(raw: string): Clause | undefined {
  const m = CLAUSE.exec(raw);
  if (!m) return undefined;
  return { raw, op: m[1], gap: m[2] ?? "", version: m[3] ?? "" };
}

/** Elixir writes `1.3` for `1.3.0`; semver needs all three parts. */
function pad(v: string): string {
  if (/^\d+$/.test(v)) return `${v}.0.0`;
  if (/^\d+\.\d+$/.test(v)) return `${v}.0`;
  return v;
}

const cmp = (a: string, b: string): number => semverComparator.compare(pad(a), pad(b));

/** `or` separates groups, `and` separates the clauses of one group. */
const groups = (req: string): string[][] => req.split(/\s+or\s+/).map((g) => g.split(/\s+and\s+/));

/**
 * Lowest version an Elixir requirement admits: the lowest of its `or` groups, each bounded by its
 * highest lower-bounding clause. Undefined when any group has none (`<`, `!=` and `>` alone).
 */
export function hexLowerBound(req: string): string | undefined {
  let lowest: string | undefined;
  for (const clauses of groups(req)) {
    const bound = clausesLowerBound(clauses, parseClause, cmp);
    if (bound === undefined) return undefined;
    if (lowest === undefined || cmp(bound, lowest) < 0) lowest = bound;
  }
  return lowest === undefined ? undefined : pad(lowest);
}

/**
 * Rewrites a requirement so every `or` group admits `target` and nothing below it. `~>` keeps its
 * precision, so a target more precise than the constraint adds `and >= target`.
 */
export function rewriteHexRequirement(raw: string, target: string): RewriteResult {
  const out: string[] = [];
  let widened = false;
  for (const clauses of groups(raw.trim())) {
    const r = rewriteClauses(clauses, target, parseClause, cmp);
    if (r.widened) widened = true;
    const group = r.reqs.join(" and ");
    if (!out.includes(group)) out.push(group);
  }
  return { spec: out.join(" or "), widened };
}
