import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRollcallReminder, attendanceDestination } from '../src/attendance-reminders.ts';
import { createAttendanceTrial } from '../src/attendance-trial.ts';
import * as schedule from '../src/schedule.ts';
import * as learning from '../src/learning.ts';
import * as reminders from '../src/attendance-reminders.ts';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { spawnSync } from 'node:child_process';
import React from 'react';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const flush = () => new Promise(resolve => setImmediate(resolve));
const monday = (hour, minute = 0) => new Date(2026, 10, 16, hour, minute).getTime();
const lesson = (id, start, end) => ({ WID: id, BJDM: id, KCMC: id, XQ: 1, KSJCDM: 1, JSJCDM: 2,
  KSSJ: start, JSSJ: end, ZCMC: '9周', JCFADM: '1', JASMC: '', JSXM: '' });
const calendar = rows => ({ weekAt: monday(12), currentWeek: 9, weeks: [9, 10], rows });

test('overlapping courses keep separate reminder windows and expired windows are skipped', () => {
  const cached = calendar([lesson('later', '10:55', '11:40'), lesson('first', '10:00', '10:50')]);
  assert.deepEqual(schedule.nextReminderWindow(cached, monday(9)), { start: monday(9, 50), end: monday(11) });
  assert.deepEqual(schedule.nextReminderWindow(cached, monday(10, 49)), { start: monday(9, 50), end: monday(11) });
  assert.deepEqual(schedule.nextReminderWindow(cached, monday(11)), { start: monday(10, 45), end: monday(11, 50) });
  assert.equal(schedule.nextReminderWindow(cached, monday(11, 50)), null);
  const nextWeek = schedule.nextReminderWindow({ ...cached, rows: [{ ...cached.rows[0], ZCMC: '10周' }] }, monday(23));
  assert.equal(nextWeek.start, new Date(2026, 10, 23, 10, 45).getTime());
});

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
  const scheduled = [], finished = [], notices = [], calls = [], timers = new Map();
  const account = { lntId: accountId, studentNumber: '0041', name: '个人信息' };
  const cached = { version: 1, account, term: { id: 1, name: '本学期' }, courses: [], coursesAt: now,
    todos: [], todosAt: now, rollcalls: [], attendance: { '83': 'success' }, history: [], historyAt: null, refreshSchedule: false,
    scheduleAt: now, schedule: { ...calendar(rows), jwTermCode: '20261', name: '秋季' } };
  class File {
    constructor(_root, name) { this.uri = name; }
    get exists() { return files.has(this.uri); }
    async text() { return files.get(this.uri); }
    write(value) { files.set(this.uri, value); }
    delete() { files.delete(this.uri); }
  }
  const pending = { rollcall_id: 81, course_id: 1, is_number: true, course_title: '隐私课程' };
  const job = { async schedule(at) { scheduled.push(at); }, async cancel() { current = null; },
    async finish(token, at) { finished.push([token, at]); }, isCurrent: token => token === current,
    addListener(_event, listener) { onStop = listener; return { remove() { onStop = undefined; } }; } };
  const fixture = { files, scheduled, finished, notices, calls, account, permission: true,
    async advance(at) { now = at; for (const [timer, time] of timers) if (time <= now) { timers.delete(timer); timer(); } await flush(); },
    stop(token = current) { if (current === token) current = null; onStop?.({ token }); },
    read: async () => ({ rollcalls: [pending, { ...pending, rollcall_id: 82, status: 'on_call_fine' }, { ...pending, rollcall_id: 83 }] }),
    notify: async notice => { notices.push(notice); return notice.identifier; },
  };
  const device = { load: async () => ({ raw: JSON.stringify(cached), account }),
    async save() {},
    async read(action, _params, expected, signal) {
      calls.push([action, expected, signal]);
      if (action === 'rollcalls') return fixture.read(signal);
      if (action === 'profile') return { id: account.lntId, user_no: account.studentNumber, name: account.name };
      if (action === 'todos') return { todo_list: [] };
      if (action === 'lntTerms') return { semesters: [{ id: 1, name: '本学期', is_active: true }] };
      if (action === 'courses') return { courses: [] };
      throw Error('UNEXPECTED_READ');
    } };
  Object.assign(fixture, load('../src/school-reminder-device.ts', {
    'react-native': { Platform: { OS: 'android' } }, expo: { requireOptionalNativeModule: () => job },
    'expo-crypto': { randomUUID }, 'expo-file-system': { File, Paths: { document: '' } },
    'expo-file-system/legacy': { moveAsync: async ({ from, to }) => { files.set(to, files.get(from)); files.delete(from); } },
    'expo-notifications': { AndroidImportance: { HIGH: 4, NONE: 0 }, AndroidNotificationVisibility: { PRIVATE: 0 },
      setNotificationChannelAsync: async () => ({ importance: 4 }), getNotificationChannelAsync: async () => ({ importance: 4 }),
      getPermissionsAsync: async () => ({ granted: fixture.permission }), requestPermissionsAsync: async () => ({ granted: fixture.permission }),
      scheduleNotificationAsync: notice => fixture.notify(notice) },
    './learning': learning, './school-device': { schoolDevice: device }, './schedule': schedule,
  }, { AbortController, Date: { now: () => now },
    setTimeout: (callback, ms) => { timers.set(callback, now + ms); return callback; }, clearTimeout: callback => timers.delete(callback) }));
  return fixture;
}

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
  assert.equal(headless.notices[0].content.data.source, 'school');
  assert.equal(headless.notices[0].content.data.rollcallId, undefined);
  assert.doesNotMatch(JSON.stringify(headless.notices), /隐私课程|个人信息|0041/);
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

test('failed notification dispatch releases the claim and the serial loop retries within its window', async () => {
  const fixture = schoolFixture();
  await fixture.schoolLearning.restore();
  assert.equal(await fixture.setSchoolReminders(true), true);
  const send = fixture.notify;
  let attempts = 0;
  fixture.notify = async notice => {
    if (++attempts === 1) throw Error('UNAVAILABLE');
    return send(notice);
  };
  await fixture.advance(monday(10));
  const running = fixture.runSchoolReminderJob('job-1');
  await flush();
  assert.equal(attempts, 1);
  assert.equal(fixture.notices.length, 0);
  await fixture.advance(monday(10) + 30000);
  assert.equal(fixture.calls.length, 1);
  await fixture.advance(monday(10, 1));
  assert.equal(fixture.notices.length, 1);
  fixture.stop();
  await running;
});

test('the window deadline aborts a slow query and hands off once to the overlapping course', async () => {
  const fixture = schoolFixture(new Map(), 41, [lesson('first', '10:00', '10:50'), lesson('later', '10:55', '11:40')]);
  await fixture.schoolLearning.restore();
  await fixture.setSchoolReminders(true);
  await fixture.advance(monday(10, 49));
  fixture.read = signal => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('ABORT')), { once: true }));
  const running = fixture.runSchoolReminderJob('job-1');
  assert.equal(fixture.runSchoolReminderJob('job-1'), running);
  await flush();
  await fixture.advance(monday(10, 50));
  assert.equal(fixture.calls.length, 1);
  await fixture.advance(monday(11));
  await running;
  assert.equal(fixture.calls[0][2].aborted, true);
  assert.equal(fixture.notices.length, 0);
  assert.deepEqual(fixture.finished, [['job-1', monday(11)]]);
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

test('school taps resolve an issued notice through a fresh pending read across process and account refresh', async () => {
  const fixture = schoolFixture();
  await fixture.schoolLearning.restore();
  await fixture.setSchoolReminders(true);
  await fixture.advance(monday(10));
  const running = fixture.runSchoolReminderJob('job-1');
  await flush();
  fixture.stop();
  await running;
  const { identifier, content } = fixture.notices[0];
  const restarted = schoolFixture(fixture.files);
  const other = schoolFixture(fixture.files, 42);
  const scope = new AbortController();
  assert.equal(await other.openSchoolReminder(identifier, scope.signal), null);
  assert.equal(await restarted.openSchoolReminder(randomUUID(), scope.signal), null);
  assert.equal(other.calls.length + restarted.calls.length, 0);

  const read = restarted.read;
  let deliver;
  restarted.read = signal => signal ? new Promise(resolve => { deliver = resolve; }) : read();
  let responseListener, cleanup;
  const routes = [];
  const response = (id, data) => ({ actionIdentifier: 'default', notification: { request: { identifier: id, content: { data } } } });
  const api = { DEFAULT_ACTION_IDENTIFIER: 'default', setNotificationHandler() {},
    addNotificationResponseReceivedListener(listener) { responseListener = listener; return { remove() {} }; },
    getLastNotificationResponseAsync: async () => response(identifier, { ...content.data, rollcallId: 'forged' }),
    clearLastNotificationResponseAsync: async () => {},
  };
  const bridge = load('../src/attendance-notification-bridge.tsx', {
    react: { useEffect: effect => { cleanup = effect(); } }, 'react-native': { Platform: { OS: 'android' } },
    'expo-router': { router: { push: value => routes.push(value.params.id) }, useRootNavigationState: () => ({ key: 'root' }) },
    './demo-context': { useDemo: () => ({ real: true }) }, './attendance-reminders': reminders,
    './school-reminder-device': restarted,
    './attendance-trial-device': load('../src/attendance-trial-device.ts', { 'expo-notifications': api }),
  }, { AbortController });
  bridge.AttendanceNotificationBridge();
  await flush();
  const coldAccount = restarted.schoolLearning.getSnapshot().account;
  assert.equal(await restarted.schoolLearning.refresh(), true);
  assert.notEqual(restarted.schoolLearning.getSnapshot().account, coldAccount);
  deliver(await read());
  await flush();
  assert.deepEqual(routes, ['81']);
  responseListener(response(randomUUID(), { source: 'school', rollcallId: '81' }));
  await flush();
  assert.deepEqual(routes, ['81']);
  assert.equal(restarted.schoolLearning.getSnapshot().rollcalls.find(item => item.id === '81').method, 'number');
  restarted.read = async () => ({ rollcalls: [] });
  assert.equal(await restarted.openSchoolReminder(identifier, scope.signal), null);
  cleanup();
});

test('activity discovery sends one notification carrying only its source and id', async () => {
  const sent = [];
  const notify = createRollcallReminder(async content => { sent.push(content); });
  const activity = { id: '81', courseId: '301', title: '学校课程', method: 'number', time: '' };
  await notify([activity], 'school');
  await notify([activity], 'school');
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].data, { source: 'school', rollcallId: '81' });
  assert.equal(sent[0].title, '有新的签到活动');
  assert.deepEqual(attendanceDestination(sent[0].data), { pathname: '/attendance', params: { id: '81' } });
  assert.equal(attendanceDestination({ source: 'other', rollcallId: '81' }), null);
});

function deviceFixture(saved = null) {
  let now = 1000000, task, wake, wakePending = false;
  const notices = [];
  const device = {
    now: () => now,
    load: async () => saved,
    save: async value => { saved = value; },
    requestPermission: async () => true,
    start: async run => { task = run(); },
    stop: async () => { wake?.(); },
    wait: () => new Promise(resolve => {
      if (wakePending) { wakePending = false; resolve(); }
      else wake = () => { wake = undefined; resolve(); };
    }),
    wake: () => { if (wake) wake(); else wakePending = true; },
    notify: async value => { notices.push(value); },
  };
  const flush = () => new Promise(resolve => setImmediate(resolve));
  return { device, notices, get saved() { return saved; },
    async advance(ms) { now += ms; wake?.(); await flush(); },
    flush, async done() { await task; } };
}

test('the background read discovers a due activity, persists it and sends an immediate notification', async () => {
  const device = deviceFixture();
  const trial = createAttendanceTrial(device.device, true);
  await trial.start();
  const id = await trial.queue('number', 'success');
  assert.equal(device.notices.length, 0, 'queuing is not scheduling a system notification');
  assert.equal(JSON.parse(device.saved).events[0].availableAt, 1015000);
  await device.advance(14999);
  assert.equal(device.notices.length, 0, 'the selected activity is unavailable before 15 seconds');
  await device.advance(5001);
  assert.equal(device.notices.length, 1);
  assert.deepEqual(device.notices[0].data, { source: 'trial', rollcallId: id });
  assert.equal(trial.getSnapshot().rollcalls[0].id, id);
  assert.ok(JSON.parse(device.saved).events[0].discoveredAt);
  await trial.stop();
  await device.done();
  const restored = createAttendanceTrial(deviceFixture(device.saved).device, true);
  await restored.restore();
  assert.equal(restored.getSnapshot().running, false);
  assert.equal(restored.isTrialRollcall(id), true, 'cold-start click can resolve the same activity');
  assert.equal((await restored.submitNumber(id, '0206')).result, 'success');
  assert.equal(restored.getSnapshot().pendingAttendance[id], 'success');
  restored.attendanceDismissed({ ids: [id] });
  assert.equal(restored.getSnapshot().attendance[id], 'success');
});

test('an immediate activity wakes the same discovery loop without advancing time or duplicate delivery', async () => {
  const fixture = deviceFixture();
  const trial = createAttendanceTrial(fixture.device, true);
  await trial.start(); await fixture.flush();
  const id = await trial.queue('qr', 'success', 0);
  await fixture.flush();
  assert.equal(fixture.notices.length, 1);
  assert.equal(fixture.notices[0].data.rollcallId, id);
  assert.equal(trial.getSnapshot().logs.find(item => item.event === 'discovered').delayMs, 0);
  await fixture.advance(20000);
  assert.equal(fixture.notices.length, 1);
  await trial.stop(); await fixture.done();
});

test('permission refusal and a disabled trial never start the background service', async () => {
  const device = deviceFixture();
  let starts = 0, permissions = 0, loads = 0;
  device.device.start = async () => { starts++; };
  device.device.requestPermission = async () => { permissions++; return false; };
  device.device.load = async () => { loads++; return null; };
  const production = createAttendanceTrial(device.device, false);
  await production.restore(); await production.start(); await production.queue('number', 'success'); await production.stop();
  assert.deepEqual([starts, permissions, loads], [0, 0, 0]);
  assert.equal((await production.submit('trial-1-1')).result, 'failed');
  const development = createAttendanceTrial(device.device, true);
  await development.start();
  assert.deepEqual([starts, permissions, loads], [0, 1, 1]);
  assert.match(development.getSnapshot().message, /通知权限未允许/);
});

test('stop prevents pending discovery and the trial expires after five minutes', async () => {
  const device = deviceFixture();
  const trial = createAttendanceTrial(device.device, true);
  await trial.start(); await trial.queue('qr', 'ended'); await trial.stop(); await device.done();
  await device.advance(40000);
  assert.equal(device.notices.length, 0);
  await trial.start(); await device.flush();
  await device.advance(300000); await device.done();
  assert.equal(trial.getSnapshot().running, false);
  assert.equal(trial.getSnapshot().logs.at(-1).event, 'expired');
});

test('notification failure retries at the next read without duplicate successful delivery', async () => {
  const device = deviceFixture();
  const send = device.device.notify;
  let failed = false;
  device.device.notify = async notice => { if (!failed) { failed = true; throw Error('private-device-info'); } await send(notice); };
  const trial = createAttendanceTrial(device.device, true);
  await trial.start(); await trial.queue('radar', 'failed'); await device.advance(40000);
  assert.equal(device.notices.length, 0);
  await device.advance(20000); await device.advance(20000);
  assert.equal(device.notices.length, 1);
  assert.ok(trial.getSnapshot().logs.some(item => item.event === 'notification-failed'));
  assert.equal(device.saved.includes('private-device-info'), false);
  await trial.stop(); await device.done();
});

test('a sheet closed while its simulated receipt is being saved does not leave a pending home card', async () => {
  const id = 'trial-1-1';
  const device = deviceFixture(JSON.stringify({ version: 1, logs: [], events: [
    { id, method: 'qr', outcome: 'success', availableAt: 1, discoveredAt: 2, notifiedAt: 2 },
  ] }));
  const trial = createAttendanceTrial(device.device, true);
  await trial.restore();
  let finish;
  device.device.save = () => new Promise(resolve => { finish = resolve; });
  const submitted = trial.submit(id);
  await flush(); trial.opened();
  assert.equal(trial.getSnapshot().attendance[id], undefined, 'a concurrent log cannot publish an unpersisted receipt');
  trial.attendanceDismissed({ ids: [id] }); finish();
  assert.equal((await submitted).result, 'success');
  assert.deepEqual(trial.getSnapshot().pendingAttendance, {});
  assert.equal(trial.getSnapshot().attendance[id], 'success');
});

test('failed receipt storage keeps the local activity available for retry', async () => {
  const id = 'trial-1-1';
  const device = deviceFixture(JSON.stringify({ version: 1, logs: [], events: [
    { id, method: 'number', outcome: 'success', availableAt: 1, discoveredAt: 2 },
  ] }));
  const trial = createAttendanceTrial(device.device, true);
  await trial.restore();
  device.device.save = async () => { throw Error('STORAGE'); };
  assert.equal((await trial.submitNumber(id, '0206')).result, 'failed');
  assert.equal(trial.getSnapshot().attendance[id], undefined);
  assert.deepEqual(trial.getSnapshot().pendingAttendance, {});
});

test('concurrent trial saves keep both results and closing B does not dismiss the covered A receipt', async () => {
  const ids = ['trial-1-1', 'trial-1-2'];
  const fixture = deviceFixture(JSON.stringify({ version: 1, logs: [], events:
    ids.map((id, index) => ({ id, method: 'number', outcome: index ? 'ended' : 'success', availableAt: 1, discoveredAt: 2, notifiedAt: 2 })),
  }));
  const trial = createAttendanceTrial(fixture.device, true);
  await trial.restore();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const save = fixture.device.save;
  fixture.device.save = async value => { await gate; await save(value); };
  const a = trial.submitNumber(ids[0], '0206');
  const b = trial.submitNumber(ids[1], '0206');
  await flush();
  assert.equal((await trial.submitNumber(ids[0], '0206')).result, 'failed', 'duplicate A cannot create a second save');
  trial.attendanceDismissed({ ids: [ids[1]] }); release();
  assert.equal((await a).result, 'success');
  assert.equal((await b).result, 'ended');
  assert.deepEqual(trial.getSnapshot().pendingAttendance, { [ids[0]]: 'success' });
  assert.deepEqual(trial.getSnapshot().attendance, { [ids[1]]: 'ended' });
  trial.attendanceDismissed({ ids: [ids[0]] });
  assert.deepEqual(trial.getSnapshot().attendance, { [ids[0]]: 'success', [ids[1]]: 'ended' });
  await flush();
  const reopened = createAttendanceTrial(fixture.device, true); await reopened.restore();
  assert.deepEqual(reopened.getSnapshot().attendance, { [ids[0]]: 'success', [ids[1]]: 'ended' });
});

test('cold and warm notification clicks wait for navigation and restore the exact local activity', async () => {
  const id = 'trial-100-1', routes = [];
  let restore, listener, registered = 0, cleared = 0, ready = false, cleanup;
  const device = deviceFixture();
  device.device.load = () => new Promise(resolve => { restore = resolve; });
  const trial = createAttendanceTrial(device.device, true);
  const response = { actionIdentifier: 'default', notification: { request: { identifier: 'notice1', content: { data: { source: 'trial', rollcallId: id } } } } };
  const native = { DEFAULT_ACTION_IDENTIFIER: 'default',
    setNotificationHandler() {}, addNotificationResponseReceivedListener(callback) { registered++; listener = callback; return { remove() {} }; },
    getLastNotificationResponseAsync: async () => response, clearLastNotificationResponseAsync: async () => { cleared++; },
  };
  const adapter = load('../src/attendance-trial-device.ts', { 'expo-notifications': native });
  const bridge = load('../src/attendance-notification-bridge.tsx', {
    react: { useEffect: effect => { cleanup = effect(); } }, 'react-native': { Platform: { OS: 'android' } },
    'expo-router': { router: { push: route => routes.push(route) }, useRootNavigationState: () => ready ? { key: 'root' } : undefined },
    './demo-context': { useDemo: () => ({ real: true, trial }) }, './attendance-reminders': { attendanceDestination }, './attendance-trial-device': adapter,
    './school-reminder-device': { openSchoolReminder: async () => null },
    }, { AbortController });
  bridge.AttendanceNotificationBridge(); await flush();
  assert.equal(registered, 0);
  ready = true; bridge.AttendanceNotificationBridge(); await flush();
  assert.equal(registered, 1); assert.equal(routes.length, 0);
  restore(JSON.stringify({ version: 1, logs: [], events: [{ id, method: 'number', outcome: 'success', availableAt: 100, discoveredAt: 101 }] }));
  await flush();
  assert.deepEqual(routes, [{ pathname: '/attendance', params: { id } }]);
  listener(response); await flush();
  assert.equal(routes.length, 1, 'duplicate delivery of the cold-start response is ignored');
  listener({ ...response, notification: { request: { identifier: 'notice2', content: { data: { source: 'school', rollcallId: '82' } } } } });
  await flush();
  assert.equal(routes.length, 1, 'an unissued school payload does not navigate');
  assert.equal(cleared, 2);
  cleanup();
});

test('release debug settings run the trial controller and keep notification handling available', async () => {
  const device = deviceFixture();
  const trial = createAttendanceTrial(device.device, true);
  const context = { state: { accountCardStyle: 'stacked', method: 'number', outcome: 'success' }, real: true, data: { account: null }, trial,
    get trialData() { return trial.getSnapshot(); }, dispatch() {} };
  const ui = new Proxy({}, { get: (_target, key) => key === 's' ? {} : String(key), has: () => true });
  const deps = { 'react-native': { Text: 'Text', Platform: { OS: 'android' } },
    'expo-router': { Redirect: 'Redirect', router: {} }, '@/demo-context': { useDemo: () => context },
    '@/debug-options': { accountCardStyles: {}, methods: {}, outcomes: {}, scenarios: {} }, '@/ui': ui };
  const lab = load('../app/lab.tsx', deps, { __DEV__: false });
  const profile = load('../app/(tabs)/profile.tsx', { ...deps, '@/demo-data': {} }, { __DEV__: false });
  const profileTree = profile.default();
  assert.match(JSON.stringify(profileTree), /调试设置/);
  const choices = load('../app/debug-choice.tsx', { ...deps,
    'expo-router': { router: {}, useLocalSearchParams: () => ({ kind: 'method' }) },
  }, { __DEV__: false });
  let event;
  context.dispatch = value => { event = value; };
  const choice = choices.default();
  assert.equal(choice.props.title, '签到方式');
  choice.props.select('qr');
  assert.equal(event.type, 'method');
  assert.equal(event.method, 'qr');

  function find(node, label) {
    if (node?.props?.label === label) return node;
    for (const child of React.Children.toArray(node?.props?.children)) { const match = find(child, label); if (match) return match; }
  }
  find(lab.default(), '启动 5 分钟后台试验').props.onPress(); await flush();
  assert.equal(trial.getSnapshot().running, true);
  find(lab.default(), '立即发起所选模拟签到').props.onPress(); await flush();
  assert.equal(device.notices.length, 1, 'immediate activity wakes the running discovery loop');
  assert.equal(JSON.parse(device.saved).events[0].availableAt, 1000000);
  find(lab.default(), '15 秒后发起所选模拟签到').props.onPress(); await flush();
  assert.equal(JSON.parse(device.saved).events[1].availableAt, 1015000);
  assert.equal(device.notices.length, 1);
  await device.advance(20000); assert.equal(device.notices.length, 2);
  find(lab.default(), '停止后台试验').props.onPress(); await flush(); await device.done();
  assert.equal(trial.getSnapshot().running, false);
  assert.ok(find(lab.default(), '启动 5 分钟后台试验'));
  let subscriptions = 0;
  const bridge = load('../src/attendance-notification-bridge.tsx', {
    react: { useEffect: effect => effect() }, 'react-native': { Platform: { OS: 'android' } },
    'expo-router': { useRootNavigationState: () => ({ key: 'root' }) }, './demo-context': { useDemo: () => ({ trial }) },
    './attendance-reminders': { attendanceDestination }, './attendance-trial-device': { watchAttendanceNotifications: async () => { subscriptions++; return () => {}; } },
    './school-reminder-device': { openSchoolReminder: async () => null },
  }, { __DEV__: false, AbortController });
  bridge.AttendanceNotificationBridge();
  assert.equal(subscriptions, 1);
});

test('the native adapter uses a foreground task and sends only immediate notifications after discovery', async () => {
  let options, stopped = 0, delivered;
  const background = { start: async (run, value) => { options = value; void run(); }, stop: async () => { stopped++; } };
  const api = { scheduleNotificationAsync: async value => { delivered = value; } };
  const { attendanceTrialDevice: device } = load('../src/attendance-trial-device.ts', {
    'react-native-background-actions': { __esModule: true, default: background }, 'expo-notifications': api,
  });
  await device.start(() => device.wait(20000));
  assert.equal(options.taskName, 'AttendanceTrial');
  assert.equal(options.foregroundServiceType.join(), 'dataSync');
  assert.match(options.taskDesc, /5 分钟/);
  await device.notify({ title: '模拟签到活动', body: '点按打开签到', data: { source: 'trial', rollcallId: 'trial-1-1' } });
  assert.equal(delivered.trigger.channelId, 'attendance-trial');
  assert.deepEqual(Object.keys(delivered.trigger), ['channelId'], 'there is no timer or future notification schedule');
  assert.equal(delivered.content.data.rollcallId, 'trial-1-1');
  await device.stop();
  assert.equal(stopped, 1);
});

test('native discovery wake resolves a current wait and survives a wake before the next wait', async () => {
  const timers = new Set();
  const { attendanceTrialDevice: device } = load('../src/attendance-trial-device.ts', {}, {
    setTimeout(callback) { timers.add(callback); return callback; },
    clearTimeout(timer) { timers.delete(timer); },
  });
  let finished = false;
  const waiting = device.wait(20000).then(() => { finished = true; });
  assert.equal(timers.size, 1);
  device.wake(); await waiting;
  assert.equal(finished, true);
  assert.equal(timers.size, 0);
  device.wake(); device.wake();
  finished = false;
  const pending = device.wait(20000).then(() => { finished = true; });
  await flush();
  assert.equal(finished, true, 'wake is retained while discovery or storage work is in progress');
  await pending;
  assert.equal(timers.size, 0);
  const next = device.wait(20000);
  assert.equal(timers.size, 1, 'multiple wakes coalesce into one extra discovery pass');
  device.wake(); await next;
});

test('trial cache replacement waits until the asynchronous temporary-file write completes', async () => {
  let finishWrite, written;
  const moves = [], writing = new Promise(resolve => { finishWrite = resolve; });
  const { attendanceTrialDevice: device } = load('../src/attendance-trial-device.ts', {
    'expo-file-system': { Paths: { document: 'file:///documents' }, File: class {
      constructor(directory, name) { this.uri = `${directory}/${name}`; }
      write(value) { written = value; return writing; }
    } },
    'expo-file-system/legacy': { moveAsync: async value => { moves.push(value); } },
  });
  const saving = device.save('trial-cache');
  await flush();
  assert.equal(written, 'trial-cache');
  try { assert.equal(moves.length, 0, 'an incomplete temporary file cannot replace the saved cache'); }
  finally { finishWrite(); }
  await saving;
  assert.equal(moves.length, 1);
  assert.equal(moves[0].from, 'file:///documents/attendance-trial.tmp');
  assert.equal(moves[0].to, 'file:///documents/attendance-trial.json');
});

test('a failed temporary-file write rejects saving and never replaces the existing trial cache', async () => {
  const failure = Error('WRITE_FAILED'), writing = Promise.reject(failure);
  void writing.catch(() => {});
  let moves = 0;
  const { attendanceTrialDevice: device } = load('../src/attendance-trial-device.ts', {
    'expo-file-system': { Paths: { document: 'file:///documents' }, File: class {
      constructor(directory, name) { this.uri = `${directory}/${name}`; }
      write() { return writing; }
    } },
    'expo-file-system/legacy': { moveAsync: async () => { moves++; } },
  });
  await assert.rejects(device.save('trial-cache'), error => error === failure);
  assert.equal(moves, 0);
});

test('invalid persisted trial payloads cannot create activities or route simulation to a school write', async () => {
  const device = deviceFixture(JSON.stringify({ version: 1, logs: [], events: [
    { id: '81', method: 'number', outcome: 'success', availableAt: 1, discoveredAt: 2, secret: 'cookie=private' },
  ] }));
  const trial = createAttendanceTrial(device.device, true);
  await trial.restore();
  assert.equal(trial.getSnapshot().rollcalls.length, 0);
  assert.equal((await trial.submit('81')).result, 'failed');
  assert.match(trial.getSnapshot().message, /未能恢复/);
  assert.equal(JSON.stringify(trial.getSnapshot()).includes('private'), false);
});

test('Expo config introspection declares the existing dataSync service and required permissions', () => {
  const result = spawnSync(process.execPath, ['./node_modules/expo/bin/cli', 'config', '--type', 'introspect', '--json'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 30000, env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1' },
  });
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(result.stdout)._internal.modResults.android.manifest.manifest;
  const services = manifest.application[0].service;
  const service = services.find(item => item.$['android:name'] === 'com.asterinet.react.bgactions.RNBackgroundActionsTask');
  assert.equal(service.$['android:foregroundServiceType'], 'dataSync');
  for (const name of ['FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_DATA_SYNC', 'WAKE_LOCK']) {
    assert.ok(manifest['uses-permission'].some(item => item.$['android:name'] === 'android.permission.' + name));
  }
});
