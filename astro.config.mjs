import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://fells.dev",
  i18n: {
    defaultLocale: "en",
    locales: ["en", "zh", "zh-hant", "ja", "ko", "es"],
    routing: { prefixDefaultLocale: false },
  },
});
