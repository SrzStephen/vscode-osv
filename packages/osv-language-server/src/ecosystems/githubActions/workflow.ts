import { isMap, isScalar, isSeq, parseDocument, type Node } from "yaml";
import { LineIndex } from "../../core/lineIndex.js";
import type { DeclaredDep } from "../../core/types.js";
import { ParseError } from "../types.js";

// Only tag-like refs are checked. SHAs and branch names never reach the comparator, which would
// coerce a hex SHA to a bogus version.
const TAG_REF = /^v?\d+(\.\d+){0,2}$/;
const ACTION = /^([\w.-]+\/[\w.-]+)(?:\/[^@]*)?$/;

/**
 * Parses `uses: owner/repo[/path]@ref` from workflows (job steps and reusable-workflow jobs) and
 * composite actions. Local, docker, SHA- and branch-pinned uses are skipped. Throws ParseError on invalid YAML.
 */
export function parseWorkflow(text: string): DeclaredDep[] {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) throw new ParseError("Invalid YAML");
  const ix = new LineIndex(text);
  const deps: DeclaredDep[] = [];

  const collect = (node: unknown, group: string): void => {
    if (!isScalar(node) || typeof node.value !== "string" || !node.range) return;
    const value = node.value;
    const at = value.lastIndexOf("@");
    if (at < 1 || value.startsWith("./") || value.startsWith("docker://")) return;
    const ref = value.slice(at + 1);
    const name = ACTION.exec(value.slice(0, at))?.[1];
    if (!name || !TAG_REF.test(ref)) return;
    // The scalar's source may be quoted or escaped; anchor on the literal text inside it.
    const [start, end] = node.range;
    const source = text.slice(start, end);
    const refAt = source.lastIndexOf(`@${ref}`) + 1;
    const nameAt = source.indexOf(name);
    if (refAt < 1 || nameAt < 0) return;
    deps.push({
      name,
      rawSpec: ref,
      nameRange: ix.range(start + nameAt, start + nameAt + name.length),
      specRange: ix.range(start + refAt, start + refAt + ref.length),
      lowerBound: ref.replace(/^v/, ""),
      kind: "registry",
      group,
    });
  };

  const collectSteps = (steps: Node | null | undefined, group: string): void => {
    if (!isSeq(steps)) return;
    for (const step of steps.items) if (isMap(step)) collect(step.get("uses", true), group);
  };

  const root = doc.contents;
  if (!isMap(root)) return deps;
  const jobs = root.get("jobs", true);
  if (isMap(jobs)) {
    for (const job of jobs.items) {
      if (!isMap(job.value)) continue;
      const group = String(isScalar(job.key) ? job.key.value : job.key);
      collect(job.value.get("uses", true), group);
      collectSteps(job.value.get("steps", true) as Node | undefined, group);
    }
  }
  const runs = root.get("runs", true);
  if (isMap(runs)) collectSteps(runs.get("steps", true) as Node | undefined, "composite");
  return deps;
}
