import type { AttendanceReceipt } from './attendance.ts';

export function qrData(rawScanText: string, expectedId: string): unknown {
  if (typeof rawScanText !== 'string') throw Error('INVALID_QR');
  let value: unknown;
  try { value = JSON.parse(rawScanText); }
  catch {
    let url: URL;
    try { url = new URL(rawScanText, 'https://lnt.xmu.edu.cn'); } catch { throw Error('INVALID_QR'); }
    if (!['http:', 'https:'].includes(url.protocol) || !['/j', '/scanner-jumper'].includes(url.pathname)) throw Error('INVALID_QR');
    try { value = JSON.parse(url.searchParams.get('_p') ?? ''); }
    catch {
      // shortcut: School's p decoder is unavailable; add it only after its protocol is confirmed.
      if (url.searchParams.has('p')) throw Error('UNSUPPORTED_QR_WRAPPER');
      throw Error('INVALID_QR');
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, 'data')) throw Error('INVALID_QR');
  const { rollcallId, data } = value as { rollcallId?: unknown; data: unknown };
  const id = typeof rollcallId === 'string' && rollcallId.trim() ? rollcallId
    : Number.isSafeInteger(rollcallId) && (rollcallId as number) > 0 ? String(rollcallId) : '';
  if (!id) throw Error('INVALID_QR');
  if (id !== expectedId) throw Error('QR_ACTIVITY_MISMATCH');
  return data;
}
export function qrReceipt(httpStatus: number, value: unknown): AttendanceReceipt {
  if (value !== null && (typeof value !== 'object' || Array.isArray(value))) throw Error('INVALID_RESPONSE');
  return httpStatus === 200 && (value as { status?: unknown } | null)?.status === 'on_call'
    ? { result: 'success', message: '签到成功' }
    : { result: 'failed', message: '提交结果未知，请核实本人记录' };
}
