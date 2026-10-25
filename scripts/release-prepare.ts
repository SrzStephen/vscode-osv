#!/usr/bin/env node
// Usage: npm run release:prepare -- X.Y.Z   (or: node scripts/release-prepare.ts X.Y.Z)
// Bumps both packages' versions and the additional_dependencies pin in
// .pre-commit-hooks.yaml. It only edits files; it never commits, tags or publishes.
// All input is validated and all targets are checked before anything is written.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (process.argv.length !== 3 || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version ?? "")) {
  console.error("Usage: npm run release:prepare -- X.Y.Z   (plain semver, e.g. 0.2.0)");
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const edits: [path: string, content: string, label: string][] = [];

for (const pkg of ["packages/osv-language-server/package.json", "packages/vscode-osv/package.json"]) {
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

for (const [path, content, label] of edits) {
  writeFileSync(path, content);
  console.log(`updated ${label} -> ${version}`);
}
console.log("\nNext: update CHANGELOG.md, run `npm install` (refreshes package-lock.json), review `git diff`, commit, then tag vX.Y.Z.");
