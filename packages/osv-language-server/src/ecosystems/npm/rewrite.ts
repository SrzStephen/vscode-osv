import semver from "semver";
import type { RewriteResult } from "../types.js";

const opts = { loose: true } as const;

/** Rewrites an npm range so its minimum becomes `target`, keeping the operator style. */
export function rewriteNpmSpec(raw: string, target: string): RewriteResult {
  const spec = raw.trim().replace(/(>=|<=|>|<|=|\^|~)\s+/g, "$1");
  const fallback = { spec: `^${target}`, widened: true };
  if (spec.includes("||")) return fallback;

  // "1.2.x" keeps its shape only when the target is a ".0" release, else "1.4.x" would admit versions below it.
  const x = /^([v=]?)(\d+)\.(\d+)\.[xX*]$/.exec(spec);
  if (x) {
    const t = semver.parse(target, opts);
    if (!t) return fallback;
    return { spec: t.patch === 0 ? `${x[1]}${t.major}.${t.minor}.x` : `~${target}`, widened: false };
  }
  if (/^[v=]?\d+\.[xX*]$/.test(spec)) return { spec: `^${target}`, widened: false };

  const tokens = spec.split(/\s+/);
  const lower = tokens.filter((t) => !t.startsWith("<"));
  const m = lower.length === 1 ? /^(\^|~|>=|>|=|v)?(\d[\w.+-]*)$/.exec(lower[0]!) : null;
  if (!m) return fallback;

  const uppers = tokens.filter((t) => t.startsWith("<"));
  const kept = uppers.filter((u) => semver.satisfies(target, u, opts));
  // A ">" floor excludes its own version, so the new floor is ">=" to keep the target admitted.
  const op = m[1] === ">" ? ">=" : (m[1] ?? "");
  return { spec: [`${op}${target}`, ...kept].join(" "), widened: kept.length < uppers.length };
}
