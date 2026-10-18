import { basename, dirname } from "node:path";
import { semverComparator } from "../../versioning/semver.js";
import { setJsonProperty } from "../jsonEdit.js";
import { ParseError, type EcosystemModule } from "../types.js";
import { parseBunLock } from "./bunLock.js";
import { parseNpmManifest } from "./manifest.js";
import { parsePackageLock } from "./packageLock.js";
import { parsePnpmLock } from "./pnpmLock.js";
import { rewriteNpmSpec } from "./rewrite.js";
import { parseYarnLock } from "./yarnLock.js";

const LOCK_COMMANDS: Record<string, string> = {
  "yarn.lock": "yarn install",
  "pnpm-lock.yaml": "pnpm install",
  "bun.lock": "bun install",
};

function lockCommand(lockfilePath: string | undefined): string {
  return (lockfilePath && LOCK_COMMANDS[basename(lockfilePath)]) || "npm install";
}

/** Where each package manager reads forced transitive versions from. */
function overridePath(lockfileName: string, name: string): string[] {
  if (lockfileName === "yarn.lock") return ["resolutions", name];
  if (lockfileName === "pnpm-lock.yaml") return ["pnpm", "overrides", name];
  return ["overrides", name];
}

export const npmModule: EcosystemModule = {
  id: "npm",
  osvEcosystem: "npm",
  manifests: ["package.json"],
  lockfiles: ["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock"],
  lockfilesForManifest: (manifestBasename) =>
    manifestBasename === "package.json"
      ? ["npm-shrinkwrap.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock"]
      : [],
  manifestForLockfile: (lockfileBasename) =>
    npmModule.lockfiles.includes(lockfileBasename) ? "package.json" : undefined,
  versioning: semverComparator,
  normalizeName: (name) => name,
  parseManifest: (text) => parseNpmManifest(text),
  parseLockfile(text, fileName) {
    switch (basename(fileName)) {
      case "package-lock.json":
      case "npm-shrinkwrap.json":
        return parsePackageLock(text);
      case "yarn.lock":
        return parseYarnLock(text);
      case "pnpm-lock.yaml":
        return parsePnpmLock(text);
      case "bun.lock":
        return parseBunLock(text);
      default:
        throw new ParseError(`Unsupported npm lockfile: ${fileName}`);
    }
  },
  rewriteSpec: rewriteNpmSpec,
  lockCommand: (ctx) => lockCommand(ctx.lockfilePath),
  transitiveFix(ctx) {
    if (ctx.manifestText === undefined || ctx.manifestUri === undefined) return undefined;
    return {
      edit: setJsonProperty(
        ctx.manifestText,
        overridePath(basename(ctx.lockfilePath), ctx.name),
        ctx.target,
        ctx.manifestUri,
      ),
      lockCommand: { cwd: dirname(ctx.lockfilePath), command: lockCommand(ctx.lockfilePath) },
      kind: "override",
    };
  },
};
