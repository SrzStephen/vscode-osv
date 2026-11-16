#!/usr/bin/env node
// Usage: npm run release:prepare -- <X.Y.Z | patch | minor | major>
// Bumps both packages' versions, the additional_dependencies pin in .pre-commit-hooks.yaml
// and turns the "## Unreleased" heading in packages/vscode-osv/CHANGELOG.md into the new
// version. It only edits files; it never commits, tags or publishes (the Release workflow
// does that). Appends `version=X.Y.Z` to $GITHUB_OUTPUT when that is set.
// All input is validated and all targets are checked before anything is written.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const USAGE = "Usage: npm run release:prepare -- <X.Y.Z | patch | minor | major>";
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverPkg = "packages/osv-language-server/package.json";
const extPkg = "packages/vscode-osv/package.json";

function resolveVersion(input: string | undefined): string {
  if (input && SEMVER.test(input)) return input;
  if (input === "patch" || input === "minor" || input === "major") {
    const current = JSON.parse(readFileSync(join(root, extPkg), "utf8")).version as string;
    const m = SEMVER.exec(current);
    if (!m) {
      console.error(`Current version "${current}" is not plain semver`);
      process.exit(1);
    }
    const [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (input === "major") return `${maj + 1}.0.0`;
    if (input === "minor") return `${maj}.${min + 1}.0`;
    return `${maj}.${min}.${pat + 1}`;
  }
  console.error(USAGE);
  process.exit(1);
}

if (process.argv.length !== 3) {
  console.error(USAGE);
  process.exit(1);
}
const version = resolveVersion(process.argv[2]);
const edits: [path: string, content: string, label: string][] = [];

for (const pkg of [serverPkg, extPkg]) {
  const path = join(root, pkg);
  const text = readFileSync(path, "utf8");
  const next = text.replace(/^(\s*"version":\s*")[^"]*(")/m, `$1${version}$2`);
  if (next === text && !text.includes(`"version": "${version}"`)) {
    console.error(`Could not find a "version" field in ${pkg}`);
    process.exit(1);
  }
  edits.push([path, next, pkg]);
}

const hooksPath = join(root, ".pre-commit-hooks.yaml");
const hooks = readFileSync(hooksPath, "utf8");
const pin = /osv-language-server@\d+\.\d+\.\d+/g;
if (!pin.test(hooks)) {
  console.error("Could not find an osv-language-server@X.Y.Z pin in .pre-commit-hooks.yaml");
  process.exit(1);
}
edits.push([hooksPath, hooks.replace(pin, `osv-language-server@${version}`), ".pre-commit-hooks.yaml"]);

const changelogPath = join(root, "packages/vscode-osv/CHANGELOG.md");
const changelog = readFileSync(changelogPath, "utf8");
const unreleased = /^## Unreleased[ \t]*\r?\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(changelog);
if (!unreleased?.[1]?.trim()) {
  console.error('packages/vscode-osv/CHANGELOG.md needs a non-empty "## Unreleased" section to release');
  process.exit(1);
}
edits.push([changelogPath, changelog.replace(/^## Unreleased/m, `## ${version}`), "packages/vscode-osv/CHANGELOG.md"]);

for (const [path, content, label] of edits) {
  writeFileSync(path, content);
  console.log(`updated ${label} -> ${version}`);
}
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
console.log("\nNext: run `npm install` (refreshes package-lock.json), review the diff, commit, then tag vX.Y.Z.");
