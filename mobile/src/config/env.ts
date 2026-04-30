import { Platform } from 'react-native';

/**
 * API base URL configuration.
 * Android emulator uses 10.0.2.2 to reach host machine's localhost.
 * iOS simulator can use localhost directly.
 */
/**
 * IMPORTANT: Replace this IP with your computer's local network IP.
 * Find it by running: ipconfig (Windows) or ifconfig (Mac/Linux)
 * Your iPhone must be on the same Wi-Fi network as your computer.
 */
const LOCAL_IP = '100.110.157.135';

const DEV_API_BASE = Platform.select({
  android: `http://10.0.2.2:3001/api`,
  ios: `http://${LOCAL_IP}:3001/api`,
  default: `http://${LOCAL_IP}:3001/api`,
});

const PROD_API_BASE = 'https://retained-rendering-donors-behaviour.trycloudflare.com/api';

export const API_BASE = __DEV__ ? DEV_API_BASE : PROD_API_BASE;

export const APP_VERSION = '1.0.0';
export const APP_NAME = 'Zoree TMS';
