import { readSchedule, scheduleFrom, type SchoolSchedule } from './schedule.ts';
import { rollcallsFrom, type AttendanceReceipt, type CompletedAttendance } from './attendance.ts';
import { methodLabel, type HistoryItem, type Rollcall } from './demo-data.ts';
import { isPosition, type Position } from './location-attendance.ts';
import { qrData } from './qr.ts';

export type Account = { lntId: number | null; studentNumber: string; name: string };
export type SchoolTodo = {
  id: number; course_id: number; course_name: string;
  title: string; type: string; end_time: string | null; is_locked: boolean;
  [key: string]: unknown;
};
export type SchoolTerm = { jwTermCode: string; lntTermCode: string; name: string; currentWeek: number; weeks: number[] };
export type SchoolCourse = {
  id: number; course_code: string; name: string; semester?: { code: string; [key: string]: unknown } | null;
  [key: string]: unknown;
};
export type SchoolHistory = {
  course_id: number; course_name: string; rollcall_id: number; student_rollcall_id?: number | null;
  rollcall_time: string; title: string; student_status: string; status: 'on_call_fine' | 'absent';
  student_status_detail: string | null; is_number?: boolean; is_radar?: boolean; type?: string;
};
export type LearningSnapshot = {
  account: Account | null; todos: SchoolTodo[]; todosAt: number | null;
  term: SchoolTerm | null; courses: SchoolCourse[]; coursesAt: number | null;
  schedule: SchoolSchedule | null; scheduleAt: number | null; refreshSchedule: boolean;
  rollcalls: Rollcall[]; attendance: CompletedAttendance; pendingAttendance: CompletedAttendance;
  history: SchoolHistory[]; historyAt: number | null; historyRefreshing: boolean; historyMessage: string | null;
  authenticated: boolean; ready: boolean; refreshing: boolean; loggingIn: boolean; message: string | null; needsLogin: boolean;
};
export type SchoolDevice = {
  load(): Promise<string | null>;
  save(value: string): Promise<void>;
  clear(): Promise<void>;
  authenticate(onAuthorized?: () => void): Promise<void>;
  read(action: 'profile' | 'todos' | 'rollcalls' | 'jwTerms' | 'jwWeek' | 'courses' | 'history' | 'jwSchedule' | 'jwPeriods', params?: { jwTermCode?: string; courseId?: number; studentId?: number; studentNumber?: string }): Promise<unknown>;
  answerNumber(rollcallId: string, numberCode: string): Promise<AttendanceReceipt>;
  submitLocation(rollcallId: string, position: Position): Promise<AttendanceReceipt>;
  submitQr(rollcallId: string, data: unknown): Promise<AttendanceReceipt>;
};
export const todoKey = (item: SchoolTodo) => `${item.type}:${item.course_id}:${item.id}`;
export function todoView(item: SchoolTodo, now = new Date()) {
  let deadline: string | null = null;
  if (item.end_time) {
    const end = new Date(item.end_time);
    const days = (Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86_400_000;
    const dayOfWeek = (now.getDay() + 6) % 7;
    const date = days >= 0 && days < 3 ? ['今天', '明天', '后天'][days]
      : days >= -dayOfWeek && days < 7 - dayOfWeek ? '周' + '日一二三四五六'[end.getDay()]
      : end.getMonth() + 1 + '月' + end.getDate() + '日';
    deadline = date + ' ' + String(end.getHours()).padStart(2, '0') + ':' + String(end.getMinutes()).padStart(2, '0');
  }
  return { id: todoKey(item), title: item.title, course: item.course_name, type: item.type, locked: item.is_locked, deadline };
}
export function historyView(item: SchoolHistory): HistoryItem {
  const type = item.is_radar ? methodLabel.radar : item.is_number ? methodLabel.number : item.type === 'qr_rollcall' ? methodLabel.qr
    : item.type && item.type !== 'manual' ? item.type : '教师点名';
  const at = Date.parse(item.rollcall_time), time = new Date(at + 8 * 60 * 60 * 1000).toISOString();
  return { id: item.course_id + ':' + item.rollcall_id, course: item.course_name, date: time.slice(0, 10),
    time: time.slice(11, 16), at,
    type, status: item.status === 'absent' ? 'absent' : 'success', detail: item.student_status_detail };
}
function accountFrom(value: unknown): Account {
  const p = value as Record<string, unknown> | null;
  if (!p || typeof p !== 'object' || Array.isArray(p) || p.success === false) throw Error('INVALID_PROFILE');
  return { lntId: Number.isSafeInteger(p.id) ? p.id as number : null, studentNumber: typeof p.user_no === 'string' ? p.user_no : '', name: typeof p.name === 'string' ? p.name : '' };
}
function todosFrom(value: unknown): SchoolTodo[] {
  const list = (value as { todo_list?: unknown } | null)?.todo_list;
  if ((value as { success?: unknown } | null)?.success === false || !Array.isArray(list) || !list.every(item => item && Number.isSafeInteger(item.id) && Number.isSafeInteger(item.course_id)
    && ['course_name', 'title', 'type'].every(key => typeof item[key] === 'string')
    && (item.end_time == null || (typeof item.end_time === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(item.end_time) && Number.isFinite(Date.parse(item.end_time))))
    && typeof item.is_locked === 'boolean')) throw Error('INVALID_TODOS');
  return [...list].sort((a, b) => (a.end_time ? Date.parse(a.end_time) : Infinity) - (b.end_time ? Date.parse(b.end_time) : Infinity));
}
function termsFrom(value: unknown): Omit<SchoolTerm, 'currentWeek' | 'weeks'>[] {
  const response = value as { success?: boolean; datas?: { kfdxnxqcx?: { rows?: unknown } } } | null;
  const rows = response?.datas?.kfdxnxqcx?.rows;
  if (response?.success === false || !Array.isArray(rows)) throw Error('INVALID_TERMS');
  return rows.map(row => {
    const code = row?.XNXQDM ?? row?.DM, name = row?.XNXQDM_DISPLAY ?? row?.MC;
    if (typeof code !== 'string' || !/^\d{4}[123]$/.test(code) || typeof name !== 'string') throw Error('INVALID_TERMS');
    return { jwTermCode: code, lntTermCode: code.slice(0, 4) + '-' + code.slice(4), name };
  }).sort((a, b) => b.jwTermCode.localeCompare(a.jwTermCode));
}
function weekNumber(value: unknown): number {
  const number = typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(number)) throw Error('INVALID_WEEKS');
  return number as number;
}
function weeksFrom(value: unknown): { currentWeek: number; weeks: number[] } {
  const response = value as { success?: boolean; currentZc?: unknown; zcList?: { ZC?: unknown }[] } | null;
  if (response?.success !== true || !Array.isArray(response.zcList) || !Object.hasOwn(response, 'currentZc')) throw Error('INVALID_WEEKS');
  const weeks = [...new Set(response.zcList.map(row => weekNumber(row?.ZC)))].sort((a, b) => a - b);
  if (weeks.some(week => week < 1)) throw Error('INVALID_WEEKS');
  return { currentWeek: response.currentZc == null || response.currentZc === '' ? 0 : weekNumber(response.currentZc), weeks };
}
function coursesFrom(value: unknown, term: SchoolTerm): SchoolCourse[] {
  const list = (value as { courses?: unknown } | null)?.courses;
  if ((value as { success?: unknown } | null)?.success === false || !Array.isArray(list) || !list.every(item => item && Number.isSafeInteger(item.id)
    && typeof item.course_code === 'string' && typeof item.name === 'string'
    && (item.semester == null || (typeof item.semester === 'object' && !Array.isArray(item.semester) && typeof item.semester.code === 'string')))) throw Error('INVALID_COURSES');
  return list.filter(item => item.semester?.code === term.lntTermCode);
}
function historyFrom(value: unknown, course: SchoolCourse): SchoolHistory[] {
  const list = (value as { rollcalls?: unknown } | null)?.rollcalls;
  if ((value as { success?: unknown } | null)?.success === false || !Array.isArray(list) || !list.every(item => item && Number.isSafeInteger(item.rollcall_id)
    && (item.student_rollcall_id == null || Number.isSafeInteger(item.student_rollcall_id))
    && typeof item.rollcall_time === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(item.rollcall_time) && Number.isFinite(Date.parse(item.rollcall_time))
    && typeof item.title === 'string' && typeof item.student_status === 'string' && ['on_call_fine', 'absent'].includes(item.status)
    && (item.student_status_detail == null || typeof item.student_status_detail === 'string')
    && (item.is_number === undefined || typeof item.is_number === 'boolean') && (item.is_radar === undefined || typeof item.is_radar === 'boolean')
    && (item.type === undefined || typeof item.type === 'string'))) throw Error('INVALID_HISTORY');
  return list.map(item => ({ ...item, course_id: course.id, course_name: course.name, student_status_detail: item.student_status_detail ?? null }));
}
const sortHistory = (items: SchoolHistory[]) => items.sort((a, b) => Date.parse(b.rollcall_time) - Date.parse(a.rollcall_time));
type SavedLearning = { version: 1; account: Account; todos: SchoolTodo[]; todosAt: number;
  term: SchoolTerm | null; courses: SchoolCourse[]; coursesAt: number | null; schedule: SchoolSchedule | null; scheduleAt: number | null; refreshSchedule: boolean; rollcalls: Rollcall[]; attendance: CompletedAttendance; history: SchoolHistory[]; historyAt: number | null };
const loginFailures: Record<string, string> = {
  native: '学校登录组件加载失败，请检查安装版本',
  pkce: '学校登录准备失败，请重试',
  authorize: '学校统一认证失败，请重试',
  token: '学校授权验证失败，请重试',
  academic: '教务登录页面加载失败，请重试',
  'academic-probe': '教务会话验证失败，请重新登录',
  lnt: 'LNT 登录失败，请重试',
  flush: '登录状态保存失败，请重新登录',
};
function cacheFrom(raw: string): SavedLearning | Pick<SavedLearning, 'refreshSchedule'> | null {
  const data = JSON.parse(raw) as SavedLearning;
  if (data?.version !== 1) return null;
  if (data.refreshSchedule !== undefined && typeof data.refreshSchedule !== 'boolean') throw Error('INVALID_CACHE');
  const refreshSchedule = data.refreshSchedule ?? false;
  if (!Object.hasOwn(data, 'account') && data.refreshSchedule !== undefined) return { refreshSchedule };
  const account = data.account;
  if (!account || typeof account !== 'object' || Array.isArray(account) || typeof account.studentNumber !== 'string'
    || typeof account.name !== 'string' || (account.lntId !== null && !Number.isSafeInteger(account.lntId))
    || !Number.isFinite(data.todosAt)) throw Error('INVALID_CACHE');
  let term: SchoolTerm | null = null, courses: SchoolCourse[] = [], coursesAt: number | null = null;
  // T01 caches remain readable until the first complete course refresh.
  if (data.term !== undefined || data.courses !== undefined || data.coursesAt !== undefined) {
    const saved = data.term;
    if (!saved || typeof saved.jwTermCode !== 'string' || !/^\d{4}[123]$/.test(saved.jwTermCode)
      || saved.lntTermCode !== saved.jwTermCode.slice(0, 4) + '-' + saved.jwTermCode.slice(4) || typeof saved.name !== 'string'
      || !Number.isSafeInteger(saved.currentWeek) || !Array.isArray(saved.weeks) || !saved.weeks.every(week => Number.isSafeInteger(week) && week > 0)
      || !saved.weeks.includes(saved.currentWeek) || !Number.isFinite(data.coursesAt)) throw Error('INVALID_CACHE');
    term = saved;
    courses = coursesFrom({ courses: data.courses }, term);
    if (courses.length !== data.courses.length) throw Error('INVALID_CACHE');
    coursesAt = data.coursesAt;
  }
  let schedule: SchoolSchedule | null = null, scheduleAt: number | null = null;
  if (data.schedule != null) {
    if (!term || data.schedule.jwTermCode !== term.jwTermCode || !Number.isFinite(data.scheduleAt)) throw Error('INVALID_CACHE');
    schedule = scheduleFrom({ success: true, pkjgList: data.schedule.rows }, { data: data.schedule.periods }, term.jwTermCode);
    scheduleAt = data.scheduleAt;
  }
  let history: SchoolHistory[] = [], historyAt: number | null = null;
  if (data.history !== undefined || data.historyAt !== undefined) {
    if (!Array.isArray(data.history) || !(data.historyAt === null || Number.isFinite(data.historyAt))
      || (data.history.length && data.historyAt === null)) throw Error('INVALID_CACHE');
    history = sortHistory(data.history.flatMap(item => {
      const course = courses.find(course => course.id === item.course_id);
      if (!course) throw Error('INVALID_CACHE');
      return historyFrom({ rollcalls: [item] }, course);
    }));
    historyAt = data.historyAt;
  }
  const rollcalls = data.rollcalls === undefined ? [] : data.rollcalls;
  const attendance = data.attendance === undefined ? {} : data.attendance;
  if (!Array.isArray(rollcalls) || !rollcalls.every(item => item && typeof item.id === 'string' && item.id.trim()
    && typeof item.courseId === 'string' && item.courseId.trim() && typeof item.title === 'string' && typeof item.time === 'string'
    && ['number', 'qr', 'radar'].includes(item.method)) || !attendance || typeof attendance !== 'object' || Array.isArray(attendance)
    || !Object.values(attendance).every(result => result === 'success' || result === 'ended')) throw Error('INVALID_CACHE');
  return { version: 1, account: accountFrom({ id: data.account.lntId, user_no: data.account.studentNumber, name: data.account.name }),
    todos: todosFrom({ todo_list: data.todos }), todosAt: data.todosAt, term, courses, coursesAt, schedule, scheduleAt, refreshSchedule, rollcalls, attendance, history, historyAt };
}

export function createLearning(device: SchoolDevice, now = Date.now) {
  const empty = { account: null, todos: [], todosAt: null, term: null, courses: [], coursesAt: null, schedule: null, scheduleAt: null, history: [], historyAt: null, historyRefreshing: false, historyMessage: null, refreshSchedule: false, rollcalls: [], attendance: {}, pendingAttendance: {}, authenticated: false, ready: true, refreshing: false, loggingIn: false, message: null, needsLogin: false };
  let state: LearningSnapshot = { ...empty, ready: false };
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<LearningSnapshot>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
  let generation = 0;
  let identity = 0;
  const submissions = new Map<string, { dismissed: boolean; task: Promise<AttendanceReceipt> }>();
  let writing = Promise.resolve();
  let operation: Promise<boolean> | null = null;
  let historyOperation: Promise<boolean> | null = null;
  let restoring: Promise<void> | null = null;
  let clearing: Promise<boolean> | null = null;
  let cleanupFailed = false;
  let restoreFailed = false;
  const current = (version: number) => generation === version;
  const completed = () => ({ ...state.attendance, ...state.pendingAttendance });
  function rememberAttendance() {
    const version = identity;
    writing = writing.then(async () => {
      if (version !== identity || !state.account || state.todosAt === null) return;
      const { account, todos, todosAt, term, courses, coursesAt, schedule, scheduleAt, refreshSchedule, rollcalls, history, historyAt } = state;
      await device.save(JSON.stringify({ version: 1, account, todos, todosAt, term, courses, coursesAt, schedule, scheduleAt, refreshSchedule, rollcalls, history, historyAt, attendance: completed() }));
    }).catch(() => {
      if (version === identity) publish({ message: '签到结果已收到，但本机保存失败，请刷新核对' });
    });
  }
  function restore(): Promise<void> {
    if (state.ready) return Promise.resolve();
    if (restoring) return restoring;
    const version = generation;
    restoring = (async () => {
      try {
        const raw = await device.load();
        if (!current(version)) return;
        const saved = raw ? cacheFrom(raw) : null;
        if (saved) publish({ ...saved, authenticated: 'account' in saved });
      } catch { if (current(version)) { restoreFailed = true; publish({ message: '学校本机数据读取失败，请重试或退出清理' }); } }
      if (current(version)) publish({ ready: true });
    })();
    return restoring;
  }
  async function readHistory(courses: SchoolCourse[], studentId: number | null): Promise<SchoolHistory[]> {
    if (studentId === null || studentId <= 0) throw Error('INVALID_PROFILE');
    const responses = await Promise.all(courses.map(async course => historyFrom(await device.read('history', { courseId: course.id, studentId }), course)));
    return sortHistory(responses.flat());
  }
  function update(login: boolean, onAuthorized?: () => void): Promise<boolean> {
    if (clearing || cleanupFailed) return Promise.resolve(false);
    if (operation && (!login || state.loggingIn)) return operation;
    if (!login && !state.authenticated) return Promise.resolve(false);
    if (!login && historyOperation) return historyOperation.then(() => update(false));
    if (login) { identity++; submissions.clear(); historyOperation = null; publish({ historyRefreshing: false, historyMessage: null }); }
    const version = ++generation;
    const includeSchedule = login || state.refreshSchedule;
    publish({ loggingIn: login, refreshing: !login, message: null, ...(login ? { attendance: completed(), pendingAttendance: {} } : {}) });
    const task = (async () => {
      let failure = '学校登录失败，请重试';
      let authorized = !login;
      try {
        await writing;
        if (!current(version)) return false;
        if (login) await device.authenticate(() => {
          if (!current(version)) return;
          authorized = true;
          publish({ authenticated: true, needsLogin: false });
          onAuthorized?.();
        });
        if (!current(version)) return false;
        publish({ refreshing: true });
        failure = 'LNT 个人资料读取失败，已保留原数据';
        const account = accountFrom(await device.read('profile'));
        if (!current(version)) return false;
        failure = 'LNT 待办更新失败，已保留原数据';
        const todos = todosFrom(await device.read('todos'));
        if (!current(version)) return false;
        failure = 'LNT 进行中签到更新失败，已保留原数据';
        const rollcalls = rollcallsFrom(await device.read('rollcalls'));
        if (!current(version)) return false;
        const sameAccount = state.account && (account.lntId !== null ? account.lntId === state.account.lntId
          : !!account.studentNumber && account.studentNumber === state.account.studentNumber);
        failure = '教务学期读取失败，已保留原数据';
        const terms = termsFrom(await device.read('jwTerms'));
        if (!current(version)) return false;
        let term: SchoolTerm | null = null;
        for (const candidate of terms) {
          failure = '教务当前周读取失败，已保留原数据';
          const week = weeksFrom(await device.read('jwWeek', { jwTermCode: candidate.jwTermCode }));
          if (!current(version)) return false;
          if (week.weeks.includes(week.currentWeek)) { term = { ...candidate, ...week }; break; }
        }
        if (!term) { failure = '未能确定学校当前授课学期，已保留原数据'; throw Error('NO_CURRENT_TERM'); }
        failure = 'LNT 课程更新失败，已保留原数据';
        const courses = coursesFrom(await device.read('courses'), term);
        if (!current(version)) return false;
        failure = '教务课表更新失败，已保留原数据';
        const cachedSchedule = state.schedule?.jwTermCode === term.jwTermCode
          && state.account?.studentNumber === account.studentNumber && state.account?.lntId === account.lntId ? state.schedule : null;
        const schedule = includeSchedule ? await readSchedule(device, term, account.studentNumber) : cachedSchedule;
        if (!current(version)) return false;
        const keepHistory = state.account?.lntId === account.lntId && state.term?.lntTermCode === term.lntTermCode;
        if (login) failure = '历史签到读取失败，已保留原数据';
        const history = login ? await readHistory(courses, account.lntId)
          : keepHistory ? state.history.filter(item => courses.some(course => course.id === item.course_id)) : [];
        if (!current(version)) return false;
        const updatedAt = now();
        const scheduleAt = includeSchedule ? updatedAt : schedule ? state.scheduleAt : null;
        const historyAt = login ? updatedAt : keepHistory ? state.historyAt : null;
        failure = '学校本机数据保存失败，已保留原数据';
        const saved = writing.then(async () => {
          if (!current(version)) return false;
          const next: SavedLearning = { version: 1, account, todos, todosAt: updatedAt, term, courses, coursesAt: updatedAt, schedule, scheduleAt, refreshSchedule: state.refreshSchedule, rollcalls, attendance: sameAccount ? completed() : {}, history, historyAt };
          await device.save(JSON.stringify(next));
          if (!current(version)) return false;
          restoreFailed = false;
          publish({ account, todos, rollcalls, todosAt: next.todosAt, term, courses, coursesAt: next.coursesAt, schedule, scheduleAt, history, historyAt, ready: true, needsLogin: false,
            ...(!sameAccount ? { attendance: {}, pendingAttendance: {} } : {}) });
          return true;
        });
        writing = saved.then(() => {}, () => {});
        return await saved;
      } catch (error) {
        if (current(version)) {
          const { code, loginStage } = (error as { code?: string; loginStage?: string }) ?? {};
          const needsLogin = !authorized || code === 'AUTH_REQUIRED';
          const loginFailure = loginStage && Object.hasOwn(loginFailures, loginStage) ? loginFailures[loginStage] : undefined;
          publish({ ...(needsLogin ? { authenticated: false, needsLogin: true } : {}),
            message: code === 'CANCELLED' ? '已取消学校登录' : loginFailure ?? (code === 'AUTH_REQUIRED' ? '学校登录失效，请重新登录' : failure) });
        }
        return false;
      } finally {
        if (current(version)) { operation = null; publish({ loggingIn: false, refreshing: false }); }
      }
    })();
    operation = task;
    return task;
  }
  function submitAttendance(id: string, method: Rollcall['method'], valid: boolean, send: () => Promise<AttendanceReceipt>): Promise<AttendanceReceipt> {
      const unavailable: AttendanceReceipt = { result: 'failed', message: '签到不可用，请刷新后重试' };
      const existing = submissions.get(id);
      if (existing) return existing.task;
      if (!state.authenticated || state.loggingIn || !valid || state.attendance[id] || state.pendingAttendance[id]
        || !state.rollcalls.some(item => item.id === id && item.method === method)) return Promise.resolve(unavailable);
      const version = identity;
      const active = { dismissed: false, task: null! as Promise<AttendanceReceipt> };
      submissions.set(id, active);
      active.task = (async () => {
        let receipt: AttendanceReceipt;
        try { receipt = await send(); }
        catch (error) {
          const { code } = (error as { code?: string }) ?? {};
          receipt = { result: 'failed', message: code === 'AUTH_REQUIRED' ? '学校登录失效，请重新登录' : '未收到有效回执，提交结果未知，请核实本人记录' };
          if (identity === version && code === 'AUTH_REQUIRED') {
            generation++; operation = null; historyOperation = null;
            publish({ authenticated: false, needsLogin: true, refreshing: false, historyRefreshing: false, message: receipt.message });
          }
        }
        if (identity !== version) return { result: 'failed', message: '登录状态已改变，请刷新核对签到结果' } as AttendanceReceipt;
        if (receipt.result !== 'failed') {
          if (active.dismissed) publish({ attendance: { ...state.attendance, [id]: receipt.result } });
          else publish({ pendingAttendance: { ...state.pendingAttendance, [id]: receipt.result } });
          rememberAttendance();
        }
        return receipt;
      })().finally(() => { if (submissions.get(id) === active) submissions.delete(id); });
      return active.task;
  }
  function refreshHistory(): Promise<boolean> {
    if (clearing || cleanupFailed) return Promise.resolve(false);
    if (!state.ready) return restore().then(refreshHistory);
    if (operation) return operation.then(refreshHistory);
    if (historyOperation) return historyOperation;
    if (!state.authenticated) return Promise.resolve(false);
    const { account, term, courses } = state;
    if (!account || !Number.isSafeInteger(account.lntId) || !term) {
      publish({ historyMessage: '请先刷新个人资料和当前学期课程' });
      return Promise.resolve(false);
    }
    const version = generation;
    publish({ historyRefreshing: true, historyMessage: null });
    const task = (async () => {
      let failure = '历史签到读取失败，已保留原数据';
      try {
        const history = await readHistory(courses, account.lntId);
        if (!current(version)) return false;
        const historyAt = now();
        failure = '历史签到保存失败，已保留原数据';
        const saved = writing.then(async () => {
          if (!current(version)) return false;
          const next: SavedLearning = { version: 1, account, term, courses, coursesAt: state.coursesAt,
            todos: state.todos, todosAt: state.todosAt!, schedule: state.schedule, scheduleAt: state.scheduleAt, refreshSchedule: state.refreshSchedule, rollcalls: state.rollcalls, attendance: completed(), history, historyAt };
          await device.save(JSON.stringify(next));
          if (!current(version)) return false;
          publish({ history, historyAt });
          return true;
        });
        writing = saved.then(() => {}, () => {});
        return await saved;
      } catch (error) {
        if (current(version)) {
          const expired = (error as { code?: string } | null)?.code === 'AUTH_REQUIRED';
          publish({ ...(expired ? { authenticated: false, needsLogin: true } : {}),
            historyMessage: expired ? '学校登录失效，请重新登录' : failure });
        }
        return false;
      } finally {
        if (current(version)) { historyOperation = null; publish({ historyRefreshing: false }); }
      }
    })();
    historyOperation = task;
    return task;
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    restore,
    login: (onAuthorized?: () => void) => update(true, onAuthorized),
    refresh: () => update(false),
    refreshHistory,
    async setRefreshSchedule(enabled: boolean): Promise<boolean> {
      if (typeof enabled !== 'boolean' || clearing || cleanupFailed) return false;
      const version = identity;
      await restore();
      const saved = writing.then(async () => {
        if (version !== identity || clearing || cleanupFailed || restoreFailed) return false;
        const { account, todos, todosAt, term, courses, coursesAt, schedule, scheduleAt, rollcalls, history, historyAt } = state;
        const data = account && todosAt !== null
          ? { version: 1, account, todos, todosAt, ...(term ? { term, courses, coursesAt, schedule, scheduleAt, history, historyAt } : {}), rollcalls, attendance: completed(), refreshSchedule: enabled }
          : { version: 1, refreshSchedule: enabled };
        await device.save(JSON.stringify(data));
        if (version !== identity) return false;
        publish({ refreshSchedule: enabled, message: null });
        return true;
      }).catch(() => {
        if (version === identity) publish({ message: '课表刷新设置保存失败，请重试' });
        return false;
      });
      writing = saved.then(() => {});
      return saved;
    },
    submitNumber(id: string, numberCode: string): Promise<AttendanceReceipt> {
      return submitAttendance(id, 'number', typeof numberCode === 'string' && /^\d{4}$/.test(numberCode), () => device.answerNumber(id, numberCode));
    },
    submitQr(id: string, rawScanText: string): Promise<AttendanceReceipt> {
      let data: unknown;
      try { data = qrData(rawScanText, id); }
      catch (error) {
        return Promise.resolve({ result: 'failed', message: (error as Error).message === 'QR_ACTIVITY_MISMATCH'
          ? '二维码与当前签到活动不符' : (error as Error).message === 'UNSUPPORTED_QR_WRAPPER'
            ? '此二维码包装暂不支持，请使用学校客户端签到' : '二维码无效，请扫描当前活动的学校二维码' });
      }
      return submitAttendance(id, 'qr', true, () => device.submitQr(id, data));
    },
    submitLocation(id: string, position: Position): Promise<AttendanceReceipt> {
      return submitAttendance(id, 'radar', isPosition(position), () => device.submitLocation(id, position));
    },
    attendanceDismissed(context: { ids: string[] } | { openIds: string[] }) {
      const ids = [...new Set([...Object.keys(state.pendingAttendance), ...submissions.keys()])]
        .filter(id => 'openIds' in context ? !context.openIds.includes(id) : context.ids.includes(id));
      const attendance = { ...state.attendance }, pendingAttendance = { ...state.pendingAttendance };
      for (const id of ids) {
        const submission = submissions.get(id);
        if (submission) submission.dismissed = true;
        if (pendingAttendance[id]) { attendance[id] = pendingAttendance[id]; delete pendingAttendance[id]; }
      }
      if (ids.some(id => state.pendingAttendance[id])) publish({ attendance, pendingAttendance });
    },
    logout(): Promise<boolean> {
      if (clearing) return clearing;
      const version = ++generation;
      identity++; submissions.clear();
      operation = null; historyOperation = null; restoring = null;
      publish(empty);
      const task = writing.then(() => device.clear());
      writing = task.catch(() => {});
      clearing = task.then(() => { cleanupFailed = false; restoreFailed = false; return true; }, () => {
        cleanupFailed = true;
        if (current(version)) publish({ message: '学校本机数据或网页登录状态清理失败，请重试退出' });
        return false;
      }).finally(() => { clearing = null; });
      return clearing;
    },
  };
}
