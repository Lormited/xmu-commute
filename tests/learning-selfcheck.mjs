import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLearning, todoView } from '../src/learning.ts';
import { numberReceipt, rollcallsFrom } from '../src/attendance.ts';
import { schoolScheduleView } from '../src/schedule.ts';

const profile = { id: 42, user_no: '001234', name: '测试同学' };
const todo = { id: 7, course_id: 3, course_name: '测试课程', title: '学校待办', type: 'homework', end_time: '2026-11-10T12:00:00Z', is_locked: false };
const course = { id: 3, course_code: '001-A', name: '学校课程', semester_id: 9, extra: 'preserved' };
const terms = { datas: { kfdxnxqcx: { rows: [{ XNXQDM: '20261', XNXQDM_DISPLAY: '2026 秋季学期' }] } } };
const lntTerms = { semesters: [{ id: 9, name: 'LNT 秋季', is_active: true }] };
const weeks = { success: true, currentZc: '8', zcList: Array.from({ length: 18 }, (_, i) => ({ ZC: String(i + 1) })) };
const scheduleRow = { WID: 'row-1', BJDM: '001-A', KCMC: '学校课程', JASMC: '教学楼 101', JSXM: '张老师', XQ: '1', KSJCDM: '1', JSJCDM: '2', KSSJ: '0800', JSSJ: '0940', ZCMC: '1-2,7-9周', JCFADM: 'plan-a' };
const schedulePeriods = [{ DM: '1', MC: '第一节', KSSJ: '0800', JSSJ: '0845', JCFADM: 'plan-a' }, { DM: '2', MC: '第二节', KSSJ: '0855', JSSJ: '0940', JCFADM: 'plan-a' }];
const schoolData = action => ({ profile, todos: { todo_list: [todo] }, rollcalls: { rollcalls: [] }, lntTerms, jwTerms: terms, jwWeek: weeks, courses: { courses: [course] }, history: { rollcalls: [] }, jwSchedule: { success: true, pkjgList: [scheduleRow] } })[action];
const previous = JSON.stringify({ version: 1, account: { lntId: 42, studentNumber: '001234', name: '测试同学' }, todos: [todo], todosAt: 1000 });
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(raw = null) {
  const calls = [];
  const device = {
    load: async () => { calls.push('load'); return raw; },
    save: async value => { calls.push('save'); raw = value; },
    clear: async () => { calls.push('clear'); raw = null; },
    authenticate: async callback => { calls.push('authenticate'); callback?.(); },
    read: async action => { calls.push(action); return schoolData(action); },
  };
  return { device, calls, stored: () => raw, learning: createLearning(device, () => 2000) };
}
test('login saves one account, preserves the school collection, and publishes only after saving', async () => {
  const f = fixture(), gate = deferred();
  const save = f.device.save;
  f.device.save = async value => { await gate.promise; await save(value); };
  let authorized = 0;
  const login = f.learning.login(() => authorized++);
  assert.strictEqual(f.learning.login(), login);
  await tick();
  assert.equal(authorized, 1);
  assert.equal(f.learning.getSnapshot().authenticated, true);
  assert.equal(f.learning.getSnapshot().account, null);
  assert.equal(f.learning.getSnapshot().term, null);
  assert.deepEqual(f.learning.getSnapshot().courses, []);
  gate.resolve();
  assert.equal(await login, true);
  assert.deepEqual(f.calls, ['authenticate', 'profile', 'todos', 'rollcalls', 'lntTerms', 'courses', 'jwTerms', 'jwWeek', 'jwSchedule', 'history', 'save']);
  assert.equal(JSON.parse(f.stored()).account.studentNumber, '001234');
  assert.deepEqual(f.learning.getSnapshot().todos, [todo]);
  assert.equal(f.learning.getSnapshot().todosAt, 2000);
  assert.deepEqual(f.learning.getSnapshot().courses, [course]);
  assert.deepEqual(f.learning.getSnapshot().history, []);
  assert.equal(f.learning.getSnapshot().historyAt, 2000);
  assert.equal(f.learning.getSnapshot().term.id, 9);
  assert.equal(todoView(todo).id, 'homework:3:7');
  f.device.read = async action => action === 'profile' ? { id: 99 } : action === 'todos' ? { todo_list: [{ ...todo, type: 'unknown' }, todo] } : schoolData(action);
  assert.equal(await f.learning.login(), true, 'a missing student number is not a save gate');
  assert.equal(JSON.parse(f.stored()).account.studentNumber, '');
  assert.equal(JSON.parse(f.stored()).accounts, undefined);
  assert.equal(f.learning.getSnapshot().todos.length, 2, 'no type, status, or deadline filtering');
});
test('todos are ordered by deadline for cached, login, and refreshed data without changing school items', async () => {
  const items = [null, '2027-01-01T12:00:00Z', '2026-11-12T10:00:00Z', '2026-11-12T18:00:00+08:00',
    '2026-11-12T17:00:00+08:00', '2026-11-10T12:00:00Z', null].map((end_time, index) => ({ ...todo, id: index + 1, end_time }));
  const original = structuredClone(items);
  const ordered = [items[5], items[4], items[2], items[3], items[1], items[0], items[6]];
  for (const entry of ['restore', 'login', 'refresh']) {
    const f = fixture(entry === 'login' ? null : JSON.stringify({ ...JSON.parse(previous), todos: items }));
    f.device.read = async action => action === 'todos' ? { todo_list: items } : schoolData(action);
    await f.learning.restore();
    if (entry !== 'restore') assert.equal(await f.learning[entry](), true);
    assert.deepEqual(f.learning.getSnapshot().todos, ordered, entry);
    if (entry !== 'restore') assert.deepEqual(JSON.parse(f.stored()).todos, ordered, entry + ' cache');
    assert.deepEqual(items, original, 'sorting does not change the school response');
  }
});

test('reopen publishes cache before one refresh; old test formats are discarded', async () => {
  const f = fixture(previous), gate = deferred();
  await f.learning.restore();
  assert.deepEqual(f.calls, ['load']);
  assert.equal(f.learning.getSnapshot().todosAt, 1000);
  assert.equal(f.learning.getSnapshot().authenticated, true);
  f.device.read = async action => { await gate.promise; return action === 'todos' ? { todo_list: [] } : schoolData(action); };
  const refreshing = f.learning.refresh();
  assert.strictEqual(f.learning.refresh(), refreshing);
  assert.deepEqual(f.learning.getSnapshot().todos, [todo]);
  gate.resolve();
  assert.equal(await refreshing, true);
  assert.deepEqual(f.learning.getSnapshot().todos, []);
  assert.equal(f.calls.filter(x => x === 'load').length, 1, 'saving does not read the file back');
  for (const raw of ['{}', JSON.stringify({ accounts: {}, activeStudentNumber: '001234' }), JSON.stringify({ account: { studentNumber: '001234' }, todos: [] })]) {
    const old = fixture(raw); await old.learning.restore();
    assert.equal(old.learning.getSnapshot().account, null);
    assert.equal(old.learning.getSnapshot().authenticated, false);
    assert.equal(old.learning.getSnapshot().ready, true);
  }
  const malformed = fixture(JSON.stringify({ ...JSON.parse(previous), account: 'invalid' }));
  await malformed.learning.restore();
  assert.equal(malformed.learning.getSnapshot().account, null);
  assert.match(malformed.learning.getSnapshot().message, /读取失败/);
});
test('first business read or save failure keeps authentication and ordinary refresh recovers', async () => {
  for (const failure of ['profile', 'todos', 'rollcalls', 'jwTerms', 'jwWeek', 'courses', 'jwSchedule', 'history', 'save']) {
    const f = fixture();
    const { read, save } = f.device;
    if (failure === 'save') f.device.save = async () => { throw Error('DISK'); };
    else f.device.read = async action => { if (action === failure) throw Error('NETWORK'); return read(action); };
    assert.equal(await f.learning.login(), false);
    assert.equal(f.learning.getSnapshot().authenticated, true);
    assert.equal(f.learning.getSnapshot().needsLogin, false);
    assert.equal(f.learning.getSnapshot().account, null);
    assert.deepEqual(f.learning.getSnapshot().todos, []);
    assert.equal(f.stored(), null);
    f.device.read = read;
    const gate = deferred();
    f.device.save = async value => { await gate.promise; await save(value); };
    const refreshed = f.learning.refresh(); await tick();
    assert.equal(f.learning.getSnapshot().account, null, 'refresh still publishes only saved data');
    gate.resolve(); assert.equal(await refreshed, true);
    assert.deepEqual(f.learning.getSnapshot().todos, [todo]);
    assert.equal(f.calls.filter(call => call === 'authenticate').length, 1);
  }
});

test('invalid school data and failed storage retain the last saved page', async () => {
  for (const failure of ['profile', 'todos', 'rollcalls', 'jwTerms', 'jwWeek', 'courses', 'jwSchedule', 'save']) {
    const f = fixture(previous); await f.learning.restore();
    assert.equal(await f.learning.setRefreshSchedule(true), true);
    const saved = f.stored();
    if (failure === 'save') f.device.save = async () => { throw Error('DISK'); };
    else f.device.read = async action => action === failure ? { success: false } : schoolData(action);
    assert.equal(await f.learning.refresh(), false);
    assert.equal(f.stored(), saved);
    assert.deepEqual(f.learning.getSnapshot().todos, [todo]);
    assert.equal(f.learning.getSnapshot().refreshing, false);
    assert.match(f.learning.getSnapshot().message, /失败/);
  }
  const f = fixture(previous); await f.learning.restore();
  f.device.read = async () => { throw Object.assign(Error('opaque'), { code: 'AUTH_REQUIRED' }); };
  assert.equal(await f.learning.refresh(), false);
  assert.equal(f.learning.getSnapshot().needsLogin, true);
  assert.equal(f.learning.getSnapshot().authenticated, false);
  f.device.authenticate = async () => { throw Object.assign(Error('opaque'), { code: 'CANCELLED' }); };
  assert.equal(await f.learning.login(), false);
  assert.equal(f.learning.getSnapshot().needsLogin, true, 'cancelled reauthentication must keep the expired-session state');
  f.device.read = async () => { assert.fail('an expired session needs explicit login'); };
  assert.equal(await f.learning.refresh(), false);
  assert.equal(f.calls.includes('authenticate'), false, 'expired sessions never silently reauthenticate');
});
test('late authentication, reads, saves, and restores cannot undo logout', async () => {
  for (const phase of ['authenticate', 'read', 'save', 'load']) {
    const f = fixture(previous), gate = deferred();
    if (phase !== 'load') await f.learning.restore();
    if (phase === 'read') f.device.read = async () => { await gate.promise; return profile; };
    if (phase === 'save') { const save = f.device.save; f.device.save = async value => { await gate.promise; await save(value); }; }
    if (phase === 'load') f.device.load = async () => { await gate.promise; return previous; };
    if (phase === 'authenticate') f.device.authenticate = async callback => { await gate.promise; callback?.(); };
    const pending = phase === 'load' ? f.learning.restore() : phase === 'authenticate' ? f.learning.login() : f.learning.refresh();
    await tick();
    const logout = f.learning.logout();
    assert.strictEqual(f.learning.logout(), logout);
    assert.equal(f.learning.getSnapshot().authenticated, false);
    assert.equal(f.learning.getSnapshot().account, null);
    if (phase === 'save') assert.equal(f.calls.includes('clear'), false);
    gate.resolve(); await pending;
    assert.equal(await logout, true);
    assert.equal(f.stored(), null);
    assert.equal(f.learning.getSnapshot().authenticated, false);
    assert.equal(f.learning.getSnapshot().account, null);
    assert.deepEqual(f.learning.getSnapshot().todos, []);
  }
});
test('failed logout prevents new writes until cleanup is retried', async () => {
  const f = fixture(previous); await f.learning.restore();
  const clear = f.device.clear;
  f.device.clear = async () => { throw Error('COOKIES'); };
  assert.equal(await f.learning.logout(), false);
  assert.equal(await f.learning.login(), false);
  assert.equal(await f.learning.refresh(), false);
  assert.match(f.learning.getSnapshot().message, /重试退出/);
  f.device.clear = clear;
  assert.equal(await f.learning.logout(), true);
  assert.equal(await f.learning.login(), true);
});
test('a replacement login cannot be overwritten by an older refresh', async () => {
  const f = fixture(previous), gate = deferred(); await f.learning.restore();
  f.device.read = async () => { await gate.promise; return profile; };
  const old = f.learning.refresh(); await tick();
  f.device.read = async action => action === 'profile' ? { id: 77, user_no: '007777' } : action === 'todos' ? { todo_list: [] } : schoolData(action);
  assert.equal(await f.learning.login(), true);
  gate.resolve(); assert.equal(await old, false);
  assert.equal(f.learning.getSnapshot().account.lntId, 77);
  assert.equal(JSON.parse(f.stored()).account.studentNumber, '007777');
});

test('the timetable selects its teaching term while LNT courses use their own semester id', async () => {
  for (const inactiveWeek of ['-1', '0', '19', null, '']) {
    const f = fixture(), checked = [];
    const selected = [course, { ...course, id: 4, course_code: ' 001-A ', name: course.name }];
    f.device.read = async (action, params) => {
      if (action === 'jwTerms') return { datas: { kfdxnxqcx: { rows: [
        { XNXQDM: '20252', XNXQDM_DISPLAY: '旧学期' },
        { XNXQDM: '20261', XNXQDM_DISPLAY: '授课学期' },
        { XNXQDM: '20262', XNXQDM_DISPLAY: '未来学期' },
      ] } } };
      if (action === 'jwWeek') {
        checked.push(params.jwTermCode);
        return { ...weeks, currentZc: params.jwTermCode === '20262' ? inactiveWeek : '8' };
      }
      if (action === 'courses') return { courses: [
        { ...course, id: 1, semester_id: 10 },
        ...selected, { ...course, id: 5, semester_id: 11, semester: null },
        { ...course, id: 6, semester_id: 12 },
        { ...course, id: 7, semester_id: 13 },
      ] };
      return schoolData(action);
    };
    assert.equal(await f.learning.login(), true);
    assert.deepEqual(checked, ['20262', '20261'], 'term array order and the newest code alone do not select a term');
    const snapshot = f.learning.getSnapshot();
    assert.deepEqual(snapshot.term, { id: 9, name: 'LNT 秋季' });
    assert.equal(snapshot.schedule.name, '授课学期');
    assert.equal(snapshot.schedule.currentWeek, 8);
    assert.deepEqual(snapshot.courses, selected, 'ids, exact class codes, duplicate names, and school fields survive');
    assert.equal(snapshot.coursesAt, 2000);
    assert.deepEqual(snapshot.todos, [todo]);
  }
});

test('course cache reopens before refresh and T01 cache upgrades without losing its account or todos', async () => {
  const f = fixture(previous); await f.learning.restore();
  assert.deepEqual(f.learning.getSnapshot().courses, []);
  assert.equal(f.learning.getSnapshot().term, null);
  assert.equal(await f.learning.refresh(), true);
  const reopened = fixture(f.stored()); await reopened.learning.restore();
  assert.deepEqual(reopened.calls, ['load']);
  assert.deepEqual(reopened.learning.getSnapshot().courses, [course]);
  assert.equal(reopened.learning.getSnapshot().term.id, 9);
  assert.equal(reopened.learning.getSnapshot().coursesAt, 2000);
  const saved = reopened.stored();
  reopened.device.read = async () => { throw Error('NETWORK'); };
  assert.equal(await reopened.learning.refresh(), false);
  assert.equal(reopened.stored(), saved);
  assert.deepEqual(reopened.learning.getSnapshot().courses, [course]);
  assert.deepEqual(reopened.learning.getSnapshot().todos, [todo]);
});

test('invalid term, week, and course responses retain the entire saved batch', async () => {
  const invalid = [
    ['lntTerms', { semesters: [] }],
    ['lntTerms', { semesters: [{ id: 9, name: '未来', is_active: false }] }],
    ['lntTerms', { semesters: [{ id: 9, name: '当前', is_active: true }, { id: 10, name: '另一个', is_active: true }] }],
    ['lntTerms', { semesters: [{ id: '9', name: '当前', is_active: true }] }],
    ['lntTerms', { semesters: [{ id: 9, is_active: true }] }],
    ['lntTerms', { success: false, ...lntTerms }],
    ['jwTerms', { datas: { kfdxnxqcx: { rows: [{ XNXQDM: '20261&XH=other', XNXQDM_DISPLAY: '无效' }] } } }],
    ['jwTerms', { datas: { kfdxnxqcx: { rows: [] } } }],
    ['jwWeek', { ...weeks, success: false }], ['jwWeek', { zcList: weeks.zcList, success: true }],
    ['jwWeek', { ...weeks, currentZc: '1.5' }], ['jwWeek', { ...weeks, zcList: [{ ZC: 'not-week' }] }],
    ['jwWeek', { ...weeks, currentZc: '19' }], ['jwWeek', { ...weeks, currentZc: 0 }],
    ['courses', { courses: [{ ...course, id: '3' }] }], ['courses', { courses: [{ ...course, course_code: 3 }] }],
    ['courses', { courses: [{ ...course, semester_id: undefined }] }],
    ['courses', { courses: [course, course] }],
    ['courses', { success: false, courses: [] }],
  ];
  for (const [failedAction, response] of invalid) {
    const f = fixture(); assert.equal(await f.learning.login(), true);
    await f.learning.setRefreshSchedule(true);
    const saved = f.stored(), before = f.learning.getSnapshot();
    f.device.read = async action => action === failedAction ? response : schoolData(action);
    assert.equal(await (failedAction === 'jwTerms' || failedAction === 'jwWeek' ? f.learning.login() : f.learning.refresh()), false, failedAction);
    assert.equal(f.stored(), saved);
    assert.deepEqual(f.learning.getSnapshot().courses, before.courses);
    assert.deepEqual(f.learning.getSnapshot().term, before.term);
    assert.deepEqual(f.learning.getSnapshot().todos, before.todos);
    assert.equal(f.learning.getSnapshot().coursesAt, before.coursesAt);
  }
});

test('LNT current semester ignores unrelated semester metadata and accepts an empty course semester', async () => {
  const f = fixture(); await f.learning.login();
  const before = f.learning.getSnapshot(), savedSchedule = before.schedule;
  f.device.read = async action => {
    if (action.startsWith('jw')) assert.fail('a disabled refresh is LNT-only');
    return action === 'lntTerms' ? { semesters: [{ id: 77, name: '当前 LNT 学期', is_active: true }, { id: 999, name: '未来学期', is_active: false }] }
      : action === 'courses' ? { courses: [{ ...course, semester_id: 77, semester: [] }] } : schoolData(action);
  };
  assert.equal(await f.learning.refresh(), true);
  assert.deepEqual(f.learning.getSnapshot().term, { id: 77, name: '当前 LNT 学期' });
  assert.equal(f.learning.getSnapshot().courses.length, 1);
  assert.strictEqual(f.learning.getSnapshot().schedule, savedSchedule);
  f.device.read = async action => action === 'lntTerms' ? { semesters: [{ id: 78, name: '无课程的新学期', is_active: true }] }
    : action === 'courses' ? { courses: [] } : schoolData(action);
  assert.equal(await f.learning.refresh(), true);
  assert.deepEqual(f.learning.getSnapshot().courses, []);
  assert.deepEqual(f.learning.getSnapshot().history, []);
  assert.strictEqual(f.learning.getSnapshot().schedule, savedSchedule);
});

test('empty school courses and todos are saved independently and damaged course caches are rejected', async () => {
  const f = fixture();
  f.device.read = async action => action === 'courses' ? { courses: [] } : action === 'todos' ? { todo_list: [] } : schoolData(action);
  assert.equal(await f.learning.login(), true);
  assert.deepEqual(f.learning.getSnapshot().courses, []);
  assert.deepEqual(f.learning.getSnapshot().todos, []);
  assert.deepEqual(f.learning.getSnapshot().history, []);
  assert.equal(f.learning.getSnapshot().historyAt, 2000);
  assert.equal(f.learning.getSnapshot().schedule.currentWeek, 8);
  const saved = JSON.parse(f.stored());
  for (const patch of [
    { term: { ...saved.term, id: 1.5 } },
    { term: { ...saved.term, id: -1 } }, { coursesAt: null },
    { courses: [{ ...course, semester_id: 10 }] },
  ]) {
    const raw = JSON.stringify({ ...saved, ...patch }), broken = fixture(raw);
    await broken.learning.restore();
    assert.equal(broken.learning.getSnapshot().authenticated, false);
    assert.match(broken.learning.getSnapshot().message, /读取失败/);
    assert.equal(broken.stored(), raw);
  }
});

test('late term, week, or course responses cannot restore courses after logout', async () => {
  for (const paused of ['jwTerms', 'jwWeek', 'courses']) {
    const f = fixture(); await f.learning.login();
    await f.learning.setRefreshSchedule(true);
    const gate = deferred(), read = f.device.read;
    f.device.read = async (action, params) => { if (action === paused) await gate.promise; return read(action, params); };
    const pending = f.learning.login(); await tick();
    assert.equal(await f.learning.logout(), true);
    gate.resolve(); assert.equal(await pending, false);
    assert.equal(f.stored(), null);
    assert.equal(f.learning.getSnapshot().term, null);
    assert.deepEqual(f.learning.getSnapshot().courses, []);
    assert.equal(f.learning.getSnapshot().coursesAt, null);
  }
});
test('first login saves school timetable without section metadata, then cache reopens before requests', async () => {
  const f = fixture();
  assert.equal(await f.learning.login(), true);
  const schedule = f.learning.getSnapshot().schedule;
  assert.equal(schedule?.jwTermCode, '20261');
  assert.equal(schedule.rows[0].BJDM, '001-A');
  assert.equal(schedule.rows[0].KSSJ, '08:00');
  assert.equal(Object.hasOwn(schedule, 'periods'), false);
  assert.equal(f.learning.getSnapshot().scheduleAt, 2000);
  const reopened = fixture(f.stored()); await reopened.learning.restore();
  assert.deepEqual(reopened.calls, ['load']);
  assert.deepEqual(reopened.learning.getSnapshot().schedule, schedule);
  assert.equal(reopened.learning.getSnapshot().scheduleAt, 2000);
});

test('enabled refresh preserves the calendar across weeks, recalibrates beyond its range, and ignores legacy periods', async () => {
  let clock = new Date(2026, 9, 26, 12).getTime();
  const f = fixture(); f.learning = createLearning(f.device, () => clock);
  assert.equal(await f.learning.login(), true);
  assert.equal(await f.learning.setRefreshSchedule(true), true);
  const initial = f.learning.getSnapshot().schedule;
  clock += 7 * 86400000; f.calls.length = 0;
  assert.equal(await f.learning.refresh(), true);
  assert.deepEqual(f.calls.filter(action => action.startsWith('jw')), ['jwSchedule']);
  assert.equal(f.learning.getSnapshot().schedule.weekAt, initial.weekAt);
  assert.equal(schoolScheduleView(f.learning.getSnapshot(), new Date(clock)).currentWeek, 9);
  const saved = JSON.parse(f.stored());
  for (const periods of [schedulePeriods, null, 'obsolete invalid field']) {
    const reopened = fixture(JSON.stringify({ ...saved, schedule: { ...saved.schedule, periods } }));
    await reopened.learning.restore();
    assert.deepEqual(reopened.learning.getSnapshot().schedule, saved.schedule);
  }
  clock += 20 * 7 * 86400000;
  for (const failedAction of ['jwTerms', 'jwWeek', 'jwSchedule']) {
    const before = f.learning.getSnapshot(), raw = f.stored(), read = f.device.read;
    f.device.read = async (action, params) => { if (action === failedAction) throw Error('NETWORK'); return read(action, params); };
    assert.equal(await f.learning.refresh(), false);
    assert.equal(f.stored(), raw);
    assert.strictEqual(f.learning.getSnapshot().schedule, before.schedule);
    f.device.read = read;
  }
  f.calls.length = 0;
  assert.equal(await f.learning.refresh(), true);
  assert.deepEqual(f.calls.filter(action => action.startsWith('jw')), ['jwTerms', 'jwWeek', 'jwSchedule']);
  assert.equal(f.learning.getSnapshot().schedule.weekAt, clock);
  const gate = deferred(), read = f.device.read;
  f.device.read = async (action, params) => { if (action === 'jwSchedule') await gate.promise; return read(action, params); };
  const pending = f.learning.refresh(); await tick();
  assert.equal(await f.learning.logout(), true);
  gate.resolve(); assert.equal(await pending, false);
  assert.equal(f.learning.getSnapshot().schedule, null);
  assert.equal(f.stored(), null);
});
test('invalid timetable data never replaces a saved batch or expands unknown teaching weeks', async () => {
  for (const [action, response] of [
    ['jwSchedule', { success: false, pkjgList: [] }],
    ['jwSchedule', { success: true, pkjgList: [{ ...scheduleRow, ZCMC: '单周' }] }],
    ['jwSchedule', { success: true, pkjgList: [{ ...scheduleRow, ZCMC: '未知周次' }] }],
    ['jwSchedule', { success: true, pkjgList: [{ ...scheduleRow, KSSJ: null }] }],
    ['jwSchedule', { success: true, pkjgList: [{ ...scheduleRow, JSJCDM: 101 }] }],
  ]) {
    const f = fixture(); assert.equal(await f.learning.login(), true);
    const before = f.learning.getSnapshot(), saved = f.stored();
    f.device.read = async name => name === action ? response : schoolData(name);
    assert.equal(await f.learning.login(), false);
    assert.equal(f.stored(), saved);
    assert.deepEqual(f.learning.getSnapshot().schedule, before.schedule);
    assert.deepEqual(f.learning.getSnapshot().courses, before.courses);
    assert.deepEqual(f.learning.getSnapshot().todos, before.todos);
  }
});

test('ordinary refresh keeps the cached timetable and late timetable reads cannot undo logout', async () => {
  const f = fixture(); assert.equal(await f.learning.login(), true);
  const original = f.learning.getSnapshot().schedule;
  f.calls.length = 0;
  assert.equal(await f.learning.refresh(), true);
  assert.equal(f.calls.includes('jwSchedule'), false);
  assert.deepEqual(f.learning.getSnapshot().schedule, original);
  const pending = fixture(), gate = deferred(), read = pending.device.read;
  pending.device.read = async (action, params) => { if (action === 'jwSchedule') await gate.promise; return read(action, params); };
  const login = pending.learning.login(); await tick();
  assert.equal(await pending.learning.logout(), true);
  gate.resolve(); assert.equal(await login, false);
  assert.equal(pending.learning.getSnapshot().schedule, null);
  assert.equal(pending.learning.getSnapshot().scheduleAt, null);
  assert.equal(pending.stored(), null);
});
test('damaged timetable caches are rejected without modifying the file', async () => {
  const f = fixture(); await f.learning.login();
  const saved = JSON.parse(f.stored());
  for (const patch of [
    { scheduleAt: null }, { schedule: { ...saved.schedule, jwTermCode: 'invalid' } },
    { schedule: { ...saved.schedule, rows: [{ ...saved.schedule.rows[0], ZCMC: 'unknown' }] } },
  ]) {
    const raw = JSON.stringify({ ...saved, ...patch }), reopened = fixture(raw);
    await reopened.learning.restore();
    assert.equal(reopened.learning.getSnapshot().schedule, null);
    assert.match(reopened.learning.getSnapshot().message, /读取失败/);
    assert.equal(reopened.stored(), raw);
  }
});

test('enabled timetable refresh isolates same-term accounts and failed reads retain the saved batch', async () => {
  const initial = fixture(); initial.learning = createLearning(initial.device, () => 1000);
  assert.equal(await initial.learning.login(), true);
  assert.equal(await initial.learning.setRefreshSchedule(true), true);
  const savedA = initial.stored(), oldBatch = JSON.parse(savedA);
  const nextTodo = { ...todo, id: 9, title: '新账号待办' };
  const nextCourse = { ...course, id: 9, course_code: '009-B', name: '新账号课程' };
  const nextRow = { ...scheduleRow, WID: 'row-b', BJDM: '009-B', KCMC: nextCourse.name, JASMC: '教学楼 202' };
  for (const nextProfile of [
    { id: 99, user_no: '009999', name: '新账号' },
    { ...profile, user_no: '009999' },
    { ...profile, id: 99 },
  ]) for (const initialFailure of ['profile', 'jwSchedule']) {
    const f = fixture(savedA); await f.learning.restore();
    let failedAction = initialFailure;
    const scheduleCalls = [];
    f.device.read = async (action, params) => {
      f.calls.push(action);
      if (action === 'jwSchedule') scheduleCalls.push([action, params]);
      if (action === failedAction) throw Error('NETWORK');
      return action === 'profile' ? nextProfile : action === 'todos' ? { todo_list: [nextTodo] }
        : action === 'courses' ? { courses: [nextCourse] }
        : action === 'jwSchedule' ? { success: true, pkjgList: [nextRow] } : schoolData(action);
    };
    const assertOldBatch = () => {
      assert.equal(f.stored(), savedA);
      for (const [key, value] of Object.entries(oldBatch)) if (key !== 'version') {
        assert.deepEqual(f.learning.getSnapshot()[key], value, key);
      }
    };
    assert.equal(await f.learning.login(), false);
    assert.equal(f.learning.getSnapshot().authenticated, true);
    assert.equal(f.learning.getSnapshot().needsLogin, false);
    assertOldBatch();
    assert.equal(await f.learning.refresh(), false, initialFailure);
    assertOldBatch();
    failedAction = null; scheduleCalls.length = 0; f.calls.length = 0;
    assert.equal(await f.learning.refresh(), true);
    assert.deepEqual(scheduleCalls, [
      ['jwSchedule', { jwTermCode: '20261', studentNumber: nextProfile.user_no }],
    ]);
    assert.deepEqual(f.calls, ['profile', 'todos', 'rollcalls', 'lntTerms', 'courses', 'jwTerms', 'jwWeek', 'jwSchedule', 'save']);
    const snapshot = f.learning.getSnapshot(), savedB = JSON.parse(f.stored());
    assert.deepEqual(snapshot.account, { lntId: nextProfile.id, studentNumber: nextProfile.user_no, name: nextProfile.name });
    assert.deepEqual(snapshot.todos, [nextTodo]);
    assert.deepEqual(snapshot.courses, [nextCourse]);
    assert.deepEqual(snapshot.schedule.rows.map(row => row.BJDM), ['009-B']);
    assert.equal(snapshot.schedule.rows[0].JASMC, '教学楼 202');
    assert.equal(snapshot.scheduleAt, 2000);
    assert.deepEqual(savedB.schedule, snapshot.schedule);
    const reopened = fixture(f.stored()); await reopened.learning.restore();
    assert.deepEqual(reopened.calls, ['load']);
    for (const [key, value] of Object.entries(savedB)) if (key !== 'version') {
      assert.deepEqual(reopened.learning.getSnapshot()[key], value, key);
    }
  }
});

const schoolRollcalls = [
  { rollcall_id: 81, course_id: 301, course_title: '学校活动名称', is_number: true },
  { id: '82', course_id: '302', course_name: '另一门课程', is_radar: true },
  { rollcall_id: '83', course: { id: 301 }, course_title: '同课二维码活动' },
];
async function attendanceFixture() {
  const f = fixture(previous), read = f.device.read;
  f.device.read = async action => action === 'rollcalls' ? { rollcalls: schoolRollcalls } : read(action);
  f.answers = [];
  f.device.answerNumber = async (id, code) => { f.answers.push({ id, code }); return { result: 'success', message: '学校确认签到成功' }; };
  await f.learning.restore();
  assert.equal(await f.learning.refresh(), true);
  return f;
}

test('school activities preserve identities, names and methods; malformed collections cannot clear the batch', async () => {
  assert.deepEqual(rollcallsFrom({ rollcalls: schoolRollcalls }).map(({ id, courseId, title, method }) => ({ id, courseId, title, method })), [
    { id: '81', courseId: '301', title: '学校活动名称', method: 'number' },
    { id: '82', courseId: '302', title: '另一门课程', method: 'radar' },
    { id: '83', courseId: '301', title: '同课二维码活动', method: 'qr' },
  ]);
  const f = await attendanceFixture(), saved = f.stored(), before = f.learning.getSnapshot();
  for (const payload of [null, {}, { rollcalls: null }, { rollcalls: [null] }, { rollcalls: [{}] },
    { rollcalls: [{ ...schoolRollcalls[0], course_id: null }] }, { rollcalls: [{ ...schoolRollcalls[0], is_number: 'true' }] },
    { rollcalls: [schoolRollcalls[0], schoolRollcalls[0]] }, { success: false, rollcalls: [] }]) {
    assert.throws(() => rollcallsFrom(payload), /INVALID_ROLLCALLS/);
    f.device.read = async action => action === 'profile' ? profile : action === 'rollcalls' ? payload : action === 'todos' ? { todo_list: [] } : schoolData(action);
    assert.equal(await f.learning.refresh(), false);
    assert.equal(f.stored(), saved);
    assert.strictEqual(f.learning.getSnapshot().todos, before.todos);
    assert.strictEqual(f.learning.getSnapshot().rollcalls, before.rollcalls);
  }
});

test('a refresh waits for activities and publishes the whole saved batch together', async () => {
  const f = await attendanceFixture(), gate = deferred(), before = f.learning.getSnapshot();
  f.device.read = async action => action === 'profile' ? profile : action === 'rollcalls' ? gate.promise : action === 'todos' ? { todo_list: [] } : schoolData(action);
  const refresh = f.learning.refresh(); await tick();
  assert.strictEqual(f.learning.getSnapshot().todos, before.todos);
  assert.strictEqual(f.learning.getSnapshot().rollcalls, before.rollcalls);
  gate.resolve({ rollcalls: [] });
  assert.equal(await refresh, true);
  assert.deepEqual(f.learning.getSnapshot().todos, []);
  assert.deepEqual(f.learning.getSnapshot().rollcalls, []);
});

test('number submission validates the activity, keeps leading zeroes and sends one request while busy', async () => {
  const f = await attendanceFixture(), gate = deferred();
  f.device.answerNumber = async (id, code) => { f.answers.push({ id, code }); return gate.promise; };
  for (const [id, code] of [['missing', '0206'], ['82', '0206'], ['83', '0206'], ['81', '206'], ['81', 'abcd']]) {
    assert.equal((await f.learning.submitNumber(id, code)).result, 'failed');
  }
  assert.equal(f.answers.length, 0);
  const answer = f.learning.submitNumber('81', '0007');
  assert.strictEqual(f.learning.submitNumber('81', '1234'), answer);
  assert.deepEqual(f.answers, [{ id: '81', code: '0007' }]);
  gate.resolve({ result: 'success', message: '学校确认' });
  assert.equal((await answer).message, '学校确认');
  assert.equal(f.learning.getSnapshot().attendance['81'], undefined, 'the entry stays until dismissal');
  assert.deepEqual(f.learning.getSnapshot().pendingAttendance, { '81': 'success' });
  assert.equal((await f.learning.submitNumber('81', '0007')).result, 'failed');
  f.learning.attendanceDismissed({ ids: ['81', '82', '83'] });
  assert.equal(f.learning.getSnapshot().attendance['81'], 'success');
  assert.equal(f.learning.getSnapshot().attendance['82'], undefined);
  await tick();
  const reopened = createLearning(f.device); await reopened.restore();
  assert.equal(reopened.getSnapshot().attendance['81'], 'success');
  assert.deepEqual(reopened.getSnapshot().rollcalls, f.learning.getSnapshot().rollcalls);
  assert.doesNotMatch(f.stored(), /0007|numberCode|deviceId|学校确认/);
});

test('location submission passes device coordinates to its activity and applies the receipt only on dismissal', async () => {
  const f = await attendanceFixture(), gate = deferred();
  const position = { latitude: 24.441, longitude: 118.103, accuracy: 7, altitude: 18, altitudeAccuracy: null, heading: 0, speed: 0 };
  f.device.submitLocation = async (id, value) => { f.answers.push({ id, position: value }); return gate.promise; };
  for (const [id, value] of [['missing', position], ['81', position], ['83', position], ['82', { ...position, latitude: NaN }]]) {
    assert.equal((await f.learning.submitLocation(id, value)).result, 'failed');
  }
  assert.equal(f.answers.length, 0);
  const answer = f.learning.submitLocation('82', position);
  assert.strictEqual(f.learning.submitLocation('82', position), answer);
  assert.deepEqual(f.answers, [{ id: '82', position }]);
  gate.resolve({ result: 'success', message: '学校确认定位签到' });
  assert.equal((await answer).message, '学校确认定位签到');
  assert.deepEqual(f.learning.getSnapshot().pendingAttendance, { '82': 'success' });
  assert.equal(f.learning.getSnapshot().attendance['82'], undefined);
  f.learning.attendanceDismissed({ ids: ['81', '82', '83'] });
  assert.deepEqual(f.learning.getSnapshot().attendance, { '82': 'success' });
  await tick();
  assert.doesNotMatch(f.stored(), /24\.441|118\.103|latitude|longitude|altitude|accuracy/);
});

test('multiple school receipts remain saved when another result is received or only one sheet closes', async () => {
  const f = await attendanceFixture();
  await f.learning.submitNumber('81', '0206');
  f.device.submitQr = async () => ({ result: 'ended', message: '学校确认结束' });
  await f.learning.submitQr('83', '{"rollcallId":83,"data":"opaque"}');
  assert.deepEqual(f.learning.getSnapshot().pendingAttendance, { '81': 'success', '83': 'ended' });
  await tick();
  assert.deepEqual(JSON.parse(f.stored()).attendance, { '81': 'success', '83': 'ended' });
  f.learning.attendanceDismissed({ ids: ['83'] });
  assert.deepEqual(f.learning.getSnapshot().attendance, { '83': 'ended' });
  assert.deepEqual(f.learning.getSnapshot().pendingAttendance, { '81': 'success' });
  f.learning.attendanceDismissed({ ids: ['81'] });
  assert.deepEqual(f.learning.getSnapshot().attendance, { '81': 'success', '83': 'ended' });
  const reopened = createLearning(f.device); await reopened.restore();
  assert.deepEqual(reopened.getSnapshot().attendance, { '81': 'success', '83': 'ended' });
});

test('school receipts preserve success and expiry; other responses use the uncertain-result fallback', () => {
  for (const [status, body, result] of [
    [200, null, 'success'], [200, { success: true, message: '已签到' }, 'success'],
    [409, { is_expired: true, message: '活动已结束' }, 'ended'],
  ]) assert.equal(numberReceipt(status, body).result, result);
  for (const [status, body] of [
    ...[400, 403, 404, 409, 422, 429, 503].map(status => [status, {}]),
    [200, { success: false }], [200, { error: true }], [403, { success: true }],
  ]) assert.deepEqual(numberReceipt(status, body), { result: 'failed', message: '提交结果未知，请核实本人记录' });
  for (const invalid of [[], 1, 'ok', { success: 'false' }]) assert.throws(() => numberReceipt(200, invalid), /INVALID_RESPONSE/);
  assert.doesNotMatch(numberReceipt(503, { message: '响应说明 token=secret cookie=private Bearer hidden numberCode=0007 deviceId=private-id' }).message, /secret|private|hidden|0007/);
});

test('uncertain results keep the activity available; late ended receipts update only their own entry after closing', async () => {
  const f = await attendanceFixture();
  f.device.answerNumber = async () => { throw Error('NETWORK'); };
  assert.match((await f.learning.submitNumber('81', '0001')).message, /提交结果未知/);
  f.learning.attendanceDismissed({ ids: ['81', '82', '83'] });
  assert.deepEqual(f.learning.getSnapshot().attendance, {});
  const gate = deferred(); f.device.answerNumber = async () => gate.promise;
  const answer = f.learning.submitNumber('81', '0002');
  f.learning.attendanceDismissed({ ids: ['81', '82', '83'] });
  gate.resolve({ result: 'ended', message: '学校确认结束' }); await answer;
  assert.deepEqual(f.learning.getSnapshot().pendingAttendance, {});
  assert.deepEqual(f.learning.getSnapshot().attendance, { '81': 'ended' });
});

test('refresh and cache failures cannot undo an accepted school write', async () => {
  const f = await attendanceFixture(), gate = deferred(), save = f.device.save;
  let firstSave = true;
  f.device.save = async value => { if (firstSave) { firstSave = false; await gate.promise; } await save(value); };
  const refresh = f.learning.refresh(); await tick();
  assert.equal((await f.learning.submitNumber('81', '0206')).result, 'success');
  f.learning.attendanceDismissed({ ids: ['81', '82', '83'] }); gate.resolve(); assert.equal(await refresh, true); await tick();
  assert.equal(f.learning.getSnapshot().attendance['81'], 'success');
  assert.equal(JSON.parse(f.stored()).attendance['81'], 'success');
  f.device.read = async () => { throw Error('NETWORK'); };
  assert.equal(await f.learning.refresh(), false);
  assert.equal(f.learning.getSnapshot().attendance['81'], 'success');
  const broken = await attendanceFixture();
  broken.device.save = async () => { throw Error('DISK'); };
  assert.equal((await broken.learning.submitNumber('81', '0206')).result, 'success');
  broken.learning.attendanceDismissed({ ids: ['81'] }); await tick();
  assert.equal(broken.learning.getSnapshot().attendance['81'], 'success');
  assert.match(broken.learning.getSnapshot().message, /本机保存失败/);
});

test('late submission cannot repopulate logout or a replacement account; session expiry requires explicit login', async () => {
  for (const action of ['logout', 'login']) {
    const f = await attendanceFixture(), gate = deferred();
    f.device.answerNumber = async () => gate.promise;
    const answer = f.learning.submitNumber('81', '0206');
    if (action === 'logout') await f.learning.logout();
    else {
      const read = f.device.read;
      f.device.read = async name => name === 'profile' ? { id: 99, user_no: '009999' } : read(name);
      assert.equal(await f.learning.login(), true);
    }
    gate.resolve({ result: 'success', message: '旧账号回执' });
    assert.equal((await answer).result, 'failed');
    assert.deepEqual(f.learning.getSnapshot().pendingAttendance, {});
    assert.deepEqual(f.learning.getSnapshot().attendance, {});
    if (action === 'logout') assert.deepEqual(f.learning.getSnapshot().rollcalls, []);
  }
  const f = await attendanceFixture();
  f.device.answerNumber = async () => { throw Object.assign(Error('private-token'), { code: 'AUTH_REQUIRED' }); };
  assert.match((await f.learning.submitNumber('81', '0206')).message, /重新登录/);
  assert.equal(f.learning.getSnapshot().needsLogin, true);
  assert.equal(f.learning.getSnapshot().authenticated, false);
  assert.equal(f.learning.getSnapshot().rollcalls.length, 3);
  assert.equal(await f.learning.refresh(), false);
  f.device.answerNumber = async () => assert.fail('expired sessions cannot submit');
  assert.equal((await f.learning.submitNumber('81', '0206')).result, 'failed');
});

test('reauthentication keeps a confirmed receipt for the same account; old reads cannot clear a submission auth failure', async () => {
  const f = await attendanceFixture();
  assert.equal((await f.learning.submitNumber('81', '0206')).result, 'success');
  assert.equal(await f.learning.login(), true);
  assert.equal(f.learning.getSnapshot().attendance['81'], 'success');
  assert.equal(JSON.parse(f.stored()).attendance['81'], 'success');
  const expired = await attendanceFixture(), gate = deferred(), read = expired.device.read;
  expired.device.read = async action => { if (action === 'rollcalls') await gate.promise; return read(action); };
  const refresh = expired.learning.refresh(); await tick();
  expired.device.answerNumber = async () => { throw Object.assign(Error('opaque'), { code: 'AUTH_REQUIRED' }); };
  await expired.learning.submitNumber('81', '0206');
  gate.resolve(); assert.equal(await refresh, false);
  assert.equal(expired.learning.getSnapshot().needsLogin, true);
  assert.equal(expired.learning.getSnapshot().authenticated, false);
  assert.equal(expired.learning.getSnapshot().refreshing, false);
});

test('school p QR submits exact opaque data once and retains the reminder until dismissal', async () => {
  const f = await attendanceFixture(), gate = deferred();
  f.device.submitQr = async (id, data) => { f.answers.push({ id, data }); return gate.promise; };
  const answer = f.learning.submitQr('83', 'https://lnt.xmu.edu.cn/j?p=4~%102b%213~%20+opaque%2B%2F%3D%2525%1F%1E%0A%E7%A0%81++%21ignored~elsewhere');
  assert.deepEqual(f.answers, [{ id: '83', data: '  opaque+/=%25~!\n码  ' }]);
  assert.strictEqual(f.learning.submitQr('83', '{"rollcallId":83,"data":"second scan"}'), answer);
  assert.equal(f.answers.length, 1);
  gate.resolve({ result: 'success', message: '签到成功' });
  assert.equal((await answer).result, 'success');
  assert.deepEqual(f.learning.getSnapshot().pendingAttendance, { '83': 'success' });
  assert.equal(f.learning.getSnapshot().attendance['83'], undefined);
  f.learning.attendanceDismissed({ ids: ['81', '82', '83'] });
  assert.equal(f.learning.getSnapshot().attendance['83'], 'success');
  await tick();
  assert.doesNotMatch(f.stored(), /opaque|second scan/);
});

test('QR keeps JSON and _p precedence, and decodes official p scalars without rewriting the data', async () => {
  const f = await attendanceFixture();
  f.device.submitQr = async (id, data) => { f.answers.push({ id, data }); return { result: 'failed', message: '学校返回待核对结果' }; };
  for (const [raw, data] of [
    ['{"rollcallId":83,"data":"  raw+/=  ","courseId":301}', '  raw+/=  '],
    ['/j?_p=%7B%22rollcallId%22%3A83%2C%22data%22%3A%22%252B%2B%2F%3D%22%7D&p=4~83!3~ignored', '%2B+/='],
    ['/scanner-jumper?_p=%7B%22rollcallId%22%3A%2283%22%2C%22data%22%3A%7B%22opaque%22%3A%5B%22%20x%20%22%2C7%5D%7D%7D', { opaque: [' x ', 7] }],
    ['/scanner-jumper?_p=broken&p=rollcallId~83!data~%102b.3h!__proto__~ignored!unrelated', 83.125],
    ['/j?p=4~83!3~', ''],
    ['/j?p=4~83!3~%1A0', false],
    ['/j?p=4~83!3~%1A1', true],
    ['/j?p=4~83!3~%1A2', 'classroom-exam'],
    ['/j?p=4~83!3~%1A3', 'feedback'],
    ['/j?p=4~83!3~%1A4', 'vote'],
    ['/j?p=4~83!3~%1AX%1F', '\x1aX\x1f'],
  ]) {
    assert.equal((await f.learning.submitQr('83', raw)).message, '学校返回待核对结果');
    assert.deepEqual(f.answers.pop(), { id: '83', data });
  }
});

test('QR rejects malformed or mismatched scans without a school submission', async () => {
  const f = await attendanceFixture();
  f.device.submitQr = async (id, data) => { f.answers.push({ id, data }); throw Error('unexpected submission'); };
  for (const raw of ['plain text', '{}', '[]', '{"rollcallId":83}', '{"rollcallId":true,"data":"secret"}',
    '/j?p=unknown-school-encoding', '/j?p=4~83', '/j?p=3~x', '/j?p=4~83!3', '/j?p=4~83!3~x~y',
    '/j?p=4~83!rollcallId~82!3~x', '/j?p=4~83!3~x!data~y', '/j?p=4~83!3~x&p=4~82!3~y',
    '/j?p=4~%102b%3F!3~x', '/j?p=4~%102b%0A!3~x', '/j?p=4~%102b.1!3~x', '/j?p=4~%1A1!3~x',
    '/j?p=4~83!3~%102b.1.0', '/j?_p=%7B%7D&p=4~83!3~x',
    'https://lnt.xmu.edu.cn/elsewhere?_p=%7B%22rollcallId%22%3A83%2C%22data%22%3A%22x%22%7D']) {
    assert.deepEqual(await f.learning.submitQr('83', raw), { result: 'failed', message: '二维码无效，请扫描当前活动的学校二维码' }, raw);
  }
  for (const raw of ['{"rollcallId":82,"data":"secret"}', '/j?p=4~%102a!3~x']) {
    assert.deepEqual(await f.learning.submitQr('83', raw), { result: 'failed', message: '二维码与当前签到活动不符' });
  }
  for (const id of ['missing', '81', '82']) await f.learning.submitQr(id, JSON.stringify({ rollcallId: id, data: 'wrong method' }));
  assert.deepEqual(f.answers, [], 'invalid scans never reach the school');
  assert.deepEqual(f.learning.getSnapshot().attendance, {});
});

test('timetable refresh setting defaults off and reopens without authenticating a signed-out device', async () => {
  const f = fixture(); await f.learning.restore();
  assert.equal(f.learning.getSnapshot().refreshSchedule, false);
  assert.equal(await f.learning.setRefreshSchedule(true), true);
  assert.deepEqual(JSON.parse(f.stored()), { version: 1, refreshSchedule: true });
  const reopened = fixture(f.stored()); await reopened.learning.restore();
  assert.equal(reopened.learning.getSnapshot().refreshSchedule, true);
  assert.equal(reopened.learning.getSnapshot().authenticated, false);
  assert.deepEqual(reopened.calls, ['load']);
  assert.equal(await reopened.learning.setRefreshSchedule(false), true);
  const disabled = fixture(reopened.stored()); await disabled.learning.restore();
  assert.equal(disabled.learning.getSnapshot().refreshSchedule, false);
  const existing = fixture(previous); await existing.learning.restore();
  assert.equal(existing.learning.getSnapshot().refreshSchedule, false);
});


test('disabled ordinary refresh reads the core batch without timetable requests even when its cache is missing', async () => {
  const initial = fixture(); initial.learning = createLearning(initial.device, () => 1000);
  assert.equal(await initial.learning.login(), true);
  for (const raw of [previous, initial.stored()]) {
    const f = fixture(raw); await f.learning.restore();
    const oldSchedule = f.learning.getSnapshot().schedule;
    f.device.read = async action => {
      f.calls.push(action);
      return action === 'todos' ? { todo_list: [{ ...todo, title: '刷新后的学校待办' }] }
        : action === 'courses' ? { courses: [{ ...course, name: '刷新后的课程' }] }
        : action === 'rollcalls' ? { rollcalls: schoolRollcalls } : schoolData(action);
    };
    assert.equal(await f.learning.refresh(), true);
    assert.deepEqual(f.calls.filter(action => !['load', 'save'].includes(action)).sort(), ['courses', 'lntTerms', 'profile', 'rollcalls', 'todos']);
    const data = f.learning.getSnapshot();
    assert.equal(data.todos[0].title, '刷新后的学校待办');
    assert.equal(data.courses[0].name, '刷新后的课程');
    assert.equal(data.rollcalls.length, 3);
    assert.deepEqual(data.schedule, oldSchedule);
    assert.equal(data.scheduleAt, oldSchedule ? 1000 : null);
    const reopened = fixture(f.stored()); await reopened.learning.restore();
    assert.deepEqual(reopened.learning.getSnapshot().schedule, oldSchedule);
    assert.equal(await reopened.learning.setRefreshSchedule(true), true);
    const enabled = fixture(reopened.stored()); await enabled.learning.restore();
    assert.equal(await enabled.learning.refresh(), true);
    assert.deepEqual(enabled.calls.filter(action => !['load', 'save'].includes(action)).sort(), ['courses', 'jwSchedule', ...(!oldSchedule ? ['jwTerms', 'jwWeek'] : []), 'lntTerms', 'profile', 'rollcalls', 'todos']);
    assert.equal(enabled.learning.getSnapshot().scheduleAt, 2000);
    assert.equal(await enabled.learning.setRefreshSchedule(false), true);
    enabled.calls.length = 0;
    assert.equal(await enabled.learning.refresh(), true);
    assert.equal(enabled.calls.includes('jwSchedule'), false);
    assert.equal(enabled.calls.includes('jwPeriods'), false);
  }
});


test('disabled refresh preserves the timetable across terms and rejects another account', async () => {
  const initial = fixture(); initial.learning = createLearning(initial.device, () => 1000);
  assert.equal(await initial.learning.login(), true);
  const saved = initial.stored();
  for (const scenario of [
    { account: { ...profile, id: 99 }, semesterId: 9 },
    { account: { ...profile, user_no: '009999' }, semesterId: 9 },
    { account: { ...profile, id: 99, user_no: '009999' }, semesterId: 9 },
    { account: profile, semesterId: 10 },
  ]) {
    const f = fixture(saved); await f.learning.restore();
    const before = f.learning.getSnapshot();
    let failCourses = true;
    f.device.read = async action => {
      f.calls.push(action);
      if (action === 'courses' && failCourses) throw Error('NETWORK');
      if (action.startsWith('jw')) assert.fail('disabled refresh cannot access academic endpoints');
      return action === 'profile' ? scenario.account
        : action === 'lntTerms' ? { semesters: [{ id: scenario.semesterId, name: 'LNT 新学期', is_active: true }] }
        : action === 'courses' ? { courses: [{ ...course, name: '新批课程', semester_id: scenario.semesterId }] }
        : action === 'todos' ? { todo_list: [{ ...todo, title: '新批待办' }] } : schoolData(action);
    };
    assert.equal(await f.learning.refresh(), false);
    assert.equal(f.stored(), saved);
    for (const key of ['account', 'term', 'courses', 'todos', 'rollcalls', 'schedule', 'scheduleAt']) assert.strictEqual(f.learning.getSnapshot()[key], before[key], key);
    if (scenario.account !== profile) {
      assert.equal(f.learning.getSnapshot().needsLogin, true);
      assert.deepEqual(f.calls, ['load', 'profile']);
      continue;
    }
    failCourses = false;
    assert.equal(await f.learning.refresh(), true);
    const next = f.learning.getSnapshot();
    assert.deepEqual(next.schedule, before.schedule);
    assert.equal(next.scheduleAt, before.scheduleAt);
    assert.equal(next.todos[0].title, '新批待办');
    assert.equal(next.courses[0].name, '新批课程');
    assert.equal(next.account.lntId, scenario.account.id);
    assert.equal(next.account.studentNumber, scenario.account.user_no);
    assert.equal(next.term.id, scenario.semesterId);
    const reopened = fixture(f.stored()); await reopened.learning.restore();
    assert.equal(reopened.learning.getSnapshot().authenticated, true);
    assert.deepEqual(reopened.learning.getSnapshot().schedule, before.schedule);
  }
});

test('legacy cache keeps timetable dates, history and update time across ordinary refresh and all save paths', async () => {
  const at = new Date(2026, 10, 2, 12).getTime(), later = at + 7 * 86400000;
  const legacy = { ...JSON.parse(previous), term: { jwTermCode: '20261', lntTermCode: '2026-1', name: '旧教务学期', currentWeek: 8, weeks: Array.from({ length: 18 }, (_, i) => i + 1) },
    courses: [{ ...course, semester_id: undefined, semester: { code: '2026-1' } }], coursesAt: at, scheduleAt: at - 7 * 86400000,
    schedule: { jwTermCode: '20261', rows: [scheduleRow], periods: schedulePeriods },
    history: [{ course_id: 3, course_name: course.name, rollcall_id: 11, rollcall_time: '2026-11-02T00:00:00Z', title: '签到', student_status: 'on_call', status: 'on_call_fine', student_status_detail: null }], historyAt: at };
  for (const calendar of [{ currentWeek: undefined, weeks: undefined }, { currentWeek: 0, weeks: [] }]) for (const schedule of [null, legacy.schedule]) {
    const raw = JSON.stringify({ ...legacy, term: { ...legacy.term, ...calendar }, schedule,
      courses: [{ ...course, semester: { code: '2026-1' } }] }), reopened = fixture(raw);
    await reopened.learning.restore();
    const data = reopened.learning.getSnapshot();
    assert.equal(data.authenticated, schedule === null, 'only a timetable needs a valid calendar');
    if (schedule === null) {
      assert.deepEqual(data.term, { id: 9, name: legacy.term.name });
      assert.deepEqual(data.history, legacy.history);
      assert.deepEqual([data.coursesAt, data.historyAt], [at, at]);
    } else assert.match(data.message, /读取失败/);
    assert.equal(reopened.stored(), raw);
  }
  const f = fixture(JSON.stringify(legacy)); f.learning = createLearning(f.device, () => later);
  await f.learning.restore();
  assert.equal(f.learning.getSnapshot().authenticated, true);
  assert.equal(schoolScheduleView(f.learning.getSnapshot(), new Date(later)).currentWeek, 9);
  assert.equal(await f.learning.setRefreshSchedule(false), true);
  assert.equal(await f.learning.refresh(), true);
  assert.equal(f.calls.some(action => action.startsWith('jw')), false);
  assert.equal(f.learning.getSnapshot().history.length, 1);
  assert.equal(f.learning.getSnapshot().scheduleAt, legacy.scheduleAt);
  assert.equal(schoolScheduleView(f.learning.getSnapshot(), new Date(later)).currentWeek, 9);
  const reopened = fixture(f.stored()); await reopened.learning.restore();
  assert.equal(schoolScheduleView(reopened.learning.getSnapshot(), new Date(later)).currentWeek, 9);
  assert.equal(reopened.learning.getSnapshot().scheduleAt, legacy.scheduleAt);
});


test('changing the timetable setting preserves an existing account before its first complete course refresh', async () => {
  const f = fixture(previous); await f.learning.restore();
  assert.equal(await f.learning.setRefreshSchedule(true), true);
  const reopened = fixture(f.stored()); await reopened.learning.restore();
  const data = reopened.learning.getSnapshot();
  assert.equal(data.authenticated, true);
  assert.equal(data.refreshSchedule, true);
  assert.deepEqual(data.account, { lntId: 42, studentNumber: '001234', name: '测试同学' });
  assert.deepEqual(data.todos, [todo]);
  assert.equal(data.term, null);
  assert.equal(data.schedule, null);
});


test('any request or save failure retains every collection and timestamp in the ordinary batch', async () => {
  const initial = fixture(); initial.learning = createLearning(initial.device, () => 1000);
  assert.equal(await initial.learning.login(), true);
  for (const enabled of [false, true]) {
    const setup = fixture(initial.stored()); await setup.learning.restore();
    assert.equal(await setup.learning.setRefreshSchedule(enabled), true);
    const saved = setup.stored();
    for (const failedAction of ['profile', 'todos', 'rollcalls', 'lntTerms', 'courses', ...(enabled ? ['jwSchedule'] : []), 'save']) {
      const f = fixture(saved); await f.learning.restore();
      const before = f.learning.getSnapshot(), seen = [];
      f.learning.subscribe(() => seen.push(f.learning.getSnapshot()));
      f.device.read = async action => {
        if (action === failedAction) throw Error('NETWORK');
        return action === 'profile' ? { ...profile, name: '新资料' }
          : action === 'todos' ? { todo_list: [{ ...todo, title: '新待办' }] }
          : action === 'rollcalls' ? { rollcalls: schoolRollcalls }
          : action === 'courses' ? { courses: [{ ...course, name: '新课程' }] }
          : action === 'jwWeek' ? { ...weeks, currentZc: '9' }
          : action === 'jwSchedule' ? { success: true, pkjgList: [{ ...scheduleRow, JASMC: '新教室' }] } : schoolData(action);
      };
      if (failedAction === 'save') f.device.save = async () => { throw Error('DISK'); };
      assert.equal(await f.learning.refresh(), false, failedAction);
      assert.equal(f.stored(), saved, failedAction);
      for (const snapshot of seen) for (const key of ['account', 'term', 'todos', 'todosAt', 'courses', 'coursesAt', 'rollcalls', 'schedule', 'scheduleAt', 'attendance', 'refreshSchedule']) {
        assert.strictEqual(snapshot[key], before[key], failedAction + ':' + key);
      }
      const reopened = fixture(f.stored()); await reopened.learning.restore();
      assert.deepEqual(reopened.learning.getSnapshot().courses, [course]);
      assert.equal(reopened.learning.getSnapshot().todos[0].title, '学校待办');
      assert.equal(reopened.learning.getSnapshot().schedule.rows[0].JASMC, '教学楼 101');
    }
  }
});


test('a setting change cannot replace unreadable account data with a preference-only cache', async () => {
  for (const failure of ['load', 'parse']) {
    const raw = failure === 'load' ? previous : '{invalid-json', f = fixture(raw);
    if (failure === 'load') f.device.load = async () => { throw Error('DISK'); };
    assert.equal(await f.learning.setRefreshSchedule(true), false);
    assert.equal(f.stored(), raw);
    assert.equal(f.learning.getSnapshot().refreshSchedule, false);
    assert.match(f.learning.getSnapshot().message, /读取失败/);
    assert.equal(await f.learning.login(), true);
    assert.equal(await f.learning.setRefreshSchedule(true), true);
    const reopened = fixture(f.stored()); await reopened.learning.restore();
    assert.equal(reopened.learning.getSnapshot().authenticated, true);
    assert.equal(reopened.learning.getSnapshot().refreshSchedule, true);
  }
});


test('enabled refresh waits for the timetable and successful saving before publishing its entire new batch', async () => {
  const initial = fixture(); initial.learning = createLearning(initial.device, () => 1000);
  assert.equal(await initial.learning.login(), true);
  assert.equal(await initial.learning.setRefreshSchedule(true), true);
  const f = fixture(initial.stored()); await f.learning.restore();
  const before = f.learning.getSnapshot(), saved = f.stored(), reads = deferred(), disk = deferred(), save = f.device.save;
  f.device.read = async action => action === 'jwSchedule' ? reads.promise
    : action === 'profile' ? { ...profile, name: '更新资料' }
    : action === 'todos' ? { todo_list: [{ ...todo, title: '更新待办' }] }
    : action === 'courses' ? { courses: [{ ...course, name: '更新课程' }] }
    : action === 'rollcalls' ? { rollcalls: schoolRollcalls }
    : schoolData(action);
  f.device.save = async value => { await disk.promise; await save(value); };
  const pending = f.learning.refresh(); await tick();
  const assertOld = () => {
    assert.equal(f.stored(), saved);
    for (const key of ['account', 'todos', 'courses', 'term', 'rollcalls', 'schedule', 'todosAt', 'coursesAt', 'scheduleAt']) assert.strictEqual(f.learning.getSnapshot()[key], before[key], key);
  };
  assertOld();
  reads.resolve({ success: true, pkjgList: [{ ...scheduleRow, JASMC: '更新教室' }] }); await tick(); assertOld();
  disk.resolve(); assert.equal(await pending, true);
  const next = f.learning.getSnapshot();
  assert.equal(next.account.name, '更新资料');
  assert.equal(next.todos[0].title, '更新待办');
  assert.equal(next.courses[0].name, '更新课程');
  assert.equal(next.schedule.currentWeek, before.schedule.currentWeek);
  assert.equal(next.schedule.weekAt, before.schedule.weekAt);
  assert.equal(next.rollcalls.length, 3);
  assert.equal(next.schedule.rows[0].JASMC, '更新教室');
  assert.deepEqual([next.todosAt, next.coursesAt, next.scheduleAt], [2000, 2000, 2000]);
  const reopened = fixture(f.stored()); await reopened.learning.restore();
  for (const key of ['account', 'todos', 'courses', 'term', 'rollcalls', 'schedule']) assert.deepEqual(reopened.learning.getSnapshot()[key], next[key]);
});

test('setting writes preserve accepted attendance, report storage failure, and cannot survive logout or account replacement', async () => {
  const broken = await attendanceFixture(), old = broken.stored();
  broken.device.save = async () => { throw Error('DISK'); };
  assert.equal(await broken.learning.setRefreshSchedule(true), false);
  assert.equal(broken.learning.getSnapshot().refreshSchedule, false);
  assert.equal(broken.stored(), old);
  assert.match(broken.learning.getSnapshot().message, /设置保存失败/);
  const f = await attendanceFixture(), gate = deferred(), save = f.device.save;
  let first = true;
  f.device.save = async value => { if (first) { first = false; await gate.promise; } await save(value); };
  const setting = f.learning.setRefreshSchedule(true); await tick();
  assert.equal((await f.learning.submitNumber('81', '0206')).result, 'success');
  f.learning.attendanceDismissed({ openIds: [] }); gate.resolve();
  assert.equal(await setting, true); await tick();
  const reopened = fixture(f.stored()); await reopened.learning.restore();
  assert.equal(reopened.learning.getSnapshot().refreshSchedule, true);
  assert.equal(reopened.learning.getSnapshot().attendance['81'], 'success');
  assert.deepEqual(reopened.learning.getSnapshot().courses, [course]);
  for (const action of ['logout', 'login']) {
    const f = fixture(); await f.learning.login();
    const gate = deferred(), save = f.device.save;
    f.device.save = async value => { await gate.promise; await save(value); };
    const setting = f.learning.setRefreshSchedule(true); await tick();
    f.device.read = async name => name === 'profile' ? { ...profile, id: 99, user_no: '009999' } : schoolData(name);
    const replacement = action === 'logout' ? f.learning.logout() : f.learning.login();
    gate.resolve();
    assert.equal(await setting, false);
    assert.equal(await replacement, true);
    assert.equal(f.learning.getSnapshot().refreshSchedule, false);
    if (action === 'logout') assert.equal(f.stored(), null);
    else assert.equal(JSON.parse(f.stored()).account.studentNumber, '009999');
  }
});

test('todo deadlines use calendar days and Monday-based weeks without a year', () => {
  const monday = new Date(2026, 10, 16, 22);
  const cases = [
    [monday, new Date(2026, 10, 16, 8, 5), '今天 08:05'],
    [monday, new Date(2026, 10, 17), '明天 00:00'],
    [monday, new Date(2026, 10, 18, 23, 59), '后天 23:59'],
    [monday, new Date(2026, 10, 19, 18), '周四 18:00'],
    [monday, new Date(2026, 10, 22, 18), '周日 18:00'],
    [monday, new Date(2026, 10, 23, 18), '11月23日 18:00'],
    [monday, new Date(2027, 0, 3, 18), '1月3日 18:00'],
    [monday, new Date(2026, 10, 15, 18), '11月15日 18:00'],
    [new Date(2026, 10, 19), new Date(2026, 10, 17, 18), '周二 18:00'],
    [new Date(2026, 10, 19), new Date(2026, 10, 15, 18), '11月15日 18:00'],
    [new Date(2026, 10, 22, 23, 59), new Date(2026, 10, 23), '明天 00:00'],
    [new Date(2026, 10, 22), new Date(2026, 10, 24, 18), '后天 18:00'],
    [new Date(2026, 10, 22), new Date(2026, 10, 25, 18), '11月25日 18:00'],
    [new Date(2026, 10, 30), new Date(2026, 11, 1, 18), '明天 18:00'],
    [new Date(2026, 11, 31), new Date(2027, 0, 1, 18), '明天 18:00'],
    [new Date(2026, 11, 31), new Date(2027, 0, 2, 18), '后天 18:00'],
    [new Date(2026, 11, 31), new Date(2027, 0, 3, 18), '周日 18:00'],
    [new Date(2026, 11, 31), new Date(2027, 0, 4, 18), '1月4日 18:00'],
    [new Date(2028, 1, 28, 23), new Date(2028, 1, 29, 18), '明天 18:00'],
    [new Date(2028, 1, 28), new Date(2028, 2, 1, 18), '后天 18:00'],
    [new Date(2026, 2, 7, 23), new Date(2026, 2, 9, 18), '后天 18:00'],
  ];
  for (const [now, end, expected] of cases) {
    const item = { ...todo, end_time: end.toISOString() };
    assert.equal(todoView(item, now).deadline, expected);
    assert.equal(item.end_time, end.toISOString(), 'display never rewrites the school timestamp');
  }
  assert.equal(todoView({ ...todo, end_time: null }, monday).deadline, null);
});
