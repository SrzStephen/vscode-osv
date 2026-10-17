import { parseTree, type Node, type ParseError as JsonError } from "jsonc-parser";
import { computeVia } from "../../core/graph.js";
import type { ResolvedDep, TextRange } from "../../core/types.js";
import { ParseError } from "../types.js";

/** A lockfile entry before `direct` and `via` are known; `edges` hold ids of other entries. */
export interface LockEntry {
  id: string;
  name: string;
  version: string;
  range: TextRange;
  requestedSpecs?: string[];
  edges: string[];
}

/**
 * Finishes parsed entries. When the lockfile does not record its direct dependencies
 * (`direct` omitted), entries nothing else depends on count as direct.
 */
export function resolveEntries(entries: LockEntry[], direct?: Iterable<string>): ResolvedDep[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const edges = new Map<string, string[]>();
  const referenced = new Set<string>();
  for (const e of entries) {
    const targets = e.edges.filter((t) => byId.has(t));
    edges.set(e.id, targets);
    for (const t of targets) if (t !== e.id) referenced.add(t);
  }
  const directIds = new Set(direct ?? entries.filter((e) => !referenced.has(e.id)).map((e) => e.id));
  const via = computeVia(directIds, edges);
  return entries.map((e) => {
    const dep: ResolvedDep = {
      name: e.name,
      version: e.version,
      range: e.range,
      direct: directIds.has(e.id),
    };
    const path = via.get(e.id);
    if (path) dep.via = path.map((id) => byId.get(id)!.name);
    if (e.requestedSpecs) dep.requestedSpecs = e.requestedSpecs;
    return dep;
  });
}

/** Parses a JSON(C) lockfile into an object node. Throws ParseError on invalid syntax. */
export function parseJsonObject(text: string, what: string, allowTrailingComma = false): Node {
  const errors: JsonError[] = [];
  // The parser rejects a BOM; a space in its place keeps every offset unchanged.
  const root = parseTree(text.replace(/^﻿/, " "), errors, { allowTrailingComma });
  if (errors.length > 0 || root?.type !== "object") throw new ParseError(`Invalid ${what}`);
  return root;
}

export function jsonProps(node: Node | undefined): Array<[string, Node]> {
  if (node?.type !== "object") return [];
  const out: Array<[string, Node]> = [];
  for (const p of node.children ?? []) {
    const [k, v] = p.children ?? [];
    if (k && v) out.push([k.value as string, v]);
  }
  return out;
}

export function jsonProp(node: Node | undefined, key: string): Node | undefined {
  return jsonProps(node).find(([k]) => k === key)?.[1];
}

/** Property names across the given groups of a manifest-like object node. */
export function jsonDepNames(node: Node | undefined, groups: string[]): Set<string> {
  return new Set(groups.flatMap((g) => jsonProps(jsonProp(node, g)).map(([k]) => k)));
}

/** String-valued properties of an object node, e.g. a `dependencies` map. */
export function jsonStringMap(node: Node | undefined): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [k, v] of jsonProps(node)) if (typeof v.value === "string") out.push([k, v.value]);
  return out;
}

/** The content of a JSON string node, without its quotes. */
export function jsonInner(node: Node): [number, number] {
  return [node.offset + 1, node.offset + node.length - 1];
}

/** One `key: value` line of an indentation-structured lockfile, with the lines nested under it. */
export interface YamlNode {
  key: string;
  /** Offset of the key's content, inside any quotes. */
  keyStart: number;
  value: string;
  /** Offset of the value's content, inside any quotes. */
  valueStart: number;
  children: YamlNode[];
}

const QUOTES = ['"', "'"];

function readKeyLine(body: string, base: number, what: string): YamlNode {
  const invalid = () => new ParseError(`Invalid ${what}`);
  let key: string;
  let keyStart = base;
  let rest: string;
  if (QUOTES.includes(body[0]!)) {
    const close = body.indexOf(body[0]!, 1);
    if (close === -1 || body[close + 1] !== ":") throw invalid();
    key = body.slice(1, close);
    keyStart++;
    rest = body.slice(close + 2);
  } else {
    const m = /^(.*?):(?: |$)/.exec(body);
    if (!m) throw invalid();
    key = m[1]!;
    rest = body.slice(m[0].length);
  }
  let value = rest.trim();
  let valueStart = base + body.length - rest.length + (rest.length - rest.trimStart().length);
  if (QUOTES.includes(value[0] ?? "")) {
    if (value.length < 2 || !value.endsWith(value[0]!)) throw invalid();
    value = value.slice(1, -1);
    valueStart++;
  } else if ((value[0] === "{" && !value.endsWith("}")) || (value[0] === "[" && !value.endsWith("]"))) {
    throw invalid();
  }
  return { key, keyStart, value, valueStart, children: [] };
}

/**
 * Reads the `key: value` tree of a YAML lockfile (yarn berry, pnpm) line by line; the full YAML
 * parser is several times too slow for lockfiles of thousands of entries. Flow values stay raw
 * strings and block sequence items are skipped. Throws ParseError on a line it cannot read.
 */
export function readYamlTree(text: string, what: string): YamlNode[] {
  const top: YamlNode[] = [];
  const stack: Array<{ indent: number; node: YamlNode }> = [];
  for (let pos = 0; pos < text.length; ) {
    const eol = text.indexOf("\n", pos);
    const end = eol === -1 ? text.length : eol;
    const line = text.slice(pos, end).replace(/\r$/, "");
    const lineStart = pos;
    pos = end + 1;
    const body = line.trimStart();
    if (body === "" || body[0] === "#" || body[0] === "-") continue;
    const indent = line.length - body.length;
    const node = readKeyLine(body, lineStart + indent, what);
    while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) stack.pop();
    (stack.length > 0 ? stack[stack.length - 1]!.node.children : top).push(node);
    stack.push({ indent, node });
  }
  return top;
}

export function yamlChild(node: YamlNode | undefined, key: string): YamlNode | undefined {
  return node?.children.find((c) => c.key === key);
}

