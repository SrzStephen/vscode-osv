import { LineIndex } from "../../core/lineIndex.js";
import type { ResolvedDep } from "../../core/types.js";
import { jsonInner, jsonProp, jsonStringMap, parseJsonObject, resolveEntries, type LockEntry } from "../npm/lockCommon.js";

/**
 * Parses composer.lock `packages` and `packages-dev`. A `v` prefix stays in `version` so the range covers the
 * text as written; `dev-*` versions are branches, not releases, and are skipped. No entry is reported direct
 * (the scanner marks them from composer.json); `via` runs from the entries nothing else requires.
 */
export function parseComposerLock(text: string): ResolvedDep[] {
  const root = parseJsonObject(text, "composer.lock");
  const ix = new LineIndex(text);
  const entries: LockEntry[] = [];
  const requires: string[][] = [];

  for (const group of ["packages", "packages-dev"]) {
    for (const pkg of jsonProp(root, group)?.children ?? []) {
      const name = jsonProp(pkg, "name");
      const version = jsonProp(pkg, "version");
      if (typeof name?.value !== "string" || typeof version?.value !== "string") continue;
      if (/^dev-/i.test(version.value)) continue;
      const id = name.value.toLowerCase();
      entries.push({ id, name: id, version: version.value, range: ix.range(...jsonInner(version)), edges: [] });
      requires.push(jsonStringMap(jsonProp(pkg, "require")).map(([dep]) => dep.toLowerCase()));
    }
  }
  // Platform requirements (`php`, `ext-*`) name no entry and drop out in resolveEntries.
  entries.forEach((e, i) => (e.edges = requires[i]!));
  return resolveEntries(entries).map((d) => ({ ...d, direct: false }));
}
