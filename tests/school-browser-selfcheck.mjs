import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { createHash, randomBytes, randomUUID, webcrypto } from 'node:crypto';
import React from 'react';
import ts from 'typescript';
import { assertLntAccount, createLearning, historyView, todoView } from '../src/learning.ts';
import * as demoData from '../src/demo-data.ts';
import * as demoState from '../src/demo-state.ts';
import * as styleOptions from '../src/style-options.ts';
import * as browserModule from '../src/school-browser.ts';
import * as scheduleModule from '../src/schedule.ts';
import * as attendanceModule from '../src/attendance.ts';
import * as locationModule from '../src/location-attendance.ts';
import * as qrModule from '../src/qr.ts';
import { createAttendanceTrial } from '../src/attendance-trial.ts';

const { CALLBACK, IDENTITY, JW_APP, createSchoolBrowser, schoolUrl } = browserModule;
const require = createRequire(import.meta.url);
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const academicPage = 'https://jw.xmu.edu.cn/gsapp/sys/wdkbapp/*default/index.do';
// The school's jw-xskcbBS.js reads this envelope, not a top-level array.
const academicTerms = { datas: { kfdxnxqcx: { rows: [{ DM: '20261', MC: '测试学期' }] } } };
const profile = { id: 42, user_no: '001234', name: '测试同学' };
const recoveryAccount = { lntId: 42, studentNumber: '001234', name: '测试同学' };
const todo = { id: 7, course_id: 3, course_name: '课程', title: '学校返回的作业', type: 'homework', end_time: null, is_locked: false };
const course = { id: 3, course_code: '001-A', name: '学校课程', semester_id: 9 };
const academicWeeks = { success: true, currentZc: '8', zcList: Array.from({ length: 18 }, (_, i) => ({ ZC: i + 1 })) };
const authorization = IDENTITY + '/auth?' + new URLSearchParams({ redirect_uri: CALLBACK, state: 'test-state' });
// RNCWebViewClient.createWebViewEvent: direct Android requests omit a frame flag.
const androidNavigation = url => ({ target: 1, url, loading: true, title: '', canGoBack: false, canGoForward: false });
function loadModule(path, mocks, globals = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(source, { exports, __DEV__: true, JSON, URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), ...globals });
  return exports;
}
function response(url, body, status = 200, contentType = 'application/json') {
  const result = new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': contentType } });
  Object.defineProperty(result, 'url', { value: url });
  return result;
}
function fixture(files = new Map(), timers = {}) {
  const calls = [], cookieCalls = [], logs = [], cookies = new Map([['sso', 'test-session']]);
  const f = { files, calls, cookieCalls, cookies, logs, cookieLoads: 0, cookieUnavailable: false,
    failWrite: false, failMove: false, failClear: false, failFlush: false, failDelete: false, failCrypto: false, flushGate: null, handler: null,
    console: Object.fromEntries(['info', 'warn'].map(level => [level, (...args) => logs.push([level, ...args])])) };
  class File {
    constructor(_root, name) { this.name = name; }
    get uri() { return this.name; }
    get exists() { return files.has(this.name); }
    async text() { return files.get(this.name); }
    async write(value) { if (f.failWrite) throw Error('DISK'); files.set(this.name, value); }
    delete() { if (f.failDelete && this.name === 'school-learning.json') throw Error('DISK'); files.delete(this.name); }
  }
  const fetch = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.credentials, 'include');
    if (f.handler) { const result = await f.handler(url, options); if (result) return result; }
    if (url.endsWith('/token')) return response(url, { access_token: 'one-use-access-token' });
    if (url.includes('/api/login')) return response(url, '');
    if (url.includes('kfdxnxqcx')) return response(url, academicTerms);
    if (url.includes('queryXspkjg.do')) return response(url, { success: true, pkjgList: [] });
    if (url.includes('getZcxx.do')) return response(url, academicWeeks);
    if (url.endsWith('/api/semesters')) return response(url, { semesters: [{ id: 9, name: 'LNT 秋季', is_active: true }] });
    if (url.includes('/my-courses')) return response(url, { courses: [course], pages: 1, total: 1 });
    if (url.endsWith('/profile')) return response(url, profile);
    if (url.includes('/todos')) return response(url, { todo_list: [todo] });
    if (url.endsWith('/radar/rollcalls')) return response(url, { rollcalls: [] });
    if (url.includes('/rollcalls')) return response(url, { rollcalls: [] });
    throw Error('Unexpected request');
  };
  const deviceModule = loadModule('../src/school-device.ts', {
    get '@preeternal/react-native-cookie-manager'() {
      f.cookieLoads++;
      if (f.cookieUnavailable) throw Error('Native CookieManager is unavailable');
      return { __esModule: true, default: {
        flush: async () => { cookieCalls.push('flush'); if (f.flushGate) await f.flushGate.promise; if (f.failFlush) throw Error('COOKIE_STORAGE'); },
        clearAllStores: async () => { cookieCalls.push('clearAllStores'); if (f.failClear) throw Error('COOKIE_STORAGE'); cookies.clear(); return true; },
      } };
    },
    'expo-file-system': { File, Paths: { document: '/private/app' } },
    'expo-file-system/legacy': { moveAsync: async ({ from, to }) => {
      if (f.failMove) throw Error('DISK');
      files.set(to, files.get(from)); files.delete(from);
    } },
    'expo-crypto': { randomUUID, getRandomBytesAsync: async size => {
      if (f.failCrypto) throw Object.assign(Error('password=private-password'), { code: 'private-token' });
      return randomBytes(size);
    },
      digestStringAsync: async (_algorithm, text) => createHash('sha256').update(text).digest('base64'),
      CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, CryptoEncoding: { BASE64: 'base64' } },
    './school-browser': browserModule,
    './learning': { assertLntAccount },
    './attendance.ts': attendanceModule,
    './location-attendance.ts': locationModule,
    './qr.ts': qrModule,
  }, { fetch, console: f.console, ...timers });
  return Object.assign(f, deviceModule, { learning: createLearning(deviceModule.schoolDevice) });
}
async function authorize(f) {
  await tick();
  const page = f.schoolBrowser.getSnapshot();
  assert.equal(page.kind, 'authorize');
  const auth = new URL(page.url);
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(auth.searchParams.get('redirect_uri'), CALLBACK);
  assert.match(auth.searchParams.get('state'), /^[0-9a-f]{32}$/);
  f.schoolBrowser.navigating(page, CALLBACK + '&code=single-code&state=' + auth.searchParams.get('state'));
  await tick();
  return auth;
}
async function initialize(f) {
  const page = f.schoolBrowser.getSnapshot();
  assert.equal(page.kind, 'academic');
  assert.equal(page.url, JW_APP);
  f.schoolBrowser.loaded(page, 'https://ids.xmu.edu.cn/authserver/login');
  assert.equal(f.schoolBrowser.getSnapshot(), page, 'the SSO login page is not academic readiness');
  f.schoolBrowser.loaded(page, academicPage);
  await tick();
}
function deliverRecoveryLanding(f, page, url = 'https://lnt.xmu.edu.cn/user/index#/') {
  const documentUrl = url.split('#')[0];
  f.schoolBrowser.recoveryDocument(page, url, { url, data: JSON.stringify([page.challenge, 'landing', documentUrl]) });
}

test('LNT courses use the selected semester and collect every page before returning', async () => {
  const f = fixture();
  f.handler = async (url, options) => {
    if (!url.endsWith('/api/my-courses')) return;
    assert.equal(options.method, 'POST');
    const body = JSON.parse(options.body);
    assert.deepEqual(body.conditions.semester_id, [9]);
    assert.equal(body.page_size, 100);
    assert.equal(body.fields, 'id,course_code,name,semester_id');
    return response(url, { courses: [{ ...course, id: body.page }], pages: 2, total: 2 });
  };
  for (const semesterId of [undefined, 0, -1, '9', 1.5]) {
    await assert.rejects(f.schoolDevice.read('courses', { semesterId }), { code: 'INVALID_SEMESTER' });
  }
  const result = await f.schoolDevice.read('courses', { semesterId: 9 });
  assert.deepEqual(Array.from(result.courses, item => item.id), [1, 2]);
  assert.deepEqual(f.calls.map(call => JSON.parse(call.options.body).page), [1, 2]);
});

test('expired LNT course POST waits for official browser recovery and Cookie flush before replay', async () => {
  const f = fixture();
  f.flushGate = deferred();
  let attempts = 0;
  f.handler = async url => {
    if (url.endsWith('/my-courses') && attempts++ === 0) return response(url, {}, 401);
  };
  const result = f.schoolDevice.read('courses', { semesterId: 9 }, recoveryAccount);
  void result.catch(() => {});
  await tick();
  const page = f.schoolBrowser.getSnapshot();
  assert.equal(page?.url, 'https://lnt.xmu.edu.cn/');
  assert.equal(page.kind, 'recovery');
  deliverRecoveryLanding(f, page, 'https://lnt.xmu.edu.cn/app-redirect');
  assert.equal(f.schoolBrowser.getSnapshot(), page);
  deliverRecoveryLanding(f, page);
  await tick();
  assert.deepEqual(f.cookieCalls, ['flush']);
  assert.equal(attempts, 1);
  f.flushGate.resolve();
  assert.deepEqual(Array.from((await result).courses), [course]);
  assert.deepEqual(f.calls.map(call => new URL(call.url).pathname), ['/api/my-courses', '/api/profile', '/api/my-courses']);
  assert.equal(f.calls[2].options.method, 'POST');
  assert.equal(f.calls[2].options.body, f.calls[0].options.body);
  assert.equal(JSON.parse(f.calls[2].options.body).conditions.semester_id[0], 9);
});

test('simultaneous and late stale history responses share one recovery and each retry once', async () => {
  const f = fixture(), late = deferred(), sent = new Map();
  f.handler = async url => {
    if (!url.includes('/student/')) return;
    const courseId = Number(new URL(url).pathname.split('/')[3]);
    const count = (sent.get(courseId) ?? 0) + 1;
    sent.set(courseId, count);
    if (count === 1 && courseId === 5) await late.promise;
    if (count === 1 || courseId === 5) return response(url, {}, 401);
  };
  const requests = [3, 4, 5].map(courseId => f.schoolDevice.read('history', { courseId, studentId: 42 }, recoveryAccount));
  const rejected = assert.rejects(requests[2], { code: 'AUTH_REQUIRED' });
  await tick();
  const page = f.schoolBrowser.getSnapshot();
  assert.equal(page?.kind, 'recovery');
  deliverRecoveryLanding(f, page);
  await Promise.all(requests.slice(0, 2));
  late.resolve();
  await rejected;
  assert.deepEqual([...sent.values()], [2, 2, 2]);
  assert.deepEqual(f.cookieCalls, ['flush']);
  assert.equal(f.schoolBrowser.getSnapshot(), null);
});

test('a late history waiter cannot replay under another account’s successful recovery', async () => {
  const f = fixture(), late = deferred();
  let expired = true;
  f.handler = async url => {
    if (url.includes('/student/43/')) { await late.promise; return response(url, {}, 401); }
    if (url.includes('/student/42/') && expired) { expired = false; return response(url, {}, 401); }
  };
  const first = f.schoolDevice.read('history', { courseId: 3, studentId: 42 }, { ...recoveryAccount, studentNumber: '' });
  const peer = assert.rejects(f.schoolDevice.read('history', { courseId: 3, studentId: 43 }, { ...recoveryAccount, lntId: 43 }), { code: 'AUTH_REQUIRED' });
  await tick();
  deliverRecoveryLanding(f, f.schoolBrowser.getSnapshot());
  assert.deepEqual((await first).rollcalls, []);
  late.resolve();
  await peer;
  assert.equal(f.calls.filter(call => call.url.includes('/student/43/')).length, 1);
  assert.deepEqual(f.cookieCalls, ['flush']);
  assert.equal(f.schoolBrowser.getSnapshot(), null);
});

test('invalid or failed later course pages retain the entire saved learning batch', async () => {
  const f = fixture(), login = f.learning.login(); await authorize(f); await initialize(f);
  assert.equal(await login, true);
  const before = f.learning.getSnapshot(), saved = f.files.get('school-learning.json');
  for (const failure of ['network', 'shape', 'changed-pages', 'missing-course', 'oversized-page']) {
    f.handler = async (url, options) => {
      if (!url.endsWith('/api/my-courses')) return;
      const { page } = JSON.parse(options.body);
      if (failure === 'oversized-page') return response(url, { courses: Array.from({ length: 101 }, (_, index) => ({ ...course, id: index + 1 })), pages: 1, total: 101 });
      if (page === 1) return response(url, { courses: [course], pages: 2, total: 2 });
      if (failure === 'network') throw Error('NETWORK');
      return response(url, failure === 'shape' ? {} : { courses: failure === 'missing-course' ? [] : [{ ...course, id: 4 }], pages: failure === 'changed-pages' ? 1 : 2, total: 2 });
    };
    assert.equal(await f.learning.refresh(), false, failure);
    assert.equal(f.files.get('school-learning.json'), saved);
    for (const key of ['account', 'term', 'courses', 'coursesAt', 'todos', 'todosAt', 'rollcalls', 'schedule', 'scheduleAt', 'history', 'historyAt']) {
      assert.strictEqual(f.learning.getSnapshot()[key], before[key], failure + ':' + key);
    }
  }
});

test('a different recovery account cannot replace the cached or in-flight refresh account', async () => {
  for (const [stage, recovered] of [['profile', { ...profile, id: 43 }], ['todos', { ...profile, user_no: '009999' }]]) {
    const raw = JSON.stringify({ version: 1, account: { lntId: 42, studentNumber: '001234', name: '缓存账号' }, todos: [todo], todosAt: 1000 });
    const f = fixture(new Map([['school-learning.json', raw]]));
    let recoveredSession = false;
    f.handler = async url => {
      if (recoveredSession && url.endsWith('/profile')) return response(url, recovered);
      if (!recoveredSession && new URL(url).pathname === '/api/' + stage) return response(url, {}, 401);
      if (recoveredSession && url.includes('/todos')) return response(url, { todo_list: [] });
    };
    await f.learning.restore();
    const before = f.learning.getSnapshot();
    const refresh = f.learning.refresh();
    await tick();
    const page = f.schoolBrowser.getSnapshot();
    assert.equal(page?.kind, 'recovery');
    recoveredSession = true;
    deliverRecoveryLanding(f, page);
    assert.equal(await refresh, false, stage);
    assert.equal(f.learning.getSnapshot().needsLogin, true);
    assert.strictEqual(f.learning.getSnapshot().account, before.account);
    assert.strictEqual(f.learning.getSnapshot().todos, before.todos);
    assert.equal(f.files.get('school-learning.json'), raw);
    assert.equal(f.calls.length, stage === 'profile' ? 2 : 3);
    assert.deepEqual(f.cookieCalls, []);

    const reopened = fixture(f.files);
    reopened.handler = f.handler;
    await reopened.learning.restore();
    assert.equal(await reopened.learning.refresh(), false, 'the next launch still requires explicit login');
    assert.equal(reopened.learning.getSnapshot().needsLogin, true);
    assert.deepEqual(reopened.learning.getSnapshot().account, before.account);
    assert.equal(reopened.files.get('school-learning.json'), raw);
    assert.deepEqual(reopened.calls.map(call => new URL(call.url).pathname), ['/api/profile']);
  }
});

test('history keeps its prior batch when recovery changes account and a peer finishes late', async () => {
  const late = deferred();
  const raw = JSON.stringify({ version: 1, account: { lntId: 42, studentNumber: '001234', name: '' }, todos: [todo], todosAt: 1000,
    term: { id: 9, name: 'LNT 秋季' }, courses: [course, { ...course, id: 4 }, { ...course, id: 5 }], coursesAt: 1000 });
  const f = fixture(new Map([['school-learning.json', raw]]));
  let recoveredSession = false;
  f.handler = async url => {
    if (url.endsWith('/profile')) return response(url, { ...profile, user_no: '009999' });
    if (url.includes('/course/5/')) { await late.promise; return response(url, {}, 401); }
    if (url.includes('/student/') && !recoveredSession) return response(url, {}, 401);
  };
  await f.learning.restore();
  const before = f.learning.getSnapshot();
  const history = f.learning.refreshHistory();
  await tick();
  const page = f.schoolBrowser.getSnapshot();
  assert.equal(page?.kind, 'recovery');
  recoveredSession = true;
  deliverRecoveryLanding(f, page);
  await tick();
  late.resolve();
  await tick();
  assert.equal(f.schoolBrowser.getSnapshot(), null);
  assert.equal(f.calls.length, 4);
  assert.equal(await history, false);
  assert.equal(f.learning.getSnapshot().needsLogin, true);
  assert.strictEqual(f.learning.getSnapshot().history, before.history);
  assert.equal(f.files.get('school-learning.json'), raw);
  assert.deepEqual(f.cookieCalls, []);
});

test('two-site login uses PKCE, waits for authentication and cookie saving, then reads and saves todos', async () => {
  const f = fixture(), gate = deferred(); let authorized = 0;
  f.handler = async url => { if (url.includes('/api/login')) { await gate.promise; return response(url, ''); } };
  const login = f.learning.login(() => authorized++);
  const auth = await authorize(f);
  assert.equal(authorized, 0, 'a callback or token alone is not authentication success');
  const body = new URLSearchParams(f.calls[0].options.body);
  assert.equal(body.get('code'), 'single-code');
  assert.equal(body.get('client_id'), 'TronClassH5');
  assert.match(body.get('code_verifier'), /^[0-9a-f]{64}$/);
  assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'), auth.searchParams.get('code_challenge'));
  await initialize(f);
  assert.equal(authorized, 0);
  assert.equal(f.calls.some(call => call.url.endsWith('/profile')), false);
  const loginCall = f.calls.find(call => call.url.includes('/api/login'));
  assert.deepEqual(JSON.parse(loginCall.options.body), { access_token: 'one-use-access-token', org_id: 1 });
  gate.resolve(); assert.equal(await login, true);
  assert.equal(f.calls.filter(call => call.url.includes('kfdxnxqcx')).length, 1, 'the first timetable consumes the verified academic term response');
  assert.equal(authorized, 1);
  assert.equal(f.schoolBrowser.getSnapshot(), null);
  assert.deepEqual(f.cookieCalls, ['flush'], 'login persists API cookies without deleting them');
  assert.equal(f.cookies.get('sso'), 'test-session');
  assert.equal(f.learning.getSnapshot().account.studentNumber, '001234');
  assert.deepEqual(f.learning.getSnapshot().todos, [todo]);
  const saved = f.files.get('school-learning.json');
  assert.equal(JSON.parse(saved).account.lntId, 42);
  assert.deepEqual(JSON.parse(saved).history, []);
  assert.equal(JSON.parse(saved).historyAt, JSON.parse(saved).todosAt);
  assert.deepEqual(f.calls.filter(call => /\/course\/\d+\/student\//.test(call.url)).map(call => call.url), ['https://lnt.xmu.edu.cn/api/course/3/student/42/rollcalls?page=1&page_size=100']);
  assert.doesNotMatch(saved, /single-code|access-token|code_verifier/);
  await f.schoolDevice.read('jwTerms');
  assert.equal(f.calls.filter(call => call.url.includes('kfdxnxqcx')).length, 2, 'the authentication probe is consumed only once');
  const reopened = createLearning(f.schoolDevice); await reopened.restore();
  assert.deepEqual(reopened.getSnapshot().todos, [todo]);
  assert.equal(await reopened.refresh(), true);
  assert.equal(await reopened.logout(), true);
  assert.equal(f.files.size, 0);
  assert.deepEqual(f.cookieCalls, ['flush', 'clearAllStores']);
  assert.equal(f.cookies.size, 0);
});
test('failed authentication, invalid token, and academic probe errors cannot report success', async () => {
  for (const phase of ['token', 'academic', 'login']) {
    const f = fixture(); let authorized = 0;
    f.handler = async url => {
      if (phase === 'token' && url.endsWith('/token')) return response(url, {});
      if (phase === 'academic' && url.includes('kfdxnxqcx')) return response(url, '<html>login</html>', 200, 'text/html');
      if (phase === 'login' && url.includes('/api/login')) return response(url, {}, 201);
    };
    const login = f.learning.login(() => authorized++);
    await authorize(f);
    if (phase !== 'token') await initialize(f);
    assert.equal(await login, false);
    assert.equal(authorized, 0);
    assert.equal(f.files.size, 0);
    assert.equal(f.calls.some(call => call.url.endsWith('/profile')), false);
    assert.equal(f.schoolBrowser.getSnapshot(), null);
  }
});
test('academic probe accepts the school envelope and rejects invalid session responses', async () => {
  for (const [body, valid] of [
    [academicTerms, true],
    [[], false], [null, false], [{}, false], [{ datas: { kfdxnxqcx: { rows: {} } } }, false],
    [{ ...academicTerms, success: false }, false],
  ]) {
    const f = fixture();
    let probes = 0;
    f.handler = async url => { if (url.includes('kfdxnxqcx') && probes++ === 0) return response(url, body); };
    const login = f.learning.login();
    await authorize(f); await initialize(f);
    assert.equal(await login, valid);
    assert.equal(f.calls.some(call => call.url.includes('/api/login')), valid, 'only a valid academic response may continue to LNT');
    assert.equal(f.learning.getSnapshot().authenticated, valid);
    if (!valid) assert.match(f.learning.getSnapshot().message, /教务会话验证失败/);
  }
});
test('login failures identify their stage without logging credentials or external error text', async () => {
  const cases = [
    ['native', 'UNEXPECTED', /登录组件/], ['pkce', 'UNEXPECTED', /登录准备/],
    ['authorize', 'INVALID_CALLBACK', /统一认证/], ['token', 'INVALID_TOKEN', /授权验证/],
    ['academic', 'NETWORK', /教务登录页面/], ['academic-probe', 'INVALID_ACADEMIC_SESSION', /教务会话/],
    ['lnt', 'HTTP_ERROR', /LNT 登录/], ['flush', 'COOKIE_STORAGE', /登录状态保存/],
    ['network', 'NETWORK', /授权验证/],
  ];
  for (const [stage, code, message] of cases) {
    const f = fixture();
    f.cookieUnavailable = stage === 'native'; f.failCrypto = stage === 'pkce'; f.failFlush = stage === 'flush';
    f.handler = async url => {
      if (url.endsWith('/token') && stage === 'network') throw Error('https://secret.test/?code=private-code&token=private-token');
      if (url.endsWith('/token') && stage === 'token') return response(url, {});
      if (url.includes('kfdxnxqcx') && stage === 'academic-probe') return response(url, {});
      if (url.includes('/api/login') && stage === 'lnt') return response(url, {}, 503);
    };
    const login = f.learning.login();
    if (stage === 'authorize') {
      await tick(); f.schoolBrowser.navigating(f.schoolBrowser.getSnapshot(), CALLBACK + '&code=private-code&state=wrong');
    } else if (!['native', 'pkce'].includes(stage)) {
      await authorize(f);
      if (stage === 'academic') f.schoolBrowser.fail(f.schoolBrowser.getSnapshot(), 'NETWORK', { nativeCode: -2 });
      else if (['academic-probe', 'lnt', 'flush'].includes(stage)) await initialize(f);
    }
    assert.equal(await login, false);
    assert.match(f.learning.getSnapshot().message, message, stage);
    const diagnostic = JSON.parse(JSON.stringify(f.logs.at(-1)));
    assert.deepEqual(diagnostic, ['warn', '[school-login]', {
      stage: stage === 'network' ? 'token' : stage, code,
      ...(stage === 'academic' ? { nativeCode: -2 } : {}), ...(stage === 'lnt' ? { httpStatus: 503 } : {}),
    }]);
    assert.doesNotMatch(JSON.stringify(f.logs), /private-|https?:|single-code|access-token|test-session|001234/);
    assert.equal(f.learning.getSnapshot().authenticated, false);
  }
});
test('cookie flush failure never replaces the original login failure or cancellation', async () => {
  for (const cancelled of [false, true]) {
    const f = fixture(); f.failFlush = true;
    f.handler = async url => { if (url.endsWith('/token')) return response(url, {}, 503); };
    const failed = f.schoolDevice.authenticate().catch(error => error);
    if (cancelled) { await tick(); f.schoolBrowser.cancel(); }
    else await authorize(f);
    const error = await failed;
    assert.equal(error.code, cancelled ? 'CANCELLED' : 'HTTP_ERROR');
    assert.equal(error.loginStage, cancelled ? 'authorize' : 'token');
    assert.deepEqual(JSON.parse(JSON.stringify(f.logs.at(-1))), ['warn', '[school-login]', {
      stage: 'flush', code: 'COOKIE_STORAGE', secondary: true,
    }]);
  }
});
test('callback validation is centralized and stale pages cannot complete a later login', async () => {
  const browser = createSchoolBrowser();
  const valid = CALLBACK + '&code=single-code&state=test-state';
  for (const value of [valid + '#fragment', valid + '&code=duplicate', valid + '&state=test-state', valid + '&_h5=false',
    CALLBACK + '&code=value&state=wrong', CALLBACK + '&state=test-state']) {
    const pending = browser.authenticate(authorization);
    const rejected = assert.rejects(pending, { code: 'INVALID_CALLBACK' });
    const page = browser.getSnapshot();
    assert.equal(browser.navigating(page, 'https://c-mobile.xmu.edu.cn/home?code=x'), false);
    assert.equal(browser.navigating(page, value), true);
    await rejected;
  }
  const first = browser.authenticate(authorization), old = browser.getSnapshot();
  const cancelled = assert.rejects(first, { code: 'CANCELLED' }); browser.cancel(); await cancelled;
  const next = browser.authenticate(authorization), page = browser.getSnapshot();
  browser.navigating(old, valid); browser.fail(old, 'NETWORK');
  assert.equal(browser.getSnapshot(), page);
  browser.navigating(page, valid); assert.equal(await next, 'single-code');
  for (const url of ['http://lnt.xmu.edu.cn/', 'https://lnt.xmu.edu.cn.evil.test/', 'https://evil.test@lnt.xmu.edu.cn/', 'https://lnt.xmu.edu.cn:8443/']) {
    assert.equal(schoolUrl(url), false);
    await assert.rejects(browser.authenticate(url), { code: 'UNTRUSTED_LINK' });
  }
});
test('failed file replacement keeps the old cache and removes temporary data', async () => {
  const f = fixture(new Map([['school-learning.json', 'previous']]));
  f.failMove = true;
  await assert.rejects(f.schoolDevice.save('replacement'));
  assert.equal(await f.schoolDevice.load(), 'previous');
  assert.equal(f.files.has('school-learning.tmp'), false);
  f.failMove = false; await f.schoolDevice.save('replacement');
  assert.equal(await f.schoolDevice.load(), 'replacement');
});
test('cookie library failures remain visible and failed logout can be retried', async () => {
  const missing = fixture(); missing.cookieUnavailable = true;
  assert.equal(missing.cookieLoads, 0, 'importing school code does not load a native-only dependency');
  assert.equal(await missing.learning.login(), false);
  assert.equal(missing.calls.length, 0);
  assert.equal(missing.schoolBrowser.getSnapshot(), null);
  assert.equal(await missing.learning.logout(), false);
  assert.equal(missing.files.get('school-logout'), 'pending');
  missing.cookieUnavailable = false;
  assert.equal(await missing.learning.logout(), true);
  assert.equal(missing.cookies.size, 0); assert.equal(missing.files.size, 0);
});

test('authentication or cookie failure keeps login retry available and preserves cached data', async () => {
  const saved = JSON.stringify({ version: 1, account: { lntId: 42, studentNumber: '001234', name: '测试同学' }, todos: [todo], todosAt: 1000 });
  for (const cached of [false, true]) for (const phase of ['token', 'flush']) {
    const f = fixture(cached ? new Map([['school-learning.json', saved]]) : undefined), app = pages(f);
    await f.learning.restore(); app.render();
    f.failFlush = phase === 'flush';
    f.handler = async url => phase === 'token' && url.endsWith('/token') ? response(url, {}, 503) : undefined;
    let authorized = 0;
    const login = f.learning.login(() => authorized++);
    await authorize(f); if (phase === 'flush') await initialize(f);
    assert.equal(await login, false);
    assert.equal(authorized, 0);
    const failed = app.render();
    assert.equal(failed.data.authenticated, false);
    assert.equal(failed.data.needsLogin, true);
    assert.equal(failed.state.loggedIn, cached, 'cached content stays visible without granting a new session');
    assert.deepEqual(failed.data.todos, cached ? [todo] : []);
    assert.equal(f.files.get('school-learning.json'), cached ? saved : undefined);
    if (phase === 'flush') assert.equal(failed.data.message, '登录状态保存失败，请重新登录');
    assert.equal(f.calls.some(call => call.url.endsWith('/profile')), false);
    const requestCount = f.calls.length, flushCount = f.cookieCalls.length;
    failed.refresh(); await tick();
    assert.equal(await f.learning.refresh(), false);
    assert.equal(f.calls.length, requestCount, 'ordinary refresh cannot bypass an unfinished login');
    assert.equal(f.cookieCalls.length, flushCount);
    app.render();
    const retry = app.loginButton('profile'); assert.ok(retry); assert.equal(retry.props.busy, false);
    f.failFlush = false; f.handler = null;
    const retried = retry.props.onPress(); await authorize(f); await initialize(f);
    assert.equal(await retried, true);
    assert.equal(f.cookieCalls.length, flushCount + 1, 'explicit login retries cookie saving');
    assert.equal(app.render().data.authenticated, true);
    assert.equal(app.loginButton('profile'), undefined);
    assert.deepEqual(app.navigations, []);
  }
});

test('ordinary LNT failures and academic expiry do not start browser recovery', async () => {
  for (const kind of ['academic', 'redirect', 'html', 'json', 'server', 'network']) {
    const f = fixture();
    f.handler = async url => {
      if (kind === 'network') throw Error('network');
      return kind === 'academic' ? response(url, {}, 401)
        : kind === 'redirect' ? response('https://lnt.xmu.edu.cn/maintenance', {})
        : kind === 'html' ? response(url, '<html>gateway</html>', 200, 'text/html')
        : kind === 'json' ? response(url, '{broken') : response(url, {}, 503);
    };
    await assert.rejects(f.schoolDevice.read(kind === 'academic' ? 'jwTerms' : 'todos'), {
      code: kind === 'academic' ? 'AUTH_REQUIRED' : kind === 'server' ? 'HTTP_ERROR' : kind === 'network' ? 'NETWORK' : 'INVALID_RESPONSE',
    });
    assert.equal(f.schoolBrowser.getSnapshot(), null);
    assert.equal(f.calls.length, 1);
  }
});

test('realm errors, broad login markup, and resource 403 keep their original failure feedback', async () => {
  const realm = IDENTITY.replace('/protocol/openid-connect', '');
  for (const [target, body, status, contentType, code] of [
    [realm + '/login-actions/authenticate', '<html>missing</html>', 404, 'text/html', 'HTTP_ERROR'],
    [realm + '/login-actions/authenticate', 'limited', 429, 'text/plain', 'HTTP_ERROR'],
    [realm + '/account', '<form>maintenance</form>', 200, 'text/html', 'INVALID_RESPONSE'],
    ['https://ids.xmu.edu.cn/authserver/login', {}, 200, 'application/json', 'INVALID_RESPONSE'],
    ['https://ids.xmu.edu.cn/authserver/login', '<form>maintenance</form>', 200, 'text/html', 'INVALID_RESPONSE'],
    [null, '<form><input id="pwdEncryptSalt"></form>', 200, 'text/html', 'INVALID_RESPONSE'],
    [null, {}, 403, 'application/json', 'HTTP_ERROR'],
  ]) {
    const f = fixture();
    f.handler = async url => response(target ?? url, body, status, contentType);
    const pending = assert.rejects(f.schoolDevice.read('todos', undefined, recoveryAccount), {
      code, ...(code === 'HTTP_ERROR' ? { httpStatus: status } : {}),
    });
    void pending.catch(() => {});
    await tick();
    const page = f.schoolBrowser.getSnapshot();
    if (page) f.schoolBrowser.close();
    assert.equal(page, null, `${status} ${target ?? 'LNT endpoint'}`);
    await pending;
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.cookieCalls, []);
  }
});

test('a failed shared recovery stays failed for a late school login redirect and keeps the saved session', async () => {
  const f = fixture(new Map([['school-learning.json', 'previous']])), late = deferred();
  f.handler = async url => {
    if (url.includes('/todos')) return response(url, {}, 401);
    await late.promise;
    return response('https://ids.xmu.edu.cn/authserver/login', '<form><input id="pwdEncryptSalt"></form>', 200, 'text/html');
  };
  const first = assert.rejects(f.schoolDevice.read('todos', undefined, recoveryAccount), { code: 'NETWORK' });
  const second = assert.rejects(f.schoolDevice.read('rollcalls', undefined, recoveryAccount), { code: 'NETWORK' });
  await tick();
  f.schoolBrowser.fail(f.schoolBrowser.getSnapshot(), 'NETWORK');
  await first;
  late.resolve();
  await second;
  assert.equal(f.schoolBrowser.getSnapshot(), null);
  assert.equal(f.calls.length, 2);
  assert.equal(await f.schoolDevice.load(), 'previous');
  assert.equal(f.cookies.get('sso'), 'test-session');
  assert.deepEqual(f.cookieCalls, []);
});

test('recovery requires an authenticated profile and successful Cookie persistence before replay', async () => {
  for (const phase of ['unauthorized', 'invalid profile', 'cookie failure']) {
    const f = fixture();
    f.failFlush = phase === 'cookie failure';
    f.handler = async url => url.includes('/todos') || phase === 'unauthorized' ? response(url, {}, 401)
      : phase === 'invalid profile' ? response(url, { id: 42, user_no: {} }) : undefined;
    const rejected = assert.rejects(f.schoolDevice.read('todos', undefined, recoveryAccount), {
      code: phase === 'unauthorized' ? 'AUTH_REQUIRED' : phase === 'invalid profile' ? 'INVALID_RESPONSE' : 'COOKIE_STORAGE',
    });
    await tick();
    const page = f.schoolBrowser.getSnapshot();
    deliverRecoveryLanding(f, page, 'https://lnt.xmu.edu.cn.evil.test/user/index#/');
    assert.equal(f.schoolBrowser.getSnapshot(), page);
    deliverRecoveryLanding(f, page);
    await rejected;
    assert.equal(f.calls.length, 2);
    assert.equal(f.schoolBrowser.getSnapshot(), null);
    assert.deepEqual(f.cookieCalls, phase === 'cookie failure' ? ['flush'] : []);
    assert.equal(f.cookies.get('sso'), 'test-session');
  }
});

test('the full recovery deadline covers the page, session probe, and Cookie flush', async () => {
  for (const phase of ['page', 'probe', 'flush']) {
    const timers = new Map(), gate = deferred();
    const raw = JSON.stringify({ version: 1, account: { lntId: 42, studentNumber: '001234', name: '缓存账号' }, todos: [todo], todosAt: 1000 });
    const f = fixture(new Map([['school-learning.json', raw]]), {
      setTimeout(fn, delay) { const key = Symbol(); timers.set(key, { fn, delay }); return key; },
      clearTimeout(key) { timers.delete(key); },
    });
    let profileReads = 0;
    f.handler = async url => {
      if (!url.endsWith('/profile')) return;
      if (profileReads++ === 0) return response(url, {}, 401);
      if (phase === 'probe') await gate.promise;
    };
    if (phase === 'flush') f.flushGate = gate;
    await f.learning.restore();
    const refresh = f.learning.refresh();
    await tick();
    if (phase !== 'page') {
      deliverRecoveryLanding(f, f.schoolBrowser.getSnapshot());
      await tick();
    }
    const [deadline] = timers.values();
    assert.equal(deadline.delay, 30_000);
    assert.equal(f.learning.getSnapshot().refreshing, true);
    deadline.fn();
    assert.equal(await refresh, false, phase);
    assert.equal(f.learning.getSnapshot().needsLogin, true);
    assert.equal(f.schoolBrowser.getSnapshot(), null);
    assert.equal(await f.schoolDevice.load(), raw);
    assert.equal(f.cookies.get('sso'), 'test-session');
    if (phase === 'probe') assert.equal(f.calls[1].options.signal.aborted, true);
    if (phase === 'flush') {
      f.handler = async url => url.includes('/todos') ? response(url, {}, 401) : undefined;
      await assert.rejects(f.schoolDevice.read('todos', undefined, recoveryAccount), { code: 'AUTH_REQUIRED' });
    }
    gate.resolve();
    await tick();
    assert.equal(profileReads, phase === 'page' ? 1 : 2, 'no late replay');
    assert.deepEqual(f.cookieCalls, phase === 'flush' ? ['flush'] : []);
    assert.equal(timers.size, 0);
    if (phase === 'flush') {
      let expired = true;
      f.handler = async url => {
        if (url.includes('/todos') && expired) { expired = false; return response(url, {}, 401); }
      };
      const next = f.schoolDevice.read('todos', undefined, recoveryAccount);
      void next.catch(() => {});
      await tick();
      const page = f.schoolBrowser.getSnapshot();
      assert.equal(page?.kind, 'recovery');
      deliverRecoveryLanding(f, page);
      assert.deepEqual((await next).todo_list, [todo]);
    }
  }
});

test('logout closes hidden recovery and drains the browser, probe, or Cookie flush before clearing', async () => {
  for (const phase of ['page', 'probe', 'flush']) {
    const f = fixture(new Map([['school-learning.json', 'previous']])), gate = deferred();
    f.handler = async url => {
      if (url.includes('/todos')) return response(url, {}, 401);
      if (phase === 'probe') await gate.promise;
    };
    if (phase === 'flush') f.flushGate = gate;
    const rejected = assert.rejects(f.schoolDevice.read('todos', undefined, recoveryAccount), { code: 'CANCELLED' });
    await tick();
    const page = f.schoolBrowser.getSnapshot();
    assert.equal(page?.kind, 'recovery');
    const detach = phase === 'page' ? f.schoolBrowser.attach(page) : null;
    if (!detach) {
      deliverRecoveryLanding(f, page);
      await tick();
    }
    const logout = f.learning.logout();
    await rejected;
    assert.equal(f.schoolBrowser.getSnapshot(), null);
    assert.equal(f.cookieCalls.includes('clearAllStores'), false);
    if (phase === 'probe') assert.equal(f.calls[1].options.signal.aborted, true);
    deliverRecoveryLanding(f, page);
    detach?.();
    gate.resolve();
    assert.equal(await logout, true);
    assert.deepEqual(f.cookieCalls, phase === 'flush' ? ['flush', 'clearAllStores'] : ['clearAllStores']);
    assert.equal(f.cookies.size, 0);
    assert.equal(f.files.size, 0);
    assert.equal(f.calls.length, phase === 'page' ? 1 : 2);
    assert.equal(f.learning.getSnapshot().authenticated, false);
  }
});

test('activity reads and number PUT reuse school sessions, exact ids, string codes and UUID device ids', async () => {
  const f = fixture();
  const activity = { rollcall_id: 'school-81', course_id: 301, course_title: '真实字段模拟活动', is_number: true };
  f.handler = async (url, options) => url.endsWith('/radar/rollcalls') ? response(url, { rollcalls: [activity] })
    : options.method === 'PUT' ? response(url, { success: true, message: '学校已记录签到' }) : undefined;
  assert.deepEqual(await f.schoolDevice.read('rollcalls'), { rollcalls: [activity] });
  const receipt = await f.schoolDevice.answerNumber('school-81', '0007');
  assert.equal(receipt.result, 'success'); assert.equal(receipt.message, '学校已记录签到');
  const call = f.calls[1], body = JSON.parse(call.options.body);
  assert.equal(call.url, 'https://lnt.xmu.edu.cn/api/rollcall/school-81/answer_number_rollcall');
  assert.equal(call.options.method, 'PUT');
  assert.equal(call.options.headers['Content-Type'], 'application/json');
  assert.equal(body.numberCode, '0007');
  assert.match(body.deviceId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(Object.keys(body).sort(), ['deviceId', 'numberCode']);
  assert.equal(f.logs.length, 0); assert.equal(f.files.size, 0);
});

test('number PUT uses the uncertain-result fallback for unconfirmed responses and never retries a write', async () => {
  for (const [status, body, expected] of [
    [200, '', 'success'], [200, { success: false }, 'failed'], [200, { error: true }, 'failed'],
    [422, {}, 'failed'], [403, {}, 'failed'],
    [409, { is_expired: true, message: '签到已结束' }, 'ended'], [503, { message: '响应说明' }, 'failed'],
  ]) {
    const f = fixture(); f.handler = async url => response(url, body, status);
    const receipt = await f.schoolDevice.answerNumber('81', '0206');
    assert.equal(receipt.result, expected);
    if (expected === 'failed') assert.match(receipt.message, /^提交结果未知，请核实本人记录/);
    if (body.message) assert.ok(receipt.message.includes(body.message));
    assert.equal(f.calls.length, 1);
  }
  const f = fixture(); f.handler = async () => { throw Error('cookie=private-cookie'); };
  await assert.rejects(f.schoolDevice.answerNumber('81', '0206'), { code: 'NETWORK' });
  assert.equal(f.calls.length, 1); assert.equal(f.logs.length, 0);
});

test('location PUT keeps all actual coordinates, nullable fields and the current activity without persisting them', async () => {
  const f = fixture();
  f.handler = async url => response(url, { success: true, message: '学校确认定位签到' });
  const receipt = await f.schoolDevice.submitLocation('location/82', {
    latitude: 24.441, longitude: 118.103, accuracy: 7, altitude: null, altitudeAccuracy: null, heading: 0, speed: 0,
    timestamp: 1000, mocked: false,
  });
  assert.equal(receipt.result, 'success'); assert.equal(receipt.message, '学校确认定位签到');
  const call = f.calls[0], { deviceId, ...position } = JSON.parse(call.options.body);
  assert.equal(call.url, 'https://lnt.xmu.edu.cn/api/rollcall/location%2F82/answer');
  assert.equal(call.options.method, 'PUT');
  assert.equal(call.options.headers['Content-Type'], 'application/json');
  assert.deepEqual(position, { latitude: 24.441, longitude: 118.103, accuracy: 7, altitude: null, altitudeAccuracy: null, heading: 0, speed: 0 });
  assert.match(deviceId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(f.calls.length, 1); assert.equal(f.logs.length, 0); assert.equal(f.files.size, 0);
});

test('location requests reject invalid device coordinates and preserve school expiry or uncertain feedback', async () => {
  const position = { latitude: 24.441, longitude: 118.103, accuracy: 7, altitude: null, altitudeAccuracy: null, heading: 0, speed: 0 };
  const invalid = fixture();
  for (const value of [null, {}, { ...position, latitude: 91 }, { ...position, longitude: -181 },
    { ...position, latitude: '24.441' }, { ...position, accuracy: NaN }, { ...position, altitude: Infinity }, { ...position, speed: undefined }]) {
    await assert.rejects(invalid.schoolDevice.submitLocation('82', value), { code: 'INVALID_ATTENDANCE' });
  }
  await assert.rejects(invalid.schoolDevice.submitLocation('', position), { code: 'INVALID_ATTENDANCE' });
  assert.equal(invalid.calls.length, 0);
  for (const [status, body, expected] of [[409, { is_expired: true, message: '学校确认结束' }, 'ended'], [200, { success: false }, 'failed']]) {
    const f = fixture(); f.handler = async url => response(url, body, status);
    const receipt = await f.schoolDevice.submitLocation('82', position);
    assert.equal(receipt.result, expected);
    if (expected === 'failed') assert.match(receipt.message, /提交结果未知/);
    assert.equal(f.calls.length, 1); assert.equal(f.logs.length, 0);
  }
});

test('number requests reject invalid input, login pages and malformed receipts', async () => {
  const invalid = fixture();
  for (const [id, code] of [['', '0206'], ['81', '206'], ['81', 206], ['81', 'abcd']]) {
    await assert.rejects(invalid.schoolDevice.answerNumber(id, code), { code: 'INVALID_ATTENDANCE' });
  }
  assert.equal(invalid.calls.length, 0);
  for (const [kind, code] of [['401', 'AUTH_REQUIRED'], ['redirect', 'AUTH_REQUIRED'], ['html', 'AUTH_REQUIRED'], ['json', 'INVALID_RESPONSE']]) {
    const f = fixture();
    f.handler = async url => kind === '401' ? response(url, {}, 401)
      : kind === 'redirect' ? response('https://ids.xmu.edu.cn/authserver/login', {})
      : kind === 'html' ? response(url, '<html>login</html>', 200, 'text/html') : response(url, '{broken');
    await assert.rejects(f.schoolDevice.answerNumber('81', '0206'), { code });
    assert.equal(f.calls.length, 1); assert.equal(f.logs.length, 0);
  }
});

test('QR PUT preserves opaque data, shares the session and only accepts HTTP 200 with on_call', async () => {
  for (const [status, body, expected] of [
    [200, { status: 'on_call' }, 'success'], [200, { success: true }, 'failed'],
    [201, { status: 'on_call' }, 'failed'], [409, { error_code: 'qr_code_expired' }, 'failed'],
    [200, '', 'failed'], [200, { status: 'absent' }, 'failed'], [503, { status: 'on_call' }, 'failed'],
  ]) {
    const f = fixture(); f.handler = async url => response(url, body, status);
    const receipt = await f.schoolDevice.submitQr('qr/83', '  opaque+/=%25\n码  ');
    assert.equal(receipt.result, expected);
    const call = f.calls[0], payload = JSON.parse(call.options.body);
    assert.equal(call.url, 'https://lnt.xmu.edu.cn/api/rollcall/qr%2F83/answer_qr_rollcall');
    assert.equal(call.options.method, 'PUT');
    assert.deepEqual(Object.keys(payload).sort(), ['data', 'deviceId']);
    assert.equal(payload.data, '  opaque+/=%25\n码  ');
    assert.match(payload.deviceId, /^[0-9a-f-]{36}$/);
    assert.equal(f.calls.length, 1); assert.equal(f.logs.length, 0); assert.equal(f.files.size, 0);
  }
  for (const [kind, code] of [['401', 'AUTH_REQUIRED'], ['redirect', 'AUTH_REQUIRED'], ['html', 'AUTH_REQUIRED'], ['json', 'INVALID_RESPONSE']]) {
    const f = fixture();
    f.handler = async url => kind === '401' ? response(url, {}, 401)
      : kind === 'redirect' ? response('https://ids.xmu.edu.cn/authserver/login', {})
      : kind === 'html' ? response(url, '<html>login</html>', 200, 'text/html') : response(url, '{broken');
    await assert.rejects(f.schoolDevice.submitQr('83', { opaque: [' x ', 7] }), { code });
    assert.equal(f.calls.length, 1); assert.equal(f.logs.length, 0);
  }
});
test('logout drains late requests before removing both sessions; pending logout survives reopen', async () => {
  const f = fixture(), gate = deferred();
  f.handler = async url => { if (url.endsWith('/token')) { await gate.promise; f.cookies.set('late', 'late-session'); return response(url, { access_token: 'late-token' }); } };
  const login = f.learning.login();
  await authorize(f);
  const logout = f.learning.logout(); await tick();
  assert.equal(f.calls[0].options.signal.aborted, true);
  assert.equal(f.cookieCalls.includes('clearAllStores'), false, 'cookie removal follows the last possible Set-Cookie response');
  gate.resolve(); assert.equal(await login, false); assert.equal(await logout, true);
  assert.equal(f.files.size, 0);
  assert.equal(f.cookies.size, 0, 'a late response cannot restore cookies after logout');
  assert.equal(f.schoolBrowser.getSnapshot(), null);
  assert.equal(f.calls.length, 1);
  for (const failed of ['failClear', 'failDelete']) {
    const broken = fixture(new Map([['school-learning.json', 'private']])); broken[failed] = true;
    await assert.rejects(broken.schoolDevice.clear(), { code: 'CLEANUP_FAILED' });
    assert.equal(broken.files.get('school-logout'), 'pending');
    assert.equal(broken.cookieCalls.includes('clearAllStores'), true, 'file errors do not skip session removal');
    await assert.rejects(broken.schoolDevice.authenticate(), { code: 'CLEANUP_REQUIRED' });
    const reopened = fixture(broken.files);
    assert.equal(await reopened.schoolDevice.load(), null);
    assert.equal(reopened.files.size, 0);
    assert.deepEqual(reopened.cookieCalls, ['clearAllStores']);
    assert.equal(reopened.cookies.size, 0);
  }
});
// Execute the Provider and page callbacks with native rendering/effects replaced.
function pages(f, previewMode = false, trialCache = null, development = true) {
  let context, cursor = 0;
  let preview = demoState.demoReducer(demoState.initialState(), { type: 'scenario', scenario: 'signed-out' });
  const slots = [], navigations = [], focusEffects = [], effects = [];
  const todayEffects = [], todayFocusEffects = [];
  const todoClock = { now: Date.now(), timer: null, listener: null };
  class TodoDate extends Date {
    constructor(...args) { super(...(args.length ? args : [todoClock.now])); }
    static now() { return todoClock.now; }
  }
  const todayClock = { now: Date.now(), timer: null, listener: null };
  class TodayDate extends Date {
    constructor(...args) { super(...(args.length ? args : [todayClock.now])); }
    static now() { return todayClock.now; }
  }
  const react = { ...React, useEffect: effect => effects.push(effect), useMemo: factory => factory(), useCallback: callback => callback,
    useReducer: () => [preview, event => { preview = demoState.demoReducer(preview, event); }],
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    useRef: value => slots[cursor++] ??= { current: value },
    useState(value) {
      const slot = slots[cursor++] ??= { value: typeof value === 'function' ? value() : value };
      return [slot.value, next => { slot.value = next; }];
    },
  };
  const native = { AppState: { addEventListener(_event, listener) {
    todayClock.listener = listener;
    return { remove() { todayClock.listener = null; } };
  } }, Platform: { OS: 'android' }, View: 'View', Text: 'Text', ScrollView: 'ScrollView', Switch: 'Switch',
    AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() {} }) },
    StyleSheet: { create: value => value }, useWindowDimensions: () => ({ width: 400 }) };
  const provider = loadModule('../src/demo-context.tsx', {
    react, 'react-native': { ...native, AppState: { addEventListener(_event, listener) {
      todoClock.listener = listener;
      return { remove() { todoClock.listener = null; } };
    } } }, './demo-state': demoState, './demo-data': demoData,
    './schedule': scheduleModule, './learning': { createLearning: () => f.learning, historyView, todoView }, './school-device': f,
    './qr.ts': qrModule, './location-attendance.ts': locationModule,
    './attendance-trial': { createAttendanceTrial }, './attendance-trial-device': { attendanceTrialDevice: {
      now: Date.now, load: async () => trialCache, save: async () => {}, stop: async () => {},
    } },
  }, { Date: TodoDate,
    setTimeout(callback, delay) { todoClock.timer = { callback, delay }; return todoClock.timer; },
    clearTimeout(timer) { if (todoClock.timer === timer) todoClock.timer = null; },
    __DEV__: development, process: { env: { EXPO_PUBLIC_PREVIEW: previewMode ? '1' : undefined } } });
  const demo = { useDemo: () => context };
  let scrollConfig, drag, nativeScroll;
  const shared = value => ({ get: () => value, set: next => { value = next; } });
  const pageScroll = loadModule('../src/page-scroll.tsx', {
    react: { ...react, useContext: () => scrollConfig }, 'react-native': native, './demo-context': demo, './demo-data': demoData,
    'react-native-reanimated': { __esModule: true, default: { View: 'View', ScrollView: 'ScrollView' },
      Easing: { bezier: () => null }, useSharedValue: shared, useAnimatedScrollHandler: handlers => { nativeScroll = handlers; return handlers; },
      useAnimatedStyle: factory => factory(), withSpring: value => value, withTiming: value => value },
    'react-native-gesture-handler': { GestureDetector: 'GestureDetector', useNativeGesture: () => ({}),
      usePanGesture: handlers => { drag = handlers; return handlers; }, useSimultaneousGestures: () => ({}) },
    'react-native-worklets': { scheduleOnRN: callback => callback() },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
  });
  const router = Object.fromEntries(['push', 'back', 'navigate', 'replace', 'dismissTo'].map(name => [name, value => navigations.push([name, value])]));
  const ui = loadModule('../src/ui.tsx', {
    react, 'react-native': native, './demo-context': demo, 'expo-router': { router },
    'react-native-reanimated': { __esModule: true, default: { View: 'AnimatedView' },
      useSharedValue: shared, useAnimatedStyle: factory => factory() },
    '@expo/vector-icons': {}, 'expo-blur': { BlurView: 'BlurView' }, 'expo-linear-gradient': {},
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0 }) }, './press-guard': {},
    './page-scroll': pageScroll, './status-motion': {},
  });
  const todayCard = loadModule('../src/today-course-card.tsx', { 'react-native': native, './demo-context': demo, './demo-data': demoData, './ui': ui });
  const pageMocks = { react, 'react-native': native, 'expo-router': { router, useFocusEffect: callback => focusEffects.push(callback) }, '@/demo-context': demo,
    '@/demo-state': demoState, '@/demo-data': demoData, '@/schedule': scheduleModule, '@/ui': ui,
    '@/today-course-card': todayCard };
  function todayMemo(factory, deps) {
    const index = cursor++, slot = slots[index];
    if (!slot || deps.some((value, position) => !Object.is(value, slot.deps[position]))) {
      slots[index] = { deps, value: factory() };
    }
    return slots[index].value;
  }
  const today = loadModule('../app/(tabs)/index.tsx', { ...pageMocks,
    react: { ...react, useCallback: (callback, deps) => todayMemo(() => callback, deps),
      useEffect: (effect, deps) => todayMemo(() => todayEffects.push(effect), deps) },
    'expo-router': { router, useFocusEffect: callback => todayFocusEffects.push(callback) },
  }, {
    Date: TodayDate,
    setTimeout(callback, delay) { todayClock.timer = { callback, delay }; return todayClock.timer; },
    clearTimeout(timer) { if (todayClock.timer === timer) todayClock.timer = null; },
  });
  function renderToday() {
    cursor = 50; todayFocusEffects.length = 0;
    const page = today.default();
    todayEffects.splice(0).forEach(effect => effect());
    return page;
  }
  const profilePage = loadModule('../app/(tabs)/profile.tsx', pageMocks);
  const historyPage = loadModule('../app/history.tsx', { ...pageMocks, '@/swipe-pages': { SwipePages: 'SwipePages' } });
  const settingsPage = loadModule('../app/settings.tsx', { ...pageMocks, react, '@/style-options': styleOptions });
  const learningMocks = { 'react-native': native, 'expo-router': { router }, './demo-context': demo,
    './demo-data': demoData, './ui': ui };
  const courseList = loadModule('../src/course-list.tsx', learningMocks);
  const learningPage = loadModule('../src/learning-screen.tsx', { ...learningMocks,
    './course-list': courseList, './style-options': styleOptions, './swipe-pages': { SwipePages: 'SwipePages' } });
  const params = { id: '3' };
  const courseDetail = loadModule('../app/course.tsx', { ...pageMocks,
    'expo-router': { router, useLocalSearchParams: () => params } });
  const schedulePage = loadModule('../app/(tabs)/schedule.tsx', { ...pageMocks, react,
    'expo-router': { router, useFocusEffect() {} }, '@/style-options': styleOptions, '@/swipe-pages': { SwipePages: 'SwipePages' } });
  const conflictsPage = loadModule('../app/conflicts.tsx', { ...pageMocks, 'expo-router': { router, useLocalSearchParams: () => params } });
  function expand(node) {
    if (!React.isValidElement(node)) return node;
    if (typeof node.type === 'function' && !Object.values(ui).includes(node.type)) return expand(node.type(node.props));
    return React.cloneElement(node, undefined, ...React.Children.toArray(node.props.children).map(expand));
  }
  function find(node, predicate) {
    if (!node || typeof node !== 'object') return;
    if (predicate(node.props)) return node;
    for (const child of React.Children.toArray(node.props?.children)) {
      const match = find(child, predicate); if (match) return match;
    }
  }
  function screen(page) {
    const root = page === 'today' ? renderToday() : page === 'schedule' ? schedulePage.default()
      : page === 'learning' ? learningPage.LearningScreen() : profilePage.default();
    const screen = root.type(root.props);
    return screen.type(screen.props);
  }
  return {
    navigations, find, todoClock, todayClock,
    focusToday() { const cleanups = todayFocusEffects.map(effect => effect()); return () => cleanups.forEach(cleanup => cleanup?.()); },
    historyPage() { cursor = 30; return historyPage.default(); },
    focusHistory() { focusEffects.at(-1)?.(); },
    pageTree(screen) { const page = screen.type(screen.props); return page.type(page.props); },
    historyContents(index) { cursor = 30; const screen = historyPage.default(); const swipe = find(screen, props => props?.max === 1); const block = swipe.props.children(index); return block.type(block.props); },
    pull(config) { scrollConfig = config; pageScroll.PageScroll({ children: null }); assert.equal(drag.enabled, true); nativeScroll.onScroll({ contentOffset: { y: 0 } }); drag.onBegin(); drag.onUpdate({ translationY: 200 }); drag.onDeactivate({ canceled: false }); drag.onFinalize(); },
    runStartupEffects: () => effects.splice(0).map(effect => effect()),
    pullToRefresh(page) { this.pull(find(screen(page), props => props?.value?.pull && props.value.rotation).props.value); },
    learningPage: () => learningPage.LearningScreen(),
    settings: () => settingsPage.default(),
    courseList: (preview = false) => courseList.CourseList({ preview }),
    courseDetail: (id, session, week) => { Object.assign(params, { id, session, week }); return courseDetail.default(); },
    today: () => renderToday(),
    schedulePage: () => schedulePage.default(),
    weekGrid: week => { const page = schedulePage.default(); const pager = find(page, props => typeof props?.children === 'function'); return expand(pager.props.children(week)); },
    conflicts: (session, week) => { Object.assign(params, { session, week }); return conflictsPage.default(); },
    render() { cursor = 0; context = provider.DemoProvider({ children: null }).props.value; return context; },
    loginButton(page) {
      const tree = page === 'today' ? renderToday() : page === 'profile' ? profilePage.default()
        : ui.ResourceBlock({ resource: page, children: null, emptyTitle: '暂无数据' });
      return find(tree, props => props?.label === '学校统一登录' || props?.action === '学校统一登录');
    },
    refreshButton(page = 'profile') { return find(screen(page), props => props?.label?.includes('同步')); },
    attendanceEntry(title) {
      return find(renderToday(), props => props?.label?.startsWith(title + '，') && props.label.endsWith('去签到'));
    },
  };
}

test('every login button opens the WebView directly; cancellation stays on the caller and refresh recovers first data failures', async () => {
  for (const [page, failure] of [['today', 'profile'], ['profile', 'todos'], ['lnt', 'save'], ['jw', 'todos']]) {
    const f = fixture(), app = pages(f); app.render();
    const cancelled = app.loginButton(page).props.onPress(); await tick();
    assert.equal(f.schoolBrowser.getSnapshot().kind, 'authorize');
    f.schoolBrowser.cancel(); assert.equal(await cancelled, false);
    assert.equal(app.render().state.loggedIn, false);
    assert.deepEqual(app.navigations, []);
    if (failure === 'save') f.failWrite = true;
    else f.handler = async url => url.includes('/' + failure) ? response(url, {}, 503) : undefined;
    const login = app.loginButton(page).props.onPress();
    await authorize(f); await initialize(f); assert.equal(await login, false);
    const failed = app.render();
    assert.equal(failed.state.loggedIn, true, 'authentication is visible even before the first saved account');
    assert.equal(failed.data.account, null); assert.equal(failed.data.needsLogin, false);
    assert.equal(app.loginButton('profile'), undefined);
    assert.equal(f.schoolBrowser.getSnapshot(), null);
    const refresh = app.refreshButton(); assert.ok(refresh); assert.equal(refresh.props.disabled, false);
    f.handler = null; f.failWrite = false;
    refresh.props.onPress(); await tick();
    assert.equal(app.render().data.account.studentNumber, '001234');
    assert.equal(f.calls.filter(call => call.url.includes('/api/login')).length, 1, 'refresh does not authenticate again');
    assert.deepEqual(app.navigations, [], 'completion never adds or pops an intermediate route');
    assert.equal(await f.learning.logout(), true); assert.equal(app.render().state.loggedIn, false);
  }
  assert.equal(existsSync(new URL('../app/login.tsx', import.meta.url)), false);
  assert.doesNotMatch(readFileSync(new URL('../app/_layout.tsx', import.meta.url), 'utf8'), /name="login"/);
});

test('signed-out home shows only local trial activities and removes one after its simulated receipt sheet closes', async () => {
  const f = fixture(), id = 'trial-100-1';
  const app = pages(f, false, JSON.stringify({ version: 1, logs: [], events: [
    { id, method: 'number', outcome: 'success', availableAt: 100, discoveredAt: 101, notifiedAt: 101 },
  ] }));
  await app.render().trial.restore();
  let context = app.render();
  assert.equal(context.state.loggedIn, false);
  assert.equal(context.data.account, null);
  assert.ok(app.loginButton('today'), 'school data remains behind login');
  const entry = app.attendanceEntry('模拟签到活动');
  assert.ok(entry, 'a local trial remains visible without a school session');
  assert.equal(app.find(app.today(), props => props?.style?.marginBottom === 22).props.style.marginTop, 22);
  entry.props.onPress();
  assert.equal(app.navigations[0][0], 'push');
  assert.equal(app.navigations[0][1].pathname, '/attendance');
  assert.equal(app.navigations[0][1].params.id, id);
  assert.equal((await context.submitNumber(id, '0206')).result, 'success');
  context = app.render();
  assert.ok(app.attendanceEntry('模拟签到活动'));
  context.dispatch({ type: 'attendance-dismissed', ids: [id] }); app.render();
  assert.equal(app.attendanceEntry('模拟签到活动'), undefined);
  assert.equal(f.calls.length, 0, 'the home/receipt flow never calls a school API');
});

test('local trial entries preserve the logged-in homepage empty-data state before and after completion', async () => {
  const id = 'trial-100-1';
  const saved = JSON.stringify({ version: 1, account: { lntId: 42, studentNumber: '001234', name: '测试同学' }, todos: [], todosAt: 1000 });
  const f = fixture(new Map([['school-learning.json', saved]]));
  const app = pages(f, false, JSON.stringify({ version: 1, logs: [], events: [
    { id, method: 'number', outcome: 'success', availableAt: 100, discoveredAt: 101, notifiedAt: 101 },
  ] }));
  await f.learning.restore();
  assert.equal(app.render().state.load, 'empty');
  await app.render().trial.restore();
  const context = app.render();
  assert.equal(context.state.loggedIn, true);
  assert.equal(context.state.load, 'empty', 'local activities cannot change the school-data layout state');
  assert.equal(app.find(app.today(), props => props?.style?.marginBottom === 22).props.style.marginTop, 22);
  assert.ok(app.attendanceEntry('模拟签到活动'));
  await context.submitNumber(id, '0206');
  context.dispatch({ type: 'attendance-dismissed', ids: [id] });
  assert.equal(app.render().state.load, 'empty');
  assert.equal(app.attendanceEntry('模拟签到活动'), undefined);
  assert.equal(f.calls.length, 0);
});

test('direct preview login restores demo data without school requests or route changes', async () => {
  const f = fixture(), app = pages(f, true);
  assert.equal(app.render().state.loggedIn, false);
  assert.equal(await app.loginButton('profile').props.onPress(), true);
  assert.equal(app.render().state.loggedIn, true);
  assert.equal(f.schoolBrowser.getSnapshot(), null);
  assert.equal(f.calls.length, 0); assert.deepEqual(app.navigations, []);
  assert.equal(f.cookieLoads, 0, 'preview login never imports the native cookie library');
});

test('the real homepage refresh renders separate school activities and opens each exact id without fixture course lookup', async () => {
  const saved = JSON.stringify({ version: 1, account: { lntId: 42, studentNumber: '001234', name: '测试同学' }, todos: [], todosAt: 1000 });
  const f = fixture(new Map([['school-learning.json', saved]])), app = pages(f);
  await f.learning.restore(); app.render();
  f.handler = async url => url.endsWith('/radar/rollcalls') ? response(url, { rollcalls: [
    { rollcall_id: 81, course_id: 301, course_title: '学校数字码活动', is_number: true },
    { rollcall_id: 82, course_id: 301, course_title: '学校二维码活动' },
    { rollcall_id: 83, course_id: 302, course_name: '学校定位活动', is_radar: true },
  ] }) : url.includes('/todos') ? response(url, { todo_list: [] }) : undefined;
  app.refreshButton().props.onPress(); await tick();
  const context = app.render();
  assert.equal(context.state.load, 'ready');
  for (const [title, id] of [['学校数字码活动', '81'], ['学校二维码活动', '82'], ['学校定位活动', '83']]) {
    const entry = app.attendanceEntry(title); assert.ok(entry);
    entry.props.onPress();
    assert.equal(app.navigations.at(-1)[1].pathname, '/attendance');
    assert.equal(app.navigations.at(-1)[1].params.id, id);
  }
});

function browserHost(f) {
  const disposed = [], effects = [], probes = [];
  const pageRef = { injectJavaScript: script => probes.push(script), stopLoading: () => disposed.push('stop'), clearHistory: () => disposed.push('history'),
    clearFormData: () => disposed.push('form'), clearCache: () => disposed.push('cache') };
  const host = loadModule('../src/school-browser-view.tsx', {
    react: { ...React, useRef: value => ({ current: value === null ? pageRef : value }),
      useLayoutEffect: effect => effects.push(effect()), useSyncExternalStore: (_subscribe, snapshot) => snapshot() },
    'react-native': { Modal: 'Modal', View: 'View', Text: 'Text', ActivityIndicator: 'ActivityIndicator' },
    'react-native-webview': { __esModule: true, default: 'WebView' },
    './school-device': f, './school-browser': browserModule,
  }, { console: f.console });
  return { ...host, disposed, probes, detach: () => effects.splice(0).forEach(dispose => dispose()) };
}

test('Android synthetic finish before a main-frame load error cannot complete recovery', async () => {
  const f = fixture(), host = browserHost(f);
  f.handler = async url => response(url, {}, 401);
  const pending = assert.rejects(f.schoolDevice.read('todos', undefined, recoveryAccount), { code: 'NETWORK' });
  void pending.catch(() => {});
  await tick();
  const page = host.SchoolBrowserHost().props.children, web = page.type(page.props);
  const navigation = androidNavigation('https://lnt.xmu.edu.cn/user/index#/');
  web.props.onLoadStart({ nativeEvent: navigation });
  web.props.onLoadEnd({ nativeEvent: navigation });
  assert.deepEqual(host.probes, []);
  web.props.onError({ nativeEvent: { ...navigation, code: -2 } });
  host.detach();
  await pending;
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.cookieCalls, []);
});

test('legacy Android messages require a current top-document signal before recovery can proceed', async () => {
  const f = fixture(), host = browserHost(f);
  const landingUrl = 'https://lnt.xmu.edu.cn/user/index#/';
  const loginUrl = 'https://ids.xmu.edu.cn/authserver/login?service=school';
  let attempts = 0;
  f.handler = async url => url.includes('/todos') && attempts++ < 2 ? response(url, {}, 401) : undefined;
  const expired = assert.rejects(f.schoolDevice.read('todos', undefined, recoveryAccount), { code: 'NETWORK' });
  const mount = async () => {
    await tick();
    const page = host.SchoolBrowserHost().props.children;
    return page.type(page.props).props;
  };
  const first = await mount();
  function documentAt(web, url, mainFrame = true, readyState = 'complete') {
    const messages = [];
    const location = new URL(url);
    const window = { ReactNativeWebView: { postMessage: value => messages.push(value) } };
    window.top = mainFrame ? window : {};
    const form = { action: loginUrl, querySelector: () => ({}), querySelectorAll: () => [{ getClientRects: () => [{}] }] };
    const document = { readyState, forms: [form] };
    const evaluate = script => runInNewContext(script, { location, window, URL, document, crypto: webcrypto, getComputedStyle: () => ({ visibility: 'visible' }) });
    evaluate(web.injectedJavaScript);
    return { messages, evaluate };
  }
  first.onLoadStart({ nativeEvent: androidNavigation(landingUrl) });
  const previousLanding = documentAt(first, landingUrl).messages[0];
  first.onError({ nativeEvent: { ...androidNavigation(landingUrl), code: -2 } });
  host.detach();
  await expired;

  const pending = f.schoolDevice.read('todos', undefined, recoveryAccount);
  void pending.catch(() => {});
  const web = await mount();
  const send = (data, url) => web.onMessage({ nativeEvent: { data, url } });
  try {
    web.onLoadStart({ nativeEvent: androidNavigation(loginUrl) });
    send('school-interaction-required', loginUrl);
    assert.equal(f.schoolBrowser.getSnapshot()?.kind, 'recovery', 'legacy bridge reports the top URL even for a subframe message');
    assert.deepEqual(documentAt(web, loginUrl, false).messages, []);
    const [interaction] = documentAt(web, loginUrl).messages;
    assert.equal(typeof interaction, 'string');
    web.onLoadStart({ nativeEvent: androidNavigation(landingUrl) });
    const oldDocument = documentAt(web, landingUrl);
    const [beforeReload] = oldDocument.messages;
    send(beforeReload, landingUrl);
    assert.equal(host.probes.length, 1);
    oldDocument.evaluate(host.probes.shift());
    const oldConfirmation = oldDocument.messages[1];
    assert.equal(typeof oldConfirmation, 'string');
    web.onLoadStart({ nativeEvent: androidNavigation(landingUrl) });
    const currentDocument = documentAt(web, landingUrl);
    const [landing] = currentDocument.messages;
    assert.equal(typeof landing, 'string');
    assert.notEqual(landing, previousLanding);
    assert.deepEqual(documentAt(web, landingUrl, true, 'loading').messages, []);
    send(previousLanding, landingUrl);
    send(interaction, new URL(landingUrl).origin);
    send(landing, 'https://lnt.xmu.edu.cn/app-redirect');
    assert.equal(f.schoolBrowser.getSnapshot()?.kind, 'recovery');
    assert.deepEqual(host.probes, []);
    send(oldConfirmation, landingUrl);
    assert.equal(f.schoolBrowser.getSnapshot()?.kind, 'recovery', 'a reply queued before the reload cannot settle it');
    send(beforeReload, landingUrl);
    assert.equal(f.schoolBrowser.getSnapshot()?.kind, 'recovery', 'a same-URL reload invalidates the previous document report');
    assert.equal(host.probes.length, 1);
    currentDocument.evaluate(host.probes.shift());
    assert.deepEqual(currentDocument.messages, [landing], 'the replacement document cannot confirm the old report');
    send(landing, landingUrl);
    assert.equal(host.probes.length, 1);
    currentDocument.evaluate(host.probes.shift());
    send(currentDocument.messages[1], new URL(landingUrl).origin);
    assert.equal(f.schoolBrowser.getSnapshot(), null);
  } finally {
    f.schoolBrowser.close();
    host.detach();
    await pending.catch(() => {});
  }
  assert.deepEqual((await pending).todo_list, [todo]);
  assert.deepEqual(f.cookieCalls, ['flush']);
});

test('hidden recovery preserves official navigation and hands the recognized login form back to manual login', async () => {
  const f = fixture(), host = browserHost(f);
  f.handler = async url => url.includes('/todos') ? response(url, {}, 401) : undefined;
  const pending = assert.rejects(f.schoolDevice.read('todos', undefined, recoveryAccount), { code: 'AUTH_REQUIRED' });
  await tick();
  const hidden = host.SchoolBrowserHost();
  assert.equal(hidden.type, 'View');
  assert.equal(hidden.props.pointerEvents, 'none');
  assert.equal(hidden.props.importantForAccessibility, 'no-hide-descendants');
  const page = hidden.props.children, web = page.type(page.props);
  assert.equal(web.props.source.uri, 'https://lnt.xmu.edu.cn/');
  assert.equal(web.props.onShouldStartLoadWithRequest({ url: 'https://lnt.xmu.edu.cn/app-redirect' }), true);
  assert.equal(web.props.onShouldStartLoadWithRequest({ url: 'https://evil.test/app-redirect' }), false);
  const loginUrl = 'https://ids.xmu.edu.cn/authserver/login?service=school';
  web.props.onLoadStart({ nativeEvent: androidNavigation(loginUrl) });
  web.props.onLoadEnd({ nativeEvent: androidNavigation(loginUrl) });
  const messages = [], location = new URL(loginUrl);
  let loginForm = [];
  const form = { action: loginUrl, querySelector: () => ({}), querySelectorAll: () => loginForm };
  const window = { ReactNativeWebView: { postMessage: value => messages.push(value) } };
  window.top = window;
  const globals = { location, document: { readyState: 'complete', forms: [form] }, window, crypto: webcrypto,
    getComputedStyle: () => ({ visibility: 'visible' }), URL };
  runInNewContext(web.props.injectedJavaScript, globals);
  assert.deepEqual(messages, [], 'passing through the identity URL alone does not require interaction');
  loginForm = [{ getClientRects: () => [{}] }];
  runInNewContext(web.props.injectedJavaScript, globals);
  assert.equal(messages.length, 1);
  web.props.onMessage({ nativeEvent: { data: messages[0], url: 'https://evil.test' } });
  assert.equal(f.schoolBrowser.getSnapshot(), page.props.request);
  web.props.onMessage({ nativeEvent: { data: messages[0], url: location.origin } });
  assert.equal(host.probes.length, 1);
  runInNewContext(host.probes.shift(), globals);
  assert.equal(messages.length, 2);
  web.props.onMessage({ nativeEvent: { data: messages[1], url: location.origin } });
  assert.equal(host.SchoolBrowserHost(), null);
  host.detach();
  await pending;
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.cookieCalls, []);
  const retry = f.schoolDevice.authenticate();
  await tick();
  assert.equal(host.SchoolBrowserHost().type, 'Modal');
  f.schoolBrowser.cancel();
  await assert.rejects(retry, { code: 'CANCELLED' });
});

test('one modal stays open across both pages, token exchange, LNT login and cookie persistence', async () => {
  const f = fixture(), host = browserHost(f), token = deferred(), lnt = deferred();
  let authorized = 0;
  f.flushGate = deferred();
  const states = [];
  f.schoolBrowser.subscribe(() => states.push(f.schoolBrowser.getSnapshot()?.kind ?? null));
  f.handler = async url => {
    if (url.endsWith('/token')) await token.promise;
    if (url.includes('/api/login')) await lnt.promise;
  };
  const login = f.learning.login(() => authorized++); await tick();
  const renderModal = () => {
    const node = host.SchoolBrowserHost();
    return typeof node?.type === 'function' ? node.type(node.props) : node;
  };
  const modal = renderModal();
  assert.equal(modal.type, 'Modal');
  const page = modal.props.children, web = typeof page.type === 'function' ? page.type(page.props) : page;
  const state = new URL(web.props.source.uri).searchParams.get('state');
  web.props.onLoadStart({ nativeEvent: androidNavigation(CALLBACK + '&code=value&state=' + state) });
  const waiting = renderModal();
  assert.ok(waiting, 'finishing the first page must not reveal the main screen');
  assert.equal(waiting.type, modal.type); assert.equal(waiting.key, modal.key);
  assert.equal(f.schoolBrowser.getSnapshot().kind, 'pending');
  assert.equal(f.calls.length, 0, 'the old WebView is disposed before API work');
  host.detach(); await tick();
  assert.equal(f.calls.length, 1);
  assert.equal(host.SchoolBrowserHost().type, modal.type);
  token.resolve(); await tick();
  const academicModal = host.SchoolBrowserHost();
  assert.equal(academicModal.type, modal.type); assert.equal(academicModal.key, modal.key);
  const academic = academicModal.props.children, academicWeb = academic.type(academic.props);
  assert.equal(academicWeb.props.source.uri, JW_APP);
  academicWeb.props.onLoadEnd({ nativeEvent: androidNavigation(academicPage) });
  assert.equal(host.SchoolBrowserHost().type, modal.type);
  host.detach(); await tick();
  assert.equal(f.learning.getSnapshot().authenticated, false);
  assert.equal(f.schoolBrowser.getSnapshot().kind, 'pending');
  lnt.resolve(); await tick();
  assert.equal(f.learning.getSnapshot().authenticated, false);
  assert.equal(authorized, 0, 'success waits for cookie saving');
  assert.equal(f.calls.some(call => call.url.endsWith('/profile')), false);
  assert.equal(host.SchoolBrowserHost().type, modal.type, 'cookie persistence stays inside the same modal');
  f.flushGate.resolve(); assert.equal(await login, true);
  assert.equal(authorized, 1);
  assert.equal(f.learning.getSnapshot().authenticated, true);
  assert.equal(host.SchoolBrowserHost(), null);
  assert.deepEqual(states, ['authorize', 'pending', 'academic', 'pending', null]);
  assert.deepEqual(host.disposed, ['stop', 'history', 'form', 'cache', 'stop', 'history', 'form', 'cache']);
});

test('cancelling between pages aborts requests and cannot reopen the modal or publish late data', async () => {
  const f = fixture(), gate = deferred();
  f.handler = async url => { if (url.endsWith('/token')) await gate.promise; };
  const login = f.learning.login(); await authorize(f);
  assert.equal(f.schoolBrowser.getSnapshot()?.kind, 'pending');
  f.schoolBrowser.cancel();
  assert.equal(f.schoolBrowser.getSnapshot(), null);
  assert.equal(f.calls[0].options.signal.aborted, true);
  gate.resolve(); assert.equal(await login, false);
  assert.match(f.learning.getSnapshot().message, /已取消/);
  assert.equal(f.learning.getSnapshot().authenticated, false);
  assert.equal(f.calls.length, 1); assert.equal(f.files.size, 0);
  assert.equal(f.schoolBrowser.getSnapshot(), null);

  for (const failFlush of [false, true]) {
    const flushing = fixture(); flushing.flushGate = deferred(); flushing.failFlush = failFlush;
    let authorized = 0;
    const finishing = flushing.learning.login(() => authorized++); await authorize(flushing); await initialize(flushing);
    assert.deepEqual(flushing.cookieCalls, ['flush']);
    flushing.schoolBrowser.cancel(); flushing.flushGate.resolve();
    assert.equal(await finishing, false);
    assert.equal(authorized, 0);
    assert.equal(flushing.learning.getSnapshot().authenticated, false);
    assert.equal(flushing.learning.getSnapshot().message, '已取消学校登录');
    assert.equal(flushing.calls.some(call => call.url.endsWith('/profile')), false);
    assert.equal(flushing.files.size, 0);
    assert.equal(flushing.schoolBrowser.getSnapshot(), null);
    if (failFlush) assert.deepEqual(JSON.parse(JSON.stringify(flushing.logs.at(-1))), ['warn', '[school-login]', { stage: 'flush', code: 'COOKIE_STORAGE' }]);
  }
});

test('mounted login WebView restricts navigation, clears its instance, and keeps the modal until completion', async () => {
  const f = fixture(), host = browserHost(f);
  const auth = f.schoolBrowser.authenticate(authorization);
  const modal = host.SchoolBrowserHost(), component = modal.props.children, web = component.type(component.props);
  assert.equal(web.props.source.uri, authorization);
  assert.equal(web.props.userAgent, undefined);
  assert.equal(web.props.cacheEnabled, false);
  assert.equal(web.props.sharedCookiesEnabled, true);
  assert.equal(web.props.webviewDebuggingEnabled, false);
  assert.equal(web.props.startInLoadingState, true);
  const loadingComponent = web.props.renderLoading(), loading = loadingComponent.type(loadingComponent.props);
  assert.equal(loading.props.children[1].props.children, '正在打开学校登录页面');
  assert.equal(loading.props.children[1].props.accessibilityLiveRegion, 'polite');
  assert.equal(web.props.onShouldStartLoadWithRequest({ url: 'https://evil.test/' }), false);
  assert.equal(web.props.onShouldStartLoadWithRequest({ url: 'https://ids.xmu.edu.cn/authserver/login' }), true);
  for (const fields of [{ lockIdentifier: 1 }, { navigationType: 'other', isTopFrame: true }]) {
    for (const query of ['&code=value&state=test-state', '&code=value&state=wrong', '&error=access_denied&state=test-state']) {
      assert.equal(web.props.onShouldStartLoadWithRequest({ ...androidNavigation(CALLBACK + query), ...fields }), true);
      assert.equal(f.schoolBrowser.getSnapshot().kind, 'authorize', 'neither Android request shape may complete or cancel login');
    }
  }
  web.props.onLoadStart({ nativeEvent: androidNavigation(CALLBACK + '&code=value&state=test-state') });
  let settled = false; void auth.then(() => { settled = true; }); await tick();
  assert.equal(settled, false, 'cleanup waits until the login page actually unmounts');
  assert.equal(host.SchoolBrowserHost().type, 'Modal');
  host.detach();
  assert.equal(await auth, 'value'); assert.deepEqual(host.disposed, ['stop', 'history', 'form', 'cache']);
  const invalid = f.schoolBrowser.authenticate(authorization);
  const invalidRejected = assert.rejects(invalid, { code: 'INVALID_CALLBACK' });
  const invalidPage = host.SchoolBrowserHost().props.children;
  invalidPage.type(invalidPage.props).props.onLoadStart({ nativeEvent: androidNavigation(CALLBACK + '&code=value&state=wrong') });
  host.detach();
  await invalidRejected;
  const interrupted = f.schoolBrowser.authenticate(authorization);
  const rejected = assert.rejects(interrupted, { code: 'WEBVIEW_PROCESS_GONE' });
  const next = host.SchoolBrowserHost().props.children; next.type(next.props).props.onRenderProcessGone();
  host.detach();
  await rejected; assert.equal(host.SchoolBrowserHost(), null);
  for (const kind of ['native', 'http']) {
    const pending = f.schoolBrowser.authenticate(authorization);
    const failure = assert.rejects(pending, kind === 'native' ? { code: 'NETWORK', nativeCode: -2 } : { code: 'HTTP_ERROR', httpStatus: 502 });
    const component = host.SchoolBrowserHost().props.children, web = component.type(component.props);
    const nativeEvent = { ...androidNavigation(authorization), code: -2, statusCode: 502, description: 'private-token' };
    if (kind === 'native') web.props.onError({ nativeEvent });
    else {
      web.props.onHttpError({ nativeEvent: { ...nativeEvent, url: 'https://lnt.xmu.edu.cn/favicon.ico' } });
      assert.notEqual(f.schoolBrowser.getSnapshot(), null, 'subresource HTTP errors do not abort login');
      web.props.onHttpError({ nativeEvent });
    }
    host.detach(); await failure;
  }
  assert.ok(f.logs.some(([, tag, detail]) => tag === '[school-browser]' && detail.page === 'authorize' && detail.event === 'open'));
  assert.ok(f.logs.some(([, tag, detail]) => tag === '[school-browser]' && detail.event === 'close'));
  assert.doesNotMatch(JSON.stringify(f.logs), /https?:|private-token|test-state|code=value/);
});

test('course and week requests use the existing session and reject invalid term parameters before sending', async () => {
  const f = fixture();
  for (const jwTermCode of [undefined, '', '2026-1', '20261&XH=other', 'https://example.invalid']) {
    await assert.rejects(f.schoolDevice.read('jwWeek', jwTermCode === undefined ? undefined : { jwTermCode }), { code: 'INVALID_TERM' });
  }
  assert.equal(f.calls.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(await f.schoolDevice.read('courses', { semesterId: 9 }))), { courses: [course] });
  assert.deepEqual(await f.schoolDevice.read('jwWeek', { jwTermCode: '20261' }), academicWeeks);
  assert.equal(f.calls[0].url, 'https://lnt.xmu.edu.cn/api/my-courses');
  assert.equal(f.calls[1].url, 'https://jw.xmu.edu.cn/gsapp/sys/wdkbapp/wdkcb/getZcxx.do?XNXQDM=20261');
  assert.equal(f.calls.every(call => call.options.credentials === 'include'), true);
  assert.equal(f.schoolBrowser.getSnapshot(), null);
});

test('learning tabs use independent school collections, preserve switching, and open real course details', async () => {
  for (const hasCourses of [true, false]) {
    const f = fixture(), app = pages(f); app.render();
    f.handler = async url => url.includes('/my-courses') ? response(url, { courses: hasCourses ? [course] : [], pages: hasCourses ? 1 : 0, total: hasCourses ? 1 : 0 })
      : url.includes('/todos') ? response(url, { todo_list: hasCourses ? [] : [todo] }) : undefined;
    const login = f.learning.login(); await authorize(f); await initialize(f); assert.equal(await login, true);
    let context = app.render(), page = app.learningPage();
    assert.equal(context.data.schedule.currentWeek, 8);
    assert.doesNotMatch(JSON.stringify(page), /测试学期|第 \d+ 周/);
    const segments = app.find(page, props => props?.labels?.[0] === '作业');
    segments.props.onChange(1);
    context = app.render(); page = app.learningPage();
    assert.equal(context.state.learningPage, 1);
    assert.doesNotMatch(JSON.stringify(page), /测试学期|第 \d+ 周/);
    let pager = app.find(page, props => typeof props?.children === 'function');
    assert.equal(pager.props.index, 1);
    const courseBlock = pager.props.children(1), todoBlock = pager.props.children(0);
    assert.equal(courseBlock.props.resource, 'courses');
    const renderedCourses = courseBlock.type(courseBlock.props), renderedTodos = todoBlock.type(todoBlock.props);
    assert.equal(renderedCourses.props.title, hasCourses ? undefined : '暂无课程');
    assert.equal(renderedTodos.props.title, hasCourses ? '暂无作业' : undefined);
    assert.equal(context.todos.length, hasCourses ? 0 : 1);
    assert.equal(React.Children.toArray(app.courseList().props.children).length, hasCourses ? 1 : 0);
    if (hasCourses) {
      for (const value of ['grid', 'list']) {
        context.dispatch({ type: 'course-style', value }); app.render();
        const list = app.courseList();
        assert.match(JSON.stringify(list), /学校课程/);
        assert.doesNotMatch(JSON.stringify(list), /001-A|教学班代码/);
        assert.doesNotMatch(JSON.stringify(list), /设计思维与方法/);
        app.find(list, props => props?.label === '查看课程：学校课程').props.onPress();
        assert.deepEqual(JSON.parse(JSON.stringify(app.navigations.at(-1))), ['push', { pathname: '/course', params: { id: '3' } }]);
      }
      assert.equal(React.Children.toArray(app.courseList(true).props.children).length, 2, 'style preview retains its fixtures');
      const details = JSON.stringify(app.courseDetail('3'));
      assert.match(details, /学校课程/); assert.match(details, /测试学期/);
      assert.match(details, /上课时间/); assert.match(details, /请在周课表查看具体安排/);
      assert.doesNotMatch(details, /海韵|2026—2027|教学班代码|001-A|授课周/);
      assert.match(JSON.stringify(app.courseDetail('unknown')), /当前课程不可用/);
    }
    pager.props.onChange(0); context = app.render();
    assert.equal(context.state.learningPage, 0, 'the pager callback and segment callback keep one selection');
    await f.learning.logout(); app.render();
    page = app.learningPage(); pager = app.find(page, props => typeof props?.children === 'function');
    const loggedOut = pager.props.children(1);
    assert.equal(loggedOut.type(loggedOut.props).props.action, '学校统一登录');
    assert.doesNotMatch(JSON.stringify(app.courseDetail('3')), /001-A|学校课程/);
  }
});
test('timetable requests send the current term and own student number without a week filter', async () => {
  const f = fixture();
  await assert.rejects(f.schoolDevice.read('jwSchedule', { jwTermCode: 'invalid', studentNumber: '001234' }), { code: 'INVALID_TERM' });
  await f.schoolDevice.read('jwSchedule', { jwTermCode: '20261', studentNumber: '001234' });
  const request = f.calls.at(-1);
  assert.ok(request.url.endsWith('/queryXspkjg.do'));
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(request.options.body, 'XNXQDM=20261&XH=001234');
  assert.equal(new URLSearchParams(request.options.body).has('ZC'), false);
  assert.equal(f.calls.length, 1);
});

test('school timetable reaches today, selected weeks and conflict details through the provider', async () => {
  const f = fixture(), app = pages(f, false, JSON.stringify({ version: 1, logs: [], events: [
    { id: 'trial-100-1', method: 'number', outcome: 'success', availableAt: 100, discoveredAt: 101, notifiedAt: 101 },
  ] })); app.render();
  const morning = new Date(); morning.setHours(7, 30, 0, 0);
  const previousDay = new Date(morning); previousDay.setDate(previousDay.getDate() - 1); previousDay.setHours(23, 55);
  app.todayClock.now = previousDay.getTime();
  const weekday = (morning.getDay() + 6) % 7 + 1;
  const row = { WID: 'school-row', BJDM: '001-A', KCMC: '学校课程', JASMC: '学校教室 101', JSXM: '张老师', XQ: weekday, KSJCDM: 1, JSJCDM: 2, KSSJ: '0800', JSSJ: '0940', ZCMC: '8周', JCFADM: 'a' };
  f.handler = async url => url.includes('queryXspkjg.do') ? response(url, { success: true, pkjgList: [row, { ...row, WID: 'second-room', JASMC: '学校教室 102' }, { ...row, WID: 'overlap', BJDM: 'other-class', KCMC: '重叠课程', JSXM: '李老师', JASMC: '学校教室 202' }] })
    : url.includes('/todos') ? response(url, { todo_list: [] }) : undefined;
  const login = app.loginButton('today').props.onPress();
  app.todoClock.now = app.todayClock.now = morning.getTime();
  await authorize(f); await initialize(f); assert.equal(await login, true);
  await app.render().trial.restore();
  let context = app.render();
  assert.equal(context.state.load, 'empty', 'the timetable and local trial do not fabricate school todos');
  assert.equal(context.timetable.currentWeek, 8);
  assert.equal(context.state.week, 8);
  assert.equal(context.state.showWeekends, false);
  assert.equal(context.timetable.sessionsForWeek(8).length, 2);
  assert.match(JSON.stringify(app.courseList()), /张老师/);
  assert.doesNotMatch(JSON.stringify(app.courseList()), /001-A|教学班代码/);
  assert.doesNotMatch(JSON.stringify(app.schedulePage()), /测试学期|节次方案/);
  const today = app.today();
  assert.ok(app.attendanceEntry('模拟签到活动'));
  const attendanceGap = app.find(today, props => props?.style?.marginBottom === 22).props.style.marginTop;
  const carousel = app.find(today, props => props?.horizontal);
  assert.ok(carousel, 'the first timetable after login uses the new day');
  const courseGap = carousel.props.contentContainerStyle.paddingBottom;
  assert.equal(attendanceGap + courseGap, 22, 'real school courses retain their original separation even when ordinary load is empty');
  const card = app.find(today, props => props?.label === '查看学校课程课程详情');
  assert.ok(card, 'today displays school lessons even when there are no todos');
  const schoolBlock = app.find(today, props => props?.resource === 'jw' && props?.emptyTitle);
  assert.equal(schoolBlock.type(schoolBlock.props).props.title, undefined, 'the resource gate exposes school lessons');
  card.props.onPress();
  const route = app.navigations.at(-1)[1];
  assert.equal(route.pathname, '/course');
  const details = JSON.stringify(app.courseDetail(route.params.id, route.params.session, route.params.week));
  assert.match(details, /08:00 — 09:40/); assert.match(details, /学校教室 101、学校教室 102/); assert.match(details, /张老师/);
  assert.doesNotMatch(details, /教学班代码|001-A|授课周/);
  context.dispatch({ type: 'weekends', enabled: true }); context = app.render();
  const grid = app.weekGrid(8);
  const overlap = app.find(grid, props => props?.label?.includes('2门课程重叠'));
  assert.ok(overlap); overlap.props.onPress();
  const conflictRoute = app.navigations.at(-1)[1];
  assert.equal(conflictRoute.pathname, '/conflicts');
  const conflictList = app.conflicts(conflictRoute.params.session, 8);
  const other = app.find(conflictList, props => props?.label === '查看重叠课程课程详情');
  assert.ok(other); other.props.onPress();
  const otherRoute = app.navigations.at(-1)[1];
  const otherDetail = JSON.stringify(app.courseDetail(otherRoute.params.id, otherRoute.params.session, otherRoute.params.week));
  assert.match(otherDetail, /学校教室 202/); assert.match(otherDetail, /李老师/);
  context.dispatch({ type: 'week', week: 9 }); context = app.render();
  assert.equal(context.state.week, 9);
  assert.deepEqual(context.timetable.sessionsForWeek(9), []);
  const emptyGrid = app.weekGrid(9); assert.match(JSON.stringify(emptyGrid), /08:00/);
  assert.equal(app.find(emptyGrid, props => props?.label?.includes('课程重叠')), undefined);
});

test('course list details retain the original fields and linked teacher outside the selected week', async () => {
  const f = fixture(), app = pages(f); app.render();
  f.handler = async url => url.includes('queryXspkjg.do') ? response(url, { success: true, pkjgList: [
    { WID: 'odd-week', BJDM: '001-A', KCMC: '学校课程', JASMC: '学校教室 301', JSXM: '王老师', XQ: 2, KSJCDM: 1, JSJCDM: 1, KSSJ: '0800', JSSJ: '0845', ZCMC: '1-15周，单周', JCFADM: 'a' },
  ] }) : undefined;
  const login = f.learning.login(); await authorize(f); await initialize(f); assert.equal(await login, true);
  const context = app.render();
  assert.equal(context.data.schedule.rows.length, 1);
  assert.equal(context.timetable.sessionsForWeek(context.timetable.currentWeek).length, 0);
  const schoolBlock = app.find(app.today(), props => props?.resource === 'jw' && props?.emptyTitle);
  const empty = app.find(schoolBlock.type(schoolBlock.props), props => props?.title === '今天没有课程');
  assert.ok(empty, 'a lesson-free today shows the empty card when the term has schedule rows');
  const details = JSON.stringify(app.courseDetail('3'));
  assert.match(details, /请在周课表查看具体安排/);
  assert.doesNotMatch(details, /授课周|1-15周，单周|教学班代码|001-A/);
  assert.match(JSON.stringify(app.courseList()), /王老师/);
  assert.match(details, /学校教室 301/);
  assert.match(details, /王老师/);
});

test('history uses the course and profile ids at the school boundary with one request per course', async () => {
  const f = fixture();
  const history = { rollcalls: [{ rollcall_id: 11, rollcall_time: '2026-11-09T08:17:00Z', title: '课堂签到', student_status: 'on_call', status: 'on_call_fine', student_status_detail: null, is_number: true }] };
  f.handler = async url => /\/course\/\d+\/student\//.test(url) ? response(url, history) : undefined;
  const data = await f.schoolDevice.read('history', { courseId: 3, studentId: 42 });
  assert.deepEqual(data, history);
  assert.equal(f.calls[0].url, 'https://lnt.xmu.edu.cn/api/course/3/student/42/rollcalls?page=1&page_size=100');
  assert.equal(f.calls.length, 1);
  for (const params of [undefined, { courseId: '../4', studentId: 42 }, { courseId: 3, studentId: '42?other=1' }, { courseId: -1, studentId: 42 }]) {
    await assert.rejects(f.schoolDevice.read('history', params), { code: 'INVALID_HISTORY_QUERY' });
  }
  assert.equal(f.calls.length, 1, 'invalid identifiers never reach fetch');
});

test('history page entry, toolbar and pull context refresh history independently and render school results', async () => {
  const f = fixture();
  const login = f.learning.login(); await authorize(f); await initialize(f); assert.equal(await login, true);
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  f.handler = async url => url.includes('/rollcalls') ? response(url, { rollcalls: [
    { rollcall_id: 11, rollcall_time: demoData.historyDate(now) + 'T04:00:00Z', title: '本日课堂', student_status: 'on_call', status: 'on_call_fine', student_status_detail: '学校确认', is_number: true },
    { rollcall_id: 12, rollcall_time: demoData.historyDate(yesterday) + 'T04:00:00Z', title: '昨日课堂', student_status: 'absent', status: 'absent', student_status_detail: null, type: 'qr_rollcall' },
    { rollcall_id: 13, rollcall_time: '2026-11-09T00:17:00Z', title: '2026-11-09 08:17 课堂签到', student_status: 'on_call', status: 'on_call_fine', student_status_detail: null, is_number: true },
    { rollcall_id: 14, rollcall_time: '2026-09-09T00:07:00Z', title: '零点课堂', student_status: 'on_call', status: 'on_call_fine', student_status_detail: null, is_number: true },
    { rollcall_id: 15, rollcall_time: '2026-11-09T01:17:00Z', title: '2026-11-09 23:59 课堂签到', student_status: 'on_call', status: 'on_call_fine', student_status_detail: null, is_number: true },
  ] }) : undefined;
  const app = pages(f); app.render(); let screen = app.historyPage();
  f.calls.length = 0; app.focusHistory(); await tick(); app.render();
  assert.equal(f.calls.length, 1); assert.match(f.calls[0].url, /\/course\/3\/student\/42\/rollcalls/);
  screen = app.historyPage();
  let swipe = app.find(screen, props => props?.max === 1);
  const today = app.historyContents(0), all = app.historyContents(1);
  const text = tree => JSON.stringify(tree, (key, value) => key === '_owner' || typeof value === 'function' ? undefined : value);
  assert.doesNotMatch(text(all), /本日课堂|昨日课堂|2026-11-09 08:17 课堂签到|零点课堂|23:59/);
  assert.ok(app.find(today, props => props?.children === course.name), 'the card title is only the course name');
  assert.ok(app.find(all, props => React.Children.toArray(props?.children).join('') === '11月9日 8:17 数字签到'));
  assert.ok(app.find(all, props => React.Children.toArray(props?.children).join('') === '11月9日 9:17 数字签到'));
  assert.ok(app.find(all, props => React.Children.toArray(props?.children).join('') === '9月9日 8:07 数字签到'));
  assert.match(text(today), /已签到/); assert.match(text(today), /数字签到/); assert.match(text(today), /学校确认/);
  assert.doesNotMatch(text(today), /缺勤/); assert.match(text(all), /缺勤/); assert.match(text(all), /二维码签到/);
  const segments = app.find(screen, props => props?.labels?.includes('全部'));
  segments.props.onChange(1); assert.equal(app.find(app.historyPage(), props => props?.max === 1).props.index, 1);
  swipe.props.onChange(0); assert.equal(app.find(app.historyPage(), props => props?.max === 1).props.index, 0);
  const tree = app.pageTree(screen), button = app.find(tree, props => props?.label === '刷新历史签到');
  assert.ok(button); f.calls.length = 0; button.props.onPress(); await tick();
  assert.equal(f.calls.length, 1); assert.match(f.calls[0].url, /rollcalls/);
  const scroll = app.find(tree, props => props?.value?.refresh);
  assert.ok(scroll, 'pull-to-refresh receives the same history-specific action');
  f.calls.length = 0; app.pull(scroll.props.value); await tick();
  assert.equal(f.calls.length, 1); assert.match(f.calls[0].url, /rollcalls/);
  f.calls.length = 0; app.render(); app.refreshButton().props.onPress(); await tick();
  assert.equal(f.calls.some(call => /\/course\/\d+\/student\//.test(call.url)), false);
  assert.equal(f.calls.some(call => call.url.endsWith('/radar/rollcalls')), true);
});


test('settings timetable switch controls the real saved preference and preview stays local', async () => {
  for (const preview of [false, true]) {
    const raw = JSON.stringify({ version: 1, account: { lntId: 42, studentNumber: '001234', name: '测试同学' }, todos: [todo], todosAt: 1000 });
    const f = fixture(preview ? undefined : new Map([['school-learning.json', raw]]));
    if (!preview) await f.learning.restore();
    const app = pages(f, preview); app.render();
    const setting = () => app.find(app.settings(), props => props?.title === '刷新课表')?.props.trailing;
    assert.ok(setting(), 'settings exposes the timetable refresh switch');
    assert.equal(setting().props.value, false);
    setting().props.onValueChange(true); await tick();
    assert.equal(app.render().state.refreshSchedule, true);
    assert.equal(setting().props.value, true);
    if (preview) {
      assert.equal(f.files.size, 0);
      assert.equal(f.calls.length, 0);
    } else {
      assert.equal(JSON.parse(f.files.get('school-learning.json')).refreshSchedule, true);
      const reopened = fixture(f.files); await reopened.learning.restore();
      assert.equal(pages(reopened).render().state.refreshSchedule, true);
    }
  }
});


const ordinaryPaths = ['/api/my-courses', '/api/semesters', '/api/profile', '/api/radar/rollcalls', '/api/todos'];
const timetablePaths = ['/gsapp/sys/wdkbapp/modules/xskcb/kfdxnxqcx.do', '/gsapp/sys/wdkbapp/wdkcb/getZcxx.do', '/gsapp/sys/wdkbapp/wdkcb/queryXspkjg.do'];
test('every ordinary page header and pull callback uses the same setting-controlled batch and school todo previews', async () => {
  for (const enabled of [false, true]) {
    const raw = JSON.stringify({ version: 1, account: { lntId: 42, studentNumber: '001234', name: '测试同学' }, todos: [todo], todosAt: 1000, refreshSchedule: enabled });
    const f = fixture(new Map([['school-learning.json', raw]])); await f.learning.restore();
    const app = pages(f);
    const schoolTodos = [null, '2026-11-14T12:00:00Z', '2026-11-12T12:00:00Z', '2026-11-13T12:00:00Z']
      .map((end_time, index) => ({ ...todo, id: index + 1, title: '学校待办' + (index + 1), end_time, type: '学校类型', is_locked: true }));
    f.handler = async url => url.includes('/todos') ? response(url, { todo_list: schoolTodos }) : undefined;
    for (const page of ['today', 'schedule', 'learning', 'profile']) for (const entry of ['header', 'pull']) {
      app.render(); const start = f.calls.length;
      if (entry === 'header') app.refreshButton(page).props.onPress(); else app.pullToRefresh(page);
      assert.equal(f.learning.getSnapshot().refreshing, true, page + ':' + entry + ' starts the batch');
      assert.equal(await f.learning.refresh(), true);
      assert.deepEqual(f.calls.slice(start).map(call => new URL(call.url).pathname).sort(), [...ordinaryPaths, ...(enabled ? (page === 'today' && entry === 'header' ? timetablePaths : [timetablePaths[2]]) : [])].sort(), page + ':' + entry);
      assert.equal(app.render().todos.length, 4);
    }
    const preview = app.find(app.today(), props => Array.isArray(props?.children) && props.children.length === 3 && props.children.every(child => child?.props?.todo));
    assert.deepEqual(preview.props.children.map(child => child.props.todo.title), ['学校待办3', '学校待办4', '学校待办2']);
    const pager = app.find(app.learningPage(), props => typeof props?.children === 'function');
    const complete = app.find(pager.props.children(0), props => Array.isArray(props?.children) && props.children.length === 4 && props.children.every(child => child?.props?.todo));
    assert.deepEqual(complete.props.children.map(child => child.props.todo.title), ['学校待办3', '学校待办4', '学校待办2', '学校待办1']);
    assert.equal(complete.props.children[0].props.todo.type, '学校类型');
    assert.equal(complete.props.children[0].props.todo.locked, true);
  }
});

test('provider startup shows cache and makes exactly one ordinary refresh using the restored setting', async () => {
  for (const enabled of [false, true]) {
    const raw = JSON.stringify({ version: 1, account: { lntId: 42, studentNumber: '001234', name: '缓存账号' }, todos: [todo], todosAt: 1000, refreshSchedule: enabled });
    const f = fixture(new Map([['school-learning.json', raw]])), gate = deferred(), app = pages(f);
    f.handler = async url => { if (url.includes('/my-courses')) { await gate.promise; return response(url, { courses: [{ ...course, name: '启动刷新课程' }], pages: 1, total: 1 }); } };
    app.render(); app.runStartupEffects(); await tick();
    const cached = app.render();
    assert.equal(cached.data.account.name, '缓存账号');
    assert.equal(cached.data.todosAt, 1000);
    assert.equal(cached.refreshing, true);
    gate.resolve(); assert.equal(await f.learning.refresh(), true);
    assert.equal(app.render().data.courses[0].name, '启动刷新课程');
    assert.deepEqual(f.calls.map(call => new URL(call.url).pathname).sort(), [...ordinaryPaths, ...(enabled ? timetablePaths : [])].sort());
  }
});


test('release provider keeps school mode and debug selections with isolated trial receipts', async () => {
  const f = fixture(), id = 'trial-100-1';
  const app = pages(f, true, JSON.stringify({ version: 1, logs: [], events: [
    { id, method: 'number', outcome: 'success', availableAt: 100, discoveredAt: 101, notifiedAt: 101 },
  ] }), false);
  let context = app.render();
  assert.equal(context.real, true, 'a release APK cannot switch to mock school data through preview configuration');
  await context.trial.restore();
  context.dispatch({ type: 'method', method: 'qr' });
  context.dispatch({ type: 'outcome', outcome: 'ended' });
  context = app.render();
  assert.equal(context.state.method, 'qr');
  assert.equal(context.state.outcome, 'ended');
  assert.equal(context.state.loggedIn, false);
  assert.ok(context.isTrialRollcall(id));
  assert.equal((await context.submitNumber(id, '0206')).result, 'success');
  assert.equal(f.calls.length, 0, 'release trial submissions remain local');
});


test('today renders school course cards by starting section', async () => {
  const f = fixture(), app = pages(f); app.render();
  const now = new Date(); now.setHours(7, 30, 0, 0);
  app.todayClock.now = now.getTime();
  const weekday = (now.getDay() + 6) % 7 + 1;
  const rows = [
    { WID: 'section-2', BJDM: 'section-2', KCMC: '第二节课程', JASMC: '教室 2', JSXM: '张老师', XQ: weekday, KSJCDM: 2, JSJCDM: 2, KSSJ: '0800', JSSJ: '0845', ZCMC: '8周', JCFADM: 'a' },
    { WID: 'section-1', BJDM: 'section-1', KCMC: '第一节课程', JASMC: '教室 1', JSXM: '李老师', XQ: weekday, KSJCDM: 1, JSJCDM: 1, KSSJ: '1000', JSSJ: '1045', ZCMC: '8周', JCFADM: 'a' },
  ];
  f.handler = async url => url.includes('queryXspkjg.do') ? response(url, { success: true, pkjgList: rows }) : undefined;
  const login = f.learning.login(); await authorize(f); await initialize(f); assert.equal(await login, true);
  app.render();
  const carousel = app.find(app.today(), props => props?.horizontal);
  assert.deepEqual(React.Children.toArray(carousel.props.children).map(card => card.props.children.props.session.start), [0, 1]);
});

test('today shows the same empty card with no classes today or no timetable', async () => {
  const monday = new Date(2026, 10, 16, 9, 30).getTime();
  const tuesday = { WID: 'tuesday', BJDM: '001-A', KCMC: '周二课程', JASMC: '教室', JSXM: '张老师', XQ: 2, KSJCDM: 1, JSJCDM: 2, KSSJ: '0800', JSSJ: '0940', ZCMC: '8周', JCFADM: 'a' };
  for (const [scenario, rows] of [['classes on another day', [tuesday]], ['empty timetable', []], ['no timetable cache', null]]) {
    const raw = JSON.stringify({ version: 1, account: { lntId: 42, studentNumber: '001234', name: '缓存账号' }, todos: [todo], todosAt: monday,
      ...(rows && { schedule: { jwTermCode: '20261', name: '测试学期', currentWeek: 8, weeks: [8], weekAt: monday, rows }, scheduleAt: monday }) });
    const f = fixture(new Map([['school-learning.json', raw]]));
    await f.learning.restore();
    const app = pages(f);
    app.todoClock.now = app.todayClock.now = monday;
    const context = app.render();
    assert.equal(context.data.schedule?.rows.length ?? null, rows?.length ?? null, scenario);
    if (rows?.length) assert.equal(context.timetable.sessionsForWeek(8).length, 1, scenario);
    const courseBlock = app.find(app.today(), props => props?.resource === 'jw' && props?.emptyTitle);
    const courseArea = courseBlock.type(courseBlock.props);
    const card = app.find(courseArea, props => props?.title === '今天没有课程');
    assert.ok(card, scenario);
    const rendered = card.type(card.props);
    assert.ok(app.find(rendered, props => props?.accessibilityRole === 'header' && props.children === '今天没有课程'), scenario);
    assert.ok(app.find(rendered, props => props?.name === 'sunny-outline'), scenario);
    assert.equal(app.find(courseArea, props => props?.horizontal), undefined, scenario);
  }
});

test('today keeps the initial lesson until an ordinary refresh, then uses the cached timetable', async () => {
  const f = fixture(), app = pages(f); app.render();
  const now = new Date(); now.setHours(9, 30, 0, 0);
  app.todayClock.now = now.getTime();
  const times = [['0800', '0940'], ['1010', '1150']];
  const rows = times.map(([start, end], index) => ({ WID: 'today-' + index, BJDM: '001-A', KCMC: '学校课程', JASMC: '学校教室', JSXM: '张老师', XQ: (now.getDay() + 6) % 7 + 1, KSJCDM: index + 1, JSJCDM: index + 1, KSSJ: start, JSSJ: end, ZCMC: '8周', JCFADM: 'a' }));
  f.handler = async url => url.includes('queryXspkjg.do') ? response(url, { success: true, pkjgList: rows }) : undefined;
  const login = f.learning.login(); await authorize(f); await initialize(f); assert.equal(await login, true);
  app.todoClock.now = now.getTime();
  app.render(); app.runStartupEffects(); await tick(); app.render();
  const requests = f.calls.length, scrolls = [];
  const carousel = () => app.find(app.today(), props => props?.horizontal);
  let cards = carousel();
  cards.props.ref.current = { scrollTo: value => scrolls.push(value) };
  assert.equal(cards.props.contentContainerStyle.paddingHorizontal, 50, 'a 300px card is centered in a 400px viewport');
  cards.props.onContentSizeChange();
  assert.equal(scrolls.at(-1).x, 0);
  assert.equal(scrolls.at(-1).animated, false);
  const leave = app.focusToday();
  const initialScrolls = scrolls.length;
  now.setHours(9, 45, 0, 0); app.todoClock.now = app.todayClock.now = now.getTime();
  app.todayClock.timer?.callback();
  carousel();
  assert.equal(scrolls.at(-1).x, 0, 'time passing does not advance the initial card');
  leave(); app.focusToday();
  app.todoClock.listener('active');
  app.todayClock.listener?.('active');
  app.render(); carousel();
  assert.equal(scrolls.at(-1).x, 0, 'tab re-entry and foreground return keep the card');
  assert.equal(scrolls.length, initialScrolls, 'returning to the tab leaves horizontal browsing where it was');
  assert.equal(f.calls.length, requests, 'time, focus and resume do not query school services');

  app.refreshButton('today').props.onPress();
  assert.equal(f.learning.getSnapshot().refreshing, true);
  assert.equal(await f.learning.refresh(), true);
  app.render(); cards = carousel();
  assert.equal(scrolls.at(-1).x, 312, 'refresh centers the next lesson before it starts');
  cards.props.onLayout({ nativeEvent: { layout: { width: 700 } } });
  cards = carousel(); cards.props.onContentSizeChange();
  assert.equal(cards.props.contentContainerStyle.paddingHorizontal, 200, 'the selected card also centers in a wide viewport');
  now.setHours(11, 50, 0, 0); app.todoClock.now = app.todayClock.now = now.getTime();
  app.pullToRefresh('profile');
  assert.equal(f.learning.getSnapshot().refreshing, true);
  assert.equal(await f.learning.refresh(), true);
  app.render();
  const courseBlock = app.find(app.today(), props => props?.resource === 'jw' && props?.emptyTitle);
  const empty = app.find(courseBlock.type(courseBlock.props), props => props?.title === '今天没有课程');
  assert.ok(empty, 'refresh after the last lesson displays the empty card');
  assert.equal(carousel(), undefined);
  assert.deepEqual(f.calls.slice(requests).map(call => new URL(call.url).pathname).sort(), [...ordinaryPaths, ...ordinaryPaths].sort());
});

test('today advances the heading across days on resume and keeps the course card until refresh', async () => {
  const monday = new Date(2026, 10, 16, 9, 30).getTime();
  const row = { WID: 'monday', BJDM: '001-A', KCMC: '周一课程', JASMC: '教室', JSXM: '张老师', XQ: 1, KSJCDM: 1, JSJCDM: 2, KSSJ: '0800', JSSJ: '0940', ZCMC: '8周', JCFADM: 'a' };
  const raw = JSON.stringify({ version: 1, account: { lntId: 42, studentNumber: '001234', name: '缓存账号' }, todos: [todo], todosAt: monday,
    schedule: { jwTermCode: '20261', name: '测试学期', currentWeek: 8, weeks: [8], weekAt: monday, rows: [row] }, scheduleAt: monday });
  const f = fixture(new Map([['school-learning.json', raw]])), app = pages(f);
  app.todoClock.now = app.todayClock.now = monday;
  app.render(); app.runStartupEffects(); await tick(); await f.learning.refresh(); app.render();
  const carousel = page => app.find(page, props => props?.horizontal);
  const home = app.today(), scrolls = [];
  assert.equal(home.props.title, '11月16日 · 星期一');
  assert.ok(app.find(carousel(home), props => props?.label === '查看周一课程课程详情'));
  carousel(home).props.ref.current = { scrollTo: value => scrolls.push(value) };
  const requests = f.calls.length;

  app.todoClock.now = app.todayClock.now = new Date(2026, 10, 17, 9).getTime();
  app.todoClock.listener('active');
  app.render();
  const resumed = app.today();
  assert.equal(resumed.props.title, '11月17日 · 星期二');
  assert.ok(app.find(carousel(resumed), props => props?.label === '查看周一课程课程详情'));
  assert.deepEqual(scrolls, [], 'the date change does not recenter the carousel');
  assert.equal(f.calls.length, requests);
});

test('shared todo dates update at midnight and resume; missing deadlines leave no placeholder or separator', async () => {
  const items = [
    { ...todo, id: 1, end_time: new Date(2026, 10, 17, 18).toISOString() },
    { ...todo, id: 2, end_time: new Date(2026, 10, 18, 8, 5).toISOString() },
    { ...todo, id: 3 },
  ];
  const raw = JSON.stringify({ version: 1, account: { lntId: 42, studentNumber: '001234', name: '缓存账号' }, todos: items, todosAt: 1000 });
  const f = fixture(new Map([['school-learning.json', raw]]));
  await f.learning.restore();
  f.handler = async url => url.includes('/todos') ? response(url, { todo_list: items }) : undefined;
  const app = pages(f);
  app.todoClock.now = new Date(2026, 10, 15, 23, 59, 59).getTime();
  const context = app.render();
  assert.deepEqual(context.todos.map(item => item.deadline), ['后天 18:00', '11月18日 08:05', null]);
  const home = app.find(app.today(), props => Array.isArray(props?.children) && props.children.length === 3 && props.children.every(child => child?.props?.todo));
  const pager = app.find(app.learningPage(), props => typeof props?.children === 'function');
  const learning = app.find(pager.props.children(0), props => Array.isArray(props?.children) && props.children.length === 3 && props.children.every(child => child?.props?.todo));
  for (const rows of [home, learning]) {
    assert.deepEqual(rows.props.children.map(row => row.props.todo), context.todos);
    for (const row of rows.props.children) {
      const view = row.type(row.props), item = row.props.todo;
      const meta = app.find(view, props => props?.children?.[0] === item.course);
      assert.equal(meta.props.children.join(''), item.course + (item.deadline ? ' · ' + item.deadline : ''));
      assert.equal(view.props.accessibilityLabel, item.title + '，' + item.course + (item.deadline ? '，' + item.deadline : ''));
      assert.doesNotMatch(JSON.stringify(view), /未设.*截止时间/);
    }
  }
  const cleanups = app.runStartupEffects();
  await f.learning.refresh();
  const requests = f.calls.length;
  assert.equal(app.todoClock.timer.delay, 1000);
  app.todoClock.now = new Date(2026, 10, 16).getTime();
  app.todoClock.timer.callback();
  assert.deepEqual(app.render().todos.map(item => item.deadline), ['明天 18:00', '后天 08:05', null]);
  assert.equal(app.todoClock.timer.delay, 24 * 60 * 60 * 1000);
  app.todoClock.now = new Date(2026, 10, 17, 9).getTime();
  app.todoClock.listener('active');
  assert.deepEqual(app.render().todos.map(item => item.deadline), ['今天 18:00', '明天 08:05', null]);
  assert.equal(f.calls.length, requests, 'date changes never query school services');
  assert.deepEqual(f.learning.getSnapshot().todos, items, 'display changes leave raw dates and order intact');
  cleanups.forEach(cleanup => { if (typeof cleanup === 'function') cleanup(); });
  assert.equal(app.todoClock.timer, null);
  assert.equal(app.todoClock.listener, null);
  const preview = pages(f, true);
  preview.render(); preview.runStartupEffects();
  assert.equal(preview.todoClock.timer, null, 'static previews do not start a date clock');
  assert.equal(preview.todoClock.listener, null);
});
