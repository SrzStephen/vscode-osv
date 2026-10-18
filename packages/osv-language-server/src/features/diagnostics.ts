import { DiagnosticSeverity, type Diagnostic } from "vscode-languageserver";
import type { Finding, Severity } from "../core/types.js";

const MAX_IDS = 3;

const SEVERITY: Record<Severity, DiagnosticSeverity> = {
  critical: DiagnosticSeverity.Error,
  high: DiagnosticSeverity.Error,
  medium: DiagnosticSeverity.Warning,
  low: DiagnosticSeverity.Information,
  unknown: DiagnosticSeverity.Information,
};

/** The advisory page; the ID is percent-encoded (including "()!*'") so it cannot end a markdown link. */
export function vulnerabilityUrl(id: string): string {
  const encoded = encodeURIComponent(id).replace(/[()!*']/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `https://osv.dev/vulnerability/${encoded}`;
}

function describeIds(ids: string[]): string {
  const shown = ids.slice(0, MAX_IDS).join(", ");
  return ids.length > MAX_IDS ? `${shown}, +${ids.length - MAX_IDS} more` : shown;
}

function buildMessage(f: Finding): string {
  const n = f.vulns.length;
  const ids = describeIds(f.vulns.map((v) => v.id));
  let message = `${f.name} ${f.current} has ${n} known vulnerabilit${n === 1 ? "y" : "ies"} (${ids})`;
  if (f.fix.reason === "unparseable-version") message += "; version could not be parsed, no fix calculated";
  else if (f.fix.target === undefined) message += "; no fixed version available";
  else message += `; upgrade to ${f.fix.target} (${f.fix.fixesAll ? "fixes all" : "does not fix all"})`;
  if (!f.direct) message += f.via?.length ? ` (transitive, via ${f.via.join(" → ")})` : " (transitive)";
  if (f.fix.crossesMajor) message += " (major version upgrade)";
  if (f.checkedLowerBound) message += " (checked lower bound — no lockfile found)";
  if (f.cached) message += " (cached)";
  return message;
}

export function toDiagnostic(f: Finding): Diagnostic {
  const top = f.vulns[0]?.id;
  return {
    range: f.range,
    severity: SEVERITY[f.severity],
    source: "osv",
    ...(top !== undefined ? { code: top, codeDescription: { href: vulnerabilityUrl(top) } } : {}),
    message: buildMessage(f),
    data: {
      key: f.key,
      ecosystem: f.ecosystem,
      name: f.name,
      current: f.current,
      target: f.fix.target,
      vulnIds: f.vulns.map((v) => v.id),
      direct: f.direct,
      lockCommand: f.update?.lockCommand,
    },
  };
}
