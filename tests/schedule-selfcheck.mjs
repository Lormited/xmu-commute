import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as scheduleModule from '../src/schedule.ts';
import { courses as courseColors, groupSessions, periods as defaultPeriods } from '../src/demo-data.ts';
const row = { WID: 'one', BJDM: '001-A', KCMC: '教务课程一', JASMC: '学校教室 101', JSXM: '张老师', XQ: '1', KSJCDM: '1', JSJCDM: '2', KSSJ: '0800', JSSJ: '0940', ZCMC: '1-2,7-9周', JCFADM: 'a' };
const term = { jwTermCode: '20261', lntTermCode: '2026-1', name: '学校当前学期', currentWeek: 8, weeks: Array.from({ length: 18 }, (_, i) => i + 1) };
const courses = [{ id: 3, course_code: '001-A', name: 'LNT 课程一' }, { id: 4, course_code: '001-A ', name: '同名但不同教学班' }];
const at = new Date(2026, 9, 26, 12).getTime();
const makeData = (rows = [row]) => ({ courses, scheduleAt: at, schedule: { ...scheduleModule.scheduleFrom({ success: true, pkjgList: rows }, '20261'), ...term, weekAt: at } });

test('schedule needs only arrangement rows, keeps late sections, and validates their bounds', () => {
  const schedule = scheduleModule.scheduleFrom({ success: true, pkjgList: [{ ...row, KSJCDM: 11, JSJCDM: 12 }] }, '20261');
  const view = scheduleModule.schoolScheduleView({ courses, scheduleAt: at, schedule: { ...schedule, ...term, weekAt: at } }, new Date(at));
  assert.deepEqual(view.periods, [...defaultPeriods, ['', '']]);
  assert.equal(view.sessions[0].time, '08:00 — 09:40');
  for (const patch of [{ XQ: 8 }, { KSJCDM: 0 }, { KSJCDM: 3, JSJCDM: 2 }, { JSJCDM: 101 }, { KSSJ: '08:75' }, { JSSJ: '0700' }]) {
    assert.throws(() => scheduleModule.scheduleFrom({ success: true, pkjgList: [{ ...row, ...patch }] }, '20261'));
  }
});

test('daily schedule requests reuse the calendar anchor until the calculated week leaves its range', async () => {
  const calls = [], device = { read: async (action, params) => {
    calls.push([action, params]);
    return action === 'jwTerms' ? { datas: { kfdxnxqcx: { rows: [{ DM: '20261', MC: term.name }] } } }
      : action === 'jwWeek' ? { success: true, currentZc: 8, zcList: term.weeks.map(ZC => ({ ZC })) }
      : { success: true, pkjgList: [] };
  } };
  const cached = { ...term, weekAt: at, rows: [] };
  const next = await scheduleModule.readSchedule(device, '001234', () => at + 604800000, cached);
  assert.deepEqual(calls.map(([action]) => action), ['jwSchedule']);
  assert.equal(next.weekAt, at);
  assert.equal(next.currentWeek, 8);
  assert.equal(scheduleModule.schoolScheduleView({ courses, schedule: next, scheduleAt: at + 604800000 }, new Date(at + 604800000)).currentWeek, 9);
  assert.deepEqual(next.weeks, term.weeks, 'empty arrangements retain teaching weeks without lessons');
  for (const calendar of [null, { ...cached, weekAt: at - 20 * 604800000 }]) {
    calls.length = 0;
    const refreshed = await scheduleModule.readSchedule(device, '001234', () => at, calendar);
    assert.deepEqual(calls.map(([action]) => action), ['jwTerms', 'jwWeek', 'jwSchedule']);
    assert.equal(refreshed.weekAt, at);
  }
});
test('page data selects actual teaching weeks, exact class ids, school times and row-specific details', () => {
  const data = makeData([row, { ...row, WID: 'two', BJDM: '001-A ', KCMC: '课程二', JSXM: '李老师', JASMC: '学校教室 202', ZCMC: '1-16周，双周' },
    { ...row, WID: 'unlinked', BJDM: '001-a', KCMC: '未关联课程', XQ: 7, ZCMC: '1-15周，单周' }]);
  const view = scheduleModule.schoolScheduleView(data, new Date(at));
  assert.equal(view.currentWeek, 8);
  assert.deepEqual(view.sessionsForWeek(8).map(item => item.courseId), ['3', '4']);
  assert.deepEqual(view.sessionsForWeek(9).map(item => item.courseId), ['3', 'jw:001-a']);
  assert.deepEqual(view.sessionsForWeek(6).map(item => item.courseId), ['4']);
  const group = groupSessions(view.sessionsForWeek(8))[0];
  assert.equal(group.sessions.length, 2);
  const second = group.sessions[1];
  assert.equal(view.courseFor(second.courseId, second).teacher, '李老师');
  assert.equal(view.courseFor(second.courseId, second).room, '学校教室 202');
  assert.equal(view.courseFor('3').tint, courseColors[0].tint);
  assert.equal(view.courseFor('4', second).tint, courseColors[1].tint);
  assert.equal(second.time, '08:00 — 09:40');
  assert.deepEqual(view.periods, defaultPeriods);
  assert.deepEqual(view.weekDays(9)[0], { label: '一', month: 11, date: 2, today: false });
  assert.equal(view.weekDays(8)[0].today, true);
});

test('grid uses default sections while lessons retain actual plan times and cached dates', () => {
  const view = scheduleModule.schoolScheduleView(makeData([{ ...row, JCFADM: 'b', KSSJ: '0900', JSSJ: '1040' }]), new Date(2026, 10, 2, 12));
  assert.equal(view.currentWeek, 9);
  assert.deepEqual(view.periods, defaultPeriods);
  assert.equal(view.sessionsForWeek(9)[0].planId, 'b');
  assert.equal(view.sessionsForWeek(9)[0].time, '09:00 — 10:40');
  assert.equal(view.weekDays(9)[0].today, true);
  const empty = scheduleModule.schoolScheduleView(makeData([]), new Date(at));
  assert.deepEqual(empty.sessionsForWeek(8), []);
  assert.deepEqual(empty.periods, defaultPeriods);
  assert.deepEqual(empty.sessionsForWeek(19), []);
});

test('even-week Tuesday night classrooms share one session and keep real course conflicts', () => {
  const night = { ...row, KCMC: '数据仓库', XQ: 2, KSJCDM: 9, JSJCDM: 10, KSSJ: '1910', JSSJ: '2050', ZCMC: '1-16周，双周' };
  const view = scheduleModule.schoolScheduleView(makeData([
    { ...night, WID: 'room-one', JASMC: '学校教室 101' },
    { ...night, WID: 'room-two', JASMC: '学校教室 202', ZCMC: '2-16周，双周' },
    { ...night, WID: 'room-repeat', JASMC: '学校教室 101' },
    { ...night, WID: 'other-course', BJDM: '001-A ', KCMC: '另一门课程', JASMC: '学校教室 303' },
  ]), new Date(at));
  const sessions = view.sessionsForWeek(8);
  assert.equal(sessions.length, 2, 'two rooms are one class; a distinct exact class id stays separate');
  const merged = sessions.find(session => session.courseId === '3');
  assert.equal(merged.day, 1);
  assert.equal(merged.time, '19:10 — 20:50');
  assert.equal(merged.room, '学校教室 101、学校教室 202');
  assert.equal(view.courseFor('3', merged).room, merged.room);
  assert.equal(groupSessions(sessions)[0].sessions.length, 2, 'the real conflicting course remains reachable');
  assert.deepEqual(view.sessionsForWeek(9), [], 'even-week classes never appear on odd weeks');
});

test('different teaching weeks, days, times, sections and plans stay distinct', () => {
  const view = scheduleModule.schoolScheduleView(makeData([
    row, { ...row, WID: 'weeks', ZCMC: '7-8周' }, { ...row, WID: 'day', XQ: 2 },
    { ...row, WID: 'time', KSSJ: '0801' }, { ...row, WID: 'sections', JSJCDM: 3 },
    { ...row, WID: 'plan', JCFADM: 'b' },
  ]), new Date(at));
  assert.equal(view.sessionsForWeek(8).length, 6);
});

test('default grid retains separate lessons for different plans', () => {
  const view = scheduleModule.schoolScheduleView(makeData([row, { ...row, WID: 'plan-b', JCFADM: 'b', KSSJ: '0900' }]), new Date(at));
  assert.deepEqual(view.periods, defaultPeriods);
  const sessions = view.sessionsForWeek(8);
  assert.equal(groupSessions(sessions)[0].sessions.length, 2);
  assert.equal(sessions[1].time, '09:00 — 09:40');
});


test('today advances at the actual lesson end, including gaps and overlapping lessons', () => {
  const sessions = [
    { id: 'first', courseId: '3', day: 0, start: 0, length: 2, time: '08:00 — 09:40' },
    { id: 'second', courseId: '4', day: 0, start: 2, length: 2, time: '10:10 — 11:50' },
    { id: 'last', courseId: '5', day: 0, start: 4, length: 2, time: '14:30 — 16:10' },
  ];
  for (const [hour, minute, second, expected] of [
    [7, 0, 0, 0], [9, 39, 59, 0], [9, 40, 0, 1], [10, 0, 0, 1],
    [10, 10, 0, 1], [11, 49, 59, 1], [11, 50, 0, 2], [16, 10, 0, 2], [23, 59, 59, 2],
  ]) {
    assert.equal(scheduleModule.currentCourseIndex(sessions, new Date(2026, 10, 13, hour, minute, second)), expected);
  }
  const overlap = [sessions[0], { ...sessions[1], time: '09:00 — 10:30' }, sessions[2]];
  assert.equal(scheduleModule.currentCourseIndex(overlap, new Date(2026, 10, 13, 9, 40)), 1);
  assert.equal(scheduleModule.currentCourseIndex([{ ...sessions[0], time: '08:00 — 10:40' }, sessions[2]], new Date(2026, 10, 13, 9, 40)), 0, 'school end times take precedence over demo periods');
  assert.equal(scheduleModule.currentCourseIndex([{ ...sessions[0], time: undefined }, sessions[2]], new Date(2026, 10, 13, 9, 40)), 1, 'preview sessions fall back to their existing period times');
  assert.equal(scheduleModule.currentCourseIndex([], new Date(at)), -1);
  assert.equal(scheduleModule.currentCourseIndex([sessions[0]], new Date(2026, 10, 13, 23)), 0);
});
