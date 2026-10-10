import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rangeFrom, resumeAccepted } from './download-resume.ts';

test('이어 받기 시작: 받다 만 만큼, 다 받았거나 넘쳤거나 없으면 처음부터', () => {
  assert.equal(rangeFrom(0, 100), 0);
  assert.equal(rangeFrom(40, 100), 40);
  assert.equal(rangeFrom(100, 100), 0);
  assert.equal(rangeFrom(150, 100), 0);
  assert.equal(rangeFrom(Number.NaN, 100), 0);
});

test('이어 받기는 206 과 맞는 Content-Range 일 때만', () => {
  assert.equal(resumeAccepted(206, 'bytes 40-99/100', 40), true);
  assert.equal(resumeAccepted(206, 'bytes 40-99/*', 40), true);
  // 다른 자리부터 보냈으면 이어 붙이면 깨진다
  assert.equal(resumeAccepted(206, 'bytes 0-99/100', 40), false);
  // 서버가 Range 를 모른 척하고 200 으로 다 보냄
  assert.equal(resumeAccepted(200, null, 40), false);
  assert.equal(resumeAccepted(206, null, 40), false);
  assert.equal(resumeAccepted(206, 'bytes 0-99/100', 0), false);
});
