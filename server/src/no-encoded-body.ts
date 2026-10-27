import type { IncomingMessage, ServerResponse } from 'node:http';

// 압축된 요청 본문(Content-Encoding)은 받지 않는다. 앱도 운영자 화면도 요청을 압축해 보내지 않고,
// body-parser 의 압축 풀기가 DoS 경로가 된 적이 있다(GHSA-27r3-jxmh-p828). 본문 해석기보다 앞에 둔다.
// 서버 백업 올리기(PUT /v1/backup)도 압축 없이 octet-stream 을 그대로 받으므로 같은 규칙이다.

/** identity 와 빈 값만 통과한다 */
export function hasEncodedBody(header: string | string[] | undefined): boolean {
  const raw = Array.isArray(header) ? header.join(',') : (header ?? '');
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .some((s) => s !== '' && s !== 'identity');
}

export function rejectEncodedBody(req: IncomingMessage, res: ServerResponse, next: () => void): void {
  if (!hasEncodedBody(req.headers['content-encoding'])) {
    next();
    return;
  }
  const body = JSON.stringify({ error: 'unsupported_content_encoding' });
  res.statusCode = 415;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', Buffer.byteLength(body));
  // 본문을 읽지 않고 끝내므로 연결을 닫아 남은 바이트를 다음 요청으로 오해하지 않게 한다
  res.setHeader('connection', 'close');
  res.end(body);
}
