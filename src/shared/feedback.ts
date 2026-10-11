// 의견 보내기 글 (설정의 베타 기록 칸). 메인이 만들고 화면은 그대로 보여 준다.
import { t } from './i18n/index.ts';

export interface DiagnosticsMeta {
  version: string;
  os: string;
}

/**
 * 베타 기록 글 + 가린 진단 기록. 화면에 미리 보이는 글과 복사, 저장되는 글이 같다.
 * lines 가 비면 기록이 없다고 적는다.
 */
export function feedbackText(stats: string, lines: readonly string[], hidden: number): string {
  const head = lines.length ? t('feedback.logHeader', { n: lines.length, hidden }) : t('feedback.logEmpty');
  return [stats, '', head, ...lines].join('\n');
}

/** GitHub 새 이슈 주소. 판과 운영체제만 채우고 기록은 넣지 않는다 (주소에 남으면 브라우저 기록에도 남는다) */
export function issueUrl(repo: { owner: string; repo: string }, meta: DiagnosticsMeta): string {
  const body = t('feedback.issueBody', { version: meta.version, os: meta.os });
  const q = new URLSearchParams({ title: t('feedback.issueTitle'), body });
  return `https://github.com/${repo.owner}/${repo.repo}/issues/new?${q.toString()}`;
}
