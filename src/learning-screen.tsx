import { View } from 'react-native';
import { router } from 'expo-router';
import { useDemo } from './demo-context';
import { SwipePages } from './swipe-pages';
import { CourseList } from './course-list';
import { courseStyles, courseStyleIcon, listStyles, listStyleIcon } from './style-options';
import { Icon, ResourceBlock, RowGroup, Screen, Segments, Tap, TodoRow, s } from './ui';

export function LearningScreen() {
  const { state, dispatch, todos } = useDemo();
  const page = state.learningPage;
  const setPage = (value: number) => dispatch({ type: 'learning-page', value: value === 1 ? 1 : 0 });
  return <Screen tab scroll={false} resource="lnt" title="学习" headerAction={<Tap
    label={page === 0 ? '作业样式：' + listStyles[state.listStyle] : '课程样式：' + courseStyles[state.courseStyle]}
    onPress={() => router.push(page === 0 ? '/list-styles' : '/course-styles')}
    style={[s.iconButton, { backgroundColor: 'transparent' }]}
  ><Icon name={page === 0 ? listStyleIcon : courseStyleIcon} size={22} /></Tap>}>
    <View style={{ marginHorizontal: 24, marginBottom: 18 }}><Segments labels={['作业', '课程']} index={page} onChange={setPage} /></View>
    <SwipePages index={page} max={1} onChange={setPage}>{index => index === 0
      ? <ResourceBlock resource="lnt" emptyTitle="暂无作业"><View style={{ marginHorizontal: 24 }}><RowGroup>{todos.map((todo, i) => <TodoRow key={todo.id} todo={todo} last={i === todos.length - 1} />)}</RowGroup></View></ResourceBlock>
      : <ResourceBlock resource="courses" emptyTitle="暂无课程"><CourseList /></ResourceBlock>}
    </SwipePages>
  </Screen>;
}
