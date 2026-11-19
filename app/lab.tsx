import { Text } from 'react-native';
import { router } from 'expo-router';
import { useDemo } from '@/demo-context';
import { accountCardStyles, methods, outcomes, scenarios } from '@/debug-options';
import { Button, DetailScreen, Note, RowGroup, SettingRow, s } from '@/ui';
export default function Lab() {
  const { state, dispatch, real } = useDemo();
  function choose(kind: string) { router.push({ pathname: '/debug-choice', params: { kind } }); }
  return <DetailScreen title="调试设置">
    <Text accessibilityRole="header" style={s.sectionTitle}>外观</Text>
    <RowGroup>
      <SettingRow icon="card-outline" title="账号卡片" last value={accountCardStyles[state.accountCardStyle]} onPress={() => choose('account-card')} />
    </RowGroup>
    {!real && <>
      <Text accessibilityRole="header" style={s.sectionTitle}>模拟活动</Text>
      <RowGroup>
        <SettingRow icon="options-outline" title="演示场景" value={scenarios[state.scenario]} onPress={() => choose('scenario')} />
        <SettingRow icon="scan-outline" title="签到方式" value={methods[state.method]} onPress={() => choose('method')} />
        <SettingRow icon="checkmark-circle-outline" title="模拟回执" value={outcomes[state.outcome]} last onPress={() => choose('outcome')} />
      </RowGroup>
      <Note>仅虚构数据。无网络保留已有数据，其余场景重置演示记录。</Note>
      <Button label="体验所选签到" disabled={!state.loggedIn || state.load !== 'ready' || state.scenario === 'offline'} onPress={() => { dispatch({ type: 'start-rollcall' }); router.push('/attendance'); }} />
      <Button secondary label="重置全部演示" onPress={() => { dispatch({ type: 'reset' }); router.dismissTo('/'); }} />
    </>}
  </DetailScreen>;
}
