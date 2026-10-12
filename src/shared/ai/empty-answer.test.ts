import assert from 'node:assert/strict';
import { test } from 'node:test';
import { t } from '../i18n/index.ts';
import { finalAnswer, lineUsedTool } from './empty-answer.ts';

test('글이 있으면 그대로, 끝 사건이 비면 조각으로 모은 글', () => {
  assert.equal(finalAnswer('안녕', '', false), '안녕');
  assert.equal(finalAnswer('', '  조각 답 \n', false), '조각 답');
  assert.equal(finalAnswer('', '조각', true), '조각');
});

test('아무 글 없이 끝나면 빈 말풍선 대신 다시 물어봐 달라는 말', () => {
  const text = finalAnswer('', '', false);
  assert.equal(text, t('ai.emptyAnswer'));
  assert.ok(text.length > 0);
  assert.equal(finalAnswer('  \n', ' ', false), t('ai.emptyAnswer'));
});

test('도구만 부르고 말없이 끝나면 따로 알린다 (정상 경우)', () => {
  assert.equal(finalAnswer('', '', true), t('ai.toolsOnly'));
  assert.notEqual(t('ai.toolsOnly'), t('ai.emptyAnswer'));
});

test('도구 부르기 줄 알아보기: claude, cursor, codex', () => {
  const claudeMsg = {
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'mcp__fairy__add_todo', input: {} }] },
  };
  assert.equal(lineUsedTool(JSON.stringify(claudeMsg)), true);
  const block = {
    type: 'stream_event',
    event: { type: 'content_block_start', content_block: { type: 'tool_use' } },
  };
  assert.equal(lineUsedTool(JSON.stringify(block)), true);
  const search = {
    type: 'stream_event',
    event: { type: 'content_block_start', content_block: { type: 'server_tool_use' } },
  };
  assert.equal(lineUsedTool(JSON.stringify(search)), true);
  assert.equal(lineUsedTool(JSON.stringify({ type: 'tool_call', subtype: 'started' })), true);
  assert.equal(
    lineUsedTool(JSON.stringify({ type: 'item.completed', item: { type: 'mcp_tool_call' } })),
    true,
  );
});

test('글 조각, 끝, 로그 줄은 도구 부르기가 아니다', () => {
  const text = { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } };
  assert.equal(lineUsedTool(JSON.stringify(text)), false);
  const delta = {
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'a' } },
  };
  assert.equal(lineUsedTool(JSON.stringify(delta)), false);
  assert.equal(
    lineUsedTool(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '' } })),
    false,
  );
  assert.equal(lineUsedTool(JSON.stringify({ type: 'result', subtype: 'success', result: '' })), false);
  assert.equal(lineUsedTool('not json'), false);
  assert.equal(lineUsedTool('null'), false);
});
