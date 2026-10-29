import { createContext, useContext, useEffect, useReducer, useRef, useState, type Dispatch, type ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';
import { demoReducer, initialState, type DemoEvent, type DemoState } from './demo-state';

type Demo = { state: DemoState; dispatch: Dispatch<DemoEvent>; refresh: () => void; refreshing: boolean; syncResult: 'success' | 'offline' | null; reducedMotion: boolean };
const Context = createContext<Demo | null>(null);
export function DemoProvider({ children }: { children: ReactNode }) {
  // shortcut: prototype state stays in memory; add device persistence with real integration.
  const [state, dispatch] = useReducer(demoReducer, undefined, initialState);
  const [refreshing, setRefreshing] = useState(false);
  const [syncResult, setSyncResult] = useState<Demo['syncResult']>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) setReducedMotion(value); }).catch(() => {});
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => { alive = false; listener.remove(); if (timer.current) clearTimeout(timer.current); if (resultTimer.current) clearTimeout(resultTimer.current); };
  }, []);
  function refresh() {
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
  return <Context.Provider value={{ state, dispatch, refresh, refreshing, syncResult, reducedMotion }}>{children}</Context.Provider>;
}
export function useDemo() {
  const demo = useContext(Context);
  if (!demo) throw new Error('DemoProvider is required');
  return demo;
}
