import { basename, dirname, join } from "node:path";
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
  let dir = dirname(manifestPath);
  for (;;) {
    for (const name of names) {
      const path = join(dir, name);
      const text = await files.read(path);
      if (text !== undefined) return { path, text };
    }
    const parent = dirname(dir);
    if (dir === rootDir || parent === dir) return undefined;
    dir = parent;
  }
}

/** Looks for the manifest beside a lockfile (same directory only). */
export async function findManifestForLockfile(lockfilePath: string, module: EcosystemModule, files: FileSource): Promise<FoundFile | undefined> {
  const name = module.manifestForLockfile(basename(lockfilePath));
  if (name === undefined) return undefined;
  const path = join(dirname(lockfilePath), name);
  const text = await files.read(path);
  return text === undefined ? undefined : { path, text };
}

/** The version to check for a declared dep: the locked one when determinable, else its lower bound. */
export function resolveVersion(dep: DeclaredDep, locked: ResolvedDep[] | undefined, module: EcosystemModule): { version: string; fromLockfile: boolean } | undefined {
  if (dep.kind !== "registry") return undefined;
  const name = module.normalizeName(dep.name);
  const entries = (locked ?? []).filter((r) => module.normalizeName(r.name) === name);
  const { rawSpec } = dep;
  const pick =
    entries.find((r) => r.direct) ??
    (rawSpec === undefined ? undefined : entries.find((r) => r.requestedSpecs?.includes(rawSpec))) ??
    (entries.length === 1 ? entries[0] : undefined);
  if (pick) return { version: pick.version, fromLockfile: true };
  return dep.lowerBound === undefined ? undefined : { version: dep.lowerBound, fromLockfile: false };
}
