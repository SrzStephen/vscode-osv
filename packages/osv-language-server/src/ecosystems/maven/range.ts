import { mavenComparator } from "../../versioning/maven.js";
import type { RewriteResult } from "../types.js";

interface Range {
  open: "[" | "(";
  lower: string;
  /** Undefined for a hard requirement such as `[1.0]`. */
  upper: string | undefined;
  close: "]" | ")";
  /** Text after this range (further ranges). */
  rest: string;
}

const RANGE = /^\s*([[(])\s*([^,\]),]*?)\s*(?:,\s*([^\]),]*?)\s*)?([\])])\s*(.*)$/s;

function parseRange(spec: string): Range | undefined {
  const m = RANGE.exec(spec);
  if (!m) return undefined;
  return {
    open: m[1] as "[" | "(",
    lower: m[2]!,
    upper: m[3],
    close: m[4] as "]" | ")",
    rest: m[5]!.replace(/^,\s*/, ""),
  };
}

const isRangeStart = (spec: string) => /^\s*[[(]/.test(spec);

/** The minimum version a Maven version requirement admits, or undefined when it has none. */
export function mavenLowerBound(spec: string): string | undefined {
  const s = spec.trim();
  if (!s) return undefined;
  if (isRangeStart(s)) {
    const r = parseRange(s);
    if (!r || r.open !== "[" || !r.lower) return undefined;
    return mavenComparator.isValid(r.lower) ? r.lower : undefined;
  }
  return mavenComparator.isValid(s) ? s : undefined;
}

/** Rewrites a Maven version requirement so its minimum becomes `target`, dropping an upper bound `target` violates. */
export function rewriteMavenSpec(raw: string, target: string): RewriteResult {
  if (!isRangeStart(raw)) return { spec: target, widened: false };
  const r = parseRange(raw);
  // Several ranges (or an unparseable one) collapse to an open range from the target.
  if (!r || r.rest) return { spec: `[${target},)`, widened: true };
  if (r.upper === undefined) return { spec: `[${target}]`, widened: false };
  if (r.upper === "") return { spec: `[${target},${r.close}`, widened: false };
  const c = mavenComparator.compare(target, r.upper);
  if (c < 0 || (c === 0 && r.close === "]")) return { spec: `[${target},${r.upper}${r.close}`, widened: false };
  return { spec: `[${target},)`, widened: true };
}
