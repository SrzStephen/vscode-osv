import { CodeActionKind, type CodeAction, type Range, type TextEdit, type WorkspaceEdit } from "vscode-languageserver";
import type { Finding, TextRange, UpdatePlan } from "../core/types.js";
import { toDiagnostic } from "./diagnostics.js";

export function toWorkspaceEdit(plan: UpdatePlan): WorkspaceEdit {
  const changes: Record<string, TextEdit[]> = {};
  for (const e of plan.edit) (changes[e.uri] ??= []).push({ range: e.range, newText: e.newText });
  return { changes };
}

function before(a: { line: number; character: number }, b: { line: number; character: number }): boolean {
  return a.line < b.line || (a.line === b.line && a.character < b.character);
}

/** Touching ranges count, so a cursor at either end of the squiggle matches. */
function intersects(a: TextRange, b: Range): boolean {
  return !before(a.end, b.start) && !before(b.end, a.start);
}

function actionFor(uri: string, f: Finding): CodeAction | undefined {
  const plan = f.update;
  if (!plan) return undefined;
  const target = f.fix.target;
  let title: string;
  if (plan.kind === "command-only") {
    if (!plan.lockCommand) return undefined;
    title = `Run "${plan.lockCommand.command}"`;
  } else if (plan.edit.length > 0) {
    title = `${plan.kind === "override" ? "Override" : "Update"} ${f.name} to ${target}`;
  } else {
    return undefined;
  }
  return {
    title,
    kind: CodeActionKind.QuickFix,
    isPreferred: true,
    diagnostics: [toDiagnostic(f)],
    ...(plan.kind === "command-only" ? {} : { edit: toWorkspaceEdit(plan) }),
    command: { title, command: "osv.afterUpdate", arguments: [{ uri, key: f.key }] },
  };
}

export function codeActionsFor(uri: string, findings: Finding[], range: Range): CodeAction[] {
  const actions: CodeAction[] = [];
  for (const f of findings) {
    if (!intersects(f.range, range)) continue;
    const action = actionFor(uri, f);
    if (action) actions.push(action);
  }
  return actions;
}
