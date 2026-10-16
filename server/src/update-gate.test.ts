// 업데이트 단계 순수 규칙 시험 (이슈 #120): 세 기준의 경계, 머리 없음과 깨진 값, 순서, 예외 경로.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { appVersionOf, cmpVersion, gateOf, levelsOrder } from './shared/update-levels';
import { exempt } from './update-gate';

describe('버전 비교와 머리 읽기', () => {
  test('X.Y.Z 를 숫자로 비교한다 (0.10.0 > 0.9.9)', () => {
    assert.equal(cmpVersion('0.10.0', '0.9.9'), 1);
    assert.equal(cmpVersion('0.4.4', '0.4.4'), 0);
    assert.equal(cmpVersion('0.4.3', '0.4.4'), -1);
  });

  test('앱 판 머리: 없음, 빈 값, 모양이 틀린 값은 undefined, 공백은 깎는다', () => {
    assert.equal(appVersionOf(undefined), undefined);
    assert.equal(appVersionOf(''), undefined);
    assert.equal(appVersionOf('0.4'), undefined);
    assert.equal(appVersionOf('abc'), undefined);
    assert.equal(appVersionOf(' 0.4.4 '), '0.4.4');
    assert.equal(appVersionOf(['0.4.4', '0.1.0']), '0.4.4');
  });

  test('미리 나온 판과 빌드 표시는 떼고 숫자 판으로 본다 (0.5.0-beta = 0.5.0, 0.5.0+abc = 0.5.0)', () => {
    assert.equal(appVersionOf('0.5.0-beta'), '0.5.0');
    assert.equal(appVersionOf('0.4.4-beta.1'), '0.4.4');
    assert.equal(appVersionOf('0.5.0+abc123'), '0.5.0');
    assert.equal(appVersionOf('0.5.0-rc.1+build.7'), '0.5.0');
    // 떼고 나서도 X.Y.Z 가 아니면 머리가 없는 것으로 (가장 낮은 판)
    assert.equal(appVersionOf('0.5-beta'), undefined);
    assert.equal(appVersionOf('-beta'), undefined);
  });

  test('앞자리 0 은 숫자로 맞춘다 (0000.0005.0000 = 0.5.0)', () => {
    assert.equal(appVersionOf('0000.0005.0000'), '0.5.0');
  });
});

describe('세 기준의 경계 (gateOf)', () => {
  test('기준이 없으면 머리와 상관없이 통과한다', () => {
    assert.equal(gateOf({}, undefined), undefined);
    assert.equal(gateOf({ recommend: '0.5.0' }, '0.1.0'), undefined);
  });

  test('기능 제한: 같은 판은 통과, 한 단계 낮으면 restrict', () => {
    const l = { restrict: '0.4.4' };
    assert.equal(gateOf(l, '0.4.4'), undefined);
    assert.equal(gateOf(l, '0.4.5'), undefined);
    assert.deepEqual(gateOf(l, '0.4.3'), { level: 'restrict', need: '0.4.4' });
    assert.deepEqual(gateOf(l, '0.3.99'), { level: 'restrict', need: '0.4.4' });
  });

  test('강제: 강제 기준보다 낮으면 force, 같으면 기능 제한 기준만 본다', () => {
    const l = { min: '0.4.0', restrict: '0.4.4' };
    assert.deepEqual(gateOf(l, '0.3.9'), { level: 'force', need: '0.4.0' });
    assert.deepEqual(gateOf(l, '0.4.0'), { level: 'restrict', need: '0.4.4' });
    assert.equal(gateOf(l, '0.4.4'), undefined);
  });

  test('머리가 없거나 깨졌으면 가장 낮은 판(0.0.0)으로 본다', () => {
    assert.deepEqual(gateOf({ restrict: '0.4.4' }, undefined), { level: 'restrict', need: '0.4.4' });
    assert.deepEqual(gateOf({ min: '0.4.0' }, undefined), { level: 'force', need: '0.4.0' });
  });

  test('권장만 있으면 아무도 막지 않는다', () => {
    assert.equal(gateOf({ recommend: '0.4.4' }, '0.0.1'), undefined);
  });
});

describe('세 기준의 순서 (levelsOrder)', () => {
  test('강제 ≤ 기능 제한 ≤ 권장 이면 통과, 정한 것끼리만 본다', () => {
    assert.equal(levelsOrder({}), undefined);
    assert.equal(levelsOrder({ min: '0.4.0', restrict: '0.4.4', recommend: '0.4.5' }), undefined);
    assert.equal(levelsOrder({ min: '0.4.0', recommend: '0.4.5' }), undefined);
    assert.equal(levelsOrder({ restrict: '0.4.4', recommend: '0.4.4' }), undefined);
  });

  test('기능 제한이 권장보다 높거나 강제가 기능 제한보다 높으면 거절', () => {
    assert.ok(levelsOrder({ restrict: '0.4.5', recommend: '0.4.4' }));
    assert.ok(levelsOrder({ min: '0.4.5', restrict: '0.4.4' }));
  });
});

describe('예외 경로 (exempt)', () => {
  test('상태, 공지와 이벤트 파일, 로그인, 운영자, 내 계정 보기, 로그아웃과 탈퇴는 통과', () => {
    assert.ok(exempt('GET', '/health'));
    assert.ok(exempt('GET', '/v1/notices.json'));
    assert.ok(exempt('GET', '/v1/events.json'));
    assert.ok(exempt('GET', '/v1/me'));
    assert.ok(exempt('GET', '/v1/auth/providers'));
    assert.ok(exempt('POST', '/v1/auth/google/begin'));
    assert.ok(exempt('POST', '/v1/session'));
    assert.ok(exempt('GET', '/auth/google/start'));
    assert.ok(exempt('GET', '/admin'));
    assert.ok(exempt('POST', '/admin/versions'));
    assert.ok(exempt('GET', '/v1/admin/overview'));
    assert.ok(exempt('POST', '/v1/admin/versions'));
    assert.ok(exempt('DELETE', '/v1/session'));
    assert.ok(exempt('DELETE', '/v1/account'));
  });

  test('나머지 서버 기능은 막힌다 (맞추기, 기기 만들기, 백업, 쪽지, 기능 키 보기)', () => {
    assert.equal(exempt('POST', '/v1/sync'), false);
    assert.equal(exempt('POST', '/v1/device'), false);
    assert.equal(exempt('GET', '/v1/backup'), false);
    assert.equal(exempt('GET', '/v1/inbox'), false);
    assert.equal(exempt('GET', '/v1/features'), false);
    assert.equal(exempt('PUT', '/v1/backup'), false);
    assert.equal(exempt('DELETE', '/v1/account/x'), false);
  });
});
