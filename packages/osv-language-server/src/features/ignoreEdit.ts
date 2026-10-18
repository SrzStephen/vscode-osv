import { CreateFile, type TextDocumentEdit, type WorkspaceEdit } from "vscode-languageserver";

/** Appends an `[[IgnoredVulns]]` entry to osv-scanner.toml, creating the file when `existingText` is undefined. */
export function ignoreEdit(tomlUri: string, existingText: string | undefined, id: string): WorkspaceEdit {
  // JSON string escaping is also valid TOML basic-string escaping.
  const entry = `[[IgnoredVulns]]\nid = ${JSON.stringify(id)}\n`;
  if (existingText === undefined) {
    const insert: TextDocumentEdit = {
      textDocument: { uri: tomlUri, version: null },
      edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: entry }],
    };
    return { documentChanges: [CreateFile.create(tomlUri, { ignoreIfExists: true }), insert] };
  }
  const lines = existingText.split("\n");
  const end = { line: lines.length - 1, character: lines[lines.length - 1]!.length };
  return { changes: { [tomlUri]: [{ range: { start: end, end }, newText: `\n${entry}` }] } };
}
