// 앱 아이콘 그리기 (scripts/build-icon.mjs 가 묶어서 숨긴 창에서 돌린다).
// 맥 아이콘 격자: 1024 안에 824 판, 둘레 100 여백. 판 위에 펫 화면과 같은 3D 렌더러로 짝꿍 둘을 붙여 세운다.
import { CANVAS_SIZE } from '../src/renderer/src/draw.ts';
import { Pet3D } from '../src/renderer/src/pet3d.ts';
import { parseBlueprint } from '../src/shared/pet3d/blueprint.ts';
import ICON from './icon-pets.json';

const SIZE = 1024;

function draw(): string {
  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  const g = c.getContext('2d');
  if (!g) throw new Error('2d');

  // 판: 둥근 사각형, 연한 민트(살구색 콩이가 잘 보이게), 아래 그림자
  const plate = new Path2D();
  plate.roundRect(100, 100, 824, 824, 185);
  g.save();
  g.shadowColor = 'rgba(0, 0, 0, 0.22)';
  g.shadowBlur = 28;
  g.shadowOffsetY = 12;
  const bg = g.createLinearGradient(0, 100, 0, 924);
  bg.addColorStop(0, ICON.bg[0] ?? '#f1fbf4');
  bg.addColorStop(1, ICON.bg[1] ?? '#bfe6cf');
  g.fillStyle = bg;
  g.fill(plate);
  g.restore();
  // 판 위쪽 은은한 빛
  g.save();
  g.clip(plate);
  const glow = g.createRadialGradient(512, 330, 40, 512, 330, 520);
  glow.addColorStop(0, 'rgba(255, 255, 255, 0.75)');
  glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
  g.fillStyle = glow;
  g.fillRect(100, 100, 824, 824);
  g.restore();

  // 짝꿍 둘: 갈색 곱슬 강아지와 하얀 고양이가 볼을 맞댄다 (사용자 사진 느낌, 설계도는 icon-pets.json)
  const pet = Pet3D.create(() => {});
  if (!pet) throw new Error('webgl');
  pet.maxPx = 2048;
  const k = 700 / CANVAS_SIZE;
  for (const who of ICON.place.order) {
    const bp = parseBlueprint(ICON[who]);
    if (!bp) throw new Error(`설계도 ${who}`);
    const at = ICON.place[who];
    pet.setBlueprint(bp);
    pet.spin = at.spin;
    g.save();
    g.setTransform(k, 0, 0, k, at.x - 80 * k, at.ground - 154 * k);
    pet.draw(g, { mood: at.mood, elapsed: 0, blink: -1 }, 0, 1, 1, undefined);
    g.restore();
  }
  return c.toDataURL('image/png');
}

Object.assign(window, { iconPng: draw() });
