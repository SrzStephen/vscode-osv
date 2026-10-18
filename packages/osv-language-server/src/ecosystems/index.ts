import picomatch from "picomatch";
import type { EcosystemModule } from "./types.js";
import { npmModule } from "./npm/index.js";
import { pypiModule } from "./pypi/index.js";
import { cargoModule } from "./cargo/index.js";
import { mavenModule } from "./maven/index.js";
import { goModule } from "./go/index.js";
import { nugetModule } from "./nuget/index.js";
import { rubygemsModule } from "./rubygems/index.js";

export const ALL_MODULES: EcosystemModule[] = [npmModule, pypiModule, cargoModule, mavenModule, goModule, nugetModule, rubygemsModule];

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

/** Every file glob the tool reacts to (manifests, lockfiles, related files), deduplicated, in module order. */
export function allFileGlobs(modules: EcosystemModule[] = ALL_MODULES): string[] {
  return [...new Set(modules.flatMap((m) => [...m.manifests, ...m.lockfiles, ...(m.relatedFiles ?? [])]))];
}

function globToRegex(glob: string): string {
  return glob.replace(/[.+^${}()|[\]\\?]/g, "\\$&").replace(/\*/g, "[^/]*");
}

/** Anchored regex source for pre-commit's `files:`; each glob matches at any directory depth. */
export function preCommitFilesRegex(modules: EcosystemModule[] = ALL_MODULES): string {
  return `(^|/)(${allFileGlobs(modules).map(globToRegex).join("|")})$`;
}
