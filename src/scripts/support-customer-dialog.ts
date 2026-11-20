import { escapeSupport as esc } from "../lib/support-ui.ts";

export function createSupportCustomerDialog(root: HTMLElement, name: string, title: string, closeLabel: string) {
  const dialog = document.createElement("dialog");
  dialog.className = `support-orders support-customer-dialog support-customer-dialog--${name}`;
  dialog.setAttribute("aria-labelledby", `support-customer-${name}-title`);
  dialog.innerHTML = `<header class="support-ticket-heading"><div><h2 id="support-customer-${name}-title">${esc(title)}</h2><p data-customer-dialog-context></p></div><button type="button" class="support-icon-button" data-customer-dialog-close aria-label="${esc(closeLabel)}">×</button></header><div class="support-customer-dialog-body"></div>`;
  root.append(dialog);
  const body = dialog.querySelector<HTMLElement>(".support-customer-dialog-body")!;
  const context = dialog.querySelector<HTMLElement>("[data-customer-dialog-context]")!;
  const closeButton = dialog.querySelector<HTMLButtonElement>("[data-customer-dialog-close]")!;
  let opener: HTMLButtonElement | undefined;
  function close(restore = true) {
    if (!dialog.open) return;
    dialog.close();
    if (restore && opener?.getClientRects().length && !opener.disabled) opener.focus({ preventScroll: true });
    opener = undefined;
  }
  closeButton.addEventListener("click", () => close());
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  return {
    body, context,
    get open() { return dialog.open; },
    show(trigger: HTMLButtonElement) {
      if (dialog.open) return;
      opener = trigger;
      dialog.showModal();
      const field = [...body.querySelectorAll<HTMLElement>("input:not(:disabled),textarea:not(:disabled)")].find(control => control.getClientRects().length);
      (field ?? closeButton).focus({ preventScroll: true });
    },
    close,
    focusClose() { if (dialog.open) closeButton.focus({ preventScroll: true }); },
    dispose() { close(false); dialog.remove(); },
  };
}
