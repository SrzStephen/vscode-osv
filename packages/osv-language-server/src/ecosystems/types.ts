import type { DeclaredDep, ResolvedDep, UpdatePlan } from "../core/types.js";
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
}

export class ParseError extends Error {}
