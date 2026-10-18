import { rubygemsComparator } from "../../versioning/rubygems.js";
import { clausesLowerBound, rewriteClauses, type Clause } from "../requirementClauses.js";

const CLAUSE = /^\s*(=|!=|>=|<=|>|<|~>)?(\s*)([0-9][0-9A-Za-z.-]*)\s*$/;

function parseClause(raw: string): Clause | undefined {
  const m = CLAUSE.exec(raw);
  if (!m) return undefined;
  return { raw, op: m[1], gap: m[2] ?? "", version: m[3] ?? "" };
}

const cmp = (a: string, b: string): number => rubygemsComparator.compare(a, b);

/** Highest of `= X`, `>= X` and `~> X` (bare `X` means `= X`); undefined when none bound from below. */
export function gemLowerBound(reqs: string[]): string | undefined {
  return clausesLowerBound(reqs, parseClause, cmp);
}

export function rewriteGemRequirements(reqs: string[], target: string): { reqs: string[]; widened: boolean } {
  return rewriteClauses(reqs, target, parseClause, cmp);
}
