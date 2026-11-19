import { requireOptionalNativeModule } from 'expo';
import { randomUUID } from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { moveAsync } from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { createLearning, type Account } from './learning';
import { nextReminderWindow, type SchoolSchedule } from './schedule';
import { schoolDevice } from './school-device';

type JobData = { token: string };
type NativeJob = {
  schedule(at: number): Promise<void>;
  cancel(): Promise<void>;
  finish(token: string, nextAt: number | null): Promise<void>;
  post(token: string, identifier: string, endAt: number, rollcallId: string): Promise<boolean>;
  isCurrent(token: string): boolean;
  addListener(event: 'onStop', listener: (data: JobData) => void): { remove(): void };
};
type SavedNotice = { identifier: string; delivered: boolean };
type SavedReminders = { accountId: number; enabled: boolean; issued: Record<string, SavedNotice> };
const channelId = 'school-attendance';
const developPollInterval = 30000;
const job = Platform.OS === 'android' ? requireOptionalNativeModule<NativeJob>('SchoolReminderJob') : null;
export const schoolRemindersAvailable = !!job;
export const schoolLearning = createLearning(schoolDevice, Date.now, () => running?.scope?.valid() === true);
const file = () => new File(Paths.document, 'school-reminders.json');
const temporaryFile = () => new File(Paths.document, 'school-reminders.tmp');
const notifications = () => import('expo-notifications');
let pending = Promise.resolve();
let running: { token: string; stop(): void; task: Promise<void>;
  scope?: { schedule: SchoolSchedule | null; valid(): boolean } } | undefined;

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
  const empty = { accountId: id, enabled: false, issued: {} };
  const saved = file();
  if (!saved.exists) return empty;
  const value = JSON.parse(await saved.text()) as SavedReminders;
  if (!value || !Number.isSafeInteger(value.accountId) || value.accountId <= 0
    || typeof value.enabled !== 'boolean' || !value.issued || typeof value.issued !== 'object' || Array.isArray(value.issued)
    || !Object.values(value.issued).every(notice => typeof notice?.identifier === 'string' && notice.identifier.length === 36
      && typeof notice.delivered === 'boolean')) throw Error('REMINDER_STORAGE');
  return value.accountId === id ? value : empty;
}
export async function readSchoolRemindersEnabled() {
  const account = currentAccount();
  if (!schoolRemindersAvailable || !account) return false;
  const saved = await load(account.lntId).catch(() => null);
  return saved?.enabled === true && currentAccount()?.lntId === account.lntId;
}
async function save(value: SavedReminders) {
  const temporary = temporaryFile();
  try {
    await temporary.write(JSON.stringify(value));
    await moveAsync({ from: temporary.uri, to: file().uri });
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
  return serialize(async () => {
    const { account } = schoolLearning.getSnapshot();
    const enabled = !!account && (await load(account.lntId)).enabled;
    const allowed = enabled && currentAccount()?.lntId === account?.lntId && await permitted();
    const accountId = currentAccount()?.lntId;
    const scope = running?.scope;
    if (allowed && scope?.valid() && scope.schedule === schoolLearning.getSnapshot().schedule) return enabled;
    running?.stop();
    await schedule(allowed && accountId === account?.lntId);
    return enabled;
  });
}

export async function setSchoolReminders(enabled: boolean) {
  const account = schoolLearning.getSnapshot().account;
  if (!schoolRemindersAvailable || !account) return false;
  const id = account.lntId;
  if (enabled && (currentAccount()?.lntId !== id || !await permitted(true))) return false;
  running?.stop();
  if (!enabled) void job?.cancel().catch(() => {});
  return serialize(async () => {
    if (schoolLearning.getSnapshot().account?.lntId !== id || enabled && currentAccount()?.lntId !== id) return false;
    if (!enabled) {
      try { await save({ ...await load(id), enabled }); }
      finally { await schedule(false); }
      return true;
    }
    const saved = await load(id);
    await save({ ...saved, enabled });
    try { await schedule(currentAccount()?.lntId === id); }
    catch (error) { await save(saved); throw error; }
    return true;
  });
}

export function clearSchoolReminders() {
  running?.stop();
  void job?.cancel().catch(() => {});
  return serialize(async () => {
    try {
      for (const saved of [file(), temporaryFile()]) {
        if (saved.exists) saved.delete();
      }
    } finally { await schedule(false); }
  });
}

function wait(ms: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}

async function untilAborted(task: Promise<void>, signal: AbortSignal) {
  let abort!: () => void;
  const aborted = new Promise<void>(resolve => { abort = resolve; });
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
  try { await Promise.race([task, aborted]); }
  finally { signal.removeEventListener('abort', abort); }
}

async function notify(job: NativeJob, token: string, account: Account, rollcallId: string, endAt: number, valid: () => boolean) {
  await serialize(async () => {
    if (!valid()) return;
    const saved = await load(account.lntId);
    const notice = Object.hasOwn(saved.issued, rollcallId) ? saved.issued[rollcallId] : undefined;
    if (!saved.enabled || notice?.delivered || !valid() || !await permitted()) return;
    if (!valid()) return;
    const identifier = notice?.identifier ?? randomUUID();
    if (!notice) await save({ ...saved, issued: { ...saved.issued, [rollcallId]: { identifier, delivered: false } } });
    if (!valid()) return;
    if (!await job.post(token, identifier, endAt, rollcallId)) return;
    if (!valid()) { await (await notifications()).dismissNotificationAsync(identifier); return; }
    await save({ ...saved, issued: { ...saved.issued, [rollcallId]: { identifier, delivered: true } } });
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
    try {
      await previous?.task;
      await untilAborted(pending, signal);
      if (!active()) return null;
      if (!await schoolLearning.restore()) throw Error('LEARNING_RESTORE');
      const account = currentAccount();
      if (!active() || !account || !(await load(account.lntId)).enabled || !await permitted() || !active()) return null;
      const now = Date.now();
      const { schedule } = schoolLearning.getSnapshot();
      const window = nextReminderWindow(schedule, now);
      if (!window || window.start > now) return window?.start ?? null;
      const valid = () => active() && Date.now() < window.end && currentAccount()?.lntId === account.lntId;
      if (running?.token === token) running.scope = { schedule, valid };
      deadline = setTimeout(() => abort.abort(), window.end - now);
      while (valid()) {
        let delay = developPollInterval;
        try {
          const rollcalls = await schoolLearning.refreshPendingRollcalls(account, signal, valid);
          for (const { id } of rollcalls) {
            if (!valid()) break;
            await untilAborted(notify(job, token, account, id, window.end, valid), signal);
          }
        } catch (error) {
          const { code, needsLogin } = (error as { code?: string; needsLogin?: boolean }) ?? {};
          if (needsLogin || code === 'AUTH_REQUIRED' || code === 'COOKIE_STORAGE') return null;
          delay *= 2;
        }
        if (valid()) await wait(Math.min(delay, window.end - Date.now()), signal);
      }
      return currentAccount()?.lntId === account.lntId ? nextAt(Math.max(Date.now(), window.end)) : null;
    } finally {
      clearTimeout(deadline);
      listener.remove();
    }
  })().then(async following => {
    if (!stopped && job.isCurrent(token)) await job.finish(token, following);
  }).catch(() => {}).finally(() => { if (running?.token === token) running = undefined; });
  running = { token, stop, task };
  return task;
}
