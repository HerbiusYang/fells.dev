/** Keep the custom application dialog modal while background views refresh. */
export function containDialogFocus(root: HTMLElement, overlay: HTMLElement, opener: HTMLElement | null) {
  const dialog = overlay.querySelector<HTMLElement>('[role="dialog"]')!;
  dialog.tabIndex = -1;
  const attributes = ["data-act", "data-go", "data-id", "data-i", "data-v"];
  const selector = opener?.id ? `#${CSS.escape(opener.id)}` : opener && attributes
    .filter(name => opener.hasAttribute(name))
    .map(name => `[${name}="${CSS.escape(opener.getAttribute(name)!)}"]`).join("");
  const openerIndex = selector ? Array.from(root.querySelectorAll(selector)).indexOf(opener!) : -1;
  const returnTarget = () => {
    if (opener?.isConnected && !opener.closest("[inert]")) return opener;
    return selector ? root.querySelectorAll<HTMLElement>(selector)[Math.max(0, openerIndex)] ?? null : null;
  };
  const targets = () => Array.from(dialog.querySelectorAll<HTMLElement>(
    'a[href],button,input:not([type="hidden"]),select,textarea,[tabindex],[contenteditable="true"]',
  )).filter(element => element.tabIndex >= 0 && !element.matches(":disabled")
    && !element.closest("[hidden],[inert]") && element.getClientRects().length > 0
    && getComputedStyle(element).visibility !== "hidden");
  const anotherModal = () => Array.from(document.querySelectorAll<HTMLDialogElement>("dialog[open]"))
    .some(element => !overlay.contains(element));
  const focus = (last = false) => {
    const list = targets();
    (last ? list.at(-1) ?? dialog : list[0] ?? dialog).focus({ preventScroll: true });
  };
  const previousInert = new Map<HTMLElement, boolean>();
  const isolate = () => {
    for (const element of Array.from(root.children)) {
      if (!(element instanceof HTMLElement) || element === overlay || element.classList.contains("toast")) continue;
      if (!previousInert.has(element)) previousInert.set(element, element.inert);
      element.inert = true;
    }
  };
  // render() can replace the sidebar or main while preserving this dialog.
  const observer = new MutationObserver(isolate);
  const focusInside = (event: FocusEvent) => {
    if (overlay.isConnected && !anotherModal() && !overlay.contains(event.target as Node)) focus();
  };
  isolate();
  observer.observe(root, { childList: true });
  document.addEventListener("focusin", focusInside, true);
  const initial = targets().find(element => element.hasAttribute("autofocus"))
    ?? targets().find(element => !element.classList.contains("x")) ?? dialog;
  initial.focus({ preventScroll: true });
  return {
    opener: returnTarget,
    isCurrent: () => !anotherModal(),
    tab(event: KeyboardEvent) {
      const list = targets(), current = document.activeElement;
      if (!list.length) { event.preventDefault(); focus(); return; }
      if (!dialog.contains(current) || current === dialog
        || event.shiftKey && current === list[0] || !event.shiftKey && current === list.at(-1)) {
        event.preventDefault(); focus(event.shiftKey);
      }
    },
    release() {
      observer.disconnect();
      document.removeEventListener("focusin", focusInside, true);
      for (const [element, inert] of previousInert) element.inert = inert;
      previousInert.clear();
      return () => {
        const target = returnTarget();
        if (!target || target.closest("[inert]")) return false;
        target.focus({ preventScroll: true });
        return document.activeElement === target;
      };
    },
  };
}
