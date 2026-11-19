import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { posix } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import React from 'react';
import { CookieJar } from 'tough-cookie';
import ts from 'typescript';
import * as learningModule from '../src/learning.ts';
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
const { createLearning, historyView, todoView } = learningModule;
const require = createRequire(import.meta.url);
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const academicPage = 'https://jw.xmu.edu.cn/gsapp/sys/wdkbapp/*default/index.do';
const academicProfileUrl = 'https://jw.xmu.edu.cn/gsapp/sys/wdkbapp/wdkcb/initXsxx.do?XH=';
// The school's jw-xskcbBS.js reads this envelope, not a top-level array.
const academicTerms = { datas: { kfdxnxqcx: { rows: [{ DM: '20261', MC: '测试学期' }] } } };
const profile = { id: 42, user_no: '001234', name: '测试同学' };
const recoveryAccount = { lntId: 42, studentNumber: '001234', name: '测试同学' };
const cacheName = 'school-learning.json';
const savedSession = f => JSON.parse(f.files.get(cacheName) ?? 'null')?.session;
const lntRoot = 'https://lnt.xmu.edu.cn/';
const rollcallsUrl = lntRoot + 'api/radar/rollcalls?api_version=1.1.0';
const casLogin = 'https://ids.xmu.edu.cn/authserver/login';
const webCookies = [
  { name: 'lnt_session', value: 'web-lnt', domain: 'lnt.xmu.edu.cn', path: '/' },
  { name: 'TGC', value: 'web-ids', domain: 'ids.xmu.edu.cn', path: '/authserver' },
  { name: 'KEYCLOAK_SESSION', value: 'web-identity', domain: 'c-identity.xmu.edu.cn', path: '/' },
  { name: 'mobile_session', value: 'web-mobile', domain: 'c-mobile.xmu.edu.cn', path: '/' },
  { name: 'JSESSIONID', value: 'web-jw', domain: 'jw.xmu.edu.cn', path: '/' },
].map(cookie => ({ ...cookie, secure: true, httpOnly: true }));
const todo = { id: 7, course_id: 3, course_name: '课程', title: '学校返回的作业', type: 'homework', end_time: null, is_locked: false };
const course = { id: 3, course_code: '001-A', name: '学校课程', semester_id: 9 };
const learningFixture = (overrides = {}) => ({
  version: 1, account: recoveryAccount, todos: [todo], todosAt: 1000,
  term: { id: 9, name: 'LNT 秋季' }, courses: [course], coursesAt: 1000,
  schedule: null, scheduleAt: null, refreshSchedule: false, rollcalls: [], attendance: {},
  history: [], historyAt: null, ...overrides,
});
const cacheEnvelope = (learning, session = null) => JSON.stringify({ version: 3, learning, session });
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
function response(url, body, status = 200, contentType = 'application/json', headers = []) {
  const rawHeaders = [['content-type', contentType], ...headers];
  const result = new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: rawHeaders });
  Object.defineProperties(result, { url: { value: url }, _rawHeaders: { value: rawHeaders } });
  return result;
}
const redirect = (url, location, headers = []) => response(url, '', 302, 'text/html', [['location', location], ...headers]);
const requestCookie = call => new Headers(call.options.headers).get('cookie') ?? '';
const requestPaths = f => f.calls.map(call => new URL(call.url).pathname);
function fixture(files = new Map(), { timers = {} } = {}) {
  const calls = [], cookieCalls = [], cacheMoves = [], logs = [];
  const cookies = new Map(webCookies.map(cookie => [cookie.name, cookie]));
  const document = '/private/app/files';
  const f = { files, calls, cookieCalls, cacheMoves, cookies, logs, cookieLoads: 0, cookieUnavailable: false,
    failWrite: false, failMove: false, failClear: false, failCapture: false, failDelete: null,
    failCrypto: false, captureGate: null, writeGate: null, moveGate: null, beforeMove: null, handler: null,
    console: Object.fromEntries(['info', 'warn'].map(level => [level, (...args) => logs.push([level, ...args])])) };
  class File {
    constructor(root, name) { this.name = posix.relative(document, posix.resolve(root, name)); }
    get uri() { return this.name; }
    get exists() { return files.has(this.name); }
    async text() { return files.get(this.name); }
    async write(value) {
      if (this.name === 'school-learning.tmp' && f.writeGate) await f.writeGate.promise;
      if (f.failWrite) throw Error('DISK');
      files.set(this.name, value);
    }
    delete() { if (f.failDelete === this.name) throw Error('DISK'); files.delete(this.name); }
  }
  const fetch = async (url, options) => {
    url = String(url);
    calls.push({ url, options });
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'manual');
    if (f.handler) { const result = await f.handler(url, options); if (result) return result; }
    if (url === lntRoot) return redirect(url, '/user/index');
    if (url === lntRoot + 'user/index') return response(url, '<html>课程</html>', 200, 'text/html');
    if (url.endsWith('/token')) return response(url, { access_token: 'one-use-access-token' });
    if (url.includes('/api/login')) return response(url, '', 200, 'application/json', [['Set-Cookie', 'lnt_session=manual-lnt; Path=/; Secure; HttpOnly']]);
    if (url.includes('kfdxnxqcx')) return response(url, academicTerms);
    if (url === academicProfileUrl) return response(url, { data: [{ XH: profile.user_no }] });
    if (url.includes('queryXspkjg.do')) return response(url, { success: true, pkjgList: [] });
    if (url.includes('getZcxx.do')) return response(url, academicWeeks);
    if (url.endsWith('/api/semesters')) return response(url, { semesters: [{ id: 9, name: 'LNT 秋季', is_active: true }] });
    if (url.includes('/my-courses')) return response(url, { courses: [course], pages: 1, total: 1 });
    if (url.endsWith('/profile')) return response(url, profile);
    if (url.includes('/todos')) return response(url, { todo_list: [todo] });
    if (url === rollcallsUrl) return response(url, { rollcalls: [] });
    if (url.includes('/rollcalls')) return response(url, { rollcalls: [] });
    throw Error('Unexpected request');
  };
  const deviceModule = loadModule('../src/school-device.ts', {
    'expo/fetch': { fetch },
    get '@preeternal/react-native-cookie-manager'() {
      f.cookieLoads++;
      if (f.cookieUnavailable) throw Error('Native CookieManager is unavailable');
      return { __esModule: true, default: {
        getAsArray: async url => {
          if (f.captureGate) await f.captureGate.promise;
          if (f.failCapture) throw Error('COOKIE_SNAPSHOT');
          const { hostname, pathname } = new URL(url);
          return [...cookies.values()].filter(cookie => hostname === cookie.domain &&
            (pathname === cookie.path || pathname.startsWith(cookie.path.endsWith('/') ? cookie.path : cookie.path + '/')));
        },
        flush: async () => { cookieCalls.push('flush'); },
        clearAllStores: async () => { cookieCalls.push('clearAllStores'); if (f.failClear) throw Error('COOKIE_STORAGE'); cookies.clear(); return true; },
      } };
    },
    'expo-file-system': { File, Paths: { document } },
    'expo-file-system/legacy': { moveAsync: async ({ from, to }) => {
      f.beforeMove?.();
      if (f.moveGate) await f.moveGate.promise;
      if (f.failMove) throw Error('DISK');
      files.set(to, files.get(from)); files.delete(from);
      cacheMoves.push(to);
    } },
    'expo-crypto': { randomUUID, getRandomBytesAsync: async size => {
      if (f.failCrypto) throw Object.assign(Error('password=private-password'), { code: 'private-token' });
      return randomBytes(size);
    },
      digestStringAsync: async (_algorithm, text) => createHash('sha256').update(text).digest('base64'),
      CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, CryptoEncoding: { BASE64: 'base64' } },
    './school-browser': browserModule,
    './learning': learningModule,
    './school-cookies': loadModule('../src/school-cookies.ts', { './school-browser.ts': browserModule }),
    './attendance.ts': attendanceModule,
    './location-attendance.ts': locationModule,
    './qr.ts': qrModule,
  }, { Headers, console: f.console, ...timers });
  return Object.assign(f, deviceModule, { learning: createLearning(deviceModule.schoolDevice) });
}
async function boundFixture(learning = null, options) {
  const jar = new CookieJar();
  for (const { name, value, domain, path } of webCookies) {
    jar.setCookieSync(`${name}=${value}; Path=${path}; Secure; HttpOnly`, `https://${domain}${path}`);
  }
  const f = fixture(new Map([[cacheName, cacheEnvelope(learning, { account: recoveryAccount, cookies: jar.serializeSync() })]]), options);
  assert.deepEqual(JSON.parse(JSON.stringify((await f.schoolDevice.load()).account)), recoveryAccount);
  return f;
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
test('unsupported top-level cache versions reach the invalid-cache path without deleting the file', async () => {
  const learning = learningFixture();
  for (const data of [learning, { version: 2, activeAccountId: 42, accounts: { 42: learning } }]) {
    const raw = JSON.stringify(data);
    const f = fixture(new Map([[cacheName, raw]]));
    await assert.rejects(f.schoolDevice.load(), { code: 'INVALID_CACHE' });
    await f.learning.restore();
    assert.match(f.learning.getSnapshot().message, /本机数据读取失败/);
    assert.equal(f.files.get(cacheName), raw);
    assert.deepEqual(f.calls, []);
  }
});

test('current learning data loads without an authenticated school session or network request', async () => {
  const learning = learningFixture();
  const raw = JSON.stringify(learning);
  const f = fixture(new Map([[cacheName, cacheEnvelope(learning)]]));
  const loaded = await f.schoolDevice.load();
  assert.equal(loaded.raw, raw);
  assert.equal(loaded.account, null);
  await f.learning.restore();
  assert.deepEqual(f.learning.getSnapshot().todos, [todo]);
  assert.equal(f.learning.getSnapshot().needsLogin, true);
  assert.equal(await f.learning.refresh(), false);
  assert.deepEqual(f.calls, []);
});

test('a current learning cache keeps its data and gains a durable session on manual login', async () => {
  const learning = learningFixture();
  const files = new Map([[cacheName, cacheEnvelope(learning)]]);
  const f = fixture(files);
  await f.learning.restore();
  assert.equal(f.learning.getSnapshot().needsLogin, true);
  assert.deepEqual(f.learning.getSnapshot().todos, [todo]);
  const login = f.schoolDevice.authenticate();
  await authorize(f); await initialize(f); await login;
  const reopened = fixture(files);
  const loaded = await reopened.schoolDevice.load();
  assert.deepEqual(loaded.account && JSON.parse(JSON.stringify(loaded.account)), recoveryAccount);
  assert.deepEqual(JSON.parse(loaded.raw), learning);
  assert.doesNotMatch(loaded.raw, /manual-lnt|web-ids/);
  await reopened.schoolDevice.read('todos');
  assert.match(requestCookie(reopened.calls[0]), /lnt_session=manual-lnt/);
  assert.deepEqual([...files.keys()], ['school-learning.json']);
});

test('pre-login preferences round-trip in a v3 envelope with a null session', async () => {
  const f = fixture();
  const preferences = { version: 1, refreshSchedule: true };
  const raw = JSON.stringify(preferences);
  await f.schoolDevice.save(raw);
  assert.deepEqual(JSON.parse(f.files.get(cacheName)), { version: 3, learning: preferences, session: null });
  const loaded = await fixture(f.files).schoolDevice.load();
  assert.equal(loaded.raw, raw);
  assert.equal(loaded.account, null);
});

test('the device rejects wrong-account reads, submissions and saves, and never restores mismatched cookies', async () => {
  const other = { ...recoveryAccount, lntId: 43 };
  const f = await boundFixture();
  const previous = f.files.get(cacheName);
  const learning = learningFixture({ account: other });
  await assert.rejects(f.schoolDevice.read('todos', undefined, other), { code: 'AUTH_REQUIRED' });
  await assert.rejects(f.schoolDevice.answerNumber('81', '0007', other), { code: 'AUTH_REQUIRED' });
  await assert.rejects(f.schoolDevice.save(JSON.stringify(learning)), { code: 'AUTH_REQUIRED' });
  assert.deepEqual(f.calls, []);
  assert.equal(f.files.get(cacheName), previous);
  const reopened = fixture(new Map([[cacheName, cacheEnvelope(learning, savedSession(f))]]));
  await reopened.learning.restore();
  assert.deepEqual(reopened.learning.getSnapshot().account, other);
  assert.equal(reopened.learning.getSnapshot().needsLogin, true);
  assert.equal(await reopened.learning.refresh(), false);
  assert.deepEqual(reopened.calls, []);
});

test('overlapping learning and cookie writes preserve the latest data and session in either order', async () => {
  for (const cookiesFirst of [false, true]) {
    const f = await boundFixture(), commit = deferred(), committing = deferred();
    const learning = learningFixture({ todosAt: 2000 });
    f.moveGate = commit;
    f.beforeMove = committing.resolve;
    f.handler = async url => response(url, { todo_list: [todo] }, 200, 'application/json', [
      ['Set-Cookie', 'lnt_session=rotated-lnt; Path=/; Secure'],
    ]);
    const save = () => f.schoolDevice.save(JSON.stringify(learning));
    const rotate = () => f.schoolDevice.read('todos');
    const first = (cookiesFirst ? rotate : save)();
    await committing.promise;
    const second = (cookiesFirst ? save : rotate)();
    await tick();
    commit.resolve();
    await Promise.all([first, second]);
    assert.deepEqual(f.cacheMoves, [cacheName, cacheName]);
    assert.deepEqual([...f.files.keys()], [cacheName]);
    const reopened = fixture(f.files);
    assert.deepEqual(JSON.parse((await reopened.schoolDevice.load()).raw), learning);
    await reopened.schoolDevice.read('todos');
    assert.equal(requestCookie(reopened.calls[0]), 'lnt_session=rotated-lnt');
  }
});

test('LNT courses use the selected semester and collect every page before returning', async () => {
  const f = await boundFixture();
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

test('expired course POST follows the official HTTP redirect chain and replays after durable cookie rotation', async () => {
  const f = await boundFixture();
  const previous = f.files.get(cacheName);
  const identity = IDENTITY + '/auth?state=synthetic';
  const mobile = 'https://c-mobile.xmu.edu.cn/identity-web-login-callback?_h5=true';
  const commit = deferred();
  f.moveGate = commit;
  let attempts = 0;
  f.handler = async url => {
    if (url.endsWith('/my-courses') && attempts++ === 0) return redirect(url, casLogin, [
      ['Set-Cookie', 'lnt_session=; Path=/; Max-Age=0'],
      ['Set-Cookie', 'recovery_hint=test; Path=/; Secure'],
    ]);
    if (url === lntRoot) return redirect(url, casLogin, [['Set-Cookie', 'lnt_session=rotated-lnt; Path=/; Secure; HttpOnly']]);
    if (url === casLogin) return redirect(url, identity, [['Set-Cookie', 'TGC=rotated-ids; Path=/authserver; Secure; HttpOnly']]);
    if (url === identity) return redirect(url, mobile);
    if (url === mobile) return redirect(url, lntRoot + 'user/index');
    if (url === lntRoot + 'user/index') return response(url, '<html>课程</html>', 200, 'text/html', [
      ['Set-Cookie', 'scope=rotated-root; Path=/; Secure; HttpOnly'],
      ['set-cookie', 'scope=rotated-api; Path=/api; Secure; HttpOnly'],
    ]);
  };
  const result = f.schoolDevice.read('courses', { semesterId: 9 }, recoveryAccount);
  void result.catch(() => {});
  await tick();
  try {
    assert.deepEqual(f.calls.slice(1).map(call => call.url), [lntRoot, casLogin, identity, mobile, lntRoot + 'user/index']);
    assert.ok(f.calls.slice(1, 6).every(call => (call.options.method ?? 'GET') === 'GET'));
    assert.equal(requestCookie(f.calls[1]), 'recovery_hint=test');
    assert.match(requestCookie(f.calls[2]), /^TGC=web-ids$/);
    assert.match(requestCookie(f.calls[3]), /^KEYCLOAK_SESSION=web-identity$/);
    assert.match(requestCookie(f.calls[4]), /^mobile_session=web-mobile$/);
    assert.match(requestCookie(f.calls[5]), /(?:^|; )lnt_session=rotated-lnt(?:;|$)/);
    assert.deepEqual(f.cacheMoves, []);
    assert.equal(f.files.get(cacheName), previous);
    assert.equal(attempts, 1);
    assert.equal(f.schoolBrowser.getSnapshot(), null);
  } finally { commit.resolve(); }
  assert.deepEqual(Array.from((await result).courses), [course]);
  assert.deepEqual(f.cacheMoves, [cacheName]);
  assert.equal(attempts, 2);
  assert.equal(f.calls.at(-1).options.method, 'POST');
  assert.equal(f.calls.at(-1).options.body, f.calls[0].options.body);
  assert.equal(f.calls.at(-1).url, f.calls[0].url);
  assert.match(requestCookie(f.calls.at(-1)), /scope=rotated-api.*scope=rotated-root/);

  const reopened = fixture(f.files);
  await reopened.schoolDevice.load();
  await reopened.schoolDevice.read('todos');
  assert.match(requestCookie(reopened.calls[0]), /lnt_session=rotated-lnt/);
  assert.match(requestCookie(reopened.calls[0]), /scope=rotated-api.*scope=rotated-root/);
});

test('the original LNT query decides renewal without a separate profile request', async () => {
  const f = await boundFixture();
  f.handler = async url => {
    if (url.endsWith('/profile')) return response(url, {}, 503);
    if (url.includes('/todos')) return response(url, {}, 401);
  };
  await assert.rejects(f.schoolDevice.read('todos', undefined, recoveryAccount), { code: 'AUTH_REQUIRED' });
  assert.deepEqual(requestPaths(f), ['/api/todos', '/', '/user/index', '/api/todos']);
});

test('concurrent LNT reads share recovery, keep valid successes and replay only expiry results once', async () => {
  const f = await boundFixture(), late = deferred(), recovery = deferred(), sent = new Map();
  const validHistory = { rollcalls: [{ rollcall_id: 61, rollcall_time: '2026-11-08T08:00:00+08:00', title: '课堂签到', student_status: 'on_call', status: 'on_call_fine' }] };
  f.handler = async url => {
    if (url === lntRoot) await recovery.promise;
    if (!url.includes('/student/')) return;
    const courseId = Number(new URL(url).pathname.split('/')[3]);
    const count = (sent.get(courseId) ?? 0) + 1;
    sent.set(courseId, count);
    if (count === 1 && courseId >= 5) await late.promise;
    if (count === 1 && courseId === 6) return response(url, validHistory, 200, 'application/json', [['Set-Cookie', 'lnt_session=stale; Path=/; Secure']]);
    if (count === 1 || courseId === 5) return response(url, {}, 401);
  };
  const requests = [3, 4, 5, 6].map(courseId => f.schoolDevice.read('history', { courseId, studentId: 42 }, recoveryAccount));
  const rejected = assert.rejects(requests[2], { code: 'AUTH_REQUIRED' });
  await tick();
  recovery.resolve();
  await Promise.all(requests.slice(0, 2));
  late.resolve();
  await rejected;
  assert.deepEqual(await requests[3], validHistory);
  assert.deepEqual([...sent.values()], [2, 2, 2, 1]);
  assert.equal(f.calls.filter(call => call.url === lntRoot).length, 1);
  assert.deepEqual(f.cacheMoves, [cacheName]);
  assert.equal(CookieJar.deserializeSync(savedSession(f).cookies).getCookieStringSync(lntRoot), 'lnt_session=web-lnt');
});

test('each attendance PUT waits for durable recovery and an expired write is never replayed', async () => {
  const position = { latitude: 24.441, longitude: 118.103, accuracy: 7, altitude: null, altitudeAccuracy: null, heading: 0, speed: 0 };
  for (const submit of [
    device => device.answerNumber('81', '0007', recoveryAccount),
    device => device.submitQr('83', 'opaque', recoveryAccount),
    device => device.submitLocation('82', position, recoveryAccount),
  ]) {
    const f = await boundFixture();
    const commit = deferred();
    f.moveGate = commit;
    let expired = true;
    f.handler = async (url, options) => {
      if (url.includes('/todos') && expired) { expired = false; return response(url, {}, 401); }
      if (options.method === 'PUT') return response(url, {}, 401);
    };
    const read = f.schoolDevice.read('todos', undefined, recoveryAccount);
    void read.catch(() => {});
    await tick();
    const answer = assert.rejects(submit(f.schoolDevice), { code: 'AUTH_REQUIRED' });
    void answer.catch(() => {});
    await tick();
    try {
      assert.deepEqual(f.cacheMoves, []);
      assert.equal(f.calls.some(call => call.options.method === 'PUT'), false);
    } finally { commit.resolve(); }
    await read;
    await answer;
    assert.equal(f.calls.filter(call => call.options.method === 'PUT').length, 1);
    assert.equal(f.calls.filter(call => call.url === lntRoot).length, 1);
  }
});

test('recovery waits for an in-flight attendance PUT to settle', async () => {
  const f = await boundFixture(), put = deferred();
  let expired = true;
  f.handler = async (url, options) => {
    if (options.method === 'PUT') { await put.promise; return response(url, { success: true }); }
    if (url.includes('/todos') && expired) { expired = false; return response(url, {}, 401); }
  };
  const answer = f.schoolDevice.answerNumber('81', '0007', recoveryAccount);
  const read = f.schoolDevice.read('todos', undefined, recoveryAccount);
  await tick();
  try { assert.equal(f.calls.some(call => call.url === lntRoot), false); }
  finally { put.resolve(); }
  assert.equal((await answer).result, 'success');
  await read;
  assert.equal(f.calls.filter(call => call.options.method === 'PUT').length, 1);
  assert.equal(f.calls.filter(call => call.url === lntRoot).length, 1);
});

test('failed renewal or an expired retry keeps the confirmed learning batch', async () => {
  for (const failure of ['interactive', 'write', 'move', 'expired todos', 'expired history']) {
    const history = failure === 'expired history';
    const cache = learningFixture({ historyAt: 1000 });
    const target = history ? '/student/42/' : '/todos';
    const f = await boundFixture(cache);
    await f.learning.restore();
    const raw = f.files.get(cacheName), before = f.learning.getSnapshot();
    const replayed = failure.startsWith('expired');
    f.failWrite = failure === 'write';
    f.failMove = failure === 'move';
    f.handler = async url => {
      if (url.includes(target)) return response(url, {}, 401, 'application/json', [['Set-Cookie', 'lnt_session=; Path=/; Max-Age=0']]);
      if (url === lntRoot) return redirect(url, failure === 'interactive' ? casLogin : '/user/index', [['Set-Cookie', 'lnt_session=renewed; Path=/; Secure']]);
      if (url === casLogin) return response(url, '<html>login</html>', 200, 'text/html');
    };
    assert.equal(await (history ? f.learning.refreshHistory() : f.learning.refresh()), false, failure);
    assert.equal(f.learning.getSnapshot().needsLogin, true);
    assert.strictEqual(f.learning.getSnapshot().todos, before.todos);
    assert.strictEqual(f.learning.getSnapshot().account, before.account);
    assert.strictEqual(f.learning.getSnapshot().history, before.history);
    assert.equal(f.learning.getSnapshot().historyAt, before.historyAt);
    if (replayed) {
      const loaded = await fixture(f.files).schoolDevice.load();
      assert.deepEqual(JSON.parse(loaded.raw), cache);
      assert.match(requestCookie(f.calls.filter(call => call.url.includes(target)).at(-1)), /lnt_session=renewed/);
      const app = pages(f);
      app.render();
      const login = app.loginButton('profile').props.onPress();
      await authorize(f);
      f.schoolBrowser.cancel();
      assert.equal(await login, false);
    } else assert.equal(f.files.get(cacheName), raw);
    assert.equal(requestCookie(f.calls.find(call => call.url === lntRoot)), '');
    assert.deepEqual(f.cacheMoves, replayed ? [cacheName] : []);
    assert.equal(f.calls.filter(call => call.url.includes(target)).length, replayed ? 2 : 1);
    assert.equal(f.calls.some(call => call.url.endsWith('/profile')), false);
    assert.equal(f.files.has('school-learning.tmp'), false);
  }
});

test('HTTP recovery stops at interactive login or a destination outside the redirect allowlist', async () => {
  for (const location of [casLogin, 'https://jw.xmu.edu.cn/', 'https://other.xmu.edu.cn/', 'https://ids.xmu.edu.cn.example.invalid/']) {
    const f = await boundFixture();
    const saved = f.files.get(cacheName);
    f.handler = async url => url.includes('/todos') ? response(url, {}, 401)
      : url === lntRoot ? redirect(url, location)
      : response(url, '<form><input id="pwdEncryptSalt" type="hidden"><input type="password"></form>', 200, 'text/html');
    await assert.rejects(f.schoolDevice.read('todos', undefined, recoveryAccount));
    assert.deepEqual(requestPaths(f), ['/api/todos', '/', ...(location === casLogin ? ['/authserver/login'] : [])]);
    assert.equal(f.files.get(cacheName), saved);
    assert.deepEqual(f.cacheMoves, []);
    assert.equal(f.schoolBrowser.getSnapshot(), null);
    if (location === casLogin) {
      const login = f.learning.login();
      await tick();
      assert.equal(f.schoolBrowser.getSnapshot()?.kind, 'authorize');
      f.schoolBrowser.cancel();
      assert.equal(await login, false);
    }
  }
});

test('recovery timeout retains the previous session on restart after a late school response', async () => {
  for (const stalledUrl of [lntRoot, lntRoot + 'user/index']) {
    const timers = new Map(), gate = deferred();
    const f = await boundFixture(undefined, { timers: {
      setTimeout(fn, delay) { const key = Symbol(); timers.set(key, { fn, delay }); return key; },
      clearTimeout(key) { timers.delete(key); },
    } });
    const previous = f.files.get(cacheName);
    f.handler = async url => {
      if (url.includes('/todos')) return response(url, {}, 401);
      if (url === stalledUrl) await gate.promise;
    };
    const read = assert.rejects(f.schoolDevice.read('todos', undefined, recoveryAccount), { code: 'AUTH_REQUIRED' });
    void read.catch(() => {});
    await tick();
    const [deadline] = timers.values();
    try {
      assert.equal(f.calls.at(-1).url, stalledUrl);
      assert.deepEqual(f.cacheMoves, []);
      assert.equal(deadline.delay, 30_000);
      deadline.fn();
      assert.equal(await Promise.race([read.then(() => 'rejected'), tick().then(() => 'pending')]), 'rejected');
      assert.equal(f.calls.at(-1).options.signal.aborted, true);
      assert.equal(f.files.get(cacheName), previous);
    } finally { gate.resolve(); }
    await tick();
    assert.equal(f.calls.filter(call => call.url.includes('/todos')).length, 1);
    assert.deepEqual(f.cacheMoves, []);
    assert.equal(timers.size, 0);
    const reopened = fixture(f.files);
    assert.deepEqual(JSON.parse(JSON.stringify((await reopened.schoolDevice.load()).account)), recoveryAccount);
    await reopened.schoolDevice.read('todos');
    assert.match(requestCookie(reopened.calls[0]), /lnt_session=web-lnt/);
  }
});

test('a renewal that crosses its deadline during staging keeps the prior session and skips replay', async () => {
  let now = Date.now();
  class Clock extends Date { static now() { return now; } }
  const f = await boundFixture(null, { timers: { Date: Clock } });
  const previous = f.files.get(cacheName);
  const stage = deferred();
  f.writeGate = stage;
  f.handler = async url => {
    if (url.includes('/todos')) return response(url, {}, 401);
    if (url === lntRoot) return redirect(url, '/user/index', [['Set-Cookie', 'lnt_session=late; Path=/; Secure']]);
  };
  const read = assert.rejects(f.schoolDevice.read('todos', undefined, recoveryAccount), { code: 'AUTH_REQUIRED' });
  await tick();
  now += 30_001;
  stage.resolve();
  await read;
  assert.equal(f.calls.filter(call => call.url.includes('/todos')).length, 1);
  assert.deepEqual(f.cacheMoves, []);
  assert.equal(f.files.get(cacheName), previous);
  assert.equal(f.files.has('school-learning.tmp'), false);
  const reopened = fixture(f.files);
  await reopened.schoolDevice.load();
  await reopened.schoolDevice.read('todos');
  assert.match(requestCookie(reopened.calls[0]), /lnt_session=web-lnt/);
});

test('a dispatched renewal replacement settles past the deadline before retrying or reporting disk failure', async () => {
  for (const failMove of [false, true]) {
    let now = Date.now();
    class Clock extends Date { static now() { return now; } }
    const timers = new Map(), gate = deferred();
    const f = await boundFixture(undefined, { timers: {
      Date: Clock,
      setTimeout(fn) { const key = Symbol(); timers.set(key, fn); return key; },
      clearTimeout(key) { timers.delete(key); },
    } });
    f.moveGate = gate;
    f.failMove = failMove;
    let attempts = 0;
    f.handler = async url => {
      if (url.includes('/todos') && ++attempts === 1) return response(url, {}, 401);
      if (url === lntRoot) return redirect(url, '/user/index', [['Set-Cookie', 'lnt_session=renewed; Path=/; Secure']]);
    };
    const read = f.schoolDevice.read('todos', undefined, recoveryAccount);
    const outcome = failMove ? assert.rejects(read, { code: 'COOKIE_STORAGE' }) : read;
    void outcome.catch(() => {});
    await tick();
    try {
      assert.equal(f.files.has('school-learning.tmp'), true);
      assert.equal(timers.size, 0, 'the renew deadline ends at dispatch');
      now += 30_001;
      assert.equal(attempts, 1);
    } finally { gate.resolve(); }
    await outcome;
    assert.equal(attempts, failMove ? 1 : 2);
    assert.deepEqual(f.cacheMoves, failMove ? [] : [cacheName]);
    assert.equal(f.files.has('school-learning.tmp'), false);
    const reopened = fixture(f.files);
    await reopened.schoolDevice.load();
    await reopened.schoolDevice.read('todos');
    assert.equal(requestCookie(reopened.calls[0]), `lnt_session=${failMove ? 'web-lnt' : 'renewed'}`);
  }
});

test('logout cancels recovery and drains pending navigation or replacement before clearing the cache and WebView cookies', async () => {
  for (const stalledUrl of [lntRoot, lntRoot + 'user/index', null]) {
    const gate = deferred();
    const f = await boundFixture();
    if (!stalledUrl) f.moveGate = gate;
    f.handler = async url => {
      if (url.includes('/todos')) return response(url, {}, 401);
      if (url === stalledUrl) await gate.promise;
    };
    const read = assert.rejects(f.schoolDevice.read('todos', undefined, recoveryAccount), { code: 'CANCELLED' });
    void read.catch(() => {});
    await tick();
    const answer = assert.rejects(f.schoolDevice.answerNumber('81', '0007', recoveryAccount), { code: 'CANCELLED' });
    void answer.catch(() => {});
    const logout = f.learning.logout();
    await tick();
    try {
      assert.deepEqual(f.cacheMoves, []);
      assert.equal(f.cookieCalls.includes('clearAllStores'), false);
      assert.equal(f.files.get('school-logout'), 'pending');
      if (stalledUrl) assert.equal(f.calls.at(-1).options.signal.aborted, true);
      else assert.equal(f.files.has('school-learning.tmp'), true);
    } finally { gate.resolve(); }
    await Promise.all([read, answer]);
    assert.equal(await logout, true);
    assert.deepEqual(f.cacheMoves, stalledUrl ? [] : [cacheName]);
    assert.equal(f.files.size, 0);
    assert.equal(f.cookies.size, 0);
    assert.deepEqual(f.cookieCalls, ['clearAllStores']);
    assert.equal(f.calls.filter(call => call.url.includes('/todos')).length, 1);
    assert.equal(f.calls.some(call => call.options.method === 'PUT'), false);
  }
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

test('two-site login saves the verified session before success and the first timetable request', async () => {
  const f = fixture(); let authorized = 0;
  let authorizedCache, authorizedRequests;
  const commit = deferred();
  f.moveGate = commit;
  const login = f.learning.login(() => {
    authorized++;
    authorizedCache = f.files.get(cacheName);
    authorizedRequests = f.calls.map(call => call.url);
  });
  const loginRequests = [IDENTITY + '/token', lntRoot + 'api/login?login=access_token', lntRoot + 'api/profile', academicProfileUrl];
  const auth = await authorize(f);
  assert.equal(authorized, 0, 'a callback or token alone is not authentication success');
  const body = new URLSearchParams(f.calls[0].options.body);
  assert.equal(body.get('code'), 'single-code');
  assert.equal(body.get('client_id'), 'TronClassH5');
  assert.match(body.get('code_verifier'), /^[0-9a-f]{64}$/);
  assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'), auth.searchParams.get('code_challenge'));
  await initialize(f);
  try {
    assert.equal(authorized, 0);
    assert.deepEqual(f.calls.map(call => call.url), loginRequests);
    assert.deepEqual(JSON.parse(f.calls[1].options.body), { access_token: 'one-use-access-token', org_id: 1 });
    assert.match(requestCookie(f.calls[2]), /lnt_session=manual-lnt/);
    assert.equal(requestCookie(f.calls[3]), 'JSESSIONID=web-jw');
    assert.equal(f.files.has('school-learning.tmp'), true);
    assert.equal(f.files.has(cacheName), false);
    assert.deepEqual(f.cacheMoves, []);
  } finally { commit.resolve(); }
  assert.equal(await login, true);
  assert.deepEqual(f.cacheMoves, [cacheName, cacheName]);
  assert.equal(authorized, 1);
  assert.deepEqual(authorizedRequests, loginRequests);
  assert.deepEqual(f.calls.map(call => call.url), [
    ...loginRequests, lntRoot + 'api/todos?no-intercept=true', rollcallsUrl, lntRoot + 'api/semesters', lntRoot + 'api/my-courses',
    'https://jw.xmu.edu.cn' + timetablePaths[0], 'https://jw.xmu.edu.cn' + timetablePaths[1] + '?XNXQDM=20261',
    'https://jw.xmu.edu.cn' + timetablePaths[2], lntRoot + 'api/course/3/student/42/rollcalls?page=1&page_size=100',
  ]);
  assert.equal(f.schoolBrowser.getSnapshot(), null);
  assert.deepEqual(f.cookieCalls, [], 'session saving does not flush the WebView cookie store');
  const stored = savedSession(f);
  assert.deepEqual(JSON.parse(authorizedCache), { version: 3, learning: null, session: stored });
  const sessionOnly = await fixture(new Map([[cacheName, authorizedCache]])).schoolDevice.load();
  assert.equal(sessionOnly.raw, null);
  assert.deepEqual({ ...sessionOnly.account }, recoveryAccount);
  assert.deepEqual(stored.account, recoveryAccount);
  assert.equal(CookieJar.deserializeSync(stored.cookies).getCookieStringSync(lntRoot), 'lnt_session=manual-lnt');
  assert.ok(stored.cookies.cookies.some(cookie => cookie.key === 'TGC' && cookie.path === '/authserver' && cookie.httpOnly));
  assert.equal(f.learning.getSnapshot().account.studentNumber, '001234');
  assert.deepEqual(f.learning.getSnapshot().todos, [todo]);
  const saved = f.files.get('school-learning.json');
  const { raw } = await f.schoolDevice.load();
  const learning = JSON.parse(raw);
  assert.equal(learning.version, 1);
  assert.deepEqual(learning.account, recoveryAccount);
  assert.deepEqual(learning.history, []);
  assert.equal(learning.historyAt, learning.todosAt);
  assert.doesNotMatch(saved, /single-code|access-token|code_verifier/);
  assert.doesNotMatch(raw, /manual-lnt|web-(lnt|ids|identity|mobile|jw)|TGC|JSESSIONID|cookies/i);
  const reopened = fixture(f.files); await reopened.learning.restore();
  assert.deepEqual(reopened.learning.getSnapshot().todos, [todo]);
  assert.equal(reopened.learning.getSnapshot().authenticated, true);
  assert.equal(await reopened.learning.refresh(), true);
  assert.deepEqual(reopened.calls.map(call => call.url), [lntRoot + 'api/todos?no-intercept=true', rollcallsUrl, lntRoot + 'api/semesters', lntRoot + 'api/my-courses']);
  assert.equal(await f.learning.logout(), true);
  assert.equal(f.files.size, 0);
  assert.deepEqual(f.cookieCalls, ['clearAllStores']);
  assert.equal(f.cookies.size, 0);
});
test('invalid token, failed LNT login, and failed JW identity checks cannot report success', async () => {
  for (const phase of ['token', 'academic', 'login']) {
    const f = fixture(); let authorized = 0;
    f.handler = async url => {
      if (phase === 'token' && url.endsWith('/token')) return response(url, {});
      if (phase === 'academic' && url === academicProfileUrl) return response(url, '<html>login</html>', 200, 'text/html');
      if (phase === 'login' && url.includes('/api/login')) return response(url, {}, 201);
    };
    const login = f.learning.login(() => authorized++);
    await authorize(f);
    if (phase !== 'token') await initialize(f);
    assert.equal(await login, false);
    assert.equal(authorized, 0);
    assert.equal(f.files.size, 0);
    assert.equal(f.calls.some(call => call.url.endsWith('/profile')), phase === 'academic');
    assert.equal(f.schoolBrowser.getSnapshot(), null);
  }
});
test('an invalid JW term response fails the first timetable update after authorization', async () => {
  const f = fixture(); let authorized = 0;
  const termsUrl = 'https://jw.xmu.edu.cn' + timetablePaths[0];
  f.handler = async url => { if (url === termsUrl) return response(url, {}); };
  const login = f.learning.login(() => authorized++);
  await authorize(f); await initialize(f);
  assert.equal(await login, false);
  assert.equal(authorized, 1);
  assert.equal(f.learning.getSnapshot().authenticated, true);
  assert.match(f.learning.getSnapshot().message, /教务课表更新失败/);
  assert.equal(f.calls.at(-1).url, termsUrl);
  assert.deepEqual(f.cacheMoves, [cacheName]);
  assert.equal(JSON.parse(f.files.get(cacheName)).learning, null);
});
test('manual login verifies the JW session own student number and only saves scoped cookies', async () => {
  for (const [body, valid] of [
    [{ data: [{ XH: '009999' }] }, false],
    [{ data: [{ XH: 1234 }] }, false],
    [{ data: [] }, false],
    [{ success: false, data: [{ XH: '001234' }] }, false],
    [{ data: [{ XH: '001234' }] }, true],
  ]) {
    const f = await boundFixture(), identity = deferred();
    const previous = f.files.get(cacheName);
    let authorized = 0;
    f.handler = async url => {
      if (url !== academicProfileUrl) return;
      await identity.promise;
      return response(url, body, 200, 'application/json', [
        ['Set-Cookie', 'JSESSIONID=identity-jw; Path=/; Secure'],
        ['Set-Cookie', 'wrong=scope; Domain=lnt.xmu.edu.cn; Path=/; Secure'],
      ]);
    };
    const login = f.learning.login(() => authorized++);
    await authorize(f); await initialize(f);
    try {
      const call = f.calls.at(-1);
      assert.equal(call.url, academicProfileUrl);
      assert.equal(call.options.method ?? 'GET', 'GET');
      assert.equal(call.options.body, undefined);
      assert.equal(requestCookie(call), 'JSESSIONID=web-jw');
      assert.equal(authorized, 0);
      assert.deepEqual(f.cacheMoves, []);
    } finally { identity.resolve(); }
    assert.equal(await login, valid);
    assert.equal(authorized, Number(valid));
    assert.equal(f.calls.filter(call => call.url === academicProfileUrl).length, 1);
    if (!valid) {
      assert.equal(f.learning.getSnapshot().needsLogin, true);
      assert.deepEqual(f.cacheMoves, []);
      assert.equal(f.files.get(cacheName), previous);
      continue;
    }
    assert.deepEqual(f.cacheMoves, [cacheName, cacheName]);
    const jar = CookieJar.deserializeSync(savedSession(f).cookies);
    assert.equal(jar.getCookieStringSync(academicProfileUrl), 'JSESSIONID=identity-jw');
    assert.equal(jar.getCookieStringSync(lntRoot), 'lnt_session=manual-lnt');
    assert.equal(f.calls.filter(call => call.url.includes('kfdxnxqcx')).length, 1);
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
    f.cookieUnavailable = stage === 'native'; f.failCrypto = stage === 'pkce'; f.failCapture = stage === 'flush';
    f.handler = async url => {
      if (url.endsWith('/token') && stage === 'network') throw Error('https://secret.test/?code=private-code&token=private-token');
      if (url.endsWith('/token') && stage === 'token') return response(url, {});
      if (url === academicProfileUrl && stage === 'academic-probe') return response(url, {});
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
  const previous = { version: 1, refreshSchedule: false };
  const replacement = JSON.stringify({ version: 1, refreshSchedule: true });
  const f = fixture(new Map([[cacheName, cacheEnvelope(previous)]]));
  f.failMove = true;
  await assert.rejects(f.schoolDevice.save(replacement), { code: 'CACHE_STORAGE' });
  assert.equal(f.files.get(cacheName), cacheEnvelope(previous));
  assert.equal((await f.schoolDevice.load()).raw, JSON.stringify(previous));
  assert.equal(f.files.has('school-learning.tmp'), false);
  f.failMove = false; await f.schoolDevice.save(replacement);
  assert.equal((await f.schoolDevice.load()).raw, replacement);
});
test('the existing settings cleanup clears an invalid cache and enables official login', async () => {
  const f = fixture(new Map([[cacheName, '{invalid-json']])), app = pages(f);
  await f.learning.restore();
  const context = app.render();
  assert.equal(context.data.authenticated, false);
  assert.match(context.data.message, /学校本机数据读取失败/);
  assert.deepEqual(f.calls, []);
  app.find(app.settings(), props => props?.title === '清除学校登录数据').props.onPress();
  app.render();
  app.find(app.settings(), props => props?.label === '确认退出').props.onPress();
  await tick();
  assert.equal(f.files.has(cacheName), false);
  assert.deepEqual(f.cookieCalls, ['clearAllStores']);
  app.render();
  const login = app.loginButton('profile').props.onPress();
  await authorize(f); await initialize(f);
  assert.equal(await login, true);
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

test('authentication, cookie snapshot or cache storage failure preserves cached data and allows manual retry', async () => {
  const saved = cacheEnvelope(learningFixture());
  for (const cached of [false, true]) for (const phase of ['token', 'snapshot', 'storage']) {
    const f = fixture(cached ? new Map([['school-learning.json', saved]]) : undefined), app = pages(f);
    await f.learning.restore(); app.render();
    f.failCapture = phase === 'snapshot';
    f.failMove = phase === 'storage';
    f.handler = async url => phase === 'token' && url.endsWith('/token') ? response(url, {}, 503) : undefined;
    let authorized = 0;
    const login = f.learning.login(() => authorized++);
    await authorize(f); if (phase !== 'token') await initialize(f);
    assert.equal(await login, false);
    assert.equal(authorized, 0);
    const failed = app.render();
    assert.equal(failed.data.authenticated, false);
    assert.equal(failed.data.needsLogin, true);
    assert.equal(failed.state.loggedIn, cached, 'cached content stays visible without granting a new session');
    assert.deepEqual(failed.data.todos, cached ? [todo] : []);
    assert.equal(f.files.get('school-learning.json'), cached ? saved : undefined);
    if (phase !== 'token') assert.equal(failed.data.message, '登录状态保存失败，请重新登录');
    assert.equal(f.calls.some(call => call.url.endsWith('/profile')), phase === 'storage');
    assert.equal(savedSession(f), cached ? null : undefined);
    const requestCount = f.calls.length;
    failed.refresh(); await tick();
    assert.equal(await f.learning.refresh(), false);
    assert.equal(f.calls.length, requestCount, 'ordinary refresh cannot bypass an unfinished login');
    app.render();
    const retry = app.loginButton('profile'); assert.ok(retry); assert.equal(retry.props.busy, false);
    f.failCapture = false; f.failMove = false; f.handler = null;
    const retried = retry.props.onPress(); await authorize(f); await initialize(f);
    assert.equal(await retried, true);
    assert.deepEqual(savedSession(f).account, recoveryAccount, 'explicit login retries cookie saving');
    assert.equal(app.render().data.authenticated, true);
    assert.equal(app.loginButton('profile'), undefined);
    assert.deepEqual(app.navigations, []);
  }
});

test('manual login replaces the session and keeps a failed business batch only for the same cached LNT id', async () => {
  const oldLearning = learningFixture({ refreshSchedule: true, attendance: { 81: 'success' } });
  for (const [cachedLearning, lntId, keep] of [
    [oldLearning, 43, false],
    [oldLearning, 42, true],
    [{ version: 1, refreshSchedule: true }, 43, false],
    [null, 43, false],
  ]) {
    const f = await boundFixture(cachedLearning);
    await f.learning.restore();
    const account = { lntId, studentNumber: '009999', name: '本次登录同学' };
    const business = deferred(), reading = deferred();
    let authorized;
    f.handler = async url => {
      if (url.endsWith('/profile')) return response(url, { id: lntId, user_no: account.studentNumber, name: account.name });
      if (url === academicProfileUrl) return response(url, { data: [{ XH: account.studentNumber }] });
      if (url.includes('/todos')) { reading.resolve(); await business.promise; return response(url, {}, 503); }
    };
    const login = f.learning.login(() => { authorized = f.learning.getSnapshot(); });
    await authorize(f); await initialize(f);
    try {
      assert.equal(await Promise.race([reading.promise.then(() => true), login]), true, 'login starts business reads');
      assert.equal(authorized.authenticated, true);
      assert.deepEqual({ ...authorized.account }, account);
      assert.deepEqual(authorized.todos, keep ? [todo] : []);
      assert.deepEqual(authorized.courses, keep ? [course] : []);
      assert.deepEqual(authorized.attendance, keep ? { 81: 'success' } : {});
      assert.equal(authorized.refreshSchedule, keep);
      assert.equal(await f.learning.setRefreshSchedule(!keep), false);
      assert.deepEqual(f.cacheMoves, [cacheName]);
    } finally { business.resolve(); }
    assert.equal(await login, false);
    assert.equal(f.learning.getSnapshot().authenticated, true);
    assert.deepEqual(f.learning.getSnapshot().todos, keep ? [todo] : []);
    assert.deepEqual(f.cacheMoves, [cacheName]);
    const reopened = await fixture(f.files).schoolDevice.load();
    assert.deepEqual({ ...reopened.account }, account);
    assert.deepEqual(JSON.parse(reopened.raw), keep ? { ...oldLearning, account } : null);
    assert.equal(CookieJar.deserializeSync(savedSession(f).cookies).getCookieStringSync(lntRoot), 'lnt_session=manual-lnt');
    if (!keep) await assert.rejects(f.schoolDevice.save(JSON.stringify(oldLearning)), { code: 'AUTH_REQUIRED' });
  }
});

test('aborting a reminder read aborts its HTTP request without touching a foreground read', async () => {
  const f = await boundFixture();
  const foreground = deferred();
  f.handler = (url, options) => {
    if (url.includes('/todos')) return foreground.promise;
    if (url === rollcallsUrl) return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(Error('ABORT')), { once: true }));
  };
  const controller = new AbortController();
  const reading = f.schoolDevice.read('todos', undefined, recoveryAccount);
  const cancelled = assert.rejects(f.schoolDevice.read('rollcalls', undefined, recoveryAccount, controller.signal), { code: 'CANCELLED' });
  await tick();
  try {
    controller.abort();
    assert.equal(f.calls.find(call => call.url === rollcallsUrl).options.signal.aborted, true);
    assert.equal(f.calls.find(call => call.url.includes('/todos')).options.signal.aborted, false);
  } finally { foreground.resolve(response(f.calls.find(call => call.url.includes('/todos')).url, { todo_list: [] })); }
  await cancelled;
  await reading;
  const count = f.calls.length;
  await assert.rejects(f.schoolDevice.read('rollcalls', undefined, recoveryAccount, controller.signal), { code: 'CANCELLED' });
  assert.equal(f.calls.length, count);
});

test('stopping a reminder releases its renewal wait and preserves renewal shared with foreground', async () => {
  for (const shared of [false, true]) {
    const f = await boundFixture(), renewal = deferred();
    f.handler = (url, options) => {
      if (url === rollcallsUrl) return response(url, {}, 401);
      if (url === lntRoot) return Promise.race([renewal.promise,
        new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(Error('ABORT')), { once: true }))]);
    };
    const controller = new AbortController();
    const stopped = assert.rejects(f.schoolDevice.read('rollcalls', undefined, recoveryAccount, controller.signal), { code: 'CANCELLED' });
    await tick();
    const refreshing = shared ? f.schoolDevice.read('todos', undefined, recoveryAccount) : null;
    await tick();
    controller.abort();
    await stopped;
    const renewalRequest = f.calls.find(call => call.url === lntRoot);
    try { assert.equal(renewalRequest.options.signal.aborted, !shared); }
    finally { renewal.resolve(redirect(lntRoot, '/user/index')); }
    if (shared) await refreshing;
    else await f.schoolDevice.read('todos', undefined, recoveryAccount);
    assert.equal(f.calls.filter(call => call.url === rollcallsUrl).length, 1);
  }
});

test('abort after accepted response preserves rotated cookies and discards the reminder result', async () => {
  const f = await boundFixture(), writing = deferred();
  f.writeGate = writing;
  f.handler = url => url === rollcallsUrl ? response(url, { rollcalls: [] }, 200, 'application/json', [
    ['Set-Cookie', 'lnt_session=rotated; Path=/; Secure'],
  ]) : undefined;
  const controller = new AbortController();
  const stopped = assert.rejects(f.schoolDevice.read('rollcalls', undefined, recoveryAccount, controller.signal), { code: 'CANCELLED' });
  await tick();
  controller.abort();
  writing.resolve();
  await stopped;
  assert.match(f.files.get(cacheName), /rotated/);
});

test('ordinary LNT failures and academic expiry do not trigger HTTP recovery', async () => {
  for (const kind of ['academic', 'redirect', 'html', 'json', 'server', 'network']) {
    const f = await boundFixture();
    f.handler = async url => {
      if (kind === 'network') throw Error('network');
      return kind === 'academic' ? response(url, {}, 401)
        : kind === 'redirect' ? redirect(url, '/maintenance')
        : kind === 'html' ? response(url, '<html>gateway</html>', 200, 'text/html')
        : kind === 'json' ? response(url, '{broken') : response(url, {}, 503);
    };
    await assert.rejects(f.schoolDevice.read(kind === 'academic' ? 'jwTerms' : 'todos'), {
      code: kind === 'academic' ? 'AUTH_REQUIRED' : ['redirect', 'server'].includes(kind) ? 'HTTP_ERROR' : kind === 'network' ? 'NETWORK' : 'INVALID_RESPONSE',
    });
    assert.equal(f.schoolBrowser.getSnapshot(), null);
    assert.equal(f.calls.length, 1);
  }
});

test('undocumented identity redirects, broad login markup, and resource 403 do not trigger recovery', async () => {
  const realm = IDENTITY.replace('/protocol/openid-connect', '');
  for (const [reply, code, httpStatus] of [
    [url => redirect(url, realm + '/login-actions/authenticate'), 'HTTP_ERROR', 302],
    [url => redirect(url, realm + '/account'), 'HTTP_ERROR', 302],
    [url => response(url, '<form><input id="pwdEncryptSalt"></form>', 200, 'text/html'), 'INVALID_RESPONSE'],
    [url => response(url, {}, 403), 'HTTP_ERROR', 403],
  ]) {
    const f = await boundFixture();
    f.handler = reply;
    await assert.rejects(f.schoolDevice.read('todos', undefined, recoveryAccount), { code, ...(httpStatus ? { httpStatus } : {}) });
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.cacheMoves, []);
  }
});

test('activity reads and number PUT reuse school sessions, exact ids, string codes and UUID device ids', async () => {
  const f = await boundFixture();
  const activity = { rollcall_id: 'school-81', course_id: 301, course_title: '真实字段模拟活动', is_number: true };
  f.handler = async (url, options) => url === rollcallsUrl ? response(url, { rollcalls: [activity] })
    : options.method === 'PUT' ? response(url, { success: true, message: '学校已记录签到' }) : undefined;
  assert.deepEqual(await f.schoolDevice.read('rollcalls'), { rollcalls: [activity] });
  const receipt = await f.schoolDevice.answerNumber('school-81', '0007', recoveryAccount);
  assert.equal(receipt.result, 'success'); assert.equal(receipt.message, '学校已记录签到');
  const call = f.calls[1], body = JSON.parse(call.options.body);
  assert.equal(call.url, 'https://lnt.xmu.edu.cn/api/rollcall/school-81/answer_number_rollcall');
  assert.equal(call.options.method, 'PUT');
  assert.equal(new Headers(call.options.headers).get('Content-Type'), 'application/json');
  assert.equal(requestCookie(call), 'lnt_session=web-lnt');
  assert.equal(body.numberCode, '0007');
  assert.match(body.deviceId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(Object.keys(body).sort(), ['deviceId', 'numberCode']);
  assert.equal(f.logs.length, 0); assert.deepEqual(f.cacheMoves, []);
});

test('number PUT uses the uncertain-result fallback for unconfirmed responses and never retries a write', async () => {
  for (const [status, body, expected] of [
    [200, '', 'success'], [200, { success: false }, 'failed'], [200, { error: true }, 'failed'],
    [422, {}, 'failed'], [403, {}, 'failed'],
    [409, { is_expired: true, message: '签到已结束' }, 'ended'], [503, { message: '响应说明' }, 'failed'],
  ]) {
    const f = await boundFixture(); f.handler = async url => response(url, body, status);
    const receipt = await f.schoolDevice.answerNumber('81', '0206', recoveryAccount);
    assert.equal(receipt.result, expected);
    if (expected === 'failed') assert.match(receipt.message, /^提交结果未知，请核实本人记录/);
    if (body.message) assert.ok(receipt.message.includes(body.message));
    assert.equal(f.calls.length, 1);
  }
  const f = await boundFixture(); f.handler = async () => { throw Error('cookie=private-cookie'); };
  await assert.rejects(f.schoolDevice.answerNumber('81', '0206', recoveryAccount), { code: 'NETWORK' });
  assert.equal(f.calls.length, 1); assert.equal(f.logs.length, 0);
});

test('location PUT keeps all actual coordinates, nullable fields and the current activity without persisting them', async () => {
  const f = await boundFixture();
  f.handler = async url => response(url, { success: true, message: '学校确认定位签到' });
  const receipt = await f.schoolDevice.submitLocation('location/82', {
    latitude: 24.441, longitude: 118.103, accuracy: 7, altitude: null, altitudeAccuracy: null, heading: 0, speed: 0,
    timestamp: 1000, mocked: false,
  }, recoveryAccount);
  assert.equal(receipt.result, 'success'); assert.equal(receipt.message, '学校确认定位签到');
  const call = f.calls[0], { deviceId, ...position } = JSON.parse(call.options.body);
  assert.equal(call.url, 'https://lnt.xmu.edu.cn/api/rollcall/location%2F82/answer');
  assert.equal(call.options.method, 'PUT');
  assert.equal(new Headers(call.options.headers).get('Content-Type'), 'application/json');
  assert.deepEqual(position, { latitude: 24.441, longitude: 118.103, accuracy: 7, altitude: null, altitudeAccuracy: null, heading: 0, speed: 0 });
  assert.match(deviceId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(f.calls.length, 1); assert.equal(f.logs.length, 0); assert.deepEqual(f.cacheMoves, []);
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
    const f = await boundFixture(); f.handler = async url => response(url, body, status);
    const receipt = await f.schoolDevice.submitLocation('82', position, recoveryAccount);
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
    const f = await boundFixture();
    f.handler = async url => kind === '401' ? response(url, {}, 401)
      : kind === 'redirect' ? redirect(url, casLogin)
      : kind === 'html' ? response(url, '<html>login</html>', 200, 'text/html') : response(url, '{broken');
    await assert.rejects(f.schoolDevice.answerNumber('81', '0206', recoveryAccount), { code });
    assert.equal(f.calls.length, 1); assert.equal(f.logs.length, 0);
  }
});

test('a school p scan sends one PUT with decoded opaque data and returns the school receipt', async () => {
  const f = fixture();
  const activity = { rollcall_id: 83, course_id: course.id, course_title: '扫码活动' };
  f.handler = async (url, options) => url === rollcallsUrl ? response(url, { rollcalls: [activity] })
    : options.method === 'PUT' ? response(url, { status: 'on_call' }) : undefined;
  const login = f.learning.login();
  await authorize(f); await initialize(f);
  assert.equal(await login, true);
  const before = f.calls.length;
  const receipt = await f.learning.submitQr('83', '/scanner-jumper?p=4~%102b!3~++opaque%2B%2F%3D%2525%1F%1E%0A%E7%A0%81++');
  assert.deepEqual(receipt, { result: 'success', message: '签到成功' });
  assert.equal(f.calls.length, before + 1);
  const call = f.calls[before], { deviceId, ...body } = JSON.parse(call.options.body);
  assert.equal(call.url, 'https://lnt.xmu.edu.cn/api/rollcall/83/answer_qr_rollcall');
  assert.equal(call.options.method, 'PUT');
  assert.deepEqual(body, { data: '  opaque+/=%25~!\n码  ' });
  assert.match(deviceId, /^[0-9a-f-]{36}$/);
});

test('QR PUT preserves opaque data, shares the session and only accepts HTTP 200 with on_call', async () => {
  for (const [status, body, expected] of [
    [200, { status: 'on_call' }, 'success'], [200, { success: true }, 'failed'],
    [201, { status: 'on_call' }, 'failed'], [409, { error_code: 'qr_code_expired' }, 'failed'],
    [200, '', 'failed'], [200, { status: 'absent' }, 'failed'], [503, { status: 'on_call' }, 'failed'],
  ]) {
    const f = await boundFixture(); f.handler = async url => response(url, body, status);
    const receipt = await f.schoolDevice.submitQr('qr/83', '  opaque+/=%25\n码  ', recoveryAccount);
    assert.equal(receipt.result, expected);
    const call = f.calls[0], payload = JSON.parse(call.options.body);
    assert.equal(call.url, 'https://lnt.xmu.edu.cn/api/rollcall/qr%2F83/answer_qr_rollcall');
    assert.equal(call.options.method, 'PUT');
    assert.deepEqual(Object.keys(payload).sort(), ['data', 'deviceId']);
    assert.equal(payload.data, '  opaque+/=%25\n码  ');
    assert.match(payload.deviceId, /^[0-9a-f-]{36}$/);
    assert.equal(f.calls.length, 1); assert.equal(f.logs.length, 0); assert.deepEqual(f.cacheMoves, []);
  }
  for (const [kind, code] of [['401', 'AUTH_REQUIRED'], ['redirect', 'AUTH_REQUIRED'], ['html', 'AUTH_REQUIRED'], ['json', 'INVALID_RESPONSE']]) {
    const f = await boundFixture();
    f.handler = async url => kind === '401' ? response(url, {}, 401)
      : kind === 'redirect' ? redirect(url, casLogin)
      : kind === 'html' ? response(url, '<html>login</html>', 200, 'text/html') : response(url, '{broken');
    await assert.rejects(f.schoolDevice.submitQr('83', { opaque: [' x ', 7] }, recoveryAccount), { code });
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
  for (const blockedFile of [null, cacheName]) {
    const broken = await boundFixture();
    broken.failClear = blockedFile === null;
    broken.failDelete = blockedFile;
    await assert.rejects(broken.schoolDevice.clear(), { code: 'CLEANUP_FAILED' });
    assert.equal(broken.files.get('school-logout'), 'pending');
    assert.equal(broken.cookieCalls.includes('clearAllStores'), true, 'file errors do not skip session removal');
    await assert.rejects(broken.schoolDevice.authenticate(), { code: 'CLEANUP_REQUIRED' });
    const reopened = fixture(broken.files);
    const loaded = await reopened.schoolDevice.load();
    assert.equal(loaded.raw, null);
    assert.equal(loaded.account, null);
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
    './schedule': scheduleModule, './learning': { historyView, todoView }, './school-device': f,
    './school-reminder-device': { schoolLearning: f.learning, schoolRemindersAvailable: false, clearSchoolReminders: async () => {} },
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
  for (const [page, failure] of [['today', 'semesters'], ['profile', 'todos'], ['lnt', 'save'], ['jw', 'todos']]) {
    const f = fixture(), app = pages(f); app.render();
    const cancelled = app.loginButton(page).props.onPress(); await tick();
    assert.equal(f.schoolBrowser.getSnapshot().kind, 'authorize');
    f.schoolBrowser.cancel(); assert.equal(await cancelled, false);
    assert.equal(app.render().state.loggedIn, false);
    assert.deepEqual(app.navigations, []);
    if (failure === 'save') f.beforeMove = () => { f.failMove = f.cacheMoves.length > 0; };
    else f.handler = async url => url.includes('/' + failure) ? response(url, {}, 503) : undefined;
    const login = app.loginButton(page).props.onPress();
    await authorize(f); await initialize(f); assert.equal(await login, false);
    const failed = app.render();
    assert.equal(failed.state.loggedIn, true, 'authentication is visible before the first saved business batch');
    assert.deepEqual({ ...failed.data.account }, recoveryAccount); assert.equal(failed.data.needsLogin, false);
    assert.equal(app.loginButton('profile'), undefined);
    assert.equal(f.schoolBrowser.getSnapshot(), null);
    const refresh = app.refreshButton(); assert.ok(refresh); assert.equal(refresh.props.disabled, false);
    f.handler = null; f.beforeMove = null; f.failMove = false;
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
  const f = fixture(new Map([[cacheName, cacheEnvelope(learningFixture({ todos: [] }))]]));
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
  const f = await boundFixture(learningFixture({ todos: [] })), app = pages(f);
  await f.learning.restore(); app.render();
  f.handler = async url => url === rollcallsUrl ? response(url, { rollcalls: [
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
  const disposed = [], effects = [];
  const pageRef = { stopLoading: () => disposed.push('stop'), clearHistory: () => disposed.push('history'),
    clearFormData: () => disposed.push('form'), clearCache: () => disposed.push('cache') };
  const host = loadModule('../src/school-browser-view.tsx', {
    react: { ...React, useRef: value => ({ current: value === null ? pageRef : value }),
      useLayoutEffect: effect => effects.push(effect()), useSyncExternalStore: (_subscribe, snapshot) => snapshot() },
    'react-native': { Modal: 'Modal', View: 'View', Text: 'Text', ActivityIndicator: 'ActivityIndicator' },
    'react-native-webview': { __esModule: true, default: 'WebView' },
    './school-device': f, './school-browser': browserModule,
  }, { console: f.console });
  return { ...host, disposed, detach: () => effects.splice(0).forEach(dispose => dispose()) };
}

test('one modal stays open across both pages, token exchange, LNT login and cookie persistence', async () => {
  const f = fixture(), host = browserHost(f), token = deferred(), lnt = deferred();
  let authorized = 0;
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
  assert.equal(f.calls.some(call => call.url.endsWith('/profile')), false);
  f.beforeMove = () => {
    if (f.cacheMoves.length) return;
    assert.equal(f.learning.getSnapshot().authenticated, false);
    assert.equal(authorized, 0, 'success waits for cookie saving');
    assert.equal(f.calls.some(call => call.url.endsWith('/profile')), true);
    assert.equal(host.SchoolBrowserHost().type, modal.type, 'cookie persistence stays inside the same modal');
  };
  lnt.resolve(); assert.equal(await login, true);
  assert.deepEqual(f.cacheMoves, [cacheName, cacheName]);
  assert.equal(authorized, 1);
  assert.equal(f.learning.getSnapshot().authenticated, true);
  assert.equal(host.SchoolBrowserHost(), null);
  assert.deepEqual(states, ['authorize', 'pending', 'academic', 'pending', null]);
  assert.deepEqual(host.disposed, ['stop', 'history', 'form', 'cache', 'stop', 'history', 'form', 'cache']);
});

test('cancelling during token exchange or cookie capture cannot reopen the modal or publish late data', async () => {
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

  for (const failCapture of [false, true]) {
    const capturing = fixture(); capturing.captureGate = deferred(); capturing.failCapture = failCapture;
    let authorized = 0;
    const finishing = capturing.learning.login(() => authorized++); await authorize(capturing); await initialize(capturing);
    assert.equal(capturing.calls.length, 1);
    capturing.schoolBrowser.cancel(); capturing.captureGate.resolve();
    assert.equal(await finishing, false);
    assert.equal(authorized, 0);
    assert.equal(capturing.learning.getSnapshot().authenticated, false);
    assert.equal(capturing.learning.getSnapshot().message, '已取消学校登录');
    assert.equal(capturing.calls.length, 1);
    assert.equal(capturing.files.size, 0);
    assert.equal(capturing.schoolBrowser.getSnapshot(), null);
    assert.equal(capturing.logs.some(([, tag]) => tag === '[school-login]'), false);
  }
});

test('cancelling manual verification preserves the previous session on restart', async () => {
  const f = await boundFixture(), verification = deferred();
  const previous = f.files.get(cacheName);
  f.handler = async url => { if (url.endsWith('/profile')) await verification.promise; };
  let authorized = 0;
  const login = f.learning.login(() => authorized++);
  await authorize(f); await initialize(f);
  assert.equal(f.calls.at(-1).url, lntRoot + 'api/profile');
  f.schoolBrowser.cancel();
  verification.resolve();
  assert.equal(await login, false);
  assert.equal(authorized, 0);
  assert.deepEqual(f.cacheMoves, []);
  assert.equal(f.files.get(cacheName), previous);
  const reopened = fixture(f.files);
  assert.deepEqual(JSON.parse(JSON.stringify((await reopened.schoolDevice.load()).account)), recoveryAccount);
  await reopened.schoolDevice.read('todos');
  assert.match(requestCookie(reopened.calls[0]), /lnt_session=web-lnt/);
});

test('Android Back cancels login staging but waits for a dispatched replacement to settle', async () => {
  for (const [phase, failMove] of [['writeGate', false], ['moveGate', false], ['moveGate', true]]) {
    const f = await boundFixture(), gate = deferred();
    const host = browserHost(f);
    const previous = f.files.get(cacheName);
    const committing = phase === 'moveGate';
    const succeeds = committing && !failMove;
    let authorized = 0;
    f[phase] = gate;
    f.failMove = failMove;
    const login = f.learning.login(() => authorized++);
    await authorize(f); await initialize(f);
    try {
      const modal = host.SchoolBrowserHost();
      assert.equal(modal.type, 'Modal');
      assert.equal(f.files.has('school-learning.tmp'), committing);
      assert.equal(f.files.get(cacheName), previous);
      modal.props.onRequestClose();
      assert.equal(host.SchoolBrowserHost()?.type ?? null, committing ? modal.type : null);
      assert.equal(authorized, 0);
    } finally { gate.resolve(); }
    assert.equal(await login, succeeds);
    assert.equal(authorized, Number(succeeds));
    assert.deepEqual(f.cacheMoves, succeeds ? [cacheName, cacheName] : []);
    if (!succeeds) assert.equal(f.files.get(cacheName), previous);
    if (failMove) assert.equal(f.logs.find(([, tag]) => tag === '[school-login]')?.[2].code, 'COOKIE_STORAGE');
    assert.equal(host.SchoolBrowserHost(), null);
    assert.equal(f.files.has('school-learning.tmp'), false);
    const reopened = fixture(f.files);
    await reopened.schoolDevice.load();
    await reopened.schoolDevice.read('todos');
    assert.equal(requestCookie(reopened.calls[0]), `lnt_session=${succeeds ? 'manual-lnt' : 'web-lnt'}`);
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
  const f = await boundFixture();
  for (const jwTermCode of [undefined, '', '2026-1', '20261&XH=other', 'https://example.invalid']) {
    await assert.rejects(f.schoolDevice.read('jwWeek', jwTermCode === undefined ? undefined : { jwTermCode }), { code: 'INVALID_TERM' });
  }
  assert.equal(f.calls.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(await f.schoolDevice.read('courses', { semesterId: 9 }))), { courses: [course] });
  assert.deepEqual(await f.schoolDevice.read('jwWeek', { jwTermCode: '20261' }), academicWeeks);
  assert.equal(f.calls[0].url, 'https://lnt.xmu.edu.cn/api/my-courses');
  assert.equal(f.calls[1].url, 'https://jw.xmu.edu.cn/gsapp/sys/wdkbapp/wdkcb/getZcxx.do?XNXQDM=20261');
  assert.deepEqual(f.calls.map(requestCookie), ['lnt_session=web-lnt', 'JSESSIONID=web-jw']);
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
  const f = await boundFixture();
  await assert.rejects(f.schoolDevice.read('jwSchedule', { jwTermCode: 'invalid', studentNumber: '001234' }), { code: 'INVALID_TERM' });
  await assert.rejects(f.schoolDevice.read('jwSchedule', { jwTermCode: '20261', studentNumber: '009999' }), { code: 'AUTH_REQUIRED' });
  await f.schoolDevice.read('jwSchedule', { jwTermCode: '20261', studentNumber: '001234' });
  const request = f.calls.at(-1);
  assert.ok(request.url.endsWith('/queryXspkjg.do'));
  assert.equal(request.options.method, 'POST');
  assert.equal(new Headers(request.options.headers).get('Content-Type'), 'application/x-www-form-urlencoded');
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
  const f = await boundFixture();
  const history = { rollcalls: [{ rollcall_id: 11, rollcall_time: '2026-11-09T08:17:00Z', title: '课堂签到', student_status: 'on_call', status: 'on_call_fine', student_status_detail: null, is_number: true }] };
  f.handler = async url => /\/course\/\d+\/student\//.test(url) ? response(url, history) : undefined;
  const data = await f.schoolDevice.read('history', { courseId: 3, studentId: 42 });
  assert.deepEqual(data, history);
  assert.equal(f.calls[0].url, 'https://lnt.xmu.edu.cn/api/course/3/student/42/rollcalls?page=1&page_size=100');
  assert.equal(f.calls.length, 1);
  for (const params of [undefined, { courseId: '../4', studentId: 42 }, { courseId: 3, studentId: '42?other=1' }, { courseId: -1, studentId: 42 }]) {
    await assert.rejects(f.schoolDevice.read('history', params), { code: 'INVALID_HISTORY_QUERY' });
  }
  await assert.rejects(f.schoolDevice.read('history', { courseId: 3, studentId: 43 }, recoveryAccount), { code: 'AUTH_REQUIRED' });
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
  assert.equal(f.calls.some(call => call.url === rollcallsUrl), true);
});


test('settings timetable switch controls the real saved preference and preview stays local', async () => {
  for (const preview of [false, true]) {
    const raw = cacheEnvelope({ version: 1, refreshSchedule: false });
    const f = fixture(preview ? undefined : new Map([[cacheName, raw]]));
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
      assert.deepEqual(JSON.parse(f.files.get(cacheName)), { version: 3, learning: { version: 1, refreshSchedule: true }, session: null });
      const reopened = fixture(f.files); await reopened.learning.restore();
      assert.equal(pages(reopened).render().state.refreshSchedule, true);
    }
  }
});


const ordinaryPaths = ['/api/my-courses', '/api/semesters', '/api/radar/rollcalls', '/api/todos'];
const timetablePaths = ['/gsapp/sys/wdkbapp/modules/xskcb/kfdxnxqcx.do', '/gsapp/sys/wdkbapp/wdkcb/getZcxx.do', '/gsapp/sys/wdkbapp/wdkcb/queryXspkjg.do'];
test('every ordinary page header and pull callback uses the same setting-controlled batch and school todo previews', async () => {
  for (const enabled of [false, true]) {
    const f = await boundFixture(learningFixture({ refreshSchedule: enabled })); await f.learning.restore();
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
    const learning = learningFixture({ account: { ...recoveryAccount, name: '缓存账号' }, refreshSchedule: enabled });
    const f = await boundFixture(learning), gate = deferred(), app = pages(f);
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
    const learning = learningFixture({ todosAt: monday,
      ...(rows && { schedule: { jwTermCode: '20261', name: '测试学期', currentWeek: 8, weeks: [8], weekAt: monday, rows }, scheduleAt: monday }) });
    const f = fixture(new Map([[cacheName, cacheEnvelope(learning)]]));
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
  const learning = learningFixture({ todosAt: monday,
    schedule: { jwTermCode: '20261', name: '测试学期', currentWeek: 8, weeks: [8], weekAt: monday, rows: [row] }, scheduleAt: monday });
  const f = fixture(new Map([[cacheName, cacheEnvelope(learning)]])), app = pages(f);
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
    { ...todo, id: 3, end_time: null },
  ];
  const f = fixture(new Map([[cacheName, cacheEnvelope(learningFixture({ todos: items }))]]));
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
