const REFERRAL_STORAGE_KEY = "fells.referral.v1";
const REFERRAL_CODE_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const START_PATH_RE = /^(?:\/(?:en|zh|zh-hant|ja|ko|es))?\/app\/start\/?$/;

export function cleanReferralParam(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  return REFERRAL_CODE_RE.test(value) ? value : "";
}

export function readStoredReferral(): string {
  try {
    return cleanReferralParam(sessionStorage.getItem(REFERRAL_STORAGE_KEY));
  } catch {
    return "";
  }
}

export function writeStoredReferral(code: string): void {
  const clean = cleanReferralParam(code);
  try {
    if (clean) sessionStorage.setItem(REFERRAL_STORAGE_KEY, clean);
    else sessionStorage.removeItem(REFERRAL_STORAGE_KEY);
  } catch {
    /* Storage may be unavailable in strict privacy contexts. */
  }
}

export function clearStoredReferral(): void {
  try {
    sessionStorage.removeItem(REFERRAL_STORAGE_KEY);
  } catch {
    /* Ignore unavailable storage. */
  }
}

export function propagateReferralLinks(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (START_PATH_RE.test(location.pathname)) return;
  const fromURL = cleanReferralParam(new URLSearchParams(location.search).get("ref"));
  if (fromURL) writeStoredReferral(fromURL);
  const code = fromURL || readStoredReferral();
  if (!code) return;
  document.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((anchor) => {
    const raw = anchor.getAttribute("href") ?? "";
    if (!raw || raw.startsWith("#") || raw.startsWith("mailto:")) return;
    let url: URL;
    try {
      url = new URL(raw, location.href);
    } catch {
      return;
    }
    if (url.origin !== location.origin) return;
    const isStart = START_PATH_RE.test(url.pathname);
    const isLangSwitch = anchor.closest("[data-lang]") !== null;
    if (!isStart && !isLangSwitch) return;
    if (!url.searchParams.has("ref")) {
      url.searchParams.set("ref", code);
      if (isStart && !url.hash) url.hash = "signup";
      anchor.setAttribute("href", url.pathname + url.search + url.hash);
    }
  });
}
