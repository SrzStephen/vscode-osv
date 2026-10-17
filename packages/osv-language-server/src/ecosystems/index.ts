import picomatch from "picomatch";
import type { EcosystemModule } from "./types.js";

export const ALL_MODULES: EcosystemModule[] = [];

/** For tests; production modules are appended to ALL_MODULES directly. */
export function registerModule(m: EcosystemModule): void {
  ALL_MODULES.push(m);
}

function matches(patterns: string[], relPath: string): boolean {
  return patterns.some((p) => picomatch(`**/${p}`, { dot: true })(relPath));
}

/** Classifies a root-relative path; a manifest match wins over a lockfile match. */
export function classifyFile(
  relPath: string,
  modules: EcosystemModule[] = ALL_MODULES,
): { module: EcosystemModule; role: "manifest" | "lockfile" } | undefined {
  for (const module of modules) {
    if (matches(module.manifests, relPath)) return { module, role: "manifest" };
  }
  for (const module of modules) {
    if (matches(module.lockfiles, relPath)) return { module, role: "lockfile" };
  }
  return undefined;
}
