import semver from "semver";
import type { RewriteResult } from "../types.js";

const COMPARATOR = /^(\^|~|>=|<=|>|<|=)?\s*(.+)$/;

interface Comparator {
  op: string;
  version: string;
  raw: string;
}

function split(req: string): Comparator[] {
  return req
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((raw) => {
      const m = COMPARATOR.exec(raw)!;
      return { op: m[1] ?? "", version: m[2]!.trim(), raw };
    });
}

const isWildcard = (v: string) => /^[*xX]$|[.][*xX]$/.test(v);

/** A Cargo comparator as a node-semver one: a bare version means caret. */
function toSemver(c: Comparator): string {
  const op = c.op === "" && !isWildcard(c.version) ? "^" : c.op;
  return `${op}${c.version}`;
}

/** The minimum version a Cargo requirement admits, or undefined when it has no lower bound. */
export function cargoLowerBound(req: string): string | undefined {
  const comparators = split(req);
  if (comparators.length === 0) return undefined;
  try {
    const min = semver.minVersion(comparators.map(toSemver).join(" "));
    if (!min) return undefined;
    if (min.version === "0.0.0") {
      const explicit = comparators.some((c) => !["<", "<="].includes(c.op) && /^0(\.0(\.0)?)?$/.test(c.version));
      return explicit ? "0.0.0" : undefined;
    }
    return min.version;
  } catch {
    return undefined;
  }
}

/** Rewrites a Cargo requirement so its minimum becomes `target`, keeping the operator and precision. */
export function rewriteCargoReq(raw: string, target: string): RewriteResult {
  const fallback = { spec: `^${target}`, widened: true };
  const comparators = split(raw);
  const lower = comparators.filter((c) => c.op !== "<" && c.op !== "<=");
  const uppers = comparators.filter((c) => c.op === "<" || c.op === "<=");
  const only = lower.length === 1 ? lower[0]! : undefined;
  if (!only) return fallback;
  if (isWildcard(only.version)) return { spec: `^${target}`, widened: false };
  if (!/^\d+(\.\d+){0,2}$/.test(only.version)) return fallback;

  const parsed = semver.parse(target);
  if (!parsed) return fallback;
  const parts = only.version.split(".").length;
  const truncated = `${[parsed.major, parsed.minor, parsed.patch].slice(0, parts).join(".")}`;
  const padded = [...truncated.split("."), "0", "0"].slice(0, 3).join(".");
  const version = parsed.prerelease.length === 0 && padded === target ? truncated : target;

  // A ">" floor excludes its own version, so the new floor is ">=" to keep the target admitted.
  const op = only.op === ">" ? ">=" : only.op;
  const kept = uppers.filter((u) => semver.satisfies(target, toSemver(u)));
  return { spec: [`${op}${version}`, ...kept.map((u) => u.raw)].join(", "), widened: kept.length < uppers.length };
}
