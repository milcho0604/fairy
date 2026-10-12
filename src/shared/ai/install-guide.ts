// 기본 제공 AI 를 못 찾았을 때 채팅에서 펼쳐 보는 설치 안내 (#29).
// 말풍선은 짧게 두고, "설치 방법"을 누르면 이 운영체제의 설치 명령, 로그인, 깔았는데도 못 찾을 때를 차례로 보여 준다.
//
// 명령과 주소는 공식 문서에서 다시 확인한 값만 쓴다 (2026-10-12 확인). 짐작으로 고치지 말고 바꿀 때 아래 출처를 다시 본다.
// - Claude Code: https://code.claude.com/docs/en/setup (네이티브 설치 명령, Homebrew, WinGet, `claude` 로 브라우저 로그인,
//   맥과 리눅스는 ~/.local/bin/claude). PATH 문제는 https://code.claude.com/docs/en/troubleshoot-install
// - Codex CLI: https://github.com/openai/codex README Quickstart (맥, 리눅스 install.sh, 윈도우 install.ps1, Homebrew, npm,
//   `codex` 를 실행해 Sign in with ChatGPT)
// - Cursor CLI: https://cursor.com/docs/cli/installation (curl https://cursor.com/install, 윈도우 install?win32=true,
//   ~/.local/bin 을 PATH 에), https://cursor.com/docs/cli/reference/authentication (`agent login`),
//   https://cursor.com/changelog/cli-jan-08-2026 (`agent` 가 주 명령이 됐고 `cursor-agent` 는 같은 일을 하는 별칭으로 남음.
//   짝꿍은 cursor-agent 를 찾으므로 안내도 cursor-agent 로 쓴다)
// - Gemini CLI: https://github.com/google-gemini/gemini-cli README 와 docs/get-started/installation.mdx, authentication.mdx
//   (npm, Homebrew, MacPorts, Node.js 20 이상, `gemini` 를 실행해 Sign in with Google)
//
// "깔았는데도 못 찾음" 안내는 main/ai/shell-env.ts 가 찾는 방식에 맞춘다: 맥, 리눅스는 로그인 셸($SHELL -lic)의 PATH 를 읽어
// 저장해 두고 "다시 확인"이 다시 읽는다. 윈도우는 앱이 켜질 때 받은 PATH 를 그대로 써서 앱을 다시 켜야 새 PATH 가 보인다.

/** 안내가 있는 AI (사용자 추가 AI 와 무료 AI 는 설치가 따로 없다) */
export type GuideProvider = 'claude' | 'codex' | 'cursor' | 'gemini';

export type GuideOs = 'mac' | 'win' | 'linux';

export interface InstallCommand {
  /** 명령 앞에 붙는 짧은 이름 (사전 키 없이 그대로 보여도 되는 도구 이름: Homebrew, npm 등). 없으면 기본 방법 */
  via?: string;
  command: string;
}

export interface InstallGuide {
  /** 이 운영체제에서 쓸 설치 명령. 첫 것이 권장 */
  install: InstallCommand[];
  /** 깐 뒤 로그인할 때 칠 명령 */
  login: string;
  /** 로그인 때 고를 항목 (화면에 뜨는 영어 그대로). 없으면 브라우저만 따라가면 된다 */
  pick?: string;
  /** 설치 폴더를 PATH 에 넣어야 할 때 그 폴더 (맥, 리눅스) */
  binDir?: string;
  /** npm 으로 깔 때 먼저 있어야 하는 Node.js 판 (예: '20') */
  needsNode?: string;
  /** 못 찾을 때 터미널에서 확인할 명령 */
  check: string;
  /** 공식 설치 문서 (https 만) */
  docs: string;
}

export function guideOs(platform: string): GuideOs {
  if (platform === 'darwin') return 'mac';
  if (platform === 'win32') return 'win';
  return 'linux';
}

const CLAUDE_SH = 'curl -fsSL https://claude.ai/install.sh | bash';
const CODEX_SH = 'curl -fsSL https://chatgpt.com/codex/install.sh | sh';
const CURSOR_SH = 'curl https://cursor.com/install -fsS | bash';
const GEMINI_NPM = 'npm install -g @google/gemini-cli';

const GUIDES: Record<GuideProvider, Record<GuideOs, Omit<InstallGuide, 'docs'>> & { docs: string }> = {
  claude: {
    docs: 'https://code.claude.com/docs/en/setup',
    mac: {
      install: [{ command: CLAUDE_SH }, { via: 'Homebrew', command: 'brew install --cask claude-code' }],
      login: 'claude',
      binDir: '~/.local/bin',
      check: 'claude --version',
    },
    linux: {
      install: [{ command: CLAUDE_SH }],
      login: 'claude',
      binDir: '~/.local/bin',
      check: 'claude --version',
    },
    win: {
      install: [
        { via: 'PowerShell', command: 'irm https://claude.ai/install.ps1 | iex' },
        { via: 'WinGet', command: 'winget install Anthropic.ClaudeCode' },
      ],
      login: 'claude',
      check: 'claude --version',
    },
  },
  codex: {
    docs: 'https://github.com/openai/codex',
    mac: {
      install: [{ command: CODEX_SH }, { via: 'Homebrew', command: 'brew install --cask codex' }],
      login: 'codex',
      pick: 'Sign in with ChatGPT',
      check: 'codex --version',
    },
    linux: {
      install: [{ command: CODEX_SH }, { via: 'npm', command: 'npm install -g @openai/codex' }],
      login: 'codex',
      pick: 'Sign in with ChatGPT',
      check: 'codex --version',
    },
    win: {
      install: [
        {
          via: 'PowerShell',
          command: 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"',
        },
      ],
      login: 'codex',
      pick: 'Sign in with ChatGPT',
      check: 'codex --version',
    },
  },
  cursor: {
    docs: 'https://cursor.com/docs/cli/installation',
    mac: {
      install: [{ command: CURSOR_SH }],
      login: 'cursor-agent login',
      binDir: '~/.local/bin',
      check: 'cursor-agent --version',
    },
    linux: {
      install: [{ command: CURSOR_SH }],
      login: 'cursor-agent login',
      binDir: '~/.local/bin',
      check: 'cursor-agent --version',
    },
    win: {
      install: [{ via: 'PowerShell', command: "irm 'https://cursor.com/install?win32=true' | iex" }],
      login: 'cursor-agent login',
      check: 'cursor-agent --version',
    },
  },
  gemini: {
    docs: 'https://github.com/google-gemini/gemini-cli',
    mac: {
      install: [
        { via: 'Homebrew', command: 'brew install gemini-cli' },
        { via: 'npm', command: GEMINI_NPM },
      ],
      login: 'gemini',
      pick: 'Sign in with Google',
      needsNode: '20',
      check: 'gemini --version',
    },
    linux: {
      install: [
        { via: 'npm', command: GEMINI_NPM },
        { via: 'Homebrew', command: 'brew install gemini-cli' },
      ],
      login: 'gemini',
      pick: 'Sign in with Google',
      needsNode: '20',
      check: 'gemini --version',
    },
    win: {
      install: [{ via: 'npm', command: GEMINI_NPM }],
      login: 'gemini',
      pick: 'Sign in with Google',
      needsNode: '20',
      check: 'gemini --version',
    },
  },
};

/** Node.js 받는 곳 (npm 으로 깔 때) */
export const NODE_DOWNLOAD = 'https://nodejs.org/en/download';

export const isGuideProvider = (id: string): id is GuideProvider => Object.hasOwn(GUIDES, id);

/** 이 AI 의 이 운영체제 설치 안내. 안내가 없는 AI(무료 AI, 사용자 추가)면 undefined */
export function installGuide(id: string, platform: string): InstallGuide | undefined {
  if (!isGuideProvider(id)) return undefined;
  const g = GUIDES[id];
  return { ...g[guideOs(platform)], docs: g.docs };
}
