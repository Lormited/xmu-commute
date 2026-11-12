import { DEMO_CODE, type AttendanceResult, type Method, type Rollcall } from './demo-data.ts';
import type { AttendanceReceipt } from './attendance.ts';
import { createRollcallReminder, type AttendanceNotice } from './attendance-reminders.ts';

type TrialEvent = { id: string; method: Method; outcome: AttendanceResult; availableAt: number;
  discoveredAt?: number; notifiedAt?: number; result?: 'success' | 'ended' };
export type TrialLog = { at: number; event: 'started' | 'stopped' | 'expired' | 'restored' | 'queued' | 'polled' | 'discovered' | 'notified' | 'notification-failed' | 'receipt' | 'opened'; delayMs?: number };
export type TrialDevice = {
  now(): number; load(): Promise<string | null>; save(value: string): Promise<void>;
  requestPermission(): Promise<boolean>; start(run: () => Promise<void>): Promise<void>; stop(): Promise<void>;
  wait(ms: number): Promise<void>; wake(): void; notify(notice: AttendanceNotice): Promise<void>;
};
export type TrialSnapshot = { ready: boolean; running: boolean; busy: boolean; message: string; logs: TrialLog[];
  rollcalls: Rollcall[]; attendance: Record<string, 'success' | 'ended'>;
  pendingAttendance: Record<string, 'success' | 'ended'> };
const methods = ['number', 'qr', 'radar'];
const outcomes = ['success', 'ended', 'failed'];
const logEvents = ['started', 'stopped', 'expired', 'restored', 'queued', 'polled', 'discovered', 'notified', 'notification-failed', 'receipt', 'opened'];
const trialId = (value: unknown): value is string => typeof value === 'string' && /^trial-\d+-\d+$/.test(value);
const timestamp = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const unavailable: AttendanceReceipt = { result: 'failed', message: '模拟活动不可用，请重新发起试验' };

export function createAttendanceTrial(device: TrialDevice, enabled: boolean) {
  let events: TrialEvent[] = [], generation = 0, sequence = 0;
  const submissions = new Map<string, { dismissed: boolean }>();
  let state: TrialSnapshot = { ready: !enabled, running: false, busy: false, message: '', logs: [], rollcalls: [], attendance: {}, pendingAttendance: {} };
  let restoration: Promise<void> | undefined, writing = Promise.resolve();
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<TrialSnapshot>) => {
    const pending = patch.pendingAttendance === undefined ? state.pendingAttendance : patch.pendingAttendance;
    state = { ...state, ...patch, rollcalls: events.filter(item => item.discoveredAt !== undefined).map(item => ({
      id: item.id, courseId: 'design', title: '模拟签到活动', method: item.method, outcome: item.outcome, time: '',
    })), attendance: Object.fromEntries(events.filter(item => item.result && !pending[item.id] && !submissions.has(item.id)).map(item => [item.id, item.result!])) };
    listeners.forEach(listener => listener());
  };
  const record = (event: TrialLog['event'], delayMs?: number) => publish({ logs: [...state.logs, {
    at: device.now(), event, ...(delayMs === undefined ? {} : { delayMs }),
  }].slice(-60) });
  function persist(receipt?: { event: TrialEvent; result: 'success' | 'ended' }) {
    writing = writing.catch(() => {}).then(async () => {
      if (receipt) receipt.event.result = receipt.result;
      try { await device.save(JSON.stringify({ version: 1, events, logs: state.logs })); }
      catch {
        if (receipt) receipt.event.result = undefined;
        publish({ message: '试验记录保存失败，请停止后重试' }); throw Error('TRIAL_STORAGE');
      }
    });
    return writing;
  }
  const notify = createRollcallReminder(device.notify);
  async function restore() {
    if (!enabled) return;
    if (restoration) return restoration;
    restoration = (async () => {
      try {
        const raw = await device.load();
        if (raw) {
          const saved = JSON.parse(raw);
          if (saved.version !== 1 || !Array.isArray(saved.events) || saved.events.length > 12
            || !saved.events.every((item: TrialEvent) => trialId(item.id) && methods.includes(item.method)
              && outcomes.includes(item.outcome) && timestamp(item.availableAt)
              && (['discoveredAt', 'notifiedAt'] as const).every(key => item[key] === undefined || timestamp(item[key]))
              && (item.result === undefined || ['success', 'ended'].includes(item.result)))
            || new Set(saved.events.map((item: TrialEvent) => item.id)).size !== saved.events.length
            || !Array.isArray(saved.logs) || saved.logs.length > 60
            || !saved.logs.every((item: TrialLog) => timestamp(item.at) && logEvents.includes(item.event)
              && (item.delayMs === undefined || timestamp(item.delayMs)))) throw Error('INVALID_TRIAL');
          // Keep only fixture fields; cache contents never become a school request or diagnostic payload.
          events = saved.events.map((item: TrialEvent) => ({ id: item.id, method: item.method, outcome: item.outcome,
            availableAt: item.availableAt, discoveredAt: item.discoveredAt, notifiedAt: item.notifiedAt, result: item.result }));
          publish({ logs: saved.logs.map((item: TrialLog) => ({ at: item.at, event: item.event, delayMs: item.delayMs })) });
          record('restored');
        }
      } catch { publish({ message: '未能恢复试验记录，请重新发起模拟活动' }); }
      finally { publish({ ready: true }); }
    })();
    return restoration;
  }
  async function stop(reason: 'stopped' | 'expired' = 'stopped') {
    generation++;
    const wasRunning = state.running;
    publish({ running: false, busy: enabled });
    if (!enabled) return;
    try { await device.stop(); } catch { publish({ message: '后台服务停止失败，请关闭应用后重试' }); }
    if (wasRunning) { record(reason); await persist().catch(() => {}); }
    publish({ busy: false });
  }
  async function run(token: number, until: number) {
    try {
      while (state.running && token === generation && device.now() < until) {
        record('polled');
        for (const item of events.filter(event => event.availableAt <= device.now() && !event.notifiedAt && !event.result)) {
          if (!state.running || token !== generation) return;
          if (item.discoveredAt === undefined) {
            item.discoveredAt = device.now();
            record('discovered', Math.max(0, item.discoveredAt - item.availableAt));
          }
          await persist();
          if (!state.running || token !== generation) return;
          try {
            await notify(state.rollcalls.filter(activity => activity.id === item.id), 'trial');
            item.notifiedAt = device.now(); record('notified', Math.max(0, item.notifiedAt - item.availableAt));
          } catch { record('notification-failed'); publish({ message: '系统通知发送失败，下次轮询重试' }); }
          await persist();
        }
        await persist();
        if (!state.running || token !== generation) return;
        await device.wait(20000);
      }
      if (token === generation && state.running) {
        publish({ running: false }); record('expired'); await persist();
      }
    } catch {
      publish({ message: '后台试验中断，请检查记录后重新启动' });
      if (token === generation) { publish({ running: false }); record('stopped'); }
    }
  }
  async function start() {
    if (!enabled || state.busy || state.running) return;
    const token = ++generation;
    publish({ busy: true, message: '' });
    try {
      await restore();
      if (!await device.requestPermission()) { publish({ message: '通知权限未允许，请在系统设置中允许后重试' }); return; }
      if (token !== generation) return;
      publish({ running: true }); record('started');
      await persist();
      if (token !== generation) return;
      const until = device.now() + 5 * 60000;
      await device.start(() => run(token, until));
      if (token !== generation) await device.stop();
    } catch {
      await stop(); publish({ message: '后台试验启动失败，请确认开发构建与通知权限' });
    } finally { publish({ busy: false }); }
  }
  async function queue(method: Method, outcome: AttendanceResult, delayMs: 0 | 15000 = 15000) {
    if (!enabled || !state.running || !methods.includes(method) || !outcomes.includes(outcome)) return null;
    if (events.length >= 12) { publish({ message: '本轮已有 12 个活动，请停止并清空试验后继续' }); return null; }
    const id = `trial-${device.now()}-${++sequence}`;
    events.push({ id, method, outcome, availableAt: device.now() + delayMs });
    record('queued');
    try { await persist(); if (delayMs === 0) device.wake(); return id; } catch { await stop(); return null; }
  }
  async function submit(id: string): Promise<AttendanceReceipt> {
    const item = events.find(event => event.id === id && event.discoveredAt !== undefined);
    if (!enabled || !item || item.result || submissions.has(id)) return unavailable;
    const receipt = { result: item.outcome, message: { success: '签到成功（模拟）', ended: '签到已结束（模拟）', failed: '签到失败（模拟）' }[item.outcome] };
    if (item.outcome !== 'failed') {
      const active = { dismissed: false };
      submissions.set(id, active);
      // Persist completion before acknowledging it, while the home card waits for sheet dismissal.
      try { await persist({ event: item, result: item.outcome }); }
      catch { submissions.delete(id); publish({}); return { result: 'failed', message: '模拟回执保存失败，请重试' }; }
      submissions.delete(id);
      publish(active.dismissed ? {} : { pendingAttendance: { ...state.pendingAttendance, [id]: item.outcome } });
    }
    record('receipt'); void persist().catch(() => {});
    return receipt;
  }
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => state, restore, start, stop, queue, submit,
    isTrialRollcall: (id: string) => enabled && state.rollcalls.some(item => item.id === id),
    async submitNumber(id: string, code: string): Promise<AttendanceReceipt> {
      if (code !== DEMO_CODE) return { result: 'failed', message: '模拟签到码不正确' };
      if (!events.some(item => item.id === id && item.method === 'number')) return unavailable;
      return submit(id);
    },
    attendanceDismissed(context: { ids: string[] } | { openIds: string[] }) {
      const ids = [...new Set([...Object.keys(state.pendingAttendance), ...submissions.keys()])]
        .filter(id => 'openIds' in context ? !context.openIds.includes(id) : context.ids.includes(id));
      for (const id of ids) {
        const submission = submissions.get(id);
        if (submission) submission.dismissed = true;
      }
      if (ids.some(id => state.pendingAttendance[id])) publish({ pendingAttendance: Object.fromEntries(
        Object.entries(state.pendingAttendance).filter(([id]) => !ids.includes(id))) });
    },
    opened() { if (enabled) { record('opened'); void persist().catch(() => {}); } },
    async clear() {
      if (!enabled || state.running || state.busy || submissions.size) return;
      events = []; publish({ logs: [], pendingAttendance: {}, message: '' });
      await persist().catch(() => {});
    },
  };
}
