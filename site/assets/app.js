/*
 * 페이지 동작: 언어 바꾸기, 운영체제 알아보고 받기 단추 채우기, GitHub 최신 릴리스 읽기, 화면 아래를 걷는 콩이.
 * Page behaviour: language switch, OS-aware download buttons, latest GitHub release, and Bean walking the hero floor.
 * 쿠키 없음, 추적 없음. 저장하는 것은 고른 언어(localStorage)와 릴리스 정보 15분 캐시(sessionStorage)뿐.
 */
(function () {
  'use strict';
  var S = window.SITE;
  var D = window.I18N;
  var fill = window.I18N_FILL;
  var root = document.documentElement;
  var base = root.getAttribute('data-base') || './';
  var page = root.getAttribute('data-page') || 'home';
  var reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');

  var REPO = 'https://github.com/' + S.releases.owner + '/' + S.releases.repo;
  var REL_PAGE = REPO + '/releases';
  var ORDER = ['macArm', 'macIntel', 'win', 'linuxAppImage', 'linuxTar'];

  /* ---------------- language ---------------- */
  function store(kind, k, v) {
    try { if (v === undefined) return window[kind].getItem(k); window[kind].setItem(k, v); } catch (e) { return null; }
  }
  function pickLang() {
    var q = new URLSearchParams(location.search).get('lang');
    if (q === 'ko' || q === 'en') return q;
    var saved = store('localStorage', 'lang');
    if (saved === 'ko' || saved === 'en') return saved;
    var langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'ko'];
    for (var i = 0; i < langs.length; i++) {
      var l = String(langs[i]).toLowerCase();
      if (l.indexOf('ko') === 0) return 'ko';
      if (l.indexOf('en') === 0) return 'en';
    }
    return 'en';
  }
  var lang = pickLang();

  function vars(extra) {
    var v = {
      name: S.name[lang] || S.name.ko,
      tagline: S.tagline[lang] || S.tagline.ko,
      file: S.filePrefix,
      app: S.appBundleName,
      license: S.license,
      petFileExt: S.petFileExt,
      home: base,
    };
    if (extra) for (var k in extra) v[k] = extra[k];
    return v;
  }
  function t(key, extra) {
    var s = (D[lang] && D[lang][key]) != null ? D[lang][key] : D.ko[key];
    return s == null ? key : fill(s, vars(extra));
  }
  function each(sel, fn) { Array.prototype.forEach.call(document.querySelectorAll(sel), fn); }

  function applyText() {
    root.lang = lang;
    each('[data-i18n]', function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    each('[data-i18n-html]', function (el) { el.innerHTML = t(el.getAttribute('data-i18n-html')); });
    each('[data-i18n-attr]', function (el) {
      el.getAttribute('data-i18n-attr').split(';').forEach(function (pair) {
        var p = pair.split(':');
        if (p.length === 2) el.setAttribute(p[0].trim(), t(p[1].trim()));
      });
    });
    each('[data-lang-toggle] span', function (el) { el.lang = lang === 'ko' ? 'en' : 'ko'; });
    each('[data-news]', function (el) { el.hidden = el.getAttribute('data-news') !== lang; });
    each('[data-name]', function (el) { el.textContent = S.name[lang] || S.name.ko; });
    each('[data-copyright]', function (el) { el.textContent = S.copyright; });
    each('[data-href]', function (el) {
      var k = el.getAttribute('data-href');
      if (k === 'changelog') el.href = S.changelogUrl || REL_PAGE;
      if (k === 'releases') el.href = REL_PAGE;
      if (k === 'contact') el.href = S.contactEmail ? 'mailto:' + S.contactEmail : REPO + '/issues/new/choose';
    });
    var titleKey = root.getAttribute('data-title-key') || 'meta.title';
    var title = t(titleKey);
    if (page === '404') title = vars().name + ': ' + t('nf.title');
    document.title = title;
    var desc = document.querySelector('meta[name="description"]');
    var descKey = root.getAttribute('data-desc-key');
    if (desc) desc.setAttribute('content', descKey ? t(descKey) : vars().tagline);
  }

  each('[data-lang-toggle]', function (b) {
    b.addEventListener('click', function () {
      lang = lang === 'ko' ? 'en' : 'ko';
      store('localStorage', 'lang', lang);
      applyText();
      renderDownloads();
      if (window.__kongLang) window.__kongLang();
      if (window.__tourLang) window.__tourLang();
    });
  });

  /* ---------------- header: soft background after scrolling, current section in the menu ---------------- */
  var top = document.querySelector('.top');
  if (top) {
    var onScroll = function () { top.classList.toggle('scrolled', window.scrollY > 8); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
  var navLinks = {};
  each('[data-nav]', function (a) { navLinks[a.getAttribute('data-nav')] = a; });
  var sectionFor = { features: 'features', pet: 'features', looks: 'features', assistant: 'features', ai: 'features', tour: 'features', maker: 'maker', privacy: 'privacy', faq: 'faq' };
  if ('IntersectionObserver' in window && page === 'home') {
    var visible = {};
    var mark = function () {
      var current = null;
      // the topmost section that is on screen wins
      Object.keys(visible).sort(function (a, b) { return visible[a] - visible[b]; }).some(function (id) { current = sectionFor[id] || null; return true; });
      Object.keys(navLinks).forEach(function (k) {
        if (k === current) navLinks[k].setAttribute('aria-current', 'location');
        else navLinks[k].removeAttribute('aria-current');
      });
    };
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) visible[e.target.id] = e.target.offsetTop; else delete visible[e.target.id];
      });
      mark();
    }, { rootMargin: '-45% 0px -50% 0px' });
    each('main section[id]', function (sec) { io.observe(sec); });
  }

  /* ---------------- which computer is this? ---------------- */
  function webglRenderer() {
    try {
      var c = document.createElement('canvas');
      var gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      if (!gl) return '';
      var ext = gl.getExtension('WEBGL_debug_renderer_info');
      return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    } catch (e) { return ''; }
  }
  function detectOS() {
    var ua = navigator.userAgent;
    var uad = navigator.userAgentData;
    if (/iPhone|iPad|iPod|Android/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return Promise.resolve({ os: 'mobile' });
    var platform = (uad && uad.platform) || '';
    if (!platform) {
      if (/Windows/.test(ua)) platform = 'Windows';
      else if (/Mac OS X|Macintosh/.test(ua)) platform = 'macOS';
      else if (/CrOS/.test(ua)) platform = 'Chrome OS';
      else if (/Linux|X11/.test(ua)) platform = 'Linux';
    }
    if (platform === 'Windows') return Promise.resolve({ os: 'win' });
    if (platform === 'Linux') return Promise.resolve({ os: 'linux' });
    if (platform !== 'macOS') return Promise.resolve({ os: 'unknown' });
    // Mac: Chromium tells the chip; elsewhere the GPU name usually does. Safari hides both, so Apple chip is the guess.
    var viaGpu = function () {
      var gpu = webglRenderer();
      if (/Apple M\d/i.test(gpu)) return { os: 'macArm', sure: true };
      if (/Intel|AMD|Radeon|NVIDIA/i.test(gpu)) return { os: 'macIntel', sure: true };
      return { os: 'macArm', sure: false };
    };
    if (uad && uad.getHighEntropyValues) {
      return uad.getHighEntropyValues(['architecture']).then(function (v) {
        if (v.architecture === 'arm') return { os: 'macArm', sure: true };
        if (v.architecture === 'x86') return { os: 'macIntel', sure: true };
        return viaGpu();
      }, viaGpu);
    }
    return Promise.resolve(viaGpu());
  }

  /* ---------------- latest release (no server, no token) ---------------- */
  function getRelease() {
    var key = 'rel:' + S.releases.owner + '/' + S.releases.repo;
    try {
      var c = JSON.parse(store('sessionStorage', key) || 'null');
      if (c && Date.now() - c.at < 15 * 60 * 1000) return Promise.resolve(c.r);
    } catch (e) { /* ignore */ }
    // The list (not /releases/latest) so a beta marked "pre-release" still shows. Drafts never do.
    var url = 'https://api.github.com/repos/' + S.releases.owner + '/' + S.releases.repo + '/releases?per_page=10';
    return fetch(url, { headers: { Accept: 'application/vnd.github+json' } }).then(function (res) {
      if (res.status === 404) return { state: 'soon' };
      if (!res.ok) return { state: 'error', status: res.status };
      return res.json().then(function (list) {
        var rel = null;
        for (var i = 0; i < list.length; i++) {
          if (!list[i].draft && list[i].assets && list[i].assets.length) { rel = list[i]; break; }
        }
        if (!rel) return { state: 'soon' };
        var assets = {};
        ORDER.forEach(function (k) {
          var re = new RegExp(S.assets[k]);
          for (var j = 0; j < rel.assets.length; j++) {
            var a = rel.assets[j];
            if (re.test(a.name)) { assets[k] = { name: a.name, size: a.size, url: a.browser_download_url, digest: a.digest || '' }; break; }
          }
        });
        return { state: 'ok', version: rel.tag_name, date: rel.published_at, url: rel.html_url, assets: assets };
      });
    }).catch(function () { return { state: 'error' }; }).then(function (r) {
      if (r.state !== 'error') store('sessionStorage', key, JSON.stringify({ at: Date.now(), r: r }));
      return r;
    });
  }

  function mb(bytes) { return Math.round(bytes / 1e6) + 'MB'; }
  function day(iso) {
    try { return new Intl.DateTimeFormat(lang === 'ko' ? 'ko-KR' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(iso)); } catch (e) { return iso.slice(0, 10); }
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function osKey(os) { return os === 'linux' ? 'linuxAppImage' : os; }
  function forKey(k) { return k === 'linuxAppImage' || k === 'linuxTar' ? 'linux' : k; }
  function pattern(k) {
    var tail = { macArm: 'mac-arm64.dmg', macIntel: 'mac-x64.dmg', win: 'win-x64.exe', linuxAppImage: 'linux-x86_64.AppImage', linuxTar: 'linux-x64.tar.xz' }[k];
    return t('dlp.pattern') + tail;
  }

  var OS = null;
  var REL = { state: 'loading' };

  function setLink(a, href, disabled) {
    if (disabled) { a.removeAttribute('href'); a.setAttribute('aria-disabled', 'true'); a.setAttribute('role', 'link'); }
    else { a.href = href; a.removeAttribute('aria-disabled'); a.removeAttribute('role'); }
  }

  function renderHeroButton(box) {
    var main = box.querySelector('.dl-main');
    var label = box.querySelector('.dl-label');
    var sub = box.querySelector('.dl-sub');
    var meta = box.querySelector('.dl-meta');
    var alt = box.querySelector('.dl-alt');
    var os = OS ? OS.os : 'unknown';
    var k = osKey(os);
    var known = ORDER.indexOf(k) >= 0;
    var allLink = base + 'download/';

    if (!known) {
      setLink(main, allLink);
      label.textContent = os === 'mobile' ? t('dl.mobile') : t('nav.download');
      sub.textContent = os === 'mobile' ? t('dl.mobileSub') : '';
    } else {
      label.textContent = t('dl.for.' + forKey(k));
      sub.textContent = ''; // chip / size only once there is a real file to download
    }

    var html = '';
    if (REL.state === 'loading') {
      if (known) setLink(main, allLink);
      html = esc(t('dl.loading'));
    } else if (REL.state === 'ok') {
      var a = known ? REL.assets[k] : null;
      if (known && a) {
        setLink(main, a.url);
        sub.textContent = t('dl.sub.' + forKey(k)) + ', ' + mb(a.size);
      } else if (known) {
        setLink(main, REL.url);
      }
      html = esc(REL.version + ', ' + day(REL.date)) + (known && !a ? '. ' + esc(t('dl.missing')) : '');
      if (known && os !== 'linux') html += '<br>' + t(os === 'win' ? 'dl.unsignedWin' : 'dl.unsignedMac');
    } else if (REL.state === 'soon') {
      if (known) { setLink(main, null, true); label.textContent = t('dl.soon'); }
      html = esc(t('dl.soonNote')) + ' <a href="' + esc(REPO) + '">' + esc(t('dl.follow')) + '</a>';
    } else {
      if (known) setLink(main, REL_PAGE);
      html = esc(t('dl.errorNote')) + ' ' + esc(t('dl.errorHint'));
    }
    meta.innerHTML = html;

    var links = [];
    ['macArm', 'macIntel', 'win', 'linuxAppImage'].forEach(function (o) {
      if (o === k) return;
      var a = REL.state === 'ok' && REL.assets[o];
      var href = a ? a.url : allLink;
      var name = o === 'linuxAppImage' ? 'Linux' : t('dl.os.' + o);
      links.push('<a href="' + esc(href) + '">' + esc(name) + '</a>');
    });
    links.push('<a href="' + esc(allLink) + '">' + esc(t('dl.all')) + '</a>');
    alt.innerHTML = esc(t(known ? 'dl.others' : 'dl.pick')) + ' ' + links.join('<span class="sep" aria-hidden="true">/</span>');
  }

  function cardButton(k, small, plain) {
    var a = REL.state === 'ok' && REL.assets[k];
    var cls = 'btn' + (small ? ' btn-ghost' : '');
    if (a) return '<a class="' + cls + '" href="' + esc(a.url) + '">' + esc(plain ? t('nav.download') : k === 'linuxTar' ? 'tar.xz' : k === 'linuxAppImage' ? 'AppImage' : t('nav.download')) + '</a>';
    if (REL.state === 'soon' || REL.state === 'loading') return '<a class="' + cls + '" aria-disabled="true" role="link">' + esc(REL.state === 'soon' ? t('dl.soon') : '…') + '</a>';
    return '<a class="' + cls + '" href="' + esc(REL.state === 'ok' ? REL.url : REL_PAGE) + '">' + esc(t('dl.releases')) + '</a>';
  }

  function renderCards(ul) {
    var mine = OS ? osKey(OS.os) : '';
    var cards = [
      { title: 'Mac', sub: 'macArm', keys: ['macArm'] },
      { title: 'Mac', sub: 'macIntel', keys: ['macIntel'] },
      { title: 'Windows', sub: 'win', keys: ['win'] },
      { title: 'Linux', sub: 'linux', keys: ['linuxAppImage', 'linuxTar'] },
    ];
    ul.innerHTML = cards.map(function (c) {
      var rec = c.keys.indexOf(mine) >= 0;
      var a = REL.state === 'ok' && REL.assets[c.keys[0]];
      var file = a ? a.name : pattern(c.keys[0]);
      var meta = a ? mb(a.size) + ', ' + day(REL.date) : (REL.state === 'ok' ? t('dl.missing') : '');
      var keys = REL.state === 'ok' ? c.keys : c.keys.slice(0, 1);
      var btns = keys.map(function (k, i) { return cardButton(k, keys.length > 1 && i > 0); }).join('');
      return '<li class="card' + (rec ? ' rec' : '') + '">' +
        (rec ? '<span class="badge">' + esc(t('dlp.recommended')) + '</span>' : '') +
        '<h3>' + esc(c.title) + '</h3><p class="sub">' + esc(t('dl.sub.' + c.sub)) + '</p>' +
        '<p class="file">' + esc(file) + '</p><p class="meta">' + esc(meta) + '</p>' +
        '<div class="acts">' + btns + '</div></li>';
    }).join('');
  }

  function renderFiles(tbody) {
    var mine = OS ? osKey(OS.os) : '';
    tbody.innerHTML = ORDER.map(function (k) {
      var a = REL.state === 'ok' && REL.assets[k];
      var digest = a && a.digest ? '<span class="digest">' + esc(t('dlp.digest')) + ' ' + esc(a.digest.replace(/^sha256:/, '')) + '</span>' : '';
      return '<tr' + (k === mine ? ' class="rec"' : '') + '><th scope="row">' + esc(t('dl.os.' + k)) + (k === mine ? ' (' + esc(t('dlp.recommended')) + ')' : '') + '</th>' +
        '<td><span class="fname">' + esc(a ? a.name : pattern(k)) + '</span>' + digest + '</td>' +
        '<td>' + esc(a ? mb(a.size) : REL.state === 'ok' ? '-' : t('dlp.pending')) + '</td>' +
        '<td>' + cardButton(k, false, true) + '</td></tr>';
    }).join('');
  }

  function renderReleaseLine(el) {
    if (REL.state === 'ok') el.innerHTML = esc(t('dlsec.latest')) + ' <strong>' + esc(REL.version) + '</strong> (' + esc(day(REL.date)) + '). <a href="' + esc(REL.url) + '">' + esc(t('dl.releases')) + '</a>';
    else if (REL.state === 'soon') el.innerHTML = esc(t('dl.soonNote')) + ' <a href="' + esc(REPO) + '">' + esc(t('dl.follow')) + '</a>';
    else if (REL.state === 'error') el.innerHTML = esc(t('dl.errorNote')) + ' <a href="' + esc(REL_PAGE) + '">' + esc(t('dl.errorLink')) + '</a>';
    else el.textContent = t('dl.loading');
  }

  function renderDownloads() {
    each('[data-dl]', renderHeroButton);
    each('[data-cards]', renderCards);
    each('[data-files]', renderFiles);
    each('[data-release-line]', renderReleaseLine);
  }

  /* ---------------- Bean walks the hero floor ---------------- */
  function kong() {
    var floor = document.querySelector('[data-floor]');
    if (!floor) return;
    var btn = floor.querySelector('[data-kong]');
    var spr = btn.querySelector('.kong-sprite');
    var bubble = floor.querySelector('[data-bubble]');
    fetch(base + 'assets/img/kong-sprite.json').then(function (r) { return r.json(); }).then(start, function () {});

    function start(M) {
      var s = 1, width = 0, kw = 0;
      var x = 0, dir = 1, target = 0;
      var mode = 'idle', frame = 0, frameT = 0, wait = 1400;
      var line = 0, bubbleKey = null, bubbleT = 0;
      var running = true, last = 0, raf = 0;

      function measure() {
        s = parseFloat(getComputedStyle(btn).getPropertyValue('--s')) || 1;
        width = floor.clientWidth;
        kw = M.w * s;
      }
      function setFrame(i) {
        var col = i % M.cols, row = Math.floor(i / M.cols);
        spr.style.backgroundPosition = (-col * M.w * s) + 'px ' + (-row * M.h * s) + 'px';
      }
      function place() {
        btn.style.setProperty('--x', x.toFixed(1) + 'px');
        spr.style.setProperty('--dir', dir);
        if (bubbleKey) placeBubble();
      }
      function placeBubble() {
        var bw = bubble.offsetWidth;
        var center = x + kw / 2;
        var left = Math.max(4, Math.min(width - bw - 4, center - bw / 2));
        bubble.style.setProperty('--bx', left.toFixed(1) + 'px');
        bubble.style.setProperty('--tail', Math.max(16, Math.min(bw - 16, center - left)).toFixed(1) + 'px');
      }
      function say(key, ms) {
        bubbleKey = key;
        bubble.textContent = t(key);
        bubbleT = ms || 0;
        placeBubble();
        bubble.classList.add('on');
      }
      function hush() { bubbleKey = null; bubble.classList.remove('on'); }
      window.__kongLang = function () { if (bubbleKey) { bubble.textContent = t(bubbleKey); placeBubble(); } };

      function range() { return M[mode === 'walk' ? 'walk' : mode === 'cheer' ? 'cheer' : 'idle']; }
      function setMode(m) { mode = m; frame = range()[0]; frameT = 0; setFrame(frame); }

      function pickTarget() {
        var min = width * 0.03, max = width - kw - width * 0.03;
        var tries = 0;
        do { target = min + Math.random() * (max - min); tries++; } while (Math.abs(target - x) < width * 0.28 && tries < 8);
        dir = target > x ? 1 : -1;
      }
      function arrive() {
        var key = 'bubble.' + (line % 3);
        line++;
        if (key === 'bubble.0') setMode('cheer'); else setMode('idle');
        say(key, 3600);
        wait = 4200 + Math.random() * 2600;
      }

      function tick(ts) {
        raf = 0;
        if (!running) return;
        var dt = Math.min(100, last ? ts - last : 16);
        last = ts;
        var r = range();
        frameT += dt;
        while (frameT >= M.durations[frame]) {
          frameT -= M.durations[frame];
          frame++;
          if (frame >= r[1]) {
            if (mode === 'cheer') { setMode('idle'); r = range(); }
            else frame = r[0];
          }
        }
        setFrame(frame);
        if (mode === 'walk') {
          x += dir * M.walkSpeed * s * 1.15 * dt / 1000;
          if ((dir > 0 && x >= target) || (dir < 0 && x <= target)) { x = target; arrive(); }
        } else {
          wait -= dt;
          if (wait <= 0) { hush(); pickTarget(); setMode('walk'); }
        }
        if (bubbleKey && bubbleT > 0) { bubbleT -= dt; if (bubbleT <= 0) hush(); }
        place();
        raf = requestAnimationFrame(tick);
      }
      function play() { if (!raf && running && !reduceMQ.matches) { last = 0; raf = requestAnimationFrame(tick); } }

      function still() {
        // Reduced motion: Bean stands still and says hello. No walking.
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        mode = 'idle';
        setFrame(0);
        x = Math.max(0, width * 0.72 - kw / 2);
        if (width < 640) x = Math.max(0, width - kw - 12);
        dir = 1;
        place();
        say('bubble.' + (line % 3));
      }

      measure();
      x = width * 0.06;
      setFrame(0);
      place();
      if (reduceMQ.matches) still(); else play();

      btn.addEventListener('click', function () {
        if (reduceMQ.matches) { line++; say('bubble.' + (line % 3)); return; }
        if (mode === 'walk') x = Math.round(x);
        setMode('cheer');
        say('bubble.pet', 2600);
        wait = 3000;
      });
      window.addEventListener('resize', function () {
        measure();
        x = Math.min(x, width - kw);
        target = Math.min(target, width - kw);
        if (reduceMQ.matches) still(); else { setFrame(frame); place(); }
      });
      var onMotion = function () { if (reduceMQ.matches) still(); else { hush(); play(); } };
      if (reduceMQ.addEventListener) reduceMQ.addEventListener('change', onMotion);
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (es) {
          running = es[0].isIntersecting && !document.hidden;
          play();
        }).observe(floor);
      }
      document.addEventListener('visibilitychange', function () { running = !document.hidden; play(); });
    }
  }

  /* ---------------- real app screens: carousel and a zoomed view ---------------- */
  // One screen at a time. Moves on by itself every few seconds, except with reduce motion; stops while the pointer is
  // over it, while something inside has focus, while the zoomed view is open and when it is off screen. The pause
  // button stops it for good. Arrow keys, Home and End work anywhere inside; swipe on touch screens.
  function tour() {
    var box = document.querySelector('[data-carousel]');
    if (!box) return;
    var track = box.querySelector('[data-track]');
    var view = box.querySelector('[data-view]');
    var slides = Array.prototype.slice.call(box.querySelectorAll('[data-slide]'));
    var dots = Array.prototype.slice.call(box.querySelectorAll('[data-dot]'));
    var playBtn = box.querySelector('[data-play]');
    var dlg = document.querySelector('[data-lightbox]');
    var n = slides.length, cur = 0, timer = 0;
    var DELAY = 4500;
    var stopped = reduceMQ.matches; // the pause button (or reduce motion) turned rotation off
    var hover = false, focusIn = false, onScreen = true;

    function show(i, fromUser) {
      cur = (i + n) % n;
      track.style.transform = 'translateX(' + (-100 * cur) + '%)';
      slides.forEach(function (s, k) {
        var on = k === cur;
        s.setAttribute('aria-hidden', on ? 'false' : 'true');
        if (on) s.removeAttribute('inert'); else s.setAttribute('inert', '');
      });
      dots.forEach(function (d, k) { d.setAttribute('aria-current', k === cur ? 'true' : 'false'); });
      // only announce changes the visitor asked for, not the timer
      track.setAttribute('aria-live', fromUser ? 'polite' : 'off');
      if (dlg && dlg.open) fillBox();
      schedule();
    }
    function running() { return !stopped && !hover && !focusIn && onScreen && !document.hidden && !(dlg && dlg.open); }
    function schedule() {
      clearTimeout(timer);
      timer = 0;
      if (running()) timer = setTimeout(function () { show(cur + 1, false); }, DELAY);
    }
    function labelPlay() {
      if (!playBtn) return;
      playBtn.hidden = false;
      playBtn.setAttribute('data-on', stopped ? 'false' : 'true');
      playBtn.setAttribute('aria-label', t(stopped ? 'tour.play' : 'tour.pause'));
    }
    window.__tourLang = function () { labelPlay(); if (dlg && dlg.open) fillBox(); };

    box.querySelector('[data-prev]').addEventListener('click', function () { show(cur - 1, true); });
    box.querySelector('[data-next]').addEventListener('click', function () { show(cur + 1, true); });
    dots.forEach(function (d, k) { d.addEventListener('click', function () { show(k, true); }); });
    if (playBtn) playBtn.addEventListener('click', function () { stopped = !stopped; labelPlay(); schedule(); });

    box.addEventListener('mouseenter', function () { hover = true; schedule(); });
    box.addEventListener('mouseleave', function () { hover = false; schedule(); });
    box.addEventListener('focusin', function () { focusIn = true; schedule(); });
    box.addEventListener('focusout', function (e) { if (!box.contains(e.relatedTarget)) { focusIn = false; schedule(); } });
    box.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'Home' && k !== 'End') return;
      e.preventDefault();
      var a = document.activeElement;
      var dot = dots.indexOf(a);
      var onDot = dot >= 0;
      // the focused slide goes inert when it slides away, so carry focus to the new one
      var inSlide = !!(a && a.closest && a.closest('[data-slide]'));
      var from = onDot ? dot : cur;
      show(k === 'Home' ? 0 : k === 'End' ? n - 1 : from + (k === 'ArrowLeft' ? -1 : 1), true);
      if (onDot) dots[cur].focus();
      else if (inSlide) { var z = slides[cur].querySelector('[data-zoom]'); if (z) z.focus(); }
    });
    if (reduceMQ.addEventListener) reduceMQ.addEventListener('change', function () { stopped = reduceMQ.matches; labelPlay(); schedule(); });
    document.addEventListener('visibilitychange', schedule);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) { onScreen = es[0].isIntersecting; schedule(); }, { threshold: 0.35 }).observe(box);
    }

    // swipe: a mostly sideways move of 40px or more turns the page (vertical moves keep scrolling the page)
    var sx = 0, sy = 0, swiping = false, swiped = false;
    view.addEventListener('pointerdown', function (e) { if (e.pointerType === 'mouse') return; sx = e.clientX; sy = e.clientY; swiping = true; swiped = false; });
    view.addEventListener('pointerup', function (e) {
      if (!swiping) return;
      swiping = false;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.2) { swiped = true; show(cur + (dx < 0 ? 1 : -1), true); }
    });
    view.addEventListener('pointercancel', function () { swiping = false; });

    /* zoomed view: <dialog> keeps focus inside and closes on Esc by itself */
    if (dlg && dlg.showModal) {
      var big = dlg.querySelector('[data-lb-img]');
      var cap = dlg.querySelector('[data-lb-cap]');
      var opener = null;
      var fillBox = function () {
        var z = slides[cur].querySelector('[data-zoom]');
        var im = z.querySelector('img');
        big.loading = 'eager';
        big.src = z.getAttribute('data-full');
        big.setAttribute('width', im.getAttribute('width'));
        big.setAttribute('height', im.getAttribute('height'));
        cap.textContent = slides[cur].querySelector('.car-cap').textContent + ' (' + (cur + 1) + ' / ' + n + ')';
      };
      slides.forEach(function (s) {
        s.querySelector('[data-zoom]').addEventListener('click', function (e) {
          if (swiped) { swiped = false; e.preventDefault(); return; }
          opener = e.currentTarget;
          fillBox();
          dlg.showModal();
          root.classList.add('lb-open');
          schedule();
        });
      });
      var closeBox = function () { if (dlg.open) dlg.close(); };
      dlg.addEventListener('close', function () {
        root.classList.remove('lb-open');
        // the slide may have changed inside: give focus to the button of the screen now showing
        var z = slides[cur].querySelector('[data-zoom]');
        (z || opener).focus();
        schedule();
      });
      dlg.querySelector('[data-lb-close]').addEventListener('click', closeBox);
      dlg.querySelector('[data-lb-prev]').addEventListener('click', function () { show(cur - 1, true); });
      dlg.querySelector('[data-lb-next]').addEventListener('click', function () { show(cur + 1, true); });
      // a click on the dark backdrop (the dialog itself, outside the picture and buttons) closes
      dlg.addEventListener('click', function (e) { if (e.target === dlg) closeBox(); });
      dlg.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); show(cur - 1, true); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); show(cur + 1, true); }
      });
      var lx = 0, ly = 0;
      dlg.addEventListener('pointerdown', function (e) { lx = e.clientX; ly = e.clientY; });
      dlg.addEventListener('pointerup', function (e) {
        if (e.pointerType === 'mouse') return;
        var dx = e.clientX - lx, dy = e.clientY - ly;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.2) show(cur + (dx < 0 ? 1 : -1), true);
      });
    }

    labelPlay();
    show(0, false);
  }

  /* ---------------- go ---------------- */
  // Jua never came (blocked, offline): let the hero title wrap again in the fallback font
  if (document.fonts && document.fonts.check) setTimeout(function () { if (!document.fonts.check('1em Jua', '화')) root.classList.add('no-jua'); }, 3500);
  applyText();
  renderDownloads();
  detectOS().then(function (o) { OS = o; renderDownloads(); });
  getRelease().then(function (r) { REL = r; renderDownloads(); });
  kong();
  tour();
})();
