import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useDemo } from '@/demo-context';
import { todoFixtures } from '@/demo-data';
import { Button, DetailScreen, Icon, Note, c, s } from '@/ui';
export default function TodoDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state } = useDemo();
  const todo = todoFixtures(state.longText).find(item => item.id === id);
  if (!state.loggedIn || !todo) return <DetailScreen title="作业详情"><Note>这项作业当前不可用。</Note><Button label="返回作业" onPress={() => router.navigate('/learning')} /></DetailScreen>;
  const connected = state.load === 'ready' && state.scenario !== 'offline';
  return <DetailScreen title="作业详情">
    <View style={s.bigIcon}><Icon name="document-text-outline" size={29} color={c.accent} /></View>
    <Text selectable style={s.title}>{todo.title}</Text><Text selectable style={s.body}>{todo.course}</Text>
    <View style={s.detailBox}><Text style={s.small}>截止时间</Text><Text selectable style={s.rowLabel}>{todo.deadline ?? '未设置截止时间'}</Text></View>
    {todo.locked && <Note tone="warning">当前已锁定，请在 LNT 查看开放条件。</Note>}
    <Button label="前往 LNT（演示）" icon="open-outline" disabled={!connected} onPress={() => router.push({ pathname: '/school-preview', params: { id: todo.id } })} />
  </DetailScreen>;
}
