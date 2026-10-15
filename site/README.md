# Homepage (site/) for fairy.moilga.com

The introduction and download page for **fairy** (페어리). The English brand is always lowercase. Plain static HTML, CSS and JS: no framework, no build step to
deploy, no server, no cookies, no tracking. The only outside requests are Google Fonts and one call to the GitHub
API for the latest release.

```
site/
├── config.js           ← product name, tagline, site URL, releases repo, file patterns. Change things HERE.
├── i18n.js             ← every string, Korean (default) and English, plus the {name|조사} filler
├── updates.json        ← the "새로 생긴 것 / What's new" strip under the hero (first three items)
├── index.html          ← landing page
├── download/index.html ← all files + install steps per OS
├── privacy/index.html  ← privacy policy (short version box on top)
├── terms/index.html    ← terms of use for the server features (short version box on top)
├── 404.html
├── assets/
│   ├── site.css        ← source stylesheet; build.mjs inlines it into each page
│   ├── app.js          ← language switch, OS detection, release fetch, Bean walking the hero floor, screens carousel
│   ├── og.png          ← 1200x630 share card (made by tools/og.mjs)
│   ├── img/            ← webp/avif from the app (tools/capture.mjs, tools/pets.mjs, tools/images.py)
│   └── icons/          ← favicons from build/icon.png, and logo-* (the header and footer logo, cut out by tools/logo.py)
├── sitemap.xml, robots.txt, site.webmanifest   ← written by tools/build.mjs
├── vercel.json         ← security headers (CSP) and image caching for Vercel
├── .vercelignore       ← keeps tools/ and this README off the deployed site
└── tools/              ← build.mjs, og.mjs + og.html, images.py, logo.py, capture.mjs, pets.mjs + app.mjs, shots.py, kong_sprite.py (not deployed)
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
- **Shared header and footer** are written once in `tools/build.mjs` and stamped into every page.
- **CSS** lives in `assets/site.css` but is inlined into each page by the build (no render-blocking request). The
  build also writes the matching `sha256-…` hashes into the CSP in `vercel.json`. Always run the build after
  editing the CSS, or the browser will refuse the new styles.
- **Fonts**: IBM Plex Sans KR (body, Google's own unicode-range slices) and Jua for headings only, requested with
  `text=` so just the heading characters are downloaded (`display=block`: the subset is tiny, and a swap would re-wrap
  the hero title). New heading text needs a rebuild to be in the subset.
- **What's new**: edit `updates.json` (newest first, ko and en), rebuild.
- **Language**: Korean by default; `navigator.language` picks English for non-Korean browsers; the header button
  switches and remembers the choice in `localStorage`; `?lang=en|ko` forces one.

### Changing names later

1. Edit `config.js`: `name` (ko 페어리 / en fairy), `tagline`, `siteUrl`, `releases.repo`, `filePrefix` (start of the
   installer names, `fairy-<version>-mac-arm64.dmg`), `appBundleName` (`fairy.app`, also used for the data folder
   paths in the FAQ), `petFileExt` (the share-a-fairy file extension, `.fairy`; the app still opens old `.jjpet` files).
2. `node site/tools/build.mjs`
3. `node site/tools/og.mjs` to redraw the share card (needs Playwright: `npm i -D playwright && npx playwright install chromium`,
   or point `PLAYWRIGHT_MODULE` at an existing install). The card's headline lives in `tools/og.html`.
4. Characters are called 페어리 / fairy on the site, never 펫 / pet.

## Images

All pictures are the real app screenshots from `docs/assets/screens/` (the to-dos and events in them are made up).

- `python3 site/tools/images.py` → resized webp, the hero panel cut-out, the quick-add bar, favicons. Behind the pets
  the desktop wallpaper's lavender corner is warmed to peach so the page stays in the app's warm palette; the pets'
  own colors are untouched.
- `python3 site/tools/kong_sprite.py` (needs numpy + scipy) → `kong-sprite.webp/json`: Bean cut out of the real
  recording `hero.webp` (the wallpaper is the per-pixel median of all frames). The page plays it with
  `background-position` steps and moves it along the hero floor; with *reduce motion* Bean stands still.

Re-run both after re-shooting the screens with `scripts/dev/screens.mjs`.

- `BG_MODEL=<isnet-general-use.onnx> python3 site/tools/logo.py` (needs numpy, scipy, onnxruntime) → `icons/logo-{32,64,96}.{png,webp}`:
  Choco and Milk from `build/icon.png` with the backdrop and the basket cut away by the app's own background model, for
  the header and footer next to the name. The favicons and the manifest icons keep the full rounded icon. Without the
  basket the two faces are bigger at 32px, and the basket read as a plain white bar on the dark page. The page gives the
  logo a `drop-shadow` (not a box shadow) so the white cat keeps an edge on the light background.

**Sharp on retina.** Every picture has a file at twice the CSS size it is shown at (strips 1140px wide come in
2280/1520/760, chat 760/400, the hero panel 706/353), picked with `srcset`. Strips and the panel also have an AVIF next to
the webp in a `<picture>`; Bean's sprite uses CSS `image-set()` (AVIF, webp fallback). The fairy pictures and Bean's walk
are shot fresh from the app at 4x by `tools/pets.mjs` (pet scale 2, device scale 2, transparent, app clock frozen so
each walk and dance step is exact); `kong_sprite.py` (the old cut-out of `hero.webp`) is no longer needed for the site.
The maker steps 2 and 3 need the 178MB background model (`BG_MODEL=...`); without it `maker-steps` stays as it is.

The panel, chat, AI picker, quick-add bar, first-run look picker and the three maker steps can also be re-shot
straight from the current app, with made-up data, without touching `docs/`:

```bash
npm run build
python3 site/tools/shots.py photo /tmp/shots/photo.png         # sample photo: Milk on a soft backdrop
OUT=/tmp/shots node site/tools/capture.mjs                     # test instance: JJ_NO_FOCUS=1, empty data folder, no network, ports 9851/9852
python3 site/tools/shots.py compose /tmp/shots                 # 2x layouts, hero cut-outs, tour/*.png for the carousel
OUT=/tmp/pets node site/tools/pets.mjs                         # fairies, looks, moods and Bean's walk at 4x (same test-instance rules)
python3 site/tools/shots.py pets /tmp/pets                     # pets and moods strips, look cut-outs, kong-sprite.png/json
SCREENS=/tmp/shots/screens PETS=/tmp/pets/screens python3 site/tools/images.py   # webp + avif; missing ones come from docs/
node site/tools/og.mjs                                         # the share card uses hero-panel-706.webp (PLAYWRIGHT_CHROMIUM=<binary> if needed)
```

`images.py` also re-encodes `milk-*`, `choco-*` and the icons from their sources; if their pixels did not change, keep
the committed files (`git checkout -- site/assets/icons site/assets/img/milk-* site/assets/img/choco-*`).

On Linux run it on its own Xvfb display; `BG_MODEL=<isnet-general-use.onnx>` skips the 170MB model download and
`JJ_ORT_WASM_URL` is passed through (see `scripts/dev/README.md`). If an image's size changes, update its
`width`/`height` in `index.html`.

## Deploy on Vercel (recommended)

1. vercel.com → **Add New… → Project** → import this GitHub repo (private is fine).
2. **Root Directory**: `site`. **Framework Preset**: Other. Leave Build Command and Output Directory empty
   (or Output Directory `.`). Deploy.
3. Project → **Settings → Domains** → add `fairy.moilga.com`.
   - If `moilga.com` already uses Vercel's nameservers (it is in the same Vercel account), the subdomain works at once.
   - If the apex DNS is elsewhere, add at that DNS provider: `CNAME  fairy  cname.vercel-dns.com`.
     Vercel issues the HTTPS certificate by itself once DNS resolves.
4. `siteUrl` in `config.js` is already `https://fairy.moilga.com`; if the domain changes, edit it and run `node site/tools/build.mjs`.

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

Then **Settings → Pages → Source: GitHub Actions**, **Custom domain**: `fairy.moilga.com`, and at the DNS
provider `CNAME  fairy  <github-user>.github.io`. Tick **Enforce HTTPS** once the certificate is ready.
GitHub Pages cannot send the security headers in `vercel.json`. `404.html` uses root-relative paths, so it is meant
for a custom domain (not a `user.github.io/repo/` sub-path).

## Downloads without a server, and a public releases-only repo

The page asks `https://api.github.com/repos/{owner}/{repo}/releases?per_page=10` from the visitor's browser
(no token), takes the newest non-draft release (pre-releases count), and picks files by the name patterns in
`config.js` (electron-builder's `artifactName` is `<name>-${version}-${os}-${arch}.${ext}`, so mac `…-mac-arm64.dmg`,
`…-mac-x64.dmg`, windows `…-win-x64.exe`, linux `…-linux-x86_64.AppImage` / `…-linux-x64.tar.xz`). It shows the
version, date, size and, when GitHub provides it, the SHA-256. The answer is cached for 15 minutes per tab;
GitHub allows 60 unauthenticated calls per hour per visitor IP.

- The site reads the public, releases-only repo `milcho0604/fairy-releases` (`releases` in `config.js`); every GitHub link
  on the site (releases, changelog, contact → new issue) points there, never at the source repo.
- Repo missing (404) or there but with no release yet (200, empty list) → buttons read **곧 나와요 / Coming soon** with a
  "GitHub에서 소식 받기 / Get notified on GitHub" link to that repo.
- Rate limit or offline → a different note ("couldn't check just now"), and the buttons link to the releases page.

A private repo's releases are invisible to visitors (and to the app's update check). To keep the source private,
publish builds to a **public, releases-only** repo, e.g. `milcho0604/fairy-releases`:

1. Create the public repo with just a README (and a LICENSE if you like). Nothing else needs to live there.
2. In the private repo, create a fine-grained token with **Contents: read and write** on the releases repo only and
   store it as an Actions secret (e.g. `RELEASES_TOKEN`). In `release.yml`, upload with
   `gh release create vX.Y.Z -R milcho0604/fairy-releases <files…>` using that token. Upload the update metadata
   too (`latest.yml`, `latest-mac.yml`, `*.blockmap`, the mac `.zip`), not only the installers.
3. Point the app at it (code changes for later, not done here):
   - `electron-builder.yml` → `publish: { provider: github, owner: milcho0604, repo: fairy-releases }`
     (the auto-updater reads `latest*.yml` from there);
   - `src/shared/update-policy.ts` → `RELEASE_REPO` (a test checks it matches `electron-builder.yml`);
   - `src/shared/ai/catalog.ts` → `CATALOG_URL` and `src/shared/gallery.ts` → `GALLERY_BASE` read
     `raw.githubusercontent.com/<owner>/<repo>/main/…`, so `catalog/` and `gallery/` must also be in a public repo
     (copy them into the releases repo and keep them in sync, or point those URLs elsewhere).
4. Publish releases as normal (not *draft*). The app's update check uses `/releases/latest`, which ignores
   *pre-releases*; the site shows pre-releases too.
5. Set `releases.repo` in `config.js` and run `node site/tools/build.mjs` (footer links follow it).

## Checks used before each change

Playwright scripts (not in the repo) were run against `python3 -m http.server -d site`: screenshots at
1440/1024/768/390 in light and dark, Korean and English; CLS (< 0.03 on every page), LCP element, one `h1` and no
skipped heading levels, every image has `alt`, every internal link and anchor resolves, WCAG AA text contrast in
both themes, every Tab stop shows a focus ring, no single orphaned word at the end of headings and lead paragraphs
(360–1440px). `html-validate` (recommended rules) passes on all three pages.
