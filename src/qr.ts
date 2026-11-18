import type { AttendanceReceipt } from './attendance.ts';

function packedValue(value: string, key: 'rollcallId' | 'data'): string | number | boolean {
  if (value.startsWith('\x10')) {
    const encoded = value.slice(1);
    const parts = /^(-?[0-9a-z]+)(?:\.([0-9a-z]+))?$/i.exec(encoded);
    if (!parts || parts[0] !== encoded) throw Error('INVALID_QR');
    const [, whole, fraction] = parts;
    if (key === 'rollcallId' && fraction && /[1-9a-z]/i.test(fraction)) throw Error('INVALID_QR');
    const integer = Number.parseInt(whole, 36);
    const number = fraction === undefined ? integer : Number.parseFloat(`${integer}.${Number.parseInt(fraction, 36)}`);
    if (!Number.isFinite(number)) throw Error('INVALID_QR');
    return number;
  }
  if (value.startsWith('\x1a')) {
    switch (value) {
      case '\x1a0': return false;
      case '\x1a1': return true;
      case '\x1a2': return 'classroom-exam';
      case '\x1a3': return 'feedback';
      case '\x1a4': return 'vote';
      default: return value;
    }
  }
  return value.replaceAll('\x1f', '~').replaceAll('\x1e', '!');
}

function packedQr(raw: string) {
  const value: Partial<Record<'rollcallId' | 'data', string | number | boolean>> = {};
  for (const pair of raw.split('!')) {
    const [alias, encoded, extra] = pair.split('~');
    const key = alias === '3' || alias === 'data' ? 'data' : alias === '4' || alias === 'rollcallId' ? 'rollcallId' : null;
    if (!key) continue;
    if (encoded === undefined || extra !== undefined || Object.hasOwn(value, key)) throw Error('INVALID_QR');
    value[key] = packedValue(encoded, key);
  }
  return value;
}

export function qrData(rawScanText: string, expectedId: string): unknown {
  if (typeof rawScanText !== 'string') throw Error('INVALID_QR');
  let value: unknown;
  try { value = JSON.parse(rawScanText); }
  catch {
    let url: URL;
    try { url = new URL(rawScanText, 'https://lnt.xmu.edu.cn'); } catch { throw Error('INVALID_QR'); }
    if (!['http:', 'https:'].includes(url.protocol) || !['/j', '/scanner-jumper'].includes(url.pathname)) throw Error('INVALID_QR');
    try { value = JSON.parse(url.searchParams.get('_p') ?? ''); }
    catch { value = undefined; }
    if (!value) {
      const packed = url.searchParams.getAll('p');
      if (packed.length !== 1) throw Error('INVALID_QR');
      value = packedQr(packed[0]);
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
