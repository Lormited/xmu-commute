import { useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Button, Icon, c } from './ui';

export function QrAttendance({ onScan }: { onScan: (rawScanText: string) => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState('');
  const [requesting, setRequesting] = useState(false);
  const pending = useRef(false), scanned = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function allowCamera() {
    if (pending.current) return;
    pending.current = true; setRequesting(true);
    try { await requestPermission(); }
    catch { if (mounted.current) setError('无法取得相机权限，请重试'); }
    finally { pending.current = false; if (mounted.current) setRequesting(false); }
  }
  async function openSettings() {
    try { await Linking.openSettings(); }
    catch { if (mounted.current) setError('无法打开系统设置，请手动检查相机权限'); }
  }
  if (error) return <><Text accessibilityRole="alert" style={a.hint}>{error}</Text><Button secondary label="重试" onPress={() => setError('')} /></>;
  if (!permission) return <Text accessibilityLiveRegion="polite" style={a.hint}>正在检查相机权限</Text>;
  if (!permission.granted) return <>
    <View style={[a.scanner, a.placeholder]}><Icon name="scan-outline" size={76} color="#a08bad" /></View>
    <Text style={a.hint}>{permission.canAskAgain ? '允许相机后，扫描当前活动的学校二维码' : '请在系统设置中允许相机权限，然后重新打开签到'}</Text>
    <Button label={requesting ? '正在请求权限' : permission.canAskAgain ? '允许相机' : '打开系统设置'} disabled={requesting} onPress={permission.canAskAgain ? allowCamera : openSettings} />
  </>;
  return <>
    <View style={a.scanner}>
      <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onMountError={() => { if (mounted.current) setError('相机无法启动，请检查权限后重试'); }}
        onBarcodeScanned={({ type, data }) => {
          if (!mounted.current || scanned.current || type !== 'qr' || typeof data !== 'string') return;
          scanned.current = true;
          onScan(data);
        }} />
    </View>
    <Text style={a.hint}>对准当前活动的学校二维码，识别后自动提交</Text>
  </>;
}

const a = StyleSheet.create({
  scanner: { height: 160, borderRadius: 24, overflow: 'hidden', backgroundColor: '#f1eaf6' },
  placeholder: { justifyContent: 'center', alignItems: 'center' },
  hint: { fontSize: 12, color: c.muted, lineHeight: 18, textAlign: 'center' },
});
