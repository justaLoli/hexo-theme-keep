/* global hexo */

/**
 * documentations —— 由 _data/documentations.yml 驱动的文档页生成器
 *
 * 配置示例（source/_data/documentations.yml）：
 *
 *   - page: jp-grammar
 *     sourcedir:
 *       - /source/_data/jp-grammar/
 *
 * 生成：
 *   /jp-grammar/index.html      第一篇文章（方便直接访问目录）
 *   /jp-grammar/<md 文件名>.html 每篇 markdown 一页
 *
 * 规则：
 *   - 页面 URL、排序都按 markdown 文件名的字典序
 *   - 左侧导航文字取 front-matter 的 `short name`，没有就用文件名
 *   - 正文原样渲染，不额外加标题
 */

'use strict';

const fs = require('fs');
const path = require('path');
const frontMatter = require('hexo-front-matter');

const DEFAULT_PAGE = 'documentations';

let mathjaxFilter;
let mathjaxLoaded = false;

function getMathjaxFilter() {
  if (mathjaxLoaded) return mathjaxFilter;
  mathjaxLoaded = true;
  try {
    mathjaxFilter = require('hexo-filter-mathjax/lib/filter')(hexo.config.mathjax || {});
  } catch (err) {
    mathjaxFilter = null;
  }
  return mathjaxFilter;
}

function renderMarkdown(text) {
  const html = hexo.render.renderSync({ text, engine: 'md' });
  const mathjax = getMathjaxFilter();
  return mathjax ? mathjax(html) : html;
}

function decodeEntities(text) {
  const map = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (raw, code) => {
    if (code[0] === '#') {
      const hex = code[1] === 'x' || code[1] === 'X';
      const value = parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : raw;
    }
    return Object.prototype.hasOwnProperty.call(map, code) ? map[code] : raw;
  });
}

/** 从渲染后的 HTML 里抽取 h1-h4，用于右侧页内目录 */
function buildToc(html) {
  const toc = [];
  const pattern = /<h([1-4])\b([^>]*)>([\s\S]*?)<\/h\1>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const id = (match[2].match(/\bid="([^"]+)"/) || [])[1];
    if (!id) continue;
    const text = decodeEntities(match[3].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    toc.push({ level: Number(match[1]), id, text });
  }
  return toc;
}

/** /source/_data/x/ 这类以 / 开头的写法按项目根目录解析 */
function resolveSourceDir(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;

  const candidates = [];
  if (raw.startsWith('/')) {
    candidates.push(path.join(hexo.base_dir, raw.replace(/^\/+/, '')));
    candidates.push(raw);
  } else {
    candidates.push(path.join(hexo.base_dir, raw));
    candidates.push(path.join(hexo.source_dir, raw));
    candidates.push(path.join(hexo.source_dir, '_data', raw));
  }
  return candidates.find((dir) => fs.existsSync(dir) && fs.statSync(dir).isDirectory()) || null;
}

function readMarkdownFiles(dirs) {
  const files = [];
  for (const dir of dirs) {
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith('_') || name.startsWith('.')) continue;
      if (!/\.md$/i.test(name)) continue;
      files.push({ name, fullPath: path.join(dir, name) });
    }
  }
  // 字典序，与文件管理器/终端里的排序一致
  return files.sort((a, b) => (a.name > b.name ? 1 : a.name < b.name ? -1 : 0));
}

function loadDocument(item) {
  const file = item.fullPath;
  const raw = fs.readFileSync(file, 'utf8');
  // 只有文件以 --- 开头才解析 front-matter，避免正文里的分隔线被误判
  const data = /^(-{3,}|;{3,})\r?\n/.test(raw) ? frontMatter.parse(raw) : { _content: raw };

  const base = path.basename(file, path.extname(file));
  const body = data._content || '';
  const html = renderMarkdown(body);

  return {
    slug: base,
    name: String(data['short name'] || data.short_name || data.shortName || base).trim() || base,
    body: html,
    toc: buildToc(html),
  };
}

function normalizePage(page) {
  const value = String(page || '').trim().replace(/^\/+|\/+$/g, '');
  return value || DEFAULT_PAGE;
}

function buildDocumentation(entry) {
  const page = normalizePage(entry.page);
  const sourceDirs = (Array.isArray(entry.sourcedir) ? entry.sourcedir : [entry.sourcedir])
    .map(resolveSourceDir)
    .filter(Boolean);
  if (!sourceDirs.length) return [];

  const files = readMarkdownFiles(sourceDirs);
  if (!files.length) return [];

  const docs = files.map(loadDocument);

  // 文件名重复时静默加后缀，避免路由互相覆盖
  const used = new Set();
  for (const doc of docs) {
    let slug = doc.slug;
    for (let i = 2; used.has(slug); i += 1) slug = `${doc.slug}-${i}`;
    used.add(slug);
    doc.slug = slug;
  }

  const collectionTitle = String(entry.title || page);
  const nav = docs.map((doc) => ({
    name: doc.name,
    slug: doc.slug,
    url: `/${page}/${doc.slug}.html`,
  }));

  const routes = docs.map((doc) => ({
    path: `${page}/${doc.slug}.html`,
    layout: 'documentations',
    data: {
      title: doc.name,
      docTitle: collectionTitle,
      docBase: page,
      docNav: nav,
      docCurrent: doc.slug,
      docToc: doc.toc,
      body: doc.body,
    },
  }));

  // /<page>/ 直接呈现第一篇文章，方便从 post 里的链接进入
  if (!used.has('index')) {
    const first = docs[0];
    routes.push({
      path: `${page}/index.html`,
      layout: 'documentations',
      data: {
        title: collectionTitle,
        docTitle: collectionTitle,
        docBase: page,
        docNav: nav,
        docCurrent: first.slug,
        docToc: first.toc,
        docIsIndex: true,
        docFirstUrl: `/${page}/${first.slug}.html`,
        body: first.body,
      },
    });
  }

  return routes;
}

hexo.extend.generator.register('documentations', function () {
  const data = hexo.locals.get('data') || {};
  const config = data.documentations;
  if (!config) return [];

  const entries = Array.isArray(config) ? config : Object.keys(config).map((key) => {
    const value = config[key];
    return typeof value === 'object' ? Object.assign({ page: key }, value) : { page: key, sourcedir: value };
  });

  return entries.reduce((routes, entry) => routes.concat(buildDocumentation(entry || {})), []);
});
