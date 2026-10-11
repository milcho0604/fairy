# Homepage (site/)

The introduction and download page for the app. Plain static HTML, CSS and JS: no framework, no build step to
deploy, no server, no cookies, no tracking. The only outside requests are Google Fonts and one call to the GitHub
API for the latest release.

```
site/
├── config.js           ← product name, tagline, site URL, releases repo, file patterns. Change things HERE.
├── i18n.js             ← every string, Korean (default) and English, plus the {name|조사} filler
├── index.html          ← landing page
├── download/index.html ← all files + install steps per OS
├── 404.html
├── assets/
│   ├── site.css        ← colors follow the app (src/renderer/src/tokens.css), light + dark
│   ├── app.js          ← language switch, OS detection, release fetch, Bean walking the hero floor
│   ├── og.png          ← 1200x630 share card (made by tools/og.mjs)
│   ├── img/            ← webp made from docs/assets/screens (tools/images.py, tools/kong_sprite.py)
│   └── icons/          ← favicons from build/icon.png
├── sitemap.xml, robots.txt, site.webmanifest   ← written by tools/build.mjs
├── vercel.json         ← security headers (CSP) and image caching for Vercel
└── tools/              ← build.mjs, og.mjs + og.html, images.py, kong_sprite.py (not needed at runtime)
```

Preview locally: `python3 -m http.server -d site 8080` → http://localhost:8080 (add `?lang=en` for English).

## How the config works

`config.js` sets `window.SITE`. The browser reads it directly, and `tools/build.mjs` reads the same file in Node.

- **Visible text** comes from `i18n.js`. Placeholders like `{name}`, `{name|은는}` (name + the right Korean
  particle, picked from the final sound, so it still works when the name becomes English), `{file}`, `{app}` are
  filled from `config.js`.
- **Static HTML** (what crawlers, link previews and no-JS visitors see) is pre-rendered in Korean by
  `node site/tools/build.mjs`. It fills every `data-i18n` element, writes the `<head>` block between
  `<!-- meta:start -->` and `<!-- meta:end -->` (title, description, canonical, Open Graph, Twitter card, JSON-LD),
  and regenerates `sitemap.xml`, `robots.txt` and `site.webmanifest`. It is idempotent; run it after any change to
  `config.js` or `i18n.js` and commit the result.
- **Language**: Korean by default; `navigator.language` picks English for non-Korean browsers; the header button
  switches and remembers the choice in `localStorage`; `?lang=en|ko` forces one.

### When the app gets its English name

1. Edit `config.js`: `name.en` (and `name.ko` if Korean pages should use it), `tagline`, `siteUrl`,
   `releases.repo`, `filePrefix` (start of the installer names), `appBundleName` (the `.app` / product name).
2. `node site/tools/build.mjs`
3. `node site/tools/og.mjs` to redraw the share card (needs Playwright: `npm i -D playwright && npx playwright install chromium`,
   or point `PLAYWRIGHT_MODULE` at an existing install).
4. Read through `i18n.js` for things that are not the product name but may change with it: the hero line
   "작은 짝꿍" and "옆자리 짝꿍처럼" use 짝꿍 as the common word ("buddy"), the `.jjpet` file extension, the pet names.
5. `xattr` command, data folder paths and file names in the FAQ follow `appBundleName` / `filePrefix` automatically.

## Images

All pictures are the real app screenshots from `docs/assets/screens/` (the to-dos and events in them are made up).

- `python3 site/tools/images.py` → resized webp, the hero panel cut-out, the quick-add bar, favicons. Behind the pets
  the desktop wallpaper's lavender corner is warmed to peach so the page stays in the app's warm palette; the pets'
  own colors are untouched.
- `python3 site/tools/kong_sprite.py` (needs numpy + scipy) → `kong-sprite.webp/json`: Bean cut out of the real
  recording `hero.webp` (the wallpaper is the per-pixel median of all frames). The page plays it with
  `background-position` steps and moves it along the hero floor; with *reduce motion* Bean stands still.

Re-run both after re-shooting the screens with `scripts/dev/screens.mjs`.

## Deploy on Vercel (recommended)

1. vercel.com → **Add New… → Project** → import this GitHub repo (private is fine).
2. **Root Directory**: `site`. **Framework Preset**: Other. Leave Build Command and Output Directory empty
   (or Output Directory `.`). Deploy.
3. Project → **Settings → Domains** → add `<name>.moilga.com`.
   - If `moilga.com` already uses Vercel's nameservers (it is in the same Vercel account), the subdomain works at once.
   - If the apex DNS is elsewhere, add at that DNS provider: `CNAME  <name>  cname.vercel-dns.com`.
     Vercel issues the HTTPS certificate by itself once DNS resolves.
4. Change `siteUrl` in `config.js` to `https://<name>.moilga.com`, run `node site/tools/build.mjs`, commit, push.

`vercel.json` sets a strict Content-Security-Policy (only Google Fonts and `api.github.com` are allowed). If you
later add analytics or embeds, add their hosts there or the browser will block them. Vercel serves `404.html`
automatically.

Every push to the default branch redeploys. To avoid deploying on app-only commits, set **Settings → Git →
Ignored Build Step** to `git diff --quiet HEAD^ HEAD -- site/`.

## Alternative: GitHub Pages

Pages from a private repository needs a paid GitHub plan; from a public repo it is free. Add
`.github/workflows/pages.yml`:

```yaml
name: pages
on:
  push: { branches: [main], paths: ['site/**'] }
  workflow_dispatch:
permissions: { contents: read, pages: write, id-token: write }
concurrency: { group: pages, cancel-in-progress: true }
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: { name: github-pages, url: '${{ steps.d.outputs.page_url }}' }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/upload-pages-artifact@v3
        with: { path: site }
      - id: d
        uses: actions/deploy-pages@v4
```

Then **Settings → Pages → Source: GitHub Actions**, **Custom domain**: `<name>.moilga.com`, and at the DNS
provider `CNAME  <name>  <github-user>.github.io`. Tick **Enforce HTTPS** once the certificate is ready.
GitHub Pages cannot send the security headers in `vercel.json`. `404.html` uses root-relative paths, so it is meant
for a custom domain (not a `user.github.io/repo/` sub-path).

## Downloads without a server, and a public releases-only repo

The page asks `https://api.github.com/repos/{owner}/{repo}/releases?per_page=10` from the visitor's browser
(no token), takes the newest non-draft release (pre-releases count), and picks files by the name patterns in
`config.js` (electron-builder's `artifactName` is `<name>-${version}-${os}-${arch}.${ext}`, so mac `…-mac-arm64.dmg`,
`…-mac-x64.dmg`, windows `…-win-x64.exe`, linux `…-linux-x86_64.AppImage` / `…-linux-x64.tar.gz`). It shows the
version, date, size and, when GitHub provides it, the SHA-256. The answer is cached for 15 minutes per tab;
GitHub allows 60 unauthenticated calls per hour per visitor IP.

- Repo private, missing or with no release yet → 404 → buttons read **곧 나와요 / Coming soon**.
- Rate limit or offline → buttons link to the releases page.

A private repo's releases are invisible to visitors (and to the app's update check). To keep the source private,
publish builds to a **public, releases-only** repo, e.g. `milcho0604/<name>-releases`:

1. Create the public repo with just a README (and a LICENSE if you like). Nothing else needs to live there.
2. In the private repo, create a fine-grained token with **Contents: read and write** on the releases repo only and
   store it as an Actions secret (e.g. `RELEASES_TOKEN`). In `release.yml`, upload with
   `gh release create vX.Y.Z -R milcho0604/<name>-releases <files…>` using that token. Upload the update metadata
   too (`latest.yml`, `latest-mac.yml`, `*.blockmap`, the mac `.zip`), not only the installers.
3. Point the app at it (code changes for later, not done here):
   - `electron-builder.yml` → `publish: { provider: github, owner: milcho0604, repo: <name>-releases }`
     (the auto-updater reads `latest*.yml` from there);
   - `src/shared/update-policy.ts` → `RELEASE_REPO` (a test checks it matches `electron-builder.yml`);
   - `src/shared/ai/catalog.ts` → `CATALOG_URL` and `src/shared/gallery.ts` → `GALLERY_BASE` read
     `raw.githubusercontent.com/<owner>/<repo>/main/…`, so `catalog/` and `gallery/` must also be in a public repo
     (copy them into the releases repo and keep them in sync, or point those URLs elsewhere).
4. Publish releases as normal (not *draft*). The app's update check uses `/releases/latest`, which ignores
   *pre-releases*; the site shows pre-releases too.
5. Set `releases.repo` in `config.js` and run `node site/tools/build.mjs` (footer links follow it).
