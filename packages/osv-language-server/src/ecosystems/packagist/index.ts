import { dirname } from "node:path";
import { composerComparator } from "../../versioning/composer.js";
import type { EcosystemModule } from "../types.js";
import { parseComposerJson } from "./composerJson.js";
import { parseComposerLock } from "./composerLock.js";
import { rewriteComposerConstraint } from "./constraint.js";

// Lock commands are sent to a terminal as text, so only shell-inert names are interpolated.
const SAFE_NAME = /^[A-Za-z0-9_.\/-]+$/;
const updateCommand = (name: string): string | undefined => (SAFE_NAME.test(name) ? `composer update ${name}` : undefined);

export const packagistModule: EcosystemModule = {
  id: "packagist",
  osvEcosystem: "Packagist",
  manifests: ["composer.json"],
  lockfiles: ["composer.lock"],
  lockfilesForManifest: () => ["composer.lock"],
  manifestForLockfile: () => "composer.json",
  versioning: composerComparator,
  normalizeName: (name) => name.toLowerCase(),
  parseManifest: (text) => parseComposerJson(text),
  parseLockfile: (text) => parseComposerLock(text),
  rewriteSpec: rewriteComposerConstraint,
  lockCommand: (ctx) => updateCommand(ctx.name),
  transitiveFix(ctx) {
    const command = updateCommand(ctx.name);
    return command === undefined ? undefined : { kind: "command-only", edit: [], lockCommand: { cwd: dirname(ctx.lockfilePath), command } };
  },
};
