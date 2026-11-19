import { requireOptionalNativeModule } from 'expo';
import { randomUUID } from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { moveAsync } from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { createLearning, type Account } from './learning';
import { nextReminderWindow } from './schedule';
import { schoolDevice } from './school-device';

type JobData = { token: string };
type NativeJob = {
  schedule(at: number): Promise<void>;
  cancel(): Promise<void>;
  finish(token: string, nextAt: number | null): Promise<void>;
  isCurrent(token: string): boolean;
  addListener(event: 'onStop', listener: (data: JobData) => void): { remove(): void };
};
type SavedReminders = { enabled: boolean; issued: Record<string, string> };
const channelId = 'school-attendance';
const developPollInterval = 30000;
const job = Platform.OS === 'android' ? requireOptionalNativeModule<NativeJob>('SchoolReminderJob') : null;
export const schoolRemindersAvailable = !!job;
export const schoolLearning = createLearning(schoolDevice);
const file = (id: number) => new File(Paths.document, `school-reminders-${id}.json`);
const notifications = () => import('expo-notifications');
let pending = Promise.resolve();
let running: { token: string; stop(): void; task: Promise<void> } | undefined;

function serialize<Result>(work: () => Promise<Result>): Promise<Result> {
  const task = pending.then(work);
  pending = task.then(() => {}, () => {});
  return task;
}
function currentAccount() {
  const { ready, account, authenticated, loggingIn } = schoolLearning.getSnapshot();
  return ready && authenticated && !loggingIn ? account : null;
}
async function load(id: number): Promise<SavedReminders> {
  const saved = file(id);
  if (!saved.exists) return { enabled: false, issued: {} };
  const value = JSON.parse(await saved.text()) as SavedReminders;
  if (typeof value?.enabled !== 'boolean' || !value.issued || typeof value.issued !== 'object' || Array.isArray(value.issued)
    || !Object.values(value.issued).every(id => typeof id === 'string')) throw Error('REMINDER_STORAGE');
  return value;
}
async function save(id: number, value: SavedReminders) {
  const temporary = new File(Paths.document, `school-reminders-${id}.tmp`);
  try {
    await temporary.write(JSON.stringify(value));
    await moveAsync({ from: temporary.uri, to: file(id).uri });
  } finally { if (temporary.exists) temporary.delete(); }
}
async function permitted(prompt = false) {
  const api = await notifications();
  if (prompt) await api.setNotificationChannelAsync(channelId, { name: '签到提醒', importance: api.AndroidImportance.HIGH,
    lockscreenVisibility: api.AndroidNotificationVisibility.PRIVATE });
  const permission = await api.getPermissionsAsync();
  if (!permission.granted && (!prompt || !(await api.requestPermissionsAsync()).granted)) return false;
  const channel = await api.getNotificationChannelAsync(channelId);
  return !!channel && channel.importance !== api.AndroidImportance.NONE;
}
function nextAt(now = Date.now()) {
  const window = nextReminderWindow(schoolLearning.getSnapshot().schedule, now);
  return window ? Math.max(now, window.start) : null;
}
async function schedule(enabled: boolean) {
  if (!job) return;
  const at = enabled ? nextAt() : null;
  if (at === null) await job.cancel();
  else await job.schedule(at);
}

export function syncSchoolReminders() {
  if (!schoolRemindersAvailable) return Promise.resolve(false);
  running?.stop();
  return serialize(async () => {
    const { account } = schoolLearning.getSnapshot();
    const enabled = !!account && (await load(account.lntId)).enabled;
    const allowed = enabled && currentAccount()?.lntId === account?.lntId && await permitted();
    await schedule(allowed && currentAccount()?.lntId === account?.lntId);
    return enabled;
  });
}

export async function setSchoolReminders(enabled: boolean) {
  const account = schoolLearning.getSnapshot().account;
  if (!schoolRemindersAvailable || !account) return false;
  const id = account.lntId;
  if (enabled && (currentAccount()?.lntId !== id || !await permitted(true))) return false;
  running?.stop();
  return serialize(async () => {
    if (schoolLearning.getSnapshot().account?.lntId !== id || enabled && currentAccount()?.lntId !== id) return false;
    const saved = await load(id);
    if (!enabled) {
      try { await save(id, { ...saved, enabled }); }
      finally { await schedule(false); }
      return true;
    }
    await save(id, { ...saved, enabled });
    try { await schedule(currentAccount()?.lntId === id); }
    catch (error) { await save(id, saved); throw error; }
    return true;
  });
}

export function clearSchoolReminders(account: Account | null) {
  running?.stop();
  return serialize(async () => {
    try {
      if (account) {
        const saved = file(account.lntId);
        if (saved.exists) saved.delete();
      }
    } finally { await schedule(false); }
  });
}

export async function openSchoolReminder(identifier: string, signal: AbortSignal) {
  if (!schoolRemindersAvailable || typeof identifier !== 'string' || identifier.length !== 36 || signal.aborted) return null;
  await schoolLearning.restore();
  const account = currentAccount();
  if (!account || signal.aborted) return null;
  const { issued } = await pending.then(() => load(account.lntId));
  const id = Object.keys(issued).find(id => issued[id] === identifier);
  if (signal.aborted || currentAccount()?.lntId !== account.lntId || !id || id.startsWith('trial-')) return null;
  return schoolLearning.openReminder(account, id, signal);
}

function wait(ms: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}

async function notify(account: Account, rollcallId: string, valid: () => boolean) {
  await serialize(async () => {
    if (!valid() || rollcallId.startsWith('trial-')) return;
    const saved = await load(account.lntId);
    if (!saved.enabled || Object.hasOwn(saved.issued, rollcallId) || !valid() || !await permitted()) return;
    if (!valid()) return;
    const api = await notifications();
    const identifier = randomUUID();
    await save(account.lntId, { ...saved, issued: { ...saved.issued, [rollcallId]: identifier } });
    try {
      if (valid()) {
        await api.scheduleNotificationAsync({ identifier, content: { title: '有新的签到活动', body: '点按打开签到，由你确认提交',
          data: { source: 'school' }, sound: 'default' }, trigger: { channelId } });
        return;
      }
    } catch {
      await save(account.lntId, saved);
      throw Error('REMINDER_NOTIFICATION');
    }
    await save(account.lntId, saved);
  });
}

export function runSchoolReminderJob(token: string): Promise<void> {
  if (!job || typeof token !== 'string' || !job.isCurrent(token)) return Promise.resolve();
  if (running?.token === token) return running.task;
  const previous = running;
  previous?.stop();
  const abort = new AbortController();
  let stopped = false;
  const stop = () => { stopped = true; abort.abort(); };
  const { signal } = abort;
  const active = () => !signal.aborted && job.isCurrent(token);
  const task = (async () => {
    const listener = job.addListener('onStop', event => { if (event.token === token) stop(); });
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let following: number | null = null;
    try {
      await previous?.task;
      await pending;
      if (!active()) return;
      await schoolLearning.restore();
      const account = currentAccount();
      if (!active() || !account || !(await load(account.lntId)).enabled || !await permitted() || !active()) return;
      const now = Date.now();
      const window = nextReminderWindow(schoolLearning.getSnapshot().schedule, now);
      if (!window || window.start > now) { following = window?.start ?? null; return; }
      const valid = () => active() && Date.now() < window.end && currentAccount()?.lntId === account.lntId;
      deadline = setTimeout(() => abort.abort(), window.end - now);
      while (valid()) {
        let delay = developPollInterval;
        try {
          const rollcalls = await schoolLearning.readPendingRollcalls(account, signal);
          for (const { id } of rollcalls) {
            if (!valid()) break;
            await notify(account, id, valid);
          }
        } catch (error) {
          const { code, needsLogin } = (error as { code?: string; needsLogin?: boolean }) ?? {};
          if (needsLogin || code === 'AUTH_REQUIRED' || code === 'COOKIE_STORAGE') return;
          delay *= 2;
        }
        if (valid()) await wait(Math.min(delay, window.end - Date.now()), signal);
      }
      if (!stopped && currentAccount()?.lntId === account.lntId) following = nextAt(Math.max(Date.now(), window.end));
    } finally {
      clearTimeout(deadline);
      listener.remove();
      if (!stopped && job.isCurrent(token)) await job.finish(token, following);
    }
  })().catch(() => {}).finally(() => { if (running?.token === token) running = undefined; });
  running = { token, stop, task };
  return task;
}
