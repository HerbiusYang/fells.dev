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

export type Locale = { code: string; path: string; hreflang: string; ogLocale: string; label: string; t: Dict; p: PagesDict; a: AppDict };

// Order = order in the language menu. `code` is the URL segment (en has none).
export const locales: Locale[] = [
  { code: "en", path: "/", hreflang: "en", ogLocale: "en_US", label: "English", t: en, p: pagesEn, a: appEn },
  { code: "zh", path: "/zh/", hreflang: "zh-CN", ogLocale: "zh_CN", label: "简体中文", t: zh, p: pagesZh, a: appZh },
  { code: "zh-hant", path: "/zh-hant/", hreflang: "zh-TW", ogLocale: "zh_TW", label: "繁體中文", t: zhHant, p: pagesZhHant, a: appZhHant },
  { code: "ja", path: "/ja/", hreflang: "ja", ogLocale: "ja_JP", label: "日本語", t: ja, p: pagesJa, a: appJa },
  { code: "ko", path: "/ko/", hreflang: "ko", ogLocale: "ko_KR", label: "한국어", t: ko, p: pagesKo, a: appKo },
  { code: "es", path: "/es/", hreflang: "es", ogLocale: "es_ES", label: "Español", t: es, p: pagesEs, a: appEs },
];

export const localeOf = (t: Dict): Locale => locales.find((l) => l.t === t) ?? locales[0];
export const pagesOf = (t: Dict): PagesDict => localeOf(t).p;
export const appOf = (t: Dict): AppDict => localeOf(t).a;

// Directory URLs keep a trailing slash (`trailingSlash: "always"`). Hash-only targets stay as-is.
function slashed(slug = ""): string {
  if (!slug || slug.startsWith("#")) return slug;
  const hashAt = slug.indexOf("#");
  const path = hashAt === -1 ? slug : slug.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : slug.slice(hashAt);
  return (path.endsWith("/") ? path : `${path}/`) + hash;
}

// Locale-aware internal link: link(t, "market") → "/zh/market/". "" is the home page.
export const link = (t: Dict, slug = ""): string => localeOf(t).path + slashed(slug);
export const localePath = (locale: Pick<Locale, "path">, slug = ""): string => locale.path + slashed(slug);

// FAQ page shows the landing questions, then any page-only questions after the first eight.
export function faqPageItems(t: Dict): { q: string; a: string }[] {
  return [...t.faq.items, ...pagesOf(t).faq.items].filter((item, index, all) => all.findIndex(candidate => candidate.q === item.q) === index).map((item) => ({ q: deal(t, item.q), a: deal(t, item.a) }));
}

// Static paths for an inner page in every non-default locale.
export const langPaths = () => locales.filter((l) => l.code !== "en").map((l) => ({ params: { lang: l.code }, props: { t: l.t } }));

// Public copy contains no frozen price, exchange-rate or discount claims.
export function deal(_t: Dict, s: string): string {
  return s;
}
