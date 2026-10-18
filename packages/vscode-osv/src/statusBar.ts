import { basename, dirname } from "node:path";

const BASENAMES = [
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "pyproject.toml",
  "Pipfile",
  "Pipfile.lock",
  "poetry.lock",
  "uv.lock",
  "pdm.lock",
  "pylock.toml",
];

/** Glob for the client's documentSelector; mirrors the server's Phase-1 manifest and lockfile patterns. */
export const DOCUMENT_GLOB = `**/{${[...BASENAMES, "requirements*.txt", "requirements/*.txt", "pylock.*.toml"].join(",")}}`;

/** Whether the path is one of the files the server scans (same rules as DOCUMENT_GLOB). */
export function isOsvFile(path: string): boolean {
  const name = basename(path);
  return (
    BASENAMES.includes(name) ||
    /^requirements.*\.txt$/.test(name) ||
    /^pylock\..+\.toml$/.test(name) ||
    (name.endsWith(".txt") && basename(dirname(path)) === "requirements")
  );
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
