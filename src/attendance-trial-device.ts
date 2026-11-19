import type { TrialDevice } from './attendance-trial.ts';
import type { AttendanceNotice } from './attendance-reminders.ts';

const channelId = 'attendance-trial';
let waking: (() => void) | undefined;
let running: Promise<void> | undefined;
let wakePending = false;
const notifications = () => import('expo-notifications');
const service = async () => (await import('react-native-background-actions')).default;
async function cache() {
  const { File, Paths } = await import('expo-file-system');
  return new File(Paths.document, 'attendance-trial.json');
}

export const attendanceTrialDevice: TrialDevice = {
  now: Date.now,
  async load() { const file = await cache(); return file.exists ? file.text() : null; },
  async save(value) {
    const { File, Paths } = await import('expo-file-system');
    const { moveAsync } = await import('expo-file-system/legacy');
    const temporary = new File(Paths.document, 'attendance-trial.tmp');
    await temporary.write(value);
    await moveAsync({ from: temporary.uri, to: (await cache()).uri });
  },
  async requestPermission() {
    const api = await notifications();
    await api.setNotificationChannelAsync(channelId, { name: '模拟签到提醒', importance: api.AndroidImportance.HIGH,
      lockscreenVisibility: api.AndroidNotificationVisibility.PUBLIC });
    const current = await api.getPermissionsAsync();
    return current.granted || (await api.requestPermissionsAsync()).granted;
  },
  async start(run) {
    const background = await service();
    wakePending = false;
    await background.start(() => { running = run(); return running; }, {
      taskName: 'AttendanceTrial', taskTitle: '厦课提醒试验正在运行', taskDesc: '每 20 秒检查模拟活动；5 分钟后停止',
      taskIcon: { name: 'ic_launcher', type: 'mipmap' }, linkingURI: 'xmuc://lab', foregroundServiceType: ['dataSync'],
    });
  },
  async stop() {
    waking?.();
    await running;
    await (await service()).stop();
    running = undefined;
  },
  wake() { if (waking) waking(); else wakePending = true; },
  wait(ms) {
    if (wakePending) { wakePending = false; return Promise.resolve(); }
    return new Promise(resolve => {
      const finish = () => { clearTimeout(timer); waking = undefined; resolve(); };
      const timer = setTimeout(finish, ms);
      waking = finish;
    });
  },
  async notify(content: AttendanceNotice) {
    const api = await notifications();
    await api.scheduleNotificationAsync({ content: { ...content, sound: 'default' }, trigger: { channelId } });
  },
};

export async function watchAttendanceNotifications(open: (data: unknown, identifier: string) => Promise<void>) {
  const api = await notifications();
  api.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true,
    shouldPlaySound: true, shouldSetBadge: false }) });
  const seen = new Set<string>();
  async function handle(response: import('expo-notifications').NotificationResponse | null) {
    if (!response || response.actionIdentifier !== api.DEFAULT_ACTION_IDENTIFIER) return;
    const id = response.notification.request.identifier;
    if (seen.has(id)) return;
    seen.add(id);
    try {
      await open(response.notification.request.content.data, id);
      await api.clearLastNotificationResponseAsync();
    } catch { seen.delete(id); }
  }
  const listener = api.addNotificationResponseReceivedListener(response => { void handle(response); });
  void api.getLastNotificationResponseAsync().then(handle).catch(() => {});
  return () => listener.remove();
}
