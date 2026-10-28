/*
 * 친구 초대 링크 (/f/<코드>/, 이슈 #110): 주소에서 친구 코드를 읽어 보여 주고 "앱에서 열기"(fairy://friend/<코드>) 단추를 단다.
 * 저절로 열기는 하지 않는다 (사용자 결정 2026-10-16: 앱이 없으면 Safari 가 경고를 띄웠다). 설치 안내와 코드 복사를 같이 둔다.
 * 코드는 어디로도 보내지 않는다 (정적 파일).
 * Friend invite link: shows the code from the URL with an "Open in app" button. No automatic open. Nothing is sent anywhere.
 */
(function () {
  'use strict';
  var m = /^\/f\/([0-9A-Za-z-]{8,12})\/?$/.exec(location.pathname);
  var raw = m ? m[1].toUpperCase().replace(/-/g, '').replace(/O/g, '0').replace(/[IL]/g, '1') : '';
  if (raw.length === 9 && raw.charAt(0) === 'F') raw = raw.slice(1);
  var code = /^[0-9A-HJKMNP-TV-Z]{8}$/.test(raw) ? 'F-' + raw.slice(0, 4) + '-' + raw.slice(4) : '';
  function one(sel) { return document.querySelector(sel); }
  if (!code) {
    one('[data-friend-bad]').hidden = false;
    return;
  }
  var url = 'fairy://friend/' + code;
  var shown = one('[data-friend-code]');
  shown.textContent = code;
  shown.hidden = false;
  one('[data-friend-act]').hidden = false;
  one('[data-friend-open]').href = url;
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (ok, fail) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      var done = false;
      try { done = document.execCommand('copy'); } catch (e) { /* ignore */ }
      document.body.removeChild(ta);
      done ? ok() : fail();
    });
  }
  one('[data-friend-copy]').addEventListener('click', function () {
    copyText(code).then(function () { one('[data-friend-copied]').hidden = false; }, function () {});
  });

  // 앱이 열리면 이 페이지는 숨겨지거나 포커스를 잃는다. 열기를 누르고 3초가 지나도 그대로면 설치 안내를 보인다.
  // After "Open in the app", the app taking over hides the page or blurs the window; if neither happens in 3 s, show the install hint.
  var timer = 0;
  function stop() { if (timer) { clearTimeout(timer); timer = 0; } }
  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); });
  window.addEventListener('pagehide', stop);
  window.addEventListener('blur', stop);
  one('[data-friend-open]').addEventListener('click', function () {
    stop();
    timer = setTimeout(function () {
      timer = 0;
      if (!document.hidden) one('[data-friend-missing]').hidden = false;
    }, 3000);
  });
  // 받기를 누르면 코드부터 복사한다. 받기 페이지는 새 탭에서 열려 이 안내가 그대로 남는다.
  one('[data-friend-get]').addEventListener('click', function () {
    var say = function (kind) { one('[data-friend-guide="' + kind + '"]').hidden = false; };
    copyText(code).then(function () { say('ok'); }, function () { say('fail'); });
  });
})();
