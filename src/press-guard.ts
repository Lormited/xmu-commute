import { useRef } from 'react';
import { canActivatePress, movedBeyondTap } from './demo-data';

export function usePressGuard(onPress: () => void) {
  const touch = useRef({ x: 0, y: 0, moved: false });
  type Pointer = { nativeEvent: { pageX: number; pageY: number } };
  function begin(event: Pointer) { touch.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY, moved: false }; }
  function track(event: Pointer) {
    const { pageX, pageY } = event.nativeEvent;
    if (movedBeyondTap(pageX, pageY, touch.current.x, touch.current.y)) touch.current.moved = true;
  }
  return {
    onTouchStart: begin,
    onTouchMove: track,
    onTouchEnd: track,
    onTouchCancel: () => { touch.current.moved = true; },
    onPointerDown: begin,
    onPointerMove: track,
    onPointerUp: track,
    onPointerCancel: () => { touch.current.moved = true; },
    onPress: (event?: { nativeEvent?: object }) => {
      if (canActivatePress(event?.nativeEvent, touch.current.moved)) onPress();
    },
  };
}
