const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

module.exports = function withBackgroundTrial(config) {
  return withAndroidManifest(config, mod => {
    const manifest = mod.modResults.manifest;
    const permissions = manifest['uses-permission'] ??= [];
    for (const name of ['FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_DATA_SYNC', 'WAKE_LOCK']) {
      const permission = `android.permission.${name}`;
      if (!permissions.some(item => item.$['android:name'] === permission)) permissions.push({ $: { 'android:name': permission } });
    }
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    const services = application.service ??= [];
    const name = 'com.asterinet.react.bgactions.RNBackgroundActionsTask';
    let service = services.find(item => item.$['android:name'] === name);
    if (!service) { service = { $: { 'android:name': name } }; services.push(service); }
    // The library declares the service, but leaves its required Android 14+ type to the app.
    service.$['android:foregroundServiceType'] = 'dataSync';
    service.$['android:exported'] = 'false';
    return mod;
  });
};
