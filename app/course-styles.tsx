import { Text } from 'react-native';
import { useDemo } from '@/demo-context';
import { CourseList } from '@/course-list';
import { courseStyles } from '@/style-options';
import { Choice, SheetScreen, s } from '@/ui';

export default function CourseStyles() {
  const { state, dispatch } = useDemo();
  return <SheetScreen title="课程样式" height={500}>
    {(Object.keys(courseStyles) as (keyof typeof courseStyles)[]).map(value => <Choice key={value} title={courseStyles[value]} selected={state.courseStyle === value} onPress={() => dispatch({ type: 'course-style', value })} />)}
    <Text style={[s.sectionTitle, { marginTop: 16, marginBottom: 4 }]}>预览</Text>
    <CourseList preview />
  </SheetScreen>;
}
