import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.goalvault.app',
  appName: 'GoalVault',
  webDir: 'dist',
  // Everything runs from the bundled assets — the app works with no network at
  // all, and nothing about a user's finances leaves the device.
  server: {
    androidScheme: 'https',
  },
  android: {
    backgroundColor: '#080b14',
    // Debug builds are what people sideload for testing; a mixed-content block
    // is not a concern when nothing is loaded over the network.
    allowMixedContent: false,
  },
  ios: {
    backgroundColor: '#080b14',
    contentInset: 'always',
  },
  plugins: {
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#080b14',
    },
  },
};

export default config;
