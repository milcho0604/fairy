// AI 모델 목록 (v2 "무료 AI 와 모델 고르기"). 앱에 기본값을 넣어 두고, 레포의 catalog/models.json 을
// 하루 한 번 받아 바꾼다. 새 모델이 나오면 그 파일만 고치면 되고 앱을 다시 배포하지 않는다.
// 남이 바꿀 수 있는 파일이라 받은 값은 엄격하게 본다: 받는 곳, 해시, 크기 상한, 인자 모양.

import { PUBLIC_REPO } from '../update-policy.ts';
/** 내 컴퓨터에서 도는 작은 모델 (GGUF). 처음 쓸 때 받는다 */
export interface LocalModel {
  id: string;
  label: string;
  file: string;
  url: string;
  sha256: string;
  bytes: number;
  /** 라이선스 이름 (설정 창에 보여 준다) */
  license: string;
  /** 생각 모드가 있는 모델(Qwen3)은 끄고 부른다 */
  noThink?: boolean;
}

/** CLI 에 --model 로 넘길 이름. 별칭(sonnet 등)이면 그 계열의 최신, 정확한 이름이면 그 버전에 고정 */
export interface CliModel {
  id: string;
  label: string;
  /** 버전 고정이면 true. 새 버전이 나와도 바뀌지 않는다 */
  pinned?: boolean;
}

export interface Catalog {
  version: 1;
  local: LocalModel[];
  localDefault: string;
  cli: Record<string, CliModel[]>;
}

/** 모델 파일 크기 상한. 사용자 요청(2026-10-06): 몇 GB 짜리는 안 된다 */
export const LOCAL_MAX_BYTES = 1_000_000_000;
/** 모델을 받아도 되는 곳 */
const MODEL_HOSTS = ['huggingface.co', 'github.com'];

export const CATALOG_URL = `https://raw.githubusercontent.com/${PUBLIC_REPO.owner}/${PUBLIC_REPO.repo}/main/catalog/models.json`;

export const DEFAULT_CATALOG: Catalog = {
  version: 1,
  // 비교 시험(2026-10-06): 1.7B 가 한국어 반말, 코드, 목록 모두 낫다(4점). 0.6B 는 가볍지만 엉뚱한 답이 남는다(3점)
  local: [
    {
      id: 'qwen3-1.7b',
      label: 'Qwen3 1.7B',
      file: 'Qwen3-1.7B-Q3_K_M.gguf',
      url: 'https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q3_K_M.gguf',
      sha256: '8070f21b9763ef653289e20252592d0aab6680948f36eb5b4362d403fef09170',
      bytes: 939_539_008,
      license: 'Apache-2.0',
      noThink: true,
    },
    {
      id: 'qwen3-0.6b',
      label: 'Qwen3 0.6B',
      file: 'Qwen3-0.6B-Q4_K_M.gguf',
      url: 'https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_K_M.gguf',
      sha256: 'ac2d97712095a558e31573f62f466a3f9d93990898b0ec79d7c974c1780d524a',
      bytes: 396_705_472,
      license: 'Apache-2.0',
      noThink: true,
    },
  ],
  localDefault: 'qwen3-1.7b',
  cli: {
    // 별칭은 최신 자동, 정확한 이름은 버전 고정. 새 버전은 catalog/models.json 에 더한다
    claude: [
      { id: 'opus', label: 'Opus' },
      { id: 'sonnet', label: 'Sonnet' },
      { id: 'haiku', label: 'Haiku' },
      { id: 'claude-opus-5-5', label: 'Opus 5.5', pinned: true },
      { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', pinned: true },
      { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', pinned: true },
    ],
  },
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const str = (v: unknown, max = 80): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

function localModel(v: unknown): LocalModel | undefined {
  if (!isObj(v)) return undefined;
  const { id, label, file, url, sha256, bytes, license, noThink } = v;
  if (!str(id, 40) || !/^[a-z0-9][a-z0-9.-]*$/.test(id)) return undefined;
  if (!str(label) || !str(license, 40)) return undefined;
  if (!str(file, 120) || !/^[\w.-]+\.gguf$/.test(file)) return undefined;
  if (!str(sha256, 64) || !/^[0-9a-f]{64}$/.test(sha256)) return undefined;
  if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes <= 0 || bytes > LOCAL_MAX_BYTES)
    return undefined;
  if (!str(url, 300)) return undefined;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !MODEL_HOSTS.includes(u.hostname)) return undefined;
  } catch {
    return undefined;
  }
  return { id, label, file, url, sha256, bytes, license, ...(noThink === true ? { noThink: true } : {}) };
}

/**
 * 돈이 따로 나갈 수 있는 모델은 목록에 와도 받지 않는다. Claude Code 문서(2026-10-06 확인):
 * fable(과 best)은 요금제 한도 대신 사용 크레딧(추가 요금)으로 청구될 수 있고, 동의 창은 대화형에서만 뜬다.
 * 짝꿍은 -p 로 부르므로 동의 없이 나갈 수 있다. 1M 문맥(이름에 1m)도 요금제에 따라 크레딧이 든다.
 */
const PAID_EXTRA = /fable|best|1m|plan/i;

function cliModel(v: unknown): CliModel | undefined {
  if (!isObj(v)) return undefined;
  const { id, label, pinned } = v;
  // 셸을 거치지 않지만 "-" 로 시작하면 다른 옵션으로 읽힌다
  if (!str(id, 64) || !/^[\w][\w.:/-]*$/.test(id) || !str(label)) return undefined;
  if (PAID_EXTRA.test(id)) return undefined;
  return { id, label, ...(pinned === true ? { pinned: true } : {}) };
}

/** 받은 목록을 검사한다. 잘못된 항목은 버리고, 쓸 만한 게 없으면 undefined (기본값을 쓴다) */
export function parseCatalog(json: unknown): Catalog | undefined {
  if (!isObj(json) || json.version !== 1) return undefined;
  const local = (Array.isArray(json.local) ? json.local : []).flatMap((m) => localModel(m) ?? []);
  if (local.length === 0) return undefined;
  const localDefault =
    typeof json.localDefault === 'string' && local.some((m) => m.id === json.localDefault)
      ? json.localDefault
      : (local[0] as LocalModel).id;
  const cli: Record<string, CliModel[]> = {};
  if (isObj(json.cli)) {
    for (const [provider, list] of Object.entries(json.cli)) {
      if (!/^[a-z]+$/.test(provider) || !Array.isArray(list)) continue;
      const models = list.flatMap((m) => cliModel(m) ?? []).slice(0, 20);
      if (models.length) cli[provider] = models;
    }
  }
  return { version: 1, local: local.slice(0, 10), localDefault, cli };
}

/** 고른 모델이 목록에 없으면(목록이 바뀌어 사라짐) 기본으로. CLI 는 빈 값이 "그 AI 의 기본" */
export function pickLocal(catalog: Catalog, chosen: string | undefined): LocalModel {
  return (
    catalog.local.find((m) => m.id === chosen) ??
    catalog.local.find((m) => m.id === catalog.localDefault) ??
    (catalog.local[0] as LocalModel)
  );
}

/**
 * CLI 에 넘길 모델. 사용자는 목록에서만 고른다. 고른 게 없으면 undefined(그 AI 의 기본, Claude 는 요금제 기본).
 * 고른 모델이 목록에서 빠지면(받은 목록이 바뀜) 기본으로 돌아간다.
 */
export function pickCli(catalog: Catalog, provider: string, chosen: string | undefined): string | undefined {
  if (!chosen) return undefined;
  return catalog.cli[provider]?.some((m) => m.id === chosen) ? chosen : undefined;
}
