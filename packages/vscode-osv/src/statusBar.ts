import { DOCUMENT_GLOBS } from "./generated/patterns.js";

/** Glob for the client's documentSelector; generated from the server's ecosystem modules (npm run sync-patterns). */
export const DOCUMENT_GLOB = `**/{${DOCUMENT_GLOBS.join(",")}}`;

const MATCHERS = DOCUMENT_GLOBS.map(
  (g) => new RegExp(`(^|/)${g.replace(/[.+^${}()|[\]\\?]/g, "\\$&").replace(/\*/g, "[^/]*")}$`),
);

/** Whether the path is one of the files the server scans (same rules as DOCUMENT_GLOB). */
export function isOsvFile(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return MATCHERS.some((re) => re.test(normalized));
}

export type SeverityName = "critical" | "high" | "medium" | "low";

export type SeverityCounts = Record<SeverityName, number>;

export const emptyCounts = (): SeverityCounts => ({ critical: 0, high: 0, medium: 0, low: 0 });

const ORDER: SeverityName[] = ["critical", "high", "medium", "low"];

/** The severity carried in a diagnostic's `data` (set by the server), or "low" when absent or unknown. */
export function severityOf(data: unknown): SeverityName {
  const value = (data as { severity?: unknown } | undefined)?.severity;
  return ORDER.includes(value as SeverityName) ? (value as SeverityName) : "low";
}

export interface StatusState {
  /** The active editor shows a file the server scans. */
  matching: boolean;
  /** Diagnostics with source "osv" in the active editor, by severity. */
  counts: SeverityCounts;
  /** The last osv/status said the OSV API was unreachable. */
  offline: boolean;
  /** A workspace scan is running. */
  scanning?: boolean;
}

export function totalOf(counts: SeverityCounts): number {
  return ORDER.reduce((sum, key) => sum + counts[key], 0);
}

/** "2 critical · 1 high", most severe first; empty when there are none. */
export function severitySummary(counts: SeverityCounts): string {
  return ORDER.filter((key) => counts[key] > 0)
    .map((key) => `${counts[key]} ${key}`)
    .join(" · ");
}

/** The status bar text, or undefined when the item should be hidden. */
export function statusBarText(state: StatusState): string | undefined {
  if (state.scanning) return "$(sync~spin) OSV: scanning";
  if (!state.matching) return undefined;
  if (state.offline) return "$(shield) OSV: offline";
  const summary = severitySummary(state.counts);
  return summary ? `$(shield) OSV: ${summary}` : "$(shield) OSV: ✓";
}

/** Whether the item should use the error background: any critical or high finding in view. */
export function isAlarming(state: Pick<StatusState, "counts" | "offline" | "scanning">): boolean {
  return !state.scanning && !state.offline && state.counts.critical + state.counts.high > 0;
}
