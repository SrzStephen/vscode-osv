import type * as vscode from "vscode";

/** The only commands hover links may invoke. */
export const TRUSTED_COMMANDS = ["osv.update", "osv.ignore"];

/** Hover middleware: marks the server's markdown as trusted for the extension's own commands only. */
export async function trustHover(
  document: vscode.TextDocument,
  position: vscode.Position,
  token: vscode.CancellationToken,
  next: (document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) => vscode.ProviderResult<vscode.Hover>,
): Promise<vscode.Hover | null | undefined> {
  const hover = await next(document, position, token);
  if (!hover) return hover;
  const contents: unknown[] = Array.isArray(hover.contents) ? hover.contents : [hover.contents];
  for (const item of contents) {
    if (typeof item === "object" && item !== null && "value" in item) {
      (item as vscode.MarkdownString).isTrusted = { enabledCommands: TRUSTED_COMMANDS };
    }
  }
  return hover;
}
