// AI 자동 감지 (이슈 #126): 이 컴퓨터에 깔린 AI 프로그램과 내 컴퓨터 AI 모델을 한 번에 본다.
// 부르는 명령은 checkStatus 의 --version 과 로그인 확인(auth status 등)뿐이다. 질문은 보내지 않는다.
import {
  CAPABILITY_IDS,
  type CapabilityId,
  type DetectRow,
  detectState,
} from '../../shared/ai/capability.ts';
import { BUILTIN_PROVIDERS } from '../../shared/ai/providers.ts';
import { checkStatus } from './runner.ts';

/**
 * localReady: 내 컴퓨터 AI(무료 AI) 모델을 받아 두었는지. refresh: 저장해 둔 PATH 와 확인 결과를 무시하고 다시 본다
 * (새로 깔고 바로 "다시 찾기"를 눌렀을 때)
 */
export async function detectAi(localReady: boolean, refresh = false): Promise<DetectRow[]> {
  return Promise.all(
    CAPABILITY_IDS.map(async (id: CapabilityId): Promise<DetectRow> => {
      const spec = BUILTIN_PROVIDERS.find((p) => p.id === id);
      if (!spec) return { id, state: 'missing' };
      if (id === 'local')
        return { id, state: detectState(id, { provider: id, installed: true, needsModel: !localReady }) };
      try {
        const st = await checkStatus(spec, refresh);
        return { id, state: detectState(id, st), ...(st.version ? { version: st.version } : {}) };
      } catch {
        return { id, state: 'missing' };
      }
    }),
  );
}
