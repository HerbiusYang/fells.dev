import { publicFacts } from "../i18n/public-facts";
import { agreementText } from "../lib/account-api";

for (const root of document.querySelectorAll<HTMLElement>("[data-public-policy]")) {
  const language = root.dataset.language ?? "en", words = publicFacts(language);
  const panel = root.querySelector<HTMLElement>("[data-policy-agreement]")!;
  const state = root.querySelector<HTMLElement>("[data-policy-state]")!;
  const original = root.querySelector<HTMLElement>("[data-policy-original]")!;
  const retry = root.querySelector<HTMLButtonElement>("[data-policy-retry]")!;
  let busy = false;
  async function load() {
    if (busy) return;
    busy = true; retry.hidden = true; original.hidden = true; state.hidden = false; state.textContent = words.loading; panel.setAttribute("aria-busy", "true");
    const controller = new AbortController(), deadline = setTimeout(() => controller.abort(), 8000);
    try {
      const configuredLanguage = /^zh(?:-|$)/i.test(language) ? "zh-CN" : "en";
      const response = await fetch(`/api/app/agreement?lang=${encodeURIComponent(configuredLanguage)}`, { credentials: "omit", cache: "no-store", signal: controller.signal, headers: { Accept: "application/json", "Accept-Language": language } });
      if (!response.ok) throw Error("Agreement unavailable");
      const value: unknown = await response.json();
      if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid agreement");
      const data = value as Record<string, unknown>;
      if (typeof data.version !== "string" || !data.version.trim() || typeof data.h1 !== "string" || !data.h1.trim() || typeof data.lede !== "string" || !Array.isArray(data.clauses) || !data.clauses.length || data.clauses.length > 500 || !data.clauses.every(clause => clause && typeof clause === "object" && !Array.isArray(clause))) throw Error("Invalid agreement");
      original.lang = configuredLanguage;
      root.querySelector<HTMLElement>("[data-policy-title]")!.textContent = agreementText(data.h1);
      root.querySelector<HTMLElement>("[data-policy-version]")!.textContent = `${words.version}: ${data.version}${typeof data.updated === "string" && data.updated ? ` · ${data.updated}` : ""}`;
      root.querySelector<HTMLElement>("[data-policy-text]")!.textContent = [data.lede, ...data.clauses.map(clause => Object.values(clause).flat().filter(item => typeof item === "string").join("\n"))].map(agreementText).join("\n\n");
      original.hidden = false; state.hidden = true;
    } catch { state.textContent = words.error; retry.hidden = false; }
    finally { clearTimeout(deadline); busy = false; panel.setAttribute("aria-busy", "false"); }
  }
  retry.addEventListener("click", () => { void load(); });
  void load();
}
