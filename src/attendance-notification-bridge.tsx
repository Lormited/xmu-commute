import { useEffect } from 'react';
import { Platform } from 'react-native';
import { router, useRootNavigationState } from 'expo-router';
import type { NotificationResponse } from 'expo-notifications';
import { useDemo } from './demo-context';

export function AttendanceNotificationBridge() {
  const { data: { ready } } = useDemo();
  const navigation = useRootNavigationState();
  useEffect(() => {
    if (Platform.OS !== 'android' || !ready || !navigation?.key) return;
    let active = true;
    let subscription: { remove(): void } | undefined;
    void import('expo-notifications').then(api => {
      if (!active) return;
      const seen = new Set<string>();
      async function handle(response: NotificationResponse | null) {
        if (!active || response?.actionIdentifier !== api.DEFAULT_ACTION_IDENTIFIER) return;
        const { identifier, content: { data } } = response.notification.request;
        if (seen.has(identifier)) return;
        seen.add(identifier);
        const { source, rollcallId } = data ?? {};
        if (source === 'school' && typeof rollcallId === 'string' && rollcallId.trim()) {
          router.push({ pathname: '/attendance', params: { id: rollcallId } });
        }
        const last = await api.getLastNotificationResponseAsync();
        if (active && last?.notification.request.identifier === identifier) await api.clearLastNotificationResponseAsync();
      }
      subscription = api.addNotificationResponseReceivedListener(response => { void handle(response).catch(() => {}); });
      void api.getLastNotificationResponseAsync().then(handle).catch(() => {});
    }).catch(() => {});
    return () => { active = false; subscription?.remove(); };
  }, [ready, navigation?.key]);
  return null;
}
