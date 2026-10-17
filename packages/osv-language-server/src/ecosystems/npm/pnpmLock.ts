import { LineIndex } from "../../core/lineIndex.js";
import type { ResolvedDep } from "../../core/types.js";
import { readYamlTree, resolveEntries, yamlChild, type LockEntry } from "./lockCommon.js";

const ROOT_GROUPS = ["dependencies", "devDependencies", "optionalDependencies"];
const DEP_GROUPS = ["dependencies", "optionalDependencies"];

/** Splits a v6 (`/name@1.0.0`) or v9 (`name@1.0.0`) key, dropping any peer suffix from the version. */
function parseKey(raw: string): { name: string; version: string; offset: number } | undefined {
  const slash = raw.startsWith("/") ? 1 : 0;
  const base = raw.slice(slash).split("(")[0]!;
  const at = base.indexOf("@", 1);
  const version = base.slice(at + 1).split("_")[0]!;
  return at < 1 || !/^\d/.test(version) ? undefined : { name: base.slice(0, at), version, offset: slash + at + 1 };
}

/** Id of the entry a dependency value points at: a plain version, or a v6 `/name@version` alias. */
function targetId(name: string, value: string): string {
  const alias = value.startsWith("/") ? parseKey(value) : undefined;
  return alias ? `${alias.name}@${alias.version}` : `${name}@${value.split(/[(_]/)[0]}`;
}

/** Parses pnpm-lock.yaml (lockfile v6 and v9). Throws ParseError on invalid YAML. */
export function parsePnpmLock(text: string): ResolvedDep[] {
  const root = readYamlTree(text, "pnpm-lock.yaml");
  const section = (name: string) => root.find((n) => n.key === name)?.children ?? [];
  const ix = new LineIndex(text);

  const byId = new Map<string, LockEntry>();
  for (const node of section("packages")) {
    const parsed = parseKey(node.key);
    const id = parsed && `${parsed.name}@${parsed.version}`;
    if (!parsed || byId.has(id!)) continue;
    const start = node.keyStart + parsed.offset;
    byId.set(id!, {
      id: id!,
      name: parsed.name,
      version: parsed.version,
      range: ix.range(start, start + parsed.version.length),
      edges: [],
    });
  }

  // v6 lists dependencies under `packages`; v9 moves them to `snapshots`, one per peer-suffixed variant.
  for (const node of [...section("packages"), ...section("snapshots")]) {
    const parsed = parseKey(node.key);
    const entry = parsed && byId.get(`${parsed.name}@${parsed.version}`);
    if (!entry) continue;
    for (const group of DEP_GROUPS) {
      for (const dep of yamlChild(node, group)?.children ?? []) entry.edges.push(targetId(dep.key, dep.value));
    }
  }

  // Single projects (v6) keep their direct deps at the top level; workspaces use importers['.'].
  const importer = section("importers").find((n) => n.key === ".")?.children ?? root;
  const direct: string[] = [];
  for (const group of ROOT_GROUPS) {
    for (const dep of importer.find((n) => n.key === group)?.children ?? []) {
      const version = yamlChild(dep, "version")?.value;
      const entry = version === undefined ? undefined : byId.get(targetId(dep.key, version));
      if (!entry) continue;
      direct.push(entry.id);
      const specifier = yamlChild(dep, "specifier")?.value;
      if (specifier !== undefined) (entry.requestedSpecs ??= []).push(specifier);
    }
  }
  return resolveEntries([...byId.values()], direct);
}
