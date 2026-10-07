// 윈도우에서 npm 으로 깐 CLI 는 codex.cmd 같은 배치 파일이다. Node 24 는 shell 없이 .cmd 를 띄우면 EINVAL 을 던지고,
// shell 을 켜면 질문 글이 명령 줄에 섞여 주입 통로가 된다. 그래서 배치 파일 안의 JS 경로를 읽어 node 로 직접 띄운다.

/**
 * npm cmd-shim 이 만든 배치 파일에서 실행할 JS 경로(배치 파일 폴더 기준 상대)를 꺼낸다. 모르는 모양이면 undefined.
 * 예: "%_prog%"  "%dp0%\node_modules\@openai\codex\bin\codex.js" %*
 */
export function cmdShimScript(text: string): string | undefined {
  const m = /"%~?dp0%?\\([^"%]+?\.[cm]?js)"/i.exec(text);
  const rel = m?.[1];
  if (!rel || rel.split(/[\\/]/).includes('..')) return undefined;
  return rel;
}
