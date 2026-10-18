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

export interface StatusState {
  /** The active editor shows a file the server scans. */
  matching: boolean;
  /** Diagnostics with source "osv" in the active editor. */
  vulnerable: number;
  /** The last osv/status said the OSV API was unreachable. */
  offline: boolean;
}

/** The status bar text, or undefined when the item should be hidden. */
export function statusBarText(state: StatusState): string | undefined {
  if (!state.matching) return undefined;
  if (state.offline) return "$(shield) OSV: offline";
  return state.vulnerable > 0 ? `$(shield) OSV: ${state.vulnerable} vulnerable` : "$(shield) OSV: ✓";
}
