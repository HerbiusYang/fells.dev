import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

const site = "https://fells.dev";
// Marketing routes this project generates. Account, checkout and the support portal are omitted.
const publicLocales = ["", "zh", "zh-hant", "ja", "ko", "es"];
const publicSlugs = ["", "market", "developer-api", "security", "faq", "blog"];
const publicPages = new Set(publicLocales.flatMap((locale) => publicSlugs.map((slug) => {
  const parts = [locale, slug].filter(Boolean);
  return `${site}${parts.length ? `/${parts.join("/")}/` : "/"}`;
})));

export default defineConfig({
  site,
  trailingSlash: "always",
  devToolbar: { enabled: false },
  build: { inlineStylesheets: "always" },
  integrations: [
    sitemap({
      filter: (page) => publicPages.has(page),
      i18n: {
        defaultLocale: "en",
        locales: {
          en: "en",
          zh: "zh-CN",
          "zh-hant": "zh-TW",
          ja: "ja",
          ko: "ko",
          es: "es",
        },
      },
    }),
  ],
  vite: {
    build: {
      modulePreload: {
        resolveDependencies(_filename, deps) {
          // The support widget chunk is fetched on idle or interaction, not with the first paint.
          return deps.filter((dep) => !dep.includes("support-widget"));
        },
      },
    },
    server: {
      proxy: {
        "/api/app": { target: "http://127.0.0.1:18080", changeOrigin: false },
        "/api/support": {
          target: "http://127.0.0.1:18080", changeOrigin: false,
          configure(proxy) {
            proxy.on("proxyRes", (upstream, _request, response) => {
              response.on("close", () => {
                // Release upstream SSE leases when a browser tab disconnects.
                if (!response.writableEnded) upstream.destroy();
              });
            });
          },
        },
        "/v1": { target: "http://127.0.0.1:18080", changeOrigin: false },
      },
    },
  },
  i18n: {
    defaultLocale: "en",
    locales: ["en", "zh", "zh-hant", "ja", "ko", "es"],
    routing: { prefixDefaultLocale: false },
  },
});
