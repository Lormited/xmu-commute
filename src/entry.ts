import '@expo/metro-runtime';
import { AppRegistry, Platform } from 'react-native';
import 'expo-router/entry';

if (Platform.OS === 'android') {
  AppRegistry.registerHeadlessTask('SchoolReminderJob', () => async ({ token }: { token: string }) => {
    try {
      const { runSchoolReminderJob }: typeof import('./school-reminder-device') = require('./school-reminder-device');
      await runSchoolReminderJob(token);
    } catch {
      // RN must acknowledge task completion so the Job can retry without overlapping JS runs.
    }
  });
}
