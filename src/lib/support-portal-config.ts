// Build/server only. Never import this module from a browser script or the
// customer widget: the portal address must not enter a public client bundle.
export function parseSupportPortalPath(value: unknown): string | null {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) return null;
  if (typeof value !== "string" || !/^[a-f0-9]{48}$/.test(value)) {
    throw new Error("SUPPORT_PORTAL_PATH must be a 48-character lowercase hexadecimal value generated from 24 random bytes");
  }
  return value;
}

export function readSupportPortalPath(): string | null {
  return parseSupportPortalPath(import.meta.env.SUPPORT_PORTAL_PATH);
}
