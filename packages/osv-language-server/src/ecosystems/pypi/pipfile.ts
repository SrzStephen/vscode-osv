import type { DeclaredDep } from "../../core/types.js";
import { pep440LowerBound } from "./requirement.js";
import { parseTomlAst, tablesByKey } from "../../core/toml.js";
import { specTableDeps } from "./toml.js";

/** Parses `[packages]` and `[dev-packages]`. Throws ParseError on invalid TOML. */
export function parsePipfile(text: string): DeclaredDep[] {
  const tables = tablesByKey(parseTomlAst(text));
  return ["packages", "dev-packages"].flatMap((group) =>
    (tables.get(group) ?? []).flatMap((table) => specTableDeps(table, text, group, (spec) => pep440LowerBound(spec))),
  );
}
