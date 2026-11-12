import { Platform, View } from 'react-native';
import { Stack, useNavigationContainerRef } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { DemoProvider, useDemo } from '@/demo-context';
import { SchoolBrowserHost } from '@/school-browser-view';
import { AttendanceNotificationBridge } from '@/attendance-notification-bridge';

function Navigation() {
  const { state, reducedMotion, dispatch } = useDemo();
  const navigation = useNavigationContainerRef();
  const presentation = Platform.OS === 'web' ? 'transparentModal' : 'formSheet';
  return <View style={{ flex: 1, backgroundColor: '#f3edf5', alignItems: 'center' }}><View style={{ flex: 1, width: '100%', maxWidth: Platform.OS === 'web' ? 440 : undefined }}>
    <StatusBar style="dark" />
    <Stack unstable_nativeProps={{ onFinishTransitioning: () => {
      // Screen listeners disappear with the popped route, before its native exit completes.
      const routes = navigation.getRootState()?.routes;
      if (!routes) return;
      const openIds = routes.filter(route => route.name === 'attendance').map(route =>
        (route.params as { id?: string } | undefined)?.id ?? state.rollcalls.at(-1)?.id).filter((id): id is string => !!id);
      dispatch({ type: 'attendance-dismissed', openIds });
    } }} screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#fff' }, animation: 'fade', animationDuration: 180, gestureEnabled: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="attendance" options={{
        presentation, gestureEnabled: true, contentStyle: { backgroundColor: presentation === 'transparentModal' ? 'transparent' : '#f9f2f8' },
        animation: reducedMotion ? 'fade' : 'slide_from_bottom',
        sheetAllowedDetents: 'fitToContents', sheetGrabberVisible: true, sheetCornerRadius: 30, sheetExpandsWhenScrolledToEdge: false,
      }} />
      <Stack.Screen name="list-styles" options={{
        presentation, gestureEnabled: true, contentStyle: { backgroundColor: presentation === 'transparentModal' ? 'transparent' : '#fcf8fc' },
        animation: reducedMotion ? 'fade' : 'slide_from_bottom', sheetAllowedDetents: 'fitToContents', sheetGrabberVisible: true, sheetCornerRadius: 30, sheetExpandsWhenScrolledToEdge: false,
      }} />
      <Stack.Screen name="course-styles" options={{
        presentation, gestureEnabled: true, contentStyle: { backgroundColor: presentation === 'transparentModal' ? 'transparent' : '#fcf8fc' },
        animation: reducedMotion ? 'fade' : 'slide_from_bottom', sheetAllowedDetents: 'fitToContents', sheetGrabberVisible: true, sheetCornerRadius: 30, sheetExpandsWhenScrolledToEdge: false,
      }} />
      <Stack.Screen name="debug-choice" options={{
        presentation, gestureEnabled: true, contentStyle: { backgroundColor: presentation === 'transparentModal' ? 'transparent' : '#fcf8fc' },
        animation: reducedMotion ? 'fade' : 'slide_from_bottom', sheetAllowedDetents: 'fitToContents', sheetGrabberVisible: true, sheetCornerRadius: 30, sheetExpandsWhenScrolledToEdge: false,
      }} />
      <Stack.Screen name="conflict-styles" options={{
        presentation, gestureEnabled: true, contentStyle: { backgroundColor: presentation === 'transparentModal' ? 'transparent' : '#fcf8fc' },
        animation: reducedMotion ? 'fade' : 'slide_from_bottom', sheetAllowedDetents: 'fitToContents', sheetGrabberVisible: true, sheetCornerRadius: 30, sheetExpandsWhenScrolledToEdge: false,
      }} />
      <Stack.Screen name="conflicts" options={{
        presentation, gestureEnabled: true, contentStyle: { backgroundColor: presentation === 'transparentModal' ? 'transparent' : '#fcf8fc' },
        animation: reducedMotion ? 'fade' : 'slide_from_bottom', sheetAllowedDetents: 'fitToContents', sheetGrabberVisible: true, sheetCornerRadius: 30, sheetExpandsWhenScrolledToEdge: false,
      }} />
    </Stack>
  </View></View>;
}
export default function Layout() {
  const [fontsReady, fontError] = useFonts(Ionicons.font);
  if (fontError) throw fontError;
  if (!fontsReady) return null;
  return <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider><DemoProvider><Navigation /><SchoolBrowserHost /><AttendanceNotificationBridge /></DemoProvider></SafeAreaProvider></GestureHandlerRootView>;
}
