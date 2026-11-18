import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { moveAsync } from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { CALLBACK, CAS_LOGIN, IDENTITY, LNT_HOME, createSchoolBrowser } from './school-browser';
import type { Account, SchoolDevice } from './learning';
import { captureSchoolCookies, schoolHttpUrl, schoolJarFrom, setSchoolCookies } from './school-cookies';
import type { CookieJar } from 'tough-cookie';
import { numberReceipt } from './attendance.ts';
import { isPosition } from './location-attendance.ts';
import { qrReceipt } from './qr.ts';

const fail = (code: string, httpStatus?: number) => Object.assign(Error(code), { code, httpStatus });
const cache = () => new File(Paths.document, 'school-learning.json');
const temporary = () => new File(Paths.document, 'school-learning.tmp');
const logoutMarker = () => new File(Paths.document, 'school-logout');
const requestTimeout = 30000;
const academicProfileUrl = 'https://jw.xmu.edu.cn/gsapp/sys/wdkbapp/wdkcb/initXsxx.do?XH=';
const endpoints = {
  profile: 'https://lnt.xmu.edu.cn/api/profile',
  todos: 'https://lnt.xmu.edu.cn/api/todos?no-intercept=true',
  lntTerms: 'https://lnt.xmu.edu.cn/api/semesters',
  courses: 'https://lnt.xmu.edu.cn/api/my-courses',
  rollcalls: 'https://lnt.xmu.edu.cn/api/radar/rollcalls?api_version=1.1.0',
  jwTerms: 'https://jw.xmu.edu.cn/gsapp/sys/wdkbapp/modules/xskcb/kfdxnxqcx.do',
};
let generation = 0;
let authenticating: Promise<void> | null = null;
let clearing: Promise<void> | null = null;
let mustClear = false;
let verifiedTerms: unknown = null;
type BoundAccount = Account & { lntId: number };
type BoundSession = { account: BoundAccount; jar: CookieJar; recovery?: Promise<void> };
type CachedLearning = { version: 1; account?: Account };
type CachedSession = { account: BoundAccount; cookies: unknown };
type SchoolResponse = { httpStatus: number; contentType: string; text: string; location: string | null; headers: readonly (readonly [string, string])[] };
const lntOrigin = new URL(LNT_HOME).origin;
const renewalHosts = new Set(['lnt.xmu.edu.cn', 'ids.xmu.edu.cn', 'c-identity.xmu.edu.cn', 'c-mobile.xmu.edu.cn']);
const redirects = new Set([301, 302, 303, 307, 308]);
let active: BoundSession | null = null;
let restored = false;
let sessionFailure = 'AUTH_REQUIRED';
let persistence = Promise.resolve();
let recovering: { abort(): void; signal: AbortSignal; drain: Promise<void>; result: Promise<void> } | null = null;
const requests = new Map<AbortController, Promise<unknown>>();
const writes = new Set<Promise<unknown>>();
export const schoolBrowser = createSchoolBrowser(() => {
  generation++;
  for (const controller of requests.keys()) controller.abort();
});
function check(version: number, signal?: AbortSignal) {
  if (generation !== version || mustClear || signal?.aborted) throw fail('CANCELLED');
}
function assertLntAccount(expected: Account, actual: Account) {
  if (expected.lntId !== null && expected.lntId !== actual.lntId
    || expected.studentNumber && expected.studentNumber !== actual.studentNumber) throw fail('AUTH_REQUIRED');
}
function boundSession(version: number, account?: Account) {
  check(version);
  if (!active || authenticating) throw Object.assign(fail(sessionFailure), { needsLogin: true });
  if (account) assertLntAccount(account, active.account);
  return active;
}
function request(url: string, version: number, init: RequestInit = {}, jar?: CookieJar, signal?: AbortSignal) {
  check(version, signal);
  const target = schoolHttpUrl(url);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, requestTimeout);
  const task = (async () => {
    try {
      const { fetch } = await import('expo/fetch');
      check(version, signal);
      const headers = new Headers(init.headers);
      const cookie = jar?.getCookieStringSync(target.href);
      if (cookie) headers.set('Cookie', cookie);
      const response = await fetch(target.href, { ...init, headers, credentials: 'omit', redirect: 'manual', signal: controller.signal });
      const text = await response.text();
      check(version, signal);
      if (controller.signal.aborted) throw fail('TIMEOUT');
      if (schoolHttpUrl(response.url).href !== target.href) throw fail('INVALID_RESPONSE');
      return { text, contentType: response.headers.get('content-type') ?? '', httpStatus: response.status,
        location: response.headers.get('location'), headers: response._rawHeaders } satisfies SchoolResponse;
    } catch (error) {
      check(version, signal);
      if ((error as { code?: string } | null)?.code === 'INVALID_RESPONSE') throw error;
      throw fail(controller.signal.aborted ? 'TIMEOUT' : 'NETWORK');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  })();
  requests.set(controller, task);
  if (init.method === 'PUT') writes.add(task);
  const finished = () => { requests.delete(controller); writes.delete(task); };
  void task.then(finished, finished);
  return task;
}
function isLoginRedirect(url: string, response: SchoolResponse) {
  if (!redirects.has(response.httpStatus) || !response.location) return false;
  try {
    const target = schoolHttpUrl(new URL(response.location, url).href);
    const page = target.origin + target.pathname;
    return page === CAS_LOGIN || page === IDENTITY + '/auth'
      || target.origin === lntOrigin && (target.pathname === '/' || target.pathname === '/user/index');
  } catch { return false; }
}
function schoolResult(url: string, response: SchoolResponse, write = false) {
  const { httpStatus } = response;
  if (httpStatus === 401 || isLoginRedirect(url, response) || (redirects.has(httpStatus) && new URL(url).hostname === 'jw.xmu.edu.cn')
    || httpStatus === 403 && new URL(url).hostname === 'jw.xmu.edu.cn') throw fail('AUTH_REQUIRED', httpStatus);
  if (httpStatus !== 200 && (!write || redirects.has(httpStatus))) throw fail('HTTP_ERROR', httpStatus);
  return response;
}
async function persistSession(session: BoundSession, version: number, signal?: AbortSignal, beforeCommit?: () => void) {
  try {
    await persistCache(({ learning }) => {
      const expected = learningAccount(learning);
      if (expected) assertLntAccount(expected, session.account);
      return { learning, session: { account: session.account, cookies: session.jar.serializeSync() } };
    }, version, signal, beforeCommit);
  } catch (error) {
    check(version, signal);
    if ((error as { code?: string } | null)?.code === 'AUTH_REQUIRED') throw error;
    active = null;
    sessionFailure = 'COOKIE_STORAGE';
    throw fail('COOKIE_STORAGE');
  }
}
function profileAccount(value: unknown): BoundAccount {
  const profile = value as { id?: unknown; user_no?: unknown; name?: unknown; success?: boolean } | null;
  if (profile?.success === false || !Number.isSafeInteger(profile?.id) || (profile?.id as number) <= 0
    || typeof profile?.user_no !== 'string' || !profile.user_no.trim()) throw fail('INVALID_RESPONSE');
  return { lntId: profile.id as number, studentNumber: profile.user_no, name: typeof profile.name === 'string' ? profile.name : '' };
}
async function verifyProfile(jar: CookieJar, version: number) {
  const url = endpoints.profile;
  const response = schoolResult(url, await request(url, version, { headers: { Accept: 'application/json' } }, jar));
  const account = profileAccount(jsonResponse(response));
  setSchoolCookies(jar, url, response.headers);
  return account;
}
function recoverLnt(previous: BoundSession, version: number, expiredUrl: string, expiredResponse: SchoolResponse) {
  const controller = new AbortController();
  const { signal } = controller;
  let interrupt!: (error: Error) => void;
  const interrupted = new Promise<never>((_, reject) => { interrupt = reject; });
  const abort = (code = 'CANCELLED') => { interrupt(fail(code)); controller.abort(); };
  const deadline = Date.now() + requestTimeout;
  const timer = setTimeout(() => abort('AUTH_REQUIRED'), requestTimeout);
  const drain = (async () => {
    if (writes.size) await Promise.allSettled(writes);
    check(version, signal);
    const jar = schoolJarFrom(previous.jar.serializeSync());
    setSchoolCookies(jar, expiredUrl, expiredResponse.headers);
    let url = LNT_HOME;
    for (let hop = 0; hop < 10; hop++) {
      const response = await request(url, version, { headers: { Accept: 'text/html' } }, jar, signal);
      setSchoolCookies(jar, url, response.headers);
      if (!redirects.has(response.httpStatus)) {
        if (response.httpStatus === 401 || response.httpStatus === 403) throw fail('AUTH_REQUIRED');
        if (response.httpStatus !== 200) throw fail('HTTP_ERROR', response.httpStatus);
        if (new URL(url).origin !== lntOrigin) throw fail('AUTH_REQUIRED');
        const next = { account: previous.account, jar };
        await persistSession(next, version, signal, () => {
          if (Date.now() >= deadline) throw fail('AUTH_REQUIRED');
          clearTimeout(timer);
        });
        check(version);
        active = next;
        return;
      }
      if (!response.location) throw fail('AUTH_REQUIRED');
      const next = schoolHttpUrl(new URL(response.location, url).href);
      if (!renewalHosts.has(next.hostname)) throw fail('UNTRUSTED_LINK');
      url = next.href;
    }
    throw fail('AUTH_REQUIRED');
  })().finally(() => { recovering = null; });
  const result = Promise.race([drain, interrupted]).catch(error => {
    if (generation === version) active = null;
    throw Object.assign(error ?? fail('INVALID_RESPONSE'), { needsLogin: true });
  }).finally(() => clearTimeout(timer));
  recovering = { abort, signal, drain, result };
  return result;
}
async function query(url: string, version: number, init: RequestInit, account?: Account, canRetry = true): Promise<unknown> {
  check(version);
  const pending = recovering?.result;
  if (pending) await pending;
  const session = boundSession(version, account);
  if (url === endpoints.jwTerms && verifiedTerms !== null) {
    const terms = verifiedTerms; verifiedTerms = null;
    return terms;
  }
  const response = await request(url, version, init, session.jar);
  check(version);
  const lnt = new URL(url).origin === lntOrigin;
  const expired = response.httpStatus === 401 || isLoginRedirect(url, response);
  if (lnt && expired && canRetry && !pending) {
    session.recovery ??= recoverLnt(session, version, url, response);
    await session.recovery;
    return query(url, version, init, account, false);
  }
  schoolResult(url, response);
  if (lnt && response.contentType.includes('html')) throw fail('INVALID_RESPONSE');
  const data = jsonResponse(response);
  if (session.recovery) await session.recovery;
  if (active === session && !session.recovery && setSchoolCookies(session.jar, url, response.headers)) {
    await persistSession(session, version);
  }
  boundSession(version, account);
  return data;
}
async function read(action: Parameters<SchoolDevice['read']>[0], params?: Parameters<SchoolDevice['read']>[1], account?: Account): Promise<unknown> {
  const version = generation;
  check(version);
  if (action === 'profile') {
    const pending = recovering?.result;
    if (pending) await pending;
    const { lntId, studentNumber, name } = boundSession(version, account).account;
    return { id: lntId, user_no: studentNumber, name };
  }
  if (action === 'courses') {
    if (!Number.isSafeInteger(params?.semesterId) || params!.semesterId! <= 0) throw fail('INVALID_SEMESTER');
    const courses: unknown[] = [];
    let pages = 1, total = 0;
    for (let page = 1; page <= pages; page++) {
      const result = await query(endpoints.courses, version, {
        method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ page, page_size: 100, fields: 'id,course_code,name,semester_id', conditions: { semester_id: [params!.semesterId] } }),
      }, account) as { success?: unknown; courses?: unknown; pages?: unknown; total?: unknown } | null;
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
  if (action === 'history' && params!.studentId !== boundSession(version, account).account.lntId) throw fail('AUTH_REQUIRED');
  if (timetable && params?.studentNumber !== boundSession(version, account).account.studentNumber) throw fail('AUTH_REQUIRED');
  const url = action === 'history'
    ? `https://lnt.xmu.edu.cn/api/course/${params!.courseId}/student/${params!.studentId}/rollcalls?page=1&page_size=100`
    : action === 'jwWeek'
    ? 'https://jw.xmu.edu.cn/gsapp/sys/wdkbapp/wdkcb/getZcxx.do?' + new URLSearchParams({ XNXQDM: params!.jwTermCode! }) : timetable ? 'https://jw.xmu.edu.cn/gsapp/sys/wdkbapp/wdkcb/queryXspkjg.do' : endpoints[action as keyof typeof endpoints];
  return query(url, version, timetable ? {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ XNXQDM: params!.jwTermCode!, XH: params?.studentNumber ?? '' }).toString(),
  } : { headers: { Accept: 'application/json' } }, account);
}
function jsonResponse(response: { contentType: string; text: string }): unknown {
  if (!response.contentType.includes('json')) throw fail(response.contentType.includes('html') ? 'AUTH_REQUIRED' : 'INVALID_RESPONSE');
  try { return JSON.parse(response.text); } catch { throw fail('INVALID_RESPONSE'); }
}
async function authenticate(expected: Account | undefined, onAuthorized?: () => void) {
  const version = generation;
  check(version);
  verifiedTerms = null;
  let stage = 'native';
  try {
    const { default: cookies } = await import('@preeternal/react-native-cookie-manager');
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
    const tokenUrl = `${IDENTITY}/token`;
    const tokenResponse = schoolResult(tokenUrl, await request(tokenUrl, version, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: 'TronClassH5', grant_type: 'authorization_code', code,
        redirect_uri: CALLBACK, code_verifier: verifier, scope: 'openid' }).toString(),
    }));
    let token: unknown;
    try { token = JSON.parse(tokenResponse.text).access_token; } catch { throw fail('INVALID_TOKEN'); }
    if (typeof token !== 'string' || !token.trim()) throw fail('INVALID_TOKEN');
    stage = 'academic';
    await schoolBrowser.initializeAcademic();
    check(version);
    stage = 'flush';
    let jar: CookieJar;
    try {
      await cookies.flush();
      check(version);
      jar = await captureSchoolCookies(url => cookies.getAsArray(url));
    } catch {
      check(version);
      throw fail('COOKIE_STORAGE');
    }
    check(version);
    stage = 'academic-probe';
    const academicResponse = schoolResult(endpoints.jwTerms, await request(endpoints.jwTerms, version, { headers: { Accept: 'application/json' } }, jar));
    const academic = jsonResponse(academicResponse) as { success?: boolean; datas?: { kfdxnxqcx?: { rows?: unknown } } } | null;
    if (academic?.success === false || !Array.isArray(academic?.datas?.kfdxnxqcx?.rows)) throw fail('INVALID_ACADEMIC_SESSION');
    setSchoolCookies(jar, endpoints.jwTerms, academicResponse.headers);
    stage = 'lnt';
    const loginUrl = LNT_HOME + 'api/login?login=access_token';
    const login = schoolResult(loginUrl, await request(loginUrl, version, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access_token: token, org_id: 1 }),
    }, jar));
    setSchoolCookies(jar, loginUrl, login.headers);
    const account = await verifyProfile(jar, version);
    if (expected) assertLntAccount(expected, account);
    stage = 'academic-probe';
    const identityResponse = schoolResult(academicProfileUrl, await request(academicProfileUrl, version, { headers: { Accept: 'application/json' } }, jar));
    const academicIdentity = jsonResponse(identityResponse) as { success?: boolean; data?: { XH?: unknown }[] } | null;
    if (academicIdentity?.success === false || !Array.isArray(academicIdentity?.data)
      || academicIdentity.data[0]?.XH !== account.studentNumber) throw fail('INVALID_ACADEMIC_SESSION');
    setSchoolCookies(jar, academicProfileUrl, identityResponse.headers);
    stage = 'flush';
    const session = { account, jar };
    await persistSession(session, version, undefined, schoolBrowser.beginCommit);
    check(version);
    active = session;
    restored = true;
    sessionFailure = 'AUTH_REQUIRED';
    verifiedTerms = academic;
    schoolBrowser.close();
    onAuthorized?.();
  } catch (cause) {
    const { code: rawCode, httpStatus, nativeCode } = (cause as { code?: string; httpStatus?: number; nativeCode?: number }) ?? {};
    // Only known codes and numeric statuses may leave the authentication boundary.
    const code = rawCode && ['CANCELLED', 'AUTH_REQUIRED', 'HTTP_ERROR', 'NETWORK', 'TIMEOUT', 'INVALID_RESPONSE', 'INVALID_TOKEN',
      'INVALID_ACADEMIC_SESSION', 'INVALID_CALLBACK', 'AUTH_FAILED', 'BUSY', 'UNTRUSTED_LINK', 'INVALID_AUTHORIZATION',
      'WEBVIEW_PROCESS_GONE', 'COOKIE_STORAGE'].includes(rawCode) ? rawCode : 'UNEXPECTED';
    const diagnostic = { stage, code,
      ...(typeof httpStatus === 'number' && Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? { httpStatus } : {}),
      ...(Number.isSafeInteger(nativeCode) ? { nativeCode } : {}) };
    if (code !== 'CANCELLED') console.warn('[school-login]', diagnostic);
    throw Object.assign(Error(code), { ...diagnostic, loginStage: stage });
  } finally {
    schoolBrowser.close();
  }
}
type LocalCache = { learning: CachedLearning | null; session: CachedSession | null };
const validId = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
function learningAccount(learning: CachedLearning | null) {
  const account = learning?.account;
  if (account && typeof account.studentNumber === 'string'
    && (validId(account.lntId) || account.lntId === null && account.studentNumber.trim())) return account;
}
async function readCache(): Promise<LocalCache> {
  const file = cache();
  const contents = file.exists ? await file.text() : null;
  try {
    const data = JSON.parse(contents ?? 'null');
    if (data?.version === 1) return { learning: data, session: null };
    if (data?.version === 2) {
      const id = data.activeAccountId;
      if (validId(id) && Object.hasOwn(data.accounts ?? {}, String(id)) && data.accounts[id]?.version === 1
        && data.accounts[id]?.account?.lntId === id) return { learning: data.accounts[id], session: null };
    }
    if (data?.version === 3 && (data.learning === null || data.learning?.version === 1)) {
      const { learning } = data;
      let session = null;
      try {
        const saved = data.session;
        const account = profileAccount({ id: saved?.account?.lntId, user_no: saved?.account?.studentNumber, name: saved?.account?.name });
        const expected = learningAccount(learning);
        if (expected) assertLntAccount(expected, account);
        else if (learning && Object.hasOwn(learning, 'account')) throw fail('INVALID_CACHE');
        session = { account, cookies: saved.cookies };
      } catch { /* Invalid sessions leave learning data available for manual login. */ }
      return { learning, session };
    }
  } catch {
    throw fail('INVALID_CACHE');
  }
  if (contents !== null) throw fail('INVALID_CACHE');
  return { learning: null, session: null };
}
function persistCache(update: (previous: LocalCache) => LocalCache, version: number, signal?: AbortSignal, beforeCommit?: () => void) {
  const saved = persistence.then(async () => {
    check(version, signal);
    const previous = await readCache();
    check(version, signal);
    const { learning, session } = update(previous);
    const value = JSON.stringify(session ? { version: 3, learning, session } : learning);
    const file = temporary();
    try {
      try { await file.write(value); } catch { throw fail('CACHE_STORAGE'); }
      const move = { from: file.uri, to: cache().uri };
      check(version, signal);
      beforeCommit?.();
      // File.move deletes the destination first; legacy moveAsync uses Android's same-directory renameTo.
      try { await moveAsync(move); } catch { throw fail('CACHE_STORAGE'); }
    } finally { if (file.exists) file.delete(); }
  });
  persistence = saved.catch(() => {});
  return saved;
}
function clear(): Promise<void> {
  if (clearing) return clearing;
  generation++; mustClear = true;
  active = null;
  restored = false;
  sessionFailure = 'AUTH_REQUIRED';
  verifiedTerms = null;
  const recovery = recovering;
  recovery?.abort();
  schoolBrowser.close();
  for (const controller of requests.keys()) controller.abort();
  const pending = [...requests.values(), authenticating, recovery?.drain, persistence];
  clearing = (async () => {
    const marker = logoutMarker();
    // An interrupted logout must never restore the previous account on the next launch.
    try { await marker.write('pending'); } catch { /* Still attempt cache and WebView removal. */ }
    await Promise.allSettled(pending);
    const results = await Promise.allSettled([
      (async () => {
        const files = [cache(), temporary()];
        if (Platform.OS === 'android') files.push(
          new File(Paths.document, '../shared_prefs/SecureStore.xml.bak'),
          new File(Paths.document, '../shared_prefs/SecureStore.xml'),
        );
        for (const file of files) if (file.exists) file.delete();
      })(),
      // shortcut: Site storage and HTTP auth data are not covered; revisit library support if full erasure is required.
      import('@preeternal/react-native-cookie-manager').then(({ default: cookies }) => cookies.clearAllStores()),
    ]);
    if (results.some(result => result.status === 'rejected' || result.value === false)) throw fail('CLEANUP_FAILED');
    if (marker.exists) marker.delete();
    mustClear = false;
  })().finally(() => { clearing = null; });
  return clearing;
}
async function answerRollcall(rollcallId: string, kind: 'number' | 'qr' | 'location', payload: Record<string, unknown>, receipt: typeof numberReceipt, account: Account) {
  if (typeof rollcallId !== 'string' || !rollcallId.trim()) throw fail('INVALID_ATTENDANCE');
  const version = generation;
  if (!account || (account.lntId === null && !account.studentNumber.trim())) throw fail('AUTH_REQUIRED');
  const recovery = recovering;
  if (recovery) await recovery.result;
  const session = boundSession(version, account);
  const url = `https://lnt.xmu.edu.cn/api/rollcall/${encodeURIComponent(rollcallId)}/${kind === 'location' ? 'answer' : `answer_${kind}_rollcall`}`;
  const response = schoolResult(url, await request(url, version, {
    method: 'PUT', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: Crypto.randomUUID(), ...payload }),
  }, session.jar), true);
  if (response.contentType.includes('html') || response.text.trim().startsWith('<')) throw fail('AUTH_REQUIRED', response.httpStatus);
  let body: unknown = null;
  if (response.text.trim()) {
    if (!response.contentType.includes('json')) throw fail('INVALID_RESPONSE');
    try { body = JSON.parse(response.text); } catch { throw fail('INVALID_RESPONSE'); }
  }
  if (active === session && setSchoolCookies(session.jar, url, response.headers)) {
    await persistSession(session, version).catch(() => {});
  }
  check(version);
  return receipt(response.httpStatus, body);
}
export const schoolDevice: SchoolDevice = {
  async load() {
    if (logoutMarker().exists || mustClear) await clear();
    const version = generation;
    await persistence;
    const { learning, session } = await readCache();
    check(version);
    if (!restored && !authenticating) {
      if (session) {
        try { active = { account: session.account, jar: schoolJarFrom(session.cookies) }; }
        catch { sessionFailure = 'COOKIE_STORAGE'; }
      }
      restored = true;
    }
    return { raw: learning && JSON.stringify(learning), account: active?.account ?? null };
  },
  save(value) {
    return persistCache(previous => {
      const learning = JSON.parse(value) as CachedLearning;
      if (learning?.version !== 1) throw fail('INVALID_CACHE');
      if (Object.hasOwn(learning, 'account')) {
        const expected = learningAccount(previous.learning);
        const bound = previous.session?.account;
        const account = learningAccount(learning);
        if (expected || bound) {
          if (!account) throw fail('AUTH_REQUIRED');
          if (expected) assertLntAccount(expected, account);
          if (bound) assertLntAccount(account, bound);
        }
      }
      return { learning, session: previous.session };
    }, generation);
  },
  clear, read,
  async answerNumber(rollcallId, numberCode, account) {
    if (typeof numberCode !== 'string' || !/^\d{4}$/.test(numberCode)) throw fail('INVALID_ATTENDANCE');
    return answerRollcall(rollcallId, 'number', { numberCode }, numberReceipt, account);
  },
  async submitLocation(rollcallId, position, account) {
    if (!isPosition(position)) throw fail('INVALID_ATTENDANCE');
    const { latitude, longitude, accuracy, altitude, altitudeAccuracy, heading, speed } = position;
    return answerRollcall(rollcallId, 'location', { latitude, longitude, accuracy, altitude, altitudeAccuracy, heading, speed }, numberReceipt, account);
  },
  async submitQr(rollcallId, data, account) {
    if (data === undefined) throw fail('INVALID_ATTENDANCE');
    return answerRollcall(rollcallId, 'qr', { data }, qrReceipt, account);
  },
  authenticate(onAuthorized) {
    if (clearing || mustClear) return Promise.reject(fail('CLEANUP_REQUIRED'));
    authenticating ??= (async () => {
      if (logoutMarker().exists) throw fail('CLEANUP_REQUIRED');
      const recovery = recovering;
      if (recovery?.signal.aborted) throw fail('SESSION_DRAINING');
      const version = ++generation;
      active = null;
      recovery?.abort();
      for (const controller of requests.keys()) controller.abort();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.allSettled([recovery?.drain, persistence, ...requests.values()]),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(fail('SESSION_DRAINING')), requestTimeout); }),
        ]);
      } finally { clearTimeout(timer); }
      check(version);
      const { learning, session } = await readCache();
      check(version);
      await authenticate(learningAccount(learning) ?? session?.account, onAuthorized);
      check(version);
    })().finally(() => { authenticating = null; });
    return authenticating;
  },
};
