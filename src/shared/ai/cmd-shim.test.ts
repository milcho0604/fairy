import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cmdShimScript } from './cmd-shim.ts';

test('npm 배치 파일에서 JS 경로를 꺼낸다, 모르는 모양과 상위 폴더는 거른다', () => {
  const shim = [
    '@ECHO off',
    'GOTO start',
    ':find_dp0',
    'SET dp0=%~dp0',
    'EXIT /b',
    ':start',
    'SETLOCAL',
    'CALL :find_dp0',
    'IF EXIST "%dp0%\\node.exe" (',
    '  SET "_prog=%dp0%\\node.exe"',
    ') ELSE (',
    '  SET "_prog=node"',
    ')',
    'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
  ].join('\r\n');
  assert.equal(cmdShimScript(shim), 'node_modules\\@openai\\codex\\bin\\codex.js');
  assert.equal(cmdShimScript('"%~dp0\\cli.mjs" %*'), 'cli.mjs');
  assert.equal(cmdShimScript('"%dp0%\\..\\evil\\x.js" %*'), undefined);
  assert.equal(cmdShimScript('@echo off\r\nsomething.exe %*'), undefined);
});
