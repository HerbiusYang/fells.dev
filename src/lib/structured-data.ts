import { groupSeats, tokenPlans } from "../data/catalog";
import type { Dict } from "../i18n/en";
import { faqPageItems, fill } from "../i18n/index";
import { site } from "../site";

type Json = Record<string, unknown>;

// Offer objects only when the catalog has a finite CNY price. Unknown prices are left out.
function offer(name: string, price: number, url: string): Json | undefined {
  if (!Number.isFinite(price)) return undefined;
  return { "@type": "Offer", name, price: String(price), priceCurrency: "CNY", url };
}

export function pageJsonLd(input: { t: Dict; slug: string; description: string; canonical: URL; origin: string }): Json {
  const slug = input.slug.replace(/\/$/, "");
  const origin = input.origin.replace(/\/$/, "");
  const orgId = `${origin}/#organization`;
  const graph: Json[] = [
    {
      "@type": "Organization",
      "@id": orgId,
      name: "Fells",
      url: `${origin}/`,
      logo: `${origin}/apple-touch-icon.png`,
      contactPoint: {
        "@type": "ContactPoint",
        contactType: "customer support",
        url: `mailto:${site.contactEmail}`,
      },
    },
    {
      "@type": "WebSite",
      "@id": `${origin}/#website`,
      name: "Fells",
      url: `${origin}/`,
      publisher: { "@id": orgId },
      inLanguage: input.t.meta.lang,
    },
  ];

  if (slug === "") {
    const plansUrl = new URL("#plans", input.canonical).href;
    const offers = [
      ...tokenPlans.flatMap((plan) => {
        const name = input.t.plans.tiers[plan.id].name;
        const item = offer(name, plan.price, plansUrl);
        return item ? [item] : [];
      }),
      ...groupSeats.flatMap((seat) => {
        const item = offer(fill(input.t.group.seat, { n: seat.units }), seat.price, new URL("#group", input.canonical).href);
        return item ? [item] : [];
      }),
    ];
    const application: Json = {
      "@type": "SoftwareApplication",
      name: "Fells",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web",
      url: input.canonical.href,
      description: input.description,
      publisher: { "@id": orgId },
    };
    if (offers.length) application.offers = offers;
    graph.push(application);
  }

  if (slug === "faq") {
    graph.push({
      "@type": "FAQPage",
      url: input.canonical.href,
      inLanguage: input.t.meta.lang,
      mainEntity: faqPageItems(input.t).map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    });
  }

  return { "@context": "https://schema.org", "@graph": graph };
}
