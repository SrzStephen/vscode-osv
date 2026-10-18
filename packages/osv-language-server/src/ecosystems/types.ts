import type { DeclaredDep, ResolvedDep, UpdatePlan } from "../core/types.js";
import type { FileSource } from "../core/fileSource.js";
import type { Comparator } from "../versioning/types.js";

export interface RewriteResult {
  spec: string;
  widened: boolean;
}

export interface LockCtx {
  manifestPath: string;
  lockfilePath?: string;
  name: string;
  target: string;
}

export interface TransitiveCtx {
  name: string;
  /** The version currently locked. */
  current: string;
  target: string;
  lockfilePath: string;
  manifestPath?: string;
  manifestUri?: string;
  manifestText?: string;
}

export interface EcosystemModule {
  id: string;
  osvEcosystem: string;
  /** picomatch globs, matched against the path relative to the root prefixed with "**\/". */
  manifests: string[];
  lockfiles: string[];
  /** Lockfile basenames, in preference order. */
  lockfilesForManifest(manifestBasename: string): string[];
  /** Manifest basename for a lockfile basename. */
  manifestForLockfile(lockfileBasename: string): string | undefined;
  versioning: Comparator;
  normalizeName(name: string): string;
  /** Throws ParseError on invalid syntax. */
  parseManifest(text: string, fileName: string): DeclaredDep[];
  /** Throws ParseError on invalid syntax. */
  parseLockfile(text: string, fileName: string): ResolvedDep[];
  rewriteSpec(rawSpec: string, target: string): RewriteResult;
  lockCommand(ctx: LockCtx): string | undefined;
  transitiveFix(ctx: TransitiveCtx): UpdatePlan | undefined;
  /** Case/format-insensitive key for matching names; defaults to normalizeName. */
  nameKey?(name: string): string;
  /** Manifest versions are resolved versions (Go): no lockfile lookup, checkedLowerBound is false. */
  manifestIsExact?: boolean;
  /** Fills rawSpec/lowerBound/kind/specLocation from other files; called by the scanner after parseManifest. */
  resolveExternal?(deps: DeclaredDep[], ctx: { manifestPath: string; rootDir: string; files: FileSource }): Promise<DeclaredDep[]>;
  /** Globs of files whose change should rescan open documents in the same tree. */
  relatedFiles?: string[];
  /**
   * Candidate manifest basenames for a lockfile, in preference order; preferred over manifestForLockfile.
   * A candidate with a single `*` (e.g. `*.csproj`) is expanded against the lockfile's directory.
   */
  manifestsForLockfile?(lockfileBasename: string): string[];
}

export class ParseError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "ParseError";
  }
}
