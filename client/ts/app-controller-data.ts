/// <reference path="./global.d.ts" />
/// <reference path="../../shared/contracts.d.ts" />
/**
 * Data/controller boundary for client <-> Worker communication.
 *
 * Architectural contract:
 * - All API calls go through this module (`fetch('/api')` with bearer token).
 * - Handles lock-screen bootstrap (`redeemInvite` -> API token) and token expiry fallback.
 * - Maintains only short-lived UI cache; source of truth remains server + spreadsheet.
 */
import { createInviteLock } from './app-invite';
import { createPushClient, getNotificationPermission } from './app-push-client';

(function () {
  'use strict';

  function create(deps: LPControllerDataDeps): LPControllerDataApi {
    const CONFIG = deps.CONFIG;
    const store = deps.store;
    const state = deps.state;
    const tr = deps.tr;
    const runtime = deps.runtime;
    const setStatus = deps.setStatus;
    let dataCache: { ts: number; tasks: LPTask[]; history: LPHistoryItem[] } | null = null;

    class UnauthorizedError extends Error {
      constructor() {
        super('unauthorized');
        this.name = 'UnauthorizedError';
      }
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

    const push = createPushClient({
      state: state,
      tr: tr,
      toast: deps.toast,
      api: api,
    });

    const invite = createInviteLock({
      CONFIG: CONFIG,
      store: store,
      tr: tr,
      withBusy: deps.withBusy,
    });

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
        invite.renderLocked();
        return true;
      }
      deps.toast(err instanceof Error ? err.message : tr('errors.unknown'), 'error');
      return false;
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
      const pushConfig = res.push || { enabled: false, publicKey: '' };
      state.pushConfig = {
        enabled: !!pushConfig.enabled,
        publicKey: typeof pushConfig.publicKey === 'string' ? pushConfig.publicKey : ''
      };
      const incoming = Array.isArray(res.users) ? res.users : [];
      state.serverUsers = incoming.filter(function (u: LPUser) {
        return u && typeof u.key === 'string' && u.key;
      });
      deps.reconcileActiveUser();
    }

    function applyLoadDataCacheResult(force: boolean, now: number): boolean {
      if (force || !dataCache) return false;
      if (now - dataCache.ts >= CONFIG.CACHE_TTL_SEC * 1000) return false;
      applyCachedData(dataCache);
      runtime.render();
      return true;
    }

    function applyLoadDataNetworkResult(now: number, data: SharedApiSuccess<'getData'>): void {
      const nextTasks = data.tasks || [];
      const approvedIds = detectNewlyApproved(nextTasks);
      applyFetchedData(now, nextTasks, data.history || []);
      persistSubmittedSnapshot(nextTasks);
      if (approvedIds.length > 0 && deps.onTasksApproved) {
        // Defer until after render so the balance/logo elements are in the DOM.
        setTimeout(function () { deps.onTasksApproved(approvedIds); }, 0);
      }
    }

    async function loadData(force: boolean) {
      const forced = !!force;
      if (!state.booted || !state.user) return;
      const now = Date.now();
      if (applyLoadDataCacheResult(forced, now)) {
        return;
      }
      const showLoadingState = state.tasks.length === 0 && state.history.length === 0;
      if (showLoadingState) setLoadingState(true);
      try {
        const data = await api('getData');
        applyLoadDataNetworkResult(now, data);
      } catch (err) {
        if (handleControllerError(err)) return;
      } finally {
        if (showLoadingState) setLoadingState(false);
        else runtime.render();
      }
    }

    async function bootstrap() {
      // Clear app icon badge when user opens the app.
      if ('clearAppBadge' in navigator) {
        navigator.clearAppBadge().catch(function () {});
      }
      if (!store.getApiToken()) {
        invite.renderLocked();
        return;
      }
      const stored = store.getUser();
      if (stored) state.user = stored;
      runtime.render();
      try {
        await refreshServerConfig();
        await push.setupPushSubscription();
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
      renderLocked: invite.renderLocked,
      refreshServerConfig: refreshServerConfig,
      clearDataCache: clearDataCache,
      refreshPushSubscriptionRole: push.refreshPushSubscriptionRole,
      enablePush: push.enablePush,
      disablePush: push.disablePush,
      isPushEnabled: push.isPushEnabled,
      isPushSupported: push.isPushSupported,
      pushPermission: getNotificationPermission
    };
  }

  window.LESSERPAY_CONTROLLER_DATA = { create: create };
})();
