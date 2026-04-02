import { Platform } from 'react-native';

/**
 * API base URL configuration.
 * Android emulator uses 10.0.2.2 to reach host machine's localhost.
 * iOS simulator can use localhost directly.
 */
const DEV_API_BASE = Platform.select({
  android: 'http://10.0.2.2:3001/api',
  ios: 'http://localhost:3001/api',
  default: 'http://localhost:3001/api',
});

const PROD_API_BASE = 'https://api.zoree.com/api'; // Replace with production URL

export const API_BASE = __DEV__ ? DEV_API_BASE : PROD_API_BASE;

export const APP_VERSION = '1.0.0';
export const APP_NAME = 'Zoree TMS';
