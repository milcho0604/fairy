import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// 칸 암호화 (쪽지 글). AES-256-GCM, 저장 모양은 "s1:" + base64(iv 12 + 암호문 + 태그 16).
// AAD 는 이 글이 속한 자리(예: "inbox|<쪽지 번호>")라서 다른 줄의 암호문을 옮겨 붙이면 풀리지 않는다.
// 접두어가 없으면 평문이다 (열쇠를 넣기 전에 쓴 옛 줄). 평문이 우연히 접두어로 시작하면 "s0:" 를 앞에 붙여 구분한다.

const SEALED = 's1:';
const ESCAPED = 's0:';
const IV = 12;
const TAG = 16;

export const isSealed = (stored: string): boolean => stored.startsWith(SEALED);

/** 잠그기. 열쇠는 32바이트 */
export function sealText(key: Buffer, text: string, aad: string): string {
  const iv = randomBytes(IV);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad));
  const body = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return SEALED + Buffer.concat([iv, body, c.getAuthTag()]).toString('base64');
}

/** 열쇠 없이 저장할 때의 모양: 평문 그대로, 접두어와 겹치면 "s0:" 를 붙인다 */
export function plainStored(text: string): string {
  return text.startsWith(SEALED) || text.startsWith(ESCAPED) ? ESCAPED + text : text;
}

/** 풀기. 접두어가 없으면 평문, 틀린 열쇠나 바뀐 자리(AAD)나 깨진 글이면 던진다 */
export function openText(key: Buffer | undefined, stored: string, aad: string): string {
  if (stored.startsWith(ESCAPED)) return stored.slice(ESCAPED.length);
  if (!stored.startsWith(SEALED)) return stored;
  if (!key) throw new Error('seal: 열쇠가 없다');
  const raw = Buffer.from(stored.slice(SEALED.length), 'base64');
  if (raw.length < IV + TAG) throw new Error('seal: 너무 짧다');
  const d = createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(raw.subarray(raw.length - TAG));
  return Buffer.concat([d.update(raw.subarray(IV, raw.length - TAG)), d.final()]).toString('utf8');
}
