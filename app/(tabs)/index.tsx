import { ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useDemo } from '@/demo-context';
import { activeRollcalls } from '@/demo-state';
import { TERM, courseFor, methodLabel, sessionsForWeek, todoFixtures } from '@/demo-data';
import { TodayCourseCard } from '@/today-course-card';
import { Glass, Icon, ResourceBlock, RowGroup, Screen, Section, StateCard, Tap, TodoRow, c, s } from '@/ui';

export default function Today() {
  const { state } = useDemo();
  const { width } = useWindowDimensions();
  const list = todoFixtures(state.longText);
  const today = sessionsForWeek(TERM.currentWeek).filter(item => item.day === 0).sort((a, b) => a.start - b.start);
  const active = activeRollcalls(state);
  const cardWidth = Math.min(Math.min(width, 440) - 84, 300);
  if (!state.loggedIn) return <Screen tab title="10月26日 · 星期一">
    <StateCard icon="school-outline" title="登录后查看学习数据" action="学校统一登录" onPress={() => router.push('/login')} />
  </Screen>;
  return <Screen tab resource="jw" title="10月26日 · 星期一">
    <Section title="今日课程" action="全部课表" onPress={() => router.navigate('/schedule')} />
    <ResourceBlock resource="jw" emptyTitle="今天没有课程">
      {today.length ? <ScrollView horizontal directionalLockEnabled nestedScrollEnabled bounces overScrollMode="always" showsHorizontalScrollIndicator={false} snapToInterval={cardWidth + 12} decelerationRate="fast" contentContainerStyle={{ paddingHorizontal: 24, gap: 12, paddingBottom: 20 }}>
        {today.map(session => {
          const course = courseFor(session.courseId, state.longText)!;
          return <Tap key={session.id} label={'查看' + course.title + '课程详情'} onPress={() => router.push({ pathname: '/course', params: { id: course.id, session: session.id, week: TERM.currentWeek } })}>
            <TodayCourseCard session={session} width={cardWidth} />
          </Tap>;
        })}
      </ScrollView> : <View style={{ marginHorizontal: 24, paddingVertical: 20 }}><Text style={s.body}>今天没有课程</Text></View>}
    </ResourceBlock>
    {active.length > 0 && <View style={{ marginHorizontal: 24, marginTop: 2, marginBottom: 22, gap: 10 }}>{active.map(item => {
      const course = courseFor(item.courseId, state.longText)!;
      const method = item.method;
      return <Tap key={item.id} label={course.title + '，' + methodLabel[method] + '，去签到'} onPress={() => router.push({ pathname: '/attendance', params: { id: item.id } })}>
        <Glass style={{ padding: 14, minHeight: 72, flexDirection: 'row', gap: 12, alignItems: 'center', borderRadius: 22 }}>
          <View style={{ width: 36, height: 36, borderRadius: 13, backgroundColor: course.tint, alignItems: 'center', justifyContent: 'center' }}><Icon name={method === 'number' ? 'keypad-outline' : method === 'qr' ? 'scan-outline' : 'locate-outline'} size={20} color={course.color} /></View>
          <View style={{ flex: 1, gap: 4 }}><Text style={s.todoTitle} numberOfLines={1}>{course.title}</Text><Text style={s.todoMeta}>{methodLabel[method]}</Text></View>
          <View style={{ backgroundColor: '#eee5f3', borderRadius: 16, minHeight: 40, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 12, color: c.secondary, fontWeight: '600' }}>去签到</Text></View>
        </Glass>
      </Tap>;
    })}</View>}
    <View style={{ marginTop: state.load === 'ready' ? 23 : 43 }}><Section title="作业" action="查看全部" onPress={() => router.navigate('/learning')} /></View>
    <ResourceBlock resource="lnt" emptyTitle="暂无作业">
      <View style={{ marginHorizontal: 24 }}><RowGroup>{list.slice(0, 3).map((todo, index) => <TodoRow key={todo.id} todo={todo} flushTop={index === 0} last={index === 2} />)}</RowGroup></View>
    </ResourceBlock>
  </Screen>;
}
