// 짝꿍이 부를 수 있는 AI 목록. 사용자 요청(2026-10-02): claude, codex 로 한정하지 않는다.
// 기본 제공 AI 는 어댑터가 따로 있고, 그 밖의 CLI 는 사용자가 명령을 적어 추가한다(custom).

export type AdapterKind = 'claude' | 'codex' | 'cursor' | 'text';

export interface ProviderSpec {
  id: string;
  label: string;
  /** 실행 파일 이름 (PATH 에서 찾는다). 사용자 추가 AI 는 절대 경로도 된다 */
  bin: string;
  adapter: AdapterKind;
  /** text 어댑터의 인자. {prompt} 자리에 질문이 들어간다 */
  args?: string[];
  /** 그림을 같이 보낼 수 있는지 */
  images: boolean;
  /** 실제 출력으로 확인했는지. 아니면 화면에 "확인 전" 표시 */
  verified: boolean;
  /** 로그인 확인 명령. 없으면 확인 안 함 */
  statusArgs?: string[];
  /** 로그인 안 됨을 뜻하는 출력 (종료 코드가 0 이어도) */
  notLoggedInPattern?: RegExp;
  installHint: string;
  loginHint?: string;
  /** 사용량을 알려 주는지 */
  usage: boolean;
  custom?: boolean;
  /** 사용자가 적은 그대로의 명령 한 줄 (보여 주기용, 따옴표 포함) */
  command?: string;
}

export const BUILTIN_PROVIDERS: readonly ProviderSpec[] = [
  {
    id: 'claude',
    label: 'Claude',
    bin: 'claude',
    adapter: 'claude',
    images: true,
    verified: true,
    statusArgs: ['auth', 'status'],
    installHint: 'Claude Code 를 설치하고 터미널에서 claude 로 한 번 로그인해 줘.',
    loginHint: '터미널에서 claude 로 로그인해 줘.',
    usage: true,
  },
  {
    id: 'codex',
    label: 'Codex',
    bin: 'codex',
    adapter: 'codex',
    images: true,
    verified: true,
    statusArgs: ['login', 'status'],
    installHint: 'Codex CLI 를 설치하고 터미널에서 codex login 으로 로그인해 줘.',
    loginHint: '터미널에서 codex login 으로 로그인해 줘.',
    usage: true,
  },
  {
    id: 'cursor',
    label: 'Cursor',
    bin: 'cursor-agent',
    adapter: 'cursor',
    images: false,
    verified: false,
    statusArgs: ['status'],
    notLoggedInPattern: /not logged in/i,
    installHint: 'Cursor Agent CLI 를 설치하고 터미널에서 cursor-agent login 으로 로그인해 줘.',
    loginHint: '터미널에서 cursor-agent login 으로 로그인해 줘.',
    usage: false,
  },
  {
    id: 'gemini',
    label: 'Gemini',
    bin: 'gemini',
    adapter: 'text',
    args: ['-p', '{prompt}'],
    images: false,
    verified: false,
    installHint: 'Gemini CLI 를 설치하고 터미널에서 gemini 를 한 번 실행해 로그인해 줘.',
    usage: false,
  },
];

export interface CustomProviderInput {
  label: string;
  bin: string;
  /** 공백으로 나눈 인자. {prompt} 가 없으면 맨 끝에 질문을 붙인다 */
  args: string;
}

/** 사용자가 적은 명령을 AI 정의로 만든다. 잘못된 값이면 이유를 돌려준다. */
export function customProvider(input: CustomProviderInput, id: string): ProviderSpec | string {
  const label = input.label.trim();
  const bin = input.bin.trim();
  if (!label) return '이름을 적어 줘.';
  if (!bin || /\s/.test(bin)) return '명령은 실행 파일 이름 하나만 적어 줘. 나머지는 인자 칸에.';
  const args = splitArgs(input.args);
  if (!args.some((a) => a.includes('{prompt}'))) args.push('{prompt}');
  return {
    id,
    label,
    bin,
    adapter: 'text',
    args,
    images: false,
    verified: false,
    installHint: `터미널에서 ${bin} 명령이 실행되는지 확인해 줘.`,
    usage: false,
    custom: true,
    command: `${bin} ${input.args.trim()}`.trim(),
  };
}

/** 따옴표로 묶은 인자는 하나로 본다. 셸을 거치지 않으므로 변수나 파이프는 쓰지 않는다. */
export function splitArgs(text: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) out.push(m[1] ?? m[2] ?? m[3] ?? '');
  return out;
}

/** text 어댑터 인자: {prompt} 를 질문으로 바꾼다. */
export function fillArgs(args: readonly string[], prompt: string): string[] {
  return args.map((a) => a.replaceAll('{prompt}', prompt));
}
