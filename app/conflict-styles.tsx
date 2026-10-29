import { router } from 'expo-router';
import { useDemo } from '@/demo-context';
import { conflictStyles } from '@/style-options';
import { Button, Choice, SheetScreen } from '@/ui';

export default function ConflictStyles() {
  const { state, dispatch } = useDemo();
  return <SheetScreen title="冲突课程样式" height={310}>
    {(Object.keys(conflictStyles) as (keyof typeof conflictStyles)[]).map(value => <Choice key={value} title={conflictStyles[value]} selected={state.conflictStyle === value} onPress={() => dispatch({ type: 'conflict-style', value })} />)}
    <Button secondary label="查看课表" onPress={() => router.dismissTo('/schedule')} />
  </SheetScreen>;
}
