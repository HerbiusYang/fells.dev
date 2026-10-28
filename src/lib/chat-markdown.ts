import { Lexer, type Token, type Tokens } from "marked";

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

function linkURL(value: string): string | null {
  if (/[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value, "https://fells.dev/");
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

// Use Marked only for parsing. Every HTML tag and attribute below is authored
// here; raw HTML, images, forms, style and script never pass through a parser's
// default renderer. This is also safe without a DOM or a permissive CSP.
export function renderChatMarkdown(source: string): string {
  const render = (tokens: Token[], depth = 0): string => tokens.map(token => {
    if (depth > 64) return escape(token.raw);
    const children = () => render("tokens" in token && Array.isArray(token.tokens) ? token.tokens : [], depth + 1);
    switch (token.type) {
      case "space": case "def": return "";
      case "html": return escape(token.raw);
      case "text": return token.tokens ? children() : escape(token.text);
      case "escape": return escape(token.text);
      case "paragraph": return `<p>${children()}</p>`;
      case "strong": return `<strong>${children()}</strong>`;
      case "em": return `<em>${children()}</em>`;
      case "del": return `<del>${children()}</del>`;
      case "codespan": return `<code>${escape(token.text)}</code>`;
      case "code": return `<pre><code>${escape(token.text)}</code></pre>`;
      case "br": return "<br>";
      case "hr": return "<hr>";
      case "heading": return `<h3>${children()}</h3>`;
      case "blockquote": return `<blockquote>${children()}</blockquote>`;
      case "image": return escape(token.text);
      case "link": {
        const href = linkURL(token.href);
        return href ? `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer nofollow">${children()}</a>` : children();
      }
      case "list": {
        const list = token as Tokens.List, tag = list.ordered ? "ol" : "ul";
        const start = list.ordered && Number.isSafeInteger(list.start) && Number(list.start) > 1 ? ` start="${Number(list.start)}"` : "";
        return `<${tag}${start}>${list.items.map(item => `<li>${render(item.tokens, depth + 1)}</li>`).join("")}</${tag}>`;
      }
      default: return escape(token.raw);
    }
  }).join("");
  try { return render(Lexer.lex(source, { gfm: false })); }
  catch { return escape(source); }
}
