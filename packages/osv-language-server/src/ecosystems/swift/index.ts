import { semverComparator } from "../../versioning/semver.js";
import type { EcosystemModule, RewriteResult } from "../types.js";
import { parsePackageResolved } from "./packageResolved.js";
import { parsePackageSwift } from "./packageSwift.js";
import { normalizeSwiftUrl } from "./url.js";

const RANGE = /^"([^"]*)"(\s*)(\.\.[.<])(\s*)"([^"]*)"$/;

/**
 * Rewrites the version of a Package.swift requirement. A bare version replaces only the version text, so the
 * surrounding `from:`, `exact:` or `.upToNextMajor(from:)` stays. A range takes the target as its lower bound and,
 * when the target falls outside it (at or above the upper bound of `..<`, above that of `...`), moves the
 * upper bound to the next major and reports the range as widened.
 */
function rewriteSwiftSpec(rawSpec: string, target: string): RewriteResult {
  const m = RANGE.exec(rawSpec.trim());
  if (!m) return { spec: target, widened: false };
  const [, , gap1, op, gap2, upper] = m as unknown as [string, string, string, string, string, string];
  const cmp = semverComparator.isValid(upper) && semverComparator.isValid(target) ? semverComparator.compare(target, upper) : undefined;
  const outside = cmp !== undefined && (op === "..<" ? cmp >= 0 : cmp > 0);
  if (!outside) return { spec: `"${target}"${gap1}${op}${gap2}"${upper}"`, widened: false };
  const next = `${semverComparator.major(target) + 1}.0.0`;
  return { spec: `"${target}"${gap1}${op}${gap2}"${next}"`, widened: true };
}

export const swiftModule: EcosystemModule = {
  id: "swift",
  osvEcosystem: "SwiftURL",
  manifests: ["Package.swift"],
  lockfiles: ["Package.resolved"],
  lockfilesForManifest: () => ["Package.resolved"],
  manifestForLockfile: () => "Package.swift",
  versioning: semverComparator,
  normalizeName: (name) => normalizeSwiftUrl(name) ?? name,
  nameKey: (name) => (normalizeSwiftUrl(name) ?? name).toLowerCase(),
  parseManifest: (text) => parsePackageSwift(text),
  parseLockfile: (text) => parsePackageResolved(text),
  rewriteSpec: rewriteSwiftSpec,
  lockCommand: () => "swift package update",
  transitiveFix: () => undefined,
};
