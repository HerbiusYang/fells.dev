import type { Dict } from "./en";
import { en } from "./en";
import { zh } from "./zh";
import { zhHant } from "./zh-hant";
import { ja } from "./ja";
import { ko } from "./ko";
import { es } from "./es";
import type { PagesDict } from "./pages/en";
import { pagesEn } from "./pages/en";
import { pagesZh } from "./pages/zh";
import { pagesZhHant } from "./pages/zh-hant";
import { pagesJa } from "./pages/ja";
import { pagesKo } from "./pages/ko";
import { pagesEs } from "./pages/es";
import type { AppDict } from "./app/en";
import { appEn } from "./app/en";
import { appZh } from "./app/zh";
import { appZhHant } from "./app/zh-hant";
import { appJa } from "./app/ja";
import { appKo } from "./app/ko";
import { appEs } from "./app/es";
import { tokenPlans, groupSeats, FX, officialCny, cny, usd } from "../data/catalog";

export type Locale = { code: string; path: string; hreflang: string; label: string; t: Dict; p: PagesDict; a: AppDict };

// Order = order in the language menu. `code` is the URL segment (en has none).
export const locales: Locale[] = [
  { code: "en", path: "/", hreflang: "en", label: "English", t: en, p: pagesEn, a: appEn },
  { code: "zh", path: "/zh/", hreflang: "zh-CN", label: "简体中文", t: zh, p: pagesZh, a: appZh },
  { code: "zh-hant", path: "/zh-hant/", hreflang: "zh-TW", label: "繁體中文", t: zhHant, p: pagesZhHant, a: appZhHant },
  { code: "ja", path: "/ja/", hreflang: "ja", label: "日本語", t: ja, p: pagesJa, a: appJa },
  { code: "ko", path: "/ko/", hreflang: "ko", label: "한국어", t: ko, p: pagesKo, a: appKo },
  { code: "es", path: "/es/", hreflang: "es", label: "Español", t: es, p: pagesEs, a: appEs },
];

export const localeOf = (t: Dict): Locale => locales.find((l) => l.t === t) ?? locales[0];
export const pagesOf = (t: Dict): PagesDict => localeOf(t).p;
export const appOf = (t: Dict): AppDict => localeOf(t).a;

// Locale-aware internal link: link(t, "market") → "/zh/market". "" is the home page.
export const link = (t: Dict, slug = ""): string => localeOf(t).path + slug;

// Static paths for an inner page in every non-default locale.
export const langPaths = () => locales.filter((l) => l.code !== "en").map((l) => ({ params: { lang: l.code }, props: { t: l.t } }));

export function fmtOff(t: Dict, n: number): string {
  if (t.ui.discountStyle === "zhe") return `${Math.round(100 - n) / 10} 折`;
  return t.ui.off.replace("{n}", String(n));
}

// Percent saved against the official price of the same USD quota.
export const offOf = (price: number, quotaUsd: number) => Math.round((1 - price / officialCny(quotaUsd)) * 100);

// "{name}" placeholders in copy.
export const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k: string) => String(v[k] ?? m));

// Fills price facts from the catalog into copy, so numbers in headlines never drift from the cards:
// {pct} best percent off official prices · {zhe} the same as 折 · {off} the trial's discount in the page's style ·
// {trial} / {trialQuota} trial price and quota · {tp} / {gp} cheapest monthly Token Plan / group seat · {fx} CNY per USD.
export function deal(t: Dict, s: string): string {
  const trial = tokenPlans.find((x) => x.period === "once")!;
  const pct = Math.max(...tokenPlans.map((x) => offOf(x.price, x.quota)));
  return fill(s, {
    pct,
    zhe: (100 - pct) / 10,
    off: fmtOff(t, offOf(trial.price, trial.quota)),
    trial: cny(trial.price),
    trialQuota: usd(trial.quota),
    tp: cny(Math.min(...tokenPlans.filter((x) => x.period === "month").map((x) => x.price))),
    gp: cny(Math.min(...groupSeats.map((x) => x.price))),
    fx: FX,
  });
}
