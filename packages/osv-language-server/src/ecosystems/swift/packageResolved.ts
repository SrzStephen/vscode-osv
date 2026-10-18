import { LineIndex } from "../../core/lineIndex.js";
import type { ResolvedDep } from "../../core/types.js";
import { jsonInner, jsonProp, parseJsonObject } from "../npm/lockCommon.js";
import { normalizeSwiftUrl } from "./url.js";

/**
 * Parses Package.resolved: v1 keeps `object.pins[]` with `repositoryURL`, v2 and v3 keep `pins[]` with
 * `location`. Pins without a `state.version` (branch or revision pins) are skipped. The file does not
 * record direct dependencies, so `direct` is false throughout; the scanner marks them from Package.swift.
 */
export function parsePackageResolved(text: string): ResolvedDep[] {
  const root = parseJsonObject(text, "Package.resolved");
  const ix = new LineIndex(text);
  const out: ResolvedDep[] = [];
  const pins = jsonProp(root, "pins") ?? jsonProp(jsonProp(root, "object"), "pins");
  for (const pin of pins?.type === "array" ? (pins.children ?? []) : []) {
    const location = jsonProp(pin, "location") ?? jsonProp(pin, "repositoryURL");
    const version = jsonProp(jsonProp(pin, "state"), "version");
    if (typeof location?.value !== "string" || typeof version?.value !== "string") continue;
    const name = normalizeSwiftUrl(location.value);
    if (name === undefined) continue;
    out.push({ name, version: version.value, range: ix.range(...jsonInner(version)), direct: false });
  }
  return out;
}
