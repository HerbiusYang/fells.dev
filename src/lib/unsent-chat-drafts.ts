type UnsentChatDraft = { requestID: string; body: string };

/** Page-local text recovery, used only after a confirmed non-dispatch. */
export function createUnsentChatDrafts() {
  const drafts = new Map<string, UnsentChatDraft[]>(), seen = new Map<string, Set<string>>();
  return {
    list(chatID: string): readonly UnsentChatDraft[] { return drafts.get(chatID) ?? []; },
    retain(chatID: string, requestID: string, body: string, editor: string): string {
      if (seen.get(chatID)?.has(requestID)) return editor;
      const requests = seen.get(chatID) ?? new Set<string>(); requests.add(requestID); seen.set(chatID, requests);
      if (!editor) return body;
      if (editor !== body) drafts.set(chatID, [...(drafts.get(chatID) ?? []), { requestID, body }]);
      return editor;
    },
    edit(chatID: string, requestID: string, editor: string): string | undefined {
      const values = drafts.get(chatID), index = values?.findIndex(value => value.requestID === requestID) ?? -1;
      if (!values || index < 0) return;
      const body = values[index].body;
      // Keep the current text separately; recovering a message never joins two
      // instructions, sends either one, or silently overwrites the next draft.
      if (editor) values[index] = { requestID, body: editor };
      else values.splice(index, 1);
      if (!values.length) drafts.delete(chatID);
      return body;
    },
    remove(chatID: string) { drafts.delete(chatID); seen.delete(chatID); },
    clear() { drafts.clear(); seen.clear(); },
  };
}
