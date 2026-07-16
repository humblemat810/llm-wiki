import { requirePublicOrigin } from "./public-origin.mjs";

export const MAX_NOTE_SUMMARY_CHARS = 20000;
export const sliceTextAtCodePointBoundary = (value, limit) => {
  const bounded = String(value).slice(0, limit);
  const lastCodeUnit = bounded.charCodeAt(bounded.length - 1);
  return lastCodeUnit >= 0xD800 && lastCodeUnit <= 0xDBFF
    ? bounded.slice(0, -1)
    : bounded;
};

const escapeHtml = (value) => String(value)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");
const escapeJsonForHtml = (value) => String(value).replace(/[<>&]/g, (character) => `\\u${character.codePointAt(0).toString(16).padStart(4, "0")}`);

function renderLearningNoteMarkdown(content, title = "") {
  const source = String(content)
    .replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  const lines = source ? source.split("\n") : [];
  const output = [];
  let paragraph = [];
  let listType = null;
  let listItems = [];
  let quoteLines = [];
  let inCode = false;
  let codeLines = [];

  const inline = (value) => {
    const links = [];
    let linkTokenPrefix = "LLMNOTELINK";
    while (String(value).includes(linkTokenPrefix)) linkTokenPrefix += "X";
    const tokenized = String(value).replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi, (match, label, href) => {
      try {
        const parsed = new URL(href);
        if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return match;
        const token = `${linkTokenPrefix}${links.length}END`;
        links.push(`<a href="${escapeHtml(parsed.toString())}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`);
        return token;
      } catch {
        return match;
      }
    });
    return escapeHtml(tokenized)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_]+)__/g, "<strong>$1</strong>")
      .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>")
      .replace(/(?<!_)_([^_]+)_(?!_)/g, "<em>$1</em>")
      .replace(new RegExp(`${linkTokenPrefix}(\\d+)END`, "g"), (_, index) => links[Number(index)] || "");
  };
  const flushParagraph = () => {
    if (!paragraph.length) return;
    output.push(`<p>${inline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!listItems.length) return;
    const tag = listType === "ordered" ? "ol" : "ul";
    output.push(`<${tag}>${listItems.map((item) => `<li>${inline(item)}</li>`).join("")}</${tag}>`);
    listType = null;
    listItems = [];
  };
  const flushQuote = () => {
    if (!quoteLines.length) return;
    output.push(`<blockquote>${quoteLines.map((line) => `<p>${inline(line)}</p>`).join("")}</blockquote>`);
    quoteLines = [];
  };
  const flushBlocks = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      if (inCode) {
        output.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
      } else {
        flushBlocks();
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    if (!line.trim()) {
      flushBlocks();
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushBlocks();
      const level = heading[1].length;
      if (level === 1 && heading[2].trim() === String(title).trim()) continue;
      output.push(`<h${level}>${inline(heading[2].trim())}</h${level}>`);
      continue;
    }
    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      flushQuote();
      const nextType = unordered ? "unordered" : "ordered";
      if (listType && listType !== nextType) flushList();
      listType = nextType;
      listItems.push((unordered || ordered)[1].trim());
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      flushList();
      quoteLines.push(quote[1]);
      continue;
    }
    flushList();
    flushQuote();
    paragraph.push(line.trim());
  }
  if (inCode) output.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  flushBlocks();
  return output.join("\n");
}

export function buildLearningNotePage({
  id,
  title,
  description,
  content,
  origin = ""
}) {
  const safeOrigin = requirePublicOrigin(origin);
  const base = safeOrigin ? `${safeOrigin}/` : "./";
  const rootUrl = safeOrigin || "..";
  const pageUrl = safeOrigin
    ? new URL(`./notes/${encodeURIComponent(id)}.html`, base).toString()
    : `./notes/${encodeURIComponent(id)}.html`;
  const markdownUrl = safeOrigin
    ? new URL(`./notes/${encodeURIComponent(id)}.md`, base).toString()
    : `./${encodeURIComponent(id)}.md`;
  const feedUrl = safeOrigin ? new URL("./feed.xml", base).toString() : "../feed.xml";
  const appUrl = safeOrigin ? new URL("./#note=" + encodeURIComponent(id), base).toString() : `../#note=${encodeURIComponent(id)}`;
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const renderedContent = renderLearningNoteMarkdown(content, title);
  const structuredData = escapeJsonForHtml(JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: String(title),
    description: String(description),
    url: pageUrl,
    image: safeOrigin ? `${safeOrigin}/social-card.png` : "../social-card.png",
    isPartOf: {
      "@type": "WebSite",
      name: "LLM Field Notes",
      url: safeOrigin || rootUrl
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": pageUrl
    }
  }));
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'none'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'none'; worker-src 'none'; manifest-src 'none'" />
    <meta name="description" content="${safeDescription}" />
    <meta name="robots" content="index,follow" />
    <meta property="og:title" content="${safeTitle} · LLM Field Notes" />
    <meta property="og:description" content="${safeDescription}" />
    <meta property="og:type" content="article" />
    <meta property="article:section" content="LLM education" />
    <meta property="og:site_name" content="LLM Field Notes" />
    <meta property="og:url" content="${escapeHtml(pageUrl)}" />
    <meta property="og:image" content="${escapeHtml(safeOrigin ? `${safeOrigin}/social-card.png` : "../social-card.png")}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="LLM Field Notes: documents into a living map" />
    <script type="application/ld+json">${structuredData}</script>
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${safeTitle} · LLM Field Notes" />
    <meta name="twitter:description" content="${safeDescription}" />
    <meta name="twitter:image" content="${escapeHtml(safeOrigin ? `${safeOrigin}/social-card.png` : "../social-card.png")}" />
    <link rel="canonical" href="${escapeHtml(pageUrl)}" />
    <link rel="alternate" type="text/markdown" href="${escapeHtml(markdownUrl)}" title="${safeTitle} Markdown" />
    <link rel="alternate" type="application/atom+xml" href="${escapeHtml(feedUrl)}" title="LLM Field Notes feed" />
    <link rel="stylesheet" href="${escapeHtml(safeOrigin ? `${safeOrigin}/styles.css` : "../styles.css")}" />
    <title>${safeTitle} · LLM Field Notes</title>
  </head>
  <body>
    <main class="section-shell note-page-shell">
      <p class="eyebrow"><span class="pulse"></span> LLM FIELD NOTES / LEARNING NOTE</p>
      <h1>${safeTitle}</h1>
      <p class="hero-lede">${safeDescription}</p>
      <p><a class="button button-primary" href="${escapeHtml(appUrl)}">Open in the interactive wiki ↗</a> <a class="button button-quiet" href="${escapeHtml(markdownUrl)}">Read Markdown</a></p>
      <article class="note-page-content">${renderedContent}</article>
      <p><a href="${escapeHtml(rootUrl)}">← Back to LLM Field Notes</a></p>
    </main>
  </body>
</html>
`;
}
