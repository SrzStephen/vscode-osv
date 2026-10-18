export interface SuggestLockCommandParams {
  cwd: string;
  command: string;
}

/** Everything handleSuggestLockCommand needs from VS Code, so the decision table is testable without the host. */
export interface LockCommandHost {
  runInTerminal(cwd: string, command: string): void;
  /** Resolves to the label of the button clicked, or undefined when dismissed. */
  ask(message: string): PromiseLike<string | undefined>;
  setOfferLockCommand(value: "always" | "never"): PromiseLike<void>;
}

export const RUN = "Run in terminal";
export const ALWAYS = "Always";
export const NEVER = "Never";

/**
 * Handles osv/suggestLockCommand. Lock commands run only from the client: never when the setting is `never`,
 * never in Restricted Mode, and otherwise only after a click (or with `always`).
 */
export async function handleSuggestLockCommand(
  params: SuggestLockCommandParams,
  settings: { offerLockCommand: string },
  trusted: boolean,
  host: LockCommandHost,
): Promise<void> {
  if (settings.offerLockCommand === "never" || !trusted) return;
  if (settings.offerLockCommand === "always") {
    host.runInTerminal(params.cwd, params.command);
    return;
  }
  const choice = await host.ask(`Run \`${params.command}\` to update the lockfile?`);
  if (choice === NEVER) {
    await host.setOfferLockCommand("never");
  } else if (choice === ALWAYS) {
    await host.setOfferLockCommand("always");
    host.runInTerminal(params.cwd, params.command);
  } else if (choice === RUN) {
    host.runInTerminal(params.cwd, params.command);
  }
}

/** The list with `id` appended, or undefined when it is already there. */
export function appendIgnore(current: readonly string[], id: string): string[] | undefined {
  return current.includes(id) ? undefined : [...current, id];
}
