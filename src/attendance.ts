import type { AttendanceResult, Rollcall } from './demo-data.ts';

export type AttendanceReceipt = { result: AttendanceResult; message: string };
export type CompletedAttendance = Record<string, 'success' | 'ended'>;
const identifier = (value: unknown) => typeof value === 'string' && value.trim() ? value
  : Number.isSafeInteger(value) && (value as number) > 0 ? String(value) : '';

export function rollcallsFrom(value: unknown): Rollcall[] {
  const body = value as { success?: unknown; rollcalls?: unknown } | null;
  if (body?.success === false || !Array.isArray(body?.rollcalls)) throw Error('INVALID_ROLLCALLS');
  const ids = new Set<string>();
  return body.rollcalls.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw Error('INVALID_ROLLCALLS');
    const id = identifier(item.rollcall_id) || identifier(item.id);
    const courseId = identifier(item.course_id) || identifier(item.course?.id);
    if (!id || !courseId || ids.has(id) || ['is_number', 'is_radar'].some(key => item[key] != null && typeof item[key] !== 'boolean')) throw Error('INVALID_ROLLCALLS');
    ids.add(id);
    const title = [item.course_title, item.course_name].find(text => typeof text === 'string' && text.trim()) ?? '签到活动';
    return { id, courseId, title, method: item.is_radar ? 'radar' : item.is_number ? 'number' : 'qr',
      time: typeof item.rollcall_time === 'string' ? item.rollcall_time : '' };
  });
}

export function numberReceipt(httpStatus: number, value: unknown): AttendanceReceipt {
  if (value !== null && (typeof value !== 'object' || Array.isArray(value))) throw Error('INVALID_RESPONSE');
  const body = (value ?? {}) as Record<string, unknown>;
  if (body.success != null && typeof body.success !== 'boolean') throw Error('INVALID_RESPONSE');
  const reason = [body.message, body.msg, body.detail, body.error].find(text => typeof text === 'string' && text.trim());
  const message = typeof reason === 'string' ? reason
    .replace(/bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/(password|access_token|token|cookie|authorization|numberCode|deviceId)\s*[:=]\s*[^\s;,]+/gi, '$1=[redacted]')
    .replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  if (body.is_expired === true) return { result: 'ended', message: message || '签到已结束' };
  const accepted = httpStatus >= 200 && httpStatus < 300;
  if (accepted && body.success !== false && !body.error) return { result: 'success', message: message || '签到成功' };
  return { result: 'failed', message: '提交结果未知，请核实本人记录' + (message ? '：' + message : '') };
}
