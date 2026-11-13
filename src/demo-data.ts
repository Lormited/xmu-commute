// Every date, identity, lesson and result in this module is a fictional fixture.
export const DEMO_CODE = '0206';
export const DEMO_STUDENT_ID = '00000000000000';
export const DEMO_DAY = '2026-10-26';
export const TERM = { name: '2026—2027 学年 · 第一学期', currentWeek: 8, weeks: 18 };
export type Course = {
  id: string; title: string; teacher: string; room: string; color: string; tint: string;
};
export const courses: Course[] = [
  { id: 'design', title: '设计思维与方法', teacher: '陈老师', room: '海韵教学楼 302', color: '#78649c', tint: '#eae3f3' },
  { id: 'english', title: '大学英语', teacher: '吴老师', room: '南强二号楼 105', color: '#8b7550', tint: '#f1e8d9' },
  { id: 'math', title: '高等数学', teacher: '李老师', room: '海韵教学楼 201', color: '#648478', tint: '#e2eee7' },
  { id: 'programming', title: '程序设计基础', teacher: '周老师', room: '海韵实验楼 206', color: '#72869c', tint: '#e3ebf4' },
  { id: 'physics', title: '大学物理', teacher: '林老师', room: '南强二号楼 203', color: '#a0808c', tint: '#f2e4e9' },
  { id: 'literature', title: '中国现当代文学', teacher: '黄老师', room: '嘉庚五号楼 106', color: '#957d69', tint: '#efe7df' },
  { id: 'sport', title: '大学体育', teacher: '许老师', room: '演武运动场', color: '#7e8e68', tint: '#e8eedf' },
  { id: 'ecology', title: '生态与环境', teacher: '郑老师', room: '海韵教学楼 408', color: '#688f8d', tint: '#dfedeb' },
  { id: 'circuits', title: '数字逻辑与电路', teacher: '王老师', room: '海韵实验楼 311', color: '#8a7a9e', tint: '#eae5f0' },
];
export const periods = [
  ['08:00', '08:45'], ['08:55', '09:40'], ['10:10', '10:55'], ['11:05', '11:50'],
  ['14:30', '15:15'], ['15:25', '16:10'], ['16:30', '17:15'], ['17:25', '18:10'],
  ['19:10', '19:55'], ['20:05', '20:50'], ['21:00', '21:45'],
];
export type Session = { id: string; courseId: string; day: number; start: number; length: number; room?: string; teacher?: string; time?: string; planId?: string; weeks?: string };
export function sessionsForWeek(week: number): Session[] {
  if (!Number.isInteger(week) || week < 1 || week > TERM.weeks) return [];
  const list: Session[] = [
    { id: 'design-mon', courseId: 'design', day: 0, start: 4, length: 2 },
    { id: 'english-mon', courseId: 'english', day: 0, start: 4, length: 2 },
    { id: 'math-wed', courseId: 'math', day: 2, start: 0, length: 2 },
    { id: 'programming-mon', courseId: 'programming', day: 0, start: 8, length: 2 },
    { id: 'physics-tue', courseId: 'physics', day: 1, start: 0, length: 2 },
    { id: 'literature-tue', courseId: 'literature', day: 1, start: 4, length: 2 },
    { id: 'sport-wed', courseId: 'sport', day: 2, start: 6, length: 2 },
    { id: 'programming-thu', courseId: 'programming', day: 3, start: 2, length: 2 },
    { id: 'circuits-thu', courseId: 'circuits', day: 3, start: 4, length: 3 },
    { id: 'ecology-fri', courseId: 'ecology', day: 4, start: 4, length: 2 },
    { id: 'physics-conflict', courseId: 'physics', day: 3, start: 5, length: 2 },
    week % 2 === 1
      ? { id: 'math-fri', courseId: 'math', day: 4, start: 2, length: 2 }
      : { id: 'circuits-fri', courseId: 'circuits', day: 4, start: 2, length: 2 },
  ];
  return list;
}
export function pageAtOffset(offset: number, width: number, min: number, max: number, origin = min) {
  'worklet';
  if (width <= 0) return min;
  const position = min + offset / width;
  // Anchor to the gesture start so an early label update cannot flip itself back.
  const page = position >= origin ? Math.floor(position + 0.6) : Math.ceil(position - 0.6);
  return Math.max(min, Math.min(max, page));
}
export function movedBeyondTap(x: number, y: number, startX: number, startY: number) {
  return Math.hypot(x - startX, y - startY) > 8;
}
export function canActivatePress(event: object | undefined, moved: boolean) {
  return !event || ('detail' in event && event.detail === 0) || !('pageX' in event) || !moved;
}
export const REFRESH_THRESHOLD = 64;
export function shouldRefresh(distance: number, enabled: boolean, refreshing: boolean) {
  'worklet';
  return enabled && !refreshing && distance >= REFRESH_THRESHOLD;
}
export type SessionGroup = { day: number; start: number; end: number; sessions: Session[] };
export function groupSessions(sessions: Session[]): SessionGroup[] {
  const groups: SessionGroup[] = [];
  for (const session of [...sessions].sort((a, b) => a.day - b.day || a.start - b.start || b.length - a.length)) {
    const previous = groups.at(-1);
    if (previous && previous.day === session.day && session.start < previous.end) {
      previous.sessions.push(session);
      previous.end = Math.max(previous.end, session.start + session.length);
    } else groups.push({ day: session.day, start: session.start, end: session.start + session.length, sessions: [session] });
  }
  return groups;
}
export function courseFor(id: string, longText = false): Course | undefined {
  const course = courses.find(item => item.id === id);
  if (!course) return;
  return longText && id === 'design'
    ? { ...course, title: '跨学科设计思维与可持续校园公共空间实践研究', room: '海韵教学楼南翼创新实践中心 302 多功能研讨室', teacher: '陈老师、周老师（联合授课）' }
    : course;
}
export function sessionTime(session: Session) {
  return session.time ?? (periods[session.start][0] + ' — ' + periods[session.start + session.length - 1][1]);
}
export function weekDays(week: number) {
  return Array.from({ length: 7 }, (_, day) => {
    const date = new Date(Date.UTC(2026, 8, 7 + (week - 1) * 7 + day));
    return { label: ['一', '二', '三', '四', '五', '六', '日'][day], date: date.getUTCDate(), month: date.getUTCMonth() + 1, today: date.toISOString().slice(0, 10) === DEMO_DAY };
  });
}
export type Todo = { id: string; title: string; course: string; type: string; deadline: string | null; locked?: boolean };
export const todos: Todo[] = [
  { id: 'reading', title: '阅读：设计中的设计', course: '设计思维与方法', type: 'homework', deadline: '明天 18:00' },
  { id: 'writing', title: 'Unit 4 · A letter to the future', course: '大学英语', type: 'homework', deadline: '后天 23:59' },
  { id: 'coding', title: '实验三：循环与数组', course: '程序设计基础', type: 'homework', deadline: '周四 22:00' },
  { id: 'calculus', title: '第三章习题：导数的应用', course: '高等数学', type: 'homework', deadline: '周五 18:00' },
  { id: 'physics-report', title: '实验报告：测量与误差分析', course: '大学物理', type: 'homework', deadline: '周五 23:59' },
  { id: 'literature-notes', title: '《边城》阅读札记', course: '中国现当代文学', type: 'homework', deadline: '周六 18:00' },
  { id: 'ecology-observation', title: '校园植物观察记录', course: '生态与环境', type: 'homework', deadline: '周日 20:00' },
  { id: 'logic', title: '组合逻辑电路设计', course: '数字逻辑与电路', type: 'homework', deadline: '11月2日 23:59' },
  { id: 'english-audio', title: 'Listening practice · Week 8', course: '大学英语', type: 'homework', deadline: '11月3日 18:00' },
  { id: 'survey', title: '本周课堂学习反馈', course: '高等数学', type: 'questionnaire', deadline: null },
];
export function todoFixtures(longText: boolean): Todo[] {
  return longText ? [
    { ...todos[0], title: '阅读与讨论：从以人为中心的设计到校园公共空间的可持续更新——小组资料整理与阶段性报告' },
    ...todos.slice(1),
    { id: 'unknown', title: '课程新增活动', course: '跨学科课程与联合教学实践', type: 'new_activity_type', deadline: null, locked: true },
  ] : todos;
}
export type Method = 'number' | 'qr' | 'radar';
export const methodLabel: Record<Method, string> = { number: '数字签到', qr: '二维码签到', radar: '雷达签到' };
export type AttendanceResult = 'success' | 'ended' | 'failed';
export type Rollcall = { id: string; courseId: string; method: Method; time: string; title?: string; outcome?: AttendanceResult };
export function cleanCode(input: string) { return input.replace(/\D/g, '').slice(0, 4); }
export function codeResult(code: string, outcome: AttendanceResult): AttendanceResult | 'incomplete' {
  if (!/^\d{4}$/.test(code)) return 'incomplete';
  return code === DEMO_CODE ? outcome : 'failed';
}
export type HistoryItem = { id: string; course: string; date: string; time: string; type: string; status: 'success' | 'absent'; detail?: string | null; at?: number };
export const historyFixtures: HistoryItem[] = [
  { id: 'past-1', course: '高等数学', date: '2026-10-23', time: '10:10', type: '教师点名', status: 'success' },
  { id: 'past-2', course: '大学英语', date: '2026-10-22', time: '16:30', type: methodLabel.number, status: 'success' },
  { id: 'past-3', course: '设计思维与方法', date: '2026-10-19', time: '14:30', type: '二维码签到', status: 'absent' },
  { id: 'past-4', course: '高等数学', date: '2026-10-16', time: '10:10', type: '教师点名', status: 'absent' },
];
export function historyLabel(status: HistoryItem['status']) {
  return status === 'success' ? '已签到' : '缺勤';
}
export function historyDate(date = new Date()) {
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
export function visibleHistory(items: HistoryItem[], filter: 'today' | 'all', day = historyDate()) {
  return items.filter(item => filter === 'all' || item.date === day).sort((a, b) => a.at != null && b.at != null ? b.at - a.at : (b.date + b.time).localeCompare(a.date + a.time));
}
