import "../styles/app-confirm.css";

type Confirmation = { title: string; message: string; confirm: string; cancel: string; danger?: boolean; isCurrent: () => boolean };

/** A separately drawn modal preserves the form (and any one-time secret) below it. */
export function createAppConfirm(root: HTMLElement) {
  let active: { cancel: () => void } | null = null;
  const cancel = () => active?.cancel();
  addEventListener("hashchange", cancel);
  addEventListener("pagehide", cancel);
  return {
    pending: () => active !== null,
    cancel,
    ask(options: Confirmation): Promise<boolean> {
      // A second click cannot replace the decision or queue another mutation.
      if (active || !options.isCurrent()) return Promise.resolve(false);
      return new Promise(resolve => {
        const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const attributes = ["data-act", "data-go", "data-id", "data-i"];
        const openerSelector = opener?.id ? `#${CSS.escape(opener.id)}` : opener && attributes.filter(name => opener.hasAttribute(name))
          .map(name => `[${name}="${CSS.escape(opener.getAttribute(name)!)}"]`).join("");
        const dialog = document.createElement("dialog");
        dialog.className = "app-confirm";
        dialog.dataset.appConfirm = "";
        dialog.dataset.theme = root.dataset.theme || "light";
        dialog.setAttribute("role", "alertdialog");
        dialog.setAttribute("aria-modal", "true");
        dialog.setAttribute("aria-labelledby", "app-confirm-title");
        dialog.setAttribute("aria-describedby", "app-confirm-message");
        const title = document.createElement("h2"); title.id = "app-confirm-title"; title.textContent = options.title;
        const message = document.createElement("p"); message.id = "app-confirm-message"; message.textContent = options.message;
        const actions = document.createElement("div"); actions.className = "app-confirm-actions";
        const no = document.createElement("button"); no.type = "button"; no.dataset.confirmCancel = ""; no.textContent = options.cancel; no.autofocus = true;
        const yes = document.createElement("button"); yes.type = "button"; yes.dataset.confirmAccept = ""; yes.textContent = options.confirm; yes.className = options.danger ? "danger" : "primary";
        actions.append(no, yes); dialog.append(title, message, actions);
        let settled = false;
        const finish = (approved: boolean) => {
          if (settled) return;
          settled = true;
          yes.disabled = true; no.disabled = true;
          const current = options.isCurrent(), accepted = approved && current;
          active = null;
          dialog.close(); dialog.remove();
          const returnTarget = opener?.isConnected ? opener : openerSelector ? root.querySelector<HTMLElement>(openerSelector) : null;
          if (current && returnTarget && !returnTarget.closest("[inert]")) returnTarget.focus({ preventScroll: true });
          resolve(accepted);
        };
        active = { cancel: () => finish(false) };
        no.addEventListener("click", () => finish(false));
        yes.addEventListener("click", () => finish(true));
        dialog.addEventListener("cancel", event => { event.preventDefault(); finish(false); });
        dialog.addEventListener("close", () => finish(false));
        dialog.addEventListener("click", event => { if (event.target === dialog) {
          const bounds = dialog.getBoundingClientRect();
          if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) finish(false);
        } });
        dialog.addEventListener("keydown", event => {
          // Underlying application shortcuts must not close or replace its form.
          if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); finish(false); return; }
          if ((event.metaKey || event.ctrlKey) && (event.key.toLowerCase() === "k" || event.key === "/" || event.shiftKey && event.key.toLowerCase() === "o")) event.preventDefault();
          if (event.key === "Tab") {
            if (event.shiftKey && document.activeElement === no || !event.shiftKey && document.activeElement === yes) {
              event.preventDefault(); (event.shiftKey ? yes : no).focus();
            }
          }
          event.stopPropagation();
        });
        document.body.append(dialog);
        try { dialog.showModal(); no.focus({ preventScroll: true }); }
        catch { finish(false); }
      });
    },
  };
}
