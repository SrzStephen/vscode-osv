import * as vscode from "vscode";
import { buildTree, describeEntry, summaryOf, toEntry, type EntryNode, type GroupBy, type GroupNode, type OverviewEntry, type OverviewNode } from "./overviewModel.js";

export const VIEW_ID = "osv.overview";

const SEVERITY_ICON: Record<string, vscode.ThemeIcon> = {
  critical: new vscode.ThemeIcon("error", new vscode.ThemeColor("problemsErrorIcon.foreground")),
  high: new vscode.ThemeIcon("error", new vscode.ThemeColor("problemsErrorIcon.foreground")),
  medium: new vscode.ThemeIcon("warning", new vscode.ThemeColor("problemsWarningIcon.foreground")),
  low: new vscode.ThemeIcon("info", new vscode.ThemeColor("problemsInfoIcon.foreground")),
};

function readGroupBy(): GroupBy {
  return vscode.workspace.getConfiguration("osv").get<string>("overview.groupBy") === "severity" ? "severity" : "file";
}

/** Every osv diagnostic currently published, across open and unopened files. */
function collectEntries(): OverviewEntry[] {
  const entries: OverviewEntry[] = [];
  for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
    if (uri.scheme !== "file") continue;
    const path = vscode.workspace.asRelativePath(uri, false);
    for (const d of diagnostics) {
      if (d.source !== "osv") continue;
      entries.push(
        toEntry({
          uri: uri.toString(),
          path,
          range: { line: d.range.start.line, character: d.range.start.character, endLine: d.range.end.line, endCharacter: d.range.end.character },
          message: d.message,
          data: (d as { data?: unknown }).data,
        }),
      );
    }
  }
  return entries;
}

class OverviewProvider implements vscode.TreeDataProvider<OverviewNode> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private tree: GroupNode[] = [];
  entries: OverviewEntry[] = [];

  refresh(): void {
    this.entries = collectEntries();
    this.tree = buildTree(this.entries, readGroupBy());
    this.emitter.fire();
  }

  getChildren(node?: OverviewNode): OverviewNode[] {
    if (!node) return this.tree;
    return node.kind === "group" ? node.children : [];
  }

  getTreeItem(node: OverviewNode): vscode.TreeItem {
    if (node.kind === "group") {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
      item.id = node.id;
      item.description = node.description;
      item.iconPath = readGroupBy() === "file" ? vscode.ThemeIcon.File : SEVERITY_ICON[node.severity];
      item.contextValue = "osv.group";
      return item;
    }
    const { label, description } = describeEntry(node.entry);
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.id = node.id;
    item.description = readGroupBy() === "file" ? description : `${node.entry.path} · ${description}`;
    item.iconPath = SEVERITY_ICON[node.entry.severity];
    item.tooltip = node.entry.message;
    item.contextValue = node.entry.key && node.entry.target ? "osv.entry.fixable" : "osv.entry";
    item.command = { command: "osv.overview.reveal", title: "Reveal", arguments: [node] };
    return item;
  }
}

/** Registers the "Vulnerabilities" tree view and its commands; returns disposables for the extension context. */
export function registerOverview(): vscode.Disposable[] {
  const provider = new OverviewProvider();
  const view = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: provider, showCollapseAll: true });

  const refresh = () => {
    provider.refresh();
    const { total, text } = summaryOf(provider.entries);
    view.badge = total > 0 ? { value: total, tooltip: text } : undefined;
    view.description = total > 0 ? text : undefined;
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  // Diagnostics arrive in bursts during a workspace scan; coalesce so the tree redraws once.
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(refresh, 150);
  };

  const setGroupBy = (value: GroupBy) => vscode.workspace.getConfiguration("osv").update("overview.groupBy", value, vscode.ConfigurationTarget.Global);

  const entryOf = (node: OverviewNode | undefined): OverviewEntry | undefined => (node?.kind === "entry" ? (node as EntryNode).entry : undefined);

  refresh();
  return [
    view,
    new vscode.Disposable(() => timer && clearTimeout(timer)),
    vscode.languages.onDidChangeDiagnostics(schedule),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration("osv.overview.groupBy") && refresh()),
    vscode.commands.registerCommand("osv.overview.refresh", refresh),
    vscode.commands.registerCommand("osv.overview.groupBySeverity", () => setGroupBy("severity")),
    vscode.commands.registerCommand("osv.overview.groupByFile", () => setGroupBy("file")),
    vscode.commands.registerCommand("osv.overview.reveal", async (node: OverviewNode) => {
      const entry = entryOf(node);
      if (!entry) return;
      const range = new vscode.Range(entry.line, entry.character, entry.endLine, entry.endCharacter);
      await vscode.window.showTextDocument(vscode.Uri.parse(entry.uri), { selection: range, preserveFocus: false });
    }),
    vscode.commands.registerCommand("osv.overview.fix", async (node: OverviewNode) => {
      const entry = entryOf(node);
      if (entry?.key) await vscode.commands.executeCommand("osv.update", { uri: entry.uri, findingKey: entry.key });
    }),
    vscode.commands.registerCommand("osv.overview.ignore", async (node: OverviewNode) => {
      const id = entryOf(node)?.vulnIds[0];
      if (id) await vscode.commands.executeCommand("osv.ignore", { id });
    }),
    vscode.commands.registerCommand("osv.overview.openAdvisory", async (node: OverviewNode) => {
      const id = entryOf(node)?.vulnIds[0];
      if (id) await vscode.env.openExternal(vscode.Uri.parse(`https://osv.dev/vulnerability/${encodeURIComponent(id)}`));
    }),
  ];
}
