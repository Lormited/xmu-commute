import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useDemo } from '@/demo-context';
import { groupSessions, sessionTime } from '@/demo-data';
import { Glass, Icon, Note, SheetScreen, Tap, s } from '@/ui';

export default function Conflicts() {
  const { session, week: param } = useLocalSearchParams<{ session: string; week?: string }>();
  const { state, timetable } = useDemo();
  const week = Number(param ?? timetable.currentWeek);
  const group = groupSessions(timetable.sessionsForWeek(week)).find(item => item.sessions.some(value => value.id === session));
  return <SheetScreen title="重叠课程" height={Math.min(620, 104 + (group?.sessions.length ?? 1) * 154)}>
    {!state.loggedIn || !group ? <Note>当前课程不可用，请返回课表。</Note> : <>
      <Text style={s.body}>周{timetable.weekDays(week)[group.day].label} · 第 {week} 周</Text>
      {group.sessions.map(item => {
        const course = timetable.courseFor(item.courseId, item)!;
        return <Tap key={item.id} label={'查看' + course.title + '课程详情'} onPress={() => router.dismissTo({ pathname: '/course', params: { id: course.id, session: item.id, week } })}>
          <Glass style={{ padding: 18, gap: 8, borderRadius: 22, backgroundColor: course.tint }}>
            <View style={[s.between, { gap: 8 }]}><Text selectable style={[s.rowLabel, { flex: 1 }]}>{course.title}</Text><Icon name="chevron-forward" size={16} /></View>
            <Text style={s.todoMeta}>{sessionTime(item)} · 第 {item.start + 1}—{item.start + item.length} 节</Text>
            <Text selectable style={s.todoMeta}>{course.teacher} · {item.room ?? course.room}</Text>
          </Glass>
        </Tap>;
      })}
    </>}
  </SheetScreen>;
}
