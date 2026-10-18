import { compare, valid } from "@renovatebot/pep440";
import type { DepKind } from "../../core/types.js";

export interface ParsedRequirement {
  name: string;
  nameStart: number;
  nameEnd: number;
  spec?: string;
  specStart?: number;
  specEnd?: number;
  kind: DepKind;
}

const NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?/;

/** Parses one PEP 508 requirement (name, extras, specifiers, markers, direct references). Offsets are relative to `s`. */
export function parseRequirement(s: string): ParsedRequirement | undefined {
  const nameStart = /^\s*/.exec(s)![0].length;
  const nameMatch = NAME_RE.exec(s.slice(nameStart));
  if (!nameMatch) return undefined;
  const name = nameMatch[0];
  const nameEnd = nameStart + name.length;
  const base = { name, nameStart, nameEnd };

  let pos = nameEnd;
  const skipSpace = () => {
    while (/\s/.test(s[pos] ?? "")) pos++;
  };
  skipSpace();
  if (s[pos] === "[") {
    const close = s.indexOf("]", pos);
    if (close < 0) return undefined;
    pos = close + 1;
    skipSpace();
  }

  if (s[pos] === "@") {
    pos++;
    skipSpace();
    // In a URL requirement a marker is only recognised after whitespace.
    const url = s.slice(pos).split(/\s;/)[0]!.trim();
    if (!url) return undefined;
    const kind: DepKind = url.startsWith("git+") ? "git" : url.startsWith("file:") ? "path" : "url";
    return { ...base, kind };
  }

  const semi = s.indexOf(";", pos);
  const end = semi < 0 ? s.length : semi;
  let specStart = pos;
  let specEnd = pos + s.slice(pos, end).trimEnd().length;
  if (specStart === specEnd) return { ...base, kind: "registry" };
  if (s[specStart] === "(" && s[specEnd - 1] === ")") {
    specStart++;
    specEnd--;
  }
  const spec = s.slice(specStart, specEnd).trim();
  if (!/^[=<>!~]/.test(spec)) return undefined;
  // Re-anchor on the trimmed text so the offsets cover exactly the spec.
  specStart += s.slice(specStart, specEnd).indexOf(spec);
  return { ...base, spec, specStart, specEnd: specStart + spec.length, kind: "registry" };
}

const CLAUSE_RE = /^\s*(===|==|~=|>=|<=|!=|>|<)\s*(\S+?)\s*$/;

export interface Clause {
  op: string;
  version: string;
  /** Clause text exactly as written, including surrounding whitespace. */
  text: string;
}

export function parseClauses(spec: string): Clause[] {
  return spec.split(",").map((text) => {
    const m = CLAUSE_RE.exec(text);
    return { op: m?.[1] ?? "", version: m?.[2] ?? "", text };
  });
}

/** The version a clause sets as a floor, or undefined if it sets none. */
export function clauseFloor(c: Clause): string | undefined {
  const v = c.op === "==" ? c.version.replace(/\.\*$/, "") : c.version;
  if (!["==", "===", ">=", "~="].includes(c.op) || valid(v) === null) return undefined;
  return v;
}

/** The highest version that `==`, `===`, `>=` and `~=` clauses require; undefined without one. */
export function pep440LowerBound(spec: string): string | undefined {
  let best: string | undefined;
  for (const c of parseClauses(spec)) {
    const v = clauseFloor(c);
    if (v !== undefined && (best === undefined || compare(v, best) > 0)) best = v;
  }
  return best;
}
