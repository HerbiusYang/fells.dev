import { APIError } from "../lib/app-http.ts";
import { isBusinessBlocked, subscribeMaintenance } from "../lib/maintenance.ts";
import type { SupportCustomerProfile } from "../lib/support-api.ts";
import { supportHttp, type SupportThread } from "../lib/support-http.ts";
import { clearFieldValidation, installFieldValidation, validateFields } from "../lib/field-validation.ts";
import { SupportSessionEnded, type SupportAgent } from "../lib/support-service.ts";
import { escapeSupport as esc, supportRequestError } from "../lib/support-ui.ts";
import { supportCustomerProfileCopy } from "../i18n/support-customer-profile.ts";
import { supportExperienceCopy } from "../i18n/support-experience.ts";
import { supportOrdersCopy } from "../i18n/support-orders.ts";
import { createSupportCustomerDialog } from "./support-customer-dialog.ts";

export function installSupportCustomerProfile(root: HTMLElement, lang: string, refresh: () => Promise<void>, onExpired: () => void) {
  installFieldValidation();
  const copy = supportCustomerProfileCopy(lang), orders = supportOrdersCopy(lang);
  const trigger = root.querySelector<HTMLButtonElement>("[data-support-profile-open]")!;
  const modal = createSupportCustomerDialog(root, "profile", copy.title, orders.close);
  const lifetime = new AbortController();
  modal.body.innerHTML = `<form data-customer-profile-form><label>${esc(copy.name)}<input name="name" type="text" maxlength="400" /></label><label>${esc(copy.note)}<textarea name="note" rows="4" maxlength="400"></textarea></label><p data-customer-profile-status role="status" tabindex="-1" class="support-error"></p><div class="support-customer-dialog-actions"><button type="submit" class="support-primary-button">${esc(copy.save)}</button><button type="button" data-customer-profile-reload hidden>${esc(copy.reload)}</button></div></form><a class="support-customer-admin" data-support-manage-customer target="_blank" rel="noopener">${esc(supportExperienceCopy(lang).manageCustomer)}</a>`;
  const form = modal.body.querySelector<HTMLFormElement>("form")!;
  const name = form.elements.namedItem("name") as HTMLInputElement;
  const note = form.elements.namedItem("note") as HTMLTextAreaElement;
  const status = form.querySelector<HTMLElement>("[data-customer-profile-status]")!;
  const save = form.querySelector<HTMLButtonElement>("[type=submit]")!;
  const reload = form.querySelector<HTMLButtonElement>("[data-customer-profile-reload]")!;
  const admin = modal.body.querySelector<HTMLAnchorElement>("[data-support-manage-customer]")!;
  let agent: SupportAgent | null = null, thread: SupportThread | undefined;
  let baseline: SupportCustomerProfile | undefined;
  let busy = false, stale = false, generation = 0;
  const linkedCustomer = () => !!agent && !!thread && !thread.demo && /^[1-9][0-9]*$/.test(thread.user.id);
  const dirty = () => baseline && (name.value !== baseline.name || note.value !== baseline.note);
  function controls() {
    const blocked = isBusinessBlocked();
    save.disabled = busy || stale || blocked || !dirty();
    reload.disabled = busy || blocked;
    reload.hidden = !stale;
    name.readOnly = note.readOnly = busy || blocked;
  }
  const unsubscribe = subscribeMaintenance(controls);
  function useProfile(profile?: SupportCustomerProfile) {
    baseline = profile;
    name.value = profile?.name ?? "";
    note.value = profile?.note ?? "";
    name.setCustomValidity("");
    note.setCustomValidity("");
    clearFieldValidation(form);
    stale = false;
    status.textContent = "";
    delete status.dataset.kind;
    controls();
  }
  trigger.addEventListener("click", () => {
    if (!linkedCustomer() || isBusinessBlocked()) return;
    const profile = thread?.customerProfile;
    if (profile && !dirty() && !busy && !stale && baseline?.version !== profile.version) useProfile(profile);
    modal.show(trigger);
  }, { signal: lifetime.signal });
  form.addEventListener("input", () => {
    for (const field of [name, note]) field.setCustomValidity([...field.value].length > 200 ? copy.limit : "");
    controls();
  }, { signal: lifetime.signal });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!agent || !thread || !baseline || !modal.open || busy || stale || isBusinessBlocked() || !dirty() || !validateFields(form)) return;
    const expected = generation;
    busy = true;
    status.textContent = "";
    delete status.dataset.kind;
    controls();
    try {
      const result = await supportHttp.updateSupportCustomerProfile(agent.session, thread.id, { name: name.value, note: note.value, version: baseline.version });
      if (generation !== expected) return;
      useProfile(result);
      status.dataset.kind = "success";
      status.textContent = copy.saved;
      await refresh();
    } catch (failure) {
      if (failure instanceof SupportSessionEnded) { onExpired(); return; }
      if (generation !== expected) return;
      stale = failure instanceof APIError && failure.status === 409;
      status.textContent = stale ? copy.conflict : supportRequestError(failure, lang, orders.error);
    } finally {
      if (generation === expected) {
        busy = false;
        controls();
        if (modal.open && status.textContent) status.focus({ preventScroll: true });
      }
    }
  }, { signal: lifetime.signal });
  reload.addEventListener("click", async () => {
    if (!stale || busy || isBusinessBlocked()) return;
    const expected = generation;
    busy = true;
    controls();
    try {
      await refresh();
      if (expected !== generation || !thread?.customerProfile || thread.customerProfile.version === baseline?.version) return;
      useProfile(thread.customerProfile);
      if (modal.open) name.focus({ preventScroll: true });
    } finally {
      if (expected === generation) { busy = false; controls(); }
    }
  }, { signal: lifetime.signal });
  return {
    setContext(nextAgent: SupportAgent | null, nextThread?: SupportThread) {
      const same = nextAgent?.session === agent?.session && nextThread?.id === thread?.id && Boolean(nextThread?.customerProfile) === Boolean(thread?.customerProfile);
      agent = nextAgent;
      thread = nextThread;
      trigger.hidden = !linkedCustomer();
      form.hidden = !thread?.customerProfile;
      if (!same) {
        generation++;
        modal.close(false);
        busy = false;
        useProfile(thread?.customerProfile);
      }
      modal.context.textContent = thread ? `${thread.user.name} · #${thread.user.id}` : "";
      if (thread && linkedCustomer()) admin.href = `/admin/?view=users&tab=accounts&q=id%3A${thread.user.id}`;
      else admin.removeAttribute("href");
      controls();
    },
    dispose() { generation++; lifetime.abort(); unsubscribe(); modal.dispose(); agent = null; thread = undefined; baseline = undefined; },
  };
}
