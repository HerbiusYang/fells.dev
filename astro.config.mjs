import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://fells.dev",
  devToolbar: { enabled: false },
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
