import { composerComparator } from "../../versioning/composer.js";
import type { RewriteResult } from "../types.js";

const cmp = (a: string, b: string): number => composerComparator.compare(a, b);

const TOKEN = /([^\s,]+)\s+-\s+([^\s,]+)|\s*(>=|<=|!=|<>|>|<|==|=|\^|~)?(\s*)([^\s,]+)/g;
const WILDCARD = /^(\d+(?:\.\d+)*)(?:\.[*xX])+$/;
const NUMERIC = /^\d+(?:\.\d+)*$/;

type Kind = "any" | "wild" | "ver" | "hyphen" | "opaque";

interface Clause {
  kind: Kind;
  text: string;
  op: string;
  gap: string;
  /** Version text without a leading `v` or stability flag; for hyphen ranges, the low end. */
  version: string;
  flag: string;
  /** Fixed numeric parts of a wildcard. */
  prefix: number[];
  /** High end of a hyphen range. */
  high: string;
}

interface Group {
  text: string;
  clauses: Clause[];
  comma: boolean;
}

const nums = (v: string): number[] => ((/^\d+(?:\.\d+)*/.exec(v) ?? [""])[0].split(".").filter(Boolean).map(Number));

function splitFlag(operand: string): { body: string; flag: string } {
  const i = operand.indexOf("@");
  return i === -1 ? { body: operand, flag: "" } : { body: operand.slice(0, i), flag: operand.slice(i) };
}

function classify(operand: string): Pick<Clause, "kind" | "version" | "flag" | "prefix"> {
  const { body, flag } = splitFlag(operand);
  const bare = body.replace(/^v(?=\d)/i, "");
  if (bare === "*" || /^[xX]$/.test(bare)) return { kind: "any", version: "", flag, prefix: [] };
  const w = WILDCARD.exec(bare);
  if (w) return { kind: "wild", version: "", flag, prefix: nums(w[1] ?? "") };
  if (composerComparator.isValid(bare)) return { kind: "ver", version: bare, flag, prefix: [] };
  return { kind: "opaque", version: "", flag, prefix: [] };
}

function parseGroup(text: string): Group {
  const cleaned = text.replace(/\s+as\s+\S+/g, "");
  const clauses: Clause[] = [];
  for (const m of cleaned.matchAll(TOKEN)) {
    if (m[1] !== undefined && m[2] !== undefined) {
      const low = classify(m[1]);
      const high = splitFlag(m[2]).body.replace(/^v(?=\d)/i, "");
      const ok = low.kind === "ver" && composerComparator.isValid(high);
      clauses.push({ ...low, kind: ok ? "hyphen" : "opaque", text: m[0], op: "", gap: "", high });
      continue;
    }
    const op = m[3] === "<>" ? "!=" : m[3] === "==" ? "=" : (m[3] ?? "");
    const c = classify(m[5] ?? "");
    const kind = c.kind !== "ver" && c.kind !== "any" && c.kind !== "wild" ? "opaque" : c.kind;
    clauses.push({ ...c, kind, text: m[0].trim(), op, gap: m[4] ?? "", high: "" });
  }
  return { text, clauses, comma: cleaned.includes(",") };
}

function parseGroups(raw: string): { groups: Group[]; sep: string } {
  const sep = /\s*\|\|?\s*/.exec(raw)?.[0] ?? "";
  return { groups: raw.split(/\|\|?/).map((g) => parseGroup(g.trim())), sep };
}

/** Lower bound of one clause, if it has one. */
function clauseLower(c: Clause): string | undefined {
  switch (c.kind) {
    case "hyphen":
      return c.version;
    case "wild": {
      const parts = [...c.prefix];
      return (parts.length ? parts : [0]).join(".") + ".0";
    }
    case "ver":
      return c.op === "" || c.op === "=" || c.op === "^" || c.op === "~" || c.op === ">=" || c.op === ">"
        ? c.version
        : undefined;
    default:
      return undefined;
  }
}

/** Highest lower bound among a group's AND-ed clauses. */
function groupLower(g: Group): string | undefined {
  let best: string | undefined;
  for (const c of g.clauses) {
    const lb = clauseLower(c);
    if (lb !== undefined && (best === undefined || cmp(lb, best) > 0)) best = lb;
  }
  return best;
}

const isOpaque = (g: Group): boolean => g.clauses.every((c) => c.kind === "opaque");

export function composerLowerBound(constraint: string): string | undefined {
  let lowest: string | undefined;
  for (const g of parseGroups(constraint).groups) {
    if (isOpaque(g)) continue;
    const lb = groupLower(g);
    if (lb === undefined) return undefined;
    if (lowest === undefined || cmp(lb, lowest) < 0) lowest = lb;
  }
  return lowest;
}

function bump(parts: number[], index: number): string {
  return [...parts.slice(0, index), (parts[index] ?? 0) + 1].join(".");
}

/** First version the pessimistic operator excludes. */
function upperOf(op: "^" | "~", parts: number[]): string {
  if (op === "~") return parts.length <= 1 ? bump(parts, 0) : bump(parts, parts.length - 2);
  const first = parts.findIndex((p) => p !== 0);
  return bump(parts, first === -1 ? parts.length - 1 : first);
}

/** Exclusive or inclusive upper end of a hyphen range: a partial high end covers its whole series. */
function hyphenHigh(high: string): { version: string; inclusive: boolean } {
  if (NUMERIC.test(high) && high.split(".").length <= 2) {
    const parts = nums(high);
    return { version: bump(parts, parts.length - 1), inclusive: false };
  }
  return { version: high, inclusive: true };
}

/** True when the clause only admits versions below `target`. */
function belowTarget(c: Clause, target: string): boolean {
  switch (c.kind) {
    case "wild":
      return cmp(target, bump(c.prefix, c.prefix.length - 1)) >= 0;
    case "hyphen": {
      const h = hyphenHigh(c.high);
      return h.inclusive ? cmp(target, h.version) > 0 : cmp(target, h.version) >= 0;
    }
    case "ver":
      switch (c.op) {
        case "^":
        case "~":
          return cmp(target, upperOf(c.op, nums(c.version))) >= 0;
        case "":
        case "=":
        case "<=":
          return cmp(target, c.version) > 0;
        case "<":
          return cmp(target, c.version) >= 0;
        default:
          return false;
      }
    default:
      return false;
  }
}

const isLowerBounding = (text: string): boolean => {
  const g = parseGroup(text);
  return g.clauses.some((c) => clauseLower(c) !== undefined);
};

/** Rewrites a pessimistic clause, keeping its precision when lossless and its upper bound always. */
function rewritePessimistic(c: Clause, target: string): { out: string[]; widened: boolean } {
  const op = c.op as "^" | "~";
  const n = nums(c.version).length;
  const tnums = nums(target);
  const widened = cmp(target, upperOf(op, nums(c.version))) >= 0;
  const padded = [...tnums];
  while (padded.length < n) padded.push(0);
  const truncated = padded.slice(0, n);
  const lossless = NUMERIC.test(target) && padded.slice(n).every((p) => p === 0);
  const trunc = truncated.join(".");
  if (lossless) return { out: [`${op}${c.gap}${trunc}${c.flag}`], widened };
  if (upperOf(op, tnums) === upperOf(op, truncated)) return { out: [`${op}${c.gap}${target}${c.flag}`], widened };
  return { out: [`${op}${c.gap}${trunc}${c.flag}`, `>=${target}`], widened };
}

function rewriteClause(c: Clause, target: string): { out: string[]; widened: boolean } {
  switch (c.kind) {
    case "any":
      return { out: [`>=${target}`], widened: false };
    case "wild": {
      const k = c.prefix.length;
      const tnums = nums(target);
      const prefix = Array.from({ length: k }, (_, i) => tnums[i] ?? 0);
      const text = `${prefix.join(".")}.*`;
      const widened = belowTarget(c, target);
      const base = [...prefix, 0].join(".");
      return { out: cmp(target, base) === 0 ? [text] : [text, `>=${target}`], widened };
    }
    case "hyphen": {
      if (belowTarget(c, target)) return { out: [`>=${target}`], widened: true };
      return { out: [`${target} - ${c.high}`], widened: false };
    }
    case "ver":
      break;
    default:
      return { out: [c.text], widened: false };
  }
  switch (c.op) {
    case "":
    case "=":
    case ">=":
      return { out: [`${c.op}${c.gap}${target}${c.flag}`], widened: false };
    case "^":
    case "~":
      return rewritePessimistic(c, target);
    case ">":
      // A strict lower bound would still admit versions below the target.
      return { out: [`>=${target}`], widened: cmp(target, c.version) <= 0 };
    case "<":
      return cmp(target, c.version) < 0 ? { out: [c.text], widened: false } : { out: [], widened: true };
    case "<=":
      return cmp(target, c.version) <= 0 ? { out: [c.text], widened: false } : { out: [], widened: true };
    case "!=":
      return cmp(target, c.version) !== 0 ? { out: [c.text], widened: false } : { out: [], widened: true };
    default:
      return { out: [c.text], widened: false };
  }
}

function rewriteGroup(g: Group, target: string): { text: string; widened: boolean } {
  const out: string[] = [];
  let widened = false;
  for (const c of g.clauses) {
    const r = rewriteClause(c, target);
    out.push(...r.out);
    widened ||= r.widened;
  }
  const joined = (parts: string[]): string => parts.join(g.comma ? ", " : " ");
  if (!out.some((t) => isLowerBounding(t))) out.push(`>=${target}`);
  return { text: joined([...new Set(out)]), widened };
}

export function rewriteComposerConstraint(raw: string, target: string): RewriteResult {
  const { groups, sep } = parseGroups(raw);
  const real = groups.filter((g) => !isOpaque(g));
  if (real.length === 0) return { spec: raw, widened: false };

  const below = new Set(real.filter((g) => g.clauses.some((c) => belowTarget(c, target))));
  const rewrite = new Set(
    real.filter((g) => {
      const lb = groupLower(g);
      return !below.has(g) && (lb === undefined || cmp(lb, target) <= 0);
    }),
  );
  if (rewrite.size === 0) {
    // No group admits the target: rewrite the highest group at or below it, else the lowest one above.
    const atOrBelow = real.filter((g) => {
      const lb = groupLower(g);
      return lb === undefined || cmp(lb, target) <= 0;
    });
    const pool = atOrBelow.length > 0 ? atOrBelow : real;
    const pick = pool.reduce((best, g) => {
      const a = groupLower(g);
      const b = groupLower(best);
      if (a === undefined) return best;
      if (b === undefined) return g;
      return (atOrBelow.length > 0 ? cmp(a, b) > 0 : cmp(a, b) < 0) ? g : best;
    });
    rewrite.add(pick);
    below.delete(pick);
  }

  const texts: string[] = [];
  let widened = false;
  for (const g of groups) {
    if (rewrite.has(g)) {
      const r = rewriteGroup(g, target);
      texts.push(r.text);
      widened ||= r.widened;
    } else if (below.has(g)) {
      widened = true;
    } else {
      texts.push(g.text);
    }
  }
  return { spec: [...new Set(texts)].join(sep), widened };
}
