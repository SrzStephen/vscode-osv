import type { ResolvedDep } from "../../core/types.js";
import { findKey } from "./toml.js";
import { inlineTable, lockPackages, resolveGraph } from "./tomlLock.js";

/** Parses pylock.toml (PEP 751). Direct deps are those of an editable directory package, if any. Throws ParseError on invalid TOML. */
export function parsePylock(text: string): ResolvedDep[] {
  return resolveGraph(lockPackages(text, "packages"), text, (p) => {
    const editable = findKey(inlineTable(p.table, "directory"), "editable")?.value;
    return editable?.type === "TOMLValue" && editable.kind === "boolean" && editable.value;
  });
}
