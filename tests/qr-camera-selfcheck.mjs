import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import React from 'react';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = ts.transpileModule(readFileSync(new URL('../src/qr-attendance.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function camera(initialPermission, requestFails = false) {
  let permission = initialPermission, cursor = 0, tree, requests = 0, settings = 0;
  const hooks = [], scans = [], effects = [], exports = {};
  runInNewContext(source, { exports, require(name) {
    if (name === 'react') return {
      ...React,
      useState(value) { const slot = hooks[cursor++] ??= { value }; return [slot.value, next => { slot.value = next; }]; },
      useRef(value) { return hooks[cursor++] ??= { current: value }; },
      useEffect(effect) { const slot = hooks[cursor++] ??= {}; if (!slot.ran) { effects.push(() => { slot.cleanup = effect(); slot.ran = true; }); } },
    };
    if (name === 'expo-camera') return { CameraView: 'CameraView', useCameraPermissions: () => [permission, async () => {
      requests++; if (requestFails) throw Error('native-private-error'); permission = { granted: true, canAskAgain: true };
    }] };
    if (name === 'react-native') return { Text: 'Text', View: 'View', StyleSheet: { create: value => value, absoluteFill: {} }, Linking: { openSettings: async () => { settings++; } } };
    if (name === './ui') return { Button: 'Button', Icon: 'Icon', s: {}, c: {} };
    return require(name);
  } });
  function render() { cursor = 0; tree = exports.QrAttendance({ onScan: raw => scans.push(raw) }); effects.splice(0).forEach(effect => effect()); }
  function find(predicate, node = tree) {
    if (!node || typeof node !== 'object') return;
    if (predicate(node)) return node;
    for (const child of React.Children.toArray(node.props?.children)) { const found = find(predicate, child); if (found) return found; }
  }
  render();
  return { render, find, scans, get requests() { return requests; }, get settings() { return settings; },
    unmount: () => hooks.forEach(slot => slot.cleanup?.()) };
}

test('camera asks for permission, scans only QR once and forwards the untouched scanner text', async () => {
  const app = camera({ granted: false, canAskAgain: true });
  assert.equal(app.find(node => node.type === 'CameraView'), undefined);
  await app.find(node => node.props?.label === '允许相机').props.onPress(); app.render();
  assert.equal(app.requests, 1);
  const view = app.find(node => node.type === 'CameraView');
  assert.equal(view.props.facing, 'back');
  assert.deepEqual([...view.props.barcodeScannerSettings.barcodeTypes], ['qr']);
  view.props.onBarcodeScanned({ type: 'ean13', data: 'ignored' });
  view.props.onBarcodeScanned({ type: 'qr', data: '  exact scan text  ' });
  view.props.onBarcodeScanned({ type: 'qr', data: 'duplicate' });
  assert.deepEqual(app.scans, ['  exact scan text  ']);
  const closed = camera({ granted: true, canAskAgain: true }), late = closed.find(node => node.type === 'CameraView').props.onBarcodeScanned;
  closed.unmount(); late({ type: 'qr', data: 'late' });
  assert.deepEqual(closed.scans, []);
});

test('permission and camera errors remain local and allow an explicit retry without exposing native details', async () => {
  const denied = camera({ granted: false, canAskAgain: false });
  assert.equal(denied.find(node => node.type === 'CameraView'), undefined);
  await denied.find(node => node.props?.label === '打开系统设置').props.onPress();
  assert.equal(denied.settings, 1); assert.equal(denied.requests, 0);
  const failed = camera({ granted: false, canAskAgain: true }, true);
  await failed.find(node => node.props?.label === '允许相机').props.onPress(); failed.render();
  assert.ok(failed.find(node => node.props?.accessibilityRole === 'alert'));
  const app = camera({ granted: true, canAskAgain: true });
  app.find(node => node.type === 'CameraView').props.onMountError({ message: 'private-native-detail' }); app.render();
  assert.equal(app.find(node => node.type === 'CameraView'), undefined);
  const alert = app.find(node => node.props?.accessibilityRole === 'alert');
  assert.doesNotMatch(alert.props.children, /private/);
  app.find(node => node.props?.label === '重试').props.onPress(); app.render();
  assert.ok(app.find(node => node.type === 'CameraView'));
});
