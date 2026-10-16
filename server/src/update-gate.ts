import type { IncomingMessage, ServerResponse } from 'node:http';
import { APP_VERSION_HEADER, appVersionOf, exempt, gateOf, type UpdateLevels } from './shared/update-levels';

export { exempt };

// 업데이트 단계의 서버 쪽 관문 (이슈 #120). /v1/* 요청마다 앱 판 머리를 기준과 비교한다.
// 기준보다 낮으면 426 {error:'update_required', need, level} (level: restrict 또는 force). 기준은 공지 문서 한 곳에서 읽는다.
// 머리가 없거나 틀리면 가장 낮은 판으로 본다 (기준이 있는 한 막힌다). 기준이 없으면 모두 통과한다.
//
// 예외 (업데이트 전에도 되어야 하는 것): 상태 확인, 공지와 이벤트 파일, 로그인 시작과 완료, 운영자 화면과 운영자 API,
// 내 계정 보기(업데이트 기준을 알려 준다), 로그아웃과 탈퇴 (사용자가 자기 계정을 거둘 수 있어야 한다).

/** 426 을 받는 쪽이 이 판을 알게 쓰는 까닭 글 (응답 몸) */
export const UPDATE_REQUIRED = 'update_required';

/**
 * 관문이 보는 경로: 절대 형식(http://host/v1/..)과 쿼리를 벗기고, Express 가 대소문자를 가리지 않으니 소문자로 맞춘다
 * (/V1/features 가 우회하지 못하게). 점 조각은 URL 이 정리한다.
 */
export function normalPath(url: string | undefined): string {
  try {
    return new URL(url ?? '/', 'http://gate.invalid').pathname.toLowerCase();
  } catch {
    return '/';
  }
}

/** 관문 미들웨어. levels 는 지금 기준 (공지 문서에서 매번 읽는다, 기준 바꾸기는 바로 적용된다) */
export function updateGate(levels: () => Promise<UpdateLevels>) {
  return async (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
    const path = normalPath(req.url);
    if (!path.startsWith('/v1/') || exempt(req.method ?? 'GET', path)) return next();
    try {
      const need = gateOf(await levels(), appVersionOf(req.headers[APP_VERSION_HEADER]));
      if (!need) return next();
      res.statusCode = 426;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ error: UPDATE_REQUIRED, need: need.need, level: need.level }));
    } catch (err) {
      next(err);
    }
  };
}
