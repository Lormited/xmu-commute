import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, type Dispatch, type ReactNode } from 'react';
import { AccessibilityInfo, AppState, Platform } from 'react-native';
import { demoReducer, initialState, type DemoEvent, type DemoState } from './demo-state';
import { TERM, courseFor, periods, sessionsForWeek, weekDays, todoFixtures, type Todo } from './demo-data';
import { createLearning, historyView, todoView, type LearningSnapshot } from './learning';
import { clearSchoolReminders, readSchoolRemindersEnabled, schoolLearning, schoolRemindersAvailable, setSchoolReminders, syncSchoolReminders } from './school-reminder-device';
import { schoolScheduleView } from './schedule';

type Demo = { state: DemoState; dispatch: Dispatch<DemoEvent>; refresh: () => void; refreshHistory: () => void; refreshing: boolean; homeRefreshAt: Date | null; syncResult: 'success' | 'offline' | null; reducedMotion: boolean;
  timetable: ReturnType<typeof schoolScheduleView>; real: boolean; data: LearningSnapshot; todayDate: Date; todos: Todo[]; login: () => Promise<boolean>; logout: () => Promise<boolean>;
  schoolRemindersAvailable: boolean; changeSchoolReminders: (enabled: boolean) => Promise<boolean>;
  submitNumber: ReturnType<typeof createLearning>['submitNumber']; submitLocation: ReturnType<typeof createLearning>['submitLocation']; submitQr: ReturnType<typeof createLearning>['submitQr']; };
const Context = createContext<Demo | null>(null);
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
  const learning = schoolLearning;
  const data = useSyncExternalStore(learning.subscribe, learning.getSnapshot, learning.getSnapshot);
  const [schoolReminders, setSchoolRemindersValue] = useState(false);
  useEffect(() => {
    if (!real || !schoolRemindersAvailable || !data.ready) return;
    let active = true;
    void syncSchoolReminders().then(enabled => { if (active) setSchoolRemindersValue(enabled); }).catch(() => {});
    return () => { active = false; };
  }, [real, data.ready, data.account?.lntId, data.authenticated, data.loggingIn, data.schedule]);
  async function changeSchoolReminders(enabled: boolean) {
    const changed = await setSchoolReminders(enabled).catch(() => false);
    if (changed) setSchoolRemindersValue(enabled);
    return changed;
  }
  const [selectedWeek, setSelectedWeek] = useState<{ term: string; week: number } | null>(null);
  const timetable: ReturnType<typeof schoolScheduleView> = real ? schoolScheduleView(data) : {
    ...TERM, sessions: preview.load === 'empty' ? [] : sessionsForWeek(TERM.currentWeek), minWeek: 1, periods: periods.map(period => [period[0], period[1]]),
    sessionsForWeek: week => preview.load === 'empty' ? [] : sessionsForWeek(week),
    courseFor: id => courseFor(id, preview.longText), weekDays,
  };
  const schoolWeek = selectedWeek && selectedWeek.term === data.schedule?.jwTermCode ? selectedWeek.week : timetable.currentWeek;
  const state: DemoState = real ? { ...preview, week: Math.max(timetable.minWeek, Math.min(timetable.weeks, schoolWeek)), loggedIn: data.authenticated || !!data.account, load: data.todos.length || data.rollcalls.length ? 'ready' : 'empty', history: data.history.map(historyView), refreshSchedule: data.refreshSchedule, reminders: !!data.account && schoolReminders, rollcalls: data.rollcalls, attendance: data.attendance, pendingAttendance: data.pendingAttendance } : preview;
  const dispatch = useCallback<Dispatch<DemoEvent>>(event => {
    if (real && event.type === 'week') {
      if (data.schedule) setSelectedWeek({ term: data.schedule.jwTermCode, week: Math.max(timetable.minWeek, Math.min(timetable.weeks, event.week)) });
      return;
    }
    if (real && event.type === 'refresh-schedule') { void learning.setRefreshSchedule(event.enabled); return; }
    if (real && event.type === 'attendance-dismissed') { learning.attendanceDismissed(event); return; }
    if (real && ['scenario', 'reset', 'login', 'logout', 'refresh', 'start-rollcall', 'attendance', 'attendance-result', 'attendance-dismissed', 'permission', 'reminders'].includes(event.type)) return;
    previewDispatch(event);
  }, [real, learning, data.schedule, timetable.minWeek, timetable.weeks]);
  const [refreshing, setRefreshing] = useState(false);
  const [homeRefreshAt, setHomeRefreshAt] = useState<Date | null>(null);
  const refreshSchool = useCallback((keepRollcalls = false) => {
    setHomeRefreshAt(new Date());
    return keepRollcalls ? learning.refresh({ keepRollcalls: true }) : learning.refresh();
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
    if (real) void learning.restore().then(async () => {
      const keepRollcalls = schoolRemindersAvailable && await readSchoolRemindersEnabled();
      return refreshSchool(keepRollcalls);
    });
  }, [learning, real, refreshSchool]);
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
    if (real) {
      const reminders = clearSchoolReminders().then(() => true, () => false);
      const cleared = learning.logout();
      const [remindersCleared, learningCleared] = await Promise.all([reminders, cleared]);
      return remindersCleared && learningCleared;
    }
    previewDispatch({ type: 'logout' });
    return true;
  }
  const todos = useMemo(() => real ? data.todos.map(item => todoView(item, now)) : todoFixtures(preview.longText), [real, data.todos, preview.longText, now]);
  return <Context.Provider value={{ state, dispatch, refresh, refreshHistory, refreshing: real ? data.refreshing : refreshing, homeRefreshAt,
    syncResult: real && data.message ? 'offline' : syncResult, reducedMotion, timetable, real, data, todayDate: now, todos, login, logout,
    schoolRemindersAvailable, changeSchoolReminders, submitNumber: learning.submitNumber,
    submitQr: learning.submitQr, submitLocation: learning.submitLocation }}>{children}</Context.Provider>;
}
export function useDemo() {
  const demo = useContext(Context);
  if (!demo) throw new Error('DemoProvider is required');
  return demo;
}
