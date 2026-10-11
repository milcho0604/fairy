#!/usr/bin/env node
// config.js 와 i18n.js 를 읽어 HTML 에 <head> 메타와 한국어 글을 미리 채우고, sitemap.xml, robots.txt, manifest 를 만든다.
// Reads config.js + i18n.js, stamps <head> meta and the Korean text into the HTML (so crawlers, link previews and
// no-JS visitors see real content), and writes sitemap.xml, robots.txt and site.webmanifest.
// Idempotent; no dependencies. Run from anywhere:  node site/tools/build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const SITE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const ctx = { window: {} };
vm.createContext(ctx);
for (const f of ['config.js', 'i18n.js']) vm.runInContext(readFileSync(join(SITE_DIR, f), 'utf8'), ctx, { filename: f });
const { SITE: S, I18N: D, I18N_FILL: fill } = ctx.window;

const LANG = 'ko'; // what the static HTML carries; app.js switches to English in the browser
const siteUrl = S.siteUrl.replace(/\/+$/, '');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const relPage = `https://github.com/${S.releases.owner}/${S.releases.repo}/releases`;

const PAGES = [
  { file: 'index.html', path: '/', base: './', titleKey: 'meta.title', descKey: null, sitemap: true },
  { file: 'download/index.html', path: '/download/', base: '../', titleKey: 'meta.dlTitle', descKey: 'meta.dlDesc', sitemap: true },
  { file: '404.html', path: '/404.html', base: '/', titleKey: 'nf.title', descKey: null, sitemap: false, noindex: true },
];

function vars(base) {
  return { name: S.name[LANG], tagline: S.tagline[LANG], file: S.filePrefix, app: S.appBundleName, license: S.license, home: base };
}

function head(p) {
  const v = vars(p.base);
  const t = (k) => fill(D[LANG][k], v);
  const title = p.file === '404.html' ? `${t('nf.title')} — ${v.name}` : t(p.titleKey);
  const desc = p.descKey ? t(p.descKey) : v.tagline;
  const url = siteUrl + p.path;
  const og = `${siteUrl}/assets/og.png`;
  const b = p.base;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: S.name.en,
    alternateName: S.name.ko !== S.name.en ? S.name.ko : undefined,
    description: S.tagline.en,
    applicationCategory: 'ProductivityApplication',
    operatingSystem: 'macOS 12+, Windows 10+ (x64), Linux x64 (preview)',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    url: siteUrl + '/',
    image: og,
    downloadUrl: siteUrl + '/download/',
    license: `https://opensource.org/licenses/${S.license}`,
  };
  const lines = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    p.noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${esc(url)}">`,
    '<meta name="color-scheme" content="light dark">',
    '<meta name="theme-color" content="#fbf8f4" media="(prefers-color-scheme: light)">',
    '<meta name="theme-color" content="#1b1917" media="(prefers-color-scheme: dark)">',
    `<link rel="icon" type="image/png" sizes="32x32" href="${b}assets/icons/icon-32.png">`,
    `<link rel="icon" type="image/png" sizes="192x192" href="${b}assets/icons/icon-192.png">`,
    `<link rel="apple-touch-icon" href="${b}assets/icons/apple-touch-icon.png">`,
    `<link rel="manifest" href="${b}site.webmanifest">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:site_name" content="${esc(v.name)}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:image" content="${esc(og)}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    `<meta property="og:image:alt" content="${esc(t('meta.ogAlt'))}">`,
    '<meta property="og:locale" content="ko_KR">',
    '<meta property="og:locale:alternate" content="en_US">',
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">`,
    `<meta name="twitter:image" content="${esc(og)}">`,
    `<meta name="twitter:image:alt" content="${esc(t('meta.ogAlt'))}">`,
  ];
  if (S.twitter) lines.push(`<meta name="twitter:site" content="${esc(S.twitter)}">`);
  if (p.file === 'index.html') lines.push(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`);
  return lines.join('\n');
}

function stamp(html, p) {
  const v = vars(p.base);
  const t = (k) => {
    if (!(k in D[LANG])) throw new Error(`${p.file}: no ko string for "${k}"`);
    for (const l of Object.keys(D)) if (!(k in D[l])) console.warn(`warning: "${k}" is missing in ${l}`);
    return fill(D[LANG][k], v);
  };
  html = html.replace(/<!-- meta:start -->[\s\S]*?<!-- meta:end -->/, `<!-- meta:start -->\n${head(p)}\n<!-- meta:end -->`);
  html = html.replace(/<html\b[^>]*>/, (m) => m.replace(/\slang="[^"]*"/, ` lang="${LANG}"`));
  // <tag ... data-i18n="key">…</tag>  (an element with data-i18n must not contain another element of its own tag name)
  html = html.replace(/<([a-z][a-z0-9]*)((?:\s[^>]*?)?\sdata-i18n="([^"]+)"[^>]*)>([\s\S]*?)<\/\1>/g,
    (_, tag, attrs, key) => `<${tag}${attrs}>${esc(t(key))}</${tag}>`);
  html = html.replace(/<([a-z][a-z0-9]*)((?:\s[^>]*?)?\sdata-i18n-html="([^"]+)"[^>]*)>([\s\S]*?)<\/\1>/g,
    (_, tag, attrs, key) => `<${tag}${attrs}>${t(key)}</${tag}>`);
  html = html.replace(/<([a-z][a-z0-9]*)((?:\s[^>]*?)?\sdata-name\b[^>]*)>([\s\S]*?)<\/\1>/g,
    (_, tag, attrs) => `<${tag}${attrs}>${esc(v.name)}</${tag}>`);
  html = html.replace(/<([a-z][a-z0-9]*)((?:\s[^>]*?)?\sdata-copyright[^>]*)>([\s\S]*?)<\/\1>/g,
    (_, tag, attrs) => `<${tag}${attrs}>${esc(S.copyright)}</${tag}>`);
  // attributes: data-i18n-attr="alt:key;aria-label:key2" and data-href="changelog|releases|contact"
  html = html.replace(/<([a-z][a-z0-9]*)(\s[^>]*?)>/g, (m, tag, attrs) => {
    let a = attrs;
    const spec = a.match(/\sdata-i18n-attr="([^"]+)"/);
    if (spec) {
      for (const pair of spec[1].split(';')) {
        const [attr, key] = pair.split(':').map((x) => x.trim());
        a = a.replace(new RegExp(`\\s${attr}="[^"]*"`), '');
        a = a.replace(/\sdata-i18n-attr=/, ` ${attr}="${esc(t(key))}" data-i18n-attr=`);
      }
    }
    const href = a.match(/\sdata-href="([^"]+)"/);
    if (href) {
      const to = { changelog: S.changelogUrl || relPage, releases: relPage, contact: `mailto:${S.contactEmail}` }[href[1]];
      a = a.replace(/\shref="[^"]*"/, '').replace(/\sdata-href=/, ` href="${esc(to)}" data-href=`);
    }
    return a === attrs ? m : `<${tag}${a}>`;
  });
  return html;
}

for (const p of PAGES) {
  const f = join(SITE_DIR, p.file);
  const before = readFileSync(f, 'utf8');
  const after = stamp(before, p);
  if (after !== before) writeFileSync(f, after);
  console.log(`${after === before ? 'unchanged' : 'stamped  '} ${p.file}`);
}

const today = new Date().toISOString().slice(0, 10);
writeFileSync(join(SITE_DIR, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${PAGES.filter((p) => p.sitemap)
    .map((p) => `  <url><loc>${esc(siteUrl + p.path)}</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n</urlset>\n`);
writeFileSync(join(SITE_DIR, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`);
writeFileSync(join(SITE_DIR, 'site.webmanifest'), JSON.stringify({
  name: S.name.ko === S.name.en ? S.name.en : `${S.name.ko} (${S.name.en})`,
  short_name: S.name.ko,
  description: S.tagline.ko,
  start_url: './',
  display: 'browser',
  background_color: '#fbf8f4',
  theme_color: '#fbf8f4',
  icons: [
    { src: 'assets/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'assets/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
  ],
}, null, 2) + '\n');
console.log('wrote sitemap.xml, robots.txt, site.webmanifest');
