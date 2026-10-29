import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FlatList, Platform, View } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { pageAtOffset } from './demo-data';
import { PageScroll } from './page-scroll';
import { useDemo } from './demo-context';

export function SwipePages({ index, min = 0, max, onChange, children }: {
  index: number; min?: number; max: number; onChange: (index: number) => void; children: (index: number) => ReactNode;
}) {
  const list = useRef<FlatList<number>>(null);
  const [{ width, height }, setSize] = useState({ width: 0, height: 0 });
  const pages = useMemo(() => Array.from({ length: max - min + 1 }, (_, i) => min + i), [min, max]);
  const reported = useRef(index);
  const previousWidth = useRef(0);
  const callback = useRef(onChange);
  const { reducedMotion } = useDemo();
  const current = useSharedValue(index);
  const announced = useSharedValue(index);
  const origin = useSharedValue(index);
  const target = useSharedValue(-1);
  useLayoutEffect(() => { callback.current = onChange; }, [onChange]);
  const report = useCallback((page: number) => {
    reported.current = page;
    callback.current(page);
  }, []);
  const scroll = useAnimatedScrollHandler({
    onBeginDrag: event => {
      target.set(-1);
      origin.set(width > 0 ? min + Math.round(event.contentOffset.x / width) : min);
    },
    onScroll: event => {
      if (width <= 0) return;
      if (target.get() !== -1) {
        if (Math.abs(event.contentOffset.x - (target.get() - min) * width) > 1) return;
        target.set(-1);
      }
      current.set(pageAtOffset(event.contentOffset.x, width, min, max, origin.get()));
    },
  });
  useAnimatedReaction(() => current.get(), page => {
    if (page !== announced.get()) {
      announced.set(page);
      scheduleOnRN(report, page);
    }
  });
  useLayoutEffect(() => {
    if (index !== reported.current || width !== previousWidth.current) {
      const animated = previousWidth.current > 0 && width === previousWidth.current && !reducedMotion;
      origin.set(current.get());
      target.set(index);
      reported.current = index;
      announced.set(index);
      current.set(index);
      if (width > 0) list.current?.scrollToOffset({ offset: (index - min) * width, animated });
    }
    previousWidth.current = width;
    if (Platform.OS === 'web' && document.activeElement instanceof HTMLElement && document.activeElement.closest('[aria-hidden="true"]')) document.activeElement.blur();
  }, [index, min, width, reducedMotion, announced, current, origin, target]);
  return <View style={{ flex: 1 }} onLayout={event => {
    const next = event.nativeEvent.layout;
    setSize(previous => previous.width === next.width && previous.height === next.height ? previous : { width: next.width, height: next.height });
  }}>
    {width > 0 && height > 0 && <Animated.FlatList ref={list} data={pages} horizontal pagingEnabled directionalLockEnabled nestedScrollEnabled
      initialScrollIndex={index - min} getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
      keyExtractor={page => String(page)} initialNumToRender={3} windowSize={3} maxToRenderPerBatch={3} removeClippedSubviews={false}
      showsHorizontalScrollIndicator={false} bounces overScrollMode="always" onScroll={scroll} scrollEventThrottle={16}
      renderItem={({ item: page }) => <View style={{ width, height }} pointerEvents={page === index ? 'auto' : 'none'}
        aria-hidden={page !== index} accessibilityElementsHidden={page !== index} importantForAccessibility={page === index ? 'auto' : 'no-hide-descendants'}>
        <PageScroll>{children(page)}</PageScroll>
      </View>} />}
  </View>;
}
