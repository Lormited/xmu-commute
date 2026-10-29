import { useEffect } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import Animated, { Easing, cancelAnimation, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useDemo } from './demo-context';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);
const CHECK_SHORT = Math.hypot(7, 7);
const CHECK_LENGTH = CHECK_SHORT + Math.hypot(13, 18);
const CIRCUMFERENCE = 2 * Math.PI * 32;

export function DrawnCheck({ active, size = 24, color = '#648b73', delay = 0 }: { active: boolean; size?: number; color?: string; delay?: number }) {
  const { reducedMotion } = useDemo();
  const progress = useSharedValue(active && reducedMotion ? 1 : 0);
  useEffect(() => {
    cancelAnimation(progress);
    progress.set(0);
    if (active) progress.set(reducedMotion ? 1 : withDelay(delay, withSequence(
      withTiming(CHECK_SHORT / CHECK_LENGTH, { duration: 120, easing: Easing.linear }),
      withTiming(1, { duration: 210, easing: Easing.linear }),
    )));
    return () => cancelAnimation(progress);
  }, [active, reducedMotion, delay, progress]);
  const stroke = useAnimatedProps(() => ({ strokeDashoffset: CHECK_LENGTH * (1 - progress.get()), opacity: progress.get() > 0 ? 1 : 0 }));
  return <Svg pointerEvents="none" width={size} height={size} viewBox="0 0 32 32">
    <AnimatedPath d="M6 16 L13 23 L26 5" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"
      strokeDasharray={[CHECK_LENGTH, CHECK_LENGTH]} animatedProps={stroke} />
  </Svg>;
}

export function AttendanceMark({ success }: { success: boolean }) {
  const { reducedMotion } = useDemo();
  const angle = useSharedValue(0);
  const progress = useSharedValue(success && reducedMotion ? 1 : 0.8);
  useEffect(() => {
    cancelAnimation(angle);
    cancelAnimation(progress);
    if (success) {
      angle.set(reducedMotion ? 0 : withTiming(angle.get() + 180, { duration: 420, easing: Easing.linear }));
      progress.set(withTiming(1, { duration: reducedMotion ? 0 : 420, easing: Easing.bezier(0.77, 0, 0.175, 1) }));
    } else {
      progress.set(0.8);
      angle.set(reducedMotion ? 0 : withRepeat(withTiming(angle.get() + 360, { duration: 850, easing: Easing.linear }), -1));
    }
    return () => { cancelAnimation(angle); cancelAnimation(progress); };
  }, [success, reducedMotion, angle, progress]);
  const ring = useAnimatedStyle(() => ({ transform: [{ rotate: angle.get() + 'deg' }] }));
  const arc = useAnimatedProps(() => ({ strokeDashoffset: CIRCUMFERENCE * (1 - progress.get()) }));
  return <View pointerEvents="none" style={{ width: 80, height: 80, alignItems: 'center', justifyContent: 'center' }}>
    <Animated.View style={[{ position: 'absolute', width: 80, height: 80 }, ring]}>
      <Svg width={80} height={80} viewBox="0 0 80 80">
        <AnimatedCircle cx={40} cy={40} r={32} fill="none" stroke="#648b73" strokeWidth={4} strokeLinecap="round"
          strokeDasharray={[CIRCUMFERENCE, CIRCUMFERENCE]} animatedProps={arc} />
      </Svg>
    </Animated.View>
    <DrawnCheck size={43} active={success} delay={270} />
  </View>;
}
