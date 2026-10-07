import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canPlay, MAX_GAIN, SOUNDS, type SoundKind, soundLength } from './sound.ts';

test('효과음은 작고 짧고, 귀에 거슬리는 높이가 아니다', () => {
  for (const [kind, notes] of Object.entries(SOUNDS) as [SoundKind, (typeof SOUNDS)[SoundKind]][]) {
    assert.ok(notes.length > 0, kind);
    assert.ok(soundLength(kind) <= 700, `${kind} ${soundLength(kind)}ms`);
    for (const n of notes) {
      assert.ok(n.gain > 0 && n.gain <= MAX_GAIN, `${kind} gain ${n.gain}`);
      for (const f of [n.freq, n.freqEnd ?? n.freq]) assert.ok(f >= 120 && f <= 2200, `${kind} ${f}Hz`);
      assert.ok(n.dur >= 30 && n.at >= 0, kind);
    }
    // 겹쳐 울려도 합이 너무 커지지 않게
    const overlap = Math.max(
      ...notes.map((a) =>
        notes.filter((b) => b.at < a.at + a.dur && a.at < b.at + b.dur).reduce((s, b) => s + b.gain, 0),
      ),
    );
    assert.ok(overlap <= 0.12, `${kind} 겹친 크기 ${overlap}`);
  }
});

test('설정을 켰을 때만, 집중, 잠, 졸음, 바쁨, 숨김에서는 안 낸다', () => {
  assert.equal(canPlay({ enabled: false, focus: false, mood: 'idle' }), false);
  assert.equal(canPlay({ enabled: true, focus: false, mood: 'idle' }), true);
  assert.equal(canPlay({ enabled: true, focus: false, mood: 'excited' }), true);
  assert.equal(canPlay({ enabled: true, focus: true, mood: 'idle' }), false);
  for (const mood of ['sleeping', 'dozing', 'busy', 'hidden'])
    assert.equal(canPlay({ enabled: true, focus: false, mood }), false, mood);
});
