import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Keyboard, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useIsFocused, useLocalSearchParams, useNavigation } from 'expo-router';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDemo } from '@/demo-context';
import { canAttend } from '@/demo-state';
import { DEMO_CODE, cleanCode, codeResult, courseFor, type AttendanceResult } from '@/demo-data';
import { Button, Icon, Tap, c, goBack, s } from '@/ui';
import { AttendanceMark } from '@/status-motion';
import { QrAttendance } from '@/qr-attendance';

type Phase = 'input' | 'locating' | 'submitting' | AttendanceResult;
export default function Attendance() {
  const { state, dispatch, real, data, submitNumber, submitQr, submitLocation } = useDemo();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const navigation = useNavigation();
  const focused = useIsFocused();
  const rollcall = id ? state.rollcalls.find(item => item.id === id) : state.rollcalls.at(-1);
  const rollcallId = rollcall?.id ?? '';
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<Phase>(state.pendingAttendance[rollcallId] ?? state.attendance[rollcallId] ?? 'input');
  const [message, setMessage] = useState('');
  const [permission, setPermission] = useState<'undecided' | 'denied' | 'granted'>('undecided');
  const field = useRef<ComponentRef<typeof TextInput>>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const closing = useRef(false);
  const locationRequest = useRef<{ cancelled: boolean } | null>(null);
  const overlay = Platform.OS === 'web';
  const busy = phase === 'submitting' || phase === 'locating';
  const eligible = canAttend(state, rollcallId) && (!real || (data.authenticated && !data.loggingIn));
  const method = rollcall?.method ?? 'number';
  const panelHeight = method === 'number' ? phase === 'failed' ? 316 : 256 : 408;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      // Web removes this overlay immediately; native completion uses the stack host transition event.
      if (Platform.OS === 'web') dispatch({ type: 'attendance-dismissed', ids: [rollcallId] });
    };
  }, [dispatch, rollcallId]);
  useEffect(() => navigation.addListener('blur', () => {
    const request = locationRequest.current;
    if (!request) return;
    request.cancelled = true; locationRequest.current = null;
    busyRef.current = false; setPhase('input');
  }), [navigation]);
  useEffect(() => {
    if (!focused || closing.current || phase !== 'success' && phase !== 'ended') return;
    const timeout = setTimeout(close, 1000);
    return () => clearTimeout(timeout);
  }, [phase, focused, navigation]);

  function close() {
    if (!mounted.current || closing.current || !navigation.isFocused()) return;
    closing.current = true; goBack();
  }

  function finish(result: AttendanceResult, feedback = '') {
    if (!mounted.current || closing.current) return;
    busyRef.current = false;
    timer.current = null;
    setPhase(result);
    setMessage(feedback);
    if (!real) dispatch({ type: 'attendance-result', id: rollcallId, result });
  }
  async function locate() {
    if (!mounted.current || !navigation.isFocused() || !eligible || busyRef.current || phase !== 'input' || closing.current) return;
    const request = { cancelled: false };
    locationRequest.current = request;
    busyRef.current = true;
    setPhase('locating'); setMessage('');
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!mounted.current || closing.current || request.cancelled) return;
      if (!permission.granted) {
        setPhase('input');
        setMessage('定位权限未允许，请在系统设置中允许定位后重试');
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      if (!mounted.current || closing.current || request.cancelled) return;
      locationRequest.current = null;
      setPhase('submitting');
      const receipt = await submitLocation(rollcallId, position.coords);
      finish(receipt.result, receipt.message);
    } catch {
      if (mounted.current && !closing.current && !request.cancelled) {
        setPhase('input');
        setMessage('无法获取当前位置，请确认系统定位已开启后重试');
      }
    } finally {
      if (!request.cancelled) { locationRequest.current = null; busyRef.current = false; }
    }
  }
  function submit(value?: string) {
    if (!mounted.current || closing.current || !navigation.isFocused() || !eligible || busyRef.current || phase === 'ended' || phase === 'success') return;
    if (real) {
      const input = value ?? code;
      if (method !== 'number' && method !== 'qr' || method === 'number' && !/^\d{4}$/.test(input)) return;
      busyRef.current = true;
      Keyboard.dismiss();
      setPhase('submitting');
      void (method === 'qr' ? submitQr(rollcallId, input) : submitNumber(rollcallId, input)).then(receipt => finish(receipt.result, receipt.message));
      return;
    }
    const outcome = rollcall?.outcome ?? 'failed';
    const result = method === 'number' ? codeResult(value ?? code, outcome) : outcome;
    if (result === 'incomplete') return;
    busyRef.current = true;
    Keyboard.dismiss();
    setPhase('submitting');
    timer.current = setTimeout(() => finish(result), 650);
  }
  function enterCode(input: string) {
    if (busyRef.current || busy || !eligible || phase !== 'input') return;
    const next = cleanCode(input);
    setCode(next);
    setPhase('input');
    if (next.length === 4) submit(next);
  }
  function resetInput() {
    setCode(''); setPhase('input'); setMessage('');
    if (method === 'number') field.current?.focus();
  }
  return <View style={overlay ? [a.root, a.overlay] : { height: panelHeight + 12, backgroundColor: '#fcf8fc' }}>
    {overlay && <Tap label="关闭签到遮罩" onPress={close} style={StyleSheet.absoluteFill} />}
    <View accessibilityViewIsModal role={overlay ? 'dialog' : undefined} style={[a.panel, { height: panelHeight, maxHeight: overlay ? '88%' : undefined, borderTopLeftRadius: 30, borderTopRightRadius: 30, overflow: 'hidden', paddingTop: 8, paddingBottom: overlay ? Math.max(insets.bottom, 12) : 12 }]}>
      <View style={a.header}><Text accessibilityRole="header" style={a.course}>{rollcall ? rollcall.title ?? courseFor(rollcall.courseId, state.longText)?.title ?? '签到活动' : '签到不可用'}</Text><Tap label="关闭签到" onPress={close} style={s.iconButton}><Icon name="close" size={21} /></Tap></View>
      <ScrollView bounces alwaysBounceVertical overScrollMode="always" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={a.content}>
        {phase === 'success' || busy ? <View accessibilityLiveRegion="polite" style={a.result}>
          <AttendanceMark success={phase === 'success'} />
          <Text style={[s.rowLabel, { textAlign: 'center' }]}>{phase === 'success' ? real ? message || '签到成功' : '签到成功（模拟）' : phase === 'locating' ? '正在获取位置' : '签到中'}</Text>
        </View> : phase === 'ended' ? <View style={a.result}><Icon name="time-outline" size={34} /><Text style={s.rowLabel}>{message || '签到已结束'}</Text></View>
        : phase === 'failed' ? <View style={a.result}><Icon name="close-circle-outline" size={38} color={c.red} /><Text accessibilityRole="alert" style={[s.rowLabel, { textAlign: 'center' }]}>{message || (method === 'number' && code !== DEMO_CODE ? '签到码不正确' : '签到失败，请重试')}</Text><Button secondary label={eligible ? '重新签到' : '返回'} onPress={eligible ? resetInput : close} /></View>
        : !eligible ? <View style={a.result}><Icon name="close-circle-outline" size={38} color={c.red} /><Text style={s.rowLabel}>{real && data.needsLogin ? '学校登录失效，请重新登录' : '签到不可用，请刷新后重试'}</Text><Button secondary label="返回" onPress={close} /></View>
        : method === 'number' ? <>
          <TextInput ref={field} value={code} onChangeText={enterCode} accessibilityLabel={real ? '四位签到码' : '四位演示签到码'} testID="attendance-code" inputMode="numeric" keyboardType="number-pad" maxLength={4} autoFocus={Platform.OS !== 'web'} selectTextOnFocus autoComplete="off" placeholder="····" placeholderTextColor="#888888" selectionColor={c.accent} style={a.code} />
          <Text style={a.hint}>{real ? '输入四位签到码后自动提交' : `演示码 ${DEMO_CODE}`}</Text>
        </> : real && method === 'radar' ? <>
          <View style={a.scanner}><Icon name="locate-outline" size={76} color="#a08bad" /></View>
          <Button label="获取位置并签到" onPress={() => void locate()} />
          <Text accessibilityRole={message ? 'alert' : undefined} style={a.hint}>{message || '获取设备当前位置后提交到本次签到'}</Text>
        </> : real && method === 'qr' ? <>
          {focused && <QrAttendance onScan={submit} />}
        </> : <>
          <View style={a.scanner}><Icon name={method === 'qr' ? 'scan-outline' : 'locate-outline'} size={76} color="#a08bad" /></View>
          {permission === 'granted' ? <Button label={method === 'qr' ? '读取演示二维码' : '确认模拟位置'} onPress={() => submit()} />
          : <><Button label={permission === 'denied' ? '重新允许（模拟）' : method === 'qr' ? '允许相机（模拟）' : '允许定位（模拟）'} onPress={() => setPermission('granted')} />{permission === 'undecided' ? <Tap label="暂不允许" onPress={() => setPermission('denied')} style={a.skip}><Text style={s.small}>暂不允许</Text></Tap> : <Text style={a.hint}>权限未允许</Text>}</>}
        </>}
      </ScrollView>
    </View>
  </View>;
}
const a = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fcf8fc' },
  overlay: { backgroundColor: 'rgba(52,37,65,.22)', justifyContent: 'flex-end' },
  panel: { backgroundColor: '#fcf8fc' },
  header: { paddingLeft: 24, paddingRight: 14, minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12 },
  course: { flex: 1, fontSize: 18, lineHeight: 26, color: c.ink, fontWeight: '600' },
  content: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 12, gap: 12 },
  code: { minHeight: 82, borderRadius: 22, borderWidth: 1, borderColor: '#e4d9eb', backgroundColor: '#f1eaf6', color: c.ink, textAlign: 'center', fontSize: 36, letterSpacing: 17, paddingLeft: 17, fontVariant: ['tabular-nums'] },
  hint: { fontSize: 12, color: c.muted, lineHeight: 18, textAlign: 'center' },
  result: { alignItems: 'center', justifyContent: 'center', gap: 14, minHeight: 150 },
  scanner: { height: 160, borderRadius: 24, backgroundColor: '#f1eaf6', justifyContent: 'center', alignItems: 'center' },
  skip: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 22 },
});
