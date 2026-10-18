import { LineIndex } from "../../core/lineIndex.js";
import { findKey } from "../../core/toml.js";
import type { ResolvedDep } from "../../core/types.js";
import { resolveEntries, type LockEntry } from "../npm/lockCommon.js";
import { lockPackages, type LockPackage } from "../pypi/tomlLock.js";

function dependencyStrings(pkg: LockPackage): string[] {
  const value = findKey(pkg.table.body, "dependencies")?.value;
  if (value?.type !== "TOMLArray") return [];
  return value.elements.flatMap((el) => (el.type === "TOMLValue" && typeof el.value === "string" ? [el.value] : []));
}

/**
 * Parses Cargo.lock. Packages without a `source` are the workspace's own crates: they are not reported,
 * and the packages they depend on are the direct ones. Throws ParseError on invalid TOML.
 */
export function parseCargoLock(text: string): ResolvedDep[] {
  const ix = new LineIndex(text);
  const packages = lockPackages(text, "package");
  const isRoot = (p: LockPackage) => !findKey(p.table.body, "source");
  const roots = packages.filter(isRoot);

  const byName = new Map<string, LockEntry[]>();
  const entries: LockEntry[] = [];
  const owners = new Map<LockEntry, LockPackage>();
  for (const p of packages) {
    if (isRoot(p) || p.version === undefined) continue;
    const entry: LockEntry = { id: `${p.name}@${p.version}`, name: p.name, version: p.version, range: ix.range(...p.versionAt!), edges: [] };
    entries.push(entry);
    byName.set(p.name, [...(byName.get(p.name) ?? []), entry]);
    owners.set(entry, p);
  }

  // "name", "name version" or "name version (source)"; a bare name is unambiguous in the lockfile.
  const targets = (deps: string[]) =>
    deps.flatMap((d) => {
      const [name = "", version] = d.split(" ");
      return (byName.get(name) ?? []).filter((e) => version === undefined || e.version === version).map((e) => e.id);
    });

  for (const [entry, p] of owners) entry.edges = targets(dependencyStrings(p));
  return resolveEntries(entries, roots.flatMap((r) => targets(dependencyStrings(r))));
}
