import { parseTree, type Node, type ParseError as JsonError } from "jsonc-parser";
import { LineIndex } from "../../core/lineIndex.js";
import type { DeclaredDep, DepKind } from "../../core/types.js";
import { ParseError } from "../types.js";
import { composerLowerBound } from "./constraint.js";

const GROUPS = ["require", "require-dev"];

// Requirements on the runtime, not on packages: `php`, `ext-json`, `composer-runtime-api` and the like.
const PLATFORM_RE = /^(php(-.*)?|hhvm|ext-.*|lib-.*|composer|composer-plugin-api|composer-runtime-api)$/i;
const DEV_RE = /^dev-|-dev$/i;
const UNRESOLVED_RE = /^(\*|latest|x)?$/i;

/** Parses composer.json `require` and `require-dev`. Throws ParseError on invalid JSON. */
export function parseComposerJson(text: string): DeclaredDep[] {
  const errors: JsonError[] = [];
  // The parser rejects a BOM; a space in its place keeps every offset unchanged.
  const root = parseTree(text.replace(/^﻿/, " "), errors);
  if (errors.length > 0 || root?.type !== "object") throw new ParseError("Invalid composer.json");

  const ix = new LineIndex(text);
  // Ranges cover the string content, without the quotes.
  const inner = (n: Node) => ix.range(n.offset + 1, n.offset + n.length - 1);
  const deps: DeclaredDep[] = [];

  for (const group of root.children ?? []) {
    const [groupKey, groupValue] = group.children ?? [];
    if (groupValue?.type !== "object" || !GROUPS.includes(groupKey?.value as string)) continue;

    for (const prop of groupValue.children ?? []) {
      const [key, value] = prop.children ?? [];
      if (!key || value?.type !== "string") continue;
      const rawName = key.value as string;
      if (PLATFORM_RE.test(rawName)) continue;
      const rawSpec = value.value as string;

      let kind: DepKind = "registry";
      let lowerBound: string | undefined;
      if (DEV_RE.test(rawSpec.trim())) kind = "git";
      else if (UNRESOLVED_RE.test(rawSpec.trim())) kind = "unresolved";
      else {
        lowerBound = composerLowerBound(rawSpec);
        if (lowerBound === undefined) kind = "unresolved";
      }

      deps.push({
        name: rawName.toLowerCase(),
        rawSpec,
        nameRange: inner(key),
        specRange: inner(value),
        lowerBound,
        kind,
        group: groupKey!.value as string,
      });
    }
  }
  return deps;
}
