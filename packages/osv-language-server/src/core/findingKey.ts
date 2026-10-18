import type { Finding } from "./types.js";

export function findingKey(f: Pick<Finding, "source" | "ecosystem" | "name" | "current" | "range">): string {
  return `${f.source}:${f.ecosystem}:${f.name}@${f.current}:${f.range.start.line}:${f.range.start.character}`;
}
