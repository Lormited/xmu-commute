import { DEMO_DAY, TERM, courseFor, historyFixtures, methodLabel, periods, sessionsForWeek, type AttendanceResult, type HistoryItem, type Method, type Rollcall } from './demo-data.ts';
export type Resource = 'jw' | 'lnt' | 'courses' | 'history';
export type LoadState = 'ready' | 'loading' | 'empty';
export type Scenario = 'normal' | 'empty' | 'loading' | 'offline' | 'signed-out' | 'long';
export type ListStyle = 'space' | 'soft' | 'group';
export type DemoState = {
  scenario: Scenario; loggedIn: boolean; load: LoadState; week: number;
  longText: boolean; attendance: Record<string, 'ended' | 'success'>; history: HistoryItem[];
  pendingAttendance: Record<string, 'ended' | 'success'>;
  method: Method; outcome: AttendanceResult; rollcalls: Rollcall[]; rollcallSequence: number;
  reminders: boolean; notificationPermission: 'undecided' | 'granted' | 'denied';
  listStyle: ListStyle; showWeekends: boolean; refreshSchedule: boolean;
  courseStyle: 'grid' | 'list'; accountCardStyle: 'original' | 'stacked'; conflictStyle: 'stack' | 'fold'; learningPage: 0 | 1;
};
export function initialState(): DemoState {
  return {
    scenario: 'normal', loggedIn: true, load: 'ready', week: TERM.currentWeek,
    longText: false, attendance: {}, pendingAttendance: {}, history: [...historyFixtures], method: 'number', outcome: 'success', rollcalls: [], rollcallSequence: 0,
    reminders: false, notificationPermission: 'undecided', listStyle: 'space', showWeekends: false, refreshSchedule: false,
    courseStyle: 'grid', accountCardStyle: 'stacked', conflictStyle: 'fold', learningPage: 0,
  };
}
export type DemoEvent =
  | { type: 'scenario'; scenario: Scenario }
  | { type: 'week'; week: number }
  | { type: 'method'; method: Method }
  | { type: 'outcome'; outcome: DemoState['outcome'] }
  | { type: 'reminders'; enabled: boolean }
  | { type: 'permission'; value: DemoState['notificationPermission'] }
  | { type: 'list-style'; value: ListStyle }
  | { type: 'weekends'; enabled: boolean }
  | { type: 'refresh-schedule'; enabled: boolean }
  | { type: 'course-style'; value: DemoState['courseStyle'] }
  | { type: 'account-card-style'; value: DemoState['accountCardStyle'] }
  | { type: 'conflict-style'; value: DemoState['conflictStyle'] }
  | { type: 'learning-page'; value: 0 | 1 }
  | { type: 'refresh' }
  | { type: 'login' }
  | { type: 'logout' }
  | { type: 'start-rollcall' }
  | { type: 'attendance'; id: string; result: AttendanceResult }
  | { type: 'attendance-result'; id: string; result: AttendanceResult }
  | { type: 'attendance-dismissed'; ids: string[] }
  | { type: 'attendance-dismissed'; openIds: string[] }
  | { type: 'reset' };
export function canAttend(state: DemoState, id: string) {
  return state.loggedIn && state.load === 'ready' && state.scenario !== 'offline' && state.rollcalls.some(item => item.id === id) && !state.attendance[id] && !state.pendingAttendance[id];
}
export function activeRollcalls(state: DemoState) {
  return state.loggedIn && state.load === 'ready' ? state.rollcalls.filter(item => !state.attendance[item.id]) : [];
}
export function demoReducer(state: DemoState, event: DemoEvent): DemoState {
  switch (event.type) {
    case 'reset': return initialState();
    case 'scenario': {
      // Keep the last data when toggling connectivity; refreshing offline must not clear it.
      if (event.scenario === 'offline') return { ...state, scenario: 'offline', load: state.load === 'loading' ? 'empty' : state.load };
      const next = { ...initialState(), method: state.method, outcome: state.outcome, listStyle: state.listStyle, showWeekends: state.showWeekends, refreshSchedule: state.refreshSchedule,
        courseStyle: state.courseStyle, accountCardStyle: state.accountCardStyle, conflictStyle: state.conflictStyle, learningPage: state.learningPage, scenario: event.scenario };
      if (event.scenario === 'signed-out') return { ...next, loggedIn: false, load: 'empty', history: [] };
      if (event.scenario === 'long') next.longText = true;
      if (event.scenario === 'empty' || event.scenario === 'loading') next.load = event.scenario;
      return next;
    }
    case 'week': return { ...state, week: Math.max(1, Math.min(TERM.weeks, event.week)) };
    case 'method': return { ...state, method: event.method };
    case 'outcome': return { ...state, outcome: event.outcome };
    case 'permission': return { ...state, notificationPermission: event.value, reminders: event.value === 'granted' };
    case 'reminders': return { ...state, reminders: event.enabled && state.notificationPermission === 'granted' };
    case 'list-style': return { ...state, listStyle: event.value };
    case 'weekends': return { ...state, showWeekends: event.enabled };
    case 'refresh-schedule': return { ...state, refreshSchedule: event.enabled };
    case 'course-style': return { ...state, courseStyle: event.value };
    case 'account-card-style': return { ...state, accountCardStyle: event.value };
    case 'conflict-style': return { ...state, conflictStyle: event.value };
    case 'learning-page': return { ...state, learningPage: event.value };
    case 'refresh': return !state.loggedIn || state.scenario === 'offline' || state.load !== 'loading' ? state : { ...state, load: 'ready' };
    case 'login': return { ...state, loggedIn: true, scenario: 'normal', load: 'ready', history: state.loggedIn ? state.history : [...historyFixtures] };
    case 'logout': return { ...state, loggedIn: false, attendance: {}, pendingAttendance: {}, rollcalls: [], history: [], load: 'empty' };
    case 'start-rollcall': {
      if (!state.loggedIn || state.load !== 'ready' || state.scenario === 'offline') return state;
      const today = sessionsForWeek(TERM.currentWeek).filter(item => item.day === 0);
      const session = today[state.rollcallSequence % today.length];
      const sequence = state.rollcallSequence + 1;
      return { ...state, rollcallSequence: sequence, rollcalls: [...state.rollcalls, {
        id: 'demo-' + sequence, courseId: session.courseId, method: state.method, outcome: state.outcome, time: periods[session.start][0],
      }] };
    }
    case 'attendance-result': return !canAttend(state, event.id) || event.result === 'failed' ? state : { ...state, pendingAttendance: { ...state.pendingAttendance, [event.id]: event.result } };
    case 'attendance-dismissed': {
      let next = state;
      const ids = Object.keys(state.pendingAttendance).filter(id => 'openIds' in event ? !event.openIds.includes(id) : event.ids.includes(id));
      for (const id of ids) {
        const result = next.pendingAttendance[id];
        if (!result) continue;
        const pendingAttendance = { ...next.pendingAttendance };
        delete pendingAttendance[id];
        next = demoReducer({ ...next, pendingAttendance }, { type: 'attendance', id, result });
      }
      return next;
    }
    case 'attendance': {
      if (!canAttend(state, event.id) || event.result === 'failed') return state;
      const rollcall = state.rollcalls.find(item => item.id === event.id)!;
      return { ...state, attendance: { ...state.attendance, [event.id]: event.result }, history: [
        { id: rollcall.id, course: courseFor(rollcall.courseId)!.title, date: DEMO_DAY, time: rollcall.time, type: methodLabel[rollcall.method], status: event.result === 'success' ? 'success' : 'absent' },
        ...state.history,
      ] };
    }
  }
}
