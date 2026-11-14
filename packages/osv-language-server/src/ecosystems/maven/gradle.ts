import { LineIndex } from "../../core/lineIndex.js";
import type { DeclaredDep, TextRange } from "../../core/types.js";
import { mavenLowerBound } from "./range.js";

const CONFIGURATIONS =
  "implementation|api|compileOnly|runtimeOnly|testImplementation|testRuntimeOnly|annotationProcessor|kapt|ksp|classpath|platform|enforcedPlatform";

/** `conf`, `conf(`, `"custom"(` at the start of a line; group 1 or 2 is the configuration, group 3 the rest. */
const DECLARATION = new RegExp(`^[ \\t]*(?:(${CONFIGURATIONS})\\b|["']([\\w-]+)["'](?=[ \\t]*\\())[ \\t]*(.*)$`);
const WRAPPER = /^(?:platform|enforcedPlatform)[ \t]*\(/;
const VAR_DEFINITION = /^[ \t]*(?:(?:val|def|var|final|String)[ \t]+)?(?:ext\.)?(\w+)[ \t]*=[ \t]*(["'])([^"'$\n]*)\2/;
const WHOLE_VAR = /^\$(?:\{(\w+)\}|(\w+))$/;

/** A Maven lower bound, or undefined for dynamic versions (`1.+`, `latest.release`) and unusable ranges. */
export function gradleLowerBound(spec: string): string | undefined {
  if (spec.includes("+") || /^latest\./.test(spec)) return undefined;
  return mavenLowerBound(spec);
}

/** Replaces comments with spaces (keeping newlines) so offsets stay valid. Strings are left alone. */
function blankComments(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    const next = text[i + 1];
    if (c === "/" && next === "/") {
      for (; i < text.length && text[i] !== "\n"; i++) out += " ";
    } else if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      for (; i < stop; i++) out += text[i] === "\n" ? "\n" : " ";
    } else if (c === '"' || c === "'") {
      const triple = text.startsWith(c.repeat(3), i);
      const quote = triple ? c.repeat(3) : c;
      let j = i + quote.length;
      while (j < text.length && !text.startsWith(quote, j) && (triple || text[j] !== "\n")) j += text[j] === "\\" ? 2 : 1;
      const stop = Math.min(j + quote.length, text.length);
      out += text.slice(i, stop);
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

interface Variable {
  value: string;
  start: number;
  end: number;
}

interface Line {
  text: string;
  /** Offset of the line start in the source. */
  at: number;
}

function linesOf(text: string): Line[] {
  const lines: Line[] = [];
  let at = 0;
  for (const t of text.split("\n")) {
    // A CRLF file leaves a "\r" that `.` cannot match; drop it from the text but keep it in the offsets.
    lines.push({ text: t.endsWith("\r") ? t.slice(0, -1) : t, at });
    at += t.length + 1;
  }
  return lines;
}

function variablesOf(lines: Line[]): Map<string, Variable> {
  const vars = new Map<string, Variable>();
  for (const line of lines) {
    const m = VAR_DEFINITION.exec(line.text);
    if (!m) continue;
    const start = line.at + m[0].length - 1 - m[3]!.length;
    vars.set(m[1]!, { value: m[3]!, start, end: start + m[3]!.length });
  }
  return vars;
}

interface Version {
  /** Offsets of the version text as written. */
  start: number;
  end: number;
  raw: string;
}

function build(
  name: string,
  group: string,
  nameAt: [number, number],
  version: Version | undefined,
  vars: Map<string, Variable>,
  ix: LineIndex,
): DeclaredDep {
  const range = (a: number, b: number): TextRange => ix.range(a, b);
  const base = { name, group, nameRange: range(...nameAt) };
  if (!version) return { ...base, kind: "unresolved" };
  const specRange = range(version.start, version.end);
  let rawSpec = version.raw;
  let specLocation: DeclaredDep["specLocation"];
  if (rawSpec.includes("$")) {
    const ref = WHOLE_VAR.exec(rawSpec);
    const v = ref && vars.get(ref[1] ?? ref[2]!);
    if (!v) return { ...base, specRange, kind: "unresolved" };
    rawSpec = v.value;
    specLocation = { path: "", range: range(v.start, v.end), rawSpec };
  }
  const lowerBound = gradleLowerBound(rawSpec);
  return {
    ...base,
    rawSpec,
    specRange,
    ...(specLocation ? { specLocation } : {}),
    lowerBound,
    kind: lowerBound === undefined ? "unresolved" : "registry",
  };
}

/** A quoted string at the start of `s`: its content and offset within `s`. */
function leadingString(s: string): { content: string; at: number; end: number } | undefined {
  const m = /^(["'])((?:(?!\1)[^\n])*)\1/.exec(s);
  return m ? { content: m[2]!, at: 1, end: m[0].length } : undefined;
}

function mapValue(s: string, key: string): { content: string; at: number } | undefined {
  const m = new RegExp(`(?<![\\w.])${key}[ \\t]*[:=][ \\t]*(["'])([^"'\\n]*)\\1`).exec(s);
  return m ? { content: m[2]!, at: m.index + m[0].length - 1 - m[2]!.length } : undefined;
}

/**
 * Dependencies from a Gradle build script (Groovy or Kotlin), found with line-based heuristics
 * outside comments. Declarations in unrecognised forms are skipped. Never throws.
 */
export function parseGradleBuild(text: string): DeclaredDep[] {
  const ix = new LineIndex(text);
  const lines = linesOf(blankComments(text));
  const vars = variablesOf(lines);
  const deps: DeclaredDep[] = [];

  for (const line of lines) {
    const m = DECLARATION.exec(line.text);
    if (!m) continue;
    const conf = m[1] ?? m[2]!;
    let rest = m[3]!;
    let at = line.at + line.text.length - rest.length;
    const strip = (n: number) => {
      rest = rest.slice(n);
      at += n;
    };
    const trim = () => strip(rest.length - rest.trimStart().length);
    trim();
    if (rest.startsWith("(")) strip(1);
    trim();
    // `platform(` / `enforcedPlatform(` around the real argument.
    for (let w = WRAPPER.exec(rest); w; w = WRAPPER.exec(rest)) {
      strip(w[0].length);
      trim();
    }

    const str = leadingString(rest);
    if (str) {
      const parts = str.content.split(":");
      if (parts.length < 2 || !parts[0] || !parts[1]) continue;
      const start = at + str.at;
      const nameEnd = start + parts[0].length + 1 + parts[1].length;
      let version: Version | undefined;
      if (parts[2]) {
        const vStart = start + parts[0].length + parts[1].length + 2;
        const raw = parts[2].split("@")[0]!;
        version = { start: vStart, end: vStart + raw.length, raw };
      }
      deps.push(build(`${parts[0]}:${parts[1]}`, conf, [start, nameEnd], version, vars, ix));
      continue;
    }

    const catalog = /^libs\.([\w]+(?:\.[\w]+)*)/.exec(rest);
    if (catalog) {
      const alias = catalog[1]!.replace(/\.(?:get|asProvider)$/, "");
      if (/^(?:bundles|versions|plugins)(?:\.|$)/.test(alias)) continue;
      deps.push({
        name: catalog[0].replace(/\.(?:get|asProvider)$/, ""),
        group: `catalog:${alias}`,
        nameRange: ix.range(at, at + catalog[0].length),
        kind: "unresolved",
      });
      continue;
    }

    const group = mapValue(rest, "group");
    const name = mapValue(rest, "name");
    if (group && name) {
      const version = mapValue(rest, "version");
      deps.push(
        build(
          `${group.content}:${name.content}`,
          conf,
          [at + name.at, at + name.at + name.content.length],
          version && { start: at + version.at, end: at + version.at + version.content.length, raw: version.content },
          vars,
          ix,
        ),
      );
    }
  }
  return deps;
}
