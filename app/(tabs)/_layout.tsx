import { Tabs } from 'expo-router';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Glass, Icon, Tap, c, type IconName } from '@/ui';
const nav: Record<string, { label: string; icon: IconName; active: IconName }> = {
  index: { label: '今日', icon: 'sunny-outline', active: 'sunny' },
  schedule: { label: '课表', icon: 'calendar-outline', active: 'calendar' },
  learning: { label: '学习', icon: 'book-outline', active: 'book' },
  profile: { label: '我的', icon: 'person-outline', active: 'person' },
};
export default function TabLayout() {
  const insets = useSafeAreaInsets();
  return <Tabs screenOptions={{ headerShown: false, animation: 'none', sceneStyle: { backgroundColor: '#fff' } }} backBehavior="history" tabBar={props =>
    <View style={{ position: 'absolute', left: 18, right: 18, bottom: Math.max(insets.bottom, 16) }}>
      <Glass style={{ flexDirection: 'row', gap: 3, padding: 6, borderRadius: 34, backgroundColor: 'rgba(255,255,255,0.84)', boxShadow: '0 8px 30px rgba(79,54,94,0.10)' }}>
        {props.state.routes.map((route, index) => {
          const item = nav[route.name];
          if (!item) return null;
          const active = props.state.index === index;
          return <Tap key={route.key} role="tab" label={item.label} accessibilityState={{ selected: active }} onPress={() => {
            const event = props.emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!active && !event.defaultPrevented) props.navigateToTab(route.key);
          }} style={{ flex: 1, minHeight: 59, borderRadius: 28, alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: active ? 'rgba(213,197,225,0.44)' : 'transparent' }}>
            <Icon name={active ? item.active : item.icon} size={23} color={active ? '#41304f' : '#8c8196'} /><Text style={{ fontSize: 10, color: active ? c.ink : c.muted, fontWeight: active ? '600' : '400' }}>{item.label}</Text>
          </Tap>;
        })}
      </Glass>
    </View>}>
    <Tabs.Screen name="index" options={{ title: '今日' }} />
    <Tabs.Screen name="schedule" options={{ title: '课表' }} />
    <Tabs.Screen name="learning" options={{ title: '学习' }} />
    <Tabs.Screen name="profile" options={{ title: '我的' }} />
  </Tabs>;
}
