import { rubygemsComparator } from "../../versioning/rubygems.js";

const CLAUSE = /^\s*(=|!=|>=|<=|>|<|~>)?(\s*)([0-9][0-9A-Za-z.-]*)\s*$/;

interface Clause {
  raw: string;
  op: string | undefined;
  gap: string;
  version: string;
}

function parseClause(raw: string): Clause | undefined {
  const m = CLAUSE.exec(raw);
  if (!m) return undefined;
  return { raw, op: m[1], gap: m[2] ?? "", version: m[3] ?? "" };
}

const cmp = (a: string, b: string): number => rubygemsComparator.compare(a, b);

/** Highest of `= X`, `>= X` and `~> X` (bare `X` means `= X`); undefined when none bound from below. */
export function gemLowerBound(reqs: string[]): string | undefined {
  let best: string | undefined;
  for (const raw of reqs) {
    const c = parseClause(raw);
    if (!c) continue;
    if (c.op !== undefined && c.op !== "=" && c.op !== ">=" && c.op !== "~>") continue;
    if (best === undefined || cmp(c.version, best) > 0) best = c.version;
  }
  return best;
}

function numericSegments(v: string): number[] {
  return (v.match(/[0-9]+/g) ?? []).map(Number);
}

/** The first version `~> v` excludes: drop the last segment, then bump the one before it. */
function pessimisticUpper(v: string): string {
  const segs = numericSegments(v);
  if (segs.length <= 1) return String((segs[0] ?? 0) + 1);
  const head = segs.slice(0, -1);
  head[head.length - 1] = (head[head.length - 1] ?? 0) + 1;
  return head.join(".");
}

function truncate(target: string, n: number): string {
  const segs = numericSegments(target).slice(0, n);
  while (segs.length < n) segs.push(0);
  return segs.join(".");
}

const fmt = (c: Clause, version: string): string =>
  c.op === undefined ? version : `${c.op}${c.gap || " "}${version}`;

export function rewriteGemRequirements(reqs: string[], target: string): { reqs: string[]; widened: boolean } {
  const out: string[] = [];
  let widened = false;
  for (const raw of reqs) {
    const c = parseClause(raw);
    if (!c) {
      out.push(raw);
      continue;
    }
    switch (c.op) {
      case undefined:
      case "=":
      case ">=":
        out.push(fmt(c, target));
        break;
      case "~>": {
        const n = Math.max(numericSegments(c.version).length, 1);
        if (cmp(target, pessimisticUpper(c.version)) >= 0) widened = true;
        const truncated = truncate(target, n);
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
        if (cmp(target, c.version) > 0) out.push(raw);
        else widened = true;
        break;
      case "!=":
        if (cmp(target, c.version) !== 0) out.push(raw);
        else widened = true;
        break;
    }
  }
  // Merge duplicate `>=` clauses into the highest, kept at the first one's position.
  const merged: string[] = [];
  let ge: { index: number; version: string } | undefined;
  for (const raw of out) {
    const c = parseClause(raw);
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
