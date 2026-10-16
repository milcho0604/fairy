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
  one('[data-friend-copy]').addEventListener('click', function () {
    var done = function () { one('[data-friend-copied]').hidden = false; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, function () {});
  });
})();
