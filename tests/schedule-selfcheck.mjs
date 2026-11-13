import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as scheduleModule from '../src/schedule.ts';
import { courses as courseColors, groupSessions } from '../src/demo-data.ts';
const periods = [
  { DM: '1', MC: '第一节', KSSJ: '0800', JSSJ: '0845', JCFADM: 'a' },
  { DM: '2', MC: '第二节', KSSJ: '0855', JSSJ: '0940', JCFADM: 'a' },
  { DM: '3', MC: '第三节', KSSJ: '1010', JSSJ: '1055', JCFADM: 'a' },
];
const row = { WID: 'one', BJDM: '001-A', KCMC: '教务课程一', JASMC: '学校教室 101', JSXM: '张老师', XQ: '1', KSJCDM: '1', JSJCDM: '2', KSSJ: '0800', JSSJ: '0940', ZCMC: '1-2,7-9周', JCFADM: 'a' };
const term = { jwTermCode: '20261', lntTermCode: '2026-1', name: '学校当前学期', currentWeek: 8, weeks: Array.from({ length: 18 }, (_, i) => i + 1) };
const courses = [{ id: 3, course_code: '001-A', name: 'LNT 课程一' }, { id: 4, course_code: '001-A ', name: '同名但不同教学班' }];
const at = new Date(2026, 9, 26, 12).getTime();
const makeData = (rows = [row], sections = periods) => ({ term, courses, coursesAt: at, schedule: scheduleModule.scheduleFrom({ success: true, pkjgList: rows }, { data: sections }, '20261') });
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
  assert.deepEqual(view.periods, [['08:00', '08:45'], ['08:55', '09:40'], ['10:10', '10:55']]);
  assert.deepEqual(view.weekDays(9)[0], { label: '一', month: 11, date: 2, today: false });
  assert.equal(view.weekDays(8)[0].today, true);
});

test('one school grid uses the active section plan and cached dates without demo times', () => {
  const view = scheduleModule.schoolScheduleView(makeData([{ ...row, JCFADM: 'b', KSSJ: '0900', JSSJ: '1040' }], [
    ...periods, { DM: 1, MC: '第一节', KSSJ: '0900', JSSJ: '0945', JCFADM: 'b' }, { DM: 2, MC: '第二节', KSSJ: '0955', JSSJ: '1040', JCFADM: 'b' },
  ]), new Date(2026, 10, 2, 12));
  assert.equal(view.currentWeek, 9);
  assert.deepEqual(view.periods, [['09:00', '09:45'], ['09:55', '10:40']]);
  assert.equal(view.sessionsForWeek(9)[0].planId, 'b');
  assert.equal(view.sessionsForWeek(9)[0].time, '09:00 — 10:40');
  assert.equal(view.weekDays(9)[0].today, true);
  const empty = scheduleModule.schoolScheduleView(makeData([]), new Date(at));
  assert.deepEqual(empty.sessionsForWeek(8), []);
  assert.deepEqual(empty.periods, [['08:00', '08:45'], ['08:55', '09:40'], ['10:10', '10:55']]);
  const noSections = scheduleModule.schoolScheduleView(makeData([], []), new Date(at));
  assert.ok(noSections.periods.length > 0);
  assert.ok(noSections.periods.every(period => period.every(time => time === '')));
  assert.deepEqual(empty.sessionsForWeek(19), []);
});

test('even-week Tuesday night classrooms share one session and keep real course conflicts', () => {
  const night = { ...row, KCMC: '数据仓库', XQ: 2, KSJCDM: 9, JSJCDM: 10, KSSJ: '1910', JSSJ: '2050', ZCMC: '1-16周，双周' };
  const sections = [...periods,
    { DM: 9, MC: '第九节', KSSJ: '1910', JSSJ: '1955', JCFADM: 'a' },
    { DM: 10, MC: '第十节', KSSJ: '2005', JSSJ: '2050', JCFADM: 'a' },
  ];
  const view = scheduleModule.schoolScheduleView(makeData([
    { ...night, WID: 'room-one', JASMC: '学校教室 101' },
    { ...night, WID: 'room-two', JASMC: '学校教室 202', ZCMC: '2-16周，双周' },
    { ...night, WID: 'room-repeat', JASMC: '学校教室 101' },
    { ...night, WID: 'other-course', BJDM: '001-A ', KCMC: '另一门课程', JASMC: '学校教室 303' },
  ], sections), new Date(at));
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
  ], [...periods, ...periods.map(period => ({ ...period, JCFADM: 'b' }))]), new Date(at));
  assert.equal(view.sessionsForWeek(8).length, 6);
});

test('one grid leaves only genuinely ambiguous active-plan times blank', () => {
  const view = scheduleModule.schoolScheduleView(makeData([row, { ...row, WID: 'plan-b', JCFADM: 'b', KSSJ: '0900' }], [
    ...periods,
    { DM: 1, MC: '第一节', KSSJ: '0900', JSSJ: '0945', JCFADM: 'b' },
    { DM: 2, MC: '第二节', KSSJ: '0855', JSSJ: '0940', JCFADM: 'b' },
    { DM: 2, MC: '第二节', KSSJ: '1200', JSSJ: '1245', JCFADM: 'unused' },
  ]), new Date(at));
  assert.deepEqual(view.periods, [['', ''], ['08:55', '09:40'], ['10:10', '10:55']]);
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
