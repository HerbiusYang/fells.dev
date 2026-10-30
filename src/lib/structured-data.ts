import type { Dict } from "../i18n/en";
import { faqPageItems } from "../i18n/index";
import { site } from "../site";

type Json = Record<string, unknown>;

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
    const application: Json = {
      "@type": "SoftwareApplication",
      name: "Fells",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web",
      url: input.canonical.href,
      description: input.description,
      publisher: { "@id": orgId },
    };
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
