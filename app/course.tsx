import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useDemo } from '@/demo-context';
import { sessionTime } from '@/demo-data';
import { Badge, Button, DetailScreen, Note, s } from '@/ui';
export default function CourseDetail() {
  const params = useLocalSearchParams<{ id: string; session?: string; week?: string }>();
  const { state, real, timetable } = useDemo();
  const week = Number(params.week ?? timetable.currentWeek);
  const session = timetable.sessionsForWeek(week).find(item => item.id === params.session && item.courseId === params.id);
  const course = timetable.courseFor(params.id, session);
  if (!state.loggedIn || !course || (params.session && !session)) return <DetailScreen title="课程详情"><Note>{real ? '当前课程不可用，请返回学习页。' : state.loggedIn ? '找不到这门演示课程。请返回课表重新选择。' : '本次演示已退出，个人课程不再显示。'}</Note><Button label={real ? '返回学习' : '返回我的'} onPress={() => router.navigate(real ? '/learning' : '/profile')} /></DetailScreen>;
  return <DetailScreen title="课程详情">
    <Text selectable style={s.title}>{course.title}</Text><Badge>第 {week} 周</Badge>
    <View style={s.detailBox}>{[
      ['上课时间', session ? '周' + ['一', '二', '三', '四', '五', '六', '日'][session.day] + ' ' + sessionTime(session) : '请在周课表查看具体安排'],
      ['教学节次', session ? '第 ' + (session.start + 1) + '—' + (session.start + session.length) + ' 节' : '未提供'],
      ['上课地点', session?.room ?? course.room], ['任课教师', course.teacher], ['授课学期', timetable.name],
    ].map(([label, value]) => <View key={label} style={s.detailLine}><Text style={s.small}>{label}</Text><Text selectable style={s.rowLabel}>{value}</Text></View>)}</View>
  </DetailScreen>;
}
