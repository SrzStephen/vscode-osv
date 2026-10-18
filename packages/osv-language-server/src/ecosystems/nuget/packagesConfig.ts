import { LineIndex } from "../../core/lineIndex.js";
import { parseXml } from "../../core/xml.js";
import type { DeclaredDep } from "../../core/types.js";
import { nugetLowerBound } from "./range.js";

/** `<package id version>` entries of a packages.config. Throws ParseError on invalid XML. */
export function parsePackagesConfig(text: string): DeclaredDep[] {
  const root = parseXml(text);
  const ix = new LineIndex(text);
  const deps: DeclaredDep[] = [];
  for (const el of root.children) {
    const id = el.attrs.get("id");
    if (el.name !== "package" || !id || id.value.trim() === "") continue;
    const version = el.attrs.get("version");
    const base = { name: id.value.trim(), nameRange: ix.range(id.valueStart, id.valueEnd), group: "packages" };
    if (!version || version.value.trim() === "") {
      deps.push({ ...base, kind: "unresolved" });
      continue;
    }
    const rawSpec = version.value.trim();
    const lowerBound = nugetLowerBound(rawSpec);
    deps.push({
      ...base,
      rawSpec,
      specRange: ix.range(version.valueStart, version.valueEnd),
      lowerBound,
      kind: lowerBound === undefined ? "unresolved" : "registry",
    });
  }
  return deps;
}
