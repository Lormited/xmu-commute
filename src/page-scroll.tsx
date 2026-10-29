import { createContext, useContext, type ReactNode } from 'react';
import { Platform } from 'react-native';
import Animated, { Easing, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { GestureDetector, useNativeGesture, usePanGesture, useSimultaneousGestures } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDemo } from './demo-context';
import { REFRESH_THRESHOLD, shouldRefresh } from './demo-data';

export const PageScrollContext = createContext<{ tab: boolean; enabled: boolean; pull: SharedValue<number>; rotation: SharedValue<number> } | null>(null);

export function PageScroll({ children }: { children: ReactNode }) {
  const config = useContext(PageScrollContext)!;
  const insets = useSafeAreaInsets();
  const { refresh, refreshing, reducedMotion } = useDemo();
  const custom = config.enabled;
  const { pull, rotation } = config;
  const offset = useSharedValue(0);
  const atTop = useSharedValue(false);
  const scroll = useAnimatedScrollHandler({
    onScroll: event => {
      offset.set(event.contentOffset.y);
      if (Platform.OS === 'ios' && custom && !refreshing) {
        const distance = Math.min(96, Math.max(0, -event.contentOffset.y * 0.5));
        pull.set(distance);
        if (!reducedMotion) rotation.set(distance / REFRESH_THRESHOLD * 240);
      }
    },
    onEndDrag: () => {
      if (Platform.OS === 'ios' && shouldRefresh(pull.get(), custom, refreshing)) scheduleOnRN(refresh);
    },
  });
  const native = useNativeGesture();
  const drag = usePanGesture({
    enabled: Platform.OS !== 'ios' && custom && !refreshing, activeOffsetY: 10, failOffsetX: [-18, 18],
    onBegin: () => { 'worklet'; atTop.set(offset.get() <= 1); },
    onUpdate: event => {
      'worklet';
      if (atTop.get() && offset.get() <= 1) {
        const distance = Math.min(96, Math.max(0, event.translationY * 0.5));
        pull.set(distance);
        if (!reducedMotion) rotation.set(distance / REFRESH_THRESHOLD * 240);
      }
    },
    onDeactivate: event => {
      'worklet';
      if (!event.canceled && shouldRefresh(pull.get(), custom, refreshing)) scheduleOnRN(refresh);
    },
    onFinalize: () => {
      'worklet';
      pull.set(reducedMotion ? 0 : withSpring(0, { duration: 400, dampingRatio: 1 }));
      if (!refreshing) rotation.set(withTiming(0, { duration: reducedMotion ? 0 : 180, easing: Easing.bezier(0.23, 1, 0.32, 1) }));
    },
  });
  const gesture = useSimultaneousGestures(native, drag);
  const contentStyle = useAnimatedStyle(() => ({ transform: [{ translateY: Platform.OS !== 'ios' && custom && !reducedMotion ? pull.get() * 0.28 : 0 }] }));
  const content = <Animated.ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" directionalLockEnabled nestedScrollEnabled showsVerticalScrollIndicator={false}
    onScroll={scroll} scrollEventThrottle={16} bounces alwaysBounceVertical overScrollMode="always"
    contentContainerStyle={{ flexGrow: 1, paddingBottom: config.tab ? 116 + insets.bottom : 30 + insets.bottom }}>
    <Animated.View style={contentStyle}>{children}</Animated.View>
  </Animated.ScrollView>;
  return Platform.OS === 'ios' ? content : <GestureDetector gesture={gesture} touchAction="pan-y">{content}</GestureDetector>;
}
