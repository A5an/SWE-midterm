import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const repoRoot = path.resolve(scriptDir, '..');
const docsDir = path.join(repoRoot, 'docs');
const outputPath = path.join(docsDir, 'Complete_Documentation.html');
const outputDir = path.dirname(outputPath);

const parts = [
  {
    className: 'part-1',
    sourcePath: path.join(docsDir, 'requirements', 'Part1_Requirements_Engineering.md'),
  },
  {
    className: 'part-2',
    sourcePath: path.join(docsDir, 'architecture', 'Part2_System_Architecture.md'),
  },
  {
    className: 'part-3',
    sourcePath: path.join(docsDir, 'project-management', 'Part3_Project_Management_and_Team_Collaboration.md'),
  },
];

const maxTocLevel = 3;

async function main() {
  const loadedParts = await Promise.all(
    parts.map(async (part) => {
      const markdown = await fs.readFile(part.sourcePath, 'utf8');
      const firstHeading = extractFirstHeading(markdown);

      if (!firstHeading) {
        throw new Error(`Missing top-level heading in ${path.relative(repoRoot, part.sourcePath)}`);
      }

      return {
        ...part,
        markdown,
        firstHeading,
        anchorId: slugify(firstHeading),
      };
    }),
  );

  const projectTitle = extractProjectTitle(loadedParts[0].markdown) ?? loadedParts[0].firstHeading;
  const partAnchorBySourcePath = new Map(
    loadedParts.map((part) => [path.resolve(part.sourcePath), part.anchorId]),
  );
  const headings = [];
  const slugger = createSlugger();
  const markdown = createMarkdownRenderer({
    headings,
    outputDir,
    partAnchorBySourcePath,
    slugger,
  });

  const renderedParts = loadedParts.map((part, index) => {
    const html = markdown.render(part.markdown, {
      sourcePath: part.sourcePath,
    });

    const classes = ['report-part', part.className];

    if (index > 0) {
      classes.push('page-break-before');
    }

    return `<section class="${classes.join(' ')}">\n${html}\n</section>`;
  });

  const tocTree = buildHeadingTree(headings.filter((heading) => heading.level <= maxTocLevel));
  const html = buildDocumentHtml({
    headings,
    outputPath,
    outputDir,
    parts: loadedParts,
    projectTitle,
    renderedParts,
    tocHtml: renderTocTree(tocTree),
  });

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(outputPath, html, 'utf8');
  console.log(`Wrote ${path.relative(repoRoot, outputPath)}`);
}

function createMarkdownRenderer({ headings, outputDir, partAnchorBySourcePath, slugger }) {
  const markdown = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
  });

  const defaultHeadingOpen =
    markdown.renderer.rules.heading_open ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  const defaultLinkOpen =
    markdown.renderer.rules.link_open ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  const defaultImage =
    markdown.renderer.rules.image ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

  markdown.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
    const inlineToken = tokens[idx + 1];
    const title = inlineToken?.type === 'inline' ? inlineToken.content : '';
    const level = Number.parseInt(tokens[idx].tag.slice(1), 10);
    const id = slugger.slug(title);

    tokens[idx].attrSet('id', id);
    headings.push({
      id,
      level,
      sourcePath: env.sourcePath,
      title,
    });

    return defaultHeadingOpen(tokens, idx, options, env, self);
  };

  markdown.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const href = tokens[idx].attrGet('href');

    if (href) {
      tokens[idx].attrSet(
        'href',
        rewriteReference({
          outputDir,
          partAnchorBySourcePath,
          rawReference: href,
          sourcePath: env.sourcePath,
        }),
      );
    }

    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  markdown.renderer.rules.image = (tokens, idx, options, env, self) => {
    const src = tokens[idx].attrGet('src');

    if (src) {
      tokens[idx].attrSet(
        'src',
        rewriteReference({
          outputDir,
          partAnchorBySourcePath,
          rawReference: src,
          sourcePath: env.sourcePath,
        }),
      );
    }

    tokens[idx].attrSet('loading', 'lazy');
    return defaultImage(tokens, idx, options, env, self);
  };

  return markdown;
}

function rewriteReference({ outputDir, partAnchorBySourcePath, rawReference, sourcePath }) {
  if (
    !rawReference ||
    rawReference.startsWith('#') ||
    rawReference.startsWith('/') ||
    rawReference.startsWith('//') ||
    /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(rawReference)
  ) {
    return rawReference;
  }

  const [referencePath, fragment = ''] = rawReference.split('#', 2);
  const absoluteTargetPath = path.resolve(path.dirname(sourcePath), referencePath);
  const normalizedTargetPath = path.resolve(absoluteTargetPath);

  if (partAnchorBySourcePath.has(normalizedTargetPath)) {
    return fragment ? `#${fragment}` : `#${partAnchorBySourcePath.get(normalizedTargetPath)}`;
  }

  const relativePath = path.relative(outputDir, normalizedTargetPath).split(path.sep).join('/');
  return fragment ? `${relativePath}#${fragment}` : relativePath;
}

function buildHeadingTree(headings) {
  const root = {
    children: [],
    level: 0,
  };
  const stack = [root];

  for (const heading of headings) {
    while (stack.length > 1 && heading.level <= stack[stack.length - 1].level) {
      stack.pop();
    }

    const node = {
      ...heading,
      children: [],
    };

    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }

  return root.children;
}

function renderTocTree(nodes) {
  if (nodes.length === 0) {
    return '<p>No headings found.</p>';
  }

  return `<ol>${nodes
    .map(
      (node) =>
        `<li><a href="#${escapeHtmlAttribute(node.id)}">${escapeHtml(node.title)}</a>${renderTocChildren(node.children)}</li>`,
    )
    .join('')}</ol>`;
}

function renderTocChildren(children) {
  if (children.length === 0) {
    return '';
  }

  return `<ol>${children
    .map(
      (child) =>
        `<li><a href="#${escapeHtmlAttribute(child.id)}">${escapeHtml(child.title)}</a>${renderTocChildren(child.children)}</li>`,
    )
    .join('')}</ol>`;
}

function buildDocumentHtml({ projectTitle, renderedParts, tocHtml }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="generator" content="scripts/generate-complete-documentation.mjs">
  <title>Complete Documentation</title>
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

    .team-members {
      margin: 1.75rem 0 0;
      padding-left: 1.2rem;
      color: var(--text);
    }

    .team-members li + li {
      margin-top: 0.2rem;
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
      <h1>Complete Documentation</h1>
      <p class="subtitle">${escapeHtml(projectTitle)}</p>
      <ul class="team-members">
        <li>Alaa Mohamed Elsayed Abdelghany Alam</li>
        <li>Assanali Aukenov</li>
        <li>Dachi Tchotashvili</li>
      </ul>
    </header>
    <nav class="toc" aria-labelledby="table-of-contents">
      <h2 id="table-of-contents">Table of Contents</h2>
      ${tocHtml}
    </nav>
    <main class="markdown-shell">
      ${renderedParts.join('\n')}
    </main>
  </div>
</body>
</html>
`;
}

function createSlugger() {
  const counts = new Map();

  return {
    slug(value) {
      const base = slugify(value) || 'section';
      const currentCount = counts.get(base) ?? 0;
      counts.set(base, currentCount + 1);

      return currentCount === 0 ? base : `${base}-${currentCount + 1}`;
    },
  };
}

function slugify(value) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function extractFirstHeading(markdown) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? '';
}

function extractProjectTitle(markdown) {
  const match = markdown.match(/^##\s+Project\s*$\n+([^\n]+)$/m);
  return match?.[1]?.trim() ?? null;
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeHtmlAttribute(value) {
  return escapeHtml(value);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
