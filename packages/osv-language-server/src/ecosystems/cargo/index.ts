import { dirname } from "node:path";
import { semverComparator } from "../../versioning/semver.js";
import type { EcosystemModule } from "../types.js";
import { parseCargoLock } from "./lock.js";
import { parseCargoManifest, resolveCargoWorkspace } from "./manifest.js";
import { rewriteCargoReq } from "./req.js";

// Lock commands are sent to a terminal as text, so only shell-inert names and versions are interpolated.
const SAFE_NAME = /^[A-Za-z0-9_-]+$/;
const SAFE_VERSION = /^[A-Za-z0-9.+-]+$/;

export const cargoModule: EcosystemModule = {
  id: "cargo",
  osvEcosystem: "crates.io",
  manifests: ["Cargo.toml"],
  lockfiles: ["Cargo.lock"],
  // The resolver walks up directories, so workspace members find the root lockfile.
  lockfilesForManifest: () => ["Cargo.lock"],
  manifestForLockfile: () => "Cargo.toml",
  versioning: semverComparator,
  // crates.io treats `-` and `_` as distinct for OSV, so names stay as written.
  normalizeName: (name) => name,
  parseManifest: (text) => parseCargoManifest(text),
  parseLockfile: (text) => parseCargoLock(text),
  rewriteSpec: rewriteCargoReq,
  lockCommand: (ctx) => (SAFE_NAME.test(ctx.name) ? `cargo update -p ${ctx.name}` : undefined),
  transitiveFix(ctx) {
    if (!SAFE_NAME.test(ctx.name) || !SAFE_VERSION.test(ctx.current) || !SAFE_VERSION.test(ctx.target)) return undefined;
    return {
      kind: "command-only",
      edit: [],
      lockCommand: {
        cwd: dirname(ctx.lockfilePath),
        command: `cargo update -p ${ctx.name}@${ctx.current} --precise ${ctx.target}`,
      },
    };
  },
  resolveExternal: resolveCargoWorkspace,
  relatedFiles: ["Cargo.toml"],
};
