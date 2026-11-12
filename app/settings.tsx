import { useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useDemo } from '@/demo-context';
import { conflictStyles, conflictStyleIcon, courseStyles, courseStyleIcon, listStyles, listStyleIcon } from '@/style-options';
import { Button, DetailScreen, Note, RowGroup, SettingRow, s } from '@/ui';
export default function Settings() {
  const { state, dispatch, real, logout } = useDemo();
  const [asking, setAsking] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  return <DetailScreen title="设置">
    <RowGroup>
      <SettingRow icon="notifications-outline" title="签到提醒" last trailing={<Switch disabled={real} accessibilityLabel={real ? '签到提醒' : '签到提醒（模拟开关）'} value={state.reminders} onValueChange={enabled => { if (enabled && state.notificationPermission !== 'granted') setAsking(true); else dispatch({ type: 'reminders', enabled }); }} trackColor={{ false: '#ded6e4', true: '#b09cbf' }} />} />
    </RowGroup>
    {asking && <View style={s.detailBox}><Text style={s.rowLabel}>允许提醒？</Text><Text style={s.body}>模拟权限，不开启真实通知。</Text><Button label="允许（演示）" onPress={() => { dispatch({ type: 'permission', value: 'granted' }); setAsking(false); }} /><Button secondary label="暂不允许" onPress={() => { dispatch({ type: 'permission', value: 'denied' }); setAsking(false); }} /></View>}
    {state.notificationPermission === 'denied' && !asking && <Note tone="warning" action="重新允许" onPress={() => setAsking(true)}>模拟通知权限未允许</Note>}
    <RowGroup>
      <SettingRow icon="sync-outline" title="刷新课表" trailing={<Switch accessibilityLabel="刷新课表" accessibilityHint="开启后，普通刷新会更新课表" value={state.refreshSchedule} onValueChange={enabled => dispatch({ type: 'refresh-schedule', enabled })} trackColor={{ false: '#ded6e4', true: '#b09cbf' }} />} />
      <SettingRow icon="calendar-outline" title="课表显示周末" trailing={<Switch accessibilityLabel="课表显示周末" value={state.showWeekends} onValueChange={enabled => dispatch({ type: 'weekends', enabled })} trackColor={{ false: '#ded6e4', true: '#b09cbf' }} />} />
      <SettingRow icon={conflictStyleIcon} title="冲突课程样式" value={conflictStyles[state.conflictStyle]} last onPress={() => router.push('/conflict-styles')} />
    </RowGroup>
    <RowGroup>
      <SettingRow icon={courseStyleIcon} title="课程样式" value={courseStyles[state.courseStyle]} onPress={() => router.push('/course-styles')} />
      <SettingRow icon={listStyleIcon} title="作业样式" value={listStyles[state.listStyle]} last onPress={() => router.push('/list-styles')} />
    </RowGroup>
    {(state.loggedIn || real) && <RowGroup><SettingRow icon="log-out-outline" title={state.loggedIn ? '退出登录' : '清除学校登录数据'} last danger onPress={() => setConfirmLogout(true)} /></RowGroup>}
    {confirmLogout && <View style={s.detailBox}><Text style={s.cardTitle}>{state.loggedIn ? '退出登录？' : '清除学校登录数据？'}</Text><Text style={s.body}>{real ? '清除本机账号、学校会话与学习数据。' : '清除本次演示身份与签到记录。'}</Text><Button label="确认退出" onPress={() => { void logout().then(ok => { if (ok) router.replace('/profile'); }); }} /><Button secondary label="取消" onPress={() => setConfirmLogout(false)} /></View>}
  </DetailScreen>;
}
