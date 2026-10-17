import { LineIndex } from "../../core/lineIndex.js";
import type { ResolvedDep } from "../../core/types.js";
import {
  jsonDepNames,
  jsonProp,
  jsonProps,
  jsonStringMap,
  parseJsonObject,
  resolveEntries,
  type LockEntry,
} from "./lockCommon.js";

const ROOT_GROUPS = ["dependencies", "devDependencies", "optionalDependencies"];
const DEP_GROUPS = ["dependencies", "optionalDependencies"];
// Last path segment of a nested key such as `a/b` or `a/@scope/b`.
const LAST_SEGMENT = /(?:^|\/)(@[^/]+\/[^/]+|[^/]+)$/;

/** Parses bun.lock (JSONC with trailing commas). Throws ParseError on invalid syntax. */
export function parseBunLock(text: string): ResolvedDep[] {
  const root = parseJsonObject(text, "bun.lock", true);
  const ix = new LineIndex(text);
  const props = jsonProps(jsonProp(root, "packages"));
  const keys = new Set(props.map(([k]) => k));
  const rootDeps = jsonDepNames(jsonProp(jsonProp(root, "workspaces"), ""), ROOT_GROUPS);

  const entries: LockEntry[] = [];
  const direct: string[] = [];
  for (const [key, node] of props) {
    const [ident, , meta] = node.type === "array" ? (node.children ?? []) : [];
    if (typeof ident?.value !== "string") continue;
    const at = ident.value.lastIndexOf("@");
    const version = ident.value.slice(at + 1);
    // Skips workspace, git, file and aliased packages: only registry versions are checkable.
    if (at < 1 || !/^\d/.test(version)) continue;
    const edges: string[] = [];
    for (const group of DEP_GROUPS) {
      for (const [dep] of jsonStringMap(jsonProp(meta, group))) {
        // Nested keys shadow their parent's: `a/b` is looked up from `a/b/dep` up to `dep`.
        for (let scope = key; ; ) {
          const candidate = scope ? `${scope}/${dep}` : dep;
          if (keys.has(candidate)) {
            edges.push(candidate);
            break;
          }
          if (!scope) break;
          scope = scope.slice(0, LAST_SEGMENT.exec(scope)!.index);
        }
      }
    }
    const end = ident.offset + ident.length - 1;
    entries.push({ id: key, name: ident.value.slice(0, at), version, range: ix.range(end - version.length, end), edges });
    if (rootDeps.has(key)) direct.push(key);
  }
  return resolveEntries(entries, direct);
}
