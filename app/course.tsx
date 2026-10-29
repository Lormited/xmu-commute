import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useDemo } from '@/demo-context';
import { TERM, courseFor, sessionTime, sessionsForWeek } from '@/demo-data';
import { Badge, Button, DetailScreen, Note, s } from '@/ui';
export default function CourseDetail() {
  const params = useLocalSearchParams<{ id: string; session?: string; week?: string }>();
  const { state } = useDemo();
  const week = Number(params.week ?? TERM.currentWeek);
  const session = sessionsForWeek(week).find(item => item.id === params.session);
  const course = courseFor(params.id, state.longText);
  if (!state.loggedIn || !course) return <DetailScreen title="课程详情"><Note>{state.loggedIn ? '找不到这门演示课程。请返回课表重新选择。' : '本次演示已退出，个人课程不再显示。'}</Note><Button label="返回我的" onPress={() => router.navigate('/profile')} /></DetailScreen>;
  return <DetailScreen title="课程详情">
    <Text selectable style={s.title}>{course.title}</Text><Badge>第 {week} 周</Badge>
    <View style={s.detailBox}>{[
      ['上课时间', session ? '周' + ['一', '二', '三', '四', '五', '六', '日'][session.day] + ' ' + sessionTime(session) : '请在周课表查看具体安排'],
      ['教学节次', session ? '第 ' + (session.start + 1) + '—' + (session.start + session.length) + ' 节' : '未提供'],
      ['上课地点', session?.room ?? course.room], ['任课教师', course.teacher], ['授课学期', TERM.name],
    ].map(([label, value]) => <View key={label} style={s.detailLine}><Text style={s.small}>{label}</Text><Text selectable style={s.rowLabel}>{value}</Text></View>)}</View>
    {session?.note && <Note tone="warning">{session.note}</Note>}
  </DetailScreen>;
}
