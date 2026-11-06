// Builds docs/build-your-own.html from docs/build-your-own.md: one self-contained page (no network, no library),
// readable offline in any browser. The Markdown stays the source: run this script again after changing it.
//
//   node tools/docs-html/build.mjs           writes the page
//   node tools/docs-html/build.mjs --check   fails if the page is not up to date (no write)
//
// The converter covers the Markdown the guide uses (GitHub flavour): headings, paragraphs, ordered and unordered lists
// with indented content, fenced code, tables, a GitHub alert (> [!WARNING]), inline code, bold, italics and links.
// Links to other files of the repository point to the repository on GitHub, so that they work from anywhere.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = 'docs/build-your-own.md';
const TARGET = 'docs/build-your-own.html';
const REPOSITORY = 'https://github.com/Proxi64/MSFS-UI/blob/main/';

const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** GitHub's heading anchors: lower case, punctuation removed, spaces as hyphens. */
function slug(text) {
  return text
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

/** A link of the guide: an anchor stays, a file of the repository goes to GitHub, a web address stays. */
function linkTarget(href) {
  if (/^[a-z]+:/i.test(href) || href.startsWith('#')) return href;
  const [path, anchor] = href.split('#');
  const file = posix.normalize(posix.join(posix.dirname(SOURCE), path));
  return REPOSITORY + file + (anchor ? '#' + anchor : '');
}

/** Inline Markdown: code spans first (their content is literal), then links, bold and italics. */
function inline(text) {
  const codes = [];
  let out = text.replace(/`([^`]+)`/g, (_, code) => {
    codes.push('<code>' + escapeHtml(code) + '</code>');
    return '\u0000' + (codes.length - 1) + '\u0000';
  });
  out = escapeHtml(out);
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    const target = linkTarget(href.replace(/&amp;/g, '&'));
    const external = /^https?:/.test(target) ? ' target="_blank" rel="noopener"' : '';
    return `<a href="${escapeHtml(target)}"${external}>${label}</a>`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^\w*])\*([^*\s][^*]*?)\*(?![\w*])/g, '$1<em>$2</em>');
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
const indentOf = (line) => line.match(/^ */)[0].length;
const LIST_ITEM = /^(\s*)(\d+\.|[-*])\s+(.*)$/;

/** Block Markdown, recursively for the content of list items. */
function blocks(lines, headings) {
  const html = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }

    const fence = line.match(/^(\s*)```(\w*)\s*$/);
    if (fence) {
      const code = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++].slice(fence[1].length));
      i++;
      const language = fence[2] ? ` data-language="${fence[2]}"` : '';
      html.push(`<div class="code"${language}><button type="button" class="copy" aria-label="Copy the code">Copy</button><pre><code>${escapeHtml(code.join('\n'))}</code></pre></div>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].trim();
      const id = slug(text);
      if (level === 2) headings.push({ id, text });
      html.push(level === 1 ? `<h1>${inline(text)}</h1>` : `<h${level} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${inline(text)}</h${level}>`);
      i++;
      continue;
    }

    if (line.startsWith('>')) {
      const quote = [];
      while (i < lines.length && lines[i].startsWith('>')) quote.push(lines[i++].replace(/^>\s?/, ''));
      const alert = quote[0].match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/);
      if (alert) {
        const kind = alert[1].toLowerCase();
        html.push(`<aside class="alert alert-${kind}"><p class="alert-title">${alert[1][0] + kind.slice(1)}</p>${blocks(quote.slice(1), headings)}</aside>`);
      } else {
        html.push(`<blockquote>${blocks(quote, headings)}</blockquote>`);
      }
      continue;
    }

    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      const thead = '<tr>' + head.map((cell) => `<th>${inline(cell)}</th>`).join('') + '</tr>';
      const tbody = rows.map((row) => '<tr>' + row.map((cell) => `<td>${inline(cell)}</td>`).join('') + '</tr>').join('');
      html.push(`<div class="table"><table><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`);
      continue;
    }

    const item = line.match(LIST_ITEM);
    if (item) {
      const ordered = /\d/.test(item[2]);
      const base = indentOf(line);
      const start = ordered ? parseInt(item[2], 10) : 1;
      const items = [];
      while (i < lines.length) {
        // Blank lines between two items of the same list (a loose list) do not end it.
        let next = i;
        while (next < lines.length && lines[next].trim() === '') next++;
        if (next > i && next < lines.length && LIST_ITEM.test(lines[next]) && indentOf(lines[next]) === base) i = next;
        const current = lines[i].match(LIST_ITEM);
        if (!current || indentOf(lines[i]) !== base || /\d/.test(current[2]) !== ordered) break;
        const contentIndent = base + current[2].length + 1;
        const content = [current[3]];
        i++;
        while (i < lines.length) {
          const next = lines[i];
          if (next.trim() === '') {
            // A blank line belongs to the item when the item goes on, indented, after it.
            let j = i;
            while (j < lines.length && lines[j].trim() === '') j++;
            if (j < lines.length && indentOf(lines[j]) >= contentIndent) { content.push(''); i++; continue; }
            break;
          }
          if (indentOf(next) >= contentIndent) { content.push(next.slice(contentIndent)); i++; continue; }
          if (LIST_ITEM.test(next) || /^\s*(```|#|>|\|)/.test(next)) break;
          content.push(next.trim()); // lazy continuation of the paragraph
          i++;
        }
        const body = blocks(content, headings);
        // A tight item (one paragraph) is shown without its <p>.
        items.push('<li>' + (/^<p>[\s\S]*<\/p>$/.test(body) && body.indexOf('<p>', 1) < 0 ? body.slice(3, -4) : body) + '</li>');
      }
      html.push(ordered ? `<ol${start !== 1 ? ` start="${start}"` : ''}>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }

    const paragraph = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^\s*(```|#{1,6}\s|>|\|)/.test(lines[i]) && !(paragraph.length && LIST_ITEM.test(lines[i]))) {
      paragraph.push(lines[i++].trim());
    }
    html.push(`<p>${inline(paragraph.join(' '))}</p>`);
  }
  return html.join('\n');
}

const STYLE = `
:root {
  color-scheme: light;
  --bg: #f7f8fa; --surface: #ffffff; --text: #1d2330; --muted: #5a6475; --border: #dde2ea;
  --accent: #1f6feb; --accent-soft: #e8f0fe; --code-bg: #f0f2f5; --pre-bg: #14181f; --pre-text: #e6e9ef;
  --warn: #9a6700; --warn-bg: #fff8e5; --warn-border: #f0c75e;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --bg: #0f1218; --surface: #161a22; --text: #e3e7ee; --muted: #9aa4b5; --border: #2a303c;
    --accent: #6ea8fe; --accent-soft: #1b2a44; --code-bg: #222835; --pre-bg: #0a0d12; --pre-text: #e6e9ef;
    --warn: #e3b341; --warn-bg: #2b2411; --warn-border: #6b5416;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #0f1218; --surface: #161a22; --text: #e3e7ee; --muted: #9aa4b5; --border: #2a303c;
  --accent: #6ea8fe; --accent-soft: #1b2a44; --code-bg: #222835; --pre-bg: #0a0d12; --pre-text: #e6e9ef;
  --warn: #e3b341; --warn-bg: #2b2411; --warn-border: #6b5416;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; scroll-padding-top: 16px; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font: 16px/1.65 "Segoe UI", system-ui, -apple-system, Roboto, sans-serif;
}
.layout { display: grid; grid-template-columns: 280px minmax(0, 1fr); max-width: 1240px; margin: 0 auto; }
nav.toc {
  position: sticky; top: 0; align-self: start; height: 100vh; overflow-y: auto;
  padding: 32px 20px 32px 24px; border-right: 1px solid var(--border); font-size: 14px;
}
.toc-title { font-weight: 600; text-transform: uppercase; letter-spacing: .06em; font-size: 12px; color: var(--muted); margin: 0 0 12px; }
nav.toc ol { list-style: none; margin: 0; padding: 0; }
nav.toc a { display: block; padding: 5px 10px; border-radius: 6px; color: var(--muted); text-decoration: none; line-height: 1.35; }
nav.toc a:hover { color: var(--text); background: var(--code-bg); }
nav.toc a.active { color: var(--accent); background: var(--accent-soft); font-weight: 600; }
.theme { margin-top: 20px; font: inherit; font-size: 13px; color: var(--muted); background: none; border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; cursor: pointer; }
.theme:hover { color: var(--text); }
main { padding: 40px 48px 96px; min-width: 0; }
article { max-width: 860px; }
h1 { font-size: 2.3rem; line-height: 1.2; margin: 0 0 20px; letter-spacing: -.01em; }
h2 { font-size: 1.55rem; line-height: 1.3; margin: 56px 0 16px; padding-top: 24px; border-top: 1px solid var(--border); }
h3 { font-size: 1.2rem; margin: 36px 0 12px; }
h2, h3 { position: relative; }
.anchor { position: absolute; left: -1.1em; color: var(--muted); text-decoration: none; opacity: 0; font-weight: 400; }
h2:hover .anchor, h3:hover .anchor { opacity: 1; }
a { color: var(--accent); text-underline-offset: 2px; }
p, ul, ol { margin: 0 0 14px; }
li { margin: 4px 0; }
li > .code, li > p { margin-top: 8px; }
code { font: .88em/1.5 "Cascadia Mono", Consolas, "SF Mono", Menlo, monospace; background: var(--code-bg); padding: .12em .38em; border-radius: 4px; overflow-wrap: anywhere; }
.code { position: relative; margin: 12px 0 18px; }
pre { margin: 0; background: var(--pre-bg); color: var(--pre-text); border-radius: 8px; padding: 16px 18px; overflow-x: auto; line-height: 1.5; }
pre code { background: none; padding: 0; font-size: 13.5px; color: inherit; overflow-wrap: normal; white-space: pre; }
.copy { position: absolute; top: 8px; right: 8px; font: 12px "Segoe UI", system-ui, sans-serif; color: #c9d1dc; background: #2a3140; border: 1px solid #3a4354; border-radius: 5px; padding: 3px 9px; cursor: pointer; opacity: 0; transition: opacity .15s; }
.code:hover .copy, .copy:focus-visible { opacity: 1; }
.copy.done { color: #8ddb8c; }
.table { overflow-x: auto; margin: 12px 0 20px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
table { border-collapse: collapse; width: 100%; font-size: 14.5px; }
th, td { text-align: left; vertical-align: top; padding: 9px 12px; border-bottom: 1px solid var(--border); }
th { background: var(--code-bg); font-weight: 600; }
tr:last-child td { border-bottom: none; }
.alert { margin: 20px 0; padding: 14px 18px; border: 1px solid var(--warn-border); border-left-width: 4px; border-radius: 8px; background: var(--warn-bg); }
.alert-title { font-weight: 700; color: var(--warn); margin: 0 0 6px; }
.alert p:last-child { margin-bottom: 0; }
blockquote { margin: 16px 0; padding: 4px 16px; border-left: 4px solid var(--border); color: var(--muted); }
footer { margin-top: 64px; padding-top: 16px; border-top: 1px solid var(--border); font-size: 13px; color: var(--muted); }
.menu { display: none; }
@media (max-width: 900px) {
  .layout { display: block; }
  nav.toc { position: static; height: auto; border-right: none; border-bottom: 1px solid var(--border); padding: 0 16px; }
  nav.toc .toc-body { display: none; padding-bottom: 16px; }
  nav.toc.open .toc-body { display: block; }
  .menu { display: block; width: 100%; text-align: left; font: inherit; font-weight: 600; color: var(--text); background: none; border: none; padding: 14px 0; cursor: pointer; }
  .toc-title { display: none; }
  main { padding: 24px 16px 64px; }
  h1 { font-size: 1.8rem; }
  .anchor { display: none; }
}
@media print {
  nav.toc, .copy { display: none; }
  .layout { display: block; }
  main { padding: 0; }
  pre { white-space: pre-wrap; }
}
`;

const SCRIPT = `
(function () {
  var root = document.documentElement;
  try { var saved = localStorage.getItem('msfs-ui-guide-theme'); if (saved) root.setAttribute('data-theme', saved); } catch (e) {}
  var themeButton = document.querySelector('.theme');
  function dark() { var t = root.getAttribute('data-theme'); return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; }
  function label() { themeButton.textContent = dark() ? 'Light theme' : 'Dark theme'; }
  label();
  themeButton.addEventListener('click', function () {
    var next = dark() ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('msfs-ui-guide-theme', next); } catch (e) {}
    label();
  });
  var toc = document.querySelector('nav.toc');
  document.querySelector('.menu').addEventListener('click', function () {
    toc.classList.toggle('open');
    this.setAttribute('aria-expanded', toc.classList.contains('open'));
  });
  toc.addEventListener('click', function (e) { if (e.target.tagName === 'A') toc.classList.remove('open'); });
  document.querySelectorAll('.copy').forEach(function (button) {
    button.addEventListener('click', function () {
      var text = button.nextElementSibling.textContent;
      function done() { button.textContent = 'Copied'; button.classList.add('done'); setTimeout(function () { button.textContent = 'Copy'; button.classList.remove('done'); }, 1500); }
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () {});
    });
  });
  var links = Array.prototype.slice.call(document.querySelectorAll('nav.toc a'));
  var sections = links.map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); });
  function spy() {
    var current = 0;
    sections.forEach(function (s, i) { if (s && s.getBoundingClientRect().top < 120) current = i; });
    links.forEach(function (a, i) { a.classList.toggle('active', i === current); });
  }
  addEventListener('scroll', spy, { passive: true });
  spy();
})();
`;

function page(markdown) {
  const headings = [];
  const body = blocks(markdown.replace(/\r\n/g, '\n').split('\n'), headings);
  const title = markdown.match(/^#\s+(.*)$/m)[1].trim();
  const toc = headings
    .filter((h) => h.id !== 'contents')
    .map((h) => `<li><a href="#${h.id}">${inline(h.text)}</a></li>`)
    .join('');
  // The guide's own list of contents is the sidebar here.
  const article = body.replace(/<h2 id="contents">[\s\S]*?(?=<h2 )/, '');
  return `<!doctype html>
<!-- Generated from ${SOURCE} by tools/docs-html/build.mjs. Do not edit: change the Markdown and run the script again. -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="How to take the code of MSFS-UI, the MSFS 2024 main menu mod, and make your own version with any AI.">
<style>${STYLE}</style>
</head>
<body>
<div class="layout">
<nav class="toc" aria-label="Contents">
<button type="button" class="menu" aria-expanded="false">Contents</button>
<div class="toc-body">
<p class="toc-title">Contents</p>
<ol>${toc}</ol>
<button type="button" class="theme">Dark theme</button>
</div>
</nav>
<main>
<article>
${article}
<footer>MSFS-UI, MIT License, © 2026 Proxi64. Generated from <a href="${REPOSITORY}${SOURCE}" target="_blank" rel="noopener">${SOURCE}</a>.</footer>
</article>
</main>
</div>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

const html = page(readFileSync(join(ROOT, SOURCE), 'utf8'));
if (process.argv.includes('--check')) {
  let current = '';
  // Git may check the page out with CRLF line endings (core.autocrlf): they do not make it out of date.
  try { current = readFileSync(join(ROOT, TARGET), 'utf8').replace(/\r\n/g, '\n'); } catch { /* missing: out of date */ }
  if (current !== html) {
    console.error(`${TARGET} is out of date: run node tools/docs-html/build.mjs`);
    process.exit(1);
  }
  console.log(`${TARGET} is up to date`);
} else {
  writeFileSync(join(ROOT, TARGET), html);
  console.log(`${TARGET} written (${Math.round(html.length / 1024)} KB) from ${SOURCE}`);
}
