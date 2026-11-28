import { publicCatalogWordsOf } from "../i18n/public-catalog";
import { modelPricing, officialPricing, type ModelPriceField } from "../lib/model-pricing";
import { groupByVendor } from "../lib/model-vendor";
import { localOfferName, localOfferDescription } from "../lib/offer-names";
import { tokenPlanTermWordsOf, termLabel, bonusModelsLabel, planTerms } from "../i18n/token-plan-terms";

type Row = Record<string, unknown>;
interface Catalog { schema_version: 1; models: Row[]; token_plans: Row[]; subscriptions: Row[]; token_plan_bonus_models?: string[] }
const escape = (value: unknown) => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 1000;
const formatNames: Record<string, string> = { "anthropic-messages": "Messages", "openai-completions": "Chat Completions", "openai-responses": "Responses", "gemini-generatecontent": "GenerateContent" };
function clientFormats(model: Row, client: string): string[] {
  const projection = model.client_formats;
  if (!projection || typeof projection !== "object" || Array.isArray(projection) || !Array.isArray(model.formats)) return [];
  const formats = (projection as Record<string, unknown>)[client];
  return Array.isArray(formats) ? formats.filter((value): value is string => typeof value === "string" && Object.hasOwn(formatNames, value) && (model.formats as unknown[]).includes(value)) : [];
}
function parseCatalog(value: unknown): Catalog {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid catalog");
  const data = value as Record<string, unknown>;
  if (data.schema_version !== 1 || ![data.models, data.token_plans, data.subscriptions].every(rows => Array.isArray(rows) && rows.length <= 5000 && rows.every(row => row && typeof row === "object" && !Array.isArray(row)))) throw Error("Invalid catalog");
  const catalog = data as unknown as Catalog;
  for (const plan of [...catalog.token_plans, ...catalog.subscriptions]) {
    if (!text(plan.code) || !text(plan.name) || plan.currency !== "CNY" || !integer(plan.price_micro) || !integer(plan.period_days) || plan.period_days === 0) throw Error("Invalid plan");
  }
  for (const plan of catalog.token_plans) {
    // Token Plan is guaranteed quota only (owner decision 2026-11-18). The API
    // may still send burst_usd_micro (as 0); it is tolerated and never shown.
    if (plan.status !== "available" || !integer(plan.quota_usd_micro) || (plan.burst_usd_micro !== undefined && !integer(plan.burst_usd_micro)) || typeof plan.new_user_only !== "boolean") throw Error("Invalid Token Plan");
  }
  for (const plan of catalog.subscriptions) {
    if (!["available", "sold_out"].includes(String(plan.status)) || !integer(plan.share_denominator) || plan.share_denominator === 0) throw Error("Invalid subscription");
    // Family, open and free_seats arrived with Ultra / Max / Pro (2026-11-04); older servers omit them.
    if (plan.family !== undefined && !["", "ultra", "max", "pro"].includes(String(plan.family))) throw Error("Invalid subscription");
    if ((plan.open !== undefined && typeof plan.open !== "boolean") || (plan.free_seats !== undefined && !integer(plan.free_seats))) throw Error("Invalid subscription");
  }
  const models = catalog.models.filter(model => model.offered === true && model.routable === true && ["api", "claude_code", "web_chat"].some(client => clientFormats(model, client).length > 0));
  for (const model of models) {
    if (!text(model.model) || (model.display_name !== undefined && !text(model.display_name))) throw Error("Invalid model");
  }
  // The bonus model scope arrived with Token Plan terms (2026-11-18); older servers omit it.
  const bonusModels = data.token_plan_bonus_models;
  if (bonusModels !== undefined && (!Array.isArray(bonusModels) || bonusModels.length > 100 || !bonusModels.every(text))) throw Error("Invalid bonus models");
  return { schema_version: 1, models, token_plans: catalog.token_plans, subscriptions: catalog.subscriptions, token_plan_bonus_models: bonusModels as string[] | undefined };
}

const widgets = [...document.querySelectorAll<HTMLElement>("[data-public-catalog]")];
let request: Promise<Catalog> | undefined;
const readCatalog = () => request ??= (async () => {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch("/api/app/public/catalog", { credentials: "omit", cache: "no-store", signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw Error("Catalog unavailable");
    return parseCatalog(await response.json());
  } finally { clearTimeout(deadline); }
})();

function render(widget: HTMLElement, catalog: Catalog, widgetIndex: number): string {
  const words = publicCatalogWordsOf(widget.dataset.language ?? "en");
  const language = widget.dataset.language ?? "en";
  const currency = (micro: unknown, code: string) => integer(micro) ? new Intl.NumberFormat(language, { style: "currency", currency: code, minimumFractionDigits: 0, maximumFractionDigits: 6 }).format(micro / 1_000_000) : "—";
  const period = (days: unknown) => words.days.replace("{n}", String(days));
  if (widget.dataset.kind === "models") {
    const models = catalog.models.filter(model => model.offered === true);
    if (!models.length) return `<p class="public-catalog-status" role="status">${escape(words.empty)}</p>`;
    const usd = (micro: unknown) => integer(micro) ? new Intl.NumberFormat(language, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(micro / 1_000_000) : "—";
    const compact = new Intl.NumberFormat(language, { notation: "compact", maximumFractionDigits: 1 });
    // The public board shows input and output only; cache and access details
    // live with each Key in the account. The official list price is struck
    // through beside the Fells price only where it differs, and on the long
    // tier only when both use the same threshold.
    const price = (model: Row, field: ModelPriceField) => {
      const pricing = modelPricing(model), official = officialPricing(model);
      const selling = pricing.rates[field];
      const list = field.endsWith("_long") && official?.longThreshold !== pricing.longThreshold ? undefined : official?.rates[field];
      if (selling === undefined || list === undefined || list === selling) return `<span class="pm-price"><b data-price="fells">${escape(usd(selling))}</b></span>`;
      return `<span class="pm-price"><b data-price="fells"><span class="sr-only">${escape(words.fellsPrice)} </span>${escape(usd(selling))}</b><s data-price="official"><span class="sr-only">${escape(words.officialPrice)} </span>${escape(usd(list))}</s></span>`;
    };
    const percent = new Intl.NumberFormat(language, { maximumFractionDigits: 2 });
    const discount = (bp: number | null) => bp !== null && bp > 0 && bp < 10_000 ? words.discount.replace("{off}", percent.format((10_000 - bp) / 100)).replace("{zhe}", percent.format(bp / 1000)) : "";
    const cells = (model: Row, long: boolean) => (["usd_in", "usd_out"] as const).map(field => `<td role="cell" data-rate="${field}" data-label="${escape(field === "usd_in" ? words.input : words.output)}">${price(model, long ? `${field}_long` as const : field)}</td>`).join("");
    const entry = (model: Row, thresholds: Set<number>) => {
      const pricing = modelPricing(model);
      const long = pricing.longThreshold > 0;
      if (long) thresholds.add(pricing.longThreshold);
      const saving = officialPricing(model) ? discount(pricing.priceBP) : "";
      const label = saving || (pricing.source === "reference" ? words.officialReference : pricing.source === "unavailable" ? words.unavailablePrice : "");
      const tag = label ? `<span class="pm-tag" data-model-price-label${saving ? " data-model-discount" : ""}>${escape(label)}</span>` : "";
      const request = pricing.rates.usd_req ? `<span class="pm-extra" data-rate="usd_req">${escape(words.request)} ${price(model, "usd_req")}</span>` : "";
      const base = `<tr role="row" class="pm-row" data-public-model="${escape(model.model)}" data-price-source="${pricing.source}"><th role="rowheader" scope="row"><span class="pm-name">${escape(model.display_name || model.model)}${tag}</span><code class="pm-id">${escape(model.model)}</code>${request}</th>${cells(model, false)}</tr>`;
      const tier = long ? `<tr role="row" class="pm-tier" data-public-model-tier="${escape(model.model)}"><th role="rowheader" scope="row">${escape(words.longShort.replace("{n}", compact.format(pricing.longThreshold)))}</th>${cells(model, true)}</tr>` : "";
      return `<tbody role="rowgroup" class="pm-model">${base}${tier}</tbody>`;
    };
    const byRelease = models.map(row => ({
      model: String(row.model),
      vendor: typeof row.vendor === "string" ? row.vendor.trim() : undefined,
      released: integer(row.released) ? row.released : 0,
      row,
    })).sort((a, b) => b.released - a.released);
    const groups = groupByVendor(byRelease);
    const head = `<thead role="rowgroup"><tr role="row">${[words.model, words.input, words.output].map(label => `<th role="columnheader" scope="col">${escape(label)}</th>`).join("")}</tr></thead>`;
    const board = ({ models }: typeof groups[number]) => {
      const thresholds = new Set<number>();
      const body = models.map(({ row }) => entry(row, thresholds)).join("");
      const compared = models.some(({ row }) => officialPricing(row) !== null);
      const legend = compared ? `<span class="pm-legend" data-price-legend><b>${escape(words.fellsPrice)}</b><s>${escape(words.officialPrice)}</s></span>` : "";
      const notes = [...thresholds].sort((a, b) => a - b).map(n => `<p data-long-note><b>${escape(words.longShort.replace("{n}", compact.format(n)))}</b> ${escape(words.long.replace("{n}", n.toLocaleString(language)))}</p>`).join("");
      return `<div class="pm-bar">${legend}<span class="pm-unit">${escape(words.unitShort)}</span></div><table class="pm-table" role="table"><caption class="sr-only">${escape(words.models)} · ${escape(words.unitShort)}</caption><colgroup><col><col class="pm-col"><col class="pm-col"></colgroup>${head}${body}</table><div class="pm-notes">${notes}<p>${escape(words.cacheNote)} ${escape(words.priceNote)}</p></div>`;
    };
    if (groups.length === 1) return `<div class="pm">${board(groups[0])}</div>`;

    const id = (index: number) => `public-catalog-${widgetIndex}-vendor-${index}`;
    const tabs = groups.map(({ vendor, models }, index) => `<button type="button" class="pm-tab" role="tab" id="${id(index)}-tab" aria-controls="${id(index)}-panel" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}"><span>${escape(vendor || words.otherVendor)}</span> <span class="pm-tab-count">${models.length}</span></button>`).join("");
    const panels = groups.map((group, index) => `<div class="pm-panel" role="tabpanel" id="${id(index)}-panel" aria-labelledby="${id(index)}-tab" tabindex="0"${index === 0 ? "" : " hidden"}>${board(group)}</div>`).join("");
    return `<div class="pm"><div class="pm-tabs" role="tablist" aria-label="${escape(words.models)}">${tabs}</div>${panels}</div>`;
  }
  const token = widget.dataset.kind === "token_plans";
  const plans = token ? catalog.token_plans : catalog.subscriptions;
  if (!plans.length) return `<p class="public-catalog-status" role="status">${escape(words.empty)}</p>`;
  if (!token) {
    // One card per family and tier: seats left / full / not open yet. Only a
    // card with a free seat opens support with a purchase intent.
    const card = (plan: Row) => {
      const name = localOfferName(plan.name, language);
      const open = plan.open !== false, available = open && plan.status === "available";
      const free = integer(plan.free_seats) && plan.free_seats > 0 ? plan.free_seats : 0;
      const state = !open ? "not_open" : available ? "available" : "sold_out";
      const badge = !open ? words.notOpen : available ? (free ? words.seatsLeft.replace("{n}", String(free)) : words.available) : words.full;
      const description = localOfferDescription(plan.family, plan.share_denominator, language) || words.share.replace("{share}", Number(plan.share_denominator) === 1 ? "1" : `1/${plan.share_denominator}`);
      const action = available
        ? `<button type="button" class="btn btn-primary" data-open-customer-support data-purchase-market data-support-title="${escape(name)}" data-support-product="subscription" data-support-code="${escape(plan.code)}" data-support-amount="${escape(plan.price_micro)}" data-support-days="${escape(plan.period_days)}">${escape(words.buyNow)}</button>`
        : `<button type="button" class="btn btn-ghost" disabled data-subscription-unavailable>${escape(open ? words.noSeats : words.notOpen)}</button>`;
      return `<article class="public-product" data-public-product="${escape(plan.code)}" data-status="${escape(state)}"${plan.family ? ` data-family="${escape(plan.family)}"` : ""}><header class="public-product-heading"><h3>${escape(name)}</h3><span class="public-product-status">${escape(badge)}</span></header><p class="public-product-price"><strong>${escape(currency(plan.price_micro, "CNY"))}</strong><small>${escape(words.perMonth)}</small></p><p class="public-product-note">${escape(description)}</p>${action}</article>`;
    };
    return `<div class="public-catalog-grid">${plans.map(card).join("")}</div><p class="public-catalog-note">${escape(words.shareNote)}</p>`;
  }
  // Token Plans: one shared period selector (monthly … yearly) drives every
  // card. Prices, bonus ratios and the bonus model scope all come from the
  // API; a server without terms sells monthly only, exactly as before.
  const termWords = tokenPlanTermWordsOf(language);
  const bonusModels = bonusModelsLabel(catalog.token_plan_bonus_models, language);
  const offered = [...new Set(plans.flatMap(plan => planTerms(plan).map(term => term.months)))].sort((a, b) => a - b);
  const selected = offered.includes(Number(widget.dataset.term)) ? Number(widget.dataset.term) : (offered[0] ?? 1);
  const pctOf = (months: number) => plans.map(plan => planTerms(plan).find(term => term.months === months)?.bonusPct).find(pct => pct !== undefined) ?? 0;
  const selector = offered.length > 1 ? `<div class="public-term-selector" role="group" aria-label="${escape(termWords.termSelector)}" data-token-terms>${offered.map(months => `<button type="button" class="public-term" data-token-term="${months}" aria-pressed="${months === selected}">${escape(termLabel(months, language))}${pctOf(months) ? `<small>${escape(termWords.bonusPct.replace("{pct}", String(pctOf(months))))}</small>` : ""}</button>`).join("")}</div>` : "";
  const card = (plan: Row) => {
    const terms = planTerms(plan), term = terms.find(item => item.months === selected) ?? terms[0];
    const name = localOfferName(plan.name, language), title = term && term.months > 1 ? `${name} · ${termLabel(term.months, language)}` : name;
    const price = term ? term.priceMicro : Number(plan.price_micro);
    const unit = term && term.months > 1 ? termWords.forMonths.replace("{n}", String(term.months)) : period(plan.period_days);
    const quota = `<div><dt>${escape(words.guaranteed)} <small>${escape(termWords.perPeriod)}</small></dt><dd>${escape(currency(plan.quota_usd_micro, "USD"))}</dd></div>`;
    const bonus = term && term.bonusUsdMicro > 0 ? `<div data-token-bonus="${term.bonusPct}"><dt>${escape(termWords.bonus.replace("{models}", bonusModels))} <small>${escape(termWords.perPeriod)}</small></dt><dd>${escape(currency(term.bonusUsdMicro, "USD"))}</dd></div>` : "";
    const onlyMonthly = term && term.months !== selected ? `<p class="public-product-note" data-term-unavailable>${escape(termWords.monthlyOnly)}</p>` : "";
    return `<article class="public-product" data-public-product="${escape(plan.code)}" data-status="${escape(plan.status)}" data-term-months="${term?.months ?? 1}"><header class="public-product-heading"><h3>${escape(name)}</h3><span class="public-product-status">${escape(plan.status === "sold_out" ? words.soldOut : plan.new_user_only ? words.trial : words.available)}</span></header><p class="public-product-price"><strong>${escape(currency(price, "CNY"))}</strong><small>${escape(unit)}</small></p><dl>${quota}${bonus}</dl>${onlyMonthly}<p class="public-product-note" data-trial-model-scope>${escape(words.trialScope)}</p><button type="button" class="btn btn-ghost" data-open-customer-support data-purchase-market data-support-title="${escape(title)}" data-support-product="token_plan" data-support-code="${escape(plan.code)}" data-support-amount="${escape(price)}" data-support-days="${escape(plan.period_days)}" data-support-months="${term?.months ?? 1}">${escape(words.account)} →</button></article>`;
  };
  const pct = pctOf(selected);
  const notes = [pct ? termWords.bonusNote.replace("{pct}", String(pct)).replaceAll("{models}", bonusModels) : "", offered.length > 1 ? termWords.termsNote : "", words.periodNote, termWords.nonRefundable].filter(Boolean);
  return `${selector}<div class="public-catalog-grid">${plans.map(card).join("")}</div>${notes.map(note => `<p class="public-catalog-note">${escape(note)}</p>`).join("")}`;
}

function bindProviderTabs(content: Element) {
  const tablist = content.querySelector(".pm-tabs");
  if (!tablist) return;
  const tabs = [...tablist.querySelectorAll<HTMLButtonElement>(".pm-tab")];
  const panels = [...content.querySelectorAll<HTMLElement>(".pm-panel")];
  let active = 0;

  const select = (index: number) => {
    if (index !== active) {
      tabs[active].setAttribute("aria-selected", "false");
      tabs[active].tabIndex = -1;
      panels[active].hidden = true;
      tabs[index].setAttribute("aria-selected", "true");
      tabs[index].tabIndex = 0;
      panels[index].hidden = false;
      active = index;
    }
    tabs[index].focus();
  };

  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener("click", () => select(index));
    tab.addEventListener("keydown", event => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      let next: number;
      switch (event.key) {
        case "ArrowLeft": next = (index - 1 + tabs.length) % tabs.length; break;
        case "ArrowRight": next = (index + 1) % tabs.length; break;
        case "Home": next = 0; break;
        case "End": next = tabs.length - 1; break;
        default: return;
      }
      event.preventDefault();
      event.stopPropagation();
      select(next);
    });
  }
}

async function load() {
  for (const widget of widgets) {
    widget.setAttribute("aria-busy", "true"); widget.dataset.publicCatalogState = "loading";
    const content = widget.querySelector("[data-public-catalog-content]");
    if (content) content.innerHTML = `<p class="public-catalog-status" role="status">${escape(publicCatalogWordsOf(widget.dataset.language ?? "en").loading)}</p>`;
  }
  try {
    const catalog = await readCatalog();
    for (const [index, widget] of widgets.entries()) {
      const content = widget.querySelector("[data-public-catalog-content]");
      if (content) {
        content.innerHTML = render(widget, catalog, index);
        bindProviderTabs(content);
      }
      widget.dataset.publicCatalogState = "ready";
    }
  } catch {
    for (const widget of widgets) {
      const words = publicCatalogWordsOf(widget.dataset.language ?? "en");
      const content = widget.querySelector("[data-public-catalog-content]");
      if (content) content.innerHTML = `<div class="public-catalog-status" role="status"><p>${escape(words.error)}</p><button type="button" class="btn btn-ghost" data-public-catalog-retry>${escape(words.retry)}</button></div>`;
      widget.dataset.publicCatalogState = "error";
    }
  } finally { for (const widget of widgets) widget.setAttribute("aria-busy", "false"); }
}
if (widgets.length) {
  document.addEventListener("click", event => {
    if (!(event.target instanceof Element)) return;
    const term = event.target.closest<HTMLElement>("[data-token-term]");
    const widget = term?.closest<HTMLElement>("[data-public-catalog]");
    if (term && widget) {
      // Switching the period re-renders from the catalog already read; it never refetches.
      widget.dataset.term = term.dataset.tokenTerm;
      void readCatalog().then(catalog => {
        const content = widget.querySelector("[data-public-catalog-content]");
        if (content) { content.innerHTML = render(widget, catalog, widgets.indexOf(widget)); bindProviderTabs(content); }
        widget.querySelector<HTMLElement>(`[data-token-term="${widget.dataset.term}"]`)?.focus();
      }).catch(() => undefined);
      return;
    }
    if (!event.target.closest("[data-public-catalog-retry]")) return;
    request = undefined; void load();
  });
  void load();
}
