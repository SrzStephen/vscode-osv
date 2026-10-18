import { LineIndex } from "../../core/lineIndex.js";
import type { DeclaredDep } from "../../core/types.js";
import { normalizePypiName } from "./names.js";
import { parseRequirement, pep440LowerBound } from "./requirement.js";
import { isString, keyName, parseTomlAst, plainContentRange, tablesByKey } from "../../core/toml.js";
import { specTableDeps } from "./toml.js";
import type { AST } from "toml-eslint-parser";

/** Lower bound of a Poetry constraint: `^X`, `~X` and a bare `X` floor at X, the rest follow PEP 440. */
export function poetryLowerBound(spec: string): string | undefined {
  if (spec.includes("||")) return undefined;
  const clauses = spec.split(",").map((c) => {
    const m = /^\s*(?:\^|~(?!=))?\s*(\d\S*)\s*$/.exec(c);
    return m ? `>=${m[1]}` : c;
  });
  return pep440LowerBound(clauses.join(","));
}

/** Dependencies from an array of PEP 508 strings; other elements (e.g. `{include-group}`) are skipped. */
function pep508Deps(array: AST.TOMLContentNode, text: string, ix: LineIndex, group: string): DeclaredDep[] {
  if (array.type !== "TOMLArray") return [];
  const deps: DeclaredDep[] = [];
  for (const el of array.elements) {
    if (!isString(el)) continue;
    const content = plainContentRange(text, el);
    const r = content && parseRequirement(el.value);
    if (!r) continue;
    const at = content[0];
    const lowerBound = r.spec === undefined ? undefined : pep440LowerBound(r.spec);
    deps.push({
      name: normalizePypiName(r.name),
      rawSpec: r.spec,
      nameRange: ix.range(at + r.nameStart, at + r.nameEnd),
      specRange: r.specStart === undefined ? undefined : ix.range(at + r.specStart, at + r.specEnd!),
      lowerBound,
      kind: r.kind === "registry" && lowerBound === undefined ? "unresolved" : r.kind,
      group,
    });
  }
  return deps;
}

/** Parses PEP 621/735, uv and Poetry dependencies. Throws ParseError on invalid TOML. */
export function parsePyproject(text: string): DeclaredDep[] {
  const tables = tablesByKey(parseTomlAst(text));
  const ix = new LineIndex(text);
  const deps: DeclaredDep[] = [];

  // Array-valued keys of a table are PEP 508 lists; `label` names the group of each key.
  const arrays = (tableKey: string, key: string | undefined, label: (k: string) => string) => {
    for (const table of tables.get(tableKey) ?? []) {
      for (const kv of table.body) {
        const k = keyName(kv);
        if (k !== undefined && (key === undefined || k === key)) deps.push(...pep508Deps(kv.value, text, ix, label(k)));
      }
    }
  };
  arrays("project", "dependencies", () => "dependencies");
  arrays("project.optional-dependencies", undefined, (k) => k);
  arrays("dependency-groups", undefined, (k) => k);
  arrays("tool.uv", "dev-dependencies", () => "uv-dev");

  const poetry = (tableKey: string, group: string) => {
    for (const table of tables.get(tableKey) ?? []) {
      deps.push(...specTableDeps(table, text, group, poetryLowerBound, (n) => n.toLowerCase() === "python"));
    }
  };
  poetry("tool.poetry.dependencies", "dependencies");
  poetry("tool.poetry.dev-dependencies", "dev");
  for (const key of tables.keys()) {
    const m = /^tool\.poetry\.group\.([^.]+)\.dependencies$/.exec(key);
    if (m) poetry(key, `group.${m[1]}`);
  }
  return deps;
}
