import { Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useDemo } from '@/demo-context';
import { todoFixtures } from '@/demo-data';
import { Badge, Button, DetailScreen, Glass, Icon, c, s } from '@/ui';
export default function SchoolPreview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, refresh } = useDemo();
  const todo = todoFixtures(state.longText).find(item => item.id === id);
  return <DetailScreen title="LNT 页面预览">
    <Badge>占位页面 · 未连接学校</Badge>
    <Glass style={{ padding: 24, gap: 18 }}><Icon name="open-outline" color={c.accent} size={30} /><Text selectable style={s.cardTitle}>{state.loggedIn ? todo?.title ?? '课程活动' : '已退出登录'}</Text><Text style={s.body}>实际处理将在 LNT 中完成。本页仅演示打开与返回。</Text></Glass>
    <Button label="返回并同步" icon="arrow-back" onPress={() => { refresh(); router.dismissTo('/learning'); }} />
  </DetailScreen>;
}
