import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CookieJar } from 'tough-cookie';
import { captureSchoolCookies, schoolHttpUrl, schoolJarFrom, setSchoolCookies } from '../src/school-cookies.ts';

const lnt = 'https://lnt.xmu.edu.cn';
const ids = 'https://ids.xmu.edu.cn';
const jw = 'https://jw.xmu.edu.cn';
const profile = lnt + '/api/profile';
const login = lnt + '/api/login?login=access_token';
const cas = ids + '/authserver/login';
const identity = 'https://c-identity.xmu.edu.cn/auth/realms/xmu/protocol/openid-connect/auth';
const callback = 'https://c-mobile.xmu.edu.cn/identity-web-login-callback';
const terms = jw + '/gsapp/sys/wdkbapp/modules/xskcb/kfdxnxqcx.do';

test('HTTP cookie targets are the five exact HTTPS school hosts', () => {
  for (const url of [profile, cas, identity, callback, terms]) assert.equal(schoolHttpUrl(url).href, url);
  for (const url of [
    'http://lnt.xmu.edu.cn/', 'https://xmu.edu.cn/', 'https://other.xmu.edu.cn/',
    'https://lnt.xmu.edu.cn.evil.test/', 'https://sub.lnt.xmu.edu.cn/', '//lnt.xmu.edu.cn/',
    'https://lnt.xmu.edu.cn:443/', 'https://lnt.xmu.edu.cn:444/', 'https://lnt.xmu.edu.cn:/',
    'https://user:pass@lnt.xmu.edu.cn/', 'https://@lnt.xmu.edu.cn/', 'https://lnt.xmu.edu.cn./',
  ]) assert.throws(() => schoolHttpUrl(url));
});

test('first binding imports scoped SSO and JW cookies from three pinned routes', async () => {
  const readUrls = [];
  const jar = await captureSchoolCookies(async url => {
    readUrls.push(url);
    if (url === cas) return [
      { name: 'sso', value: 'test', domain: 'ids.xmu.edu.cn', path: '/authserver', secure: true, httpOnly: true, sameSite: 'lax' },
      { name: 'shared', value: 'test', domain: '.xmu.edu.cn', path: '/', secure: true },
      { name: 'old', value: 'test', domain: 'lnt.xmu.edu.cn', path: '/' },
      { name: 'wrongPath', value: 'test', domain: 'ids.xmu.edu.cn', path: '/auth' },
    ];
    if (url === terms) return [{ name: 'jw', value: 'test', domain: '.jw.xmu.edu.cn', path: '/gsapp' }];
    return [];
  });
  assert.deepEqual(readUrls, [cas, identity, terms]);
  assert.equal(jar.getCookieStringSync(cas), 'sso=test; shared=test');
  const [sso] = jar.getCookiesSync(cas);
  assert.deepEqual([sso.hostOnly, sso.secure, sso.httpOnly, sso.sameSite], [true, true, true, 'lax']);
  assert.equal(jar.getCookieStringSync(ids + '/authserver-other'), 'shared=test');
  assert.equal(jar.getCookieStringSync('https://sub.ids.xmu.edu.cn/authserver/login'), 'shared=test');
  assert.equal(jar.getCookieStringSync(profile), 'shared=test');
  assert.equal(jar.getCookieStringSync(terms), 'jw=test; shared=test');
  assert.equal(jar.getCookiesSync(terms)[0].hostOnly, false);
});

test('first binding fails closed on legacy WebView cookie data', async () => {
  await assert.rejects(captureSchoolCookies(async () => [{ name: 'unknown', value: 'test', domain: null, path: null }]), /COOKIE_STORAGE/);
});

test('HTTP login acquires the new LNT cookie and reports only real changes', async () => {
  const jar = await captureSchoolCookies(async url => url === cas ? [
    { name: 'lnt', value: 'old', domain: '.lnt.xmu.edu.cn', path: '/api' },
  ] : []);
  const lntCookie = ['Set-Cookie', 'lnt=new; Secure; HttpOnly; SameSite=Strict'];
  assert.equal(jar.getCookieStringSync(profile), '');
  assert.equal(setSchoolCookies(jar, login, [lntCookie]), true);
  assert.equal(jar.getCookieStringSync(profile), 'lnt=new');
  assert.equal(jar.getCookieStringSync(lnt + '/apiary'), '');
  assert.equal(jar.getCookieStringSync('https://sub.lnt.xmu.edu.cn/api/profile'), '');
  assert.equal(jar.getCookieStringSync(profile, { sameSiteContext: 'lax' }), '');
  assert.equal(jar.getCookieStringSync(profile, { http: false }), '');
  assert.equal(setSchoolCookies(jar, login, [lntCookie]), false);
  assert.equal(setSchoolCookies(jar, login, [['set-cookie', 'lnt=updated; Secure; HttpOnly; SameSite=Strict']]), true);
  assert.equal(jar.getCookieStringSync(profile), 'lnt=updated');
  assert.equal(setSchoolCookies(jar, login, [['set-cookie', 'lnt=; Max-Age=0; Path=/elsewhere']]), false);
  assert.equal(setSchoolCookies(jar, login, [['set-cookie', 'lnt=; Max-Age=0; Expires=Thu, 01 Jan 2099 00:00:00 GMT']]), true);
  assert.deepEqual(jar.serializeSync().cookies, []);
  assert.equal(setSchoolCookies(jar, login, [['set-cookie', 'lnt=; Max-Age=0']]), false);
});

test('HTTP cookies reject mismatched scope and handle expiry, including off-request paths', () => {
  const jar = new CookieJar();
  assert.throws(() => setSchoolCookies(jar, 'http://lnt.xmu.edu.cn/', [['Set-Cookie', 'bad=test']]));
  assert.equal(setSchoolCookies(jar, login, [
    ['x-set-cookie', 'bad=test'], ['Set-Cookie', 'wrong=test; Domain=ids.xmu.edu.cn'],
    ['Set-Cookie', 'public=test; Domain=edu.cn'], ['Set-Cookie', 'invalid=test; SameSite=None'],
    ['Set-Cookie', '__Host-bad=test; Secure; Domain=lnt.xmu.edu.cn; Path=/'],
    ['Set-Cookie', 'bad=line\r\ninjection'],
  ]), false);
  assert.equal(setSchoolCookies(jar, login, [
    ['Set-Cookie', 'root=test; Domain=xmu.edu.cn; Path=/authserver; Secure; SameSite=None; Max-Age=60'],
    ['set-cookie', 'empty=; Path=/'],
  ]), true);
  assert.equal(jar.getCookieStringSync(profile), 'empty=');
  assert.equal(jar.getCookieStringSync(cas), 'root=test');
  assert.equal(setSchoolCookies(jar, login, [['Set-Cookie', 'root=; Domain=xmu.edu.cn; Path=/authserver; Expires=Thu, 01 Jan 1970 00:00:00 GMT']]), true);
  assert.equal(jar.getCookieStringSync(cas), '');
});

test('restore keeps HTTP-acquired LNT cookies and drops invalid persisted scope and flags', () => {
  const jar = new CookieJar();
  setSchoolCookies(jar, login, [['Set-Cookie', '__Host-lnt=new; Secure; Path=/; HttpOnly; SameSite=Lax']]);
  setSchoolCookies(jar, cas, [['Set-Cookie', 'sso=test; Secure; Domain=xmu.edu.cn; Path=/authserver']]);
  const stored = JSON.parse(JSON.stringify(jar.serializeSync()));
  const valid = stored.cookies.find(cookie => cookie.key === '__Host-lnt');
  for (const invalid of [
    { domain: 'other.xmu.edu.cn' }, { domain: 'evil.test' }, { domain: 'xmu.edu.cn', hostOnly: true },
    { domain: '.lnt.xmu.edu.cn' }, { hostOnly: null }, { hostOnly: 'true' },
    { path: 'api' }, { path: '/\r\n' }, { sameSite: 'unknown' }, { sameSite: 'none', secure: false },
    { secure: 'true' }, { httpOnly: 0 }, { expires: 'invalid' }, { expires: '1970-01-01T00:00:01.000Z' },
    { maxAge: '300' }, { value: 'test; extra=value' },
  ]) stored.cookies.push({ ...valid, key: 'bad', ...invalid });
  stored.cookies.push({ ...valid, key: '__Host-invalid', hostOnly: false }, null, 'bad');
  stored.prefixSecurity = 'unsafe-disabled';
  const restored = schoolJarFrom(stored);
  assert.deepEqual(restored.serializeSync().cookies.map(cookie => cookie.key).sort(), ['__Host-lnt', 'sso']);
  assert.equal(restored.getCookieStringSync(profile), '__Host-lnt=new');
  assert.equal(restored.getCookieStringSync(cas), 'sso=test');
  assert.equal(restored.getCookieStringSync(ids + '/authserver-other'), '');
  assert.equal(restored.getCookieStringSync('http://lnt.xmu.edu.cn/api/profile'), '');
  assert.equal(restored.getCookieStringSync('https://sub.lnt.xmu.edu.cn/api/profile'), '');
  assert.equal(restored.getCookieStringSync(profile, { sameSiteContext: 'none' }), '');
  assert.equal(restored.getCookieStringSync(profile, { http: false }), '');
  assert.deepEqual(schoolJarFrom({ cookies: {} }).serializeSync().cookies, []);
});

test('reading and restoring a Max-Age cookie does not extend its lifetime', ctx => {
  const start = Date.UTC(2026, 10, 19);
  ctx.mock.timers.enable({ apis: ['Date'], now: start });
  const jar = new CookieJar();
  setSchoolCookies(jar, login, [['Set-Cookie', 'short=test; Max-Age=5']]);
  ctx.mock.timers.tick(4000);
  assert.equal(jar.getCookieStringSync(profile), 'short=test');
  const restored = schoolJarFrom(JSON.parse(JSON.stringify(jar.serializeSync())));
  assert.equal(restored.getCookieStringSync(profile), 'short=test');
  ctx.mock.timers.tick(1000);
  assert.equal(restored.getCookieStringSync(profile), '');
  assert.equal(jar.getCookieStringSync(profile), '');
});
