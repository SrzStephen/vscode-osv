import { semverComparator } from "../../versioning/semver.js";
import type { EcosystemModule } from "../types.js";
import { parseMixExs } from "./mixExs.js";
import { parseMixLock } from "./mixLock.js";
import { rewriteHexRequirement } from "./requirement.js";

// Lock commands are sent to a terminal as text, so only shell-inert names are interpolated.
const SAFE_NAME = /^[A-Za-z0-9_]+$/;

export const hexModule: EcosystemModule = {
  id: "hex",
  osvEcosystem: "Hex",
  manifests: ["mix.exs"],
  lockfiles: ["mix.lock"],
  lockfilesForManifest: () => ["mix.lock"],
  manifestForLockfile: () => "mix.exs",
  versioning: semverComparator,
  normalizeName: (name) => name,
  parseManifest: (text) => parseMixExs(text),
  parseLockfile: (text) => parseMixLock(text),
  rewriteSpec: rewriteHexRequirement,
  lockCommand: (ctx) => (SAFE_NAME.test(ctx.name) ? `mix deps.update ${ctx.name}` : undefined),
  transitiveFix: () => undefined,
};
