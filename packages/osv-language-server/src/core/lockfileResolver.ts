import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { EcosystemModule } from "../ecosystems/types.js";
import type { FileSource } from "./fileSource.js";
import type { DeclaredDep, ResolvedDep } from "./types.js";

interface FoundFile {
  path: string;
  text: string;
}

/** Walks from the manifest's directory up to rootDir (inclusive, never above) for the first readable lockfile. */
export async function findLockfile(manifestPath: string, module: EcosystemModule, rootDir: string, files: FileSource): Promise<FoundFile | undefined> {
  const names = module.lockfilesForManifest(basename(manifestPath));
  const root = resolve(rootDir);
  let dir = dirname(resolve(manifestPath));
  const rel = relative(root, dir);
  // A manifest outside the workspace root must never read any lockfile.
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;
  for (;;) {
    for (const name of names) {
      const path = join(dir, name);
      const text = await files.read(path);
      if (text !== undefined) return { path, text };
    }
    if (dir === root) return undefined;
    dir = dirname(dir);
  }
}

/** Looks for the manifest beside a lockfile (same directory only). */
export async function findManifestForLockfile(lockfilePath: string, module: EcosystemModule, files: FileSource): Promise<FoundFile | undefined> {
  const dir = dirname(resolve(lockfilePath));
  const base = basename(lockfilePath);
  const names = module.manifestsForLockfile ? module.manifestsForLockfile(base) : [module.manifestForLockfile(base)];
  for (const name of names) {
    if (name === undefined) continue;
    for (const candidate of await expandCandidate(name, dir, files)) {
      const path = join(dir, candidate);
      const text = await files.read(path);
      if (text !== undefined) return { path, text };
    }
  }
  return undefined;
}

/** A candidate with a single `*` expands to the sorted matching entries of dir; anything else is itself. */
async function expandCandidate(name: string, dir: string, files: FileSource): Promise<string[]> {
  const star = name.indexOf("*");
  if (star < 0 || star !== name.lastIndexOf("*")) return [name];
  const prefix = name.slice(0, star);
  const suffix = name.slice(star + 1);
  const entries = await files.list(dir);
  return entries.filter((e) => e.length >= prefix.length + suffix.length && e.startsWith(prefix) && e.endsWith(suffix)).sort();
}

/** The module's matching key for names: nameKey when defined, else normalizeName. */
export function nameKeyOf(module: EcosystemModule): (name: string) => string {
  return (name) => (module.nameKey ? module.nameKey(name) : module.normalizeName(name));
}

/** The locked entry a declared dep resolves to, when it can be told apart from other copies. */
export function pickLockedEntry(dep: DeclaredDep, locked: ResolvedDep[] | undefined, module: EcosystemModule): ResolvedDep | undefined {
  const key = nameKeyOf(module);
  const name = key(dep.name);
  const entries = (locked ?? []).filter((r) => key(r.name) === name);
  const { rawSpec } = dep;
  return (
    entries.find((r) => r.direct) ??
    (rawSpec === undefined ? undefined : entries.find((r) => r.requestedSpecs?.includes(rawSpec))) ??
    (entries.length === 1 ? entries[0] : undefined)
  );
}

/** The version to check for a declared dep: the locked one when determinable, else its lower bound. */
export function resolveVersion(dep: DeclaredDep, locked: ResolvedDep[] | undefined, module: EcosystemModule): { version: string; fromLockfile: boolean; name: string } | undefined {
  if (dep.kind !== "registry") return undefined;
  const pick = pickLockedEntry(dep, locked, module);
  if (pick) return { version: pick.version, fromLockfile: true, name: pick.name };
  return dep.lowerBound === undefined ? undefined : { version: dep.lowerBound, fromLockfile: false, name: dep.name };
}
