import { ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useDemo } from '@/demo-context';
import { courseFor, methodLabel } from '@/demo-data';
import { TodayCourseCard } from '@/today-course-card';
import { Glass, Icon, ResourceBlock, RowGroup, Screen, Section, StateCard, Tap, TodoRow, c, s } from '@/ui';

export default function Today() {
  const { state, real, data, todos: list, login, timetable, isTrialRollcall } = useDemo();
  const { width } = useWindowDimensions();
  const today = timetable.sessionsForWeek(timetable.currentWeek).filter(item => item.day === (real ? (new Date().getDay() + 6) % 7 : 0)).sort((a, b) => a.start - b.start);
  const title = real ? new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).replace('星期', ' · 星期') : '10月26日 · 星期一';
  const active = state.rollcalls.filter(item => !state.attendance[item.id]
    && (isTrialRollcall(item.id) || state.loggedIn && state.load === 'ready'));
  const cardWidth = Math.min(Math.min(width, 440) - 84, 300);
  const attendanceCards = active.length > 0 && <View style={{ marginHorizontal: 24, marginTop: state.loggedIn && today.length > 0 && (real || state.load === 'ready') ? 2 : 22, marginBottom: 22, gap: 10 }}>{active.map(item => {
    const course = real ? timetable.courseFor(item.courseId) : courseFor(item.courseId, state.longText);
    const name = item.title ?? course?.title ?? '签到活动';
    const method = item.method;
    return <Tap key={item.id} label={name + '，' + methodLabel[method] + '，去签到'} onPress={() => router.push({ pathname: '/attendance', params: { id: item.id } })}>
        <Glass style={{ padding: 14, minHeight: 72, flexDirection: 'row', gap: 12, alignItems: 'center', borderRadius: 22 }}>
          <View style={{ width: 36, height: 36, borderRadius: 13, backgroundColor: course?.tint ?? c.pale, alignItems: 'center', justifyContent: 'center' }}><Icon name={method === 'number' ? 'keypad-outline' : method === 'qr' ? 'scan-outline' : 'locate-outline'} size={20} color={course?.color ?? c.icon} /></View>
          <View style={{ flex: 1, gap: 4 }}><Text style={s.todoTitle} numberOfLines={1}>{name}</Text><Text style={s.todoMeta}>{methodLabel[method]}</Text></View>
          <View style={{ backgroundColor: '#eee5f3', borderRadius: 16, minHeight: 40, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 12, color: c.secondary, fontWeight: '600' }}>去签到</Text></View>
        </Glass>
    </Tap>;
  })}</View>;
  if (!state.loggedIn) return <Screen tab title={title}>
    <StateCard icon="school-outline" title="登录后查看学习数据" action="学校统一登录" busy={real && data.loggingIn} onPress={login} />
    {attendanceCards}
  </Screen>;
  return <Screen tab resource="jw" title={title}>
    <Section title="今日课程" action="全部课表" onPress={() => router.navigate('/schedule')} />
    <ResourceBlock resource="jw" emptyTitle="今天没有课程">
      {today.length ? <ScrollView horizontal directionalLockEnabled nestedScrollEnabled bounces overScrollMode="always" showsHorizontalScrollIndicator={false} snapToInterval={cardWidth + 12} decelerationRate="fast" contentContainerStyle={{ paddingHorizontal: 24, gap: 12, paddingBottom: 20 }}>
        {today.map(session => {
          const course = timetable.courseFor(session.courseId, session)!;
          return <Tap key={session.id} label={'查看' + course.title + '课程详情'} onPress={() => router.push({ pathname: '/course', params: { id: course.id, session: session.id, week: timetable.currentWeek } })}>
            <TodayCourseCard session={session} width={cardWidth} />
          </Tap>;
        })}
      </ScrollView> : <View style={{ marginHorizontal: 24, paddingVertical: 20 }}><Text style={s.body}>今天没有课程</Text></View>}
    </ResourceBlock>
    {attendanceCards}
    <View style={{ marginTop: state.load === 'ready' ? 23 : 43 }}><Section title="作业" action="查看全部" onPress={() => router.navigate('/learning')} /></View>
    <ResourceBlock resource="lnt" emptyTitle="暂无作业">
      <View style={{ marginHorizontal: 24 }}><RowGroup>{list.slice(0, 3).map((todo, index) => <TodoRow key={todo.id} todo={todo} flushTop={index === 0} last={index === 2} />)}</RowGroup></View>
    </ResourceBlock>
  </Screen>;
}
