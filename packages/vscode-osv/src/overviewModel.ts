import { emptyCounts, severityOf, severitySummary, totalOf, type SeverityCounts, type SeverityName } from "./statusBar.js";

/** One vulnerable dependency, read from an osv diagnostic. No vscode types, so it is unit-testable. */
export interface OverviewEntry {
  uri: string;
  /** Workspace-relative path used for grouping and display. */
  path: string;
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
  severity: SeverityName;
  name: string;
  current: string;
  target?: string;
  key?: string;
  vulnIds: string[];
  message: string;
}

export type GroupBy = "file" | "severity";

export interface GroupNode {
  kind: "group";
  id: string;
  label: string;
  description: string;
  severity: SeverityName;
  children: EntryNode[];
}

export interface EntryNode {
  kind: "entry";
  id: string;
  entry: OverviewEntry;
}

export type OverviewNode = GroupNode | EntryNode;

const RANK: Record<SeverityName, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export const SEVERITY_LABEL: Record<SeverityName, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };

/** The shape of the structured `data` the server attaches to every diagnostic. */
interface DiagnosticData {
  key?: unknown;
  name?: unknown;
  current?: unknown;
  target?: unknown;
  vulnIds?: unknown;
}

const asString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/** Builds an entry from a diagnostic's fields; falls back to the message when `data` is missing. */
export function toEntry(input: {
  uri: string;
  path: string;
  range: { line: number; character: number; endLine: number; endCharacter: number };
  message: string;
  data: unknown;
}): OverviewEntry {
  const data = (input.data ?? {}) as DiagnosticData;
  const vulnIds = Array.isArray(data.vulnIds) ? data.vulnIds.filter((id): id is string => typeof id === "string") : [];
  const target = asString(data.target);
  return {
    uri: input.uri,
    path: input.path,
    line: input.range.line,
    character: input.range.character,
    endLine: input.range.endLine,
    endCharacter: input.range.endCharacter,
    severity: severityOf(input.data),
    name: asString(data.name) ?? input.message.split(" ")[0] ?? "dependency",
    current: asString(data.current) ?? "",
    ...(target !== undefined ? { target } : {}),
    ...(asString(data.key) !== undefined ? { key: asString(data.key) as string } : {}),
    vulnIds,
    message: input.message,
  };
}

function countsOf(entries: OverviewEntry[]): SeverityCounts {
  const counts = emptyCounts();
  for (const e of entries) counts[e.severity]++;
  return counts;
}

const worst = (entries: OverviewEntry[]): SeverityName =>
  entries.reduce<SeverityName>((acc, e) => (RANK[e.severity] < RANK[acc] ? e.severity : acc), "low");

function entryNode(e: OverviewEntry): EntryNode {
  return { kind: "entry", id: `${e.uri}#${e.line}:${e.character}:${e.name}`, entry: e };
}

const compareEntries = (a: OverviewEntry, b: OverviewEntry): number =>
  RANK[a.severity] - RANK[b.severity] || a.path.localeCompare(b.path) || a.line - b.line || a.character - b.character;

/** The tree: files (worst first, then by path) or severities (most severe first), each with its entries. */
export function buildTree(entries: OverviewEntry[], groupBy: GroupBy): GroupNode[] {
  const sorted = [...entries].sort(compareEntries);
  if (groupBy === "severity") {
    return (Object.keys(RANK) as SeverityName[])
      .map((severity) => ({ severity, items: sorted.filter((e) => e.severity === severity) }))
      .filter((g) => g.items.length > 0)
      .map((g) => ({
        kind: "group" as const,
        id: `severity:${g.severity}`,
        label: SEVERITY_LABEL[g.severity],
        description: String(g.items.length),
        severity: g.severity,
        children: g.items.map(entryNode),
      }));
  }
  const byPath = new Map<string, OverviewEntry[]>();
  for (const e of sorted) byPath.set(e.path, [...(byPath.get(e.path) ?? []), e]);
  return [...byPath.entries()]
    .map(([path, items]) => ({
      kind: "group" as const,
      id: `file:${path}`,
      label: path,
      description: severitySummary(countsOf(items)),
      severity: worst(items),
      children: items.map(entryNode),
    }))
    .sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.label.localeCompare(b.label));
}

/** Label and description for an entry row, e.g. "lodash 4.17.20" / "fix: 4.17.21". */
export function describeEntry(e: OverviewEntry): { label: string; description: string } {
  const label = e.current ? `${e.name} ${e.current}` : e.name;
  const ids = e.vulnIds.length > 1 ? `${e.vulnIds[0]} +${e.vulnIds.length - 1}` : (e.vulnIds[0] ?? "");
  const fix = e.target ? `fix: ${e.target}` : "no fix yet";
  return { label, description: ids ? `${fix} · ${ids}` : fix };
}

export function summaryOf(entries: OverviewEntry[]): { total: number; text: string } {
  const counts = countsOf(entries);
  return { total: totalOf(counts), text: severitySummary(counts) };
}
