import { Text } from 'react-native';
import { useDemo } from '@/demo-context';
import { todoFixtures } from '@/demo-data';
import { listStyles } from '@/style-options';
import { Choice, RowGroup, SheetScreen, TodoRow, s } from '@/ui';

export default function ListStyles() {
  const { state, dispatch } = useDemo();
  const examples = todoFixtures(state.longText).slice(0, 3);
  return <SheetScreen title="作业样式" height={610}>
    {(Object.keys(listStyles) as (keyof typeof listStyles)[]).map(value => <Choice key={value} title={listStyles[value]} selected={state.listStyle === value} onPress={() => dispatch({ type: 'list-style', value })} />)}
    <Text style={[s.sectionTitle, { marginTop: 16, marginBottom: 4 }]}>预览</Text>
    <RowGroup>{examples.map((todo, index) => <TodoRow preview key={todo.id} todo={todo} last={index === examples.length - 1} />)}</RowGroup>
  </SheetScreen>;
}
