interface Draft { userId: number; route: string; workspace: string; text: string; savedAt: number }
const key = "fells.chat.relogin-draft.v1";
export function retainChatDraft(userId: number, route: string, workspace: string, text: string): void {
  try {
    if (!text || text.length > 100000) { sessionStorage.removeItem(key); return; }
    sessionStorage.setItem(key, JSON.stringify({ userId, route, workspace, text, savedAt: Date.now() }));
  } catch { /* Authentication still clears the page when storage is unavailable. */ }
}
export function readChatDraft(userId: number): Draft | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (!value || !Number.isSafeInteger(value.userId) || typeof value.route !== "string" || !value.route.startsWith("#") || value.route.length > 5000 || typeof value.workspace !== "string" || typeof value.text !== "string" || value.text.length > 100000 || !Number.isSafeInteger(value.savedAt) || value.savedAt > Date.now() || Date.now() - value.savedAt > 86400000) { clearChatDraft(); return null; }
    return value.userId === userId ? value : null;
  } catch { return null; }
}
export function clearChatDraft(): void { try { sessionStorage.removeItem(key); } catch { /* Optional local draft. */ } }
