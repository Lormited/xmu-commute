import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { ActivityIndicator, Modal, Text, View } from 'react-native';
import WebView from 'react-native-webview';
import { schoolUrl, type BrowserRequest } from './school-browser';
import { schoolBrowser } from './school-device';

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
  return <WebView<object> ref={web} source={{ uri: request.url }} style={{ flex: 1 }} originWhitelist={['*']}
      startInLoadingState renderLoading={() => <LoginProgress label={request.kind === 'authorize' ? '正在打开学校登录页面' : '正在连接教务系统'} />}
      onShouldStartLoadWithRequest={event => schoolUrl(event.url)}
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
  return request ? <Modal visible animationType="none" onRequestClose={() => schoolBrowser.cancel()}>
    {request.kind === 'pending' ? <LoginProgress /> : <LoginPage key={request.url} request={request} />}
  </Modal> : null;
}
