import { Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useDemo } from '@/demo-context';
import { accountCardStyles, methods, outcomes, scenarios } from '@/debug-options';
import { Button, Choice, SheetScreen, s } from '@/ui';

function Options<T extends string>({ title, options, value, select, preview }: { title: string; options: Record<T, string>; value: T; select: (value: T) => void; preview?: () => void }) {
  return <SheetScreen title={title} height={Math.min(660, 100 + Object.keys(options).length * 69 + (preview ? 70 : 0))}>
    {(Object.keys(options) as T[]).map(key => <Choice key={key} title={options[key]} selected={value === key} onPress={() => select(key)} />)}
    {preview && <Button secondary label="查看效果" onPress={preview} />}
  </SheetScreen>;
}
export default function DebugChoice() {
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  const { state, dispatch } = useDemo();
  switch (kind) {
    case 'account-card': return <Options title="账号卡片" options={accountCardStyles} value={state.accountCardStyle} select={value => dispatch({ type: 'account-card-style', value })} preview={() => router.dismissTo('/profile')} />;
    case 'scenario': return <Options title="演示场景" options={scenarios} value={state.scenario} select={scenario => dispatch({ type: 'scenario', scenario })} />;
    case 'method': return <Options title="签到方式" options={methods} value={state.method} select={method => dispatch({ type: 'method', method })} />;
    case 'outcome': return <Options title="模拟回执" options={outcomes} value={state.outcome} select={outcome => dispatch({ type: 'outcome', outcome })} />;
    default: return <SheetScreen title="调试选项"><Text style={s.body}>未找到此选项</Text></SheetScreen>;
  }
}
