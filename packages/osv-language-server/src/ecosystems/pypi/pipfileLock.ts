import { LineIndex } from "../../core/lineIndex.js";
import type { ResolvedDep } from "../../core/types.js";
import { ParseError } from "../types.js";
import { jsonInner, jsonProp, jsonProps, parseJsonObject } from "../npm/lockCommon.js";
import { normalizePypiName } from "./names.js";

const GROUPS = ["default", "develop"];

/** Parses Pipfile.lock (`default` and `develop`). Unpinned entries (VCS, path) are skipped. Throws ParseError on invalid JSON. */
export function parsePipfileLock(text: string): ResolvedDep[] {
  const root = parseJsonObject(text, "Pipfile.lock");
  if (!GROUPS.some((g) => jsonProp(root, g))) throw new ParseError("Incomplete Pipfile.lock");
  const ix = new LineIndex(text);
  const deps: ResolvedDep[] = [];
  for (const group of GROUPS) {
    for (const [name, entry] of jsonProps(jsonProp(root, group))) {
      const node = jsonProp(entry, "version");
      if (typeof node?.value !== "string" || !node.value.startsWith("==")) continue;
      const [start, end] = jsonInner(node);
      deps.push({
        name: normalizePypiName(name),
        version: node.value.slice(2),
        range: ix.range(start + 2, end),
        direct: false,
      });
    }
  }
  return deps;
}
