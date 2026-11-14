import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { moveAsync } from 'expo-file-system/legacy';
import { CALLBACK, IDENTITY, createSchoolBrowser, schoolUrl } from './school-browser';
import type { SchoolDevice } from './learning';
import { numberReceipt } from './attendance.ts';
import { isPosition } from './location-attendance.ts';
import { qrReceipt } from './qr.ts';

const fail = (code: string, httpStatus?: number) => Object.assign(Error(code), { code, httpStatus });
const cache = () => new File(Paths.document, 'school-learning.json');
const temporary = () => new File(Paths.document, 'school-learning.tmp');
const logoutMarker = () => new File(Paths.document, 'school-logout');
const endpoints = {
  profile: 'https://lnt.xmu.edu.cn/api/profile',
  todos: 'https://lnt.xmu.edu.cn/api/todos?no-intercept=true',
  lntTerms: 'https://lnt.xmu.edu.cn/api/semesters',
  courses: 'https://lnt.xmu.edu.cn/api/my-courses',
  rollcalls: 'https://lnt.xmu.edu.cn/api/radar/rollcalls',
  jwTerms: 'https://jw.xmu.edu.cn/gsapp/sys/wdkbapp/modules/xskcb/kfdxnxqcx.do',
};
let generation = 0;
let authenticating: Promise<void> | null = null;
let clearing: Promise<void> | null = null;
let mustClear = false;
let verifiedTerms: unknown = null;
const requests = new Map<AbortController, Promise<unknown>>();
export const schoolBrowser = createSchoolBrowser(() => {
  generation++;
  for (const controller of requests.keys()) controller.abort();
});
function check(version: number) {
  if (generation !== version || mustClear) throw fail('CANCELLED');
}
function request(url: string, version: number, init: RequestInit = {}) {
  check(version);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  const task = (async () => {
    try {
      // Android's React Native fetch shares WebView's CookieManager, including HttpOnly cookies.
      const response = await fetch(url, { ...init, credentials: 'include', signal: controller.signal }).catch(() => {
        check(version);
        throw fail(controller.signal.aborted ? 'TIMEOUT' : 'NETWORK');
      });
      const text = await response.text();
      check(version);
      if (response.status === 401 || (response.status === 403 && init.method !== 'PUT')) throw fail('AUTH_REQUIRED', response.status);
      const final = new URL(response.url), expected = new URL(url);
      if (!schoolUrl(response.url) || final.origin !== expected.origin || final.pathname !== expected.pathname) throw fail('AUTH_REQUIRED', response.status);
      if (response.status !== 200 && init.method !== 'PUT') throw fail('HTTP_ERROR', response.status);
      return { text, contentType: response.headers.get('content-type') ?? '', httpStatus: response.status };
    } finally { clearTimeout(timer); }
  })();
  requests.set(controller, task);
  void task.then(() => requests.delete(controller), () => requests.delete(controller));
  return task;
}
async function read(action: Parameters<SchoolDevice['read']>[0], params?: Parameters<SchoolDevice['read']>[1], version = generation): Promise<unknown> {
  check(version);
  if (action === 'jwTerms' && verifiedTerms !== null) {
    const terms = verifiedTerms; verifiedTerms = null;
    return terms;
  }
  if (action === 'courses') {
    if (!Number.isSafeInteger(params?.semesterId) || params!.semesterId! <= 0) throw fail('INVALID_SEMESTER');
    const courses: unknown[] = [];
    let pages = 1, total = 0;
    for (let page = 1; page <= pages; page++) {
      const response = await request(endpoints.courses, version, {
        method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ page, page_size: 100, fields: 'id,course_code,name,semester_id,semester', conditions: { semester_id: [params!.semesterId] } }),
      });
      const result = jsonResponse(response) as { success?: unknown; courses?: unknown; pages?: unknown; total?: unknown } | null;
      if (result?.success === false || !Array.isArray(result?.courses) || !Number.isSafeInteger(result.pages) || (result.pages as number) < 0
        || !Number.isSafeInteger(result.total) || (result.total as number) < 0
        || page > 1 && (result.pages !== pages || result.total !== total)) throw fail('INVALID_RESPONSE');
      pages = result.pages as number; total = result.total as number;
      if (pages > Math.max(1, total) || (pages === 0 && total !== 0) || result.courses.length > 100
        || (page < pages && result.courses.length === 0)) throw fail('INVALID_RESPONSE');
      courses.push(...result.courses);
      if (courses.length > total) throw fail('INVALID_RESPONSE');
    }
    if (courses.length !== total) throw fail('INVALID_RESPONSE');
    return { courses };
  }
  const timetable = action === 'jwSchedule';
  if ((action === 'jwWeek' || timetable) && !/^\d{4}[123]$/.test(params?.jwTermCode ?? '')) throw fail('INVALID_TERM');
  if (action === 'history' && (!Number.isSafeInteger(params?.courseId) || params!.courseId! <= 0
    || !Number.isSafeInteger(params?.studentId) || params!.studentId! <= 0)) throw fail('INVALID_HISTORY_QUERY');
  const url = action === 'history'
    ? `https://lnt.xmu.edu.cn/api/course/${params!.courseId}/student/${params!.studentId}/rollcalls?page=1&page_size=100`
    : action === 'jwWeek'
    ? 'https://jw.xmu.edu.cn/gsapp/sys/wdkbapp/wdkcb/getZcxx.do?' + new URLSearchParams({ XNXQDM: params!.jwTermCode! }) : timetable ? 'https://jw.xmu.edu.cn/gsapp/sys/wdkbapp/wdkcb/queryXspkjg.do' : endpoints[action as keyof typeof endpoints];
  const response = await request(url, version, timetable ? {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ XNXQDM: params!.jwTermCode!, XH: params?.studentNumber ?? '' }).toString(),
  } : { headers: { Accept: 'application/json' } });
  return jsonResponse(response);
}
function jsonResponse(response: { contentType: string; text: string }): unknown {
  if (!response.contentType.includes('json')) throw fail(response.contentType.includes('html') ? 'AUTH_REQUIRED' : 'INVALID_RESPONSE');
  try { return JSON.parse(response.text); } catch { throw fail('INVALID_RESPONSE'); }
}
async function authenticate(onAuthorized?: () => void) {
  const version = generation;
  check(version);
  verifiedTerms = null;
  let terms: unknown = null;
  let stage = 'native', failed = false;
  let cookies: typeof import('@preeternal/react-native-cookie-manager').default | undefined;
  try {
    // Load the native cookie library only for real school access, so previews remain usable.
    cookies = (await import('@preeternal/react-native-cookie-manager')).default;
    stage = 'pkce';
    const random = await Crypto.getRandomBytesAsync(48);
    const state = Array.from(random.slice(0, 16), value => value.toString(16).padStart(2, '0')).join('');
    const verifier = Array.from(random.slice(16), value => value.toString(16).padStart(2, '0')).join('');
    const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 });
    const challenge = digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    check(version);
    const params = new URLSearchParams({ client_id: 'TronClassH5', response_type: 'code', scope: 'openid',
      redirect_uri: CALLBACK, state, code_challenge: challenge, code_challenge_method: 'S256' });
    stage = 'authorize';
    const code = await schoolBrowser.authenticate(`${IDENTITY}/auth?${params}`);
    check(version);
    stage = 'token';
    const tokenResponse = await request(`${IDENTITY}/token`, version, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: 'TronClassH5', grant_type: 'authorization_code', code,
        redirect_uri: CALLBACK, code_verifier: verifier, scope: 'openid' }).toString(),
    });
    let token: unknown;
    try { token = JSON.parse(tokenResponse.text).access_token; } catch { throw fail('INVALID_TOKEN'); }
    if (typeof token !== 'string' || !token.trim()) throw fail('INVALID_TOKEN');
    // Initialize the academic application through the same official SSO session before reporting success.
    stage = 'academic';
    await schoolBrowser.initializeAcademic();
    check(version);
    stage = 'academic-probe';
    const academic = await read('jwTerms', undefined, version) as { success?: boolean; datas?: { kfdxnxqcx?: { rows?: unknown } } } | null;
    if (academic?.success === false || !Array.isArray(academic?.datas?.kfdxnxqcx?.rows)) throw fail('INVALID_ACADEMIC_SESSION');
    terms = academic;
    stage = 'lnt';
    await request('https://lnt.xmu.edu.cn/api/login?login=access_token', version, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access_token: token, org_id: 1 }),
    });
    check(version);
  } catch (cause) {
    failed = true;
    const { code: rawCode, httpStatus, nativeCode } = (cause as { code?: string; httpStatus?: number; nativeCode?: number }) ?? {};
    // Only known codes and numeric statuses may leave the authentication boundary.
    const code = rawCode && ['CANCELLED', 'AUTH_REQUIRED', 'HTTP_ERROR', 'NETWORK', 'TIMEOUT', 'INVALID_RESPONSE', 'INVALID_TOKEN',
      'INVALID_ACADEMIC_SESSION', 'INVALID_CALLBACK', 'AUTH_FAILED', 'BUSY', 'UNTRUSTED_LINK', 'INVALID_AUTHORIZATION',
      'WEBVIEW_PROCESS_GONE'].includes(rawCode) ? rawCode : 'UNEXPECTED';
    const diagnostic = { stage, code,
      ...(typeof httpStatus === 'number' && Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? { httpStatus } : {}),
      ...(Number.isSafeInteger(nativeCode) ? { nativeCode } : {}) };
    if (code !== 'CANCELLED') console.warn('[school-login]', diagnostic);
    throw Object.assign(Error(code), { ...diagnostic, loginStage: stage });
  } finally {
    try { await cookies?.flush(); }
    catch {
      console.warn('[school-login]', { stage: 'flush', code: 'COOKIE_STORAGE', ...(failed ? { secondary: true } : {}) });
      if (!failed) {
        check(version);
        throw Object.assign(fail('COOKIE_STORAGE'), { loginStage: 'flush' });
      }
    }
    finally { schoolBrowser.close(); }
  }
  check(version);
  verifiedTerms = terms;
  onAuthorized?.();
}
function clear(): Promise<void> {
  if (clearing) return clearing;
  generation++; mustClear = true;
  verifiedTerms = null;
  schoolBrowser.close();
  for (const controller of requests.keys()) controller.abort();
  const pending = [...requests.values(), authenticating];
  clearing = (async () => {
    const marker = logoutMarker();
    // An interrupted logout must never restore the previous account on the next launch.
    try { await marker.write('pending'); } catch { /* Still attempt both data and session removal. */ }
    await Promise.allSettled(pending);
    const results = await Promise.allSettled([
      (async () => { for (const file of [cache(), temporary()]) if (file.exists) file.delete(); })(),
      // shortcut: Site storage and HTTP auth data are not covered; revisit library support if full erasure is required.
      import('@preeternal/react-native-cookie-manager').then(({ default: cookies }) => cookies.clearAllStores()),
    ]);
    if (results.some(result => result.status === 'rejected')) throw fail('CLEANUP_FAILED');
    if (marker.exists) marker.delete();
    mustClear = false;
  })().finally(() => { clearing = null; });
  return clearing;
}
async function answerRollcall(rollcallId: string, kind: 'number' | 'qr' | 'location', payload: Record<string, unknown>, receipt: typeof numberReceipt) {
  if (typeof rollcallId !== 'string' || !rollcallId.trim()) throw fail('INVALID_ATTENDANCE');
  const response = await request(`https://lnt.xmu.edu.cn/api/rollcall/${encodeURIComponent(rollcallId)}/${kind === 'location' ? 'answer' : `answer_${kind}_rollcall`}`, generation, {
    method: 'PUT', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: Crypto.randomUUID(), ...payload }),
  });
  if (response.contentType.includes('html') || response.text.trim().startsWith('<')) throw fail('AUTH_REQUIRED', response.httpStatus);
  let body: unknown = null;
  if (response.text.trim()) {
    if (!response.contentType.includes('json')) throw fail('INVALID_RESPONSE');
    try { body = JSON.parse(response.text); } catch { throw fail('INVALID_RESPONSE'); }
  }
  return receipt(response.httpStatus, body);
}
export const schoolDevice: SchoolDevice = {
  async load() {
    if (logoutMarker().exists || mustClear) await clear();
    const file = cache();
    return file.exists ? file.text() : null;
  },
  async save(value) {
    check(generation);
    const file = temporary();
    // File.move deletes the destination first; legacy moveAsync uses Android's same-directory renameTo.
    try { await file.write(value); await moveAsync({ from: file.uri, to: cache().uri }); }
    finally { const leftover = temporary(); if (leftover.exists) leftover.delete(); }
  },
  clear, read,
  async answerNumber(rollcallId, numberCode) {
    if (typeof numberCode !== 'string' || !/^\d{4}$/.test(numberCode)) throw fail('INVALID_ATTENDANCE');
    return answerRollcall(rollcallId, 'number', { numberCode }, numberReceipt);
  },
  async submitLocation(rollcallId, position) {
    if (!isPosition(position)) throw fail('INVALID_ATTENDANCE');
    const { latitude, longitude, accuracy, altitude, altitudeAccuracy, heading, speed } = position;
    return answerRollcall(rollcallId, 'location', { latitude, longitude, accuracy, altitude, altitudeAccuracy, heading, speed }, numberReceipt);
  },
  async submitQr(rollcallId, data) {
    if (data === undefined) throw fail('INVALID_ATTENDANCE');
    return answerRollcall(rollcallId, 'qr', { data }, qrReceipt);
  },
  authenticate(onAuthorized) {
    if (clearing || mustClear) return Promise.reject(fail('CLEANUP_REQUIRED'));
    authenticating ??= authenticate(onAuthorized).finally(() => { authenticating = null; });
    return authenticating;
  },
};
