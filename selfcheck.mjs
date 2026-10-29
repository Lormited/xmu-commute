import assert from 'node:assert/strict';
import { DEMO_STUDENT_ID, cleanCode, codeResult, courses, groupSessions, periods, shouldRefresh, pageAtOffset, weekDays, TERM, sessionsForWeek, todos, todoFixtures, visibleHistory, historyLabel, movedBeyondTap, canActivatePress } from './src/demo-data.ts';
import { demoReducer, initialState, canAttend, activeRollcalls } from './src/demo-state.ts';

assert.equal(cleanCode(' 0a2-06x9'), '0206');
assert.match(DEMO_STUDENT_ID, /^\d{14}$/);
assert.equal(codeResult('206', 'success'), 'incomplete');
assert.equal(codeResult('0000', 'success'), 'failed');
for (const result of ['success', 'ended', 'failed']) assert.equal(codeResult('0206', result), result);
assert.deepEqual(weekDays(TERM.currentWeek).map(day => day.date), [26, 27, 28, 29, 30, 31, 1]);
assert.equal(weekDays(TERM.currentWeek + 1)[0].date, 2);
assert.deepEqual(weekDays(TERM.currentWeek).filter(day => day.today).map(day => day.date), [26], 'only the full demo date is today');
assert.equal(weekDays(TERM.currentWeek - 1).some(day => day.today), false);
assert.equal(weekDays(TERM.currentWeek + 1).some(day => day.today), false, 'other weeks do not highlight the same weekday');
assert.deepEqual(sessionsForWeek(0), []);
assert.deepEqual(sessionsForWeek(19), []);
assert.equal(courses.length, 9);
assert.equal(todos.length, 10);
assert.equal(sessionsForWeek(8).length, 12);
assert.equal(periods.length, 11, 'there is no twelfth lesson period');
assert.ok(sessionsForWeek(8).some(item => item.id === 'circuits-fri'));
assert.ok(!sessionsForWeek(8).some(item => item.id === 'math-fri'));
assert.ok(sessionsForWeek(9).some(item => item.id === 'math-fri'));
assert.ok(!sessionsForWeek(9).some(item => item.id === 'circuits-fri'));
assert.equal(sessionsForWeek(8).find(item => item.id === 'literature-tue').day, 3);
assert.equal(sessionsForWeek(9).find(item => item.id === 'literature-tue').day, 1);
for (let week = 1; week <= TERM.weeks; week++) {
  const sessions = sessionsForWeek(week);
  for (const session of sessions) {
    assert.ok(courses.some(course => course.id === session.courseId));
    assert.ok(session.start >= 0 && session.length > 0 && session.start + session.length <= periods.length);
    assert.ok(session.day >= 0 && session.day < 5, 'fixtures have no weekend lessons');
  }
  const groups = groupSessions(sessions);
  assert.deepEqual(groups.flatMap(group => group.sessions.map(item => item.id)).sort(), sessions.map(item => item.id).sort(), 'every stacked course remains reachable');
}
const conflictGroups = groupSessions(sessionsForWeek(8)).filter(group => group.sessions.length > 1);
assert.equal(conflictGroups.length, 2, 'same-time and partial-overlap fixtures');
assert.deepEqual(conflictGroups[0].sessions.map(item => item.courseId), ['design', 'english']);
assert.ok(conflictGroups.flatMap(group => group.sessions).every(session => !session.note), 'course details have no conflict notices');
assert.ok(sessionsForWeek(8).find(item => item.id === 'literature-tue').note, 'adjustment information remains available');
const intervals = [
  { id: 'c', courseId: 'design', day: 0, start: 3, length: 2 },
  { id: 'a', courseId: 'design', day: 0, start: 0, length: 2 },
  { id: 'next-day', courseId: 'design', day: 1, start: 0, length: 2 },
  { id: 'b', courseId: 'design', day: 0, start: 1, length: 3 },
  { id: 'adjacent', courseId: 'design', day: 0, start: 5, length: 2 },
];
const original = structuredClone(intervals);
const grouped = groupSessions(intervals);
assert.deepEqual(grouped.map(group => group.sessions.map(item => item.id)), [['a', 'b', 'c'], ['adjacent'], ['next-day']], 'transitive overlaps merge; touching endpoints and other days stay separate');
assert.equal(grouped[0].end, 5);
assert.deepEqual(intervals, original, 'grouping must not mutate fixture order or values');
assert.deepEqual(groupSessions([]), []);
for (const [start, end] of periods) {
  const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  assert.equal(minutes(end) - minutes(start), 45);
}
assert.equal(pageAtOffset(127, 320, 0, 1), 0);
assert.equal(pageAtOffset(129, 320, 0, 1), 1, 'labels update at 40 percent instead of waiting for half a page');
assert.equal(pageAtOffset(193, 320, 0, 1, 1), 1);
assert.equal(pageAtOffset(191, 320, 0, 1, 1), 0, 'reverse swipes also update after 40 percent');
assert.equal(pageAtOffset(160, 320, 0, 1, 0), 1, 'keep the drag origin after the selected label changes');
assert.equal(pageAtOffset(0, 320, 0, 1, 0), 0, 'an abandoned swipe restores the original selection');
for (const origin of [1, 8, 18]) {
  let forward = 1;
  let backward = 18;
  for (let offset = 0; offset <= 17 * 320; offset += 16) {
    const next = pageAtOffset(offset, 320, 1, 18, origin);
    const previous = pageAtOffset(17 * 320 - offset, 320, 1, 18, origin);
    assert.ok(next >= forward && previous <= backward, 'early labels must not oscillate during continuous travel');
    forward = next;
    backward = previous;
  }
}
assert.equal(pageAtOffset(7 * 320, 320, 1, 18), 8);
assert.equal(pageAtOffset(-50, 320, 1, 18), 1, 'leading edge bounce stays in range');
assert.equal(pageAtOffset(20 * 320, 320, 1, 18), 18, 'trailing edge bounce stays in range');
assert.equal(pageAtOffset(100, 0, 1, 18), 1, 'initial unmeasured viewport is safe');
assert.equal(movedBeyondTap(104, 203, 100, 200), false);
assert.equal(movedBeyondTap(108, 200, 100, 200), false);
assert.equal(movedBeyondTap(109, 200, 100, 200), true, 'a slide within a large card must not activate it');
assert.equal(movedBeyondTap(106, 206, 100, 200), true, 'diagonal travel also cancels a tap');
assert.equal(canActivatePress({ pageX: 100, pageY: 200 }, true), false);
assert.equal(canActivatePress({ pageX: 100, pageY: 200 }, false), true);
assert.equal(canActivatePress(undefined, true), true, 'keyboard callbacks may have no native event');
assert.equal(canActivatePress({ detail: 0, pageX: 0 }, true), true);
assert.equal(canActivatePress({ target: 1 }, true), true, 'assistive activation is not a drag release');
assert.equal(shouldRefresh(63, true, false), false);
assert.equal(shouldRefresh(64, true, false), true);
assert.equal(shouldRefresh(90, true, true), false);
assert.equal(shouldRefresh(90, false, false), false);

let state = initialState();
assert.equal(state.showWeekends, false);
assert.equal(state.learningPage, 0, 'new app sessions default to assignments');
assert.equal('refreshStyle' in state, false, 'toolbar refresh is the only version');
assert.equal('scheduleSpacing' in state, false, 'compact timetable spacing is permanent');
assert.equal(state.courseStyle, 'grid', 'courses default to the two-column view');
assert.equal('homeCourseInfo' in state, false, 'the old information-order setting stays removed');
assert.equal('homeCardStyle' in state, false, 'the chosen today card has no layout setting');
assert.equal(state.accountCardStyle, 'stacked');
assert.equal(state.conflictStyle, 'fold', 'staggered conflicts are the default');
assert.equal('conflictOutline' in state, false, 'conflicts have no optional outline');
assert.equal(activeRollcalls(state).length, 0, 'a new demo has no ongoing rollcalls');
assert.equal(canAttend(state, 'demo-1'), false, 'opening attendance cannot invent a rollcall');
state = demoReducer(state, { type: 'start-rollcall' });
const id = state.rollcalls[0].id;
assert.equal(state.rollcalls[0].method, 'number');
assert.equal(state.rollcalls[0].outcome, 'success');
state = demoReducer(state, { type: 'method', method: 'qr' });
state = demoReducer(state, { type: 'outcome', outcome: 'ended' });
state = demoReducer(state, { type: 'start-rollcall' });
const second = state.rollcalls[1].id;
state = demoReducer(state, { type: 'method', method: 'radar' });
state = demoReducer(state, { type: 'outcome', outcome: 'failed' });
assert.equal(activeRollcalls(state).length, 2, 'separate launches can coexist');
assert.notEqual(id, second);
assert.equal(state.rollcalls[0].method, 'number', 'later debug changes do not alter an existing method');
assert.equal(state.rollcalls[0].outcome, 'success', 'each launch keeps its selected receipt');
assert.equal(state.rollcalls[1].method, 'qr');
assert.equal(state.rollcalls[1].outcome, 'ended');
assert.equal(demoReducer(state, { type: 'week', week: -9 }).week, 1);
assert.equal(demoReducer(state, { type: 'week', week: 200 }).week, 18);
for (const result of ['failed', 'ended']) {
  const unchanged = demoReducer(state, { type: 'attendance', id, result });
  assert.notEqual(unchanged.attendance[id], 'success');
  assert.equal(unchanged.history.filter(item => item.date === '2026-10-26' && item.status === 'success').length, 0);
}
const failed = demoReducer(state, { type: 'attendance', id, result: 'failed' });
assert.equal(failed, state, 'failure changes neither banners nor history');
assert.equal(canAttend(failed, id), true, 'failed rollcall can be submitted again');
assert.equal(activeRollcalls(failed).length, 2);
state = demoReducer(state, { type: 'attendance', id, result: 'success' });
assert.equal(state.attendance[id], 'success');
assert.deepEqual(activeRollcalls(state).map(item => item.id), [second], 'success removes only its own banner');
assert.equal(visibleHistory(state.history, 'today').length, 1);
assert.equal(demoReducer(state, { type: 'attendance', id, result: 'success' }).history.length, state.history.length);
state = demoReducer(state, { type: 'attendance', id: second, result: 'ended' });
assert.equal(activeRollcalls(state).length, 0, 'ended rollcall removes its banner');
assert.equal(state.history.find(item => item.id === second).status, 'absent');
assert.equal(demoReducer(state, { type: 'refresh' }).history.length, state.history.length);
assert.equal(activeRollcalls(demoReducer(state, { type: 'refresh' })).length, 0, 'refresh does not revive completed rollcalls');
const launchedAgain = demoReducer(state, { type: 'start-rollcall' });
const newRollcall = activeRollcalls(launchedAgain)[0];
assert.notEqual(newRollcall.id, id, 'a completed attendance can be launched again with a fresh identity');
assert.notEqual(newRollcall.id, second);
assert.equal(newRollcall.method, 'radar');
assert.equal(newRollcall.outcome, 'failed');
assert.equal(launchedAgain.history, state.history, 'launching does not record a result');
assert.ok(canAttend(launchedAgain, newRollcall.id));
assert.equal(state.history.find(item => item.id === id).type, '数字码签到');
assert.equal(state.history.find(item => item.id === second).type, '二维码签到');
assert.deepEqual(demoReducer(state, { type: 'attendance', id: 'invalid-id', result: 'success' }), state);
const cached = state;
state = demoReducer(cached, { type: 'scenario', scenario: 'offline' });
assert.equal(state.load, 'ready', 'offline cached collections remain visible');
assert.equal(state.history, cached.history);
assert.equal(state.attendance, cached.attendance);
assert.equal(activeRollcalls(state).length, 0, 'offline cannot revive completed banners');
assert.equal(demoReducer(state, { type: 'refresh' }), state, 'failed refresh preserves every cached value');
state = demoReducer(demoReducer(demoReducer(initialState(), { type: 'start-rollcall' }), { type: 'method', method: 'qr' }), { type: 'start-rollcall' });
state = demoReducer(state, { type: 'scenario', scenario: 'offline' });
assert.equal(canAttend(state, id), false);
assert.equal(activeRollcalls(state).length, 2, 'cached ongoing banners remain visible offline');
assert.equal(demoReducer(state, { type: 'attendance', id, result: 'success' }).attendance[id], undefined);
assert.equal(demoReducer(state, { type: 'start-rollcall' }), state, 'offline cannot launch a new rollcall');
for (const scenario of ['empty', 'loading', 'signed-out']) {
  const blocked = demoReducer(initialState(), { type: 'scenario', scenario });
  assert.equal(demoReducer(blocked, { type: 'start-rollcall' }), blocked);
}
const firstLoadFailed = demoReducer(initialState(), { type: 'scenario', scenario: 'empty' });
assert.equal(firstLoadFailed.load, 'empty', 'initial failure uses an empty collection');
assert.equal(demoReducer(demoReducer(firstLoadFailed, { type: 'scenario', scenario: 'offline' }), { type: 'refresh' }).load, 'empty');
state = demoReducer(state, { type: 'scenario', scenario: 'loading' });
assert.equal(demoReducer(state, { type: 'refresh' }).load, 'ready');
state = demoReducer(state, { type: 'login' });
assert.equal(state.load, 'ready', 'one login restores all learning resources');
state = demoReducer(state, { type: 'permission', value: 'denied' });
assert.equal(demoReducer(state, { type: 'reminders', enabled: true }).reminders, false);
state = demoReducer(state, { type: 'list-style', value: 'soft' });
state = demoReducer(state, { type: 'weekends', enabled: true });
state = demoReducer(state, { type: 'course-style', value: 'list' });
state = demoReducer(state, { type: 'account-card-style', value: 'original' });
state = demoReducer(state, { type: 'conflict-style', value: 'stack' });
state = demoReducer(state, { type: 'learning-page', value: 1 });
assert.equal(demoReducer(state, { type: 'scenario', scenario: 'normal' }).listStyle, 'soft');
assert.equal(demoReducer(state, { type: 'scenario', scenario: 'normal' }).showWeekends, true);
for (const event of [{ type: 'scenario', scenario: 'empty' }, { type: 'refresh' }, { type: 'login' }]) {
  const next = demoReducer(state, event);
  assert.equal(next.learningPage, 1, 'navigation and data actions keep the selected learning page');
  assert.equal(next.courseStyle, 'list');
  assert.equal(next.accountCardStyle, 'original', 'data actions preserve the account card comparison');
  assert.equal(next.conflictStyle, 'stack');
}
for (const value of ['stack', 'fold']) assert.equal(demoReducer(state, { type: 'conflict-style', value }).conflictStyle, value);
for (const value of ['grid', 'list']) assert.equal(demoReducer(state, { type: 'course-style', value }).courseStyle, value);
for (const value of ['original', 'stacked']) assert.equal(demoReducer(state, { type: 'account-card-style', value }).accountCardStyle, value);
assert.equal(demoReducer(state, { type: 'reset' }).learningPage, 0, 'reset starts a new demo session');
assert.equal(demoReducer(state, { type: 'reset' }).conflictStyle, 'fold');
assert.equal(demoReducer(state, { type: 'reset' }).accountCardStyle, 'stacked');
state = demoReducer(state, { type: 'logout' });
assert.equal(state.loggedIn, false);
assert.equal(state.history.length, 0);
assert.deepEqual(state.attendance, {});
assert.deepEqual(state.rollcalls, [], 'logout also clears ongoing rollcalls');
assert.equal(demoReducer(state, { type: 'refresh' }).loggedIn, false);
assert.equal(demoReducer(state, { type: 'login' }).listStyle, 'soft');
assert.equal(demoReducer(state, { type: 'login' }).courseStyle, 'list');
assert.equal(demoReducer(state, { type: 'login' }).accountCardStyle, 'original');
assert.equal(demoReducer(state, { type: 'login' }).learningPage, 1);
assert.ok(!sessionsForWeek(8).find(item => item.id === 'circuits-fri').note, 'even-week lessons have no special marker');
assert.ok(!sessionsForWeek(9).find(item => item.id === 'math-fri').note, 'odd-week lessons have no special marker');
assert.equal(todoFixtures(false), todos, 'default upstream collection is returned intact');
assert.ok(todoFixtures(false).some(item => item.type === 'questionnaire' && item.deadline === null));
assert.ok(todoFixtures(true).some(item => item.type === 'new_activity_type' && item.deadline === null));
assert.equal(historyLabel('success'), '成功');
assert.equal(historyLabel('absent'), '缺勤');
console.log('Prototype checks passed: timetable, paging, touch guard, unified loading, offline cache, repeatable attendance launches, captured methods and outcomes, retryable failure and retained visual choices.');
