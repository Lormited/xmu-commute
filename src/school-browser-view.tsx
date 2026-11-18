import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { ActivityIndicator, Modal, Text, View } from 'react-native';
import WebView, { type WebViewMessageEvent } from 'react-native-webview';
import { LNT_LANDING, schoolUrl, type BrowserRequest } from './school-browser';
import { schoolBrowser } from './school-device';

const recoveryScript = (challenge: string) => `(() => {
  if (window.top !== window || document.readyState !== 'complete') return;
  const challenge = ${JSON.stringify(challenge)};
  const documentId = crypto.getRandomValues(new Uint32Array(4)).join('-');
  function inspect(navigation) {
    if (document.readyState !== 'complete') return;
    const page = location.origin + location.pathname;
    const report = kind => window.ReactNativeWebView.postMessage(JSON.stringify([challenge, kind, page + location.search, documentId, navigation]));
    if (page === '${LNT_LANDING}') { report('landing'); return; }
    if (location.origin !== 'https://ids.xmu.edu.cn' && location.origin !== 'https://c-identity.xmu.edu.cn') return;
    for (const form of document.forms) {
      const action = new URL(form.action, location.href);
      if (action.origin !== location.origin) continue;
      const schoolForm = location.origin === 'https://ids.xmu.edu.cn'
        ? action.pathname === '/authserver/login' && form.querySelector('#pwdEncryptSalt')
        : action.pathname === '/auth/realms/xmu/login-actions/authenticate';
      if (!schoolForm) continue;
      const fields = form.querySelectorAll('input:not([type]), input[type="text"], input[type="password"], input[type="email"], input[type="tel"], input[type="number"]');
      if (Array.from(fields).some(field => field.getClientRects().length && getComputedStyle(field).visibility === 'visible')) {
        report('interaction');
        return;
      }
    }
  }
  document[challenge] = (id, navigation) => { if (id === documentId) inspect(navigation); };
  inspect(null);
})(); true;`;

function LoginProgress({ label = '正在完成登录' }: { label?: string }) {
  return <View style={{ position: 'absolute', inset: 0, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
    <ActivityIndicator />
    <Text accessibilityLiveRegion="polite">{label}</Text>
  </View>;
}
function LoginPage({ request }: { request: BrowserRequest }) {
  const web = useRef<WebView<object>>(null);
  const topUrl = useRef(request.url);
  const navigation = useRef(0);
  useLayoutEffect(() => {
    const page = web.current;
    const detach = schoolBrowser.attach(request);
    console.info('[school-browser]', { page: request.kind, event: 'open' });
    return () => {
      console.info('[school-browser]', { page: request.kind, event: 'close' });
      page?.stopLoading(); page?.clearHistory?.(); page?.clearFormData?.(); page?.clearCache(true);
      detach();
    };
  }, [request]);
  // react-native-webview 14.0.1 loses the request's frame flag; onLoadStart comes from main-frame visited history.
  const recovery = request.kind === 'recovery';
  function onRecoveryMessage({ nativeEvent }: WebViewMessageEvent) {
    if (request.kind !== 'recovery') return;
    let signal: unknown;
    try { signal = JSON.parse(nativeEvent.data); } catch { return; }
    if (!Array.isArray(signal) || signal.length !== 5) return;
    const [challenge, kind, url, documentId, observedNavigation] = signal;
    if (challenge !== request.challenge || typeof documentId !== 'string') return;
    const report = { url: nativeEvent.url, data: JSON.stringify([challenge, kind, url]) };
    if (observedNavigation === null) {
      schoolBrowser.recoveryDocument(request, topUrl.current, report, () => {
        web.current?.injectJavaScript(`document[${JSON.stringify(challenge)}]?.(${JSON.stringify(documentId)}, ${navigation.current}); true;`);
      });
    } else if (observedNavigation === navigation.current) {
      schoolBrowser.recoveryDocument(request, topUrl.current, report);
    }
  }
  return <WebView<object> ref={web} source={{ uri: request.url }} style={{ flex: 1 }} originWhitelist={['*']}
      startInLoadingState={!recovery} renderLoading={() => <LoginProgress label={request.kind === 'authorize' ? '正在打开学校登录页面' : '正在连接教务系统'} />}
      onShouldStartLoadWithRequest={event => schoolUrl(event.url)}
      injectedJavaScript={recovery ? recoveryScript(request.challenge) : undefined}
      onMessage={recovery ? onRecoveryMessage : undefined}
      javaScriptEnabled domStorageEnabled sharedCookiesEnabled cacheEnabled={false} saveFormDataDisabled
      allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
      mixedContentMode="never" setSupportMultipleWindows={false} webviewDebuggingEnabled={false}
      onLoadStart={event => {
        console.info('[school-browser]', { page: request.kind, event: 'load-start' });
        navigation.current++;
        topUrl.current = event.nativeEvent.url; schoolBrowser.navigating(request, event.nativeEvent.url);
      }}
      onLoadEnd={event => {
        console.info('[school-browser]', { page: request.kind, event: 'load-end' });
        if (!recovery) schoolBrowser.loaded(request, event.nativeEvent.url);
      }}
      onRenderProcessGone={() => schoolBrowser.fail(request, 'WEBVIEW_PROCESS_GONE')}
      onError={event => schoolBrowser.fail(request, 'NETWORK', { nativeCode: event.nativeEvent.code })}
      onHttpError={event => {
        if (event.nativeEvent.url === topUrl.current) schoolBrowser.fail(request, 'HTTP_ERROR', { httpStatus: event.nativeEvent.statusCode });
      }}
    />;
}
export function SchoolBrowserHost() {
  const request = useSyncExternalStore(schoolBrowser.subscribe, schoolBrowser.getSnapshot, schoolBrowser.getSnapshot);
  if (request?.kind === 'recovery') return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={{ position: 'absolute', inset: 0, opacity: 0 }}><LoginPage key={request.url} request={request} /></View>;
  return request ? <Modal visible animationType="none" onRequestClose={() => schoolBrowser.cancel()}>
    {request.kind === 'pending' ? <LoginProgress /> : <LoginPage key={request.url} request={request} />}
  </Modal> : null;
}
