import { LineIndex } from "../../core/lineIndex.js";
import type { DeclaredDep } from "../../core/types.js";
import { parseDeclaration, statementEnd } from "./gemfile.js";

const DEPENDENCY_CALL = /^\s*[\w@.]+\.(add_dependency|add_runtime_dependency|add_development_dependency)(?=[\s(])/;

/** Parses the dependency declarations of a .gemspec. Never throws: lines it does not understand are skipped. */
export function parseGemspec(text: string): DeclaredDep[] {
  const ix = new LineIndex(text);
  const out: DeclaredDep[] = [];
  let pos = 0;
  while (pos < text.length) {
    let eol = text.indexOf("\n", pos);
    if (eol < 0) eol = text.length;
    const call = DEPENDENCY_CALL.exec(text.slice(pos, eol));
    if (call) {
      const end = statementEnd(text, pos);
      const group = call[1] === "add_development_dependency" ? "development" : "runtime";
      const dep = parseDeclaration(text, ix, pos + call[0].length, end, group);
      if (dep) out.push(dep);
      pos = end + 1;
    } else {
      pos = eol + 1;
    }
  }
  return out;
}
