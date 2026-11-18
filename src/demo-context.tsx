import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, type Dispatch, type ReactNode } from 'react';
import { AccessibilityInfo, AppState, Platform } from 'react-native';
import { demoReducer, initialState, type DemoEvent, type DemoState } from './demo-state';
import { TERM, courseFor, periods, sessionsForWeek, weekDays, todoFixtures, type Todo } from './demo-data';
import { createLearning, historyView, todoView, type LearningSnapshot } from './learning';
import { schoolDevice } from './school-device';
import { schoolScheduleView } from './schedule';
import { qrData } from './qr.ts';
import { isPosition, type Position } from './location-attendance.ts';
import { createAttendanceTrial, type TrialSnapshot } from './attendance-trial';
import { attendanceTrialDevice } from './attendance-trial-device';

type Demo = { state: DemoState; dispatch: Dispatch<DemoEvent>; refresh: () => void; refreshHistory: () => void; refreshing: boolean; homeRefreshAt: Date | null; syncResult: 'success' | 'offline' | null; reducedMotion: boolean;
  timetable: ReturnType<typeof schoolScheduleView>; real: boolean; data: LearningSnapshot; todayDate: Date; todos: Todo[]; login: () => Promise<boolean>; logout: () => Promise<boolean>;
  submitNumber: ReturnType<typeof createLearning>['submitNumber']; submitLocation: ReturnType<typeof createLearning>['submitLocation']; submitQr: ReturnType<typeof createLearning>['submitQr'];

  trial: ReturnType<typeof createAttendanceTrial>; trialData: TrialSnapshot; isTrialRollcall: (id: string) => boolean };
const Context = createContext<Demo | null>(null);
// A foreground task outlives an Activity; remounts must share its controller and pending fixtures.
const deviceTrial = createAttendanceTrial(attendanceTrialDevice,
  Platform.OS === 'android' && (!__DEV__ || process.env.EXPO_PUBLIC_PREVIEW !== '1'));
export function DemoProvider({ children }: { children: ReactNode }) {
  const [preview, previewDispatch] = useReducer(demoReducer, undefined, initialState);
  const real = Platform.OS === 'android' && (!__DEV__ || process.env.EXPO_PUBLIC_PREVIEW !== '1');
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!real) return;
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      const current = new Date();
      setNow(current);
      const midnight = new Date(current);
      midnight.setHours(24, 0, 0, 0);
      timer = setTimeout(update, midnight.getTime() - current.getTime());
    };
    update();
    const listener = AppState.addEventListener('change', status => {
      if (status === 'active') { clearTimeout(timer); update(); }
    });
    return () => { clearTimeout(timer); listener.remove(); };
  }, [real]);
  const [learning] = useState(() => createLearning(schoolDevice));
  const trial = deviceTrial;
  const trialData = useSyncExternalStore(trial.subscribe, trial.getSnapshot, trial.getSnapshot);
  const data = useSyncExternalStore(learning.subscribe, learning.getSnapshot, learning.getSnapshot);
  const [selectedWeek, setSelectedWeek] = useState<{ term: string; week: number } | null>(null);
  const timetable: ReturnType<typeof schoolScheduleView> = real ? schoolScheduleView(data) : {
    ...TERM, sessions: preview.load === 'empty' ? [] : sessionsForWeek(TERM.currentWeek), minWeek: 1, periods: periods.map(period => [period[0], period[1]]),
    sessionsForWeek: week => preview.load === 'empty' ? [] : sessionsForWeek(week),
    courseFor: id => courseFor(id, preview.longText), weekDays,
  };
  const schoolWeek = selectedWeek && selectedWeek.term === data.schedule?.jwTermCode ? selectedWeek.week : timetable.currentWeek;
  const base: DemoState = real ? { ...preview, week: Math.max(timetable.minWeek, Math.min(timetable.weeks, schoolWeek)), loggedIn: data.authenticated || !!data.account, load: data.todos.length || data.rollcalls.length ? 'ready' : 'empty', history: data.history.map(historyView), refreshSchedule: data.refreshSchedule, rollcalls: data.rollcalls, attendance: data.attendance, pendingAttendance: data.pendingAttendance } : preview;
  const state: DemoState = trialData.rollcalls.length ? { ...base, rollcalls: [...base.rollcalls, ...trialData.rollcalls],
    attendance: { ...base.attendance, ...trialData.attendance }, pendingAttendance: { ...base.pendingAttendance, ...trialData.pendingAttendance } } : base;
  const dispatch = useCallback<Dispatch<DemoEvent>>(event => {
    if (event.type === 'attendance-dismissed') trial.attendanceDismissed(event);
    if (real && event.type === 'week') {
      if (data.schedule) setSelectedWeek({ term: data.schedule.jwTermCode, week: Math.max(timetable.minWeek, Math.min(timetable.weeks, event.week)) });
      return;
    }
    if (real && event.type === 'refresh-schedule') { void learning.setRefreshSchedule(event.enabled); return; }
    if (real && event.type === 'attendance-dismissed') { learning.attendanceDismissed(event); return; }
    if (real && ['scenario', 'reset', 'login', 'logout', 'refresh', 'start-rollcall', 'attendance', 'attendance-result', 'attendance-dismissed', 'permission', 'reminders'].includes(event.type)) return;
    previewDispatch(event);
  }, [real, learning, trial, data.schedule, timetable.minWeek, timetable.weeks]);
  const [refreshing, setRefreshing] = useState(false);
  const [homeRefreshAt, setHomeRefreshAt] = useState<Date | null>(null);
  const refreshSchool = useCallback(() => {
    setHomeRefreshAt(new Date());
    return learning.refresh();
  }, [learning]);
  const [syncResult, setSyncResult] = useState<Demo['syncResult']>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasRefreshing = useRef(false);
  useEffect(() => {
    if (!real) return;
    if (data.refreshing) {
      if (resultTimer.current) clearTimeout(resultTimer.current);
      setSyncResult(null);
    } else if (wasRefreshing.current) {
      setSyncResult(data.message ? 'offline' : 'success');
      resultTimer.current = setTimeout(() => { setSyncResult(null); resultTimer.current = null; }, 1000);
    }
    wasRefreshing.current = data.refreshing;
  }, [real, data.refreshing, data.message]);
  useEffect(() => {
    if (real) void learning.restore().then(refreshSchool);
  }, [learning, real, refreshSchool]);
  useEffect(() => { void trial.restore(); }, [trial]);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) setReducedMotion(value); }).catch(() => {});
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => { alive = false; listener.remove(); if (timer.current) clearTimeout(timer.current); if (resultTimer.current) clearTimeout(resultTimer.current); };
  }, []);
  function refresh() {
    if (real) {
      void refreshSchool();
      return;
    }
    if (timer.current || !state.loggedIn) return;
    if (resultTimer.current) clearTimeout(resultTimer.current);
    setSyncResult(null);
    setRefreshing(true);
    timer.current = setTimeout(() => {
      dispatch({ type: 'refresh' });
      setSyncResult(state.scenario === 'offline' ? 'offline' : 'success');
      setRefreshing(false); timer.current = null;
      resultTimer.current = setTimeout(() => { setSyncResult(null); resultTimer.current = null; }, 1000);
    }, 850);
  }
  const refreshHistory = useCallback(() => { void learning.refreshHistory(); }, [learning]);
  async function login() {
    if (real) {
      const loggedIn = await learning.login();
      if (loggedIn) setHomeRefreshAt(new Date());
      return loggedIn;
    }
    previewDispatch({ type: 'login' });
    return true;
  }
  async function logout() {
    setSyncResult(null);
    setSelectedWeek(null);
    await trial.stop();
    if (real) return learning.logout();
    previewDispatch({ type: 'logout' });
    return true;
  }
  async function submitQr(id: string, rawScanText: string) {
    if (!id.startsWith('trial-')) return learning.submitQr(id, rawScanText);
    try {
      qrData(rawScanText, id);
      if (trialData.rollcalls.some(item => item.id === id && item.method === 'qr')) return trial.submit(id);
    } catch { /* A trial scan never falls through to a school write. */ }
    return { result: 'failed' as const, message: '模拟二维码与当前活动不符' };
  }
  async function submitLocation(id: string, position: Position) {
    if (!id.startsWith('trial-')) return learning.submitLocation(id, position);
    if (isPosition(position) && trialData.rollcalls.some(item => item.id === id && item.method === 'radar')) return trial.submit(id);
    return { result: 'failed' as const, message: '模拟定位活动或位置不可用' };
  }
  const todos = useMemo(() => real ? data.todos.map(item => todoView(item, now)) : todoFixtures(preview.longText), [real, data.todos, preview.longText, now]);
  return <Context.Provider value={{ state, dispatch, refresh, refreshHistory, refreshing: real ? data.refreshing : refreshing, homeRefreshAt,
    syncResult: real && data.message ? 'offline' : syncResult, reducedMotion, timetable, real, data, todayDate: now, todos, login, logout,
    trial, trialData, isTrialRollcall: trial.isTrialRollcall,
    submitNumber: (id, code) => id.startsWith('trial-') ? trial.submitNumber(id, code) : learning.submitNumber(id, code), submitQr, submitLocation }}>{children}</Context.Provider>;
}
export function useDemo() {
  const demo = useContext(Context);
  if (!demo) throw new Error('DemoProvider is required');
  return demo;
}
