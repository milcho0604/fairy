#!/usr/bin/env node
// config.js 와 i18n.js 를 읽어 HTML 에 <head> 메타와 한국어 글을 미리 채우고, sitemap.xml, robots.txt, manifest 를 만든다.
// Reads config.js + i18n.js, stamps <head> meta and the Korean text into the HTML (so crawlers, link previews and
// no-JS visitors see real content), and writes sitemap.xml, robots.txt and site.webmanifest.
// Idempotent; no dependencies. Run from anywhere:  node site/tools/build.mjs
import { createHash } from 'node:crypto';
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
  { file: 'privacy/index.html', path: '/privacy/', base: '../', titleKey: 'meta.pvTitle', descKey: 'meta.pvDesc', sitemap: true },
  { file: '404.html', path: '/404.html', base: '/', titleKey: 'nf.title', descKey: null, sitemap: false, noindex: true },
];

function vars(base) {
  return { name: S.name[LANG], tagline: S.tagline[LANG], file: S.filePrefix, app: S.appBundleName, license: S.license, petFileExt: S.petFileExt, home: base };
}

// ---- shared header and footer (one copy for every page) ----
function header(b) {
  return `<header class="top">
  <div class="wrap top-in">
    <a class="brand" href="${b}" data-i18n-attr="aria-label:a11y.home">
      <img src="${b}assets/icons/icon-192.png" width="32" height="32" alt="">
      <span class="brand-name" data-name></span>
    </a>
    <nav class="nav" data-i18n-attr="aria-label:a11y.nav">
      <a href="${b}#features" data-nav="features" data-i18n="nav.features"></a>
      <a href="${b}#maker" data-nav="maker" data-i18n="nav.maker"></a>
      <a href="${b}#privacy" data-nav="privacy" data-i18n="nav.privacy"></a>
      <a href="${b}#faq" data-nav="faq" data-i18n="nav.faq"></a>
    </nav>
    <div class="top-act">
      <button class="lang" type="button" data-lang-toggle><span lang="en" data-i18n="lang.other"></span></button>
      <a class="btn btn-sm" href="${b}#download" data-i18n="nav.download"></a>
    </div>
  </div>
</header>`;
}
function footer(b) {
  return `<footer class="foot">
  <div class="wrap foot-in">
    <div class="peek" aria-hidden="true"><img src="${b}assets/img/milk-256.webp" srcset="${b}assets/img/milk-256.webp 1x, ${b}assets/img/milk-512.webp 2x" width="92" height="159" alt="" loading="lazy" decoding="async"></div>
    <div class="foot-brand">
      <a class="brand" href="${b}"><img src="${b}assets/icons/icon-192.png" width="28" height="28" alt=""><span class="brand-name" data-name></span></a>
      <p data-i18n="footer.tag"></p>
    </div>
    <nav class="foot-col" aria-labelledby="foot-explore">
      <h2 id="foot-explore" data-i18n="footer.explore"></h2>
      <ul>
        <li><a href="${b}#features" data-i18n="nav.features"></a></li>
        <li><a href="${b}#maker" data-i18n="nav.maker"></a></li>
        <li><a href="${b}#privacy" data-i18n="nav.privacy"></a></li>
        <li><a href="${b}download/" data-i18n="nav.download"></a></li>
      </ul>
    </nav>
    <nav class="foot-col" aria-labelledby="foot-help">
      <h2 id="foot-help" data-i18n="footer.help"></h2>
      <ul>
        <li><a href="${b}#faq" data-i18n="nav.faq"></a></li>
        <li><a data-href="changelog" data-i18n="footer.changelog"></a></li>
        <li><a data-href="releases" data-i18n="footer.releases"></a></li>
        <li><a data-href="contact" data-i18n="footer.contact"></a></li>
        <li><a href="${b}privacy/" data-i18n="footer.policy"></a></li>
      </ul>
    </nav>
    <div class="foot-bottom">
      <p><span data-i18n="footer.license"></span>, <span data-copyright></span></p>
      <p data-i18n="footer.made"></p>
    </div>
  </div>
</footer>`;
}

// ---- "what's new" strip from updates.json ----
const UPD = JSON.parse(readFileSync(join(SITE_DIR, 'updates.json'), 'utf8')).items.slice(0, 3);
function newsDate(iso, lang) {
  const d = new Date(iso + 'T00:00:00Z');
  return lang === 'ko' ? `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
function newsHead() {
  return ['ko', 'en'].map((l) => `<time datetime="${UPD[0].date}" data-news="${l}"${l === LANG ? '' : ' hidden'}>${esc(newsDate(UPD[0].date, l))}</time>`).join('');
}
function news() {
  return ['ko', 'en'].map((l) => `<ul class="news-list" data-news="${l}"${l === LANG ? '' : ' hidden'}>
${UPD.map((u) => `        <li><strong>${esc(u[l].title)}</strong><span>${esc(u[l].text)}</span></li>`).join('\n')}
      </ul>`).join('\n      ');
}

// ---- download table: the same rows app.js draws while loading, so nothing jumps when it fills in ----
function fileRows() {
  const v = vars('./');
  const t = (k) => fill(D[LANG][k], v);
  const tails = { macArm: 'mac-arm64.dmg', macIntel: 'mac-x64.dmg', win: 'win-x64.exe', linuxAppImage: 'linux-x86_64.AppImage', linuxTar: 'linux-x64.tar.xz' };
  return Object.entries(tails).map(([k, tail]) => `<tr><th scope="row">${esc(t('dl.os.' + k))}</th><td><span class="fname">${esc(t('dlp.pattern') + tail)}</span></td><td>${esc(t('dlp.pending'))}</td><td><a class="btn" aria-disabled="true" role="link">…</a></td></tr>`).join('');
}

// ---- inline the stylesheet (no render-blocking request); CSP gets its hash ----
const CSS_SRC = readFileSync(join(SITE_DIR, 'assets/site.css'), 'utf8');
const styleHashes = new Set();
function inlineCss(b) {
  const css = CSS_SRC
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/url\(img\//g, `url(${b}assets/img/`)
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n+/g, '\n')
    .trim();
  styleHashes.add(`'sha256-${createHash('sha256').update(css).digest('base64')}'`);
  return `<style>${css}</style>`;
}

// ---- Jua is only used for headings: ask Google Fonts for just those characters ----
const DISPLAY_KEYS = /^(hero\.title|[a-z]+\.title|about\.(pet|biz|ai)T|more\.\dt|maker\.o\dt|steps\.s\dt|dlp\.(title|macT|winT|linuxT|aiT)|nf\.title)$/;
function fontHref() {
  let chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,!?&’\'"–-():;/';
  for (const l of Object.keys(D)) {
    const v = vars('./');
    v.name = S.name[l];
    for (const [k, str] of Object.entries(D[l])) if (DISPLAY_KEYS.test(k)) chars += fill(str, v).replace(/<[^>]+>/g, '');
    chars += S.name[l];
  }
  const uniq = [...new Set(chars)].sort().join('');
  // `text=` subsets every family in a request, so Jua gets its own request
  return [
    'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600&display=swap',
    // block, not swap: the subset is tiny and arrives fast, and swapping a wider fallback re-wraps the hero title (CLS)
    `https://fonts.googleapis.com/css2?family=Jua&display=block&text=${encodeURIComponent(uniq)}`,
  ];
}

function head(p) {
  const v = vars(p.base);
  const t = (k) => fill(D[LANG][k], v);
  const title = p.file === '404.html' ? `${v.name}: ${t('nf.title')}` : t(p.titleKey);
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
    `<link rel="icon" type="image/svg+xml" href="${b}assets/icons/icon.svg">`,
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
  html = html.replace(/<!-- header:start -->[\s\S]*?<!-- header:end -->/, `<!-- header:start -->\n${header(p.base)}\n<!-- header:end -->`);
  html = html.replace(/<!-- footer:start -->[\s\S]*?<!-- footer:end -->/, `<!-- footer:start -->\n${footer(p.base)}\n<!-- footer:end -->`);
  html = html.replace(/<tbody data-files>[\s\S]*?<\/tbody>/, `<tbody data-files>${fileRows()}</tbody>`);
  html = html.replace(/<!-- newshead:start -->[\s\S]*?<!-- newshead:end -->/, `<!-- newshead:start -->${newsHead()}<!-- newshead:end -->`);
  html = html.replace(/<!-- news:start -->[\s\S]*?<!-- news:end -->/, `<!-- news:start -->\n      ${news()}\n      <!-- news:end -->`);
  html = html.replace(/<!-- css:start -->[\s\S]*?<!-- css:end -->/, `<!-- css:start -->\n${inlineCss(p.base)}\n<!-- css:end -->`);
  html = html.replace(/(<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/css2[^"]*">\n?)+/, fontHref().map((h) => `<link rel="stylesheet" href="${esc(h)}">\n`).join(''));
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
      const to = { changelog: S.changelogUrl || relPage, releases: relPage, contact: S.contactEmail ? `mailto:${S.contactEmail}` : `https://github.com/${S.releases.owner}/${S.releases.repo}/issues/new/choose` }[href[1]];
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

// keep the CSP in vercel.json in step with the inlined styles
const vjPath = join(SITE_DIR, 'vercel.json');
const vj = JSON.parse(readFileSync(vjPath, 'utf8'));
const cspHeader = vj.headers[0].headers.find((h) => h.key === 'Content-Security-Policy');
cspHeader.value = cspHeader.value.replace(/style-src [^;]*/, `style-src 'self' https://fonts.googleapis.com ${[...styleHashes].sort().join(' ')}`);
writeFileSync(vjPath, JSON.stringify(vj, null, 2) + '\n');

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
