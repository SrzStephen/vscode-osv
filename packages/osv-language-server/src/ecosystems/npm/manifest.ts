import { parseTree, type Node, type ParseError as JsonError } from "jsonc-parser";
import semver from "semver";
import { LineIndex } from "../../core/lineIndex.js";
import type { DeclaredDep, DepKind } from "../../core/types.js";
import { ParseError } from "../types.js";

const GROUPS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

const PATH_RE = /^(file|link|workspace):/;
const GIT_RE = /^(git\+|git:|github:|gitlab:|bitbucket:|gist:)|\.git(#.*)?$|^[\w.-]+\/[\w.-]+(#.*)?$/;
const URL_RE = /^https?:/;
const UNRESOLVED_RE = /^(\*|latest|x)?$/i;

/** Lowest version a spec admits; undefined for unsatisfiable specs, tags and open-ended `<` ranges. */
function lowerBound(spec: string): string | undefined {
  try {
    const min = semver.minVersion(spec, { loose: true })?.version;
    // "<2.0.0" has no meaningful floor, so 0.0.0 only counts when it was written.
    return min === "0.0.0" && spec.trim() !== "0.0.0" ? undefined : min;
  } catch {
    return undefined;
  }
}

/** Parses package.json dependency groups. Throws ParseError on invalid JSON. */
export function parseNpmManifest(text: string): DeclaredDep[] {
  const errors: JsonError[] = [];
  // The parser rejects a BOM; a space in its place keeps every offset unchanged.
  const root = parseTree(text.replace(/^﻿/, " "), errors);
  if (errors.length > 0 || root?.type !== "object") throw new ParseError("Invalid package.json");

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
      const raw = value.value as string;
      let name = key.value as string;
      let rawSpec = raw;
      let specRange = inner(value);
      let kind: DepKind;

      if (PATH_RE.test(raw)) kind = "path";
      else if (GIT_RE.test(raw)) kind = "git";
      else if (URL_RE.test(raw)) kind = "url";
      else {
        if (raw.startsWith("npm:")) {
          // npm:<name>@<spec> alias; the spec follows the last "@" (a scope's "@" is not one).
          const at = raw.lastIndexOf("@");
          if (at > 4) {
            name = raw.slice(4, at);
            rawSpec = raw.slice(at + 1);
            specRange = ix.range(value.offset + 1 + at + 1, value.offset + value.length - 1);
          } else {
            name = raw.slice(4);
            rawSpec = "";
          }
        }
        kind = UNRESOLVED_RE.test(rawSpec.trim()) ? "unresolved" : "registry";
      }

      const lb = kind === "registry" ? lowerBound(rawSpec) : undefined;
      if (kind === "registry" && lb === undefined) kind = "unresolved";

      deps.push({
        name,
        rawSpec,
        nameRange: inner(key),
        specRange,
        lowerBound: lb,
        kind,
        group: groupKey!.value as string,
      });
    }
  }
  return deps;
}
