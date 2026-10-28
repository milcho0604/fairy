// 웹 운영자 화면(서버 /admin)으로 가는 주소. 앱 운영자 칸은 요약만 보이고 관리 작업은 웹에서 한다 (이슈 #150).
// 칸 이름은 서버 server/src/admin-page.ts 의 ADMIN_CELLS, CELL_SUBS 와 같아야 한다 (주소 해시로 현재 칸을 정한다).

/** 웹에서 열 수 있는 자리: 다섯 칸과 그 아래 칸 */
export const ADMIN_WEB_PLACES = [
  'home',
  'users',
  'users/list',
  'users/grants',
  'reports',
  'announce',
  'announce/posts',
  'announce/new',
  'settings',
  'settings/features',
  'settings/ai',
  // 옛 주소: 서버 웹이 settings/ai(예산, 정책, 백업 한 칸) 로 열어 준다. 할 일 카드의 백업 줄이 쓴다
  'settings/backup',
  'settings/log',
] as const;
export type AdminWebPlace = (typeof ADMIN_WEB_PLACES)[number];

export const isAdminWebPlace = (v: unknown): v is AdminWebPlace =>
  typeof v === 'string' && (ADMIN_WEB_PLACES as readonly string[]).includes(v);

/** 설정된 서버 주소로 웹 운영자 화면 주소를 만든다. 서버 주소가 없거나 자리가 목록에 없으면 undefined */
export function adminWebUrl(serverBase: string, place: unknown): string | undefined {
  if (!serverBase || !isAdminWebPlace(place)) return undefined;
  let base: URL;
  try {
    base = new URL(serverBase);
  } catch {
    return undefined;
  }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') return undefined;
  return `${base.origin}/admin#${place}`;
}
