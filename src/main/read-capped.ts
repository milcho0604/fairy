// 응답 본문을 상한까지만 읽는다 (버그잡이 7차). Electron 없이 돌아 시험에서 그대로 부른다.

/**
 * 본문을 글로 읽되 maxBytes 를 넘으면 그 자리에서 끊고 undefined. res.text() 는 다 받은 뒤에야 크기를 알아
 * 아주 큰 응답(잘못된 주소, 끝없는 응답)을 메모리에 다 올렸다.
 */
export async function readCapped(res: Response, maxBytes: number): Promise<string | undefined> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    return undefined;
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return undefined;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
