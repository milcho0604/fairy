// 기기 간 동기화의 암호화 (docs/sync-plan.md 3절). node:crypto 만 쓴다.
// 서버는 소금, scrypt 매개변수, 감싼 열쇠, 잠근 덩어리만 안다. 복구 코드와 파생 열쇠는 기기 밖으로 나가지 않는다.
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

/** 새로 감쌀 때 쓰는 값 (약 100ms) */
export const SCRYPT_DEFAULT: ScryptParams = { N: 1 << 15, r: 8, p: 1 };
/** 서버가 준 값을 받아 주는 상한 (이보다 크면 서버가 느린 값을 억지로 쓰게 하는 것이다) */
export const SCRYPT_LIMIT: ScryptParams = { N: 1 << 17, r: 8, p: 1 };

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;

/** 받은 매개변수가 허용 범위인가: N 은 2 의 거듭제곱이고 2^17 이하, r 은 8 이하, p 는 1 이하 */
export function checkScryptParams(v: unknown): ScryptParams | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (Object.keys(o).length !== 3) return null;
  const { N, r, p } = o;
  if (!isInt(N) || !isInt(r) || !isInt(p)) return null;
  if (N < 2 || (N & (N - 1)) !== 0 || N > SCRYPT_LIMIT.N || r > SCRYPT_LIMIT.r || p > SCRYPT_LIMIT.p)
    return null;
  return { N, r, p };
}

// ---- 복구 코드 ----

/** Crockford base32: I, L, O, U 를 뺀 32글자 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const RECOVERY_CHARS = 25;

/** 무작위 복구 코드 25글자 (약 125비트). 5글자씩 하이픈으로 끊어 보인다 */
export function newRecoveryCode(random: (n: number) => Uint8Array = randomBytes): string {
  const bytes = random(RECOVERY_CHARS);
  let out = '';
  for (let i = 0; i < RECOVERY_CHARS; i++) out += ALPHABET[(bytes[i] as number) & 31];
  return formatRecoveryCode(out);
}

export function formatRecoveryCode(canonical: string): string {
  return (canonical.match(/.{1,5}/g) ?? []).join('-');
}

/**
 * 사람이 넣은 글을 정해진 25글자로. 대소문자, 하이픈, 공백을 무시하고 O 는 0, I 와 L 은 1 로 읽는다.
 * 25글자가 아니거나 없는 글자(U 등)가 있으면 null
 */
export function normalizeRecoveryCode(input: string): string | null {
  // 공백과 모든 줄표 모양(하이픈, 긴 줄표, 마이너스 기호)과 밑줄은 지운다
  const dash = (c: string) => {
    const n = c.charCodeAt(0);
    return c === '-' || c === '_' || (n >= 0x2010 && n <= 0x2015) || n === 0x2212;
  };
  const s = [...input.toUpperCase()]
    .filter((c) => !/\s/.test(c) && !dash(c))
    .join('')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (s.length !== RECOVERY_CHARS) return null;
  for (const c of s) if (!ALPHABET.includes(c)) return null;
  return s;
}

// ---- 열쇠 감싸기 ----

export interface WrappedKey {
  /** base64 */
  salt: string;
  params: ScryptParams;
  /** base64 (nonce 12 + 암호문 + 태그 16) */
  wrapped: string;
}

const scryptKey = (code: string, salt: Buffer, p: ScryptParams): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scryptCb(code, salt, 32, { N: p.N, r: p.r, p: p.p, maxmem: 256 * p.N * p.r + (8 << 20) }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });

const wrapAad = (account: string, gen: number, p: ScryptParams, salt: string): Buffer =>
  Buffer.from(`fairy-sync-key|${account}|${gen}|${p.N},${p.r},${p.p}|${salt}`);

function gcmSeal(key: Buffer, aad: Buffer, plain: Buffer): Buffer {
  const nonce = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, nonce);
  c.setAAD(aad);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([nonce, ct, c.getAuthTag()]);
}

function gcmOpen(key: Buffer, aad: Buffer, blob: Buffer): Buffer {
  if (blob.length < 12 + 16) throw new Error('short');
  const d = createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12));
  d.setAAD(aad);
  d.setAuthTag(blob.subarray(blob.length - 16));
  return Buffer.concat([d.update(blob.subarray(12, blob.length - 16)), d.final()]);
}

/** 데이터 열쇠 32바이트 */
export const newDataKey = (random: (n: number) => Uint8Array = randomBytes): Buffer =>
  Buffer.from(random(32));

export async function wrapDataKey(
  dataKey: Buffer,
  code: string,
  account: string,
  gen: number,
  params: ScryptParams = SCRYPT_DEFAULT,
): Promise<WrappedKey> {
  const norm = normalizeRecoveryCode(code);
  if (!norm) throw new Error('code');
  const ok = checkScryptParams(params);
  if (!ok) throw new Error('params');
  const salt = randomBytes(16);
  const salt64 = salt.toString('base64');
  const kek = await scryptKey(norm, salt, ok);
  const wrapped = gcmSeal(kek, wrapAad(account, gen, ok, salt64), dataKey);
  return { salt: salt64, params: ok, wrapped: wrapped.toString('base64') };
}

/** 풀리면 데이터 열쇠, 코드가 틀렸거나 바꿔치기면 null. 매개변수가 범위 밖이면 풀지 않고 던진다 */
export async function unwrapDataKey(
  w: { salt: string; params: unknown; wrapped: string },
  code: string,
  account: string,
  gen: number,
): Promise<Buffer | null> {
  const params = checkScryptParams(w.params);
  if (!params) throw new Error('params');
  const norm = normalizeRecoveryCode(code);
  if (!norm) return null;
  try {
    const salt = Buffer.from(w.salt, 'base64');
    if (salt.length < 8) return null;
    const kek = await scryptKey(norm, salt, params);
    const key = gcmOpen(kek, wrapAad(account, gen, params, w.salt), Buffer.from(w.wrapped, 'base64'));
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

// ---- 항목 잠그기 ----

export interface ItemCtx {
  /** 서버 계정을 가리키는 값 (계정 코드). 다른 계정으로 바꿔치기하면 풀리지 않는다 */
  account: string;
  gen: number;
}

const PAD = 256;
const GUNZIP_MAX = 16 << 20;

const itemAad = (c: ItemCtx, uid: string): Buffer =>
  Buffer.from(`fairy-sync-v1|${c.account}|${uid}|${c.gen}`);

/** 안쪽 글: { kind, uid, v: 1, ...나머지 }. gzip 한 뒤 길이를 앞에 붙이고 256바이트 단위로 채운다 */
export function sealItem(
  key: Buffer,
  ctx: ItemCtx,
  uid: string,
  kind: string,
  rest: Record<string, unknown>,
): Buffer {
  const gz = gzipSync(Buffer.from(JSON.stringify({ ...rest, kind, uid, v: 1 })));
  const framed = Buffer.alloc(Math.max(PAD, Math.ceil((4 + gz.length) / PAD) * PAD));
  framed.writeUInt32BE(gz.length, 0);
  gz.copy(framed, 4);
  return gcmSeal(key, itemAad(ctx, uid), framed);
}

export interface OpenedItem {
  kind: string;
  uid: string;
  v: number;
  [k: string]: unknown;
}

/** 풀어서 안쪽 uid 가 바깥 uid 와 같은지 본다. 틀리면 던진다 */
export function openItem(key: Buffer, ctx: ItemCtx, uid: string, blob: Buffer): OpenedItem {
  const framed = gcmOpen(key, itemAad(ctx, uid), blob);
  const len = framed.readUInt32BE(0);
  if (len > framed.length - 4) throw new Error('frame');
  const text = gunzipSync(framed.subarray(4, 4 + len), { maxOutputLength: GUNZIP_MAX }).toString('utf8');
  const v = JSON.parse(text) as OpenedItem;
  const same =
    typeof v.uid === 'string' &&
    v.uid.length === uid.length &&
    timingSafeEqual(Buffer.from(v.uid), Buffer.from(uid));
  if (!same || typeof v.kind !== 'string' || v.v !== 1) throw new Error('mismatch');
  return v;
}
