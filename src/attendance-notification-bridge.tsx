import { useEffect } from 'react';
import { Platform } from 'react-native';
import { router, useRootNavigationState } from 'expo-router';
import { useDemo } from './demo-context';
import { attendanceDestination } from './attendance-reminders';
import { watchAttendanceNotifications } from './attendance-trial-device';

export function AttendanceNotificationBridge() {
  const { trial } = useDemo();
  const navigation = useRootNavigationState();
  useEffect(() => {
    if (Platform.OS !== 'android' || !navigation?.key) return;
    let active = true, cleanup: (() => void) | undefined;
    void watchAttendanceNotifications(async value => {
      const target = attendanceDestination(value);
      if (!target) return;
      await trial.restore();
      if (!active) throw Error('NOTIFICATION_BRIDGE_CLOSED');
      if ((value as { source: string }).source === 'trial' && !trial.isTrialRollcall(target.params.id)) return;
      trial.opened();
      router.push(target);
    }).then(remove => { if (active) cleanup = remove; else remove(); }).catch(() => {});
    return () => { active = false; cleanup?.(); };
  }, [trial, navigation?.key]);
  return null;
}
