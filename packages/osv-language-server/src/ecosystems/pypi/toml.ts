import { ParseError as TomlError, parseTOML, type AST } from "toml-eslint-parser";
import { LineIndex } from "../../core/lineIndex.js";
import type { DeclaredDep, DepKind } from "../../core/types.js";
import { ParseError } from "../types.js";
import { normalizePypiName } from "./names.js";

type TOMLTable = AST.TOMLTable;
type TOMLKeyValue = AST.TOMLKeyValue;
type TOMLContentNode = AST.TOMLContentNode;
type TOMLStringValue = AST.TOMLStringValue;

/** Parses TOML. Throws ParseError on invalid syntax. */
export function parseTomlAst(text: string): AST.TOMLProgram {
  try {
    return parseTOML(text);
  } catch (e) {
    if (e instanceof TomlError) throw new ParseError(`Invalid TOML: ${e.message}`);
    throw e;
  }
}

/** Offsets of a string's content, without its quotes. */
export function stringContentRange(node: TOMLStringValue | AST.TOMLQuoted): [number, number] {
  const quote = "multiline" in node && node.multiline ? 3 : 1;
  return [node.range[0] + quote, node.range[1] - quote];
}

/** Top-level tables keyed by their dotted resolved key, e.g. "tool.poetry.dependencies". */
export function tablesByKey(ast: AST.TOMLProgram): Map<string, TOMLTable[]> {
  const tables = new Map<string, TOMLTable[]>();
  for (const node of ast.body[0].body) {
    if (node.type !== "TOMLTable") continue;
    const key = node.resolvedKey.join(".");
    tables.set(key, [...(tables.get(key) ?? []), node]);
  }
  return tables;
}

/** The name of a key-value with a single, undotted key. */
export function keyName(kv: TOMLKeyValue): string | undefined {
  const [first, ...rest] = kv.key.keys;
  if (!first || rest.length > 0) return undefined;
  return first.type === "TOMLBare" ? first.name : first.value;
}

/** The key-value named `name` in a table body, if any. */
export function findKey(body: TOMLKeyValue[], name: string): TOMLKeyValue | undefined {
  return body.find((kv) => keyName(kv) === name);
}

export function isString(node: TOMLContentNode | undefined): node is TOMLStringValue {
  return node?.type === "TOMLValue" && node.kind === "string";
}

/** Offsets of a string's content, or undefined when escapes make the source differ from its value. */
export function plainContentRange(text: string, node: TOMLStringValue): [number, number] | undefined {
  const range = stringContentRange(node);
  return text.slice(...range) === node.value ? range : undefined;
}

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
