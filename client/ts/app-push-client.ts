/// <reference path="./global.d.ts" />
/// <reference path="../../shared/contracts.d.ts" />
/**
 * Web Push subscription lifecycle (client side).
 */
import { getDeviceLabel } from './app-device';

function isStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.navigator?.standalone === true) return true;
  if (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) return true;
  return false;
}

function isIosDevice(): boolean {
  const ua = (navigator.userAgent || '') + ' ' + (navigator.platform || '');
  // iPadOS 13+ reports as "MacIntel" but exposes touch — treat that as iOS too.
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true;
  return false;
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  return (typeof Notification !== 'undefined' && Notification.permission) ? Notification.permission : 'unsupported';
}

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - base64Url.length % 4) % 4);
  const source = base64Url + padding;
  let base64 = '';
  for (const ch of source) {
    if (ch === '-') base64 += '+';
    else if (ch === '_') base64 += '/';
    else base64 += ch;
  }
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  let i = 0;
  for (const ch of raw) {
    out[i++] = ch.codePointAt(0) || 0;
  }
  return out;
}

function bufferToBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (const byte of bytes) {
    bin += String.fromCodePoint(byte);
  }
  const source = btoa(bin);
  let base = '';
  for (const ch of source) {
    if (ch === '+') base += '-';
    else if (ch === '/') base += '_';
    else base += ch;
  }
  while (base.endsWith('=')) {
    base = base.slice(0, -1);
  }
  return base;
}

async function ensureServiceWorkerRegistered(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.getRegistration('/');
  if (reg) return reg;
  const created = await navigator.serviceWorker.register('/sw.js');
  return created;
}

export function pushSupported(): boolean {
  if (!('serviceWorker' in navigator) || !('Notification' in window) || !('PushManager' in window)) return false;
  // iOS only delivers Web Push to installed PWAs. In a regular Safari tab
  // PushManager exists but subscribe() never fires notifications, so we
  // disable the toggle to avoid a confusing "enabled but silent" state.
  if (isIosDevice() && !isStandaloneMode()) return false;
  return true;
}

export interface PushClientDeps {
  state: Pick<LPAppState, 'parentMode' | 'pushConfig'>;
  tr: LPTranslator;
  toast: (message: string, kind?: string) => void;
  api: <A extends SharedActionName>(
    action: A,
    payload?: Partial<SharedActionPayloadMap[A]>
  ) => Promise<SharedApiSuccess<A>>;
}

export function createPushClient(deps: PushClientDeps) {
  const state = deps.state;
  const tr = deps.tr;
  let pushSubscribed = false;

  function setPushSubscribedState(isEnabled: boolean) {
    pushSubscribed = !!isEnabled;
  }

  function isPushConfigured() {
    return !!state.pushConfig?.enabled && !!state.pushConfig?.publicKey;
  }

  async function syncPushSubscription(reg: ServiceWorkerRegistration) {
    const current = await reg.pushManager.getSubscription();
    if (!current) return false;
    const p256dh = current.getKey('p256dh');
    const auth = current.getKey('auth');
    await deps.api('subscribePush', {
      role: state.parentMode ? 'parent' : 'child',
      deviceLabel: getDeviceLabel(),
      subscription: {
        endpoint: current.endpoint,
        keys: {
          p256dh: p256dh ? bufferToBase64Url(p256dh) : '',
          auth: auth ? bufferToBase64Url(auth) : ''
        }
      }
    });
    return true;
  }

  async function refreshPushSubscriptionRole() {
    if (!pushSupported()) return;
    if (!isPushConfigured()) return;
    try {
      const reg = await ensureServiceWorkerRegistered();
      await syncPushSubscription(reg);
    } catch (err) {
      console.warn('push role refresh failed', err);
      // Keep the UI responsive even if push sync fails.
    }
  }

  async function disablePushNotifications() {
    if (!pushSupported()) return;
    try {
      const reg = await ensureServiceWorkerRegistered();
      const current = await reg.pushManager.getSubscription();
      if (current) {
        await deps.api('unsubscribePush', { endpoint: current.endpoint });
        await current.unsubscribe();
      }
      setPushSubscribedState(false);
      deps.toast(tr('push.disabledToast'), 'success');
    } catch (e) {
      console.warn('disable push failed', e);
      deps.toast(tr('push.failed'), 'error');
    }
  }

  async function enablePushNotifications() {
    if (!pushSupported()) {
      deps.toast(tr('push.unsupported'), 'error');
      return;
    }
    if (!isPushConfigured()) return;
    if (getNotificationPermission() === 'denied') {
      deps.toast(tr('push.denied'), 'error');
      return;
    }
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        return;
      }
      const reg = await ensureServiceWorkerRegistered();
      const current = await reg.pushManager.getSubscription();
      if (!current) {
        await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToUint8Array(state.pushConfig.publicKey) as BufferSource
        });
      }
      await syncPushSubscription(reg);
      setPushSubscribedState(true);
      deps.toast(tr('push.enabledToast'), 'success');
    } catch (err) {
      console.warn('enable push failed', err);
      deps.toast(tr('push.failed'), 'error');
    }
  }

  async function setupPushSubscription() {
    if (!pushSupported()) return;
    if (!isPushConfigured()) return;
    try {
      const reg = await ensureServiceWorkerRegistered();
      const subscribed = await syncPushSubscription(reg);
      setPushSubscribedState(subscribed);
    } catch (err) {
      console.warn('setup push subscription failed', err);
      setPushSubscribedState(false);
    }
  }

  return {
    refreshPushSubscriptionRole,
    enablePush: enablePushNotifications,
    disablePush: disablePushNotifications,
    setupPushSubscription,
    isPushEnabled: function () {
      return !!pushSubscribed;
    },
    isPushSupported: function () {
      return pushSupported() && isPushConfigured();
    },
    pushPermission: getNotificationPermission,
    // Exported for settings UI that may want iOS install hints later.
    isStandaloneMode,
    isIosDevice,
  };
}
