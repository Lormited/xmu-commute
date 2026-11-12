import { useCallback } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useDemo } from '@/demo-context';
import { groupSessions, type Session } from '@/demo-data';
import { Icon, ResourceBlock, Screen, Tap, c, s } from '@/ui';
import { conflictStyles, conflictStyleIcon } from '@/style-options';
import { SwipePages } from '@/swipe-pages';

const ROW = 68;
export default function Schedule() {
  const { state, dispatch, timetable } = useDemo();
  useFocusEffect(useCallback(() => {
    if (Platform.OS !== 'web') return;
    function key(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (event.altKey || event.ctrlKey || event.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      dispatch({ type: 'week', week: state.week + (event.key === 'ArrowRight' ? 1 : -1) });
    }
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [dispatch, state.week]));
  return <Screen tab scroll={false} resource="jw" headerGap={6} title={'第 ' + state.week + ' 周'} headerAction={<Tap
    label={'冲突课程样式：' + conflictStyles[state.conflictStyle]}
    onPress={() => router.push('/conflict-styles')}
    style={[s.iconButton, { backgroundColor: 'transparent' }]}
  ><Icon name={conflictStyleIcon} size={22} /></Tap>} titleProps={Platform.OS === 'web' ? undefined : {
    accessibilityRole: 'adjustable', accessibilityLabel: '课表，第' + state.week + '周', accessibilityValue: { min: timetable.minWeek, max: timetable.weeks, now: state.week, text: '第' + state.week + '周' },
    accessibilityActions: [{ name: 'increment', label: '下一周' }, { name: 'decrement', label: '上一周' }],
    onAccessibilityAction: event => dispatch({ type: 'week', week: state.week + (event.nativeEvent.actionName === 'increment' ? 1 : -1) }),
  }}>
    <ResourceBlock resource="jw" emptyTitle="本周没有课程" showEmptyState={false}>
      <SwipePages index={state.week} min={timetable.minWeek} max={timetable.weeks} onChange={week => dispatch({ type: 'week', week })}>{week => <WeekGrid week={week} />}</SwipePages>
    </ResourceBlock>
  </Screen>;
}
function WeekGrid({ week }: { week: number }) {
  const { state, timetable } = useDemo();
  const periods = timetable.periods;
  const days = timetable.weekDays(week).slice(0, state.showWeekends ? 7 : 5);
  const groups = groupSessions(timetable.sessionsForWeek(week));
  return <View style={{ marginRight: 8 }}>
        <View style={t.dayHeader}>
          <View style={{ width: 36 }} />
          {days.map((day, index) => <View key={index} style={t.day}>
            <View accessibilityLabel={day.today ? '今天，周' + day.label + '，' + day.month + '月' + day.date + '日' : undefined} accessible={day.today} style={t.dateCell}>
              <Text style={[t.dayText, day.today && t.todayText]}>周{day.label}</Text><Text style={[t.dayText, day.today && t.todayText]}>{String(day.month).padStart(2, '0')}/{String(day.date).padStart(2, '0')}</Text>
              {day.today && <View style={t.todayLine} />}
            </View>
          </View>)}
        </View>
        <View style={{ height: ROW * periods.length, flexDirection: 'row' }}>
          <View style={{ width: 36 }}>{periods.map((period, index) => <View key={index} style={t.period}>
            <Text style={t.periodNumber}>{index + 1}</Text><View style={{ alignItems: 'center', gap: 1 }}><Text style={t.periodTime}>{period[0]}</Text><Text style={t.periodTime}>{period[1]}</Text></View>
          </View>)}</View>
          {days.map((_, day) => <View key={day} style={{ flex: 1 }}>
            {periods.map((_, row) => <View key={row} style={[t.gridLine, { top: row * ROW }]} />)}
            <View pointerEvents="none" style={t.verticalLine} />
            {groups.filter(group => group.day === day).map(group => {
              const first = group.sessions[0];
              const course = timetable.courseFor(first.courseId, first)!;
              const count = group.sessions.length;
              const depth = Math.min(count - 1, 2);
              return <Tap key={first.id} label={count > 1 ? '周' + days[day].label + '，第' + (group.start + 1) + '至' + group.end + '节，' + count + '门课程重叠，查看全部' : course.title + '，周' + days[day].label + '，第' + (first.start + 1) + '至' + (first.start + first.length) + '节'}
                onPress={() => router.push(count > 1
                  ? { pathname: '/conflicts', params: { session: first.id, week } }
                  : { pathname: '/course', params: { id: course.id, session: first.id, week } })}
                style={{ position: 'absolute', top: group.start * ROW + 3, height: (group.end - group.start) * ROW - 6, left: 2, right: 2 }}>
                {count > 1 && state.conflictStyle !== 'stack' ? <ConflictCourses sessions={group.sessions} /> : <>
                  {group.sessions.slice(1, 3).reverse().map((item, index, layers) => <View key={item.id} pointerEvents="none" style={[t.course, { backgroundColor: timetable.courseFor(item.courseId, item)!.tint, top: (layers.length - index) * 6, left: (layers.length - index) * 5 }]} />)}
                  <View pointerEvents="none" style={[t.course, { backgroundColor: course.tint, right: depth * 5, bottom: depth * 6 }]}>
                    <SessionLabel session={first} />
                  </View>
                </>}
              </Tap>;
            })}
          </View>)}
        </View>
      </View>;
}
function ConflictCourses({ sessions }: { sessions: Session[] }) {
  const { timetable } = useDemo();
  return <View pointerEvents="none" style={[t.course, t.fold]}>
    {sessions.map((session, index) => {
      const course = timetable.courseFor(session.courseId, session)!;
      return <View key={session.id} style={[t.conflictPart, t.foldPart, { backgroundColor: course.tint, marginTop: index ? -8 : 0, marginLeft: index % 2 ? 7 : 0, marginRight: index % 2 ? 0 : 7, zIndex: index }]}>
        <SessionLabel session={session} compact />
      </View>;
    })}
  </View>;
}
function SessionLabel({ session, compact = false }: { session: Session; compact?: boolean }) {
  const { state, timetable } = useDemo();
  const course = timetable.courseFor(session.courseId, session)!;
  return <><Text style={[t.courseName, compact && { fontSize: 11, lineHeight: 14 }]} numberOfLines={3}>{course.title}</Text>
    {!(compact && state.showWeekends) && <Text style={[t.room, compact && { fontSize: 9, lineHeight: 12 }]} numberOfLines={compact ? 1 : 2}>{(session.room ?? course.room).replace('教学楼 ', '').replace('二号楼 ', '2-')}</Text>}</>;
}
const t = StyleSheet.create({
  dayHeader: { flexDirection: 'row', minHeight: 52, alignItems: 'center', marginBottom: 6 },
  day: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  dateCell: { width: '100%', maxWidth: 48, minHeight: 46, alignItems: 'center', justifyContent: 'center', gap: 2 },
  todayLine: { position: 'absolute', bottom: -2, height: 3, width: 18, borderRadius: 2, backgroundColor: c.icon },
  todayText: { color: c.ink, fontWeight: '600' },
  dayText: { fontSize: 12, lineHeight: 17, fontWeight: '500', color: c.muted, fontVariant: ['tabular-nums'] },
  period: { height: ROW, alignItems: 'center', justifyContent: 'center', gap: 5 },
  periodNumber: { fontSize: 16, lineHeight: 20, fontWeight: '500', color: c.ink, textAlign: 'center' },
  periodTime: { fontSize: 9, lineHeight: 12, color: c.muted, fontVariant: ['tabular-nums'], textAlign: 'center' },
  gridLine: { position: 'absolute', left: 0, right: 0, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(166,146,177,.13)' },
  verticalLine: { position: 'absolute', top: 0, bottom: 0, left: 0, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: 'rgba(166,146,177,.10)' },
  course: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, padding: 6, borderRadius: 12, borderCurve: 'continuous', gap: 6, overflow: 'hidden' },
  courseName: { fontSize: 12, lineHeight: 17, fontWeight: '600', color: c.ink },
  room: { fontSize: 10, lineHeight: 14, color: c.secondary },
  conflictPart: { flex: 1, minHeight: 0, gap: 3 },
  fold: { padding: 0, gap: 0, overflow: 'visible' },
  foldPart: { borderRadius: 10, borderCurve: 'continuous', paddingHorizontal: 5, paddingVertical: 6, boxShadow: '0 3px 7px rgba(83,55,95,.07)' },
});
