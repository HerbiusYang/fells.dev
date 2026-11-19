import type { OperatorLogoutBinding } from "./support-http.ts";

export const operatorLogoutKey = "fells.operator.pending-logout.v1";

const cookieName = "__Host-fells-pending-operator-logout";

export function pendingOperatorLogout(): OperatorLogoutBinding | null {
  for (const name of ["localStorage", "sessionStorage", "cookie"] as const) {
    try {
      const raw = name === "cookie" ? decodeURIComponent(document.cookie.split("; ").find(item => item.startsWith(cookieName + "="))?.slice(cookieName.length + 1) ?? "null") : window[name].getItem(operatorLogoutKey);
      const item = JSON.parse(raw ?? "null");
      if (item && /^[1-9]\d{0,18}$/.test(item.id) && /^[a-f0-9]{64}$/.test(item.fingerprint)
        && ["access", "password"].includes(item.authMethod)) return item;
    } catch { /* The other storage may still be available. */ }
  }
  return null;
}

export function rememberOperatorLogout(binding: OperatorLogoutBinding) {
  const value = JSON.stringify(binding);
  let cookieValue = "1";
  try { localStorage.setItem(operatorLogoutKey, value); }
  catch {
    cookieValue = encodeURIComponent(value);
    try { sessionStorage.setItem(operatorLogoutKey, value); } catch { /* The cookie can carry the public binding. */ }
  }
  try { document.cookie = cookieName + "=" + cookieValue + "; Path=/; Secure; SameSite=Strict; Max-Age=86400"; } catch { /* Optional. */ }
}

export function forgetOperatorLogout(fingerprint: string) {
  if (pendingOperatorLogout()?.fingerprint === fingerprint) {
    try { document.cookie = cookieName + "=; Path=/; Secure; SameSite=Strict; Max-Age=0"; } catch { /* Optional. */ }
  }
  for (const name of ["localStorage", "sessionStorage"] as const) {
    try {
      if (JSON.parse(window[name].getItem(operatorLogoutKey) ?? "null")?.fingerprint === fingerprint)
        window[name].removeItem(operatorLogoutKey);
    } catch { /* Storage is optional. */ }
  }
}
