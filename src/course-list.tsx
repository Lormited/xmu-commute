import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useDemo } from './demo-context';
import { courseFor, courses, sessionsForWeek } from './demo-data';
import { Icon, Tap, c } from './ui';

function openCourse(id: string, week: number) {
  const session = sessionsForWeek(week).find(item => item.courseId === id);
  router.push({ pathname: '/course', params: { id, week, session: session?.id } });
}
export function CourseList({ preview = false }: { preview?: boolean }) {
  const { state } = useDemo();
  const grid = state.courseStyle === 'grid';
  const items = preview ? courses.slice(0, 2) : courses;
  return <View style={[{ marginHorizontal: preview ? 0 : 24 }, grid && k.grid]}>{items.map(item => {
    const course = courseFor(item.id, state.longText)!;
    const style = grid ? k.card : k.row;
    const content = <>
      <View style={{ flex: 1, minWidth: 0, gap: grid ? 16 : 7, justifyContent: 'space-between' }}>
        <Text style={[k.title, grid && k.gridTitle]} numberOfLines={grid ? 3 : 2}>{course.title}</Text>
        <Text style={k.teacher} numberOfLines={1}>{course.teacher}</Text>
      </View>
      {!grid && <Icon name="chevron-forward" size={14} />}
    </>;
    return preview ? <View key={course.id} style={style}>{content}</View>
      : <Tap key={course.id} label={'查看课程：' + course.title} onPress={() => openCourse(course.id, state.week)} style={style}>{content}</Tap>;
  })}</View>;
}
const k = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  card: { width: '48%', minHeight: 152, padding: 18, borderRadius: 24, borderCurve: 'continuous', backgroundColor: 'rgba(255,255,255,.56)', borderWidth: 1, borderColor: 'rgba(255,255,255,.82)' },
  row: { minHeight: 92, paddingVertical: 20, flexDirection: 'row', alignItems: 'center', gap: 16 },
  title: { fontSize: 16, lineHeight: 24, fontWeight: '600', color: c.ink, letterSpacing: 0 },
  gridTitle: { fontSize: 17, lineHeight: 25 },
  teacher: { fontSize: 13, lineHeight: 20, color: c.muted },
});
