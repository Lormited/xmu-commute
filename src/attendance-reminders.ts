import type { Rollcall } from './demo-data.ts';

export type ReminderSource = 'school' | 'trial';
export type AttendanceNotice = { title: string; body: string; data: { source: ReminderSource; rollcallId: string } };

export function attendanceDestination(value: unknown) {
  const data = value as Partial<AttendanceNotice['data']> | null;
  if (!data || !['school', 'trial'].includes(data.source ?? '') || typeof data.rollcallId !== 'string'
    || !data.rollcallId.trim() || data.rollcallId.length > 160) return null;
  return { pathname: '/attendance' as const, params: { id: data.rollcallId } };
}

export function createRollcallReminder(send: (notice: AttendanceNotice) => Promise<void>) {
  const notified = new Set<string>();
  return async (rollcalls: Rollcall[], source: ReminderSource) => {
    for (const activity of rollcalls) {
      const key = source + ':' + activity.id;
      if (notified.has(key)) continue;
      notified.add(key);
      try {
        await send({ title: source === 'trial' ? '模拟签到活动' : '有新的签到活动',
          body: '点按打开签到，由你确认提交', data: { source, rollcallId: activity.id } });
      } catch (error) { notified.delete(key); throw error; }
    }
  };
}
