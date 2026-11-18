import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLearning, historyView } from '../src/learning.ts';
import { visibleHistory } from '../src/demo-data.ts';

const course = { id: 3, course_code: '001-A', name: '学校课程', semester_id: 9 };
const otherCourse = { ...course, id: 4, name: '另一课程' };
const term = { id: 9, name: '秋季学期' };
const record = { rollcall_id: 11, student_rollcall_id: 111, rollcall_time: '2026-11-08T08:00:00+08:00', title: '课堂签到', student_status: 'on_call', status: 'on_call_fine', student_status_detail: null, is_number: true, is_radar: false, type: 'manual', rollcall_status: 'closed', is_expired: true };
const scheduleRow = { WID: 'row-1', BJDM: '001-A', KCMC: '学校课程', JASMC: '教学楼 101', JSXM: '张老师', XQ: 2, KSJCDM: 1, JSJCDM: 1, KSSJ: '0800', JSSJ: '0845', ZCMC: '8周', JCFADM: 'a' };
const saved = { version: 1, account: { lntId: 42, studentNumber: '001234', name: '测试同学' }, todos: [], todosAt: 1000, term, courses: [course, otherCourse], coursesAt: 1000 };
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(raw = JSON.stringify(saved)) {
  const calls = [];
  const device = {
    load: async () => raw, save: async value => { raw = value; }, clear: async () => { raw = null; }, authenticate: async callback => callback?.(),
    read: async (action, params) => {
      calls.push([action, params]);
      if (action === 'history') return { rollcalls: params.courseId === 3 ? [record] : [{ ...record, rollcall_id: 12, student_rollcall_id: 112, rollcall_time: '2026-11-08T01:00:00Z', student_status: 'absent', status: 'absent', student_status_detail: '未到课堂', is_number: false, type: 'qr_rollcall' }] };
      return { profile: { id: 42, user_no: '001234', name: '测试同学' }, todos: { todo_list: [] }, rollcalls: { rollcalls: [] }, courses: { courses: [course, otherCourse] },
        lntTerms: { semesters: [{ id: 9, name: 'LNT 秋季', is_active: true }] },
        jwTerms: { datas: { kfdxnxqcx: { rows: [{ DM: '20261', MC: '秋季学期' }] } } }, jwWeek: { success: true, currentZc: 8, zcList: [{ ZC: 8 }] },
        jwSchedule: { success: true, pkjgList: [scheduleRow] } }[action];
    },
  };
  return { device, calls, stored: () => raw, learning: createLearning(device, () => 2000) };
}

test('history display uses UTC+8 dates and times and keeps actual-instant sorting', () => {
  const cases = [
    ['2026-11-09T01:17:00Z', '2026-11-09', '09:17'],
    ['2026-11-09T00:17:00Z', '2026-11-09', '08:17'],
    ['2026-11-09T08:17:00+08:00', '2026-11-09', '08:17'],
    ['2026-11-08T16:17:00-08:00', '2026-11-09', '08:17'],
    ['2026-11-08T16:00:00Z', '2026-11-09', '00:00'],
    ['2026-11-08T15:59:00Z', '2026-11-08', '23:59'],
    ['2026-10-31T16:17:00Z', '2026-11-01', '00:17'],
    ['2026-12-31T16:17:00Z', '2027-01-01', '00:17'],
  ];
  const items = cases.map(([rollcall_time], index) => historyView({ ...record, course_id: 3, course_name: '学校课程', rollcall_id: index + 1, rollcall_time }));
  assert.deepEqual(items.map(item => [item.date, item.time]), cases.map(([, date, time]) => [date, time]));
  assert.equal(items[0].at, 1794187020000);
  assert.equal(items[1].at, items[2].at); assert.equal(items[1].at, items[3].at);
  assert.deepEqual(visibleHistory(items, 'all').map(item => item.id), ['3:8', '3:1', '3:2', '3:3', '3:4', '3:5', '3:6', '3:7']);
  assert.deepEqual(visibleHistory(items, 'today', '2026-11-09').map(item => item.id), ['3:1', '3:2', '3:3', '3:4', '3:5']);
  assert.deepEqual(visibleHistory(items, 'today', '2026-11-08').map(item => item.id), ['3:6']);
});

test('default today filtering uses the same UTC+8 date as displayed history', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-09T17:00:00Z') });
  const item = historyView({ ...record, course_id: 3, course_name: '学校课程', rollcall_time: '2026-11-09T16:17:00Z' });
  assert.equal(item.date, '2026-11-10');
  assert.deepEqual(visibleHistory([item], 'today'), [item]);
  t.mock.timers.setTime(Date.parse('2026-11-09T15:59:00Z'));
  assert.deepEqual(visibleHistory([item], 'today'), []);
});

test('login reads every course history and caches the complete batch before publishing or reopening', async () => {
  const f = fixture(null), started = [], gates = new Map([[3, deferred()], [4, deferred()]]), saving = deferred();
  const { read, save } = f.device;
  f.device.read = async (action, params) => {
    if (action === 'history') { started.push(params); await gates.get(params.courseId).promise; }
    return read(action, params);
  };
  f.device.save = async value => { await saving.promise; return save(value); };
  const pending = f.learning.login(); await tick();
  try {
    assert.deepEqual([...started], [{ courseId: 3, studentId: 42 }, { courseId: 4, studentId: 42 }]);
    assert.equal(f.learning.getSnapshot().authenticated, true);
    assert.equal(f.learning.getSnapshot().account, null);
    assert.equal(f.learning.getSnapshot().coursesAt, null);
    assert.equal(f.learning.getSnapshot().term, null);
    assert.equal(f.learning.getSnapshot().todosAt, null);
    assert.equal(f.learning.getSnapshot().schedule, null);
    assert.equal(f.learning.getSnapshot().scheduleAt, null);
    assert.deepEqual(f.learning.getSnapshot().rollcalls, []);
    assert.equal(f.learning.getSnapshot().historyAt, null);
    gates.get(4).resolve(); await tick();
    assert.deepEqual(f.learning.getSnapshot().history, []); assert.equal(f.stored(), null);
    gates.get(3).resolve(); await tick();
    assert.equal(f.learning.getSnapshot().account, null); assert.equal(f.stored(), null);
    saving.resolve(); assert.equal(await pending, true);
    const snapshot = f.learning.getSnapshot(), cache = JSON.parse(f.stored());
    assert.deepEqual(snapshot.history.map(item => item.rollcall_id), [12, 11]);
    assert.equal(snapshot.historyAt, 2000);
    assert.deepEqual(cache.history, snapshot.history);
    assert.equal(cache.todosAt, 2000); assert.equal(cache.coursesAt, 2000); assert.equal(cache.historyAt, 2000);
    assert.equal(cache.scheduleAt, 2000); assert.equal(cache.schedule.rows.length, 1);
    assert.deepEqual(cache.rollcalls, []); assert.equal(cache.refreshSchedule, false);
    const reopened = fixture(f.stored()); await reopened.learning.restore();
    for (const key of ['account', 'todos', 'todosAt', 'term', 'courses', 'coursesAt', 'rollcalls', 'schedule', 'scheduleAt', 'history', 'historyAt', 'attendance', 'refreshSchedule']) {
      assert.deepEqual(cache[key], snapshot[key], key);
      assert.deepEqual(reopened.learning.getSnapshot()[key], snapshot[key], key);
    }
    assert.deepEqual(reopened.learning.getSnapshot().history, snapshot.history);
    assert.equal(reopened.learning.getSnapshot().historyAt, 2000);
  } finally { for (const gate of gates.values()) gate.resolve(); saving.resolve(); await pending; }
});

test('login without a profile id keeps the old batch and never invents a history student id', async () => {
  for (const courses of [[course], []]) {
    const f = fixture(); await f.learning.restore();
    const previous = f.stored(), before = f.learning.getSnapshot(), read = f.device.read;
    f.device.read = async (action, params) => action === 'profile' ? { user_no: '009999', name: '另一同学' }
      : action === 'courses' ? { courses } : read(action, params);
    assert.equal(await f.learning.login(), false);
    assert.equal(f.learning.getSnapshot().authenticated, true);
    assert.equal(f.learning.getSnapshot().needsLogin, false);
    assert.equal(f.stored(), previous);
    assert.deepEqual(f.learning.getSnapshot().account, before.account);
    assert.deepEqual(f.learning.getSnapshot().courses, before.courses);
    assert.equal(f.calls.some(([action]) => action === 'history'), false);
    assert.match(f.learning.getSnapshot().message, /历史签到读取失败/);
  }
});

test('login history read, parse, and save failures retain the entire old batch, including late responses', async () => {
  for (const failure of ['read', 'parse', 'save', 'expired']) {
    const f = await combinedFixture(true);
    assert.equal((await f.learning.submitNumber('81', '0007')).result, 'success');
    f.learning.attendanceDismissed({ ids: ['81'] }); await tick();
    const previous = f.stored(), before = f.learning.getSnapshot(), late = deferred(), read = f.device.read;
    f.device.read = async (action, params) => {
      if (action === 'profile') return { id: 99, user_no: '009999', name: '另一同学' };
      if (action === 'history' && params.courseId === 3 && failure !== 'save') await late.promise;
      if (action === 'history' && params.courseId === 4) {
        if (failure === 'read') throw Error('NETWORK');
        if (failure === 'parse') return { rollcalls: [{ ...record, status: 'unconfirmed' }] };
        if (failure === 'expired') throw Object.assign(Error('private response'), { code: 'AUTH_REQUIRED' });
      }
      return read(action, params);
    };
    if (failure === 'save') f.device.save = async () => { throw Error('DISK'); };
    const pending = f.learning.login();
    try {
      assert.equal(await pending, false);
      late.resolve(); await tick();
      assert.equal(f.stored(), previous);
      for (const key of ['account', 'todos', 'todosAt', 'term', 'courses', 'coursesAt', 'schedule', 'scheduleAt', 'rollcalls', 'attendance', 'refreshSchedule', 'history', 'historyAt']) {
        assert.deepEqual(f.learning.getSnapshot()[key], before[key], key);
      }
      assert.equal(f.learning.getSnapshot().authenticated, failure !== 'expired');
      assert.equal(f.learning.getSnapshot().needsLogin, failure === 'expired');
      assert.match(f.learning.getSnapshot().message, failure === 'expired' ? /登录失效/ : failure === 'save' ? /保存失败/ : /历史签到读取失败/);
      assert.doesNotMatch(f.learning.getSnapshot().message, /private response/);
    } finally { late.resolve(); await pending; }
  }
});

test('history reads the current courses with the profile id, merges by time, and survives reopen and ordinary refresh', async () => {
  const f = fixture(); await f.learning.restore();
  assert.equal(await f.learning.refreshHistory(), true);
  assert.deepEqual(f.calls, [['history', { courseId: 3, studentId: 42 }], ['history', { courseId: 4, studentId: 42 }]]);
  const snapshot = f.learning.getSnapshot();
  assert.deepEqual(snapshot.history.map(item => [item.course_id, item.rollcall_id, item.status, item.student_status_detail]), [[4, 12, 'absent', '未到课堂'], [3, 11, 'on_call_fine', null]]);
  assert.equal(snapshot.historyAt, 2000);
  const raw = f.stored(), views = snapshot.history.map(historyView);
  assert.deepEqual(views.map(item => [item.date, item.time]), [['2026-11-08', '09:00'], ['2026-11-08', '08:00']]);
  assert.deepEqual(snapshot.history.map(historyView), views);
  assert.deepEqual(JSON.parse(raw).history.map(item => [item.rollcall_time, item.title]), [
    ['2026-11-08T01:00:00Z', '课堂签到'], ['2026-11-08T08:00:00+08:00', '课堂签到'],
  ]);
  assert.equal(f.stored(), raw, 'display never rewrites the saved school fields');
  const reopened = fixture(raw); await reopened.learning.restore();
  assert.deepEqual(reopened.learning.getSnapshot().history, snapshot.history);
  assert.deepEqual(reopened.learning.getSnapshot().history.map(historyView), views);
  assert.equal(reopened.stored(), raw, 'reopening never accumulates a display offset');
  f.calls.length = 0; assert.equal(await f.learning.refresh(), true);
  assert.equal(f.calls.some(([action]) => action === 'history'), false);
  assert.deepEqual(JSON.parse(f.stored()).history, snapshot.history);
});

test('history starts every course before the first response and publishes one sorted collection after all complete', async () => {
  const f = fixture(); await f.learning.restore();
  const previous = f.stored(), started = [], gates = new Map([[3, deferred()], [4, deferred()]]), read = f.device.read;
  f.device.read = async (action, params) => {
    if (action === 'history') { started.push(params); await gates.get(params.courseId).promise; }
    return read(action, params);
  };
  const pending = f.learning.refreshHistory(); await tick();
  try {
    assert.deepEqual([...started], [{ courseId: 3, studentId: 42 }, { courseId: 4, studentId: 42 }]);
    gates.get(4).resolve(); await tick();
    assert.deepEqual(f.learning.getSnapshot().history, []);
    assert.equal(f.stored(), previous);
    gates.get(3).resolve(); assert.equal(await pending, true);
    assert.deepEqual(f.learning.getSnapshot().history.map(item => item.rollcall_id), [12, 11]);
    assert.equal(f.calls.filter(([action]) => action === 'history').length, 2);
  } finally { for (const gate of gates.values()) gate.resolve(); await pending; }
});

test('history waits for an ordinary batch and can still read saved course scope when that batch fails', async () => {
  const f = fixture(); await f.learning.restore();
  const gate = deferred(), read = f.device.read;
  f.device.read = async (action, params) => {
    if (action === 'todos') { await gate.promise; throw Error('NETWORK'); }
    return read(action, params);
  };
  const ordinary = f.learning.refresh(); await tick();
  const history = f.learning.refreshHistory();
  gate.resolve(); assert.equal(await ordinary, false);
  assert.equal(await history, true);
  assert.equal(f.learning.getSnapshot().history.length, 2);
  assert.equal(f.learning.getSnapshot().coursesAt, 1000);
});

test('overlapping history calls share the read and queued ordinary refresh preserves its saved result', async () => {
  const f = fixture(); await f.learning.restore();
  const gate = deferred(), read = f.device.read;
  f.device.read = async (action, params) => { if (action === 'history') await gate.promise; return read(action, params); };
  const history = f.learning.refreshHistory();
  assert.strictEqual(f.learning.refreshHistory(), history);
  const ordinary = f.learning.refresh(); await tick();
  assert.equal(f.learning.getSnapshot().historyRefreshing, true);
  assert.equal(f.learning.getSnapshot().refreshing, false);
  gate.resolve(); assert.equal(await history, true); assert.equal(await ordinary, true);
  assert.equal(f.calls.filter(([action]) => action === 'history').length, 2);
  assert.equal(JSON.parse(f.stored()).history.length, 2);
  assert.equal(f.learning.getSnapshot().historyRefreshing, false);
});

test('history errors keep the last saved collection and authentication expiry stays explicit', async () => {
  const f = fixture(); await f.learning.restore(); await f.learning.refreshHistory();
  const previous = f.stored(), before = f.learning.getSnapshot().history;
  const { read, save } = f.device;
  const invalid = [{}, { rollcalls: null }, { success: false, rollcalls: [] },
    { rollcalls: [{ ...record, rollcall_time: '2026-11-08T08:00:00' }] },
    { rollcalls: [{ ...record, rollcall_id: '11' }] }, { rollcalls: [{ ...record, status: 'unconfirmed' }] }];
  for (const response of invalid) {
    f.device.read = async () => response;
    assert.equal(await f.learning.refreshHistory(), false);
    assert.equal(f.stored(), previous); assert.deepEqual(f.learning.getSnapshot().history, before);
    assert.match(f.learning.getSnapshot().historyMessage, /读取失败/);
  }
  f.device.read = read; f.device.save = async () => { throw Error('DISK'); };
  assert.equal(await f.learning.refreshHistory(), false); assert.equal(f.stored(), previous);
  assert.match(f.learning.getSnapshot().historyMessage, /保存失败/);
  f.device.save = save; f.device.read = async () => { throw Object.assign(Error('private data'), { code: 'AUTH_REQUIRED' }); };
  assert.equal(await f.learning.refreshHistory(), false);
  assert.equal(f.learning.getSnapshot().authenticated, false); assert.equal(f.learning.getSnapshot().needsLogin, true);
  assert.doesNotMatch(f.learning.getSnapshot().historyMessage, /private/);
  f.device.read = () => assert.fail('expired sessions must wait for explicit login');
  assert.equal(await f.learning.refreshHistory(), false);
});

test('logout and replacement login cannot be undone by late history reads or writes', async () => {
  for (const phase of ['read', 'save']) {
    const f = fixture(); await f.learning.restore();
    const gate = deferred(), { read, save } = f.device;
    if (phase === 'read') f.device.read = async (action, params) => { if (action === 'history') await gate.promise; return read(action, params); };
    else f.device.save = async value => { await gate.promise; return save(value); };
    const pending = f.learning.refreshHistory(); await tick();
    const logout = f.learning.logout();
    assert.deepEqual(f.learning.getSnapshot().history, []);
    gate.resolve(); assert.equal(await pending, false); assert.equal(await logout, true);
    assert.equal(f.stored(), null); assert.deepEqual(f.learning.getSnapshot().history, []);
  }
  const f = fixture(); await f.learning.restore();
  const gate = deferred(), read = f.device.read;
  f.device.read = async (action, params) => { if (action === 'history') await gate.promise; return read(action, params); };
  const pending = f.learning.refreshHistory(); await tick();
  f.device.read = async (action, params) => action === 'profile' ? { id: 99, name: '另一同学' }
    : action === 'history' && params.studentId === 99 ? { rollcalls: [] } : read(action, params);
  assert.equal(await f.learning.login(), true);
  gate.resolve(); assert.equal(await pending, false);
  assert.equal(f.learning.getSnapshot().account.lntId, 99); assert.deepEqual(JSON.parse(f.stored()).history, []);
});

test('logout discards a login batch waiting for history or saving', async () => {
  for (const phase of ['read', 'save']) {
    const f = fixture(); await f.learning.restore();
    const gate = deferred(), { read, save } = f.device;
    if (phase === 'read') f.device.read = async (action, params) => {
      if (action === 'history') await gate.promise;
      return read(action, params);
    };
    else f.device.save = async value => { await gate.promise; return save(value); };
    const pending = f.learning.login(); await tick();
    assert.strictEqual(f.learning.login(), pending);
    const logout = f.learning.logout();
    try {
      assert.equal(f.learning.getSnapshot().authenticated, false);
      gate.resolve(); assert.equal(await pending, false); assert.equal(await logout, true);
      assert.equal(f.learning.getSnapshot().account, null);
      assert.deepEqual(f.learning.getSnapshot().history, []); assert.equal(f.stored(), null);
    } finally { gate.resolve(); await pending; await logout; }
  }
});

test('history clears after explicit account replacement, a term change, or an empty collection', async () => {
  for (const changed of ['account', 'term', 'empty']) {
    const f = fixture(); await f.learning.restore(); await f.learning.refreshHistory();
    const read = f.device.read;
    f.device.read = async (action, params) => {
      if (changed === 'account' && action === 'profile') return { id: 99, user_no: '009999' };
      if (changed === 'term' && action === 'lntTerms') return { semesters: [{ id: 10, name: 'LNT 春季', is_active: true }] };
      if (changed === 'term' && action === 'courses') return { courses: [{ ...course, semester_id: 10 }] };
      if ((changed === 'empty' || changed === 'account') && action === 'history') return { rollcalls: [] };
      return read(action, params);
    };
    if (changed === 'account') {
      const oldBatch = f.stored();
      assert.equal(await f.learning.refresh(), false);
      assert.equal(f.stored(), oldBatch);
      assert.equal(await f.learning.login(), true);
    } else {
      assert.equal(await (changed === 'empty' ? f.learning.refreshHistory() : f.learning.refresh()), true);
    }
    assert.deepEqual(f.learning.getSnapshot().history, []);
    assert.deepEqual(JSON.parse(f.stored()).history, []);
  }
});


test('independent history refresh keeps the timetable and does not read ordinary collections', async () => {
  const f = fixture(); await f.learning.restore(); assert.equal(await f.learning.login(), true);
  const before = f.learning.getSnapshot(); assert.equal(before.schedule.rows.length, 1);
  f.calls.length = 0; assert.equal(await f.learning.refreshHistory(), true);
  assert.deepEqual(f.calls, [['history', { courseId: 3, studentId: 42 }], ['history', { courseId: 4, studentId: 42 }]]);
  assert.deepEqual(f.learning.getSnapshot().schedule, before.schedule);
  const stored = JSON.parse(f.stored());
  assert.deepEqual(stored.schedule, before.schedule); assert.equal(stored.scheduleAt, before.scheduleAt);
  assert.deepEqual(stored.todos, before.todos); assert.equal(stored.coursesAt, before.coursesAt);
});

test('ordinary and history refresh preserve both collections in either order and after cache reopen', async () => {
  for (const order of [['refreshHistory', 'refresh'], ['refresh', 'refreshHistory']]) {
    const f = fixture(); await f.learning.restore(); assert.equal(await f.learning.login(), true);
    const before = f.learning.getSnapshot(); f.calls.length = 0;
    const first = f.learning[order[0]](), second = f.learning[order[1]]();
    assert.equal(await first, true); assert.equal(await second, true);
    const ordinary = ['profile', 'todos', 'rollcalls', 'lntTerms', 'courses'], history = ['history', 'history'];
    assert.deepEqual(f.calls.map(([action]) => action), order[0] === 'refreshHistory' ? [...history, ...ordinary] : [...ordinary, ...history]);
    const stored = JSON.parse(f.stored()); assert.equal(stored.history.length, 2);
    assert.deepEqual(stored.schedule, before.schedule); assert.equal(stored.scheduleAt, before.scheduleAt);
    assert.deepEqual(f.learning.getSnapshot().history, stored.history);
    const reopened = fixture(f.stored()); await reopened.learning.restore();
    assert.deepEqual(reopened.calls, []);
    assert.deepEqual(reopened.learning.getSnapshot().schedule, stored.schedule);
    assert.deepEqual(reopened.learning.getSnapshot().history, stored.history);
    assert.equal(reopened.learning.getSnapshot().scheduleAt, stored.scheduleAt);
    assert.equal(reopened.learning.getSnapshot().historyAt, stored.historyAt);
  }
});


async function combinedFixture(enabled = false) {
  const f = fixture(), read = f.device.read;
  f.device.read = async (action, params) => {
    const response = await read(action, params);
    return action === 'rollcalls' ? { rollcalls: [{ rollcall_id: 81, course_id: 3, course_title: '学校活动', is_number: true }] } : response;
  };
  f.device.answerNumber = async () => ({ result: 'success', message: '学校确认' });
  await f.learning.restore();
  assert.equal(await f.learning.login(), true);
  assert.equal(await f.learning.refreshHistory(), true);
  assert.equal(await f.learning.setRefreshSchedule(enabled), true);
  return f;
}

test('both ordinary/history orders preserve all collections, accepted receipts and the timetable setting in either mode', async () => {
  for (const enabled of [false, true]) for (const order of [['refreshHistory', 'refresh'], ['refresh', 'refreshHistory']]) {
    const f = await combinedFixture(enabled);
    assert.equal((await f.learning.submitNumber('81', '0007')).result, 'success');
    await tick();
    const before = f.learning.getSnapshot(); f.calls.length = 0;
    const first = f.learning[order[0]](), second = f.learning[order[1]]();
    assert.equal(await first, true); assert.equal(await second, true);
    const ordinary = ['profile', 'todos', 'rollcalls', 'lntTerms', 'courses', ...(enabled ? ['jwSchedule'] : [])];
    const history = ['history', 'history'];
    assert.deepEqual(f.calls.map(([action]) => action), order[0] === 'refreshHistory' ? [...history, ...ordinary] : [...ordinary, ...history]);
    const stored = JSON.parse(f.stored());
    assert.equal(stored.refreshSchedule, enabled); assert.equal(stored.attendance['81'], 'success');
    assert.deepEqual(stored.rollcalls, before.rollcalls); assert.deepEqual(stored.history, before.history);
    assert.deepEqual(stored.schedule, before.schedule); assert.equal(stored.scheduleAt, before.scheduleAt);
    const reopened = fixture(f.stored()); await reopened.learning.restore();
    for (const key of ['account', 'term', 'todos', 'todosAt', 'courses', 'coursesAt', 'rollcalls', 'schedule', 'scheduleAt', 'history', 'historyAt', 'attendance', 'refreshSchedule']) {
      assert.deepEqual(reopened.learning.getSnapshot()[key], stored[key], key);
    }
  }
});

test('history, setting and accepted receipt writes preserve each other while sharing the save queue', async () => {
  for (const firstAction of ['history', 'setting']) {
    const f = await combinedFixture(), before = f.learning.getSnapshot(), gate = deferred(), save = f.device.save;
    let firstSave = true;
    f.device.save = async value => { if (firstSave) { firstSave = false; await gate.promise; } await save(value); };
    const first = firstAction === 'history' ? f.learning.refreshHistory() : f.learning.setRefreshSchedule(true);
    await tick();
    const second = firstAction === 'history' ? f.learning.setRefreshSchedule(true) : f.learning.refreshHistory();
    await tick();
    assert.equal((await f.learning.submitNumber('81', '0007')).result, 'success');
    assert.deepEqual(f.learning.getSnapshot().pendingAttendance, { '81': 'success' });
    gate.resolve(); assert.equal(await first, true); assert.equal(await second, true); await tick();
    const stored = JSON.parse(f.stored());
    assert.equal(stored.refreshSchedule, true); assert.equal(stored.attendance['81'], 'success');
    for (const key of ['account', 'term', 'todos', 'todosAt', 'courses', 'coursesAt', 'rollcalls', 'schedule', 'scheduleAt', 'history', 'historyAt']) assert.deepEqual(stored[key], before[key], key);
    const reopened = fixture(f.stored()); await reopened.learning.restore();
    assert.equal(reopened.learning.getSnapshot().refreshSchedule, true);
    assert.equal(reopened.learning.getSnapshot().attendance['81'], 'success');
    assert.deepEqual(reopened.learning.getSnapshot().history, before.history);
  }
});

test('every failed ordinary request or save keeps the complete combined cache and published batch', async () => {
  for (const enabled of [false, true]) {
    const setup = await combinedFixture(enabled);
    await setup.learning.submitNumber('81', '0007'); await tick();
    const saved = setup.stored();
    for (const failure of ['profile', 'todos', 'rollcalls', 'lntTerms', 'courses', ...(enabled ? ['jwSchedule'] : []), 'save']) {
      const f = fixture(saved); await f.learning.restore();
      const before = f.learning.getSnapshot(), seen = [], read = f.device.read;
      f.learning.subscribe(() => seen.push(f.learning.getSnapshot()));
      f.device.read = async (action, params) => {
        if (action === failure) throw Error('NETWORK');
        if (action === 'profile') return { id: 42, user_no: '001234', name: '本批新资料' };
        if (action === 'courses') return { courses: [{ ...course, name: '本批新课程' }] };
        if (action === 'jwSchedule') return { success: true, pkjgList: [] };
        return read(action, params);
      };
      if (failure === 'save') f.device.save = async () => { throw Error('DISK'); };
      assert.equal(await f.learning.refresh(), false, failure);
      assert.equal(f.stored(), saved, failure);
      for (const snapshot of seen) for (const key of ['account', 'term', 'todos', 'todosAt', 'courses', 'coursesAt', 'rollcalls', 'schedule', 'scheduleAt', 'history', 'historyAt', 'attendance', 'refreshSchedule']) assert.deepEqual(snapshot[key], before[key], failure + ':' + key);
    }
  }
});

test('submission authentication expiry cancels in-flight history and finishes its loading state', async () => {
  for (const phase of ['read', 'queued-save']) {
    const f = await combinedFixture(), before = f.learning.getSnapshot(), gate = deferred(), read = f.device.read, save = f.device.save;
    let setting;
    if (phase === 'read') f.device.read = async (action, params) => { if (action === 'history') await gate.promise; return read(action, params); };
    else {
      let firstSave = true;
      f.device.save = async value => { if (firstSave) { firstSave = false; await gate.promise; } await save(value); };
      setting = f.learning.setRefreshSchedule(true); await tick();
    }
    const history = f.learning.refreshHistory(); await tick();
    assert.equal(f.learning.getSnapshot().historyRefreshing, true);
    f.device.answerNumber = async () => { throw Object.assign(Error('private'), { code: 'AUTH_REQUIRED' }); };
    try {
      assert.equal((await f.learning.submitNumber('81', '0007')).result, 'failed');
      assert.equal(f.learning.getSnapshot().historyRefreshing, false);
      assert.equal(f.learning.getSnapshot().authenticated, false);
      assert.equal(f.learning.getSnapshot().needsLogin, true);
    } finally { gate.resolve(); }
    if (setting) assert.equal(await setting, true);
    assert.equal(await history, false);
    assert.deepEqual(f.learning.getSnapshot().history, before.history);
    assert.equal(f.learning.getSnapshot().historyAt, before.historyAt);
    assert.deepEqual(JSON.parse(f.stored()).history, before.history);
    assert.equal(await f.learning.refreshHistory(), false);
  }
});
