// 그림 세트 검사기 (펫 만드는 사람용). 앱이 이 세트를 어떻게 읽을지 미리 알려 준다 (src/shared/sprite-check.ts, 규칙은 docs/pet-format.md "그림 세트 검사").
//   node scripts/validate-pet.mjs <pet.fairy | 그림 폴더> [--lang ko|en]
// 폴더는 <자세 이름>.png 파일들(예: idle.png, walk-0.png)을 둔 곳이다. 문제(error)가 있으면 1 로 끝난다.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { SPRITE_POSE_GROUPS, checkSpriteSet, describeSpriteIssue, spriteInfoOf, spriteInfosOfFairy } from '../src/shared/sprite-check.ts';

const args = process.argv.slice(2);
const li = args.indexOf('--lang');
const lang = li >= 0 && args[li + 1] === 'en' ? 'en' : 'ko';
if (li >= 0) args.splice(li, 2);
const target = args[0];
if (!target) {
  console.error('usage: node scripts/validate-pet.mjs <pet.fairy | folder with <pose>.png files> [--lang ko|en]');
  console.error(`poses: ${[...SPRITE_POSE_GROUPS.base, ...SPRITE_POSE_GROUPS.extra].join(', ')}`);
  process.exit(2);
}

let infos;
try {
  if (statSync(target).isDirectory()) {
    infos = {};
    for (const f of readdirSync(target)) {
      if (extname(f).toLowerCase() !== '.png' && !/\.(gif|webp|jpe?g|svg)$/i.test(f)) continue;
      infos[basename(f, extname(f))] = spriteInfoOf(readFileSync(join(target, f)));
    }
  } else {
    infos = spriteInfosOfFairy(readFileSync(target, 'utf8'));
  }
} catch (err) {
  console.error(`cannot read ${target}: ${err.message}`);
  process.exit(2);
}
if (infos.error) {
  console.error(`${target}: ${infos.error}`);
  process.exit(2);
}
if (Object.keys(infos).length === 0) {
  console.log(lang === 'ko' ? '그림 세트(images.sprites)가 없어요. 사진 한 장으로 움직이는 펫이에요.' : 'No sprite set (images.sprites). This pet moves with a single picture.');
  process.exit(0);
}

const r = checkSpriteSet(infos);
const mark = { error: 'ERROR', warn: 'warn ', info: 'info ' };
for (const i of r.issues) console.log(`${mark[i.level]} ${describeSpriteIssue(i, lang)}`);
const fills = Object.entries(r.filled);
if (r.ok && fills.length)
  console.log(
    lang === 'ko'
      ? `채워지는 자세 ${fills.length}개: ${fills.map(([k, v]) => `${k} <- ${v}`).join(', ')}`
      : `${fills.length} poses are filled from others: ${fills.map(([k, v]) => `${k} <- ${v}`).join(', ')}`,
  );
console.log(
  r.ok
    ? lang === 'ko'
      ? `통과: 그림 ${r.frames}장, 걷기 ${r.walks}장.`
      : `OK: ${r.frames} pictures, ${r.walks} walk frames.`
    : lang === 'ko'
      ? '문제가 있어요. 위 ERROR 를 고치면 앱이 이 세트를 그대로 써요.'
      : 'There are problems. Fix the ERRORs above and the app will use this set as is.',
);
process.exit(r.ok ? 0 : 1);
