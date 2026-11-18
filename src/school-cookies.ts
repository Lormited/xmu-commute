import { Cookie, CookieJar, defaultPath, domainMatch, pathMatch } from 'tough-cookie';
import { CAS_LOGIN, IDENTITY } from './school-browser.ts';

export type ImportedCookie = {
  name: string;
  value: string;
  domain?: string | null;
  path?: string | null;
  expires?: string | null;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string;
};

const schoolHosts = new Set([
  'lnt.xmu.edu.cn', 'ids.xmu.edu.cn', 'c-identity.xmu.edu.cn', 'c-mobile.xmu.edu.cn', 'jw.xmu.edu.cn',
]);
const schoolDomain = 'xmu.edu.cn';
const captureUrls = [CAS_LOGIN, IDENTITY + '/auth', 'https://jw.xmu.edu.cn/gsapp/sys/wdkbapp/modules/xskcb/kfdxnxqcx.do'];

export function schoolHttpUrl(input: string): URL {
  const authority = /^https:\/\/([a-z.-]+)(?=[/?#]|$)/i.exec(input)?.[1];
  if (!authority || !schoolHosts.has(authority.toLowerCase())) throw Error('UNTRUSTED_LINK');
  const url = new URL(input);
  if (url.protocol !== 'https:' || !schoolHosts.has(url.hostname) || url.username || url.password || url.port) {
    throw Error('UNTRUSTED_LINK');
  }
  return url;
}

function validPath(path: unknown): path is string {
  return typeof path === 'string' && /^\/[\x20-\x3a\x3c-\x7e]*$/.test(path);
}

function validCookie(cookie: Cookie) {
  const { key, value, domain, path, hostOnly, secure, sameSite } = cookie;
  const octets = value.startsWith('"') && value.endsWith('"') && value.length >= 2 ? value.slice(1, -1) : value;
  return domain != null && (schoolHosts.has(domain) || (domain === schoolDomain && hostOnly === false))
    && typeof hostOnly === 'boolean' && validPath(path)
    && /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) && /^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*$/.test(octets)
    && (sameSite === undefined || sameSite === 'lax' || sameSite === 'strict' || (sameSite === 'none' && secure))
    && (!/^__secure-/i.test(key) || secure)
    && (!/^__host-/i.test(key) || (secure && hostOnly && path === '/' && !cookie.pathIsDefault))
    && !cookie.extensions?.some(extension => /^partitioned(?:\s*=|$)/i.test(extension));
}

export async function captureSchoolCookies(read: (url: string) => Promise<readonly ImportedCookie[]>): Promise<CookieJar> {
  const jar = new CookieJar();
  for (const target of captureUrls) {
    const url = schoolHttpUrl(target);
    for (const entry of await read(target)) {
      if (!entry || typeof entry.domain !== 'string' || !entry.domain || !validPath(entry.path)) throw Error('COOKIE_STORAGE');
      const hostOnly = !entry.domain.startsWith('.');
      const domain = (hostOnly ? entry.domain : entry.domain.slice(1)).toLowerCase();
      if (hostOnly ? domain !== url.hostname : !domainMatch(url.hostname, domain, false)) continue;
      if (!pathMatch(url.pathname, entry.path)) continue;
      if (typeof entry.name !== 'string' || typeof entry.value !== 'string'
        || (entry.secure !== undefined && typeof entry.secure !== 'boolean')
        || (entry.httpOnly !== undefined && typeof entry.httpOnly !== 'boolean')
        || (entry.expires != null && typeof entry.expires !== 'string')) continue;
      const expires = entry.expires == null ? 'Infinity' : new Date(entry.expires);
      if (expires !== 'Infinity' && !(expires.getTime() > Date.now())) continue;
      const cookie = new Cookie({ key: entry.name, value: entry.value, domain, path: entry.path, hostOnly,
        secure: entry.secure, httpOnly: entry.httpOnly, sameSite: entry.sameSite, expires });
      if (validCookie(cookie)) jar.setCookieSync(cookie, url);
    }
  }
  return jar;
}

export function setSchoolCookies(jar: CookieJar, url: string, headers: readonly (readonly [string, string])[]): boolean {
  const origin = schoolHttpUrl(url);
  if (!jar.store.synchronous) throw Error('COOKIE_STORAGE');
  const now = new Date();
  let changed = false;
  for (const [name, header] of headers) {
    if (name.toLowerCase() !== 'set-cookie' || /[\r\n\0]/.test(header)) continue;
    const cookie = Cookie.parse(header);
    if (!cookie) continue;
    cookie.hostOnly = cookie.domain == null;
    cookie.domain ??= origin.hostname;
    cookie.pathIsDefault = cookie.path == null;
    cookie.path ??= defaultPath(origin.pathname);
    if (!validCookie(cookie) || !domainMatch(origin.hostname, cookie.domain, false)) continue;

    const { domain, path, key } = cookie;
    let previous: Cookie | undefined;
    jar.store.findCookie(domain, path, key, (error, found) => {
      if (error) throw error;
      previous = found ?? undefined;
    });
    const expiry = cookie.expiryTime(now) ?? Infinity;
    if (expiry <= now.getTime()) {
      if (!previous) continue;
      jar.store.removeCookie(domain, path, key, error => { if (error) throw error; });
      changed = true;
      continue;
    }
    cookie.expires = expiry === Infinity ? 'Infinity' : new Date(Math.min(expiry, 8.64e15));
    cookie.maxAge = null;
    if (previous?.hostOnly === cookie.hostOnly && previous.expiryTime() === cookie.expiryTime()
      && previous.toString() === cookie.toString()) continue;
    if (jar.setCookieSync(cookie, origin, { now })) changed = true;
  }
  return changed;
}

export function schoolJarFrom(value: unknown): CookieJar {
  if (!value || typeof value !== 'object' || !('cookies' in value) || !Array.isArray(value.cookies)) throw Error('COOKIE_STORAGE');
  const jar = new CookieJar();
  const now = Date.now();
  for (const entry of value.cookies as unknown[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const fields = entry as Record<string, unknown>;
    if (typeof fields.key !== 'string' || (fields.value !== undefined && typeof fields.value !== 'string')
      || (fields.sameSite !== undefined && typeof fields.sameSite !== 'string')
      || (fields.expires !== undefined && typeof fields.expires !== 'string')
      || (fields.maxAge !== undefined && fields.maxAge !== 'Infinity' && !Number.isSafeInteger(fields.maxAge))
      || ['secure', 'httpOnly', 'pathIsDefault'].some(flag => fields[flag] !== undefined && typeof fields[flag] !== 'boolean')
      || (fields.extensions !== undefined && !(Array.isArray(fields.extensions)
        && fields.extensions.every(extension => typeof extension === 'string')))) continue;
    const cookie = Cookie.fromJSON(fields);
    if (!cookie || !validCookie(cookie)) continue;
    if (cookie.expires instanceof Date && !Number.isFinite(cookie.expires.getTime())) continue;
    const accessed = cookie.lastAccessed instanceof Date && Number.isFinite(cookie.lastAccessed.getTime())
      ? cookie.lastAccessed : undefined;
    if (typeof cookie.maxAge === 'number' && !accessed) continue;
    const expiry = cookie.expiryTime(accessed);
    if (expiry === undefined || !(expiry > now)) continue;
    cookie.expires = expiry === Infinity ? 'Infinity' : new Date(Math.min(expiry, 8.64e15));
    cookie.maxAge = null;
    const created = cookie.creation instanceof Date && Number.isFinite(cookie.creation.getTime()) ? cookie.creation : undefined;
    const host = cookie.domain === schoolDomain ? 'lnt.xmu.edu.cn' : cookie.domain;
    jar.setCookieSync(cookie, schoolHttpUrl(`https://${host}/`), { now: created });
  }
  return jar;
}
