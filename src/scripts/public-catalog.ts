import { publicCatalogWordsOf } from "../i18n/public-catalog";
import { modelPricing, officialPricing, type ModelPriceField } from "../lib/model-pricing";
import { groupByVendor } from "../lib/model-vendor";
import { localOfferName, localOfferDescription } from "../lib/offer-names";

type Row = Record<string, unknown>;
interface Catalog { schema_version: 1; models: Row[]; token_plans: Row[]; subscriptions: Row[] }
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
    // The API uses zero for plans without optional burst, including its trial.
    // A configured nonzero burst is a total ceiling that includes the guarantee.
    if (plan.status !== "available" || !integer(plan.quota_usd_micro) || !integer(plan.burst_usd_micro) || (plan.burst_usd_micro !== 0 && plan.burst_usd_micro < plan.quota_usd_micro) || typeof plan.new_user_only !== "boolean") throw Error("Invalid Token Plan");
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
  return { schema_version: 1, models, token_plans: catalog.token_plans, subscriptions: catalog.subscriptions };
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

function render(widget: HTMLElement, catalog: Catalog): string {
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
    const compared = models.some(model => officialPricing(model) !== null);
    const thresholds = new Set<number>();
    const cells = (model: Row, long: boolean) => (["usd_in", "usd_out"] as const).map(field => `<td role="cell" data-rate="${field}" data-label="${escape(field === "usd_in" ? words.input : words.output)}">${price(model, long ? `${field}_long` as const : field)}</td>`).join("");
    const entry = (model: Row) => {
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
    const groups = groupByVendor(models.map(row => ({ model: String(row.model), vendor: typeof row.vendor === "string" && row.vendor.trim() ? row.vendor.trim() : undefined, row })));
    const body = groups.map(group => `${groups.length > 1 ? `<tbody role="rowgroup" class="pm-group" data-vendor="${escape(group.vendor)}"><tr role="row"><th role="rowheader" scope="rowgroup" colspan="3">${escape(group.vendor || words.otherVendor)}<span>${group.models.length}</span></th></tr></tbody>` : ""}${group.models.map(item => entry(item.row)).join("")}`).join("");
    const legend = compared ? `<span class="pm-legend" data-price-legend><b>${escape(words.fellsPrice)}</b><s>${escape(words.officialPrice)}</s></span>` : "";
    const notes = [...thresholds].sort((a, b) => a - b).map(n => `<p data-long-note><b>${escape(words.longShort.replace("{n}", compact.format(n)))}</b> ${escape(words.long.replace("{n}", n.toLocaleString(language)))}</p>`).join("");
    const head = `<thead role="rowgroup"><tr role="row">${[words.model, words.input, words.output].map(label => `<th role="columnheader" scope="col">${escape(label)}</th>`).join("")}</tr></thead>`;
    return `<div class="pm"><div class="pm-bar">${legend}<span class="pm-unit">${escape(words.unitShort)}</span></div><table class="pm-table" role="table"><caption class="sr-only">${escape(words.models)} · ${escape(words.unitShort)}</caption><colgroup><col><col class="pm-col"><col class="pm-col"></colgroup>${head}${body}</table><div class="pm-notes">${notes}<p>${escape(words.cacheNote)} ${escape(words.priceNote)}</p></div></div>`;
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
      return `<article class="public-product" data-public-product="${escape(plan.code)}" data-status="${escape(state)}"${plan.family ? ` data-family="${escape(plan.family)}"` : ""}><span class="public-product-status">${escape(badge)}</span><h3>${escape(name)}</h3><p class="public-product-price"><strong>${escape(currency(plan.price_micro, "CNY"))}</strong><small>${escape(words.perMonth)}</small></p><p class="public-product-note">${escape(description)}</p>${action}</article>`;
    };
    return `<div class="public-catalog-grid">${plans.map(card).join("")}</div><p class="public-catalog-note">${escape(words.shareNote)}</p>`;
  }
  return `<div class="public-catalog-grid">${plans.map(plan => `<article class="public-product" data-public-product="${escape(plan.code)}" data-status="${escape(plan.status)}"><span class="public-product-status">${escape(plan.status === "sold_out" ? words.soldOut : token && plan.new_user_only ? words.trial : words.available)}</span><h3>${escape(localOfferName(plan.name, language))}</h3><p class="public-product-price"><strong>${escape(currency(plan.price_micro, "CNY"))}</strong><small>${escape(period(plan.period_days))}</small></p>${token ? `<dl><div><dt>${escape(words.guaranteed)}</dt><dd>${escape(currency(plan.quota_usd_micro, "USD"))}</dd></div>${Number(plan.burst_usd_micro) > Number(plan.quota_usd_micro) ? `<div><dt>${escape(words.burst)}</dt><dd>${escape(currency(plan.burst_usd_micro, "USD"))}</dd></div>` : ""}</dl>${plan.new_user_only ? `<p class="public-product-note" data-trial-model-scope>${escape(words.trialScope)}</p>` : ""}` : `<p class="public-product-note">${escape(words.share.replace("{share}", Number(plan.share_denominator) === 1 ? "1" : `1/${plan.share_denominator}`))}</p>`}<button type="button" class="btn btn-ghost" data-open-customer-support data-purchase-market data-support-title="${escape(localOfferName(plan.name, language))}" data-support-product="${token ? "token_plan" : "subscription"}" data-support-code="${escape(plan.code)}" data-support-amount="${escape(plan.price_micro)}" data-support-days="${escape(plan.period_days)}">${escape(words.account)} →</button></article>`).join("")}</div><p class="public-catalog-note">${escape(token ? words.burstNote : words.shareNote)}</p>`;
}

async function load() {
  for (const widget of widgets) {
    widget.setAttribute("aria-busy", "true"); widget.dataset.publicCatalogState = "loading";
    const content = widget.querySelector("[data-public-catalog-content]");
    if (content) content.innerHTML = `<p class="public-catalog-status" role="status">${escape(publicCatalogWordsOf(widget.dataset.language ?? "en").loading)}</p>`;
  }
  try {
    const catalog = await readCatalog();
    for (const widget of widgets) {
      const content = widget.querySelector("[data-public-catalog-content]");
      if (content) content.innerHTML = render(widget, catalog);
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
    if (!(event.target instanceof Element) || !event.target.closest("[data-public-catalog-retry]")) return;
    request = undefined; void load();
  });
  void load();
}
