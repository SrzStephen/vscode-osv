import { modify } from "jsonc-parser";
import { LineIndex } from "../core/lineIndex.js";
import type { TextEditSpec } from "../core/types.js";

/** Indent style of the first indented line: tabs, or spaces of that width (2 when none is found). */
function detectIndent(text: string): { insertSpaces: boolean; tabSize: number } {
  const m = /^([ \t])([ \t]*)\S/m.exec(text);
  if (m && m[1] === "\t") return { insertSpaces: false, tabSize: 1 };
  return { insertSpaces: true, tabSize: m ? (m[1]! + m[2]!).length : 2 };
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
      ...detectIndent(text),
      eol: text.includes("\r\n") ? "\r\n" : "\n",
    },
  });
  return edits.map((e) => ({
    uri,
    range: ix.range(e.offset, e.offset + e.length),
    newText: e.content,
  }));
}
