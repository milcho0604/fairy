import assert from 'node:assert/strict';
import { test } from 'node:test';
import { partComplete, partPath, rangeFrom, rangeVerdict, resumeAccepted } from './download-resume.ts';

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

test('받다 만 파일 이름은 해시 앞 8자에 묶는다 (판이 바뀌면 이어 쓰지 않게)', () => {
  assert.equal(partPath('/m/a.gguf', 'd1023499ef3f2f82'), '/m/a.gguf.d1023499.part');
  assert.notEqual(partPath('/m/a.gguf', 'aaaaaaaa00'), partPath('/m/a.gguf', 'bbbbbbbb00'));
});

test('끝까지 받은 .part 는 다시 받지 않고 해시만 본다', () => {
  assert.equal(partComplete(100, 100), true);
  assert.equal(partComplete(99, 100), false);
  assert.equal(partComplete(101, 100), false);
  assert.equal(partComplete(0, 0), false);
  assert.equal(partComplete(Number.NaN, 100), false);
});

test('서버 답 쓰기: 맞는 206 은 이어 붙이고, 어긋난 206 은 Range 없이 다시, 200 은 처음부터', () => {
  assert.equal(rangeVerdict(206, 'bytes 40-99/100', 40), 'resume');
  // 다른 자리부터 보낸 일부를 통째 파일로 쓰면 안 된다
  assert.equal(rangeVerdict(206, 'bytes 0-99/100', 40), 'retry');
  assert.equal(rangeVerdict(206, null, 40), 'retry');
  assert.equal(rangeVerdict(206, 'bytes 0-9/100', 0), 'retry');
  assert.equal(rangeVerdict(200, null, 40), 'fresh');
  assert.equal(rangeVerdict(200, null, 0), 'fresh');
});
