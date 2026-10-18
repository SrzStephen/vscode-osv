import type { ResolvedDep } from "../../core/types.js";
import { findKey, isString } from "../../core/toml.js";
import { lockPackages, resolveUnrooted } from "./tomlLock.js";

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*/;

/** Parses pdm.lock. PDM does not record direct deps (the scanner reads them from the manifest). Throws ParseError on invalid TOML. */
export function parsePdmLock(text: string): ResolvedDep[] {
  return resolveUnrooted(lockPackages(text, "package"), text, (p) => {
    const list = findKey(p.table.body, "dependencies")?.value;
    if (list?.type !== "TOMLArray") return [];
    return list.elements.flatMap((el) => (isString(el) ? (NAME_RE.exec(el.value)?.[0] ?? []) : []));
  });
}
