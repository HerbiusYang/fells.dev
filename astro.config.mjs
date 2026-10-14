import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://fells.dev",
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
