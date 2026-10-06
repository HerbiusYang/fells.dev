export function splitThemeDocument(html: string) {
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1];
  const body = html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i)?.[1];
  if (head === undefined || body === undefined) throw new Error("Theme must contain a head and a body");
  const lang = html.match(/<html\b[^>]*\blang=["']([^"']+)["']/i)?.[1] ?? "en";
  return { head, body, lang };
}

export function resolveThemeAssets(html: string, assets: Record<string, string>) {
  return html.replace(/\bassets\/([\w-]+\.webp)\b/g, (reference, name: string) => {
    if (!assets[name]) throw new Error(`Missing theme asset: ${reference}`);
    return assets[name];
  });
}
