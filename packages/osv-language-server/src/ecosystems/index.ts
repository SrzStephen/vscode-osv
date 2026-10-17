import picomatch from "picomatch";
import type { EcosystemModule } from "./types.js";

export const ALL_MODULES: EcosystemModule[] = [];

/** For tests; replaces any module with the same id. Production modules are appended to ALL_MODULES directly. */
export function registerModule(m: EcosystemModule): void {
  const i = ALL_MODULES.findIndex((x) => x.id === m.id);
  if (i >= 0) ALL_MODULES[i] = m;
  else ALL_MODULES.push(m);
}

const matcherCache = new Map<string, (path: string) => boolean>();

function matcher(pattern: string): (path: string) => boolean {
  let fn = matcherCache.get(pattern);
  if (!fn) {
    fn = picomatch(`**/${pattern}`, { dot: true });
    matcherCache.set(pattern, fn);
  }
  return fn;
}

function matches(patterns: string[], relPath: string): boolean {
  return patterns.some((p) => matcher(p)(relPath));
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
