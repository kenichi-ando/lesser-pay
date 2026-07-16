/// <reference path="./global.d.ts" />
/// <reference path="../../shared/contracts.d.ts" />

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

function getNotificationPermission(): NotificationPermission | 'unsupported' {
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

function detectDeviceType(ua: string, isIpad: boolean, isIphone: boolean, isAndroid: boolean, isMobile: boolean): string {
  if (isIpad) return 'iPad';
  if (isIphone) return 'iPhone';
  if (isAndroid) return isMobile ? 'Android Phone' : 'Android Tablet';
  if (isMobile) return 'Mobile';
  return 'Desktop';
}

function detectOs(isIpad: boolean, isIphone: boolean, isAndroid: boolean, isWindows: boolean, isMac: boolean): string {
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

function getDeviceLabel(): string {
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

async function ensureServiceWorkerRegistered(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.getRegistration('/');
  if (reg) return reg;
  const created = await navigator.serviceWorker.register('/sw.js');
  return created;
}

function pushSupported(): boolean {
  if (!('serviceWorker' in navigator) || !('Notification' in window) || !('PushManager' in window)) return false;
  // iOS only delivers Web Push to installed PWAs. In a regular Safari tab
  // PushManager exists but subscribe() never fires notifications, so we
  // disable the toggle to avoid a confusing "enabled but silent" state.
  if (isIosDevice() && !isStandaloneMode()) return false;
  return true;
}

function showInviteError(error: HTMLElement, message: string) {
  error.textContent = message;
  error.classList.remove('hidden');
}

function clearInviteError(error: HTMLElement) {
  error.classList.add('hidden');
}

function scheduleInputFocus(input: HTMLInputElement) {
  setTimeout(function () { input.focus(); }, 50);
}

function closeInviteModal(modal: HTMLElement) {
  modal.classList.add('hidden');
}

function openInviteModal(modal: HTMLElement, input: HTMLInputElement, error: HTMLElement) {
  clearInviteError(error);
  modal.classList.remove('hidden');
  scheduleInputFocus(input);
}

function normalizeInviteCode(value: string) {
  return (value || '').trim().toUpperCase();
}

function getInviteModalElements(modal: HTMLElement): {
  modalTitle: HTMLElement | null;
  modalDesc: HTMLElement | null;
  input: HTMLInputElement | null;
  submit: HTMLButtonElement | null;
  cancel: HTMLButtonElement | null;
  error: HTMLElement | null;
} {
  return {
    modalTitle: modal.querySelector('.modal-title') as HTMLElement | null,
    modalDesc: modal.querySelector('.modal-desc') as HTMLElement | null,
    input: modal.querySelector('#invite-token-input') as HTMLInputElement | null,
    submit: modal.querySelector('#invite-submit-btn') as HTMLButtonElement | null,
    cancel: modal.querySelector('#invite-cancel-btn') as HTMLButtonElement | null,
    error: modal.querySelector('#invite-error') as HTMLElement | null
  };
}

(function () {
  'use strict';

  function create(deps: LPControllerDataDeps): LPControllerDataApi {
    const CONFIG = deps.CONFIG;
    const store = deps.store;
    const state = deps.state;
    const tr = deps.tr;
    const runtime = deps.runtime;
    const setStatus = deps.setStatus;
    const withBusy = deps.withBusy;
    let pushSubscribed = false;

    let dataCache: { ts: number; tasks: LPTask[]; history: LPHistoryItem[] } | null = null;

    function isValidInviteCode(value: string) {
      const code = normalizeInviteCode(value);
      return CONFIG.INVITE_CODE_PATTERN.test(code);
    }

    class UnauthorizedError extends Error {
      constructor() {
        super('unauthorized');
        this.name = 'UnauthorizedError';
      }
    }

    async function syncPushSubscription(reg: ServiceWorkerRegistration) {
      const current = await reg.pushManager.getSubscription();
      if (!current) return false;
      const p256dh = current.getKey('p256dh');
      const auth = current.getKey('auth');
      await api('subscribePush', {
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

    function setPushSubscribedState(isEnabled: boolean) {
      pushSubscribed = !!isEnabled;
    }

    function isPushConfigured() {
      return !!state.pushConfig?.enabled && !!state.pushConfig?.publicKey;
    }

    async function disablePushNotifications() {
      if (!pushSupported()) return;
      try {
        const reg = await ensureServiceWorkerRegistered();
        const current = await reg.pushManager.getSubscription();
        if (current) {
          await api('unsubscribePush', { endpoint: current.endpoint });
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
        store.setPushPromptDismissed();
        return;
      }
      try {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') {
          if (perm === 'denied') store.setPushPromptDismissed();
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

    function isPushSupportedNow() {
      return pushSupported() && isPushConfigured();
    }
    function isPushEnabled() {
      return !!pushSubscribed;
    }

    async function api<A extends SharedActionName>(action: A, payload?: Partial<SharedActionPayloadMap[A]>) {
      const token = store.getApiToken();
      if (!token) throw new UnauthorizedError();
      const body: Record<string, unknown> = { action: action, ...payload };
      if (state.user && body.user == null) body.user = state.user;

      let res;
      try {
        res = await fetch(CONFIG.API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
          },
          body: JSON.stringify(body)
        });
      } catch (err) {
        console.warn('api request failed', err);
        throw new Error(tr('errors.network'));
      }

      if (res.status === 401) {
        store.clearApiToken();
        throw new UnauthorizedError();
      }

      let data: SharedApiSuccess<A> | SharedApiFailure;
      try {
        data = await res.json();
      } catch (err) {
        console.warn('api response parse failed', err);
        throw new Error(tr('errors.network') + ' (' + res.status + ')');
      }
      if (!data.ok) {
        throw new Error((data as SharedApiFailure).error || tr('errors.unknown'));
      }
      return data;
    }

    function clearDataCache() {
      dataCache = null;
    }

    function setLoadingState(isLoading: boolean) {
      state.loading = isLoading;
      runtime.render();
    }

    function applyCachedData(cache: { ts: number; tasks: LPTask[]; history: LPHistoryItem[] }) {
      state.tasks = cache.tasks;
      state.history = cache.history;
    }

    function applyFetchedData(now: number, tasks: LPTask[], history: LPHistoryItem[]) {
      state.tasks = tasks;
      state.history = history;
      dataCache = { ts: now, tasks: state.tasks, history: state.history };
    }

    function handleControllerError(err: unknown): boolean {
      if (err instanceof UnauthorizedError) {
        renderLocked();
        return true;
      }
      deps.toast(err instanceof Error ? err.message : tr('errors.unknown'), 'error');
      return false;
    }

    async function redeemInviteCode(code: string): Promise<{ ok: true; apiToken: string } | { ok: false; status: number }> {
      const res = await fetch(CONFIG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'redeemInvite', code: code })
      });
      let data: { ok?: boolean; apiToken?: string } | null = null;
      try {
        data = await res.json();
      } catch (err) {
        console.warn('redeemInvite response parse failed', err);
      }
      if (!res.ok || !data || !data.ok || typeof data.apiToken !== 'string') {
        return { ok: false, status: res.status };
      }
      return { ok: true, apiToken: data.apiToken };
    }

    async function submitInviteCode(
      code: string,
      submitBtn: HTMLButtonElement,
      error: HTMLElement
    ) {
      await withBusy(submitBtn, { label: tr('locked.submitting') }, async function () {
        const redeemed = await redeemInviteCode(code);
        if (!redeemed.ok) {
          showInviteError(
            error,
            redeemed.status === 401 ? tr('locked.invalidCode') : tr('errors.network') + ' (' + redeemed.status + ')'
          );
          return;
        }
        store.setApiToken(redeemed.apiToken);
        location.reload();
      });
    }

    function applyLockedPanelTexts(
      lockedTitle: HTMLElement,
      lockedDesc: HTMLElement,
      lockedOpen: HTMLButtonElement
    ) {
      lockedTitle.textContent = tr('locked.title');
      lockedDesc.textContent = tr('locked.desc');
      lockedOpen.textContent = tr('locked.openInput');
    }

    function applyInviteModalTexts(
      modalTitle: HTMLElement,
      modalDesc: HTMLElement,
      input: HTMLInputElement,
      cancel: HTMLButtonElement,
      submit: HTMLButtonElement
    ) {
      modalTitle.textContent = tr('locked.openInput');
      modalDesc.textContent = tr('locked.inputLabel', { n: CONFIG.INVITE_CODE_LENGTH });
      input.placeholder = tr('locked.inputPlaceholder');
      cancel.textContent = tr('locked.cancel');
      submit.textContent = tr('locked.submit');
    }

    // Detect kid-side approvals by diffing against a per-user snapshot of
    // "tasks that were Submitted at the last load", persisted in localStorage
    // so it survives app close/reopen — which is the whole reason we need
    // this: the parent typically approves while the kid isn't looking.
    function detectNewlyApproved(nextTasks: LPTask[]) {
      if (state.parentMode || !state.user) return [];
      const status = deps.getStatus?.() || {};
      const prevSubmitted = new Set(store.getSubmittedSnapshot(state.user));
      const ids: string[] = [];
      nextTasks.forEach(function (t) {
        const taskId = String(t.id);
        if (t.status === status.APPROVED && prevSubmitted.has(taskId)) ids.push(taskId);
      });
      return ids;
    }

    function persistSubmittedSnapshot(tasks: LPTask[]) {
      if (!state.user) return;
      // The snapshot is the kid's view of "what's still awaiting approval."
      // Parent-mode loads run against the kid's same state.user, so writing
      // here would wipe the kid's snapshot the moment the parent approves on
      // the same device — and the kid would miss the celebration on next
      // load. Skip in parent mode; the kid's next loadData will rewrite it.
      if (state.parentMode) return;
      const status = deps.getStatus?.() || {};
      const ids = tasks
        .filter(function (t) { return t.status === status.SUBMITTED; })
        .map(function (t) { return String(t.id); });
      store.setSubmittedSnapshot(state.user, ids);
    }

    async function refreshServerConfig() {
      const res = await api('getConfig');
      if (res.status) setStatus(res.status);
      const push = res.push || { enabled: false, publicKey: '' };
      state.pushConfig = {
        enabled: !!push.enabled,
        publicKey: typeof push.publicKey === 'string' ? push.publicKey : ''
      };
      const incoming = Array.isArray(res.users) ? res.users : [];
      state.serverUsers = incoming.filter(function (u: LPUser) {
        return u && typeof u.key === 'string' && u.key;
      });
      deps.reconcileActiveUser();
    }

    function createLockedPanelAndModal() {
      const panel = document.createElement('div');
      panel.id = 'app-locked';
      panel.className = 'locked-panel';

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'locked-mascot');
      svg.setAttribute('width', '80');
      svg.setAttribute('height', '80');
      svg.setAttribute('aria-hidden', 'true');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', '#lesser-panda');
      svg.appendChild(use);

      const title = document.createElement('h2');
      title.className = 'locked-title';

      const desc = document.createElement('p');
      desc.className = 'locked-desc';

      const openButton = document.createElement('button');
      openButton.id = 'locked-token-open';
      openButton.className = 'btn btn-primary';
      openButton.type = 'button';

      const modal = document.createElement('div');
      modal.id = 'invite-modal';
      modal.className = 'modal hidden';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');

      const modalContent = document.createElement('div');
      modalContent.className = 'modal-content';

      const modalTitle = document.createElement('h3');
      modalTitle.className = 'modal-title';

      const modalDesc = document.createElement('p');
      modalDesc.className = 'modal-desc';

      const input = document.createElement('input');
      input.id = 'invite-token-input';
      input.className = 'modal-input';
      input.type = 'text';
      input.autocomplete = 'off';
      input.autocapitalize = 'characters';
      input.spellcheck = false;
      input.maxLength = CONFIG.INVITE_CODE_LENGTH;
      input.style.textTransform = 'uppercase';

      const actions = document.createElement('div');
      actions.className = 'modal-actions';

      const cancel = document.createElement('button');
      cancel.id = 'invite-cancel-btn';
      cancel.className = 'btn btn-secondary';
      cancel.type = 'button';

      const submit = document.createElement('button');
      submit.id = 'invite-submit-btn';
      submit.className = 'btn btn-primary';
      submit.type = 'button';

      const error = document.createElement('div');
      error.id = 'invite-error';
      error.className = 'modal-error hidden';

      actions.appendChild(cancel);
      actions.appendChild(submit);
      modalContent.appendChild(modalTitle);
      modalContent.appendChild(modalDesc);
      modalContent.appendChild(input);
      modalContent.appendChild(actions);
      modalContent.appendChild(error);
      modal.appendChild(modalContent);

      panel.appendChild(svg);
      panel.appendChild(title);
      panel.appendChild(desc);
      panel.appendChild(openButton);
      document.body.appendChild(panel);
      document.body.appendChild(modal);
    }

    function ensureLockedUiElements(): {
      panel: HTMLElement;
      modal: HTMLElement;
      lockedTitle: HTMLElement;
      lockedDesc: HTMLElement;
      lockedOpen: HTMLButtonElement;
      modalTitle: HTMLElement;
      modalDesc: HTMLElement;
      input: HTMLInputElement;
      submit: HTMLButtonElement;
      cancel: HTMLButtonElement;
      error: HTMLElement;
    } | null {
      if (!document.getElementById('app-locked')) {
        createLockedPanelAndModal();
      }
      const panel = document.getElementById('app-locked') as HTMLElement | null;
      if (!panel) return null;
      const lockedTitle = panel.querySelector('.locked-title') as HTMLElement | null;
      const lockedDesc = panel.querySelector('.locked-desc') as HTMLElement | null;
      const lockedOpen = panel.querySelector('#locked-token-open') as HTMLButtonElement | null;
      const modal = document.getElementById('invite-modal') as HTMLElement | null;
      if (!lockedTitle || !lockedDesc || !lockedOpen || !modal) return null;

      const { modalTitle, modalDesc, input, submit, cancel, error } = getInviteModalElements(modal);
      if (!modalTitle || !modalDesc || !input || !submit || !cancel || !error) return null;
      return {
        panel: panel,
        modal: modal,
        lockedTitle: lockedTitle,
        lockedDesc: lockedDesc,
        lockedOpen: lockedOpen,
        modalTitle: modalTitle,
        modalDesc: modalDesc,
        input: input,
        submit: submit,
        cancel: cancel,
        error: error
      };
    }

    function bindInviteModalHandlers(
      lockedOpen: HTMLButtonElement,
      modal: HTMLElement,
      input: HTMLInputElement,
      submit: HTMLButtonElement,
      cancel: HTMLButtonElement,
      error: HTMLElement
    ) {
      const redeemInvite = async function () {
        const code = normalizeInviteCode(input.value || '');
        if (!code) {
          showInviteError(error, tr('locked.invalid'));
          return;
        }
        if (!isValidInviteCode(code)) {
          showInviteError(error, tr('locked.invalidLength', { n: CONFIG.INVITE_CODE_LENGTH }));
          return;
        }
        try {
          await submitInviteCode(code, submit, error);
        } catch (err) {
          console.warn('redeemInvite request failed', err);
          showInviteError(error, tr('errors.network'));
        }
      };

      lockedOpen.onclick = function () {
        openInviteModal(modal, input, error);
      };
      submit.onclick = redeemInvite;
      cancel.onclick = function () { closeInviteModal(modal); };
      modal.onclick = function (e: MouseEvent) {
        if (e.target === modal) closeInviteModal(modal);
      };
      input.onkeydown = function (e: KeyboardEvent) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        redeemInvite();
      };
      input.oninput = function () { clearInviteError(error); };
    }

    function renderLocked() {
      const main = document.querySelector('.app-main');
      const header = document.querySelector('.app-header');
      if (header) header.classList.add('hidden');
      if (main) main.classList.add('hidden');
      const ui = ensureLockedUiElements();
      if (!ui) return;

      applyLockedPanelTexts(ui.lockedTitle, ui.lockedDesc, ui.lockedOpen);
      applyInviteModalTexts(ui.modalTitle, ui.modalDesc, ui.input, ui.cancel, ui.submit);
      bindInviteModalHandlers(ui.lockedOpen, ui.modal, ui.input, ui.submit, ui.cancel, ui.error);
      ui.panel.classList.remove('hidden');
    }

    async function loadData(force: boolean) {
      const forced = !!force;
      if (!state.booted || !state.user) return;
      const now = Date.now();
      if (!forced && dataCache && now - dataCache.ts < CONFIG.CACHE_TTL_SEC * 1000) {
        applyCachedData(dataCache);
        await refreshPushSubscriptionRole();
        runtime.render();
        return;
      }
      setLoadingState(true);
      try {
        const data = await api('getData');
        const nextTasks = data.tasks || [];
        const approvedIds = detectNewlyApproved(nextTasks);
        applyFetchedData(now, nextTasks, data.history || []);
        persistSubmittedSnapshot(nextTasks);
        await refreshPushSubscriptionRole();
        if (approvedIds.length > 0 && deps.onTasksApproved) {
          // Defer until after render so the balance/logo elements are in the DOM.
          setTimeout(function () { deps.onTasksApproved(approvedIds); }, 0);
        }
      } catch (err) {
        if (handleControllerError(err)) return;
      } finally {
        setLoadingState(false);
      }
    }

    async function bootstrap() {
      // Clear app icon badge when user opens the app.
      if ('clearAppBadge' in navigator) {
        navigator.clearAppBadge().catch(function () {});
      }
      if (!store.getApiToken()) {
        renderLocked();
        return;
      }
      const stored = store.getUser();
      if (stored) state.user = stored;
      runtime.render();
      try {
        await refreshServerConfig();
        await setupPushSubscription();
        if (store.getParentMode()) {
          await deps.tryAutoLoginParent();
        }
      } catch (err) {
        if (handleControllerError(err)) return;
      }
      if (state.serverUsers.length === 0) {
        deps.toast(tr('setup.needUsers'), 'error');
        return;
      }
      const storedUser = store.getUser();
      const hasStoredUser = !!storedUser && deps.userKeys().includes(storedUser);
      if (!hasStoredUser) {
        state.booted = true;
        deps.showUserSelection({ closable: false, keepSession: false });
        return;
      }
      state.booted = true;
      runtime.render();
      await loadData(false);
    }

    return {
      api: api,
      bootstrap: bootstrap,
      loadData: loadData,
      renderLocked: renderLocked,
      refreshServerConfig: refreshServerConfig,
      clearDataCache: clearDataCache,
      refreshPushSubscriptionRole: refreshPushSubscriptionRole,
      enablePush: enablePushNotifications,
      disablePush: disablePushNotifications,
      isPushEnabled: isPushEnabled,
      isPushSupported: isPushSupportedNow,
      pushPermission: getNotificationPermission
    };
  }

  window.LESSERPAY_CONTROLLER_DATA = { create: create };
})();
