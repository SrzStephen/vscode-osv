import { LineIndex } from "../../core/lineIndex.js";
import type { DeclaredDep, DepKind } from "../../core/types.js";
import {
  findKey, isString, keyName, plainContentRange, stringContentRange,
  type TOMLStringValue, type TOMLTable,
} from "../../core/toml.js";
import { normalizePypiName } from "./names.js";

const SOURCE_KINDS: [string, DepKind][] = [["git", "git"], ["path", "path"], ["url", "url"]];

/**
 * Dependencies from `name = "spec"` and `name = {version = "spec", git = ...}` entries.
 * `lowerBoundOf` derives the floor from a spec; `*` and floorless specs become unresolved.
 */
export function specTableDeps(
  table: TOMLTable,
  text: string,
  group: string,
  lowerBoundOf: (spec: string) => string | undefined,
  skip: (name: string) => boolean = () => false,
): DeclaredDep[] {
  const ix = new LineIndex(text);
  const deps: DeclaredDep[] = [];
  for (const kv of table.body) {
    const rawName = keyName(kv);
    if (rawName === undefined || skip(rawName)) continue;
    const [keyNode] = kv.key.keys;
    const nameRange = keyNode!.type === "TOMLQuoted" ? stringContentRange(keyNode!) : keyNode!.range;

    let specNode: TOMLStringValue | undefined;
    let kind: DepKind = "registry";
    if (isString(kv.value)) {
      specNode = kv.value;
    } else if (kv.value.type === "TOMLInlineTable") {
      const { body } = kv.value;
      const version = findKey(body, "version")?.value;
      if (isString(version)) specNode = version;
      kind = SOURCE_KINDS.find(([key]) => findKey(body, key))?.[1] ?? kind;
    } else {
      continue;
    }

    const specRange = specNode && plainContentRange(text, specNode);
    const rawSpec = specRange && specNode!.value;
    const lowerBound = rawSpec === undefined ? undefined : lowerBoundOf(rawSpec);
    deps.push({
      name: normalizePypiName(rawName),
      rawSpec,
      nameRange: ix.range(...nameRange),
      specRange: specRange && ix.range(...specRange),
      lowerBound,
      kind: kind === "registry" && lowerBound === undefined ? "unresolved" : kind,
      group,
    });
  }
  return deps;
}
