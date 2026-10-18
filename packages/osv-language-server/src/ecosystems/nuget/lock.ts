import { LineIndex } from "../../core/lineIndex.js";
import type { ResolvedDep } from "../../core/types.js";
import { jsonInner, jsonProp, jsonProps, parseJsonObject, resolveEntries, type LockEntry } from "../npm/lockCommon.js";

/**
 * Parses packages.lock.json: `dependencies.<tfm>.<name>`. An entry repeated across target frameworks
 * with the same resolved version is reported once (the first range wins, edges are merged).
 * Project references have no `resolved` and are skipped. Throws ParseError on invalid JSON.
 */
export function parseNugetLock(text: string): ResolvedDep[] {
  const root = parseJsonObject(text, "packages.lock.json");
  const ix = new LineIndex(text);
  const byId = new Map<string, LockEntry>();
  const direct = new Set<string>();

  for (const [, frameworkNode] of jsonProps(jsonProp(root, "dependencies"))) {
    const packages = jsonProps(frameworkNode);
    const resolvedOf = new Map<string, string>();
    for (const [name, node] of packages) {
      const resolved = jsonProp(node, "resolved")?.value;
      if (typeof resolved === "string") resolvedOf.set(name.toLowerCase(), resolved);
    }
    for (const [name, node] of packages) {
      const resolvedNode = jsonProp(node, "resolved");
      const version = resolvedNode?.value;
      if (!resolvedNode || typeof version !== "string") continue;
      const id = `${name}@${version}`;
      const edges: string[] = [];
      for (const [dep] of jsonProps(jsonProp(node, "dependencies"))) {
        const depVersion = resolvedOf.get(dep.toLowerCase());
        if (depVersion === undefined) continue;
        const actual = packages.find(([n]) => n.toLowerCase() === dep.toLowerCase())![0];
        edges.push(`${actual}@${depVersion}`);
      }
      const existing = byId.get(id);
      if (existing) {
        for (const e of edges) if (!existing.edges.includes(e)) existing.edges.push(e);
      } else {
        byId.set(id, { id, name, version, range: ix.range(...jsonInner(resolvedNode)), edges });
      }
      if (jsonProp(node, "type")?.value === "Direct") direct.add(id);
    }
  }
  return resolveEntries([...byId.values()], direct);
}
