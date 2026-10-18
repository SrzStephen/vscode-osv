import type { Hover, Position } from "vscode-languageserver";
import type { Finding, Severity } from "../core/types.js";
import { vulnerabilityUrl } from "./diagnostics.js";

const ICON: Record<Severity, string> = { critical: "🔴", high: "🟠", medium: "🟡", low: "🔵", unknown: "⚪" };

const MARKDOWN_SPECIAL = /[\\`*_{}[\]()#+\-.!|<>]/g;

export function escapeMarkdown(s: string): string {
  return s.replace(/\s+/g, " ").replace(MARKDOWN_SPECIAL, "\\$&");
}

function commandLink(title: string, command: string, args: unknown): string {
  return `[${title}](command:${command}?${encodeURIComponent(JSON.stringify([args]))})`;
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export function renderHover(f: Finding): string {
  const n = f.vulns.length;
  const lines: string[] = [`**${f.name} ${f.current}** — ${n} known vulnerabilit${n === 1 ? "y" : "ies"}`, ""];
  for (const v of f.vulns) {
    lines.push(`- ${ICON[v.severity]} [${v.id}](${vulnerabilityUrl(v.id)}) ${capitalize(v.severity)} — ${escapeMarkdown(v.summary)}`);
  }
  lines.push("");
  if (f.fix.target === undefined) lines.push("⚠ No fixed version available");
  else lines.push(`Suggested: **${f.fix.target}** (${f.fix.fixesAll ? "fixes all" : "does not fix all"} ${n})`);
  if (f.fix.crossesMajor) lines.push("", "⚠ Major version upgrade");
  if (f.update?.widened) lines.push("", "⚠ Upper bound widened");
  if (f.checkedLowerBound) lines.push("", "ℹ Checked lower bound — no lockfile found");
  if (f.cached) lines.push("", "ℹ Cached result (osv.dev unreachable)");

  const top = f.vulns[0];
  const links: string[] = [];
  if (f.update) {
    const title = f.update.kind === "override" ? "Override" : "Update";
    links.push(commandLink(f.fix.target === undefined ? title : `${title} to ${f.fix.target}`,"osv.update", { uri: f.uri, findingKey: f.key }));
  }
  if (top) {
    links.push(`[View on osv.dev](${vulnerabilityUrl(top.id)})`);
    links.push(commandLink(`Ignore ${top.id}`, "osv.ignore", { id: top.id }));
  }
  if (links.length) lines.push("", links.join(" | "));
  return lines.join("\n");
}

function contains(range: Finding["range"], pos: Position): boolean {
  const { start, end } = range;
  const afterStart = pos.line > start.line || (pos.line === start.line && pos.character >= start.character);
  const beforeEnd = pos.line < end.line || (pos.line === end.line && pos.character < end.character);
  return afterStart && beforeEnd;
}

export function hoverAt(findings: Finding[], pos: Position): Hover | undefined {
  const f = findings.find((candidate) => contains(candidate.range, pos));
  if (!f) return undefined;
  return { contents: { kind: "markdown", value: renderHover(f) }, range: f.range };
}
