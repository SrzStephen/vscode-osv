import { modify } from "jsonc-parser";
import { LineIndex } from "../core/lineIndex.js";
import type { TextEditSpec } from "../core/types.js";

/** Indent width of the first indented line; 2 when none is found. */
function detectIndent(text: string): number {
  const m = /^( +)\S/m.exec(text);
  return m ? m[1]!.length : 2;
}

/** Edits that set `path` to `value` in JSON(C) text, keeping the file's indent and line endings. */
export function setJsonProperty(
  text: string,
  path: (string | number)[],
  value: unknown,
  uri: string,
): TextEditSpec[] {
  const ix = new LineIndex(text);
  const edits = modify(text, path, value, {
    formattingOptions: {
      insertSpaces: true,
      tabSize: detectIndent(text),
      eol: text.includes("\r\n") ? "\r\n" : "\n",
    },
  });
  return edits.map((e) => ({
    uri,
    range: ix.range(e.offset, e.offset + e.length),
    newText: e.content,
  }));
}
