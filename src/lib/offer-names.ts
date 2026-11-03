import { publicCatalogWordsOf } from "../i18n/public-catalog.ts";

/**
 * The API names monthly tiers (store.TierName) and the seeded trial plan in
 * Chinese. Show those canonical names in the page language; any name an
 * operator typed is shown as entered.
 */
export function localOfferName(name: unknown, language: string): string {
  const value = typeof name === "string" ? name : "";
  const words = publicCatalogWordsOf(language);
  if (value === "体验包") return words.trialPack;
  if (value === "独享") return words.tierExclusive;
  if (value === "双人共享") return words.tierTwo;
  if (value === "四人共享") return words.tierFour;
  const shared = /^(\d{1,3}) 人共享$/.exec(value);
  return shared ? words.tierShared.replace("{n}", shared[1]!) : value;
}
