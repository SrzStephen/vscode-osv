import { describe, expect, it, vi } from "vitest";
import { appendIgnore, handleSuggestLockCommand, saveDirtyDocumentsUnder, type LockCommandHost } from "../../src/commandRunner.js";

const params = { cwd: "/w/app", command: "npm install --package-lock-only" };

function host(choice?: string): LockCommandHost & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    runInTerminal: vi.fn((cwd: string, command: string) => void calls.push(`run:${cwd}:${command}`)),
    ask: vi.fn(async (message: string) => {
      calls.push(`ask:${message}`);
      return choice;
    }),
    setOfferLockCommand: vi.fn(async (v: "always" | "never") => void calls.push(`set:${v}`)),
  };
}

describe("handleSuggestLockCommand", () => {
  it("does nothing for never", async () => {
    const h = host();
    await handleSuggestLockCommand(params, { offerLockCommand: "never" }, true, h);
    expect(h.calls).toEqual([]);
  });

  it("does nothing in Restricted Mode, whatever the setting", async () => {
    for (const mode of ["always", "ask"] as const) {
      const h = host("Run in terminal");
      await handleSuggestLockCommand(params, { offerLockCommand: mode }, false, h);
      expect(h.calls).toEqual([]);
    }
  });

  it("runs immediately for always", async () => {
    const h = host();
    await handleSuggestLockCommand(params, { offerLockCommand: "always" }, true, h);
    expect(h.calls).toEqual([`run:/w/app:${params.command}`]);
  });

  it("asks, and runs on 'Run in terminal'", async () => {
    const h = host("Run in terminal");
    await handleSuggestLockCommand(params, { offerLockCommand: "ask" }, true, h);
    expect(h.calls).toEqual([`ask:Run \`${params.command}\` to update the lockfile?`, `run:/w/app:${params.command}`]);
  });

  it("'Always' saves the setting and runs", async () => {
    const h = host("Always");
    await handleSuggestLockCommand(params, { offerLockCommand: "ask" }, true, h);
    expect(h.calls.slice(1)).toEqual(["set:always", `run:/w/app:${params.command}`]);
  });

  it("'Never' saves the setting and does not run", async () => {
    const h = host("Never");
    await handleSuggestLockCommand(params, { offerLockCommand: "ask" }, true, h);
    expect(h.calls.slice(1)).toEqual(["set:never"]);
  });

  it("dismissing the prompt does nothing", async () => {
    const h = host(undefined);
    await handleSuggestLockCommand(params, { offerLockCommand: "ask" }, true, h);
    expect(h.calls).toHaveLength(1);
  });
});

describe("saveDirtyDocumentsUnder", () => {
  function doc(fsPath: string, isDirty: boolean, result: boolean | Error = true) {
    const saved: string[] = [];
    return {
      saved,
      d: {
        fsPath,
        isDirty,
        save: async () => {
          saved.push(fsPath);
          if (result instanceof Error) throw result;
          return result;
        },
      },
    };
  }

  it("saves only dirty documents under cwd", async () => {
    const docs = [
      doc("/w/app/package.json", true),
      doc("/w/app/sub/requirements.txt", true),
      doc("/w/app/clean.json", false),
      doc("/w/other/package.json", true),
      doc("/w/app2/package.json", true),
    ];
    expect(await saveDirtyDocumentsUnder("/w/app", docs.map((x) => x.d))).toBe(true);
    expect(docs.flatMap((x) => x.saved)).toEqual(["/w/app/package.json", "/w/app/sub/requirements.txt"]);
  });

  it("reports failure when a save returns false", async () => {
    expect(await saveDirtyDocumentsUnder("/w/app", [doc("/w/app/package.json", true, false).d])).toBe(false);
  });

  it("reports failure when a save throws", async () => {
    expect(await saveDirtyDocumentsUnder("/w/app", [doc("/w/app/package.json", true, new Error("EACCES")).d])).toBe(false);
  });

  it("handleSuggestLockCommand waits for an asynchronous runInTerminal", async () => {
    const h = host();
    let finished = false;
    h.runInTerminal = async () => {
      await new Promise((r) => setTimeout(r, 5));
      finished = true;
    };
    await handleSuggestLockCommand(params, { offerLockCommand: "always" }, true, h);
    expect(finished).toBe(true);
  });
});

describe("appendIgnore", () => {
  it("appends a new id", () => expect(appendIgnore(["A"], "B")).toEqual(["A", "B"]));
  it("returns undefined for a duplicate", () => expect(appendIgnore(["A", "B"], "B")).toBeUndefined());
  it("handles an empty list", () => expect(appendIgnore([], "A")).toEqual(["A"]));
});
