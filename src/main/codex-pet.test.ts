// Codex 펫 파일 가져오기 (codex-pet.ts, unzip.ts, shared/codex-pet.ts): 정상 파일, 줄이 적은 파일, 빈 칸, 크기 틀림,
// 너무 큰 zip, 경로 공격, 깨진 pet.json. 그림은 시험용 도형만 쓴다 (codex-pet-fixture.ts)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CODEX_ATLAS,
  CODEX_ROWS,
  cleanDescription,
  codexSpriteCells,
  evenPick,
  parseCodexManifest,
} from '../shared/codex-pet.ts';
import { validateSubmission } from '../shared/gallery.ts';
import { t } from '../shared/i18n/index.ts';
import { imageSize } from '../shared/image-head.ts';
import { decodePet, encodePet, type SharedPet } from '../shared/pet-share.ts';
import { fillSprites, type SpriteName } from '../shared/pet-sprites.ts';
import { type Atlas, readCodexPet } from './codex-pet.ts';
import {
  crop,
  decodePng,
  drawSheet,
  encodePng,
  makeZip,
  petJson,
  type Rgba,
  type SheetOptions,
} from './codex-pet-fixture.ts';
import { safeZipName, zipEntries } from './unzip.ts';

/** 앱의 숨은 창(codex-atlas.ts) 대신: 시험 PNG 를 풀고 줄마다 쓰는 장 수만큼 자른다 (빈 칸 기준은 앱과 같게 알파 8 아래) */
const decode = async (bytes: Buffer): Promise<Atlas> => {
  const img = decodePng(bytes);
  const { cellW, cellH } = CODEX_ATLAS;
  const cells = CODEX_ROWS.map((row, r) =>
    Array.from({ length: row.frames }, (_, c) => {
      if ((c + 1) * cellW > img.width || (r + 1) * cellH > img.height) return undefined;
      const cell = crop(img, c * cellW, r * cellH, cellW, cellH);
      for (let i = 3; i < cell.data.length; i += 4) if ((cell.data[i] ?? 0) > 8) return encodePng(cell);
      return undefined;
    }),
  );
  return { width: img.width, height: img.height, cells };
};

const sheetPng = (o?: SheetOptions) => encodePng(drawSheet(o));
const codexZip = (o?: SheetOptions, json = petJson()) =>
  makeZip([
    { name: 'pet.json', data: json },
    { name: 'spritesheet.png', data: sheetPng(o) },
  ]);
const ok = (r: SharedPet | { error: string }): SharedPet => {
  if ('error' in r) assert.fail(`가져오기 실패: ${r.error}`);
  return r;
};
const err = (r: SharedPet | { error: string }) => ('error' in r ? r.error : 'ok');
/** data URL 그림의 가운데 색 (어느 줄에서 왔는지) */
const centerOf = (url: string | undefined) => {
  const img: Rgba = decodePng(Buffer.from((url ?? '').split(',')[1] ?? '', 'base64'));
  const i = (118 * img.width + 96) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};

test('정상 파일: 이름, 설명, 개인 용도, 서기가 본 그림, 자세마다 줄에서 고른 칸', async () => {
  const pet = ok(await readCodexPet(codexZip(), decode));
  assert.equal(pet.name, '도트');
  assert.equal(pet.description, '동그란 시험용 펫');
  assert.equal(pet.personalOnly, true);
  assert.equal(pet.kind, 'kong');
  assert.equal(pet.image, pet.sprites?.idle);
  assert.deepEqual(Object.keys(pet.sprites ?? {}).sort(), [
    'blink',
    'happy',
    'hungry',
    'idle',
    'sulky',
    'talk-0',
    'talk-1',
    'walk-0',
    'walk-1',
    'walk-2',
    'walk-3',
    'walk-4',
    'walk-5',
    'walk-6',
    'walk-7',
    'wave',
  ]);
  for (const url of Object.values(pet.sprites ?? {})) {
    assert.match(url, /^data:image\/png;base64,/);
    assert.deepEqual(imageSize(Buffer.from(url.split(',')[1] ?? '', 'base64')), { w: 192, h: 208 });
  }
  // 줄 색으로 출처를 본다: 걷기는 오른쪽 달리기(초록), 손 흔들기는 노랑, 신남은 분홍
  assert.deepEqual(centerOf(pet.sprites?.['walk-0']), [110, 210, 140]);
  assert.deepEqual(centerOf(pet.sprites?.wave), [250, 200, 80]);
  assert.deepEqual(centerOf(pet.sprites?.happy), [250, 140, 190]);
  assert.deepEqual(centerOf(pet.sprites?.sulky), [160, 160, 170]);
  assert.deepEqual(centerOf(pet.sprites?.hungry), [250, 160, 90]);
  assert.deepEqual(centerOf(pet.sprites?.['talk-0']), [100, 200, 200]);
  // 가져온 그대로 .fairy 로 내보내고 다시 읽어도 그림 세트와 개인 용도가 남는다
  const back = decodePet(encodePet(pet));
  assert.ok(!('error' in back));
  assert.equal(back.personalOnly, true);
  assert.deepEqual(back.sprites, pet.sprites);
  assert.equal(back.description, undefined, '설명은 .fairy 로 내보내지 않는다');
});

test('자세 나누기 표: 줄마다 쓰는 장 수 안에서, 가운데 장, 달리기 여덟 장은 걷기 여덟 장으로', async () => {
  const all = Array.from({ length: 9 }, () => Array(8).fill(true));
  assert.deepEqual(codexSpriteCells(all), {
    idle: [0, 0],
    blink: [0, 2],
    'walk-0': [1, 0],
    'walk-1': [1, 1],
    'walk-2': [1, 2],
    'walk-3': [1, 3],
    'walk-4': [1, 4],
    'walk-5': [1, 5],
    'walk-6': [1, 6],
    'walk-7': [1, 7],
    wave: [3, 2],
    happy: [4, 2],
    sulky: [5, 4],
    hungry: [6, 3],
    'talk-0': [8, 0],
    'talk-1': [8, 3],
  });
  assert.deepEqual(evenPick(8, 6), [0, 1, 2, 4, 5, 6]);
  assert.deepEqual(evenPick(3, 6), [0, 1, 2]);
  assert.deepEqual(evenPick(0, 6), []);
});

test('줄이 적은 파일: 서기 줄만 있으면 나머지는 서기로 채운다, 달리기 네 장이면 걷기 네 장으로 한 주기', async () => {
  const only = ok(await readCodexPet(codexZip({ rows: [0] }), decode));
  assert.deepEqual(Object.keys(only.sprites ?? {}).sort(), ['blink', 'idle']);
  const filled = fillSprites(only.sprites ?? {});
  assert.equal(filled?.['walk-3'], only.sprites?.idle);
  assert.equal(filled?.wave, only.sprites?.idle);
  const four = ok(await readCodexPet(codexZip({ rows: [0, 1], frames: { 1: 4 } }), decode));
  const walks = Object.keys(four.sprites ?? {}).filter((k) => k.startsWith('walk-'));
  assert.deepEqual(walks.sort(), ['walk-0', 'walk-1', 'walk-2', 'walk-3']);
  assert.equal(fillSprites(four.sprites ?? {})?.['walk-5'], four.sprites?.['walk-1']);
});

test('빈 칸은 버린다: 서기 첫 칸이 비면 다음 칸이 서기, 쓰는 장 수 밖의 칸은 보지 않는다', async () => {
  const pet = ok(await readCodexPet(codexZip({ blanks: [[0, 0]] }), decode));
  const cells = codexSpriteCells(
    Array.from({ length: 9 }, (_, r) => Array.from({ length: 8 }, (_, c) => !(r === 0 && c === 0))),
  );
  assert.deepEqual(cells.idle, [0, 1]);
  assert.ok(pet.sprites?.idle);
  // 손 흔들기 줄은 네 장만 쓴다: 다섯째 칸부터 그림이 있어도 가운데는 셋째 칸
  const wide = Array.from({ length: 9 }, () => Array(8).fill(false));
  wide[0] = Array(8).fill(true);
  wide[3] = [false, false, false, true, true, true, true, true];
  assert.deepEqual(codexSpriteCells(wide).wave, [3, 3]);
  // 서기 줄이 통째로 비면 받지 않는다
  assert.equal(err(await readCodexPet(codexZip({ rows: [1, 2, 3] }), decode)), t('main.codex.noIdle'));
});

test('크기 틀림: 1536x1872 가 아니면 풀지 않고 거른다', async () => {
  let decoded = 0;
  const counting = async (b: Buffer) => {
    decoded++;
    return decode(b);
  };
  for (const [width, height] of [
    [1536, 1870],
    [768, 936],
    [3072, 3744],
  ] as const)
    assert.equal(err(await readCodexPet(codexZip({ width, height }), counting)), t('main.codex.badSheet'));
  assert.equal(decoded, 0, '머리말에서 거르고 풀지 않는다');
  // 머리말은 맞는데 풀어 보니 다르면(깨진 그림) 그것도 거른다
  const lie = async (b: Buffer) => ({ ...(await decode(b)), width: 100 });
  assert.equal(err(await readCodexPet(codexZip(), lie)), t('main.codex.badSheet'));
  assert.equal(err(await readCodexPet(codexZip(), async () => undefined)), t('main.codex.badSheet'));
  // 그림이 아닌 것
  const notImage = makeZip([
    { name: 'pet.json', data: petJson() },
    { name: 'spritesheet.png', data: Buffer.from('hello') },
  ]);
  assert.equal(err(await readCodexPet(notImage, decode)), t('main.codex.badSheet'));
  assert.equal(CODEX_ATLAS.cellW * CODEX_ATLAS.cols, CODEX_ATLAS.width);
});

test('너무 큰 zip: 항목이 많거나, 풀면 크거나, 적힌 크기보다 크게 풀리는 폭탄', async () => {
  const many = makeZip(Array.from({ length: 65 }, (_, i) => ({ name: `f${i}.txt`, data: Buffer.from('x') })));
  assert.equal(err(await readCodexPet(many, decode)), t('main.codex.tooBig'));
  const bomb = Buffer.alloc(17 * 1024 * 1024);
  const big = makeZip([
    { name: 'pet.json', data: petJson() },
    { name: 'spritesheet.png', data: bomb },
  ]);
  assert.ok(big.length < 100 * 1024, '압축하면 작다');
  assert.equal(err(await readCodexPet(big, decode)), t('main.codex.tooBig'));
  // 목록에는 작게 적고 크게 풀리는 것: 적힌 크기 + 1 에서 끊는다
  const liar = makeZip([
    { name: 'pet.json', data: petJson() },
    { name: 'spritesheet.png', data: Buffer.alloc(8 * 1024 * 1024), claimSize: 1000 },
  ]);
  assert.equal(err(await readCodexPet(liar, decode)), t('main.codex.tooBig'));
  // 합이 넘는 것 (하나씩은 상한 안)
  const total = makeZip(
    [0, 1, 2].map((i) => ({ name: `big${i}.bin`, data: Buffer.alloc(12 * 1024 * 1024) })),
  );
  assert.equal(err(await readCodexPet(total, decode)), t('main.codex.tooBig'));
});

test('경로 공격: .., 절대 경로, 역슬래시가 하나라도 있으면 통째로 버린다', async () => {
  for (const name of [
    '../pet.json',
    '/etc/pet.json',
    'a\\..\\pet.json',
    'dot/../../x',
    'C:/pet.json',
    './pet.json',
  ])
    assert.equal(
      err(
        await readCodexPet(
          makeZip([
            { name: 'pet.json', data: petJson() },
            { name: 'spritesheet.png', data: sheetPng() },
            { name, data: Buffer.from('x') },
          ]),
          decode,
        ),
      ),
      t('main.codex.unsafe'),
      name,
    );
  assert.equal(safeZipName('dot/spritesheet.webp'), true);
  assert.equal(safeZipName('dot/..hidden.png'), true, '이름 속 점 둘은 경로 조각이 아니다');
  // pet.json 이 다른 폴더의 그림을 가리키면 받지 않는다
  assert.equal(
    parseCodexManifest(JSON.stringify({ displayName: 'a', spritesheetPath: '../x.png' })),
    undefined,
  );
  assert.equal(
    parseCodexManifest(JSON.stringify({ displayName: 'a', spritesheetPath: 'sub/x.png' })),
    undefined,
  );
  assert.equal(parseCodexManifest(JSON.stringify({ displayName: 'a', spritesheetPath: 'x.svg' })), undefined);
});

test('pet.json 깨짐: 없음, 둘, JSON 아님, 이름 없음. 설명은 글자만 200자', async () => {
  const sheet = { name: 'spritesheet.png', data: sheetPng({ rows: [0] }) };
  const noManifest = t('main.codex.noManifest');
  assert.equal(err(await readCodexPet(makeZip([sheet]), decode)), noManifest);
  assert.equal(
    err(
      await readCodexPet(
        makeZip([{ name: 'a/pet.json', data: petJson() }, { name: 'b/pet.json', data: petJson() }, sheet]),
        decode,
      ),
    ),
    noManifest,
  );
  for (const bad of ['{', '[]', '"x"', JSON.stringify({ description: '이름 없음' })])
    assert.equal(
      err(await readCodexPet(makeZip([{ name: 'pet.json', data: Buffer.from(bad) }, sheet]), decode)),
      noManifest,
    );
  // 그림 이름이 가리키는 파일이 없다
  assert.equal(
    err(
      await readCodexPet(
        makeZip([{ name: 'pet.json', data: petJson({ sheet: 'none.webp' }) }, sheet]),
        decode,
      ),
    ),
    t('main.codex.noSheet'),
  );
  // 이름은 displayName, 없으면 id. 길면 12자에서 자른다
  assert.equal(parseCodexManifest(JSON.stringify({ id: 'mochi' }))?.name, 'mochi');
  assert.equal(parseCodexManifest(JSON.stringify({ displayName: '가'.repeat(30) }))?.name, '가'.repeat(12));
  assert.equal(parseCodexManifest(JSON.stringify({ displayName: 'a' }))?.sheet, 'spritesheet.webp');
  assert.equal(cleanDescription('  한 줄\n\t설명\u202e뒤집기  '), '한 줄 설명 뒤집기');
  assert.equal([...(cleanDescription('가'.repeat(500)) ?? '')].length, 200);
  assert.equal(cleanDescription(42), undefined);
  assert.equal(cleanDescription('\u200b'), undefined);
});

test('폴더째 묶은 zip (Codex 의 pets/<이름>/), 맥 부스러기(__MACOSX, ._)는 지나친다', async () => {
  const zip = makeZip([
    { name: 'dot/', data: Buffer.alloc(0), store: true },
    { name: 'dot/pet.json', data: petJson() },
    { name: 'dot/spritesheet.png', data: sheetPng(), store: true },
    { name: '__MACOSX/dot/._pet.json', data: Buffer.from('junk') },
    { name: 'dot/.DS_Store', data: Buffer.from('junk') },
  ]);
  assert.equal(ok(await readCodexPet(zip, decode)).name, '도트');
});

test('zip 이 아니거나 깨졌으면 그렇다고 알린다', async () => {
  assert.equal(
    err(await readCodexPet(Buffer.from('not a zip at all, just words'), decode)),
    t('main.codex.notZip'),
  );
  const zip = codexZip();
  // 그림 항목 한가운데를 깨뜨린다 (CRC 가 다르다)
  const broken = Buffer.from(zip);
  const at = zip.indexOf(Buffer.from('spritesheet.png')) + 100;
  broken[at] = (broken[at] ?? 0) ^ 0xff;
  assert.notEqual(err(await readCodexPet(broken, decode)), 'ok');
  assert.throws(() => zipEntries(Buffer.alloc(30), { entries: 1, entryBytes: 1, totalBytes: 1 }));
});

test('가져온 페어리는 갤러리 올리기 검사에서 개인 용도라 걸린다', async () => {
  const pet = ok(await readCodexPet(codexZip({ rows: [0, 1, 3] }), decode));
  const meta = { author: '시험', license: 'CC-BY-4.0', created: '2026-10-15', appVersion: '0.4.3' } as const;
  const r = validateSubmission('dot', encodePet(pet, meta), 100);
  assert.ok(r.problems.some((p) => p.includes('personalOnly')));
  assert.equal(r.pet, undefined);
});

test('그림 세트 규칙은 .fairy 와 같다: 서기와 크기가 다른 장은 없다', async () => {
  const pet = ok(await readCodexPet(codexZip(), decode));
  const sizes = new Set(
    Object.values(pet.sprites ?? {}).map((u) =>
      JSON.stringify(imageSize(Buffer.from(u.split(',')[1] ?? '', 'base64'))),
    ),
  );
  assert.equal(sizes.size, 1);
  const names: SpriteName[] = ['sit', 'sleep', 'doze', 'yawn', 'grab', 'back', 'look-l', 'look-r'];
  for (const n of names)
    assert.equal(pet.sprites?.[n], undefined, `${n} 은 Codex 줄에 없어서 채우기에 맡긴다`);
});
