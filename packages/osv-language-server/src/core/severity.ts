import { Cvss3P0, Cvss3P1, Cvss4P0 } from "ae-cvss-calculator";
import type { OsvRecord, Severity } from "./types.js";

const RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, unknown: 0 };

export function severityRank(s: Severity): number {
  return RANK[s];
}

export function maxSeverity(list: Severity[]): Severity {
  let best: Severity = "unknown";
  for (const s of list) if (severityRank(s) > severityRank(best)) best = s;
  return best;
}

function fromScore(score: number): Severity {
  if (score >= 9.0) return "critical";
  if (score >= 7.0) return "high";
  if (score >= 4.0) return "medium";
  if (score > 0) return "low";
  return "unknown";
}

/** Returns undefined for unparseable vectors or unsupported types. */
function scoreVector(type: string, vector: string): number | undefined {
  try {
    if (type === "CVSS_V3") {
      const calc = vector.startsWith("CVSS:3.0/") ? new Cvss3P0(vector) : new Cvss3P1(vector);
      return calc.calculateScores().overall;
    }
    if (type === "CVSS_V4") return new Cvss4P0(vector).calculateScores().overall;
  } catch {
    // unparseable vector: ignored
  }
  return undefined;
}

function fromLabel(label: unknown): Severity {
  switch (typeof label === "string" ? label.toUpperCase() : "") {
    case "CRITICAL":
      return "critical";
    case "HIGH":
      return "high";
    case "MODERATE":
    case "MEDIUM":
      return "medium";
    case "LOW":
      return "low";
    default:
      return "unknown";
  }
}

export function severityOf(record: OsvRecord): Severity {
  const scored: Severity[] = [];
  for (const entry of record.severity ?? []) {
    const score = scoreVector(entry.type, entry.score);
    if (score !== undefined) scored.push(fromScore(score));
  }
  const fromVectors = maxSeverity(scored);
  if (fromVectors !== "unknown") return fromVectors;
  return fromLabel(record.database_specific?.["severity"]);
}
