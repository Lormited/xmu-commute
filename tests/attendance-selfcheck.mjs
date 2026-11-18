import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import React from 'react';
import ts from 'typescript';
import * as data from '../src/demo-data.ts';
import * as schedule from '../src/schedule.ts';
import { createLearning, historyView, todoView } from '../src/learning.ts';
import { activeRollcalls, canAttend, demoReducer, initialState } from '../src/demo-state.ts';
import { createAttendanceTrial } from '../src/attendance-trial.ts';
import * as qrModule from '../src/qr.ts';
import * as locationModule from '../src/location-attendance.ts';
import { attendanceDestination } from '../src/attendance-reminders.ts';

const require = createRequire(import.meta.url);
const source = ts.transpileModule(readFileSync(new URL('../app/attendance.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const layoutSource = ts.transpileModule(readFileSync(new URL('../app/_layout.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const providerSource = ts.transpileModule(readFileSync(new URL('../src/demo-context.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const bridgeSource = ts.transpileModule(readFileSync(new URL('../src/attendance-notification-bridge.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Execute the installed router's native callbacks and screen-listener selection.
const routerBuild = new URL('../node_modules/expo-router/build/', import.meta.url);
const builderFile = ts.createSourceFile('useNavigationBuilder.js', readFileSync(new URL('react-navigation/core/useNavigationBuilder.js', routerBuild), 'utf8'), ts.ScriptTarget.Latest, true);
let routeListenerSource;
function findRouteListener(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(builderFile) === 'emitter') routeListenerSource = node.initializer.arguments[0].getText(builderFile);
  ts.forEachChild(node, findRouteListener);
}
findRouteListener(builderFile);
assert.ok(routeListenerSource);
const nativeStack = {};
runInNewContext(readFileSync(new URL('react-navigation/native-stack/views/NativeStackView.native.js', routerBuild), 'utf8'), {
  exports: nativeStack, require(name) {
    if (name === 'react') return { ...React, use: () => null };
    if (name === 'react-native') return { Platform: { OS: 'android' }, StyleSheet: { create: value => value } };
    if (name === 'react-native-screens') return { ScreenStack: 'NativeScreenStack' };
    if (name === '../../native') return { useTheme: () => ({ colors: {} }) };
    if (name === '../../elements') return { SafeAreaProviderCompat: 'SafeAreaProvider' };
    if (name === '../utils/useDismissedRouteError') return { useDismissedRouteError: () => ({ setNextDismissedKey() {} }) };
    if (name === '../utils/useInvalidPreventRemoveError') return { useInvalidPreventRemoveError() {} };
    if (name === '../utils/getModalRoutesKeys') return require(fileURLToPath(new URL('react-navigation/native-stack/utils/getModalRoutesKeys.js', routerBuild)));
    if (name === 'react/jsx-runtime') return require(name);
    return {};
  },
});

// Drive the real screen callbacks; native dismissal is represented separately from requesting back.
function screen(outcome = 'success', platform = 'android', learning = null, selectedId = null, location = {}, method = 'number', trialCache = null, trialDevice = {}, trialController = null, underlyingIds = []) {
  let state = demoReducer(demoReducer(demoReducer(initialState(), { type: 'method', method }), { type: 'outcome', outcome }), { type: 'start-rollcall' });
  const id = selectedId ?? state.rollcalls[0].id;
  const dispatch = event => { state = demoReducer(state, event); };
  const screenHooks = [], providerHooks = [];
  let hooks = screenHooks, context;
  const timers = new Map();
  const navigationListeners = new Map();
  let cursor = 0, sequence = 0, now = 0, backRequests = 0, tree, focused = true;
  const clock = {
    setTimeout: (callback, delay) => { const timer = ++sequence; timers.set(timer, { callback, due: now + delay }); return timer; },
    clearTimeout: timer => timers.delete(timer),
  };
  let effects = [];
  const navigation = { isFocused: () => focused, addListener: (name, listener) => { navigationListeners.set(name, listener); return () => navigationListeners.delete(name); } };
  function memo(factory, deps) {
    const slot = hooks[cursor++] ??= {};
    if (!slot.deps || deps.some((value, i) => !Object.is(value, slot.deps[i]))) {
      slot.value = factory(); slot.deps = deps;
    }
    return slot.value;
  }
  const react = {
    ...React,
    useState(value) {
      const slot = hooks[cursor++] ??= { value: typeof value === 'function' ? value() : value };
      return [slot.value, next => { slot.value = next; }];
    },
    useReducer: () => [state, dispatch],
    useMemo: memo,
    useCallback: (callback, deps) => memo(() => callback, deps),
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    useRef(value) { return hooks[cursor++] ??= { current: value }; },
    useEffect(effect, deps) {
      const slot = hooks[cursor++] ??= {};
      if (!slot.deps || deps.some((value, i) => !Object.is(value, slot.deps[i]))) {
        effects.push(() => { slot.cleanup?.(); slot.cleanup = effect(); slot.deps = deps; });
      }
    },
  };
  const provider = {};
  runInNewContext(providerSource, {
    exports: provider, __DEV__: true, process: { env: { EXPO_PUBLIC_PREVIEW: learning ? undefined : '1' } }, ...clock, require(name) {
      if (name === 'react') return react;
      if (name === 'react-native') return { AppState: { addEventListener: () => ({ remove() {} }) }, Platform: { OS: platform }, AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() { } }) } };
      if (name === './demo-state') return { demoReducer, initialState };
      if (name === './demo-data') return data;
      if (name === './schedule') return schedule;
      if (name === './learning') return { createLearning: learning ? () => learning : createLearning, historyView, todoView };
      if (name === './qr.ts') return qrModule;
      if (name === './location-attendance.ts') return locationModule;
      if (name === './school-device') return { schoolDevice: {} };
      if (name === './attendance-trial') return { createAttendanceTrial: trialController ? () => trialController : createAttendanceTrial };
      if (name === './attendance-trial-device') return { attendanceTrialDevice: { now: Date.now,
        load: async () => trialCache, save: async () => {}, stop: async () => {}, wake() {}, ...trialDevice } };
      return require(name);
    }
  });
  const exports = {};
  const goBack = () => { focused = false; navigationListeners.get('blur')?.(); backRequests++; };
  runInNewContext(source, {
    exports,
    ...clock,
    require(name) {
      if (name === 'react') return react;
      if (name === 'react-native') return { Keyboard: { dismiss() { } }, Platform: { OS: platform }, ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput', View: 'View', StyleSheet: { create: value => value } };
      if (name === 'expo-router') return { useLocalSearchParams: () => ({ id }), useNavigation: () => navigation, useIsFocused: () => focused };
      if (name === 'expo-location') return { Accuracy: { High: 4 }, ...location };
      if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ bottom: 0 }) };
      if (name === '@/demo-context') return { useDemo: () => context };
      if (name === '@/demo-state') return { canAttend };
      if (name === '@/demo-data') return data;
      if (name === '@/ui') return { Button: 'Button', Icon: 'Icon', Tap: 'Tap', c: {}, s: {}, goBack };
      if (name === '@/status-motion') return { AttendanceMark: 'AttendanceMark' };
      if (name === '@/qr-attendance') return { QrAttendance: 'QrAttendance' };
      return require(name);
    },
  });
  function render() {
    hooks = providerHooks; cursor = 0; effects = [];
    context = provider.DemoProvider({ children: null }).props.value;
    for (const effect of effects) effect();
    hooks = screenHooks; cursor = 0; effects = []; tree = exports.default();
    for (const effect of effects) effect();
  }
  function find(predicate, node = tree) {
    if (!node || typeof node !== 'object') return;
    if (predicate(node)) return node;
    for (const child of React.Children.toArray(node.props?.children)) {
      const match = find(predicate, child);
      if (match) return match;
    }
  }
  const routes = [{ key: 'tabs-1', name: '(tabs)' }, ...[...underlyingIds, id].map(routeId => ({ key: 'attendance-' + routeId, name: 'attendance', params: selectedId === null ? undefined : { id: routeId } }))];
  const stackState = { routes, index: routes.length - 1 };
  const layout = {};
  const Stack = Object.assign(() => null, { Screen: 'StackScreen' });
  runInNewContext(layoutSource + '\nexports.navigation = Navigation;', {
    exports: layout, require(name) {
      if (name === 'react-native') return { Platform: { OS: platform }, View: 'View' };
      if (name === 'expo-router') return { Stack, useNavigationContainerRef: () => ({ getRootState: () => stackState }) };
      if (name === '@/demo-context') return { useDemo: () => ({ state: context?.state ?? state, reducedMotion: false, dispatch: event => context.dispatch(event) }) };
      if (name === '@/school-browser-view') return { SchoolBrowserHost: () => null };
      if (name === '@/attendance-notification-bridge') return { AttendanceNotificationBridge: () => null };
      if (name === 'expo-font' || name === 'expo-status-bar' || name === '@expo/vector-icons' || name === 'react-native-safe-area-context' || name === 'react-native-gesture-handler') return {};
      return require(name);
    }
  });
  const layoutTree = layout.navigation();
  const attendanceProps = find(node => node.props?.name === 'attendance', layoutTree).props;
  const descriptors = Object.fromEntries(routes.map(route => [route.key, { navigation, options: route.name === 'attendance' ? attendanceProps.options : {} }]));
  const emit = runInNewContext('(' + routeListenerSource + ')', { state: stackState, screens: { attendance: { props: attendanceProps } }, descriptors, screenListeners: undefined });
  const pop = () => { stackState.routes = routes.slice(0, -1); stackState.index = stackState.routes.length - 1; };
  const stack = () => nativeStack.NativeStackView({ state: stackState, descriptors, emit, pop, isPreloaded: () => false, isRemovalPrevented: () => false,
    unstable_nativeProps: find(node => node.type === Stack, layout.navigation()).props.unstable_nativeProps });
  const nativeScene = stack().props.children.props.children.at(-1).props;
  function dismiss() { pop(); for (const slot of screenHooks) slot.cleanup?.(); }
  function transitionEnd(closing) {
    if (closing) nativeScene.onDisappear(); else nativeScene.onAppear();
    stack().props.children.props.onFinishTransitioning?.();
    render();
  }
  render();
  return {
    id,
    get state() { return learning ? context.state : state; },
    get context() { return context; },
    rerender: render,
    async flush() { await new Promise(resolve => setImmediate(resolve)); render(); },
    find,
    get backRequests() { return backRequests; },
    enter(value) { find(node => node.type === 'TextInput').props.onChangeText(value); render(); },
    close() { find(node => node.props?.label === '关闭签到').props.onPress(); },
    blur() { focused = false; navigationListeners.get('blur')?.(); render(); },
    focus() { focused = true; navigationListeners.get('focus')?.(); render(); },
    transitionEnd,
    nativeDismiss(gesture = false) {
      if (gesture) nativeScene.onDismissed({ nativeEvent: { dismissCount: 1 } });
      dismiss(); transitionEnd(true);
    },
    advance(ms) {
      const end = now + ms;
      for (; ;) {
        const next = [...timers].filter(([, timer]) => timer.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        now = next[1].due; timers.delete(next[0]); next[1].callback(); render();
      }
      now = end;
    },
    dismiss,
  };
}

for (const outcome of ['success', 'ended']) {
  test(outcome + ' keeps the reminder until the result sheet has actually dismissed', () => {
    const app = screen(outcome);
    const historyCount = app.state.history.length;
    app.enter('0206');
    app.advance(650);
    assert.equal(activeRollcalls(app.state).length, 1, 'result is visible but the sheet has not closed');
    assert.equal(canAttend(app.state, app.state.rollcalls[0].id), false, 'the retained reminder cannot submit twice');
    app.transitionEnd(false);
    assert.equal(activeRollcalls(app.state).length, 1, 'an opening transition cannot consume the result');
    app.advance(1000);
    assert.equal(app.backRequests, 1);
    assert.equal(activeRollcalls(app.state).length, 1, 'requesting back is not the end of the native dismissal');
    app.dismiss();
    assert.equal(activeRollcalls(app.state).length, 1, 'React unmount alone is not native animation completion');
    app.transitionEnd(true);
    assert.equal(activeRollcalls(app.state).length, 0);
    assert.equal(app.state.history.length, historyCount + 1);
    app.transitionEnd(true);
    assert.equal(app.state.history.length, historyCount + 1, 'repeated cleanup cannot duplicate history');
  });
}

test('manual closing after success uses the same dismissal boundary', () => {
  const app = screen();
  app.enter('0206'); app.advance(650); app.close();
  assert.equal(activeRollcalls(app.state).length, 1);
  app.dismiss();
  app.transitionEnd(true);
  assert.equal(activeRollcalls(app.state).length, 0);
  app.advance(1000);
  assert.equal(app.backRequests, 1, 'cleanup cancels the delayed navigation');
});

test('closing an unfinished submission or a failed result leaves the reminder and history', () => {
  for (const outcome of ['success', 'failed']) {
    const app = screen(outcome);
    const historyCount = app.state.history.length;
    app.enter('0206');
    if (outcome === 'failed') app.advance(650);
    app.close(); app.dismiss(); app.transitionEnd(true); app.advance(2000);
    assert.equal(activeRollcalls(app.state).length, 1);
    assert.equal(app.state.history.length, historyCount);
  }
});

test('Web removes the reminder when its overlay unmounts without a native transition event', () => {
  const app = screen('success', 'web');
  app.enter('0206'); app.advance(650);
  assert.equal(activeRollcalls(app.state).length, 1);
  app.close(); app.dismiss();
  assert.equal(activeRollcalls(app.state).length, 0);
});

test('provider rerenders preserve submission and the result dismissal boundary', () => {
  const app = screen();
  const historyCount = app.state.history.length;
  app.enter('0206'); app.rerender(); app.advance(650);
  assert.equal(canAttend(app.state, app.state.rollcalls[0].id), false, 'refreshing the provider cannot cancel submission');
  app.rerender();
  assert.equal(app.state.history.length, historyCount);
  assert.equal(activeRollcalls(app.state).length, 1);
  app.close(); app.dismiss(); app.transitionEnd(true);
  assert.equal(app.state.history.length, historyCount + 1);
});

async function realScreen(reply = async () => ({ result: 'success', message: '学校确认签到成功' }), method = 'number', selectedId = '81', location = {}) {
  const answers = [], activities = [
    { rollcall_id: 81, course_id: 301, course_title: '学校返回的活动名称', is_number: method === 'number', is_radar: method === 'radar' },
    { rollcall_id: 82, course_id: 301, course_title: '同课另一个活动', is_number: true },
  ];
  const device = {
    load: async () => null, save: async () => {}, clear: async () => {}, authenticate: async callback => callback?.(),
    read: async action => ({
      profile: { id: 42, user_no: '001234' }, todos: { todo_list: [] }, rollcalls: { rollcalls: activities },
      lntTerms: { semesters: [{ id: 9, name: 'LNT 当前学期', is_active: true }] },
      jwTerms: { datas: { kfdxnxqcx: { rows: [{ DM: '20261', MC: '当前学期' }] } } },
      jwWeek: { success: true, currentZc: '8', zcList: [{ ZC: '8' }] }, courses: { courses: [] },
      jwSchedule: { success: true, pkjgList: [] },
    })[action],
    answerNumber: async (id, code) => { answers.push({ id, code }); return reply(); },
    submitLocation: async (id, position) => { answers.push({ id, position }); return reply(); },
    submitQr: async (id, data) => { answers.push({ id, data }); return reply(); },
  };
  const learning = createLearning(device);
  assert.equal(await learning.login(), true);
  const app = screen('success', 'android', learning, selectedId, location);
  await app.flush();
  return { app, learning, answers, device };
}

async function notificationScreen(app, learning, id) {
  let click, opened;
  const bridge = {};
  runInNewContext(bridgeSource, { exports: bridge, __DEV__: true, require(name) {
    if (name === 'react') return { useEffect: effect => effect() };
    if (name === 'react-native') return { Platform: { OS: 'android' } };
    if (name === 'expo-router') return { useRootNavigationState: () => ({ key: 'root' }), router: { push: route => {
      app.blur();
      opened = screen('success', 'android', learning, route.params.id, {}, 'number', null, {}, app.context.trial, [app.id]);
    } } };
    if (name === './demo-context') return { useDemo: () => app.context };
    if (name === './attendance-reminders') return { attendanceDestination };
    if (name === './attendance-trial-device') return { watchAttendanceNotifications: async listener => { click = listener; return () => {}; } };
    return require(name);
  } });
  bridge.AttendanceNotificationBridge();
  await click({ source: id.startsWith('trial-') ? 'trial' : 'school', rollcallId: id });
  assert.ok(opened, 'the real notification bridge pushes the requested activity');
  await opened.flush();
  return opened;
}

test('stacked notification sheets submit independently and remove only the card whose exit finished', async () => {
  for (const source of ['trial', 'school', 'mixed']) for (const outcome of ['success', 'ended', 'failed']) {
    const simulated = source !== 'school';
    let count = 0;
    const live = await realScreen(async () => ({ result: ++count === 1 ? 'success' : outcome, message: count === 1 ? 'A confirmed' : 'B ' + outcome }));
    const ids = source === 'trial' ? ['trial-7000000-1', 'trial-7000000-2'] : source === 'mixed' ? ['81', 'trial-7000000-2'] : ['81', '82'];
    const a = simulated ? screen('success', 'android', live.learning, ids[0], {}, 'number', JSON.stringify({ version: 1, logs: [], events:
      ids.map((id, index) => ({ id, method: 'number', outcome: index ? outcome : 'success', availableAt: 1, discoveredAt: 2, notifiedAt: 2 })).filter(item => item.id.startsWith('trial-')),
    })) : live.app;
    await a.flush(); a.enter('0206'); await a.flush();
    const b = await notificationScreen(a, live.learning, ids[1]);
    a.advance(2000); assert.equal(a.backRequests, 0, 'covered A cannot close B');
    b.enter('0206'); await b.flush();
    const feedback = simulated ? { success: '签到成功（模拟）', ended: '签到已结束（模拟）', failed: '签到失败（模拟）' }[outcome] : 'B ' + outcome;
    assert.ok(b.find(node => node.type === 'Text' && node.props.children === feedback), 'B shows its own receipt: ' + simulated + ' ' + outcome);
    assert.equal(b.state.attendance[ids[0]], undefined);
    assert.equal(b.state.attendance[ids[1]], undefined, 'B card remains until native exit ends');
    b.nativeDismiss(); a.focus();
    assert.equal(a.state.attendance[ids[1]], outcome === 'failed' ? undefined : outcome, 'B exit settles B while A remains on the stack');
    assert.equal(a.state.attendance[ids[0]], undefined, 'A card remains until A exits');
    assert.ok(a.find(node => node.type === 'Text' && node.props.children === (source === 'trial' ? '签到成功（模拟）' : 'A confirmed')));
    a.nativeDismiss();
    assert.equal(a.state.attendance[ids[0]], 'success');
    assert.equal(a.state.attendance[ids[1]], outcome === 'failed' ? undefined : outcome);
    if (source === 'trial') assert.equal(live.answers.length, 0);
    if (source === 'mixed') assert.equal(live.answers.length, 1);
  }
});

test('a notification preserves the unfinished underlying code when the second sheet closes', async () => {
  const { app: a, learning } = await realScreen();
  a.enter('02');
  const b = await notificationScreen(a, learning, '82');
  b.enter('0206'); await b.flush(); b.nativeDismiss(); a.focus();
  assert.equal(a.find(node => node.type === 'TextInput').props.value, '02');
  assert.equal(a.state.attendance['82'], 'success');
  a.enter('0206'); await a.flush(); a.nativeDismiss();
  assert.deepEqual(a.state.attendance, { '81': 'success', '82': 'success' });
});

test('school sheets accept both in-flight writes and keep out-of-order and late receipts on their own activity', async () => {
  for (const first of ['81', '82']) {
    const replies = {};
    let count = 0;
    const { app: a, learning, answers } = await realScreen(() => new Promise(resolve => { replies[++count === 1 ? '81' : '82'] = resolve; }));
    a.enter('0206'); await a.flush();
    const b = await notificationScreen(a, learning, '82');
    b.enter('0206'); await b.flush();
    assert.equal(answers.length, 2, 'B can submit while A is still waiting');
    replies[first]({ result: 'success', message: first + ' confirmed' }); await b.flush();
    b.nativeDismiss(); a.focus();
    const second = first === '81' ? '82' : '81';
    replies[second]({ result: 'ended', message: second + ' ended' }); await a.flush();
    assert.equal(a.state.attendance['81'], undefined, 'B closing cannot mark A dismissed');
    assert.equal(a.state.attendance['82'], first === '82' ? 'success' : 'ended');
    assert.ok(a.find(node => node.type === 'Text' && node.props.children === (first === '81' ? '81 confirmed' : '81 ended')));
    a.nativeDismiss();
    assert.equal(a.state.attendance['81'], first === '81' ? 'success' : 'ended');
  }
});

for (const timing of ['before', 'after']) test('native exit settles a refreshed-away activity when its receipt arrives ' + timing + ' dismissal', async () => {
  let resolveReceipt, resolveRollcalls, saved;
  const receipt = new Promise(resolve => { resolveReceipt = resolve; });
  const { app, learning, answers, device } = await realScreen(() => receipt);
  const read = device.read;
  device.read = action => action === 'rollcalls' ? new Promise(resolve => { resolveRollcalls = resolve; }) : read(action);
  device.save = async value => { saved = value; };
  const refreshing = learning.refresh(); await app.flush();
  app.enter('0206'); await app.flush();
  resolveRollcalls({ rollcalls: [] }); await refreshing; await app.flush();
  assert.equal(app.state.rollcalls.length, 0, 'the earlier refresh can remove the submitted activity');
  if (timing === 'before') { resolveReceipt({ result: 'success', message: '学校确认签到成功' }); await app.flush(); }
  app.nativeDismiss();
  if (timing === 'after') { resolveReceipt({ result: 'success', message: '学校确认签到成功' }); await app.flush(); }
  assert.deepEqual(learning.getSnapshot().pendingAttendance, {});
  assert.equal(learning.getSnapshot().attendance['81'], 'success');
  assert.equal(JSON.parse(saved).attendance['81'], 'success', 'confirmed results remain cached');
  assert.equal(answers.length, 1, 'closing cannot retry a school submission');
});

test('real number screen submits only at four digits, preserves zeros, shows school feedback and auto-closes after one second', async () => {
  const { app, answers } = await realScreen();
  assert.equal(app.state.load, 'ready', 'activities remain usable even when the todo list is empty');
  assert.ok(app.find(node => node.type === 'Text' && node.props.children === '学校返回的活动名称'));
  app.enter('0'); app.enter('00'); app.enter('000');
  assert.equal(answers.length, 0);
  const field = app.find(node => node.type === 'TextInput');
  assert.equal(field.props.accessibilityLabel, '四位签到码');
  field.props.onChangeText('0007'); field.props.onChangeText('0007'); app.rerender();
  assert.deepEqual(answers, [{ id: '81', code: '0007' }]);
  assert.ok(app.find(node => node.type === 'Text' && node.props.children === '签到中'));
  await app.flush();
  assert.ok(app.find(node => node.type === 'Text' && node.props.children === '学校确认签到成功'));
  assert.equal(activeRollcalls(app.state).length, 2);
  assert.equal(canAttend(app.state, '81'), false);
  app.transitionEnd(false); app.advance(999); assert.equal(app.backRequests, 0);
  app.advance(1); assert.equal(app.backRequests, 1);
  assert.equal(activeRollcalls(app.state).length, 2);
  app.dismiss(); app.transitionEnd(true);
  assert.deepEqual(activeRollcalls(app.state).map(item => item.id), ['82']);
  assert.equal(app.state.history.length, 0, 'real receipts never fabricate demo history');
});

test('restored trial id opens the real number sheet and uses a persisted simulated receipt without any school write', async () => {
  const { learning, answers } = await realScreen();
  const id = 'trial-1000000-1';
  const app = screen('success', 'android', learning, id, {}, 'number', JSON.stringify({ version: 1, logs: [], events: [
    { id, method: 'number', outcome: 'success', availableAt: 1000000, discoveredAt: 1000010, notifiedAt: 1000010 },
  ] }));
  await app.flush();
  assert.ok(app.find(node => node.type === 'TextInput'));
  assert.equal(app.context.isTrialRollcall(id), true);
  app.enter('0206'); await app.flush();
  assert.ok(app.find(node => node.type === 'Text' && node.props.children === '签到成功（模拟）'));
  assert.equal(answers.length, 0);
  assert.equal(app.state.pendingAttendance[id], 'success');
  assert.equal(app.state.attendance[id], undefined);
  app.dismiss(); app.transitionEnd(true);
  assert.equal(app.state.attendance[id], 'success');
  assert.equal(learning.getSnapshot().rollcalls.some(item => item.id === id), false);
  assert.equal((await app.context.submitNumber('trial-unknown', '0206')).result, 'failed');
  assert.equal(answers.length, 0);
});

test('real network errors show an uncertain result; explicit re-entry and manual success closing share native dismissal', async () => {
  let attempt = 0;
  const { app, answers } = await realScreen(async () => {
    if (++attempt === 1) throw Error('NETWORK');
    return { result: 'success', message: '学校确认签到成功' };
  });
  app.enter('0206'); await app.flush();
  assert.ok(app.find(node => node.type === 'Text' && node.props.children === '未收到有效回执，提交结果未知，请核实本人记录'));
  assert.equal(answers.length, 1, 'an uncertain write is not retried automatically');
  assert.equal(activeRollcalls(app.state).length, 2);
  app.find(node => node.props?.label === '重新签到').props.onPress(); app.rerender();
  assert.equal(app.find(node => node.type === 'TextInput').props.value, '');
  app.enter('0000'); await app.flush();
  assert.deepEqual(answers.map(item => item.code), ['0206', '0000']);
  assert.ok(app.find(node => node.type === 'Text' && node.props.children === '学校确认签到成功'));
  app.close(); app.dismiss(); app.transitionEnd(true); app.advance(1000);
  assert.equal(app.backRequests, 1);
  assert.deepEqual(activeRollcalls(app.state).map(item => item.id), ['82']);
});

test('closing a real request before its receipt keeps the write result and prevents late screen navigation', async () => {
  let resolve;
  const reply = new Promise(done => { resolve = done; });
  const { app, learning } = await realScreen(() => reply);
  app.enter('0206'); app.close(); app.dismiss(); app.transitionEnd(true);
  assert.equal(activeRollcalls(app.state).length, 2);
  resolve({ result: 'success', message: '延迟学校成功回执' }); await app.flush();
  assert.equal(learning.getSnapshot().attendance['81'], 'success');
  assert.deepEqual(learning.getSnapshot().pendingAttendance, {});
  app.advance(2000); assert.equal(app.backRequests, 1);
});

test('real ended and expired-session feedback use the same sheet without pretending to succeed', async () => {
  const ended = await realScreen(async () => ({ result: 'ended', message: '学校提示：活动已结束' }));
  ended.app.enter('0206'); await ended.app.flush();
  assert.ok(ended.app.find(node => node.type === 'Text' && node.props.children === '学校提示：活动已结束'));
  ended.app.advance(1000); ended.app.dismiss(); ended.app.transitionEnd(true);
  assert.deepEqual(activeRollcalls(ended.app.state).map(item => item.id), ['82']);
  const expired = await realScreen(async () => { throw Object.assign(Error('private'), { code: 'AUTH_REQUIRED' }); });
  expired.app.enter('0206'); await expired.app.flush();
  assert.ok(expired.app.find(node => node.type === 'Text' && node.props.children === '学校登录失效，请重新登录'));
  assert.equal(expired.app.find(node => node.props?.label === '重新签到'), undefined);
  assert.ok(expired.app.find(node => node.props?.label === '返回'));
});

test('invalid activity routes cannot run the demo submit path', async () => {
  const { app, answers } = await realScreen(undefined, 'number', 'missing');
  assert.equal(app.find(node => node.type === 'TextInput'), undefined);
  assert.ok(app.find(node => node.type === 'Text' && node.props.children === '签到不可用，请刷新后重试'));
  assert.equal(answers.length, 0);
});

test('real location obtains foreground permission and current coordinates before showing the school receipt', async () => {
  const calls = [];
  const position = { latitude: 24.441, longitude: 118.103, accuracy: 7, altitude: 18, altitudeAccuracy: null, heading: 0, speed: 0 };
  const { app, answers } = await realScreen(undefined, 'radar', '81', {
    requestForegroundPermissionsAsync: async () => { calls.push('permission'); return { granted: true }; },
    getCurrentPositionAsync: async options => { calls.push(options.accuracy); return { coords: position, timestamp: 123 }; },
  });
  const button = app.find(node => node.props?.label === '获取位置并签到');
  button.props.onPress(); button.props.onPress(); app.rerender();
  assert.ok(app.find(node => node.type === 'Text' && node.props.children === '正在获取位置'));
  await app.flush();
  assert.deepEqual(calls, ['permission', 4]);
  assert.deepEqual(answers, [{ id: '81', position }]);
  assert.ok(app.find(node => node.type === 'Text' && node.props.children === '学校确认签到成功'));
  assert.equal(activeRollcalls(app.state).length, 2);
  app.advance(1000); assert.equal(app.backRequests, 1);
  app.dismiss(); app.transitionEnd(true);
  assert.deepEqual(activeRollcalls(app.state).map(item => item.id), ['82']);
});

test('denied location permission and a failed location fix leave a retryable sheet without school writes', async () => {
  let granted = false, reads = 0;
  const { app, answers } = await realScreen(undefined, 'radar', '81', {
    requestForegroundPermissionsAsync: async () => ({ granted }),
    getCurrentPositionAsync: async () => { reads++; throw Error('private native location'); },
  });
  app.find(node => node.props?.label === '获取位置并签到').props.onPress(); await app.flush();
  assert.ok(app.find(node => node.type === 'Text' && node.props.children === '定位权限未允许，请在系统设置中允许定位后重试'));
  assert.equal(reads, 0); assert.equal(answers.length, 0);
  granted = true;
  app.find(node => node.props?.label === '获取位置并签到').props.onPress(); await app.flush();
  assert.ok(app.find(node => node.type === 'Text' && node.props.children === '无法获取当前位置，请确认系统定位已开启后重试'));
  assert.equal(reads, 1); assert.equal(answers.length, 0);
  assert.equal(activeRollcalls(app.state).length, 2);
});

test('leaving during permission or location lookup prevents a late location from submitting', async () => {
  for (const stage of ['permission', 'location']) for (const leave of ['close', 'blur', 'dismiss']) {
    let resolve, reads = 0;
    const pending = new Promise(done => { resolve = done; });
    const { app, answers } = await realScreen(undefined, 'radar', '81', {
      requestForegroundPermissionsAsync: async () => stage === 'permission' ? pending : { granted: true },
      getCurrentPositionAsync: async () => { reads++; return pending; },
    });
    app.find(node => node.props?.label === '获取位置并签到').props.onPress(); await app.flush();
    app[leave]();
    resolve(stage === 'permission' ? { granted: true } : { coords: { latitude: 24.441, longitude: 118.103, accuracy: 7, altitude: 18, altitudeAccuracy: null, heading: 0, speed: 0 } });
    await app.flush();
    assert.equal(answers.length, 0, stage + ' ' + leave);
    assert.equal(reads, stage === 'permission' ? 0 : 1);
    assert.equal(activeRollcalls(app.state).length, 2);
  }
});

test('preview location keeps simulated permission, receipt and dismissal usable without calling the device', () => {
  const app = screen('success', 'android', null, null, {}, 'radar');
  app.find(node => node.props?.label === '允许定位（模拟）').props.onPress(); app.rerender();
  app.find(node => node.props?.label === '确认模拟位置').props.onPress(); app.advance(650);
  assert.ok(app.find(node => node.type === 'Text' && node.props.children === '签到成功（模拟）'));
  assert.equal(activeRollcalls(app.state).length, 1);
  app.advance(1000); app.dismiss(); app.transitionEnd(true);
  assert.equal(activeRollcalls(app.state).length, 0);
});

test('QR camera result submits once, shows school feedback and removes only its entry after closing', async () => {
  const { app, answers } = await realScreen(undefined, 'qr');
  const scan = app.find(node => node.type === 'QrAttendance').props.onScan;
  scan('/j?p=4~%1029!3~++opaque%2B%2F%3D%1F%1E++');
  scan('{"rollcallId":81,"data":"duplicate frame"}');
  app.rerender();
  assert.equal(app.find(node => node.type === 'QrAttendance'), undefined, 'camera stops while the request is pending');
  assert.deepEqual(answers, [{ id: '81', data: '  opaque+/=~!  ' }]);
  await app.flush();
  assert.ok(app.find(node => node.type === 'Text' && node.props.children === '学校确认签到成功'));
  assert.equal(activeRollcalls(app.state).length, 2);
  app.advance(1000); app.dismiss(); app.transitionEnd(true);
  assert.deepEqual(activeRollcalls(app.state).map(item => item.id), ['82']);
});

test('wrong-activity QR stays retryable and closing rejects late camera callbacks', async () => {
  const { app, answers } = await realScreen(undefined, 'qr');
  app.find(node => node.type === 'QrAttendance').props.onScan('{"rollcallId":82,"data":"x"}');
  await app.flush();
  assert.equal(answers.length, 0);
  assert.ok(app.find(node => node.type === 'Text' && node.props.children === '二维码与当前签到活动不符'));
  app.find(node => node.props?.label === '重新签到').props.onPress(); app.rerender();
  const scan = app.find(node => node.type === 'QrAttendance').props.onScan;
  app.close(); scan('{"rollcallId":81,"data":"x"}'); await app.flush();
  assert.equal(answers.length, 0);
  app.dismiss(); app.transitionEnd(true);
  assert.equal(activeRollcalls(app.state).length, 2);
  const blurred = await realScreen(undefined, 'qr');
  const lateScan = blurred.app.find(node => node.type === 'QrAttendance').props.onScan;
  blurred.app.blur(); lateScan('{"rollcallId":81,"data":"x"}'); await blurred.app.flush();
  assert.equal(blurred.answers.length, 0);
});

test('a QR receipt during dismissal records the result without scheduling another navigation', async () => {
  let resolve;
  const reply = new Promise(done => { resolve = done; });
  const { app, learning } = await realScreen(() => reply, 'qr');
  app.find(node => node.type === 'QrAttendance').props.onScan('{"rollcallId":81,"data":"x"}');
  app.close();
  resolve({ result: 'success', message: '学校确认' }); await app.flush();
  app.advance(2000);
  assert.equal(app.backRequests, 1);
  app.dismiss(); app.transitionEnd(true);
  assert.equal(learning.getSnapshot().attendance['81'], 'success');
});


test('trial QR keeps the real camera and demo scan connected to local receipts without school writes', async () => {
  for (const input of ['camera', 'demo']) {
    const { learning, answers } = await realScreen();
    const id = 'trial-2000000-1';
    const saved = JSON.stringify({ version: 1, logs: [], events: [
      { id, method: 'qr', outcome: 'success', availableAt: 1, discoveredAt: 2, notifiedAt: 2 },
    ] });
    const app = screen('success', 'android', learning, id, {}, 'qr', saved);
    await app.flush();
    const camera = app.find(node => node.type === 'QrAttendance');
    assert.ok(camera, 'trial retains the actual camera component');
    camera.props.onScan(JSON.stringify({ rollcallId: '81', data: 'wrong activity' }));
    await app.flush();
    assert.equal(answers.length, 0);
    assert.ok(app.find(node => node.type === 'Text' && node.props.children === '模拟二维码与当前活动不符'));
    app.find(node => node.props?.label === '重新签到').props.onPress(); app.rerender();
    if (input === 'camera') app.find(node => node.type === 'QrAttendance').props.onScan(JSON.stringify({ rollcallId: id, data: ' opaque ' }));
    else app.find(node => node.props?.label === '模拟识别二维码').props.onPress();
    await app.flush();
    assert.equal(answers.length, 0);
    assert.ok(app.find(node => node.type === 'Text' && node.props.children === '签到成功（模拟）'));
    assert.equal(app.state.pendingAttendance[id], 'success');
    app.advance(1000); app.dismiss(); app.transitionEnd(true);
    assert.equal(app.state.attendance[id], 'success');
    assert.equal(activeRollcalls(app.state).some(item => item.id === id), false);
    assert.equal((await app.context.submitQr('trial-unknown', '{}')).result, 'failed');
    assert.equal(answers.length, 0);
  }
});

test('trial location uses actual location callbacks but isolates the simulated receipt from school writes', async () => {
  const { learning, answers } = await realScreen();
  const id = 'trial-3000000-1';
  const position = { latitude: 24.441, longitude: 118.103, accuracy: 7, altitude: null, altitudeAccuracy: null, heading: null, speed: null };
  const calls = [];
  const saved = JSON.stringify({ version: 1, logs: [], events: [
    { id, method: 'radar', outcome: 'success', availableAt: 1, discoveredAt: 2, notifiedAt: 2 },
  ] });
  const app = screen('success', 'android', learning, id, {
    requestForegroundPermissionsAsync: async () => { calls.push('permission'); return { granted: true }; },
    getCurrentPositionAsync: async () => { calls.push('position'); return { coords: position }; },
  }, 'radar', saved);
  await app.flush();
  assert.equal((await app.context.submitLocation(id, { ...position, latitude: NaN })).result, 'failed');
  app.find(node => node.props?.label === '获取位置并签到').props.onPress(); await app.flush();
  assert.deepEqual(calls, ['permission', 'position']);
  assert.equal(answers.length, 0);
  assert.ok(app.find(node => node.type === 'Text' && node.props.children === '签到成功（模拟）'));
  assert.equal(app.state.pendingAttendance[id], 'success');
  app.advance(1000); app.dismiss(); app.transitionEnd(true);
  assert.equal(app.state.attendance[id], 'success');
  assert.equal(activeRollcalls(app.state).some(item => item.id === id), false);
  assert.equal((await app.context.submitLocation('trial-unknown', position)).result, 'failed');
  assert.equal(answers.length, 0);
});


test('a covered QR sheet releases the camera and accepts a fresh scan when focused again', async () => {
  const { app, answers } = await realScreen(undefined, 'qr');
  const lateScan = app.find(node => node.type === 'QrAttendance').props.onScan;
  app.blur();
  assert.equal(app.find(node => node.type === 'QrAttendance'), undefined, 'covering the sheet unmounts the camera and its frame lock');
  lateScan('{"rollcallId":81,"data":"hidden frame"}'); await app.flush();
  assert.equal(answers.length, 0);
  app.focus();
  app.find(node => node.type === 'QrAttendance').props.onScan('{"rollcallId":81,"data":"fresh frame"}'); await app.flush();
  assert.deepEqual(answers, [{ id: '81', data: 'fresh frame' }]);
  assert.ok(app.find(node => node.type === 'Text' && node.props.children === '学校确认签到成功'));
});

test('focus restores location input without reviving old permission or location work or unlocking a newer request', async () => {
  const position = { latitude: 24.441, longitude: 118.103, accuracy: 7, altitude: null, altitudeAccuracy: null, heading: null, speed: null };
  for (const stage of ['permission', 'location']) for (const returned of ['before-focus', 'after-focus']) {
    let resolveOld, resolveFresh, permissions = 0, reads = 0;
    const old = new Promise(done => { resolveOld = done; });
    const fresh = new Promise(done => { resolveFresh = done; });
    const { app, answers } = await realScreen(undefined, 'radar', '81', {
      requestForegroundPermissionsAsync: async () => ++permissions === 1 && stage === 'permission' ? old : { granted: true },
      getCurrentPositionAsync: async () => ++reads === 1 && stage === 'location' ? old : fresh,
    });
    app.find(node => node.props?.label === '获取位置并签到').props.onPress(); await app.flush();
    app.blur();
    const oldValue = stage === 'permission' ? { granted: true } : { coords: position };
    if (returned === 'before-focus') { resolveOld(oldValue); await app.flush(); }
    app.focus();
    const retry = app.find(node => node.props?.label === '获取位置并签到');
    assert.ok(retry, stage + ' ' + returned + ' restores a usable sheet');
    retry.props.onPress(); await app.flush();
    if (returned === 'after-focus') { resolveOld(oldValue); await app.flush(); }
    assert.equal(answers.length, 0, 'cancelled work cannot submit after focus returns');
    assert.ok(app.find(node => node.type === 'Text' && node.props.children === '正在获取位置'));
    retry.props.onPress(); await app.flush();
    assert.equal(permissions, 2, 'an old finally cannot unlock the current location request');
    resolveFresh({ coords: position }); await app.flush();
    assert.deepEqual(answers, [{ id: '81', position }]);
    assert.equal(reads, stage === 'permission' ? 1 : 2);
    assert.ok(app.find(node => node.type === 'Text' && node.props.children === '学校确认签到成功'));
  }
});

test('submitted receipts remain visible after another sheet covers and uncovers each attendance method', async () => {
  for (const method of ['number', 'qr', 'radar']) for (const result of ['success', 'ended', 'failed']) {
    let resolve;
    const receipt = new Promise(done => { resolve = done; });
    const position = { latitude: 24.441, longitude: 118.103, accuracy: 7, altitude: null, altitudeAccuracy: null, heading: null, speed: null };
    const { app, answers, learning } = await realScreen(() => receipt, method, '81', {
      requestForegroundPermissionsAsync: async () => ({ granted: true }),
      getCurrentPositionAsync: async () => ({ coords: position }),
    });
    if (method === 'number') app.enter('0206');
    else if (method === 'qr') app.find(node => node.type === 'QrAttendance').props.onScan('{"rollcallId":81,"data":"valid"}');
    else app.find(node => node.props?.label === '获取位置并签到').props.onPress();
    await app.flush(); assert.equal(answers.length, 1);
    app.blur(); resolve({ result, message: '覆盖期间返回的学校回执' }); await app.flush();
    app.advance(2000); assert.equal(app.backRequests, 0, 'hidden receipt cannot close the covering sheet');
    app.transitionEnd(true); app.focus();
    assert.ok(app.find(node => node.type === 'Text' && node.props.children === '覆盖期间返回的学校回执'), method + ' ' + result);
    if (result === 'failed') {
      assert.ok(app.find(node => node.props?.label === '重新签到'));
      app.advance(2000); assert.equal(app.backRequests, 0);
    } else {
      assert.equal(learning.getSnapshot().pendingAttendance['81'], result, 'covering another sheet cannot consume this receipt');
      app.advance(999); assert.equal(app.backRequests, 0);
      app.advance(1); assert.equal(app.backRequests, 1);
    }
  }
});

test('a result timer pauses while covered and manual closing cannot navigate a second time', async () => {
  for (const result of ['success', 'ended']) {
    const { app } = await realScreen(async () => ({ result, message: '学校回执' }));
    app.enter('0206'); await app.flush(); app.advance(450);
    app.blur(); app.advance(1000);
    assert.equal(app.backRequests, 0, 'the old timer cannot pop the newer sheet');
    app.focus(); app.advance(999); assert.equal(app.backRequests, 0);
    app.close(); app.advance(2000);
    assert.equal(app.backRequests, 1, 'manual close wins over the restored result timer');
  }
});

test('covered trial receipts keep the simulated result and never write to school', async () => {
  const { learning, answers } = await realScreen();
  const id = 'trial-4000000-1';
  const app = screen('success', 'android', learning, id, {}, 'number', JSON.stringify({ version: 1, logs: [], events: [
    { id, method: 'number', outcome: 'success', availableAt: 1, discoveredAt: 2, notifiedAt: 2 },
  ] }));
  await app.flush(); app.enter('0206'); app.blur(); await app.flush();
  app.advance(2000); assert.equal(app.backRequests, 0);
  app.transitionEnd(true); app.focus();
  assert.ok(app.find(node => node.type === 'Text' && node.props.children === '签到成功（模拟）'));
  assert.equal(app.state.pendingAttendance[id], 'success', 'the underlying trial sheet is still open');
  app.advance(1000); assert.equal(app.backRequests, 1);
  app.nativeDismiss(); assert.equal(app.state.attendance[id], 'success');
  assert.equal(answers.length, 0);
});

test('installed native-stack dismissal consumes school and trial receipts for each method and close action', async () => {
  const position = { latitude: 24.441, longitude: 118.103, accuracy: 7, altitude: null, altitudeAccuracy: null, heading: null, speed: null };
  const location = { requestForegroundPermissionsAsync: async () => ({ granted: true }), getCurrentPositionAsync: async () => ({ coords: position }) };
  for (const trial of [false, true]) for (const method of ['number', 'qr', 'radar']) for (const close of ['auto', 'manual', 'gesture', 'system-back']) {
    const live = await realScreen(undefined, method, '81', location);
    const id = trial ? 'trial-5000000-1' : '81';
    const app = trial ? screen('success', 'android', live.learning, id, location, method, JSON.stringify({ version: 1, logs: [], events: [
      { id, method, outcome: 'success', availableAt: 1, discoveredAt: 2, notifiedAt: 2 },
    ] })) : live.app;
    await app.flush();
    if (method === 'number') app.enter('0206');
    else if (method === 'qr') app.find(node => node.type === 'QrAttendance').props.onScan(JSON.stringify({ rollcallId: id, data: 'valid' }));
    else app.find(node => node.props?.label === '获取位置并签到').props.onPress();
    await app.flush();
    assert.equal(app.state.pendingAttendance[id], 'success');
    assert.ok(activeRollcalls(app.state).some(item => item.id === id), 'keep the card while its successful receipt is open');
    if (close === 'auto') app.advance(1000);
    if (close === 'manual') app.close();
    app.nativeDismiss(close === 'gesture');
    assert.equal(app.state.attendance[id], 'success', [trial, method, close].join(' '));
    assert.deepEqual(Object.keys(app.state.pendingAttendance), []);
    assert.equal(activeRollcalls(app.state).some(item => item.id === id), false, 'closed successful sheet must not leave an unavailable card');
    app.advance(2000);
    assert.equal(app.backRequests, close === 'auto' || close === 'manual' ? 1 : 0, 'native dismissal cannot schedule a second back');
    if (trial) assert.equal(live.answers.length, 0);
  }
});

test('a trial receipt saved after native dismissal updates its card without reopening the sheet', async () => {
  const { learning, answers } = await realScreen();
  const id = 'trial-6000000-1';
  let finishSave;
  const saved = new Promise(resolve => { finishSave = resolve; });
  const app = screen('success', 'android', learning, id, {}, 'number', JSON.stringify({ version: 1, logs: [], events: [
    { id, method: 'number', outcome: 'success', availableAt: 1, discoveredAt: 2, notifiedAt: 2 },
  ] }), { save: () => saved });
  await app.flush(); app.enter('0206'); await app.flush();
  app.nativeDismiss(true);
  assert.equal(app.state.attendance[id], undefined);
  finishSave(); await app.flush();
  assert.equal(app.state.attendance[id], 'success');
  assert.deepEqual(Object.keys(app.state.pendingAttendance), []);
  app.advance(2000); assert.equal(app.backRequests, 0);
  assert.equal(answers.length, 0);
});
