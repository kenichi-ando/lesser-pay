/**
 * Device label helpers for push subscription metadata.
 */

function detectDeviceType(
  ua: string,
  isIpad: boolean,
  isIphone: boolean,
  isAndroid: boolean,
  isMobile: boolean
): string {
  if (isIpad) return 'iPad';
  if (isIphone) return 'iPhone';
  if (isAndroid) return isMobile ? 'Android Phone' : 'Android Tablet';
  if (isMobile) return 'Mobile';
  return 'Desktop';
}

function detectOs(
  isIpad: boolean,
  isIphone: boolean,
  isAndroid: boolean,
  isWindows: boolean,
  isMac: boolean
): string {
  if (isIpad) return 'iPadOS';
  if (isIphone) return 'iOS';
  if (isAndroid) return 'Android';
  if (isWindows) return 'Windows';
  if (isMac) return 'macOS';
  return 'Unknown OS';
}

function detectBrowser(ua: string): string {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua) && !/Edg\//.test(ua)) return 'Safari';
  return 'Unknown Browser';
}

export function getDeviceLabel(): string {
  const ua = navigator.userAgent || '';
  const isIpad = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isIphone = /iPhone/.test(ua);
  const isAndroid = /Android/.test(ua);
  const isMobile = /Mobile/.test(ua);
  const isMac = /Macintosh|Mac OS X/.test(ua) && !isIpad;
  const isWindows = /Windows NT/.test(ua);
  const deviceType = detectDeviceType(ua, isIpad, isIphone, isAndroid, isMobile);
  const os = detectOs(isIpad, isIphone, isAndroid, isWindows, isMac);
  const browser = detectBrowser(ua);
  return deviceType + ' / ' + os + ' / ' + browser;
}
