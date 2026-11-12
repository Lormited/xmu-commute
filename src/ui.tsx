import { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View, type AccessibilityRole, type AccessibilityState, type StyleProp, type TextProps, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDemo } from './demo-context';
import { type Resource } from './demo-state';
import { type Todo } from './demo-data';
import { usePressGuard } from './press-guard';
import { PageScroll, PageScrollContext } from './page-scroll';
import { DrawnCheck } from './status-motion';

export const c = { ink: '#343434', secondary: '#555555', muted: '#666666', accent: '#5f5f5f', icon: '#8c7c9b', pale: '#eee7f4', line: 'rgba(185,171,196,0.18)', green: '#648b73', red: '#ae6565', amber: '#8b6d42' };
export type IconName = keyof typeof Ionicons.glyphMap;
export function Icon({ name, size = 21, color = c.icon }: { name: IconName; size?: number; color?: string }) {
  return <Ionicons name={name} size={size} color={color} />;
}
export function Tap({ children, onPress, label, style, disabled = false, testID, hitSlop = 4, role = 'button', accessibilityState }: {
  children?: ReactNode; onPress: () => void; label?: string; style?: StyleProp<ViewStyle>; disabled?: boolean; testID?: string; hitSlop?: number; role?: AccessibilityRole; accessibilityState?: AccessibilityState;
}) {
  const guard = usePressGuard(onPress);
  return <Pressable {...guard} testID={testID} accessibilityRole={role} accessibilityLabel={label} accessibilityState={{ ...accessibilityState, disabled }} aria-selected={accessibilityState?.selected} aria-checked={accessibilityState?.checked} aria-busy={accessibilityState?.busy} disabled={disabled} hitSlop={hitSlop} pressRetentionOffset={8} style={[style, { opacity: disabled ? 0.4 : 1 }]}>{children}</Pressable>;
}
export function Glass({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.glass, style]}>{Platform.OS === 'ios' && <BlurView pointerEvents="none" intensity={24} tint="light" style={StyleSheet.absoluteFill} />}{children}</View>;
}
export function Background() {
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', overflow: 'hidden' }]}><LinearGradient colors={['#dfd5e9', '#ecd8e3', '#f8f1f4', '#fff']} locations={[0, 0.35, 0.72, 1]} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 660 }} /></View>;
}
function Page({ children, tab = false, resource, title, back = false, headerAction, titleProps, scroll = true, headerGap = 24 }: {
  children: ReactNode; tab?: boolean; resource?: Resource; title: string; back?: boolean; headerAction?: ReactNode; titleProps?: TextProps; scroll?: boolean; headerGap?: number;
}) {
  const insets = useSafeAreaInsets();
  const demo = useDemo();
  const { state, reducedMotion, real, data } = demo;
  const history = real && resource === 'history';
  const refresh = history ? demo.refreshHistory : demo.refresh;
  const refreshing = history ? data.historyRefreshing : demo.refreshing;
  const message = history ? data.historyMessage : data.message;
  const syncResult = history ? (message ? 'offline' : null) : demo.syncResult;
  const enabled = Boolean(tab || resource) && state.loggedIn;
  const signingIn = real && data.loggingIn;
  const pull = useSharedValue(0);
  const rotation = useSharedValue(0);
  const result = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(rotation);
    if (refreshing && !reducedMotion) rotation.set(withRepeat(withTiming(rotation.get() + 360, { duration: 850, easing: Easing.linear }), -1));
    else if (!syncResult) rotation.set(withTiming(0, { duration: reducedMotion ? 0 : 180 }));
    result.set(withTiming(syncResult ? 1 : 0, { duration: reducedMotion ? 0 : 160 }));
    return () => cancelAnimation(rotation);
  }, [refreshing, reducedMotion, syncResult, rotation, result]);
  const iconStyle = useAnimatedStyle(() => ({ opacity: 1 - result.get(), transform: [{ rotate: (reducedMotion ? 0 : rotation.get()) + 'deg' }, { scale: reducedMotion ? 1 : 1 - result.get() * 0.12 }] }));
  const resultStyle = useAnimatedStyle(() => ({ position: 'absolute', opacity: result.get() }));
  return <View style={{ flex: 1, backgroundColor: '#fff' }}><Background />
    <View style={[s.between, { marginHorizontal: back ? 18 : 24, marginTop: Math.max(insets.top, 12), marginBottom: headerGap, minHeight: 48, gap: 8 }]}>
      <View style={[s.inline, { flex: 1, gap: 8 }]}>{back && <Tap label="返回" onPress={goBack} style={s.iconButton}><Icon name="chevron-back" size={22} /></Tap>}<Text accessibilityRole="header" {...titleProps} style={[s.headerTitle, { flexShrink: 1 }]}>{title}</Text></View>
      {headerAction}
      {enabled && <Tap label={history ? (refreshing ? '正在刷新历史签到' : '刷新历史签到') : refreshing ? '正在同步所有学习数据' : syncResult === 'success' ? '同步成功，再次同步' : syncResult === 'offline' ? '无网络，保留现有数据，重新同步' : '同步所有学习数据'} accessibilityState={{ busy: refreshing }} disabled={signingIn} onPress={refresh} style={[s.iconButton, { backgroundColor: 'transparent' }]}>
        <Animated.View style={iconStyle}><Icon name="sync-outline" size={23} /></Animated.View>
        <Animated.View style={resultStyle}>{syncResult === 'offline' ? <Icon name="cloud-offline-outline" size={23} color={c.amber} /> : <DrawnCheck active={syncResult === 'success'} size={25} />}</Animated.View>
      </Tap>}
    </View>
    <Text accessibilityLiveRegion="polite" style={[s.small, signingIn || (real && message) ? { marginHorizontal: 24, marginBottom: 12, color: signingIn ? c.secondary : c.amber } : s.srStatus]}>{signingIn ? '正在登录' : real && message ? message : refreshing ? '同步中' : syncResult === 'success' ? '已更新' : syncResult === 'offline' ? '无网络，保留现有数据' : ''}</Text>
    <PageScrollContext.Provider value={{ tab, enabled, pull, rotation, refresh, refreshing }}>{scroll ? <PageScroll>{children}</PageScroll> : <View style={{ flex: 1 }}>{children}</View>}</PageScrollContext.Provider>
  </View>;
}
export function Screen(props: { children: ReactNode; tab?: boolean; resource?: Resource; title: string; headerAction?: ReactNode; titleProps?: TextProps; back?: boolean; scroll?: boolean; headerGap?: number }) {
  return <Page {...props} />;
}
export function goBack() { if (router.canGoBack()) router.back(); else router.replace('/'); }
export function DetailScreen({ title, children, resource }: { title: string; children: ReactNode; resource?: Resource }) {
  return <Page back title={title} resource={resource}><View style={{ paddingHorizontal: 24, gap: 20 }}>{children}</View></Page>;
}
export function SheetScreen({ title, children, height = 332 }: { title: string; children: ReactNode; height?: number }) {
  const insets = useSafeAreaInsets();
  const overlay = Platform.OS === 'web';
  return <View style={overlay ? { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(52,37,65,.22)' } : { height: height + 8, backgroundColor: '#fcf8fc' }}>
    {overlay && <Tap label={'关闭' + title + '遮罩'} onPress={goBack} style={StyleSheet.absoluteFill} />}
    <View accessibilityViewIsModal role={overlay ? 'dialog' : undefined} style={{ height, maxHeight: overlay ? '88%' : undefined, borderTopLeftRadius: 30, borderTopRightRadius: 30, overflow: 'hidden', backgroundColor: '#fcf8fc' }}>
      <View style={[s.between, { paddingLeft: 24, paddingRight: 14, minHeight: 68 }]}><Text accessibilityRole="header" style={s.headerTitle}>{title}</Text><Tap label={'关闭' + title} onPress={goBack} style={s.iconButton}><Icon name="close" /></Tap></View>
      <Animated.ScrollView bounces alwaysBounceVertical overScrollMode="always" contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 4, paddingBottom: Math.max(insets.bottom, 20), gap: 9 }}>{children}</Animated.ScrollView>
    </View>
  </View>;
}
export function Section({ title, action, onPress }: { title: string; action?: string; onPress?: () => void }) {
  return <View style={[s.between, { marginHorizontal: 24, marginBottom: 14, minHeight: 26, gap: 8 }]}><Text accessibilityRole="header" style={s.sectionTitle}>{title}</Text>{action && onPress && <Tap onPress={onPress} label={action} hitSlop={9} style={[s.inline, { minHeight: 30 }]}><Text style={s.actionText}>{action}</Text><Icon name="chevron-forward" size={13} color="#93859f" /></Tap>}</View>;
}
export function Button({ label, onPress, secondary = false, disabled = false, icon, busy = false }: { label: string; onPress: () => void; secondary?: boolean; disabled?: boolean; icon?: IconName; busy?: boolean }) {
  return <Tap label={label} onPress={onPress} disabled={disabled || busy} style={[s.button, secondary && s.secondaryButton]}>
    {busy ? <ActivityIndicator color={c.accent} /> : icon && <Icon name={icon} color={c.accent} size={19} />}
    <Text style={s.buttonText}>{label}</Text>
  </Tap>;
}
export function Badge({ children }: { children: ReactNode }) {
  return <View style={s.badge}><Text style={{ fontSize: 11, fontWeight: '500', color: c.secondary, lineHeight: 17 }}>{children}</Text></View>;
}
export function Note({ children, tone = 'neutral', action, onPress }: { children: ReactNode; tone?: 'neutral' | 'warning' | 'success'; action?: string; onPress?: () => void }) {
  const color = tone === 'warning' ? c.amber : tone === 'success' ? c.green : c.muted;
  return <View style={[s.note, { backgroundColor: tone === 'warning' ? '#faf3e8' : tone === 'success' ? '#edf4ef' : '#f5eff8' }]}><View style={[s.inline, { alignItems: 'flex-start', gap: 9 }]}><Icon name={tone === 'success' ? 'checkmark-circle-outline' : 'information-circle-outline'} color={color} size={18} /><Text selectable style={{ flex: 1, fontSize: 13, lineHeight: 21, color: c.secondary }}>{children}</Text></View>{action && onPress && <Tap onPress={onPress} label={action} style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: 27 }}><Text style={s.actionText}>{action} →</Text></Tap>}</View>;
}
export function ResourceBlock({ resource, children, emptyTitle, emptyDescription, showEmptyState = true }: { resource: Resource; children: ReactNode; emptyTitle: string; emptyDescription?: string; showEmptyState?: boolean }) {
  const { state, refresh, refreshing, real, data, login } = useDemo();
  const status = real ? (resource === 'lnt' && data.todos.length) || (resource === 'courses' && data.courses.length) || (resource === 'jw' && data.schedule?.rows.length) || (resource === 'history' && data.history.length) ? 'ready' : resource === 'history' && data.historyRefreshing ? 'loading' : 'empty' : state.load;
  if (!state.loggedIn) return <StateCard icon="lock-closed-outline" title="登录后查看学习数据" action="学校统一登录" busy={real && data.loggingIn} onPress={login} />;
  if (status === 'loading') return <Glass style={{ marginHorizontal: 24, padding: 24, gap: 18 }}><View style={s.inline}><ActivityIndicator color={c.accent} /><Text accessibilityLiveRegion="polite" style={s.body}>正在加载</Text></View>{[1, 0.75, 0.45].map((size, i) => <View key={i} style={{ height: 14, width: (size * 100 + '%') as '100%', borderRadius: 7, backgroundColor: '#e9e1ed' }} />)}{!real && <Button secondary label="完成加载演示" onPress={refresh} busy={refreshing} />}</Glass>;
  if (status === 'empty' && showEmptyState) return <StateCard icon={resource === 'jw' ? 'sunny-outline' : 'file-tray-outline'} title={emptyTitle} description={emptyDescription} />;
  return <>{children}</>;
}
export function StateCard({ icon, title, description, action, onPress, busy }: { icon: IconName; title: string; description?: string; action?: string; onPress?: () => void; busy?: boolean }) {
  return <Glass style={{ marginHorizontal: 24, padding: 24, gap: 16 }}><View style={s.bigIcon}><Icon name={icon} color={c.accent} size={28} /></View><Text accessibilityRole="header" style={s.cardTitle}>{title}</Text>{description && <Text selectable style={s.body}>{description}</Text>}{action && onPress && <Button secondary label={action} onPress={onPress} busy={busy} />}</Glass>;
}
export function RowGroup({ children }: { children: ReactNode }) {
  const { state } = useDemo();
  return <View style={state.listStyle === 'group' ? s.groupList : { gap: state.listStyle === 'soft' ? 8 : 0 }}>{children}</View>;
}
function useRowStyle() {
  const { state } = useDemo();
  return { variant: state.listStyle, rowStyle: state.listStyle === 'soft' ? s.softRow : undefined };
}
export function TodoRow({ todo, last = false, flushTop = false }: { todo: Todo; last?: boolean; flushTop?: boolean }) {
  const { variant, rowStyle } = useRowStyle();
  const style = [s.todoRow, rowStyle, flushTop && variant === 'space' && { paddingTop: 0, minHeight: 61 }];
  const content = <>
    <View style={s.todoIcon}><Icon name="document-text-outline" size={21} color="#8b759f" /></View>
    <View style={{ flex: 1, minWidth: 0, gap: 5 }}><Text style={s.todoTitle} numberOfLines={1}>{todo.title}</Text><Text style={s.todoMeta} numberOfLines={1}>{todo.course} · {todo.deadline ?? '未设截止时间'}</Text></View>
    {variant === 'group' && !last && <View style={s.insetRule} />}
  </>;
  return <View accessible accessibilityLabel={todo.title + '，' + todo.course + '，' + (todo.deadline ?? '未设置截止时间')} style={style}>{content}</View>;
}
export function SettingRow({ icon, title, value, onPress, danger = false, trailing, last = false }: { icon: IconName; title: string; value?: string; onPress?: () => void; danger?: boolean; trailing?: ReactNode; last?: boolean }) {
  const { variant, rowStyle } = useRowStyle();
  const content = <><Icon name={icon} color={danger ? c.red : c.icon} /><Text style={s.settingLabel}>{title}</Text>{value && <Text style={s.settingValue} numberOfLines={1}>{value}</Text>}{trailing ?? (onPress && <Icon name="chevron-forward" size={15} color="#b9b2c1" />)}{variant === 'group' && !last && <View style={s.insetRule} />}</>;
  return onPress ? <Tap label={title} onPress={onPress} style={[s.settingRow, rowStyle]}>{content}</Tap> : <View style={[s.settingRow, rowStyle]}>{content}</View>;
}
export function Choice({ title, description, selected, onPress }: { title: string; description?: string; selected: boolean; onPress: () => void }) {
  return <Tap onPress={onPress} role="radio" label={title} accessibilityState={{ checked: selected }} style={[s.choice, selected && { backgroundColor: '#ece3f1', borderColor: '#d6c8df' }]}><View style={{ flex: 1, gap: 5 }}><Text style={s.todoTitle}>{title}</Text>{description && <Text style={s.small}>{description}</Text>}</View><Icon name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={selected ? c.accent : '#b6a8bf'} /></Tap>;
}
export function Segments({ labels, index, onChange }: { labels: readonly string[]; index: number; onChange: (index: number) => void }) {
  return <View style={{ flexDirection: 'row', padding: 5, borderRadius: 22, backgroundColor: 'rgba(224,211,231,.65)', gap: 5 }}>
    {labels.map((label, value) => <Tap key={label} role="tab" label={label} accessibilityState={{ selected: index === value }} onPress={() => onChange(value)} style={{ flex: 1, minHeight: 44, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: index === value ? '#fff9ff' : 'transparent' }}><Text style={{ fontSize: 14, lineHeight: 20, color: c.ink, fontWeight: index === value ? '600' : '400' }}>{label}</Text></Tap>)}
  </View>;
}
export const s = StyleSheet.create({
  inline: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  glass: { backgroundColor: 'rgba(255,255,255,0.52)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.85)', borderRadius: 28, borderCurve: 'continuous', overflow: 'hidden', boxShadow: '0 7px 20px rgba(83,55,95,0.055)' },
  headerTitle: { fontSize: 20, fontWeight: '600', color: c.ink, lineHeight: 29 },
  srStatus: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 },
  title: { fontSize: 23, fontWeight: '600', letterSpacing: -0.5, color: c.ink, lineHeight: 33 },
  sectionTitle: { color: c.ink, fontSize: 17, fontWeight: '600', flexShrink: 1 },
  actionText: { fontSize: 12, color: c.accent },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.36)' },
  cardTitle: { fontSize: 20, fontWeight: '600', color: c.ink, lineHeight: 29 },
  body: { fontSize: 14, lineHeight: 24, color: c.muted },
  small: { fontSize: 12, lineHeight: 19, color: c.muted },
  bigIcon: { width: 58, height: 58, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: c.pale },
  button: { minHeight: 51, borderRadius: 19, backgroundColor: '#ddd1e6', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9, padding: 14 },
  secondaryButton: { backgroundColor: '#eee7f4' },
  buttonText: { color: c.ink, fontSize: 14, fontWeight: '600', textAlign: 'center', lineHeight: 21 },
  badge: { backgroundColor: '#eee7f4', alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  note: { padding: 16, borderRadius: 19, gap: 4 },
  todoRow: { minHeight: 78, paddingVertical: 17, gap: 12, flexDirection: 'row', alignItems: 'center' },
  todoIcon: { width: 37, height: 41, flexShrink: 0, borderRadius: 13, backgroundColor: '#f0eaf5', alignItems: 'center', justifyContent: 'center' },
  todoTitle: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: c.ink },
  todoMeta: { fontSize: 12, lineHeight: 18, color: c.muted },
  groupList: { paddingHorizontal: 16, backgroundColor: 'rgba(255,255,255,0.62)', borderRadius: 24, borderCurve: 'continuous', overflow: 'hidden' },
  softRow: { paddingHorizontal: 14, backgroundColor: 'rgba(255,255,255,0.56)', borderRadius: 20, borderCurve: 'continuous' },
  insetRule: { position: 'absolute', height: StyleSheet.hairlineWidth, left: 49, right: 0, bottom: 0, backgroundColor: c.line },
  settingRow: { minHeight: 66, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 11 },
  settingLabel: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: c.ink, flex: 1 },
  settingValue: { fontSize: 12, color: c.muted, maxWidth: '42%' },
  rowLabel: { fontSize: 15, lineHeight: 23, color: c.ink, fontWeight: '500' },
  choice: { minHeight: 60, borderRadius: 19, padding: 16, backgroundColor: 'rgba(255,255,255,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.8)', flexDirection: 'row', gap: 12, alignItems: 'center' },
  detailBox: { padding: 20, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.6)', gap: 18 },
  detailLine: { gap: 4 },
});
