import { nugetComparator } from "../../versioning/nuget.js";
import type { RewriteResult } from "../types.js";

interface Range {
  open: "[" | "(";
  lower: string;
  /** Undefined for an exact requirement such as `[1.0]`. */
  upper: string | undefined;
  close: "]" | ")";
}

const RANGE = /^\s*([[(])\s*([^,\]),]*?)\s*(?:,\s*([^\]),]*?)\s*)?([\])])\s*$/;

function parseRange(spec: string): Range | undefined {
  const m = RANGE.exec(spec);
  if (!m) return undefined;
  return { open: m[1] as "[" | "(", lower: m[2]!, upper: m[3], close: m[4] as "]" | ")" };
}

const isRangeStart = (spec: string) => /^\s*[[(]/.test(spec);

/** `1.*` -> `1.0`, `1.2.*` -> `1.2.0`, `1.0-*` -> `1.0`; undefined for `*` or a non-floating version. */
function floatingFloor(v: string): string | undefined {
  const m = /^(\d+(?:\.\d+)*)(?:\.\*|-\*)$/.exec(v);
  if (!m) return undefined;
  return v.endsWith(".*") ? `${m[1]}.0` : m[1];
}

function versionLowerBound(v: string): string | undefined {
  if (!v) return undefined;
  if (v.includes("*")) return floatingFloor(v);
  return nugetComparator.isValid(v) ? v : undefined;
}

/** The minimum version a NuGet version requirement admits, or undefined when it has none. */
export function nugetLowerBound(spec: string): string | undefined {
  const s = spec.trim();
  if (!s) return undefined;
  if (isRangeStart(s)) {
    const r = parseRange(s);
    if (!r || r.open !== "[") return undefined;
    return versionLowerBound(r.lower);
  }
  return versionLowerBound(s);
}

/** Rewrites a NuGet version requirement so its minimum becomes `target`, dropping an upper bound `target` violates. */
export function rewriteNugetSpec(raw: string, target: string): RewriteResult {
  if (!isRangeStart(raw)) return { spec: target, widened: false };
  const r = parseRange(raw);
  if (!r) return { spec: `[${target},)`, widened: true };
  if (r.upper === undefined) return { spec: `[${target}]`, widened: false };
  if (r.upper === "") return { spec: `[${target},${r.close}`, widened: false };
  const c = nugetComparator.compare(target, r.upper);
  if (c < 0 || (c === 0 && r.close === "]")) return { spec: `[${target},${r.upper}${r.close}`, widened: false };
  return { spec: `[${target},)`, widened: true };
}
