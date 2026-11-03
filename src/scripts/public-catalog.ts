import { publicCatalogWordsOf } from "../i18n/public-catalog";
import { modelPricing, officialPricing, cachePriceApplicability, type ModelPriceField } from "../lib/model-pricing";

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
    // Fells price first; the official list price is struck through beneath it
    // only where it differs, and the long tier only when both use the same threshold.
    const price = (model: Row, field: string) => {
      const pricing = modelPricing(model), official = officialPricing(model);
      const selling = pricing.rates[field as ModelPriceField];
      const list = field.endsWith("_long") && official?.longThreshold !== pricing.longThreshold ? undefined : official?.rates[field as ModelPriceField];
      if (selling === undefined || list === undefined || list === selling) return escape(currency(selling, "USD"));
      return `<span class="public-price"><span data-price="fells"><span class="sr-only">${escape(words.fellsPrice)} </span>${escape(currency(selling, "USD"))}</span><s data-price="official"><span class="sr-only">${escape(words.officialPrice)} </span>${escape(currency(list, "USD"))}</s></span>`;
    };
    const percent = new Intl.NumberFormat(language, { maximumFractionDigits: 2 });
    const discount = (bp: number | null) => bp !== null && bp > 0 && bp < 10_000 ? words.discount.replace("{off}", percent.format((10_000 - bp) / 100)).replace("{zhe}", percent.format(bp / 1000)) : "";
    const compared = models.some(model => officialPricing(model) !== null);
    const clients = (model: Row) => {
      const api = clientFormats(model, "api");
      const cli = clientFormats(model, "claude_code").length > 0;
      const web = clientFormats(model, "web_chat").length > 0;
      return [...api.map(format => `API · ${formatNames[format]}`), ...(cli ? ["Claude Code"] : []), ...(web ? [words.webChat] : [])].map(escape).join("<br>") || "—";
    };
    const rates = (model: Row, long = false) => ["usd_in", "usd_out", "usd_cache_r", "usd_cache_w", "usd_cache_w_1h", "usd_cache_w_30m", "usd_cache_w_12h"].map(field => {
      const applicable = cachePriceApplicability(model, field);
      const value = applicable === true ? price(model, long ? field + "_long" : field) : escape(applicable === false ? words.notApplicable : "—");
      return `<td data-rate="${field}">${value}</td>`;
    }).join("");
    const rows = models.map(model => {
      const pricing = modelPricing(model);
      const long = pricing.longThreshold > 0;
      const saving = officialPricing(model) ? discount(pricing.priceBP) : "";
      const priceLabel = saving || (pricing.source === "selling" ? words.fellsPrice : pricing.source === "reference" ? words.officialReference : words.unavailablePrice);
      const baseRow = `<tr data-public-model="${escape(model.model)}" data-price-source="${pricing.source}"><th scope="row">${escape(model.display_name || model.model)}<small>${escape(model.model)}</small><small data-model-price-label${saving ? " data-model-discount" : ""}>${escape(priceLabel)}</small></th>${rates(model)}<td rowspan="${long ? 2 : 1}">${price(model, "usd_req")}</td><td rowspan="${long ? 2 : 1}">${clients(model)}</td></tr>`;
      const longRow = long ? `<tr data-public-model-tier="${escape(model.model)}"><th scope="row"><small>${escape(words.long.replace("{n}", pricing.longThreshold.toLocaleString(language)))}</small></th>${rates(model, true)}</tr>` : "";
      return baseRow + longRow;
    }).join("");
    const legend = compared ? `<span class="public-price-legend" data-price-legend><b>${escape(words.fellsPrice)}</b><s>${escape(words.officialPrice)}</s></span>` : "";
    return `<p class="public-catalog-note">${legend}${escape(words.unit)}</p><div class="public-models-scroll" tabindex="0" role="region" aria-label="${escape(words.models)}"><table class="public-models-table"><thead><tr>${[words.model, words.input, words.output, words.cache, words.cacheWrite, words.cacheWrite1h, words.cacheWrite30m, words.cacheWrite12h, words.request, words.clients].map(label => `<th scope="col">${escape(label)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div><p class="public-catalog-note">${escape(words.priceNote)}</p>`;
  }
  const token = widget.dataset.kind === "token_plans";
  const plans = token ? catalog.token_plans : catalog.subscriptions;
  if (!plans.length) return `<p class="public-catalog-status" role="status">${escape(words.empty)}</p>`;
  return `<div class="public-catalog-grid">${plans.map(plan => `<article class="public-product" data-public-product="${escape(plan.code)}" data-status="${escape(plan.status)}"><span class="public-product-status">${escape(plan.status === "sold_out" ? words.soldOut : token && plan.new_user_only ? words.trial : words.available)}</span><h3>${escape(plan.name)}</h3><p class="public-product-price"><strong>${escape(currency(plan.price_micro, "CNY"))}</strong><small>${escape(period(plan.period_days))}</small></p>${token ? `<dl><div><dt>${escape(words.guaranteed)}</dt><dd>${escape(currency(plan.quota_usd_micro, "USD"))}</dd></div>${Number(plan.burst_usd_micro) > Number(plan.quota_usd_micro) ? `<div><dt>${escape(words.burst)}</dt><dd>${escape(currency(plan.burst_usd_micro, "USD"))}</dd></div>` : ""}</dl>${plan.new_user_only ? `<p class="public-product-note" data-trial-model-scope>${escape(words.trialScope)}</p>` : ""}` : `<p class="public-product-note">${escape(words.share.replace("{share}", Number(plan.share_denominator) === 1 ? "1" : `1/${plan.share_denominator}`))}</p>`}<button type="button" class="btn btn-ghost" data-open-customer-support data-purchase-market data-support-title="${escape(plan.name)}" data-support-product="${token ? "token_plan" : "subscription"}" data-support-code="${escape(plan.code)}" data-support-amount="${escape(plan.price_micro)}" data-support-days="${escape(plan.period_days)}">${escape(words.account)} →</button></article>`).join("")}</div><p class="public-catalog-note">${escape(token ? words.burstNote : words.shareNote)}</p>`;
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
