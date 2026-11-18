export const IDENTITY = 'https://c-identity.xmu.edu.cn/auth/realms/xmu/protocol/openid-connect';
export const CAS_LOGIN = 'https://ids.xmu.edu.cn/authserver/login';
export const CALLBACK = 'https://c-mobile.xmu.edu.cn/identity-web-login-callback?_h5=true';
export const JW_APP = 'https://jw.xmu.edu.cn/appShow?appId=4979568947762216';
export const LNT_HOME = 'https://lnt.xmu.edu.cn/';
export const LNT_LANDING = LNT_HOME + 'user/index';
export function schoolUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && (url.hostname === 'xmu.edu.cn' || url.hostname.endsWith('.xmu.edu.cn'));
  } catch { return false; }
}
export function identityPage(value: string) {
  if (!schoolUrl(value)) return false;
  const { origin, pathname } = new URL(value);
  return origin + pathname === CAS_LOGIN
    || origin === new URL(IDENTITY).origin && pathname.startsWith('/auth/realms/xmu/');
}
export type BrowserRequest = { url: string } & ({ kind: 'authorize' | 'academic' } | { kind: 'recovery'; challenge: string });
type BrowserState = BrowserRequest | { kind: 'pending' };
type BrowserFailure = { nativeCode?: number; httpStatus?: number };
export function createSchoolBrowser(onCancel?: () => void) {
  let request: BrowserState | null = null;
  let result: { resolve(value: string): void; reject(error: Error): void } | null = null;
  let mounted: BrowserRequest | null = null;
  let afterUnmount: (() => void) | null = null;
  const listeners = new Set<() => void>();
  const error = (code: string) => Object.assign(Error(code), { code });
  function finish(expected: BrowserState, value = '', code?: string, detail?: BrowserFailure) {
    if (request !== expected) return;
    const pending = result;
    // Keep the modal open while each completed WebView is disposed and API work continues.
    request = code || expected.kind === 'recovery' ? null : { kind: 'pending' }; result = null;
    const settle = () => { if (code) pending?.reject(Object.assign(error(code), detail)); else pending?.resolve(value); };
    const waitForUnmount = mounted === expected;
    if (waitForUnmount) afterUnmount = settle;
    listeners.forEach(listener => listener());
    if (!waitForUnmount) settle();
  }
  function start(page: BrowserRequest, signal?: AbortSignal) {
    const { url, kind } = page;
    if (signal?.aborted) return Promise.reject(error('CANCELLED'));
    if ((request && request.kind !== 'pending') || afterUnmount) return Promise.reject(error('BUSY'));
    if (!schoolUrl(url)) return Promise.reject(error('UNTRUSTED_LINK'));
    if (kind === 'authorize') {
      const auth = new URL(url);
      if (auth.origin + auth.pathname !== IDENTITY + '/auth' || auth.searchParams.get('redirect_uri') !== CALLBACK
        || !auth.searchParams.get('state')) return Promise.reject(error('INVALID_AUTHORIZATION'));
    }
    return new Promise<string>((resolve, reject) => {
      const abort = () => finish(page, '', 'CANCELLED');
      signal?.addEventListener('abort', abort, { once: true });
      request = page;
      result = {
        resolve(value) { signal?.removeEventListener('abort', abort); resolve(value); },
        reject(cause) { signal?.removeEventListener('abort', abort); reject(cause); },
      };
      listeners.forEach(listener => listener());
    });
  }
  function close() { if (request) finish(request, '', 'CANCELLED'); }
  return {
    getSnapshot: () => request,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    attach(expected: BrowserRequest) {
      mounted = expected;
      return () => {
        if (mounted !== expected) return;
        mounted = null;
        const settle = afterUnmount;
        afterUnmount = null;
        if (settle) settle();
      };
    },
    authenticate: (url: string) => start({ url, kind: 'authorize' }),
    initializeAcademic: () => start({ url: JW_APP, kind: 'academic' }),
    recover: (signal: AbortSignal, challenge: string) => start({ url: LNT_HOME, kind: 'recovery', challenge }, signal),
    navigating(expected: BrowserRequest, value: string) {
      if (request !== expected) return true;
      if (expected.kind !== 'authorize' || !schoolUrl(value)) return false;
      const url = new URL(value), callback = new URL(CALLBACK);
      if (url.origin !== callback.origin || url.pathname !== callback.pathname) return false;
      const state = new URL(expected.url).searchParams.get('state');
      if (url.hash || url.searchParams.getAll('_h5').length !== 1 || url.searchParams.get('_h5') !== 'true'
        || url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== state
        || url.searchParams.getAll('code').length > 1 || url.searchParams.getAll('error').length > 1) {
        finish(expected, '', 'INVALID_CALLBACK');
      } else if (url.searchParams.has('error')) finish(expected, '', 'AUTH_FAILED');
      else if (!url.searchParams.get('code')?.trim()) finish(expected, '', 'INVALID_CALLBACK');
      else finish(expected, url.searchParams.get('code')!);
      return true;
    },
    loaded(expected: BrowserRequest, value: string) {
      if (request !== expected || !schoolUrl(value)) return;
      const url = new URL(value);
      if (expected.kind === 'academic' && url.origin === 'https://jw.xmu.edu.cn' && url.pathname.startsWith('/gsapp/sys/wdkbapp/')) finish(expected);
    },
    recoveryDocument(expected: BrowserRequest, topUrl: string, { data, url: source }: { data: string; url: string }) {
      if (request !== expected || expected.kind !== 'recovery' || !schoolUrl(topUrl) || !schoolUrl(source)) return;
      const top = new URL(topUrl);
      const documentUrl = top.origin + top.pathname + top.search;
      const bridgeUrl = new URL(source);
      if (source !== top.origin && bridgeUrl.origin + bridgeUrl.pathname + bridgeUrl.search !== documentUrl) return;
      if (top.origin + top.pathname === LNT_LANDING && data === JSON.stringify([expected.challenge, 'landing', documentUrl])) finish(expected);
      if (identityPage(topUrl) && data === JSON.stringify([expected.challenge, 'interaction', documentUrl])) finish(expected, '', 'AUTH_REQUIRED');
    },
    fail(expected: BrowserRequest, code: string, detail?: BrowserFailure) { finish(expected, '', code, detail); },
    close,
    cancel() { if (request) { onCancel?.(); close(); } },
  };
}
