// Build/server only. Never import this module from a browser script or the
// customer widget: the portal address must not enter a public client bundle.
// Existing public page and locale paths that also satisfy the word-pair format.
const reservedPortalPaths = new Set(["developer-api", "zh-hant"]);

/** @internal Exported for build-configuration validation tests. */
export function parseSupportPortalPath(value: unknown): string | null {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) return null;
  if (typeof value !== "string" || value !== value.trim() || !/^[a-z]{2,16}(?:-[a-z]{2,16}){1,4}$/.test(value) || reservedPortalPaths.has(value)) {
    throw new Error("SUPPORT_PORTAL_PATH must contain 2–5 lowercase English words joined by hyphens and must not match a public page");
  }
  return value;
}

export function readSupportPortalPath(): string | null {
  return parseSupportPortalPath(import.meta.env.SUPPORT_PORTAL_PATH);
}
