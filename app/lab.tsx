import { Platform, Text } from 'react-native';
import { router } from 'expo-router';
import { useDemo } from '@/demo-context';
import { accountCardStyles, methods, outcomes, scenarios } from '@/debug-options';
import { Button, DetailScreen, Note, RowGroup, SettingRow, s } from '@/ui';
export default function Lab() {
  const { state, dispatch, real, trial, trialData } = useDemo();
  function choose(kind: string) { router.push({ pathname: '/debug-choice', params: { kind } }); }
  return <DetailScreen title="调试设置">
    <Text accessibilityRole="header" style={s.sectionTitle}>外观</Text>
    <RowGroup>
      <SettingRow icon="card-outline" title="账号卡片" last value={accountCardStyles[state.accountCardStyle]} onPress={() => choose('account-card')} />
    </RowGroup>
    <Text accessibilityRole="header" style={s.sectionTitle}>模拟活动</Text>
    <RowGroup>
      {!real && <SettingRow icon="options-outline" title="演示场景" value={scenarios[state.scenario]} onPress={() => choose('scenario')} />}
      <SettingRow icon="scan-outline" title="签到方式" value={methods[state.method]} onPress={() => choose('method')} />
      <SettingRow icon="checkmark-circle-outline" title="模拟回执" value={outcomes[state.outcome]} last onPress={() => choose('outcome')} />
    </RowGroup>
    {Platform.OS === 'android' && real && <>
      <Note>后台提醒试验每次运行 5 分钟，保留常驻通知，每 20 秒检查一次。可立即发起模拟活动，也可选择 15 秒后发起并切到后台或锁屏，等待下一次检查发现后的系统通知。点击通知继续签到，回执均为模拟结果。</Note>
      {state.method === 'qr' && <Note>模拟二维码内容只用于本机试验；此活动不会提交到学校。</Note>}
      <Text accessibilityLiveRegion="polite" style={s.rowLabel}>{trialData.running ? '后台试验运行中' : '后台试验已停止'}</Text>
      {trialData.message ? <Note tone="warning">{trialData.message}</Note> : null}
      <Button label={trialData.running ? '停止后台试验' : '启动 5 分钟后台试验'} busy={trialData.busy}
        onPress={() => { void (trialData.running ? trial.stop() : trial.start()); }} />
      <Button secondary label="立即发起所选模拟签到" disabled={!trialData.running || trialData.busy} onPress={() => { void trial.queue(state.method, state.outcome, 0); }} />
      <Button secondary label="15 秒后发起所选模拟签到" disabled={!trialData.running || trialData.busy} onPress={() => { void trial.queue(state.method, state.outcome); }} />
      <Button secondary label="清空本机试验记录" disabled={trialData.running || trialData.busy} onPress={() => { void trial.clear(); }} />
      <Text accessibilityRole="header" style={s.sectionTitle}>本机运行记录</Text>
      <Note>只记录时间、阶段与发现延迟。锁屏、后台、划掉任务的具体条件及耗电由阶段查看记录；重开只恢复活动和记录，不自动重启试验。</Note>
      {trialData.logs.slice().reverse().map((entry, index) => <Text selectable key={index} style={s.small}>
        {new Date(entry.at).toLocaleTimeString('zh-CN')} · {logLabels[entry.event]}{entry.delayMs === undefined ? '' : ` · 延迟 ${(entry.delayMs / 1000).toFixed(1)} 秒`}
      </Text>)}
    </>}
    {!real && <>
    <Note>仅虚构数据。无网络保留已有数据，其余场景重置演示记录。</Note>
    <Button label="体验所选签到" disabled={!state.loggedIn || state.load !== 'ready' || state.scenario === 'offline'} onPress={() => { dispatch({ type: 'start-rollcall' }); router.push('/attendance'); }} />
    <Button secondary label="重置全部演示" onPress={() => { dispatch({ type: 'reset' }); router.dismissTo('/'); }} /></>}
  </DetailScreen>;
}

const logLabels = { started: '已启动', stopped: '已停止', expired: '5 分钟到期停止', restored: '重开后恢复记录', queued: '模拟活动已排队',
  polled: '检查模拟活动源', discovered: '已发现活动', notified: '已发送系统通知', 'notification-failed': '通知发送失败', receipt: '已取得模拟回执', opened: '通知已打开浮层' };
