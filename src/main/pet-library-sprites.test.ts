// 보관함(pet-library.ts)이 2D 그림 세트 파일을 펫과 같은 수명으로 다루는지: 기본 페어리로 바꾸기, 다시 꺼내기, 새 펫, 지우기
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'jj-sprites-'));
process.env.JJ_SPRITE_TEST_DIR = dir;
// pet-library.ts 와 store.ts 는 electron 의 app(데이터 폴더)과 nativeImage(작은 그림)만 쓴다. 시험 폴더를 가리키게 끼운다
register(
  `data:text/javascript,${encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'electron') {
    const src = "const d = process.env.JJ_SPRITE_TEST_DIR; const empty = () => ({ isEmpty: () => true });" +
      "export const app = { getPath: () => d, getAppPath: () => d };" +
      "export const nativeImage = { createFromBuffer: empty, createEmpty: empty, createFromPath: empty };";
    return { url: 'data:text/javascript,' + encodeURIComponent(src), shortCircuit: true };
  }
  return next(spec, ctx);
}`)}`,
);
const { library, spriteUrls } = await import('./pet-library.ts');
const { settings } = await import('./settings.ts');

after(() => rmSync(dir, { recursive: true, force: true }));

const pets = join(dir, 'pets');
mkdirSync(pets, { recursive: true });
/** 1x1 PNG 머리말이 있는 작은 파일 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==',
  'base64',
);
const put = (f: string) => writeFileSync(join(pets, f), PNG);
const has = (f: string) => existsSync(join(pets, f));
const SET = { idle: 'sprite-1-a.png', sit: 'sprite-1-b.png', 'walk-0': 'sprite-1-c.png' };
for (const f of ['pet-u.png', 'pet-n.png', ...Object.values(SET)]) put(f);

test('그림 세트는 펫과 같은 수명: 보관, 다시 꺼내기, 새 펫, 지우기', () => {
  settings.set({ petImage: 'pet-u.png', petName: '우사기', petSprites: SET });
  assert.deepEqual(settings.get().petSprites, SET);
  // 화면에 보낼 data URL (서기가 있어야 세트)
  assert.deepEqual(Object.keys(spriteUrls(settings.get().petSprites) ?? {}), ['idle', 'sit', 'walk-0']);
  assert.equal(spriteUrls({ sit: 'sprite-1-b.png' }), undefined);

  // 기본 페어리로: 세트는 보관함으로 가고 파일은 남는다
  library.toDefault('kong');
  assert.equal(settings.get().petSprites, undefined);
  const saved = settings.get().petLibrary[0];
  assert.ok(saved);
  assert.deepEqual(saved.sprites, SET);
  for (const f of Object.values(SET)) assert.ok(has(f), `${f} 남음`);

  // 보관함에서 다시 고르면 세트도 돌아온다
  assert.ok(library.restore(saved.id));
  assert.deepEqual(settings.get().petSprites, SET);

  // 새 사진 펫(만들기, 다른 파일 가져오기): 옛 세트는 새 펫에 붙지 않고 보관함으로
  const prep = library.newPhotoPatch();
  settings.set({ ...prep.patch, petImage: 'pet-n.png', petName: '새 펫' });
  prep.cleanup();
  assert.equal(settings.get().petSprites, undefined);
  const kept = settings.get().petLibrary.find((p) => p.image === 'pet-u.png');
  assert.deepEqual(kept?.sprites, SET);
  for (const f of Object.values(SET)) assert.ok(has(f), `${f} 보관함이 씀`);

  // 친구가 같은 파일을 쓰면 보관함에서 지워도 남는다
  settings.set({ friends: [{ id: 'f-1', name: '친구', kind: 'kong', image: 'pet-u.png', sprites: SET }] });
  library.remove(kept?.id ?? '');
  for (const f of Object.values(SET)) assert.ok(has(f), `${f} 친구가 씀`);

  // 친구도 떠나면 (friends.ts sync 가 부르는 정리) 파일까지 지운다
  settings.set({ friends: [] });
  library.cleanup(['pet-u.png', ...Object.values(SET)]);
  for (const f of Object.values(SET)) assert.ok(!has(f), `${f} 지움`);
  assert.ok(!has('pet-u.png'));
  assert.ok(has('pet-n.png'), '지금 펫 그림은 그대로');
});
