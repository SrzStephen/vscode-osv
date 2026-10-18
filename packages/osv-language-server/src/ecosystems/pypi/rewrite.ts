import { compare, satisfies, valid } from "@renovatebot/pep440";
import semver from "semver";
import type { RewriteResult } from "../types.js";
import { clauseFloor, parseClauses, type Clause } from "./requirement.js";

/** Whether `target` still satisfies an upper-bound clause; unparseable clauses are kept. */
function admits(c: Clause, target: string): boolean {
  if ((c.op !== "<" && c.op !== "<=") || valid(c.version) === null) return true;
  const cmp = compare(target, c.version);
  return c.op === "<" ? cmp < 0 : cmp <= 0;
}

/** Whether `target` meets a clause that sets a lower bound; other clauses and unparseable versions count as met. */
function lowerAdmits(c: Clause, target: string): boolean {
  if (!["==", "===", ">=", ">", "~="].includes(c.op) || valid(c.version.replace(/\.\*$/, "")) === null) return true;
  return satisfies(target, `${c.op}${c.version}`, { prereleases: true });
}

/** Numeric release segments, or undefined for versions with epochs, pre-releases and the like. */
function release(v: string): number[] | undefined {
  return /^\d+(\.\d+)*$/.test(v) ? v.split(".").map(Number) : undefined;
}

/** Whether the exclusive upper bound implied by `~=target` is above the one implied by `~=old`. */
function compatibleUpperRaised(old: string, target: string): boolean {
  const a = release(old);
  const b = release(target);
  if (!a || !b) return !satisfies(target, `~=${old}`);
  const upper = (r: number[]) => r.slice(0, -1).map((n, i, p) => (i === p.length - 1 ? n + 1 : n));
  const [ua, ub] = [upper(a), upper(b)];
  for (let i = 0; i < Math.max(ua.length, ub.length); i++) {
    const d = (ub[i] ?? 0) - (ua[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

/** Version for a `==X.*` clause: same segment count when the target's dropped segments are zero, else null. */
function wildcardPrefix(prefixLen: number, target: string): string | null {
  if (!/^\d+(\.\d+)*$/.test(target)) return null;
  const parts = target.split(".");
  if (parts.slice(prefixLen).some((p) => Number(p) !== 0)) return null;
  while (parts.length < prefixLen) parts.push("0");
  return parts.slice(0, prefixLen).join(".");
}

/** Rewrites a PEP 440 specifier so its lower bound becomes `target`, dropping upper bounds the target violates. */
export function rewritePep440Spec(raw: string, target: string): RewriteResult {
  const clauses = parseClauses(raw);

  let floor = -1;
  for (const [i, c] of clauses.entries()) {
    const v = clauseFloor(c);
    if (v !== undefined && (floor < 0 || compare(v, clauseFloor(clauses[floor]!)!) > 0)) floor = i;
  }

  const texts = clauses.map((c) => c.text);
  if (floor >= 0) {
    const c = clauses[floor]!;
    const lead = /^\s*/.exec(c.text)![0];
    const trail = /\s*$/.exec(c.text)![0];
    const gap = /^\s*/.exec(c.text.slice(lead.length + c.op.length))![0];
    let body: string;
    if (c.op === "==" && c.version.endsWith(".*")) {
      const prefix = wildcardPrefix(c.version.slice(0, -2).split(".").length, target);
      body = prefix === null ? `~=${gap}${target}` : `==${gap}${prefix}.*`;
    } else {
      body = `${c.op}${gap}${target}`;
    }
    texts[floor] = lead + body + trail;
  }

  const kept: string[] = [];
  let widened = floor >= 0 && clauses[floor]!.op === "~=" && compatibleUpperRaised(clauses[floor]!.version, target);
  for (const [i, text] of texts.entries()) {
    // Other lower-bound clauses the target falls outside would leave the spec unsatisfiable.
    if (i !== floor && !(admits(clauses[i]!, target) && lowerAdmits(clauses[i]!, target))) widened = true;
    else kept.push(text);
  }
  if (floor < 0) kept.unshift(`>=${target}`);
  return { spec: kept.join(",").trim(), widened };
}

/** Rewrites a Poetry constraint, keeping a single `^`, `~`, bare, `>=` or `==` style; ranges follow PEP 440. */
export function rewritePoetrySpec(raw: string, target: string): RewriteResult {
  const m = /^\s*(\^|~(?!=)|>=|==)?\s*(\d[\w.+-]*)\s*$/.exec(raw);
  if (!m) return rewritePep440Spec(raw, target);
  const op = m[1] ?? "";
  // Caret and tilde cap the version, so a target outside the old cap widens the constraint.
  const capped = op === "^" || op === "~";
  const widened = capped && !semver.satisfies(target, `${op}${m[2]}`, { loose: true });
  return { spec: `${op}${target}`, widened };
}
