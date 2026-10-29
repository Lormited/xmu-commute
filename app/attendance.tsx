import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Keyboard, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDemo } from '@/demo-context';
import { canAttend } from '@/demo-state';
import { DEMO_CODE, cleanCode, codeResult, courseFor, type AttendanceResult } from '@/demo-data';
import { Button, Icon, Tap, c, goBack, s } from '@/ui';
import { AttendanceMark } from '@/status-motion';

type Phase = 'input' | 'submitting' | AttendanceResult;
export default function Attendance() {
  const { state, dispatch } = useDemo();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const rollcall = id ? state.rollcalls.find(item => item.id === id) : state.rollcalls.at(-1);
  const rollcallId = rollcall?.id ?? '';
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<Phase>(state.attendance[rollcallId] ?? 'input');
  const [permission, setPermission] = useState<'undecided' | 'denied' | 'granted'>('undecided');
  const field = useRef<ComponentRef<typeof TextInput>>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyRef = useRef(false);
  const overlay = Platform.OS === 'web';
  const busy = phase === 'submitting';
  const eligible = canAttend(state, rollcallId);
  const method = rollcall?.method ?? 'number';
  const panelHeight = method === 'number' ? phase === 'failed' ? 316 : 256 : 408;
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  useEffect(() => {
    if (phase !== 'success' && phase !== 'ended') return;
    const close = setTimeout(goBack, 1000);
    return () => clearTimeout(close);
  }, [phase]);

  function finish(result: AttendanceResult) {
    busyRef.current = false;
    timer.current = null;
    setPhase(result);
    dispatch({ type: 'attendance', id: rollcallId, result });
  }
  function submit(value?: string) {
    if (!eligible || busyRef.current || phase === 'ended' || phase === 'success') return;
    const outcome = rollcall?.outcome ?? 'failed';
    const result = method === 'number' ? codeResult(value ?? code, outcome) : outcome;
    if (result === 'incomplete') return;
    busyRef.current = true;
    Keyboard.dismiss();
    setPhase('submitting');
    timer.current = setTimeout(() => finish(result), 650);
  }
  function enterCode(input: string) {
    if (busy || !eligible || phase !== 'input') return;
    const next = cleanCode(input);
    setCode(next);
    setPhase('input');
    if (next.length === 4) submit(next);
  }
  function resetInput() {
    setCode(''); setPhase('input');
    if (method === 'number') field.current?.focus();
  }
  return <View style={overlay ? [a.root, a.overlay] : { height: panelHeight + 12, backgroundColor: '#fcf8fc' }}>
    {overlay && <Tap label="关闭签到遮罩" onPress={goBack} style={StyleSheet.absoluteFill} />}
    <View accessibilityViewIsModal role={overlay ? 'dialog' : undefined} style={[a.panel, { height: panelHeight, maxHeight: overlay ? '88%' : undefined, borderTopLeftRadius: 30, borderTopRightRadius: 30, overflow: 'hidden', paddingTop: 8, paddingBottom: overlay ? Math.max(insets.bottom, 12) : 12 }]}>
      <View style={a.header}><Text accessibilityRole="header" style={a.course}>{rollcall ? courseFor(rollcall.courseId, state.longText)!.title : '签到不可用'}</Text><Tap label="关闭签到" onPress={goBack} style={s.iconButton}><Icon name="close" size={21} /></Tap></View>
      <ScrollView bounces alwaysBounceVertical overScrollMode="always" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={a.content}>
        {phase === 'success' || busy ? <View accessibilityLiveRegion="polite" style={a.result}>
          <AttendanceMark success={phase === 'success'} />
          <Text style={s.rowLabel}>{phase === 'success' ? '签到成功（模拟）' : '签到中'}</Text>
        </View> : phase === 'ended' ? <View style={a.result}><Icon name="time-outline" size={34} /><Text style={s.rowLabel}>签到已结束</Text></View>
        : !eligible ? <View style={a.result}><Icon name="close-circle-outline" size={38} color={c.red} /><Text style={s.rowLabel}>签到失败</Text><Button secondary label="返回" onPress={goBack} /></View>
        : phase === 'failed' ? <View style={a.result}><Icon name="close-circle-outline" size={38} color={c.red} /><Text accessibilityRole="alert" style={s.rowLabel}>{method === 'number' && code !== DEMO_CODE ? '签到码不正确' : '签到失败，请重试'}</Text><Button secondary label="重新签到" onPress={resetInput} /></View>
        : method === 'number' ? <>
          <TextInput ref={field} value={code} onChangeText={enterCode} accessibilityLabel="四位演示签到码" testID="attendance-code" inputMode="numeric" keyboardType="number-pad" maxLength={4} autoFocus={Platform.OS !== 'web'} selectTextOnFocus autoComplete="off" placeholder="····" placeholderTextColor="#888888" selectionColor={c.accent} style={a.code} />
          <Text style={a.hint}>演示码 {DEMO_CODE}</Text>
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
