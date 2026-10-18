import { basename, dirname } from "node:path";
import { pep440Comparator } from "../../versioning/pep440.js";
import { ParseError, type EcosystemModule } from "../types.js";
import { normalizePypiName } from "./names.js";
import { parsePdmLock } from "./pdmLock.js";
import { parsePipfile } from "./pipfile.js";
import { parsePipfileLock } from "./pipfileLock.js";
import { parsePoetryLock } from "./poetryLock.js";
import { parsePylock } from "./pylock.js";
import { parsePyproject } from "./pyproject.js";
import { parseRequirementsTxt } from "./requirements.js";
import { rewritePep440Spec, rewritePoetrySpec } from "./rewrite.js";
import { parseUvLock } from "./uvLock.js";

const LOCK_COMMANDS: Record<string, string> = {
  "uv.lock": "uv lock",
  "poetry.lock": "poetry lock",
  "Pipfile.lock": "pipenv lock",
  "pdm.lock": "pdm lock",
};

function isPylock(name: string): boolean {
  return /^pylock(\..+)?\.toml$/.test(name);
}

export const pypiModule: EcosystemModule = {
  id: "pypi",
  osvEcosystem: "PyPI",
  manifests: ["requirements*.txt", "requirements/*.txt", "pyproject.toml", "Pipfile"],
  lockfiles: ["poetry.lock", "uv.lock", "Pipfile.lock", "pdm.lock", "pylock.toml", "pylock.*.toml"],
  lockfilesForManifest(manifestBasename) {
    if (manifestBasename === "pyproject.toml") return ["uv.lock", "poetry.lock", "pdm.lock", "pylock.toml"];
    if (manifestBasename === "Pipfile") return ["Pipfile.lock"];
    return [];
  },
  manifestForLockfile(lockfileBasename) {
    if (lockfileBasename === "Pipfile.lock") return "Pipfile";
    return lockfileBasename in LOCK_COMMANDS || isPylock(lockfileBasename) ? "pyproject.toml" : undefined;
  },
  versioning: pep440Comparator,
  normalizeName: normalizePypiName,
  parseManifest(text, fileName) {
    const name = basename(fileName);
    if (name === "pyproject.toml") return parsePyproject(text);
    if (name === "Pipfile") return parsePipfile(text);
    if (name.endsWith(".txt")) return parseRequirementsTxt(text);
    throw new ParseError(`Unsupported PyPI manifest: ${fileName}`);
  },
  parseLockfile(text, fileName) {
    const name = basename(fileName);
    if (name === "poetry.lock") return parsePoetryLock(text);
    if (name === "uv.lock") return parseUvLock(text);
    if (name === "Pipfile.lock") return parsePipfileLock(text);
    if (name === "pdm.lock") return parsePdmLock(text);
    if (isPylock(name)) return parsePylock(text);
    throw new ParseError(`Unsupported PyPI lockfile: ${fileName}`);
  },
  // Poetry's ^, ~ and bare versions are not valid PEP 440 operators; `~=` stays PEP 440.
  rewriteSpec: (rawSpec, target) =>
    /^\s*(\^|~(?!=)|\d)/.test(rawSpec) ? rewritePoetrySpec(rawSpec, target) : rewritePep440Spec(rawSpec, target),
  lockCommand(ctx) {
    const known = ctx.lockfilePath && LOCK_COMMANDS[basename(ctx.lockfilePath)];
    if (known) return known;
    const manifest = basename(ctx.manifestPath);
    return !ctx.lockfilePath && /^requirements.*\.txt$/.test(manifest) ? `pip install -r ${manifest}` : undefined;
  },
  transitiveFix(ctx) {
    const command =
      { "poetry.lock": `poetry update ${ctx.name}`, "uv.lock": `uv lock --upgrade-package ${ctx.name}` }[
        basename(ctx.lockfilePath)
      ];
    if (!command) return undefined;
    return { kind: "command-only", edit: [], lockCommand: { cwd: dirname(ctx.lockfilePath), command } };
  },
};
