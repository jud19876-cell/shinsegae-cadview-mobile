import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mycompany.cadview',
  appName: '신세계 CAD뷰어',
  webDir: 'dist',
  server: {
    url: 'https://com-example-myapplicatio-64de9.web.app',
    cleartext: true
  }
};

export default config;
