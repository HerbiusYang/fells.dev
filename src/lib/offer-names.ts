import { publicCatalogWordsOf } from "../i18n/public-catalog.ts";

const families: Record<string, string> = { ultra: "Ultra", max: "Max", pro: "Pro" };

function localTierName(tier: string, language: string): string | null {
  const words = publicCatalogWordsOf(language);
  if (tier === "独享") return words.tierExclusive;
  if (tier === "双人共享") return words.tierTwo;
  if (tier === "四人共享") return words.tierFour;
  const shared = /^(\d{1,3}) 人共享$/.exec(tier);
  return shared ? words.tierShared.replace("{n}", shared[1]!) : null;
}

/**
 * The API names monthly offers (store.FamilyTierName: 独享, Ultra 双人共享,
 * Pro 体验) and the seeded trial plan in Chinese. Show those canonical names
 * in the page language; any name an operator typed is shown as entered.
 */
export function localOfferName(name: unknown, language: string): string {
  const value = typeof name === "string" ? name : "";
  const words = publicCatalogWordsOf(language);
  if (value === "体验包") return words.trialPack;
  if (value === "Pro 体验") return words.proStarter;
  const family = /^(Ultra|Max|Pro) (.+)$/.exec(value);
  if (family) {
    const tier = localTierName(family[2]!, language);
    return tier ? `${family[1]} ${tier}` : value;
  }
  return localTierName(value, language) ?? value;
}

/**
 * What one share of an account gets, by family: Ultra (the renamed Max 20x)
 * has no 5-hour limit, so a share splits the weekly limit only; Max splits
 * both; Pro is a single Claude Pro account. Empty for unclassified accounts.
 */
export function localOfferDescription(family: unknown, tier: unknown, language: string): string {
  const label = typeof family === "string" ? families[family] : undefined;
  const people = Number(tier);
  if (!label || !Number.isSafeInteger(people) || people < 1) return "";
  const words = publicCatalogWordsOf(language);
  if (family === "pro") return words.proDesc;
  if (people === 1) return words.soloDesc.replace("{plan}", label);
  if (people !== 2 && people !== 4) return "";
  return (family === "ultra" ? words.sharedWeekly : words.sharedBoth)
    .replace("{people}", people === 2 ? words.people2 : words.people4)
    .replace("{plan}", label)
    .replace("{share}", people === 2 ? words.half : words.quarter);
}
