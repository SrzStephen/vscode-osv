import type { ResolvedDep } from "../../core/types.js";
import { findKey } from "./toml.js";
import { inlineTable, lockPackages, resolveGraph } from "./tomlLock.js";

/** Parses uv.lock. Direct deps are those of the project's virtual or editable package. Throws ParseError on invalid TOML. */
export function parseUvLock(text: string): ResolvedDep[] {
  return resolveGraph(lockPackages(text, "package"), text, (p) => {
    const source = inlineTable(p.table, "source");
    return Boolean(findKey(source, "virtual") ?? findKey(source, "editable"));
  });
}
