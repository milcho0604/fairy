// AI 가 사진을 보고 입체 설계도를 만들게 하는 요청문과, 답에서 설계도를 꺼내는 일 (6단계).
// 요청문은 사용자에게 보이지 않고 JSON 정확도가 중요해 영어로 쓴다.
import { type Blueprint, FINISHES, MAX_PARTS, MOUTHS, parseBlueprint, SHAPES, SLOTS } from './blueprint.ts';
import { DEFAULT_BLUEPRINTS } from './defaults.ts';

export const BLUEPRINT_SYSTEM = `You design cute 3D desktop-pet figures out of simple primitives.
Look at the attached photo (an animal, plush toy or character with the background removed) and output ONE JSON blueprint that a renderer assembles with three.js.
Reply with only the JSON inside a \`\`\`json code block. No other text.`;

/** 사진 펫 이름을 넣은 요청 본문 */
export function blueprintPrompt(petName: string): string {
  return `Make a chibi figure of this pet (name: ${JSON.stringify(petName)}) that clearly resembles the photo: same main colors, markings, ear and tail shapes, body proportions.

Coordinate system: ground is y=0, the figure is about 1.0 tall, +z faces the viewer, +x is the figure's right side as seen by the viewer. Angles are degrees.

Schema:
{
  "v": 1,
  "parts": [ { "slot": one of ${JSON.stringify(SLOTS)},
               "shape": one of ${JSON.stringify(SHAPES)},
               "at": [x,y,z] center,
               "size": [rx,ry,rz] radii (for capsule, cone, cylinder: ry is half the height),
               "rot": [x,y,z] optional,
               "color": "#rrggbb",
               "finish": one of ${JSON.stringify(FINISHES)} optional (fuzzy = fur, soft = vinyl, shiny = glossy),
               "mirror": true optional (adds the mirrored copy on the other side; give the L side, x < 0) } ],
  "face": { "slot": "head" or "body", "eyeY", "eyeGap" (x distance of each eye from center), "eyeSize" (0.03 to 0.07),
            "eyeColor" optional, "mouth": one of ${JSON.stringify(MOUTHS)}, "mouthY", "mouthColor" optional (beak color),
            "blush" optional color, "whiskers" optional color }
}

Rules:
- 6 to ${MAX_PARTS} parts. Parts that move together share a slot: legs move with legL/legR, ears with earL/earR, and so on.
- Big head and small body (cute figure proportions). Keep everything within x and z of -0.7..0.7 and y of 0..1.3.
- Parts must overlap so the figure is one solid piece. Put markings and patches as thin flattened spheres slightly in front of the surface.
- The eyes and mouth are drawn by the app on the front surface of the face slot at eyeY and mouthY, so do not model eyes or mouth. Use "beak" only for birds.
- Use the photo's real colors. Avoid pure white (#ffffff) and pure black (#000000) for big parts.

Example (a default pet, a round bean with feet, arms and a sprout):
${JSON.stringify(DEFAULT_BLUEPRINTS.kong)}`;
}

/** AI 답에서 설계도를 꺼낸다. ```json 블록이 있으면 그것, 없으면 처음 { 부터 마지막 } 까지 */
export function extractBlueprint(answer: string): Blueprint | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(answer)?.[1];
  const candidates = [fenced, answer.slice(answer.indexOf('{'), answer.lastIndexOf('}') + 1)];
  for (const c of candidates) {
    if (!c?.trim()) continue;
    try {
      const bp = parseBlueprint(JSON.parse(c));
      if (bp) return bp;
    } catch {
      // 다음 후보
    }
  }
  return undefined;
}
