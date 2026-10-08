// 맥 앱을 늘 같은 자체 인증서로 다시 서명한다 (electron-builder afterSign 훅).
//
// 왜: 임시 서명(-)은 빌드마다 지문(cdhash)이 바뀐다. 맥은 정식 서명 없는 앱의 화면 기록 권한을
// 그 지문으로 기억해서, 업데이트하면 설정에는 켜짐으로 보이는데 실제로는 거절된다 (L23).
// 같은 인증서로 서명하면 맥이 기억하는 조건이 "앱 ID + 인증서"가 되어 업데이트해도 권한이 남는다.
// 애플 개발자 서명(D4)을 붙이면 이 훅은 필요 없다.
//
// 인증서를 잃어버리거나 새로 만들면 모든 사용자가 권한을 한 번 다시 줘야 한다. 그래서 지문을 아래에
// 박아 두고, 다른 인증서면 빌드를 멈춘다. 인증서 위치와 다시 만드는 법은 docs/release.md.
//
// 인증서를 찾는 순서
// 1. JJ_MAC_SIGN_P12 (p12 를 base64 로) + JJ_MAC_SIGN_PASSWORD: GitHub Actions 비밀값
// 2. ~/.config/jjakkung/mac-sign.p12 + mac-sign.password: 만든 사람 컴퓨터
// 둘 다 없으면 빌드를 멈춘다. 시험 빌드처럼 권한이 상관없을 때만 JJ_ALLOW_ADHOC=1 로 넘긴다.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

/** 배포 인증서(CN=Jjakkung Self Signed)의 SHA1 지문. 바꾸면 사용자 권한이 모두 풀린다 */
const CERT_SHA1 = '45DAB97976E727D42955956ED8DC2B5ED6D12714';

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function loadP12() {
  if (process.env.JJ_MAC_SIGN_P12 && process.env.JJ_MAC_SIGN_PASSWORD) {
    return { p12: Buffer.from(process.env.JJ_MAC_SIGN_P12, 'base64'), password: process.env.JJ_MAC_SIGN_PASSWORD };
  }
  const dir = join(homedir(), '.config', 'jjakkung');
  const file = join(dir, 'mac-sign.p12');
  const pass = join(dir, 'mac-sign.password');
  if (existsSync(file) && existsSync(pass)) {
    return { p12: readFileSync(file), password: readFileSync(pass, 'utf8').trim() };
  }
  return undefined;
}

/** 지금 사용자 키체인 검색 목록 (따옴표와 공백을 벗긴 경로들) */
function searchList() {
  return run('/usr/bin/security', ['list-keychains', '-d', 'user'])
    .split('\n')
    .map((l) => l.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
}

export default async function macSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const cert = loadP12();
  if (!cert) {
    if (process.env.JJ_ALLOW_ADHOC === '1') {
      console.warn('  • mac-sign: 인증서가 없어 임시 서명으로 둔다 (JJ_ALLOW_ADHOC). 배포하면 안 된다');
      return;
    }
    throw new Error(
      'mac-sign: 서명 인증서가 없다. 임시 서명으로 배포하면 업데이트마다 화면 기록 권한이 풀린다. docs/release.md 참고',
    );
  }

  const work = mkdtempSync(join(tmpdir(), 'jj-sign-'));
  const keychain = join(work, 'sign.keychain-db');
  const p12 = join(work, 'sign.p12');
  const kcPass = randomBytes(16).toString('hex');
  const before = searchList();
  try {
    writeFileSync(p12, cert.p12, { mode: 0o600 });
    run('/usr/bin/security', ['create-keychain', '-p', kcPass, keychain]);
    run('/usr/bin/security', ['set-keychain-settings', keychain]);
    run('/usr/bin/security', ['unlock-keychain', '-p', kcPass, keychain]);
    run('/usr/bin/security', ['import', p12, '-k', keychain, '-P', cert.password, '-T', '/usr/bin/codesign']);
    run('/usr/bin/security', [
      'set-key-partition-list',
      '-S',
      'apple-tool:,apple:,codesign:',
      '-s',
      '-k',
      kcPass,
      keychain,
    ]);
    const found = run('/usr/bin/security', ['find-identity', '-p', 'codesigning', keychain]);
    if (!found.includes(CERT_SHA1)) {
      throw new Error(`mac-sign: 인증서 지문이 ${CERT_SHA1} 가 아니다. 다른 인증서로 서명하면 사용자 권한이 풀린다`);
    }
    // 자체 인증서는 맥이 "믿는" 인증서가 아니라 codesign 이 검색 목록에 있는 키체인에서만 찾는다.
    // 잠깐 넣고 finally 에서 원래 목록으로 돌린다.
    run('/usr/bin/security', ['list-keychains', '-d', 'user', '-s', ...before, keychain]);
    // --deep 은 안쪽 도우미 앱과 프레임워크까지. 권한(entitlements, JIT 허용 등)은 electron-builder 가 단 것을 둔다
    run('/usr/bin/codesign', [
      '--force',
      '--deep',
      '--preserve-metadata=entitlements',
      '--sign',
      CERT_SHA1,
      app,
    ]);
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
    const req = execFileSync('/usr/bin/codesign', ['-d', '-r-', app], { encoding: 'utf8', stdio: 'pipe' });
    // 자체 인증서는 혼자서 뿌리라 "certificate root", 예전 시험 인증서는 "certificate leaf" 로 나온다. 둘 다 빌드와 무관하게 같다
    if (!new RegExp(`certificate (root|leaf) = h"${CERT_SHA1.toLowerCase()}"`).test(req.toLowerCase())) {
      throw new Error(`mac-sign: 서명 조건이 인증서 기준이 아니다: ${req.trim()}`);
    }
    console.log(`  • mac-sign: 자체 인증서로 서명 ${app}`);
  } finally {
    try {
      run('/usr/bin/security', ['list-keychains', '-d', 'user', '-s', ...before]);
    } catch (err) {
      console.error('  • mac-sign: 키체인 검색 목록을 되돌리지 못했다', err);
    }
    try {
      run('/usr/bin/security', ['delete-keychain', keychain]);
    } catch {}
    rmSync(work, { recursive: true, force: true });
  }
}
