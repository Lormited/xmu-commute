import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { useDemo } from '@/demo-context';
import { DEMO_STUDENT_ID } from '@/demo-data';
import { Badge, Button, Glass, Icon, RowGroup, Screen, SettingRow, c, s } from '@/ui';
export default function Profile() {
  const { state, real, data, login } = useDemo();
  const original = state.accountCardStyle === 'original';
  const number = real ? data.account?.studentNumber || '学校账号' : DEMO_STUDENT_ID;
  const studentNumber = <Text selectable accessibilityLabel={state.loggedIn ? '学号，' + number : undefined} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ fontSize: original ? 22 : 24, lineHeight: 32, color: c.ink, fontWeight: '600', letterSpacing: 0.2, fontVariant: ['tabular-nums'] }}>{state.loggedIn ? number : '未登录'}</Text>;
  const name = <Text style={{ fontSize: 13, lineHeight: 20, color: c.muted }}>{real ? data.account?.name : '林同学'}</Text>;
  const badge = <Badge>{real ? '学校账号' : '演示账号'}</Badge>;
  return <Screen tab title="我的">
    <Glass style={{ marginHorizontal: 24, padding: 24, gap: 28, minHeight: 170, justifyContent: 'space-between' }}>
      <View style={[s.between, { gap: 12 }]}>
        {original ? <View style={{ flex: 1, minWidth: 0 }}>{studentNumber}</View> : <Icon name="sparkles-outline" size={32} color="#9d86ae" />}
        {original ? <Icon name="sparkles-outline" size={28} color="#9d86ae" /> : state.loggedIn && badge}
      </View>
      {original ? state.loggedIn && <View style={s.between}>{name}{badge}</View> : <View style={{ gap: 6 }}>{studentNumber}{state.loggedIn && name}</View>}
      {(!state.loggedIn || (real && data.needsLogin)) && <Button label="学校统一登录" busy={real && data.loggingIn} onPress={login} />}
    </Glass>
    <View style={{ marginHorizontal: 24, marginTop: 28 }}><RowGroup>
      <SettingRow icon="time-outline" title="历史签到" onPress={() => router.push('/history')} />
      <SettingRow icon="settings-outline" title="设置" onPress={() => router.push('/settings')} />
      <SettingRow icon="flask-outline" title="调试设置" last onPress={() => router.push('/lab')} />
    </RowGroup></View>
    {!real && <Text style={[s.small, { textAlign: 'center', marginTop: 28 }]}>交互原型 · 虚构数据</Text>}
  </Screen>;
}
