import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { ActivityIndicator, Modal, Text, View } from 'react-native';
import WebView from 'react-native-webview';
import { identityPage, schoolUrl, type BrowserRequest } from './school-browser';
import { schoolBrowser } from './school-device';

const interactionRequired = 'school-interaction-required';
const detectInteraction = `(() => {
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
      window.ReactNativeWebView.postMessage('${interactionRequired}');
      return;
    }
  }
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
  return <WebView<object> ref={web} source={{ uri: request.url }} style={{ flex: 1 }} originWhitelist={['*']}
      startInLoadingState={!recovery} renderLoading={() => <LoginProgress label={request.kind === 'authorize' ? '正在打开学校登录页面' : '正在连接教务系统'} />}
      onShouldStartLoadWithRequest={event => schoolUrl(event.url)}
      injectedJavaScript={recovery ? detectInteraction : undefined}
      onMessage={recovery ? ({ nativeEvent: { data, url } }) => {
        if (data === interactionRequired && identityPage(topUrl.current) && schoolUrl(url)
          && new URL(url).origin === new URL(topUrl.current).origin) schoolBrowser.fail(request, 'AUTH_REQUIRED');
      } : undefined}
      javaScriptEnabled domStorageEnabled sharedCookiesEnabled cacheEnabled={false} saveFormDataDisabled
      allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
      mixedContentMode="never" setSupportMultipleWindows={false} webviewDebuggingEnabled={false}
      onLoadStart={event => {
        console.info('[school-browser]', { page: request.kind, event: 'load-start' });
        topUrl.current = event.nativeEvent.url; schoolBrowser.navigating(request, event.nativeEvent.url);
      }}
      onLoadEnd={event => {
        console.info('[school-browser]', { page: request.kind, event: 'load-end' });
        schoolBrowser.loaded(request, event.nativeEvent.url);
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
