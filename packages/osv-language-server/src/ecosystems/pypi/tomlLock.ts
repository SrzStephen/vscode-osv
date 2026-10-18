import type { AST } from "toml-eslint-parser";
import { LineIndex } from "../../core/lineIndex.js";
import type { ResolvedDep } from "../../core/types.js";
import { resolveEntries, type LockEntry } from "../npm/lockCommon.js";
import { ParseError } from "../types.js";
import { normalizePypiName } from "./names.js";
import { findKey, isString, keyName, parseTomlAst, plainContentRange } from "./toml.js";

type TOMLTable = AST.TOMLTable;
type TOMLKeyValue = AST.TOMLKeyValue;

/** One `[[package]]` entry of a TOML lockfile, with the `[package.*]` sub-tables that follow it. */
export interface LockPackage {
  table: TOMLTable;
  /** Sub-tables keyed by the part after the array name, e.g. "dependencies". */
  sub: Map<string, TOMLTable>;
  name: string;
  version?: string;
  /** Offsets of the version string's content. */
  versionAt?: [number, number];
}

function stringValue(body: TOMLKeyValue[], key: string, text: string) {
  const value = findKey(body, key)?.value;
  const at = isString(value) ? plainContentRange(text, value) : undefined;
  return at ? { value: (value as AST.TOMLStringValue).value, at } : undefined;
}

/** Reads the entries of a `[[<arrayKey>]]` array. Throws ParseError on invalid TOML or a nameless entry. */
export function lockPackages(text: string, arrayKey: string): LockPackage[] {
  const packages: LockPackage[] = [];
  const entries = new Map<number, LockPackage>();
  for (const node of parseTomlAst(text).body[0].body) {
    if (node.type !== "TOMLTable" || node.resolvedKey[0] !== arrayKey) continue;
    const [, index, ...rest] = node.resolvedKey;
    if (typeof index !== "number") continue;
    if (rest.length === 0) {
      const name = stringValue(node.body, "name", text);
      if (!name) throw new ParseError(`Package without a name in ${arrayKey}`);
      const version = stringValue(node.body, "version", text);
      const pkg: LockPackage = { table: node, sub: new Map(), name: name.value, version: version?.value, versionAt: version?.at };
      entries.set(index, pkg);
      packages.push(pkg);
    } else {
      entries.get(index)?.sub.set(rest.join("."), node);
    }
  }
  return packages;
}

/** Entries of a lockfile whose packages must all carry a version (Poetry, PDM). */
export function versionedEntries(packages: LockPackage[], text: string): LockEntry[] {
  const ix = new LineIndex(text);
  return packages.map((p) => {
    if (p.version === undefined) throw new ParseError(`Package ${p.name} has no version`);
    const name = normalizePypiName(p.name);
    return { id: `${name}@${p.version}`, name, version: p.version, range: ix.range(...p.versionAt!), edges: [] };
  });
}

interface Ref {
  name: string;
  version?: string;
}

/** `{ name, version? }` tables of an array value. */
function refs(value: AST.TOMLContentNode): Ref[] {
  if (value.type !== "TOMLArray") return [];
  const out: Ref[] = [];
  for (const el of value.elements) {
    if (el.type !== "TOMLInlineTable") continue;
    const name = findKey(el.body, "name")?.value;
    const version = findKey(el.body, "version")?.value;
    if (isString(name)) out.push({ name: normalizePypiName(name.value), version: isString(version) ? version.value : undefined });
  }
  return out;
}

/** The refs under `key` of a package table, or of every key of a sub-table when `key` is undefined. */
function refsOf(table: TOMLTable | undefined, key?: string): Ref[] {
  return (table?.body ?? []).flatMap((kv) => (key === undefined || keyName(kv) === key ? refs(kv.value) : []));
}

/**
 * Resolves a uv.lock or pylock.toml. `isRoot` picks the project's own packages: their dependencies
 * are the direct ones and they are not reported themselves. Without a root, entries nothing depends
 * on count as direct. Packages without a version (roots, VCS sources) have no entry of their own.
 */
export function resolveGraph(
  packages: LockPackage[],
  text: string,
  isRoot: (pkg: LockPackage) => boolean,
): ResolvedDep[] {
  const ix = new LineIndex(text);
  const roots = packages.filter(isRoot);
  const entries: LockEntry[] = [];
  const byName = new Map<string, LockEntry[]>();
  const owners = new Map<LockEntry, LockPackage>();
  for (const p of packages) {
    if (p.version === undefined || roots.includes(p)) continue;
    const name = normalizePypiName(p.name);
    const entry: LockEntry = { id: `${name}@${p.version}`, name, version: p.version, range: ix.range(...p.versionAt!), edges: [] };
    entries.push(entry);
    byName.set(name, [...(byName.get(name) ?? []), entry]);
    owners.set(entry, p);
  }
  // An unqualified reference means the name is unambiguous, but fall back to every candidate.
  const targets = (list: Ref[]) =>
    list.flatMap((r) => (byName.get(r.name) ?? []).filter((e) => r.version === undefined || e.version === r.version).map((e) => e.id));

  for (const [entry, p] of owners) {
    entry.edges = targets([...refsOf(p.table, "dependencies"), ...refsOf(p.sub.get("optional-dependencies"))]);
  }
  const direct = roots.flatMap((r) =>
    targets([
      ...refsOf(r.table, "dependencies"),
      ...refsOf(r.sub.get("optional-dependencies")),
      ...refsOf(r.sub.get("dev-dependencies")),
    ]),
  );
  return resolveEntries(entries, roots.length > 0 ? direct : undefined);
}

/** The entries of an inline-table value such as uv's `source` or pylock's `directory`. */
export function inlineTable(table: TOMLTable, key: string): TOMLKeyValue[] {
  const value = findKey(table.body, key)?.value;
  return value?.type === "TOMLInlineTable" ? value.body : [];
}
