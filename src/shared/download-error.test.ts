import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DownloadError,
  downloadErrorText,
  failReason,
  saveErrorText,
  statusReason,
} from './download-error.ts';
import { setLang, t } from './i18n/index.ts';

const errno = (code: string, message = `${code}: something`) => Object.assign(new Error(message), { code });

test('Chromium 네트워크 오류는 오프라인과 연결 끊김으로 나눈다', () => {
  assert.equal(failReason(new Error('net::ERR_INTERNET_DISCONNECTED')), 'offline');
  assert.equal(failReason(new Error('net::ERR_NAME_NOT_RESOLVED')), 'offline');
  assert.equal(failReason(new Error('net::ERR_CONNECTION_RESET')), 'network');
  assert.equal(failReason(new Error('net::ERR_TIMED_OUT')), 'network');
  assert.equal(failReason(Object.assign(new Error('x'), { name: 'TimeoutError' })), 'network');
  assert.equal(failReason(errno('ENOTFOUND')), 'offline');
  assert.equal(failReason(errno('ECONNRESET')), 'network');
});

test('디스크와 권한 오류는 code 로, 감싸져 code 가 없으면 글로 알아본다', () => {
  assert.equal(failReason(errno('ENOSPC')), 'disk-full');
  assert.equal(failReason(errno('EDQUOT')), 'disk-full');
  assert.equal(
    failReason(new Error('Error invoking remote method: ENOSPC: no space left on device, write')),
    'disk-full',
  );
  assert.equal(failReason(errno('EACCES')), 'no-permission');
  assert.equal(failReason(errno('EROFS')), 'no-permission');
});

test('우리 오류는 갈래를 그대로, 서버 상태는 없어짐(404, 410)과 서버 오류로', () => {
  assert.equal(failReason(new DownloadError('hash')), 'hash');
  assert.equal(failReason(new DownloadError('busy')), 'busy');
  assert.equal(statusReason(404), 'gone');
  assert.equal(statusReason(410), 'gone');
  assert.equal(statusReason(503), 'server');
  assert.equal(statusReason(403), 'server');
});

test('멈춘 것은 원인 글보다 먼저 멈춤으로 본다', () => {
  assert.equal(failReason(new Error('net::ERR_ABORTED'), true), 'cancelled');
  assert.equal(failReason(Object.assign(new Error('aborted'), { name: 'AbortError' })), 'cancelled');
  assert.equal(failReason('문자열'), 'failed');
  assert.equal(failReason(new Error('뭔지 모름')), 'failed');
});

test('화면 글에는 오류 원문이 들어가지 않는다', () => {
  for (const lang of ['ko', 'en'] as const) {
    setLang(lang);
    try {
      const cases: unknown[] = [
        new Error('net::ERR_INTERNET_DISCONNECTED'),
        new Error('net::ERR_CONNECTION_RESET'),
        errno('ENOSPC', 'ENOSPC: no space left on device, write'),
        errno('EACCES', "EACCES: permission denied, open '/Users/x/Library/a.part'"),
        new DownloadError('server', 502),
        new DownloadError('gone', 404),
        new DownloadError('hash'),
        new Error('Unexpected token < in JSON at position 0'),
      ];
      for (const err of cases) {
        const text = downloadErrorText(err, { mb: 179 });
        assert.ok(!/net::|ENOSPC|EACCES|\/Users\/|Unexpected token|^download /.test(text), text);
        assert.ok(text.length > 0);
        const saved = saveErrorText(err);
        assert.ok(!/net::|ENOSPC|EACCES|\/Users\//.test(saved), saved);
      }
    } finally {
      setLang('ko');
    }
  }
});

test('갈래마다 다른 안내: 공간은 얼마나 비울지, 서버는 상태 번호를 알린다', () => {
  assert.equal(downloadErrorText(new Error('net::ERR_INTERNET_DISCONNECTED')), t('main.model.offline'));
  assert.equal(downloadErrorText(new Error('net::ERR_CONNECTION_RESET')), t('main.model.network'));
  assert.equal(downloadErrorText(new DownloadError('hash')), t('main.model.badHash'));
  assert.match(downloadErrorText(errno('ENOSPC'), { mb: 397 }), /397MB/);
  assert.equal(downloadErrorText(errno('ENOSPC')), t('main.file.diskFull'));
  assert.match(downloadErrorText(new DownloadError('server', 503)), /503/);
  assert.match(downloadErrorText(new DownloadError('gone', 404)), /404/);
  assert.equal(downloadErrorText(new Error('x'), { aborted: true }), t('main.model.cancelled'));
  assert.equal(downloadErrorText(new Error('뭔지 모름')), t('main.model.failed'));
  // 갈래가 다르면 글도 달라야 사용자가 할 일을 안다
  const texts = new Set(
    ['offline', 'network', 'hash', 'busy', 'cancelled', 'failed', 'no-permission'].map((r) =>
      downloadErrorText(new DownloadError(r as never)),
    ),
  );
  assert.equal(texts.size, 7);
  assert.equal(saveErrorText(errno('ENOSPC')), t('main.file.diskFull'));
  assert.equal(saveErrorText(errno('EPERM')), t('main.file.noPermission'));
  assert.equal(saveErrorText(new Error('그림 형식')), t('main.file.saveFailed'));
});

test('프록시나 방화벽이 통째로 막으면 그렇다고 알린다 (연결이 불안정하다고 하지 않고)', () => {
  assert.equal(failReason(new Error('net::ERR_TUNNEL_CONNECTION_FAILED')), 'blocked');
  assert.equal(failReason(new Error('net::ERR_PROXY_CONNECTION_FAILED')), 'blocked');
  assert.equal(failReason(new Error('net::ERR_CERT_AUTHORITY_INVALID')), 'blocked');
  assert.equal(failReason(errno('SELF_SIGNED_CERT_IN_CHAIN')), 'blocked');
  assert.equal(statusReason(407), 'blocked');
  setLang('ko');
  assert.match(downloadErrorText(new Error('net::ERR_TUNNEL_CONNECTION_FAILED')), /프록시나 방화벽/);
  setLang('en');
  assert.match(downloadErrorText(new DownloadError('blocked', 407)), /proxy or firewall/);
  setLang('ko');
});
