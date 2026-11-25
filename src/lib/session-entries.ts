/** Removes this tab's sessionStorage entries whose names start with any prefix. */
export function clearSessionEntries(prefixes: readonly string[]): void {
  try {
    const names: string[] = [];
    for (let index = 0; index < sessionStorage.length; index++) {
      const name = sessionStorage.key(index);
      if (name !== null && prefixes.some(prefix => name.startsWith(prefix))) names.push(name);
    }
    for (const name of names) sessionStorage.removeItem(name);
  } catch { /* Storage can be unavailable; the server still ends the session. */ }
}

// Explicit sign-out leaves no per-account context in a shared tab.
export const CUSTOMER_SESSION_ENTRIES = ["fells.app.current.", "fells.support.purchase.v1"] as const;
// Operator cash intents are bound to the ended operator session and become unreachable.
export const OPERATOR_SESSION_ENTRIES = ["fells.support.cash.v1:"] as const;
