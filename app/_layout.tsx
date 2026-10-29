import { Platform, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { DemoProvider, useDemo } from '@/demo-context';

function Navigation() {
  const { reducedMotion } = useDemo();
  const presentation = Platform.OS === 'web' ? 'transparentModal' : 'formSheet';
  return <View style={{ flex: 1, backgroundColor: '#f3edf5', alignItems: 'center' }}><View style={{ flex: 1, width: '100%', maxWidth: Platform.OS === 'web' ? 440 : undefined }}>
    <StatusBar style="dark" />
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#fff' }, animation: 'fade', animationDuration: 180, gestureEnabled: false }}>
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
      <Stack.Screen name="login" options={{ presentation: 'modal', gestureEnabled: true, animation: reducedMotion ? 'fade' : 'slide_from_bottom' }} />
    </Stack>
  </View></View>;
}
export default function Layout() {
  const [fontsReady, fontError] = useFonts(Ionicons.font);
  if (fontError) throw fontError;
  if (!fontsReady) return null;
  return <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider><DemoProvider><Navigation /></DemoProvider></SafeAreaProvider></GestureHandlerRootView>;
}
