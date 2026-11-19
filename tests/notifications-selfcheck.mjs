import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as schedule from '../src/schedule.ts';
import * as learning from '../src/learning.ts';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const flush = () => new Promise(resolve => setImmediate(resolve));
const monday = (hour, minute = 0) => new Date(2026, 10, 16, hour, minute).getTime();
const lesson = (id, start, end) => ({ WID: id, BJDM: id, KCMC: id, XQ: 1, KSJCDM: 1, JSJCDM: 2,
  KSSJ: start, JSSJ: end, ZCMC: '9周', JCFADM: '1', JASMC: '', JSXM: '' });
const calendar = rows => ({ weekAt: monday(12), currentWeek: 9, weeks: [9, 10], rows });

function load(path, dependencies, globals = {}) {
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  runInNewContext(source, { exports, __DEV__: true, setTimeout, clearTimeout,
    require: name => name in dependencies ? dependencies[name] : require(name), ...globals });
  return exports;
}

function schoolFixture(files = new Map(), accountId = 41, rows = [lesson('course', '10:00', '10:50')]) {
  let now = monday(9), current = 'job-1', onStop;
  const scheduled = [], finished = [], notices = [], dismissed = [], calls = [], timers = new Map();
  const account = { lntId: accountId, studentNumber: '0041', name: '个人信息' };
  const courses = [{ id: 1, course_code: 'course', name: '学校课程', semester_id: 1 }];
  const cached = { version: 1, account, term: { id: 1, name: '本学期' }, courses, coursesAt: now,
    todos: [], todosAt: now, rollcalls: [], attendance: { '83': 'success' }, history: [], historyAt: null, refreshSchedule: false,
    scheduleAt: now, schedule: { ...calendar(rows), jwTermCode: '20261', name: '秋季' } };
  class File {
    constructor(_root, name) { this.uri = name; }
    get exists() { return files.has(this.uri); }
    async text() { return fixture.readFile(this.uri); }
    write(value) { files.set(this.uri, value); }
    delete() { fixture.deleteFile(this.uri); }
  }
  const pending = { rollcall_id: 81, course_id: 1, is_number: true, course_title: '隐私课程' };
  const job = { async schedule(at) { scheduled.push(at); }, async cancel() { current = null; },
    async finish(token, at) { finished.push([token, at]); }, isCurrent: token => token === current,
    post: (...args) => fixture.post(...args),
    addListener(_event, listener) { onStop = listener; return { remove() { onStop = undefined; } }; } };
  const fixture = { files, scheduled, finished, notices, dismissed, calls, account, permission: true, isCurrent: job.isCurrent,
    readFile: uri => files.get(uri),
    deleteFile: uri => files.delete(uri),
    async moveFile({ from, to }) { files.set(to, files.get(from)); files.delete(from); },
    getPermissions: async () => ({ granted: fixture.permission }),
    loadLearning: async () => ({ raw: files.get('learning') ?? JSON.stringify(cached), account }),
    saveLearning: async value => { files.set('learning', value); },
    async advance(at) { now = at; for (const [timer, time] of timers) if (time <= now) { timers.delete(timer); timer(); } await flush(); },
    stop(token = current) { if (current === token) current = null; onStop?.({ token }); },
    read: async () => ({ rollcalls: [pending, { ...pending, rollcall_id: 82, status: 'on_call_fine' }, { ...pending, rollcall_id: 83 }] }),
    async post(token, identifier, endAt, rollcallId) {
      if (!job.isCurrent(token) || now >= endAt) return false;
      assert.equal(rollcallId, '81');
      notices.push(identifier);
      return true;
    },
  };
  const device = { load: () => fixture.loadLearning(),
    save: value => fixture.saveLearning(value),
    answerNumber: (...args) => fixture.answerNumber(...args),
    async clear() {},
    async read(action, _params, expected, signal) {
      calls.push([action, expected, signal]);
      if (action === 'rollcalls') return fixture.read(signal);
      if (action === 'profile') return { id: account.lntId, user_no: account.studentNumber, name: account.name };
      if (action === 'todos') return { todo_list: [] };
      if (action === 'lntTerms') return fixture.readTerms?.() ?? { semesters: [{ id: 1, name: '本学期', is_active: true }] };
      if (action === 'courses') return { courses };
      if (action === 'history') return fixture.readHistory();
      if (action === 'jwSchedule') return { success: true, pkjgList: fixture.scheduleRows };
      throw Error('UNEXPECTED_READ');
    } };
  Object.assign(fixture, load('../src/school-reminder-device.ts', {
    'react-native': { Platform: { OS: 'android' } }, expo: { requireOptionalNativeModule: () => job },
    'expo-crypto': { randomUUID }, 'expo-file-system': { File, Paths: { document: '' } },
    'expo-file-system/legacy': { moveAsync: options => fixture.moveFile(options) },
    'expo-notifications': { AndroidImportance: { HIGH: 4, NONE: 0 }, AndroidNotificationVisibility: { PRIVATE: 0 },
      setNotificationChannelAsync: async () => ({ importance: 4 }), getNotificationChannelAsync: async () => ({ importance: 4 }),
      getPermissionsAsync: () => fixture.getPermissions(), requestPermissionsAsync: async () => ({ granted: fixture.permission }),
      dismissNotificationAsync: async identifier => { dismissed.push(identifier); } },
    './learning': learning, './school-device': { schoolDevice: device }, './schedule': schedule,
  }, { AbortController, Date: { now: () => now },
    setTimeout: (callback, ms) => { timers.set(callback, now + ms); return callback; }, clearTimeout: callback => timers.delete(callback) }));
  return fixture;
}

test('the Job saves and publishes pending activities before posting, then saves an empty result', async () => {
  const fixture = schoolFixture();
  await fixture.schoolLearning.restore();
  await fixture.setSchoolReminders(true);
  await fixture.advance(monday(10));
  const published = [];
  const unsubscribe = fixture.schoolLearning.subscribe(() => published.push(fixture.schoolLearning.getSnapshot().rollcalls.map(item => item.id)));
  const save = fixture.saveLearning;
  let release;
  fixture.saveLearning = value => new Promise(resolve => { release = () => resolve(save(value)); });
  const running = fixture.runSchoolReminderJob('job-1');
  await flush();
  assert.equal(typeof release, 'function');
  assert.deepEqual(published, []);
  assert.deepEqual(fixture.notices, []);
  release();
  await flush();
  assert.deepEqual(published, [['81']]);
  assert.deepEqual(JSON.parse(fixture.files.get('learning')).rollcalls.map(item => item.id), ['81']);
  assert.equal(fixture.notices.length, 1);
  fixture.saveLearning = save;
  fixture.read = async () => ({ rollcalls: [] });
  await fixture.advance(monday(10) + 30000);
  assert.deepEqual(published, [['81'], []]);
  assert.deepEqual(JSON.parse(fixture.files.get('learning')).rollcalls, []);
  assert.equal(fixture.notices.length, 1);
  unsubscribe();
  fixture.stop();
  await running;
});

for (const stage of ['submitting', 'receipt open', 'receipt dismissed']) {
  test(`the Job skips posting when attendance is ${stage} during notice saving`, async () => {
    const fixture = schoolFixture();
    await fixture.schoolLearning.restore();
    await fixture.setSchoolReminders(true);
    await fixture.advance(monday(10));
    const moveFile = fixture.moveFile;
    const noticeSave = Promise.withResolvers();
    fixture.moveFile = async options => { await noticeSave.promise; await moveFile(options); };
    const running = fixture.runSchoolReminderJob('job-1');
    await flush();
    assert.ok(fixture.files.has('school-reminders.tmp'), 'the Job is saving the notice before posting');
    assert.deepEqual(fixture.schoolLearning.getSnapshot().rollcalls.map(item => item.id), ['81']);

    const receipt = Promise.withResolvers();
    fixture.answerNumber = () => receipt.promise;
    const submitted = fixture.schoolLearning.submitNumber('81', '0206');
    const complete = () => receipt.resolve({ result: 'success', message: '签到成功' });
    if (stage !== 'submitting') {
      complete();
      assert.equal((await submitted).result, 'success');
    }
    if (stage === 'receipt dismissed') fixture.schoolLearning.attendanceDismissed({ ids: ['81'] });

    noticeSave.resolve();
    await flush();
    assert.deepEqual(fixture.notices, []);
    if (stage === 'submitting') {
      complete();
      assert.equal((await submitted).result, 'success');
    }
    if (stage === 'receipt dismissed') {
      await fixture.advance(monday(10) + 30000);
      assert.deepEqual(fixture.schoolLearning.getSnapshot().rollcalls, []);
      assert.deepEqual(JSON.parse(fixture.files.get('learning')).rollcalls, []);
    }
    fixture.stop();
    await running;
  });
}

test('a starting Job shares the foreground activity read and a newer poll still wins the batch', async () => {
  const fixture = schoolFixture();
  await fixture.schoolLearning.restore();
  await fixture.setSchoolReminders(true);
  await fixture.advance(monday(10));
  const activities = Promise.withResolvers(), terms = Promise.withResolvers();
  const read = fixture.read;
  fixture.read = () => activities.promise;
  fixture.readTerms = () => terms.promise;
  const refreshing = fixture.schoolLearning.refresh();
  await flush();
  const running = fixture.runSchoolReminderJob('job-1');
  await flush();
  assert.equal(fixture.calls.filter(([action]) => action === 'rollcalls').length, 1);
  activities.resolve(await read());
  await flush();
  assert.deepEqual(fixture.schoolLearning.getSnapshot().rollcalls.map(item => item.id), ['81']);
  assert.equal(fixture.notices.length, 1);
  fixture.read = async () => ({ rollcalls: [] });
  await fixture.advance(monday(10) + 30000);
  terms.resolve({ semesters: [{ id: 1, name: '本学期', is_active: true }] });
  assert.equal(await refreshing, true);
  assert.deepEqual(fixture.schoolLearning.getSnapshot().rollcalls, []);
  assert.deepEqual(JSON.parse(fixture.files.get('learning')).rollcalls, []);
  assert.equal(await fixture.syncSchoolReminders(), true);
  assert.deepEqual(fixture.scheduled, [monday(9, 50)], 'opening the foreground must leave the active Job alone');
  assert.equal(await fixture.schoolLearning.refresh(), true);
  assert.equal(fixture.calls.filter(([action]) => action === 'rollcalls').length, 2);
  fixture.stop();
  await running;
  fixture.read = async () => ({ rollcalls: [{ id: 81, course_id: 1, is_number: true }] });
  assert.equal(await fixture.schoolLearning.refresh(), true);
  assert.deepEqual(fixture.schoolLearning.getSnapshot().rollcalls.map(item => item.id), ['81']);
});

test('stopping a starting Job releases its shared wait while foreground keeps its batch result', async () => {
  for (const failed of [false, true]) {
    const fixture = schoolFixture();
    await fixture.schoolLearning.restore();
    await fixture.setSchoolReminders(true);
    await fixture.advance(monday(10));
    const previous = fixture.schoolLearning.getSnapshot();
    const activities = Promise.withResolvers();
    const read = fixture.read;
    fixture.read = signal => signal ? Promise.resolve({ rollcalls: [] }) : activities.promise;
    const refreshing = fixture.schoolLearning.refresh();
    await flush();
    let stopped = false;
    const running = fixture.runSchoolReminderJob('job-1').then(() => { stopped = true; });
    await flush();
    fixture.stop();
    await flush();
    assert.equal(stopped, true);
    assert.equal(fixture.schoolLearning.getSnapshot().refreshing, true);
    assert.equal(fixture.calls.filter(([action]) => action === 'rollcalls').length, 1);
    if (failed) activities.reject(Error('NETWORK'));
    else activities.resolve(await read());
    assert.equal(await refreshing, !failed);
    await running;
    assert.deepEqual(fixture.notices, []);
    const snapshot = fixture.schoolLearning.getSnapshot();
    if (failed) {
      assert.strictEqual(snapshot.todos, previous.todos);
      assert.strictEqual(snapshot.rollcalls, previous.rollcalls);
      assert.equal(fixture.files.has('learning'), false);
    } else assert.equal(snapshot.rollcalls[0].id, '81');
  }
});

test('a reminder renewal failure stops the Job without scheduling the next lesson', async () => {
  const fixture = schoolFixture(new Map(), 41, [lesson('first', '10:00', '10:50'), lesson('later', '14:00', '15:00')]);
  await fixture.schoolLearning.restore();
  await fixture.setSchoolReminders(true);
  await fixture.advance(monday(10));
  fixture.read = async () => { throw Object.assign(Error('renewal failed'), { needsLogin: true }); };
  const running = fixture.runSchoolReminderJob('job-1');
  await flush();
  assert.deepEqual(fixture.finished, [['job-1', null]]);
  assert.equal(fixture.schoolLearning.getSnapshot().needsLogin, true);
  assert.deepEqual(fixture.notices, []);
  await running;
});

test('history and a live receipt preserve an empty Job result when saving', async () => {
  const fixture = schoolFixture();
  await fixture.schoolLearning.restore();
  await fixture.setSchoolReminders(true);
  await fixture.advance(monday(10));
  const running = fixture.runSchoolReminderJob('job-1');
  await flush();
  let finishReceipt, finishHistory;
  fixture.answerNumber = () => new Promise(resolve => { finishReceipt = resolve; });
  fixture.readHistory = () => new Promise(resolve => { finishHistory = resolve; });
  const submitted = fixture.schoolLearning.submitNumber('81', '0206');
  const history = fixture.schoolLearning.refreshHistory();
  fixture.read = async () => ({ rollcalls: [] });
  await fixture.advance(monday(10) + 30000);
  assert.deepEqual(fixture.schoolLearning.getSnapshot().rollcalls, []);
  finishHistory({ rollcalls: [] });
  assert.equal(await history, true);
  finishReceipt({ result: 'success', message: '签到成功' });
  assert.equal((await submitted).result, 'success');
  assert.deepEqual(fixture.schoolLearning.getSnapshot().pendingAttendance, { '81': 'success' });
  fixture.schoolLearning.attendanceDismissed({ openIds: [] });
  await flush();
  const restarted = schoolFixture(fixture.files);
  await restarted.schoolLearning.restore();
  assert.deepEqual(restarted.schoolLearning.getSnapshot().rollcalls, []);
  assert.deepEqual(restarted.schoolLearning.getSnapshot().attendance, { '81': 'success', '83': 'success' });
  fixture.stop();
  await running;
});

test('the persisted enabled Job reads only pending LNT activities and dedupes after process restart', async () => {
  const foreground = schoolFixture();
  await foreground.schoolLearning.restore();
  assert.equal(await foreground.setSchoolReminders(true), true);
  assert.deepEqual(foreground.scheduled, [monday(9, 50)]);
  const headless = schoolFixture(foreground.files);
  await headless.advance(monday(10));
  const running = headless.runSchoolReminderJob('job-1');
  await flush();
  assert.equal(headless.calls.length, 1);
  assert.equal(headless.calls[0][0], 'rollcalls');
  assert.equal(headless.calls[0][1].lntId, 41);
  assert.equal(headless.notices.length, 1);
  assert.match(headless.notices[0], /^[\da-f-]{36}$/);
  headless.stop();
  await running;
  assert.deepEqual(headless.finished, []);
  const restarted = schoolFixture(foreground.files);
  await restarted.advance(monday(10, 2));
  const resumed = restarted.runSchoolReminderJob('job-1');
  await flush();
  assert.equal(restarted.notices.length, 0);
  await restarted.advance(monday(11));
  await resumed;
  assert.deepEqual(restarted.finished, [['job-1', null]]);
});

test('an unacknowledged notice retries with the same identifier after restart', async () => {
  const fixture = schoolFixture();
  await fixture.schoolLearning.restore();
  await fixture.setSchoolReminders(true);
  await fixture.advance(monday(10));
  const post = fixture.post;
  fixture.post = async (...args) => {
    assert.equal(await post(...args), true);
    return new Promise(() => {});
  };
  void fixture.runSchoolReminderJob('job-1');
  await flush();
  assert.equal(fixture.notices.length, 1);
  const [identifier] = fixture.notices;
  const restarted = schoolFixture(new Map(fixture.files));
  await restarted.advance(monday(10, 1));
  const running = restarted.runSchoolReminderJob('job-1');
  await flush();
  restarted.stop();
  await running;
  assert.deepEqual(restarted.notices, [identifier]);
});

test('failed notification dispatch retries the same identifier within its window', async () => {
  const fixture = schoolFixture();
  await fixture.schoolLearning.restore();
  assert.equal(await fixture.setSchoolReminders(true), true);
  const post = fixture.post;
  const attempts = [];
  fixture.post = async (...args) => {
    const [, identifier] = args;
    attempts.push(identifier);
    if (attempts.length === 1) throw Error('UNAVAILABLE');
    return post(...args);
  };
  await fixture.advance(monday(10));
  const running = fixture.runSchoolReminderJob('job-1');
  await flush();
  assert.equal(attempts.length, 1);
  assert.equal(fixture.notices.length, 0);
  assert.deepEqual(JSON.parse(fixture.files.get('school-reminders.json')).issued['81'], { identifier: attempts[0], delivered: false });
  assert.deepEqual(fixture.dismissed, []);
  await fixture.advance(monday(10) + 30000);
  assert.equal(fixture.calls.length, 1);
  await fixture.advance(monday(10, 1));
  assert.equal(fixture.notices.length, 1);
  assert.deepEqual(attempts, [fixture.notices[0], fixture.notices[0]]);
  fixture.stop();
  await running;
});

test('Job preflight leaves transient permission and storage errors to native retry', async () => {
  const foreground = schoolFixture();
  await foreground.schoolLearning.restore();
  await foreground.setSchoolReminders(true);
  for (const failure of ['getPermissions', 'readFile']) {
    const headless = schoolFixture(foreground.files);
    await headless.advance(monday(10));
    headless[failure] = () => { throw Error('TEMPORARILY_UNAVAILABLE'); };
    await headless.runSchoolReminderJob('job-1');
    assert.deepEqual(headless.calls, []);
    assert.deepEqual(headless.finished, [], failure);
  }
  const denied = schoolFixture(foreground.files);
  denied.permission = false;
  await denied.runSchoolReminderJob('job-1');
  assert.deepEqual(denied.finished, [['job-1', null]]);
});

test('a failed learning load leaves the Job retryable in the same process', async () => {
  const foreground = schoolFixture();
  await foreground.schoolLearning.restore();
  await foreground.setSchoolReminders(true);
  const headless = schoolFixture(foreground.files);
  await headless.advance(monday(10));
  const loadLearning = headless.loadLearning;
  let loads = 0;
  headless.loadLearning = async () => {
    if (++loads === 1) throw Error('TEMPORARILY_UNAVAILABLE');
    return loadLearning();
  };
  const failed = headless.runSchoolReminderJob('job-1');
  await failed;
  assert.equal(loads, 1);
  assert.equal(headless.schoolLearning.getSnapshot().ready, true);
  assert.match(headless.schoolLearning.getSnapshot().message, /读取失败/);
  assert.deepEqual(headless.calls, []);
  assert.deepEqual(headless.finished, []);
  const retry = headless.runSchoolReminderJob('job-1');
  await flush();
  assert.equal(loads, 2);
  assert.equal(headless.schoolLearning.getSnapshot().message, null);
  assert.equal(headless.notices.length, 1);
  await headless.advance(monday(11));
  await retry;
  assert.deepEqual(headless.finished, [['job-1', null]]);
  const signedOut = schoolFixture();
  signedOut.loadLearning = async () => ({ raw: null, account: null });
  await signedOut.runSchoolReminderJob('job-1');
  assert.deepEqual(signedOut.finished, [['job-1', null]]);
});

test('the window deadline aborts a slow query and schedules the next lesson', async () => {
  const fixture = schoolFixture(new Map(), 41, [lesson('first', '10:00', '10:50'), lesson('later', '14:00', '15:00')]);
  await fixture.schoolLearning.restore();
  await fixture.setSchoolReminders(true);
  await fixture.advance(monday(10, 58));
  fixture.read = signal => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('ABORT')), { once: true }));
  const running = fixture.runSchoolReminderJob('job-1');
  assert.equal(fixture.runSchoolReminderJob('job-1'), running);
  await flush();
  await fixture.advance(monday(10, 59));
  assert.equal(fixture.calls.length, 1);
  await fixture.advance(monday(11));
  await running;
  assert.equal(fixture.calls[0][2].aborted, true);
  assert.equal(fixture.notices.length, 0);
  assert.deepEqual(fixture.finished, [['job-1', monday(13, 50)]]);
});

test('a timetable refresh replaces the Job only if the current window changes', async () => {
  for (const changed of [false, true]) {
    const fixture = schoolFixture(new Map(), 41, [lesson('first', '10:00', '10:50'), lesson('later', '14:00', '15:00')]);
    await fixture.schoolLearning.restore();
    await fixture.schoolLearning.setRefreshSchedule(true);
    await fixture.setSchoolReminders(true);
    await fixture.advance(monday(10));
    const running = fixture.runSchoolReminderJob('job-1');
    await flush();
    fixture.scheduleRows = [lesson('first', '10:00', changed ? '10:40' : '10:50'), lesson('later', '15:00', '16:00')];
    assert.equal(await fixture.schoolLearning.refresh(), true);
    assert.equal(await fixture.syncSchoolReminders(), true);
    assert.deepEqual(fixture.scheduled, changed ? [monday(9, 50), monday(10)] : [monday(9, 50)]);
    assert.equal(fixture.calls.filter(([action]) => action === 'rollcalls').length, 1);
    if (!changed) await fixture.advance(monday(11));
    await running;
    assert.deepEqual(fixture.finished, changed ? [] : [['job-1', monday(14, 50)]]);
  }
});

test('permission refusal prevents jobs and disabling stops an in-flight read and survives restart', async () => {
  const fixture = schoolFixture();
  await fixture.schoolLearning.restore();
  fixture.permission = false;
  assert.equal(await fixture.setSchoolReminders(true), false);
  assert.deepEqual(fixture.scheduled, []);
  fixture.permission = true;
  await fixture.setSchoolReminders(true);
  await fixture.advance(monday(10));
  let respond;
  fixture.read = () => new Promise(resolve => { respond = resolve; });
  const running = fixture.runSchoolReminderJob('job-1');
  await flush();
  assert.equal(await fixture.setSchoolReminders(false), true);
  assert.equal(fixture.calls[0][2].aborted, true);
  respond({ rollcalls: [{ id: 81, course_id: 1 }] });
  await running;
  assert.deepEqual(fixture.notices, []);
  assert.deepEqual(fixture.finished, []);
  const restarted = schoolFixture(fixture.files);
  await restarted.advance(monday(10, 1));
  await restarted.runSchoolReminderJob('job-1');
  assert.deepEqual(restarted.calls, []);
  assert.deepEqual(restarted.finished, [['job-1', null]]);
});

test('logout cleanup retries failed reminder deletion with no current account', async () => {
  const fixture = schoolFixture();
  await fixture.schoolLearning.restore();
  await fixture.setSchoolReminders(true);
  const saved = 'school-reminders.json';
  fixture.files.set(saved.replace(/\.json$/, '.tmp'), fixture.files.get(saved));
  const remove = fixture.deleteFile;
  fixture.deleteFile = () => { throw Error('TEMPORARILY_UNAVAILABLE'); };
  const clearing = fixture.clearSchoolReminders();
  assert.equal(await fixture.schoolLearning.logout(), true);
  await assert.rejects(clearing, /TEMPORARILY_UNAVAILABLE/);
  fixture.deleteFile = remove;
  assert.equal(fixture.schoolLearning.getSnapshot().account, null);
  await fixture.clearSchoolReminders();
  assert.equal(fixture.files.size, 0);
});

for (const [action, stop] of [
  ['system stop', fixture => fixture.stop()],
  ['disable', fixture => fixture.setSchoolReminders(false)],
  ['logout', fixture => fixture.clearSchoolReminders()],
  ['window expiry', fixture => fixture.advance(monday(11))],
]) {
  test(`${action} drops a queued native post without marking it delivered`, async () => {
    const fixture = schoolFixture();
    await fixture.schoolLearning.restore();
    await fixture.setSchoolReminders(true);
    await fixture.advance(monday(10));
    let deliver, identifier, stopped = false;
    const post = fixture.post;
    fixture.post = (...args) => new Promise(resolve => {
      const [token, id, endAt] = args;
      assert.equal(token, 'job-1');
      assert.equal(endAt, monday(11));
      identifier = id;
      deliver = async () => resolve(await post(...args));
    });
    const running = fixture.runSchoolReminderJob('job-1').then(() => { stopped = true; });
    await flush();
    assert.ok(deliver);
    assert.equal(JSON.parse(fixture.files.get('school-reminders.json')).issued['81'].identifier, identifier);
    const cancellation = stop(fixture);
    await flush();
    const wasCurrent = fixture.isCurrent('job-1'), hadStopped = stopped;
    await deliver();
    await cancellation;
    await running;
    await flush();
    assert.equal(wasCurrent, action === 'window expiry');
    assert.equal(hadStopped, true, 'headless task returns while the native post is pending');
    assert.deepEqual(fixture.notices, []);
    assert.deepEqual(fixture.dismissed, []);
    assert.deepEqual(fixture.finished, action === 'window expiry' ? [['job-1', null]] : []);
    if (action !== 'logout') assert.equal(JSON.parse(fixture.files.get('school-reminders.json')).issued['81'].delivered, false);
    if (action === 'window expiry') return;
    const restarted = schoolFixture(fixture.files);
    await restarted.advance(monday(10, 1));
    const retry = restarted.runSchoolReminderJob('job-1');
    await flush();
    restarted.stop();
    await retry;
    assert.deepEqual(restarted.notices, action === 'system stop' ? [identifier] : []);
  });
}

test('cold and warm taps wait for local readiness and open the given ID even when signed out', async () => {
  const makeResponse = (identifier, data) => ({ actionIdentifier: 'default', notification: { request: { identifier, content: { data } } } });
  const cold = makeResponse('cold', { source: 'school', rollcallId: '81' });
  let last = cold, listener, cleanup, cleared = 0, removed = 0, ready = false, key;
  const routes = [];
  const api = { DEFAULT_ACTION_IDENTIFIER: 'default',
    addNotificationResponseReceivedListener(callback) { listener = callback; return { remove() { removed++; } }; },
    getLastNotificationResponse: () => last,
    clearLastNotificationResponse: () => { last = null; cleared++; },
  };
  const bridge = load('../src/attendance-notification-bridge.tsx', {
    react: { useEffect: effect => { cleanup = effect(); } }, 'react-native': { Platform: { OS: 'android' } },
    'expo-router': { router: { push: route => routes.push(route) }, useRootNavigationState: () => ({ key }) },
    'expo-notifications': api, './demo-context': { useDemo: () => ({ data: { ready, authenticated: false, account: null, rollcalls: [] } }) },
  });
  bridge.AttendanceNotificationBridge(); await flush();
  assert.equal(listener, undefined);
  key = 'root';
  bridge.AttendanceNotificationBridge(); await flush();
  assert.equal(listener, undefined);
  ready = true;
  bridge.AttendanceNotificationBridge(); await flush();
  listener(cold); await flush();
  assert.deepEqual(routes.map(route => route.params.id), ['81']);
  assert.equal(cleared, 1);
  listener(last = makeResponse('foreign', { source: 'other', rollcallId: '82' })); await flush();
  listener(last = makeResponse('legacy', { source: 'school' })); await flush();
  listener(last = makeResponse('ended', { source: 'school', rollcallId: '99' }));
  assert.equal(last, null, 'the handled response is cleared before the next event can arrive');
  assert.deepEqual(routes.map(route => [route.pathname, route.params.id]), [['/attendance', '81'], ['/attendance', '99']]);
  assert.equal(cleared, 4);
  cleanup();
  assert.equal(removed, 1);
  listener(makeResponse('after-cleanup', { source: 'school', rollcallId: '100' })); await flush();
  assert.equal(routes.length, 2);
});
