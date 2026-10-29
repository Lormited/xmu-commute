import { StyleSheet, Text, View } from 'react-native';
import { useDemo } from './demo-context';
import { courseFor, sessionTime, type Session } from './demo-data';
import { Glass, Icon, c } from './ui';

export function TodayCourseCard({ session, width }: { session: Session; width?: number }) {
  const { state } = useDemo();
  const course = courseFor(session.courseId, state.longText)!;
  return <Glass style={[k.card, { width, minHeight: state.longText ? 246 : 218 }]}>
      <View style={k.header}>
        <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[k.courseIcon, { backgroundColor: course.tint }]}><Icon name="school-outline" size={22} /></View>
        <Text selectable style={[k.meta, k.time]}>{sessionTime(session)}</Text>
      </View>
      <View style={k.information}>
        <Text style={k.meta} numberOfLines={2}>{session.room ?? course.room}</Text>
        <Text selectable style={k.name} numberOfLines={2}>{course.title}</Text>
        <Text style={k.meta} numberOfLines={1}>{course.teacher}</Text>
      </View>
  </Glass>;
}
const k = StyleSheet.create({
  card: { padding: 22, gap: 20 },
  meta: { fontSize: 13, lineHeight: 20, color: c.muted },
  time: { flexShrink: 0, textAlign: 'right', fontVariant: ['tabular-nums'] },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  courseIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  information: { flex: 1, justifyContent: 'flex-end', gap: 5 },
  name: { fontSize: 24, lineHeight: 32, fontWeight: '600', color: c.ink, letterSpacing: 0 },
});
