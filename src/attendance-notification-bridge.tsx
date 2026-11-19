import { useEffect } from 'react';
import { Platform } from 'react-native';
import { router, useRootNavigationState } from 'expo-router';
import { useDemo } from './demo-context';
import { attendanceDestination } from './attendance-reminders';
import { watchAttendanceNotifications } from './attendance-trial-device';
import { openSchoolReminder } from './school-reminder-device';

export function AttendanceNotificationBridge() {
  const { real, trial } = useDemo();
  const navigation = useRootNavigationState();
  useEffect(() => {
    if (Platform.OS !== 'android' || !navigation?.key) return;
    const scope = new AbortController();
    let cleanup: (() => void) | undefined;
    void watchAttendanceNotifications(async (value, identifier) => {
      if ((value as { source?: string } | null)?.source === 'school') {
        if (!real) return;
        const id = await openSchoolReminder(identifier, scope.signal);
        if (scope.signal.aborted) throw Error('NOTIFICATION_BRIDGE_CLOSED');
        if (id) router.push({ pathname: '/attendance', params: { id } });
        return;
      }
      const target = attendanceDestination(value);
      if (!target) return;
      await trial.restore();
      if (scope.signal.aborted) throw Error('NOTIFICATION_BRIDGE_CLOSED');
      if (!trial.isTrialRollcall(target.params.id)) return;
      trial.opened();
      router.push(target);
    }).then(remove => { if (scope.signal.aborted) remove(); else cleanup = remove; }).catch(() => {});
    return () => { scope.abort(); cleanup?.(); };
  }, [real, trial, navigation?.key]);
  return null;
}
