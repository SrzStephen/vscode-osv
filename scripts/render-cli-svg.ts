// Renders real `osv-check` output as the animated terminal SVG shown in the READMEs.
//
//   cd <demo project> && osv-check --min-severity high > out.txt
//   node --import tsx scripts/render-cli-svg.ts out.txt "osv-check --min-severity high" demo-app > docs/media/cli.svg
//   (for the tree: osv-check --format tree --only-fixable > out.txt, then pass that command text; see docs/media/cli-tree.svg)
//
// Layout is monospace: every glyph is CHAR_W wide, so colour spans are placed by character count.
import { readFileSync } from "node:fs";

const [file, command = "osv-check", title = "demo-app"] = process.argv.slice(2);
if (!file) {
  console.error("usage: render-cli-svg.ts <osv-check output file> [command] [window title]");
  process.exit(2);
}

const CHAR_W = 8.4;
const LEFT = 24;
const LOOP = 14; // seconds
const COLOR = {
  text: "#e6edf3",
  muted: "#7d8590",
  fix: "#7ee787",
  id: "#79c0ff",
  prompt: "#7ee787",
  critical: "#ff7b72",
  high: "#ffa657",
  medium: "#e3b341",
  low: "#79c0ff",
} as const;
const severityColor = (s: string): string => (COLOR as Record<string, string>)[s] ?? COLOR.text;

type Span = { text: string; fill: string };
const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Colours one line of osv-check text output; unknown lines stay plain. */
function spans(line: string): Span[] {
  // "<where>  <severity>  <name> <current> → <fix>  <ids>"
  const finding = /^(\S+:\d+:\d+)  (critical|high|medium|low|unknown)  (.+?) (→ \S+)(?:  (.*))?$/.exec(line);
  if (finding) {
    const [, where, severity, pkg, fix, ids] = finding;
    return [
      { text: where!, fill: COLOR.muted },
      { text: "  ", fill: COLOR.text },
      { text: severity!, fill: severityColor(severity!) },
      { text: `  ${pkg} `, fill: COLOR.text },
      { text: fix!, fill: COLOR.fix },
      ...(ids ? [{ text: `  ${ids}`, fill: COLOR.id }] : []),
    ];
  }
  // --format tree: "│   ├── GHSA-x (CVE-y) [high] summary" and "    └── lodash 4.17.15 → 4.18.0 [high] (line 5)"
  const tree = /^([│ ]*[├└]── )(.*)$/.exec(line);
  if (tree) {
    const [, branch, rest] = tree;
    const out: Span[] = [{ text: branch!, fill: COLOR.muted }];
    const dep = /^(\S+ \S+ )(→ \S+)( \[(?:critical|high|medium|low|unknown)\])( \(line \d+\).*)$/.exec(rest!);
    if (dep) {
      const sev = /\[(\w+)\]/.exec(dep[3]!)![1]!;
      return [...out, { text: dep[1]!, fill: COLOR.text }, { text: dep[2]!, fill: COLOR.fix }, { text: dep[3]!, fill: severityColor(sev) }, { text: dep[4]!, fill: COLOR.muted }];
    }
    const adv = /^((?:GHSA|CVE|PYSEC|RUSTSEC|GO|OSV|MAL)-\S+(?: \(\S+\))?)( \[(critical|high|medium|low|unknown)\])( .*)?$/.exec(rest!);
    if (adv) return [...out, { text: adv[1]!, fill: COLOR.id }, { text: adv[2]!, fill: severityColor(adv[3]!) }, { text: adv[4] ?? "", fill: COLOR.text }];
    return [...out, { text: rest!, fill: COLOR.text }];
  }
  // "2 critical · 2 high"
  if (/^\d+ (critical|high|medium|low|unknown)( · \d+ \w+)*$/.test(line)) {
    return line.split(" · ").flatMap((part, i): Span[] => {
      const [, name] = part.split(" ");
      return [...(i > 0 ? [{ text: " · ", fill: COLOR.muted }] : []), { text: part, fill: severityColor(name!) }];
    });
  }
  return [{ text: line, fill: COLOR.text }];
}

const MAX_COLS = 120; // long advisory summaries are cut with an ellipsis so the image stays readable in a README
const lines = readFileSync(file, "utf8")
  .replace(/\r\n/g, "\n")
  .trimEnd()
  .split("\n")
  .map((l) => (l.length > MAX_COLS ? `${l.slice(0, MAX_COLS - 1)}…` : l));
const ROW = 24;
const FIRST_Y = 102;
const SUMMARY_GAP = 8; // extra space before the summary lines
const isSummary = (l: string): boolean => /vulnerable dependencies in|^\d+ (critical|high|medium|low|unknown)( · |$)/.test(l);
const firstSummary = lines.findIndex(isSummary);
const STEP = Math.min(0.5, 8 / lines.length); // keep long listings inside the loop

const widthChars = Math.max(...lines.map((l) => l.length), command.length + 2);
const width = Math.max(753, Math.ceil(LEFT * 2 + widthChars * CHAR_W));
const lastY = FIRST_Y + (lines.length - 1) * ROW + (firstSummary >= 0 ? SUMMARY_GAP : 0);
const height = lastY + 24;

const typeEnd = 2.6;
const typeStart = 0.6;
const typeWidth = +(command.length * CHAR_W).toFixed(1);
const pct = (t: number): string => ((t / LOOP) * 100).toFixed(2);

const css: string[] = [
  `@keyframes type{0%,${pct(typeStart)}%{width:0}${pct(typeEnd)}%,100%{width:${typeWidth}px}}.typer{animation:type ${LOOP}.0s steps(${command.length}) infinite}`,
  `@keyframes cur{0%,${pct(typeStart)}%{transform:translateX(0)}${pct(typeEnd)}%,${pct(typeEnd + 0.4)}%{transform:translateX(${typeWidth}px)}${pct(typeEnd + 0.41)}%,100%{opacity:0}}.cursor{animation:cur ${LOOP}.0s steps(${command.length}) infinite}`,
];
const body: string[] = [];
lines.forEach((line, i) => {
  const appear = 3.4 + i * STEP + (i >= firstSummary && firstSummary >= 0 ? 0.3 : 0);
  css.push(
    `@keyframes l${i}{0%,${pct(appear)}%{opacity:0}${pct(appear + 0.25)}%,90.00%{opacity:1}92.86%,100%{opacity:0}}.l${i}{opacity:0;animation:l${i} ${LOOP}.0s linear infinite}`,
  );
  const y = FIRST_Y + i * ROW + (firstSummary >= 0 && i >= firstSummary ? SUMMARY_GAP : 0);
  let x = LEFT;
  const tspans = spans(line)
    .map((s) => {
      const out = `<tspan x="${x.toFixed(1)}" fill="${s.fill}">${esc(s.text)}</tspan>`;
      x += s.text.length * CHAR_W;
      return out;
    })
    .join("");
  body.push(`<text x="${LEFT}" y="${y}" class="l${i}" xml:space="preserve">${tspans}</text>`);
});

const cmdX = LEFT + 2 * CHAR_W - 0.0;
const label = `${command} scanning a project; ${lines.length} lines of output`;
process.stdout.write(
  [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,'DejaVu Sans Mono',monospace" font-size="14" role="img" aria-label="${esc(label)}">`,
    `<style>${css.join("")}</style>`,
    `<rect width="${width}" height="${height}" rx="10" fill="#0d1117"/>`,
    `<rect width="${width}" height="36" rx="10" fill="#161b22"/><rect y="26" width="${width}" height="10" fill="#161b22"/>`,
    `<circle cx="22" cy="18" r="6" fill="#ff5f57"/>`,
    `<circle cx="42" cy="18" r="6" fill="#febc2e"/>`,
    `<circle cx="62" cy="18" r="6" fill="#28c840"/>`,
    `<text x="${width / 2}" y="23" fill="${COLOR.muted}" font-size="12" text-anchor="middle">${esc(title)}</text>`,
    `<text x="${LEFT}" y="78" fill="${COLOR.prompt}">$</text>`,
    `<clipPath id="tc"><rect x="${cmdX.toFixed(1)}" y="62" height="22" width="${typeWidth}" class="typer"/></clipPath>`,
    `<text x="${cmdX.toFixed(1)}" y="78" fill="${COLOR.text}" clip-path="url(#tc)">${esc(command)}</text>`,
    `<rect x="${cmdX.toFixed(1)}" y="64" width="8" height="18" fill="${COLOR.text}" opacity="0.8" class="cursor"/>`,
    ...body,
    `</svg>`,
    ``,
  ].join("\n"),
);
