import type { Node } from "jsonc-parser";
import { LineIndex } from "../../core/lineIndex.js";
import type { ResolvedDep } from "../../core/types.js";
import {
  jsonDepNames,
  jsonInner,
  jsonProp,
  jsonProps,
  jsonStringMap,
  parseJsonObject,
  resolveEntries,
  type LockEntry,
} from "./lockCommon.js";

const ROOT_GROUPS = ["dependencies", "devDependencies", "optionalDependencies"];
const DEP_GROUPS = ["dependencies", "optionalDependencies"];
const NM = "node_modules/";

/** Nearest-ancestor resolution: `a/node_modules/b` looks in `a/node_modules`, then the top level. */
function resolveFrom(path: string, dep: string, has: (p: string) => boolean): string | undefined {
  for (let base = path; ; ) {
    const candidate = base ? `${base}/${NM}${dep}` : `${NM}${dep}`;
    if (has(candidate)) return candidate;
    if (!base) return undefined;
    const i = base.lastIndexOf(`/${NM}`);
    base = i === -1 ? "" : base.slice(0, i);
  }
}

/** Parses package-lock.json (lockfileVersion 1, 2 and 3). Throws ParseError on invalid JSON. */
export function parsePackageLock(text: string): ResolvedDep[] {
  const root = parseJsonObject(text, "package-lock.json");
  const ix = new LineIndex(text);
  const versionRange = (n: Node) => ix.range(...jsonInner(n));

  const packages = jsonProp(root, "packages");
  if (packages) {
    const props = jsonProps(packages);
    const paths = new Set(props.map(([p]) => p));
    const rootDeps = jsonDepNames(jsonProp(packages, ""), ROOT_GROUPS);
    const entries: LockEntry[] = [];
    const direct: string[] = [];
    for (const [path, node] of props) {
      // Skips the root, workspace folders and anything not installed under node_modules.
      const at = path.lastIndexOf(NM);
      const version = jsonProp(node, "version");
      if (at === -1 || typeof version?.value !== "string") continue;
      if (jsonProp(node, "link")?.value === true) continue;
      const installedAs = path.slice(at + NM.length);
      const realName = jsonProp(node, "name")?.value;
      const edges: string[] = [];
      for (const group of DEP_GROUPS) {
        for (const [dep] of jsonStringMap(jsonProp(node, group))) {
          const target = resolveFrom(path, dep, (p) => paths.has(p));
          if (target) edges.push(target);
        }
      }
      entries.push({
        id: path,
        name: typeof realName === "string" ? realName : installedAs,
        version: version.value,
        range: versionRange(version),
        edges,
      });
      if (path === NM + installedAs && rootDeps.has(installedAs)) direct.push(path);
    }
    return resolveEntries(entries, direct);
  }

  // lockfileVersion 1: a recursive `dependencies` tree where `requires` names the edges.
  const found: Array<{ entry: LockEntry; requires: string[]; chain: Node[]; full: string[] }> = [];
  const walk = (tree: Node | undefined, chain: Node[], names: string[]): void => {
    for (const [name, node] of jsonProps(tree)) {
      const version = jsonProp(node, "version");
      if (typeof version?.value !== "string") continue;
      const full = [...names, name];
      const entry: LockEntry = {
        id: full.join("\0"),
        name,
        version: version.value,
        range: versionRange(version),
        edges: [],
      };
      const requires = jsonStringMap(jsonProp(node, "requires")).map(([dep]) => dep);
      found.push({ entry, requires, chain: [...chain, node], full });
      walk(jsonProp(node, "dependencies"), [...chain, node], full);
    }
  };
  // Each scope's `dependencies` names, built once so lookups stay constant-time.
  const names = new Map<Node, Set<string>>();
  const installed = (scope: Node | undefined): Set<string> => {
    let set = names.get(scope!);
    if (!set) names.set(scope!, (set = new Set(jsonProps(jsonProp(scope, "dependencies")).map(([k]) => k))));
    return set;
  };
  walk(jsonProp(root, "dependencies"), [], []);
  for (const { entry, requires, chain, full } of found) {
    for (const dep of requires) {
      // The nearest enclosing scope that installs `dep` wins, ending at the top level.
      for (let depth = chain.length; depth >= 0; depth--) {
        const scope = depth === 0 ? root : chain[depth - 1];
        if (installed(scope).has(dep)) {
          entry.edges.push([...full.slice(0, depth), dep].join("\0"));
          break;
        }
      }
    }
  }
  return resolveEntries(found.map((f) => f.entry));
}
