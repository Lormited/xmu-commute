import { useState } from 'react';
import { Text, View } from 'react-native';
import { useDemo } from '@/demo-context';
import { historyLabel, visibleHistory } from '@/demo-data';
import { Badge, Screen, Glass, ResourceBlock, Segments, StateCard, s } from '@/ui';
import { SwipePages } from '@/swipe-pages';
export default function History() {
  const { state } = useDemo();
  const [page, setPage] = useState(0);
  return <Screen back scroll={false} title="历史签到" resource="history">
    <View style={{ marginHorizontal: 24, marginBottom: 18 }}><Segments labels={['当日', '全部']} index={page} onChange={setPage} /></View>
    <SwipePages index={page} max={1} onChange={setPage}>{index => {
      const items = visibleHistory(state.history, index === 0 ? 'today' : 'all');
      return <ResourceBlock resource="history" emptyTitle="暂无签到记录">
      <View style={{ marginHorizontal: 24, gap: 14 }}>
        {items.length ? items.map(item => <Glass key={item.id} style={{ padding: 20, gap: 12 }}>
          <View style={[s.between, { alignItems: 'flex-start', gap: 10 }]}><Text selectable style={[s.rowLabel, { flex: 1 }]}>{item.course}</Text><Badge>{historyLabel(item.status)}</Badge></View>
          <Text selectable style={s.small}>{item.date} · {item.time} · {item.type}</Text>
        </Glass>) : <View style={{ marginHorizontal: -24 }}><StateCard icon="time-outline" title="今天还没有记录" action="查看全部" onPress={() => setPage(1)} /></View>}
      </View>
    </ResourceBlock>;
    }}</SwipePages>
  </Screen>;
}
