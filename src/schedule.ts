import { courses as courseColors, sessionTime, type Course, type Session } from './demo-data.ts';
import type { LearningSnapshot, SchoolDevice } from './learning.ts';

export function currentCourseIndex(sessions: Session[], now = new Date()) {
  const time = now.toTimeString().slice(0, 5);
  const index = sessions.findIndex(session => sessionTime(session).slice(-5) > time);
  return index === -1 ? sessions.length - 1 : index;
}

export type SchoolPeriod = { DM: number; MC: string; KSSJ: string; JSSJ: string; JCFADM: string };
export type SchoolScheduleRow = { WID: string; BJDM: string; KCMC: string; JASMC: string; JSXM: string;
  XQ: number; KSJCDM: number; JSJCDM: number; KSSJ: string; JSSJ: string; ZCMC: string; JCFADM: string };
export type ScheduleTerm = { jwTermCode: string; name: string; currentWeek: number; weeks: number[] };
export type SchoolSchedule = ScheduleTerm & { weekAt: number; rows: SchoolScheduleRow[]; periods: SchoolPeriod[] };
function number(value: unknown) {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || (parsed as number) < 1) throw Error('INVALID_SCHEDULE');
  return parsed as number;
}
function text(value: unknown) {
  if (typeof value !== 'string') throw Error('INVALID_SCHEDULE');
  return value;
}
function time(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number' || value === '') throw Error('INVALID_SCHEDULE');
  const raw = String(value).replace(':', '').padStart(4, '0');
  if (!/^([01]\d|2[0-3])[0-5]\d$/.test(raw)) throw Error('INVALID_SCHEDULE');
  return raw.slice(0, 2) + ':' + raw.slice(2);
}
export function scheduleFrom(rowsValue: unknown, periodsValue: unknown, jwTermCode: string) {
  const response = rowsValue as { success?: boolean; pkjgList?: unknown } | null;
  const periodResponse = periodsValue as { success?: boolean; data?: unknown } | null;
  if (response?.success !== true || !Array.isArray(response.pkjgList)
    || periodResponse?.success === false || !Array.isArray(periodResponse?.data)) throw Error('INVALID_SCHEDULE');
  const periods = periodResponse.data.map(row => ({ DM: number(row?.DM), MC: text(row?.MC),
    KSSJ: time(row?.KSSJ), JSSJ: time(row?.JSSJ), JCFADM: text(row?.JCFADM) }));
  const rows = response.pkjgList.map(row => ({ WID: text(row?.WID), BJDM: text(row?.BJDM), KCMC: text(row?.KCMC),
    JASMC: row?.JASMC == null ? '' : text(row.JASMC), JSXM: row?.JSXM == null ? '' : text(row.JSXM),
    XQ: number(row?.XQ), KSJCDM: number(row?.KSJCDM), JSJCDM: number(row?.JSJCDM),
    KSSJ: time(row?.KSSJ), JSSJ: time(row?.JSSJ), ZCMC: text(row?.ZCMC), JCFADM: text(row?.JCFADM) }));
  rows.forEach(row => teachingWeeks(row.ZCMC));
  if (periods.some(period => period.DM > 100 || period.KSSJ >= period.JSSJ) || rows.some(row => row.XQ > 7 || row.KSJCDM > row.JSJCDM || row.KSSJ >= row.JSSJ
    || !periods.some(period => period.JCFADM === row.JCFADM && period.DM === row.KSJCDM)
    || !periods.some(period => period.JCFADM === row.JCFADM && period.DM === row.JSJCDM))) throw Error('INVALID_SCHEDULE');
  return { jwTermCode, rows, periods };
}
function termsFrom(value: unknown): Pick<ScheduleTerm, 'jwTermCode' | 'name'>[] {
  const response = value as { success?: boolean; datas?: { kfdxnxqcx?: { rows?: unknown } } } | null;
  const rows = response?.datas?.kfdxnxqcx?.rows;
  if (response?.success === false || !Array.isArray(rows)) throw Error('INVALID_TERMS');
  return rows.map(row => {
    const code = row?.XNXQDM ?? row?.DM, name = row?.XNXQDM_DISPLAY ?? row?.MC;
    if (typeof code !== 'string' || !/^\d{4}[123]$/.test(code) || typeof name !== 'string') throw Error('INVALID_TERMS');
    return { jwTermCode: code, name };
  }).sort((a, b) => b.jwTermCode.localeCompare(a.jwTermCode));
}
function weekNumber(value: unknown): number {
  const number = typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(number)) throw Error('INVALID_WEEKS');
  return number as number;
}
function weeksFrom(value: unknown): Pick<ScheduleTerm, 'currentWeek' | 'weeks'> {
  const response = value as { success?: boolean; currentZc?: unknown; zcList?: { ZC?: unknown }[] } | null;
  if (response?.success !== true || !Array.isArray(response.zcList) || !Object.hasOwn(response, 'currentZc')) throw Error('INVALID_WEEKS');
  const weeks = [...new Set(response.zcList.map(row => weekNumber(row?.ZC)))].sort((a, b) => a - b);
  if (weeks.some(week => week < 1)) throw Error('INVALID_WEEKS');
  return { currentWeek: response.currentZc == null || response.currentZc === '' ? 0 : weekNumber(response.currentZc), weeks };
}
export async function readSchedule(device: SchoolDevice, studentNumber: string, now = Date.now): Promise<SchoolSchedule> {
  for (const candidate of termsFrom(await device.read('jwTerms'))) {
    const week = weeksFrom(await device.read('jwWeek', { jwTermCode: candidate.jwTermCode }));
    if (!week.weeks.includes(week.currentWeek)) continue;
    const weekAt = now();
    const params = { jwTermCode: candidate.jwTermCode, studentNumber };
    const [rows, periods] = await Promise.all([device.read('jwSchedule', params), device.read('jwPeriods', params)]);
    return { ...scheduleFrom(rows, periods, candidate.jwTermCode), ...candidate, ...week, weekAt };
  }
  throw Error('NO_CURRENT_TERM');
}

function teachingWeeks(value: string) {
  const parts = value.replace(/[（）()第\s]/g, '').replace(/[，、；;]/g, ',').replace(/[–—－~～]/g, '-').split(',');
  const standalone = parts.filter(part => /^(单|双)周?$/.test(part));
  if (standalone.length > 1 || parts.length === standalone.length) throw Error('INVALID_SCHEDULE_WEEKS');
  const globalParity = standalone.length === 1 ? standalone[0][0] : undefined;
  return parts.filter(part => !standalone.includes(part)).map(part => {
    const match = /^(\d+)(?:-(\d+))?周?(单双|单|双)?周?$/.exec(part);
    const start = Number(match?.[1]), end = Number(match?.[2] ?? match?.[1]);
    if (!match || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) throw Error('INVALID_SCHEDULE_WEEKS');
    return { start, end, parity: match[3] ?? globalParity };
  });
}
function monday(date: Date) {
  const result = new Date(date); result.setHours(12, 0, 0, 0);
  result.setDate(result.getDate() - (result.getDay() + 6) % 7);
  return result;
}
export function schoolScheduleView(data: Pick<LearningSnapshot, 'courses' | 'scheduleAt' | 'schedule'>, now = new Date()) {
  const schedule = data.schedule;
  const term = schedule;
  const grouped = new Map<string, SchoolScheduleRow[]>();
  for (const row of schedule?.rows ?? []) {
    const ranges = teachingWeeks(row.ZCMC);
    const weeks = term!.weeks.filter(week => ranges.some(range => week >= range.start && week <= range.end
      && (range.parity === '单' ? week % 2 === 1 : range.parity === '双' ? week % 2 === 0 : true)));
    const key = JSON.stringify([row.BJDM, weeks, row.XQ, row.KSSJ, row.JSSJ, row.KSJCDM, row.JSJCDM, row.JCFADM]);
    const group = grouped.get(key);
    if (group) group.push(row); else grouped.set(key, [row]);
  }
  const rows = [...grouped.values()].map(group => ({ ...group[0],
    JASMC: [...new Set(group.map(row => row.JASMC).filter(Boolean))].join('、'),
    JSXM: [...new Set(group.map(row => row.JSXM).filter(Boolean))].join('、'),
  }));
  const anchor = monday(new Date(schedule?.weekAt ?? data.scheduleAt ?? now.getTime()));
  const currentWeek = (term?.currentWeek ?? 1) + Math.round((monday(now).getTime() - anchor.getTime()) / 604800000);
  const courseId = (row: SchoolScheduleRow) => String(data.courses.find(course => course.course_code === row.BJDM)?.id ?? 'jw:' + row.BJDM);
  const sections = schedule?.periods.filter(period => !rows.length || rows.some(row => row.JCFADM === period.JCFADM)) ?? [];
  const periods = Array.from({ length: sections.length ? Math.max(...sections.map(period => period.DM)) : 11 }, (_, index): [string, string] => {
    const times = sections.filter(period => period.DM === index + 1), first = times[0];
    return first && times.every(period => period.KSSJ === first.KSSJ && period.JSSJ === first.JSSJ) ? [first.KSSJ, first.JSSJ] : ['', ''];
  });
  const sessions: Session[] = rows.map((row, index) => ({
    id: row.WID + ':' + index, courseId: courseId(row), day: row.XQ - 1, start: row.KSJCDM - 1,
    length: row.JSJCDM - row.KSJCDM + 1, room: row.JASMC, teacher: row.JSXM,
    time: row.KSSJ + ' — ' + row.JSSJ, planId: row.JCFADM, weeks: row.ZCMC,
  }));
  const courseIds = [...new Set([...data.courses.map(course => String(course.id)), ...sessions.map(session => session.courseId)])];
  return {
    sessions, periods,
    name: term?.name ?? '当前学期', currentWeek, minWeek: term?.weeks[0] ?? 1, weeks: term?.weeks.at(-1) ?? 1,
    sessionsForWeek(week: number): Session[] {
      if (!term?.weeks.includes(week)) return [];
      return sessions.filter(session => teachingWeeks(session.weeks!).some(range => week >= range.start && week <= range.end
        && (range.parity === '单' ? week % 2 === 1 : range.parity === '双' ? week % 2 === 0 : true)));
    },
    courseFor(id: string, session?: Session): Course | undefined {
      const row = session ? rows.find((row, index) => row.WID + ':' + index === session.id && courseId(row) === id) : rows.find(row => courseId(row) === id);
      const course = data.courses.find(course => String(course.id) === id);
      if (!row && !course) return;
      const appearance = courseColors[courseIds.indexOf(id) % courseColors.length];
      return { id, title: row?.KCMC ?? course!.name, teacher: row?.JSXM ?? '', room: row?.JASMC ?? '', color: appearance.color, tint: appearance.tint };
    },
    weekDays(week: number) {
      return Array.from({ length: 7 }, (_, day) => {
        const date = new Date(anchor); date.setDate(date.getDate() + (week - (term?.currentWeek ?? 1)) * 7 + day);
        return { label: ['一', '二', '三', '四', '五', '六', '日'][day], date: date.getDate(), month: date.getMonth() + 1, today: date.toDateString() === now.toDateString() };
      });
    },
  };
}
