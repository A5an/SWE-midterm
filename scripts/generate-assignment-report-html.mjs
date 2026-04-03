#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { marked } from "marked";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const DOC_CONFIGS = {
  standard: {
    outputPath: path.join(
      ROOT_DIR,
      "docs",
      "architecture",
      "requirements-and-system-architecture.html",
    ),
    title: "Requirements Engineering and System Architecture",
    subtitle:
      "Combined print-ready HTML export for the collaborative document editor with AI writing assistant.",
    outputFileName: "requirements-and-system-architecture.html",
    sources: [
      {
        sourcePath: path.join(
          ROOT_DIR,
          "docs",
          "architecture",
          "Part1_Requirements_Engineering.md",
        ),
        sourceDir: path.join(ROOT_DIR, "docs", "architecture"),
        partClass: "part-1",
        sourceLabel: "Part1_Requirements_Engineering.md",
      },
      {
        sourcePath: path.join(
          ROOT_DIR,
          "docs",
          "architecture",
          "Part2_System_Architecture.md",
        ),
        sourceDir: path.join(ROOT_DIR, "docs", "architecture"),
        partClass: "part-2",
        sourceLabel: "Part2_System_Architecture.md",
      },
    ],
  },
  complete: {
    outputPath: path.join(
      ROOT_DIR,
      "docs",
      "architecture",
      "Complete_Documentation.html",
    ),
    title: "Complete Documentation",
    subtitle:
      "Combined print-ready HTML export for requirements engineering, system architecture, and project management.",
    outputFileName: "Complete_Documentation.html",
    sources: [
      {
        sourcePath: path.join(
          ROOT_DIR,
          "docs",
          "architecture",
          "Part1_Requirements_Engineering.md",
        ),
        sourceDir: path.join(ROOT_DIR, "docs", "architecture"),
        partClass: "part-1",
        sourceLabel: "Part1_Requirements_Engineering.md",
      },
      {
        sourcePath: path.join(
          ROOT_DIR,
          "docs",
          "architecture",
          "Part2_System_Architecture.md",
        ),
        sourceDir: path.join(ROOT_DIR, "docs", "architecture"),
        partClass: "part-2",
        sourceLabel: "Part2_System_Architecture.md",
      },
      {
        sourcePath: path.join(
          ROOT_DIR,
          "docs",
          "architecture",
          "part3_Project_Management.md",
        ),
        sourceDir: path.join(ROOT_DIR, "docs", "architecture"),
        partClass: "part-3",
        sourceLabel: "part3_Project_Management.md",
      },
    ],
  },
};

const mode = process.argv.includes("--complete") ? "complete" : "standard";
const config = DOC_CONFIGS[mode];
const OUTPUT_PATH = config.outputPath;
const OUTPUT_DIR = path.dirname(OUTPUT_PATH);

const MIME_TYPES = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const headingCounts = new Map();
const assetCache = new Map();
const tocEntries = [];

async function main() {
  headingCounts.clear();
  assetCache.clear();
  tocEntries.length = 0;

  const renderer = createRenderer();
  const renderedParts = [];

  for (const source of config.sources) {
    const markdown = normalizeMarkdown(await readFile(source.sourcePath, "utf8"));
    const tokens = marked.lexer(markdown, {
      gfm: true,
    });

    await decorateTokens(tokens, source);
    const pageBreakClass = source.partClass === "part-1" ? "" : " page-break-before";

    renderedParts.push(
      [
        `<section class="report-part ${source.partClass}${pageBreakClass}">`,
        marked.parser(tokens, { renderer }),
        "</section>",
      ].join("\n"),
    );
  }

  const html = buildHtml({
    bodyHtml: renderedParts.join("\n"),
    tocHtml: buildToc(tocEntries),
    title: config.title,
    subtitle: config.subtitle,
    outputFileName: config.outputFileName,
    sourceLinks: config.sources.map((source) => ({
      href: toDocRelativePath(source.sourcePath),
      label: source.sourceLabel,
    })),
  });

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(OUTPUT_PATH, html, "utf8");

  console.log(`Wrote ${path.relative(ROOT_DIR, OUTPUT_PATH)}`);
}

function normalizeMarkdown(markdown) {
  return markdown.replace(/\r\n?/g, "\n").trim() + "\n";
}

async function decorateTokens(tokens, source) {
  await visitNodes(tokens, async (token) => {
    if (token.type === "heading") {
      const text = token.text?.trim() || "section";
      token._headingId = slugify(text);

      if (token.depth <= 3) {
        tocEntries.push({
          depth: token.depth,
          id: token._headingId,
          text,
        });
      }
    }

    if (token.type === "image" && token.href) {
      token.href = await inlineAsset(token.href, source.sourceDir);
    }

    if (token.type === "link" && token.href) {
      token.href = rewriteLinkHref(token.href, source.sourceDir);
    }
  });
}

async function visitNodes(node, visitor, seen = new WeakSet()) {
  if (!node || typeof node !== "object") {
    return;
  }

  if (seen.has(node)) {
    return;
  }

  seen.add(node);

  if (Array.isArray(node)) {
    for (const item of node) {
      await visitNodes(item, visitor, seen);
    }
    return;
  }

  if (typeof node.type === "string") {
    await visitor(node);
  }

  for (const value of Object.values(node)) {
    if (value && typeof value === "object") {
      await visitNodes(value, visitor, seen);
    }
  }
}

function slugify(text) {
  const base =
    text
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section";

  const nextCount = (headingCounts.get(base) || 0) + 1;
  headingCounts.set(base, nextCount);

  return nextCount === 1 ? base : `${base}-${nextCount}`;
}

async function inlineAsset(href, sourceDir) {
  if (isSpecialHref(href)) {
    return href;
  }

  const { pathname } = splitHref(href);
  const absolutePath = path.resolve(sourceDir, pathname);
  const ext = path.extname(absolutePath).toLowerCase();
  const mimeType = MIME_TYPES[ext];

  if (!mimeType) {
    return href;
  }

  if (!assetCache.has(absolutePath)) {
    const buffer = await readFile(absolutePath);
    assetCache.set(
      absolutePath,
      `data:${mimeType};base64,${buffer.toString("base64")}`,
    );
  }

  return assetCache.get(absolutePath);
}

function rewriteLinkHref(href, sourceDir) {
  if (isSpecialHref(href)) {
    return href;
  }

  const { pathname, suffix } = splitHref(href);
  const basename = path.basename(pathname);

  if (basename === "Part1_Requirements_Engineering.md") {
    return "#part-1-requirements-engineering";
  }

  if (basename === "Part2_System_Architecture.md") {
    return "#part-2-system-architecture";
  }

  if (basename === "part3_Project_Management.md") {
    return "#part-3-project-management-team-collaboration";
  }

  const absolutePath = path.resolve(sourceDir, pathname);
  let relativePath = path.relative(OUTPUT_DIR, absolutePath).split(path.sep).join("/");

  if (!relativePath.startsWith(".") && !relativePath.startsWith("/")) {
    relativePath = `./${relativePath}`;
  }

  return `${relativePath}${suffix}`;
}

function splitHref(href) {
  const match = href.match(/^([^?#]*)([?#].*)?$/);
  return {
    pathname: match?.[1] || href,
    suffix: match?.[2] || "",
  };
}

function isSpecialHref(href) {
  return (
    href.startsWith("#") ||
    /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(href) ||
    /^(?:mailto|tel|data):/i.test(href)
  );
}

function createRenderer() {
  const renderer = new marked.Renderer();

  renderer.heading = function heading(token) {
    const text = this.parser.parseInline(token.tokens);
    const id = token._headingId || slugify(token.text || "section");

    return `<h${token.depth} id="${escapeHtml(id)}">${text}</h${token.depth}>`;
  };

  renderer.link = function link(token) {
    const text = this.parser.parseInline(token.tokens);
    const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
    const externalAttrs = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(token.href)
      ? ' target="_blank" rel="noreferrer"'
      : "";

    return `<a href="${escapeHtml(token.href)}"${title}${externalAttrs}>${text}</a>`;
  };

  renderer.image = function image(token) {
    const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
    const alt = token.text ? escapeHtml(token.text) : "";

    return `<img src="${escapeHtml(token.href)}" alt="${alt}"${title}>`;
  };

  return renderer;
}

function buildToc(entries) {
  const filteredEntries = entries.filter((entry) => entry.depth <= 3);
  const tree = buildHeadingTree(filteredEntries);

  return [
    '<nav class="toc" aria-labelledby="table-of-contents">',
    '<h2 id="table-of-contents">Table of Contents</h2>',
    renderTocNodes(tree),
    "</nav>",
  ].join("\n");
}

function buildHeadingTree(entries) {
  const root = [];
  const stack = [{ depth: 0, children: root }];

  for (const entry of entries) {
    const node = { ...entry, children: [] };

    while (stack.length > 1 && entry.depth <= stack[stack.length - 1].depth) {
      stack.pop();
    }

    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }

  return root;
}

function renderTocNodes(nodes) {
  if (!nodes.length) {
    return "<p>No headings found.</p>";
  }

  return [
    "<ol>",
    nodes
      .map((node) =>
        [
          "<li>",
          `<a href="#${escapeHtml(node.id)}">${escapeHtml(node.text)}</a>`,
          node.children.length ? renderTocNodes(node.children) : "",
          "</li>",
        ].join(""),
      )
      .join(""),
    "</ol>",
  ].join("");
}

function buildHtml({
  bodyHtml,
  tocHtml,
  title,
  subtitle,
  outputFileName,
  sourceLinks,
}) {
  const generatedAt = new Date().toISOString().slice(0, 10);
  const sourceLinksHtml = sourceLinks
    .map(
      (source) =>
        `          <a href="${escapeHtml(source.href)}">${escapeHtml(source.label)}</a>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --bg: #f3efe6;
      --paper: #fffdf9;
      --surface: #f7f3ec;
      --text: #1e2430;
      --muted: #5a6472;
      --border: #d7d1c4;
      --border-strong: #bab2a2;
      --accent: #1e6bb8;
      --shadow: 0 20px 50px rgba(30, 36, 48, 0.08);
      --code-bg: #f4efe6;
    }

    * {
      box-sizing: border-box;
    }

    html {
      scroll-behavior: smooth;
    }

    body {
      margin: 0;
      background:
        radial-gradient(circle at top, rgba(255, 255, 255, 0.65), transparent 34rem),
        linear-gradient(180deg, #ece6da 0%, #f5f1e8 12rem, #f2eee6 100%);
      color: var(--text);
      font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif;
      line-height: 1.6;
    }

    a {
      color: var(--accent);
    }

    .page {
      max-width: 1120px;
      margin: 0 auto;
      padding: 2rem 1.5rem 4rem;
    }

    .cover,
    .toc,
    .markdown-shell {
      background: var(--paper);
      border: 1px solid rgba(186, 178, 162, 0.65);
      border-radius: 1.25rem;
      box-shadow: var(--shadow);
    }

    .cover {
      padding: 2.5rem 3rem;
      margin-bottom: 1.5rem;
    }

    .eyebrow {
      margin: 0 0 0.75rem;
      color: var(--muted);
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }

    .cover h1 {
      margin: 0;
      font-size: clamp(2.2rem, 4vw, 3.4rem);
      line-height: 1.08;
      border: 0;
      padding: 0;
    }

    .subtitle {
      margin: 1rem 0 0;
      max-width: 48rem;
      color: var(--muted);
      font-size: 1.05rem;
    }

    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
      gap: 1rem;
      margin-top: 1.75rem;
    }

    .meta-card {
      padding: 1rem 1.1rem;
      border: 1px solid var(--border);
      border-radius: 1rem;
      background: var(--surface);
    }

    .meta-card strong {
      display: block;
      margin-bottom: 0.35rem;
      color: var(--muted);
      font-size: 0.76rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .meta-card a {
      display: block;
      margin-top: 0.2rem;
      overflow-wrap: anywhere;
    }

    .toc {
      padding: 1.6rem 2rem;
      margin-bottom: 1.5rem;
    }

    .toc h2 {
      margin-top: 0;
      padding-bottom: 0;
      border: 0;
    }

    .toc ol {
      margin: 0.5rem 0 0;
      padding-left: 1.35rem;
    }

    .toc li {
      margin: 0.3rem 0;
    }

    .toc a {
      color: inherit;
      text-decoration: none;
    }

    .toc a:hover {
      color: var(--accent);
      text-decoration: underline;
    }

    .markdown-shell {
      padding: 2.5rem 3rem 3.2rem;
    }

      .report-part + .report-part {
        margin-top: 3rem;
        padding-top: 2.5rem;
        border-top: 1px solid var(--border);
      }

      .report-part.page-break-before {
        break-before: page;
        page-break-before: always;
      }

    .markdown-shell > :first-child,
    .report-part > :first-child,
    .report-part > :first-child > :first-child {
      margin-top: 0;
    }

    h1,
    h2,
    h3,
    h4,
    h5,
    h6 {
      color: #0f1722;
      line-height: 1.24;
      margin-top: 1.9rem;
      margin-bottom: 0.9rem;
      break-after: avoid;
      page-break-after: avoid;
    }

    h1 {
      font-size: 2rem;
      padding-bottom: 0.4rem;
      border-bottom: 1px solid var(--border);
    }

    h2 {
      font-size: 1.5rem;
      padding-bottom: 0.25rem;
      border-bottom: 1px solid rgba(215, 209, 196, 0.8);
    }

    h3 {
      font-size: 1.18rem;
    }

    h4,
    h5,
    h6 {
      font-size: 1rem;
    }

    p,
    ul,
    ol,
    blockquote,
    table,
    pre {
      margin-top: 0;
      margin-bottom: 1rem;
    }

    ul,
    ol {
      padding-left: 1.5rem;
    }

    li + li {
      margin-top: 0.25rem;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.94rem;
    }

    thead {
      display: table-header-group;
    }

    th,
    td {
      padding: 0.65rem 0.7rem;
      border: 1px solid var(--border);
      text-align: left;
      vertical-align: top;
      overflow-wrap: anywhere;
    }

    th {
      background: #f2ede3;
      font-weight: 700;
    }

    tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }

    blockquote {
      margin-left: 0;
      padding: 0.3rem 1rem;
      border-left: 0.28rem solid var(--border-strong);
      background: #faf7f1;
      color: var(--muted);
    }

    code,
    pre {
      font-family: "SFMono-Regular", SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;
    }

    code {
      padding: 0.15rem 0.35rem;
      border-radius: 0.35rem;
      background: rgba(46, 64, 89, 0.08);
      font-size: 0.92em;
      overflow-wrap: anywhere;
    }

    pre {
      padding: 1rem 1.1rem;
      border: 1px solid rgba(186, 178, 162, 0.75);
      border-radius: 0.9rem;
      background: var(--code-bg);
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-word;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    pre code {
      padding: 0;
      background: transparent;
      border-radius: 0;
    }

    img {
      display: block;
      max-width: 100%;
      height: auto;
      margin: 1rem auto;
      border: 1px solid rgba(186, 178, 162, 0.8);
      border-radius: 0.85rem;
      background: #fff;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    hr {
      border: 0;
      border-top: 1px solid var(--border);
      margin: 2rem 0;
    }

    @page {
      size: A4;
      margin: 14mm 12mm 16mm;
    }

    @media (max-width: 900px) {
      .page {
        padding: 1rem;
      }

      .cover,
      .toc,
      .markdown-shell {
        padding-left: 1.2rem;
        padding-right: 1.2rem;
      }
    }

    @media print {
      body {
        background: #fff;
        font-size: 10.2pt;
      }

      .page {
        max-width: none;
        padding: 0;
      }

      .cover,
      .toc,
      .markdown-shell {
        box-shadow: none;
        border: 0;
        border-radius: 0;
        padding-left: 0;
        padding-right: 0;
        background: transparent;
      }

      .cover {
        padding-top: 0;
      }

      .toc {
        margin-bottom: 10mm;
      }

      .markdown-shell {
        padding-top: 0;
        padding-bottom: 0;
      }

      .report-part + .report-part {
        margin-top: 0;
        padding-top: 0;
        border-top: 0;
      }

      a,
      .toc a {
        color: inherit;
        text-decoration: none;
      }

      img,
      blockquote,
      pre {
        break-inside: avoid;
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="page">
    <header class="cover">
      <p class="eyebrow">Software Engineering Midterm Report</p>
      <h1>${escapeHtml(title)}</h1>
      <p class="subtitle">${escapeHtml(subtitle)}</p>
      <div class="meta-grid">
        <div class="meta-card">
          <strong>Source Files</strong>
${sourceLinksHtml}
        </div>
        <div class="meta-card">
          <strong>Output File</strong>
          ${escapeHtml(outputFileName)}
        </div>
        <div class="meta-card">
          <strong>Generated</strong>
          ${generatedAt}
        </div>
      </div>
    </header>
    ${tocHtml}
    <main class="markdown-shell">
      ${bodyHtml}
    </main>
  </div>
</body>
</html>
`;
}

function toDocRelativePath(targetPath) {
  let relativePath = path.relative(OUTPUT_DIR, targetPath).split(path.sep).join("/");

  if (!relativePath.startsWith(".") && !relativePath.startsWith("/")) {
    relativePath = `./${relativePath}`;
  }

  return relativePath;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
