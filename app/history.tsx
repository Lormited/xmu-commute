import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Text, View } from 'react-native';
import { useDemo } from '@/demo-context';
import { DEMO_DAY, historyLabel, visibleHistory } from '@/demo-data';
import { Badge, Screen, Glass, ResourceBlock, Segments, StateCard, s } from '@/ui';
import { SwipePages } from '@/swipe-pages';
export default function History() {
  const { state, real, data, refreshHistory } = useDemo();
  useFocusEffect(useCallback(() => {
    if (real && data.ready && data.authenticated) refreshHistory();
  }, [real, data.ready, data.authenticated, refreshHistory]));
  const [page, setPage] = useState(0);
  return <Screen back scroll={false} title="历史签到" resource="history">
    <View style={{ marginHorizontal: 24, marginBottom: 18 }}><Segments labels={['当日', '全部']} index={page} onChange={setPage} /></View>
    <SwipePages index={page} max={1} onChange={setPage}>{index => {
      const items = visibleHistory(state.history, index === 0 ? 'today' : 'all', real ? undefined : DEMO_DAY);
      return <ResourceBlock resource="history" emptyTitle="暂无签到记录">
      <View style={{ marginHorizontal: 24, gap: 14 }}>
        {items.length ? items.map(item => <Glass key={item.id} style={{ padding: 20, gap: 12 }}>
          <View style={[s.between, { alignItems: 'flex-start', gap: 10 }]}><Text selectable style={[s.rowLabel, { flex: 1 }]}>{item.course}</Text><Badge>{historyLabel(item.status)}</Badge></View>
          <Text selectable style={s.small}>{Number(item.date.slice(5, 7))}月{Number(item.date.slice(8, 10))}日 {Number(item.time.slice(0, 2))}{item.time.slice(2)} {item.type}</Text>
          {item.detail ? <Text selectable style={s.small}>{item.detail}</Text> : null}
        </Glass>) : <View style={{ marginHorizontal: -24 }}><StateCard icon="time-outline" title="今天还没有记录" action="查看全部" onPress={() => setPage(1)} /></View>}
      </View>
    </ResourceBlock>;
    }}</SwipePages>
  </Screen>;
}
