import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

const site = "https://fells.dev";
// Marketing routes this project generates. Account, checkout and the support portal are omitted.
const publicLocales = ["", "zh", "zh-hant", "ja", "ko", "es"];
const publicSlugs = ["", "market", "developer-api", "security", "faq", "blog", "terms", "privacy", "refund"];
const publicPages = new Set(publicLocales.flatMap((locale) => publicSlugs.map((slug) => {
  const parts = [locale, slug].filter(Boolean);
  return `${site}${parts.length ? `/${parts.join("/")}/` : "/"}`;
})));

export default defineConfig({
  site,
  trailingSlash: "always",
  build: { inlineStylesheets: "always" },
  integrations: [sitemap({
    filter: (page) => publicPages.has(page),
    i18n: { defaultLocale: "en", locales: { en: "en", zh: "zh-CN", "zh-hant": "zh-TW", ja: "ja", ko: "ko", es: "es" } },
  })],
  devToolbar: { enabled: false },
  security: {
    csp: {
      algorithm: "SHA-256",
      directives: [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "form-action 'self'",
        "connect-src 'self' https://challenges.cloudflare.com",
        "frame-src https://challenges.cloudflare.com",
        "font-src 'self'",
        "img-src 'self' data: blob:",
      ],
      // Astro emits hashes for its bundled/inline scripts into each built page.
      // Turnstile loads api.js dynamically after the auth configuration arrives.
      scriptDirective: {
        resources: ["'self'", "https://challenges.cloudflare.com"],
      },
      // The console and marketing illustrations use dynamic style attributes;
      // permitting those does not relax the script policy.
      styleDirective: {
        resources: ["'self'", "'unsafe-inline'"],
      },
    },
  },
  vite: {
    build: {
      modulePreload: {
        resolveDependencies(_filename, deps) {
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
