import { LineIndex } from "../../src/core/lineIndex.js";
import type { TextRange } from "../../src/core/types.js";

/** The slice of `text` a range covers. */
export function textAt(text: string, range: TextRange): string {
  const ix = new LineIndex(text);
  return text.slice(ix.offset(range.start), ix.offset(range.end));
}
