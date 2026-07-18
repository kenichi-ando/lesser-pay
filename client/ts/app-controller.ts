/// <reference path="./global.d.ts" />
(function () {
  'use strict';

  function buildUserPopoverChildItemsHtml(
    serverUsers: LPUser[],
    parentMode: boolean,
    currentUser: string | null,
    escapeHtml: (value: unknown) => string
  ): string {
    if (!parentMode) return '';
    return serverUsers.map(function (user) {
      const key = user.key;
      const label = user.label;
      const isCurrent = key === currentUser;
      return '\n<li class="user-popover-item ' + (isCurrent ? 'is-current' : '') + '">\n' +
        '  <button class="user-popover-pick" type="button" data-user="' + escapeHtml(key) + '">\n' +
        '    <span class="user-popover-mark">' + (isCurrent ? '✓' : '') + '</span>\n' +
        '    <span class="user-popover-name">' + escapeHtml(label) + '</span>\n' +
        '  </button>\n' +
        '</li>\n';
    }).join('');
  }

  function buildUserPopoverHtml(options: {
    serverUsers: LPUser[];
    parentMode: boolean;
    currentUser: string | null;
    tr: LPTranslator;
    escapeHtml: (value: unknown) => string;
  }): string {
    const childItems = buildUserPopoverChildItemsHtml(
      options.serverUsers,
      options.parentMode,
      options.currentUser,
      options.escapeHtml
    );
    const header = options.parentMode
      ? '<li class="user-popover-group-title">' + options.escapeHtml(options.tr('users.childSwitchTitle')) + '</li>'
      : '';
    const divider = options.parentMode ? '<li class="user-popover-divider" aria-hidden="true"></li>' : '';
    return header + childItems + divider +
      '<li class="user-popover-item">' +
      '  <button class="user-popover-pick user-popover-login-switch" type="button" data-action="switch-login-user">' +
      '    <span class="user-popover-name">👤 ' + options.escapeHtml(options.tr('users.loginSwitch')) + '</span>' +
      '  </button>' +
      '</li>' +
      '<li class="user-popover-item">' +
      '  <button class="user-popover-pick user-popover-settings" type="button" data-action="open-settings">' +
      '    <span class="user-popover-name">⚙️ ' + options.escapeHtml(options.tr('settings.open')) + '</span>' +
      '  </button>' +
      '</li>';
  }

  function buildUserSelectionHtml(options: {
    serverUsers: LPUser[];
    currentSelection: string | null;
    tr: LPTranslator;
    escapeHtml: (value: unknown) => string;
  }): string {
    const users = options.serverUsers.map(function (user) {
      const key = user.key;
      const label = user.label;
      const currentClass = key === options.currentSelection ? ' is-current' : '';
      return '<button class="user-select-btn' + currentClass + '" type="button" data-user-select="' + options.escapeHtml(key) + '">' +
        '<span class="user-select-icon" aria-hidden="true">🐾</span>' +
        '<span>' + options.escapeHtml(label) + '</span></button>';
    }).join('');
    const parentCurrentClass = options.currentSelection === '__parent__' ? ' is-current' : '';
    const parentBtn = '<button class="user-select-btn is-parent' + parentCurrentClass + '" type="button" data-user-select="__parent__">' +
      '<span class="user-select-key" aria-hidden="true">🔑</span>' +
      '<span>' + options.escapeHtml(options.tr('userSelect.parent')) + '</span></button>';
    return users + parentBtn;
  }

  type LoginUserSelectionOptions = {
    closable: boolean;
    keepSession: boolean;
    returnState: LPAppState['selectionReturnState'];
  };

  function makeLoginUserSelectionOptions(state: Pick<LPAppState, 'user' | 'parentMode' | 'parentPin'>): LoginUserSelectionOptions {
    const canClose = !!state.user;
    return {
      closable: canClose,
      keepSession: canClose,
      returnState: canClose ? {
        user: state.user,
        parentMode: state.parentMode,
        parentPin: state.parentPin
      } : null
    };
  }

  function shouldKeepParentMode(options: { keepParentMode?: boolean }, state: Pick<LPAppState, 'parentMode' | 'parentPin'>): boolean {
    return !!options.keepParentMode && state.parentMode && !!state.parentPin;
  }

  function getCurrentSelection(state: Pick<LPAppState, 'parentMode' | 'user'>): string | null {
    return state.parentMode ? '__parent__' : state.user;
  }

  function canSwitchUser(key: string, sameUser: boolean, forceExitParentMode: boolean, state: Pick<LPAppState, 'parentMode'>): boolean {
    if (!key) return false;
    if (!sameUser) return true;
    return forceExitParentMode && state.parentMode;
  }

  function create(deps: LPControllerDeps): LPControllerApi {
    const store = deps.store;
    const state = deps.state;
    const els = deps.els;
    const tr = deps.tr;
    const escapeHtml = deps.escapeHtml;
    const runtime = deps.runtime;
    const withBusy = deps.withBusy;
    let controllerData: LPControllerDataApi | null = null;
    let switchingUser = false;
    let openingLoginSelection = false;
    let submittingParentLogin = false;

    function userKeys() {
      return state.serverUsers.map(function (u) { return u.key; });
    }

    function labelOf(key: string) {
      const found = state.serverUsers.find(function (u) { return u.key === key; });
      return found ? found.label : key;
    }

    function clearParentSession() {
      state.parentMode = false;
      state.parentPin = null;
      store.clearParentMode();
    }

    function setParentSession(pin: string, persistPin: boolean) {
      state.parentPin = pin;
      state.parentMode = true;
      if (persistPin) store.setParentPin(pin);
      store.enableParentMode();
    }

    function resetUserDataView() {
      controllerData?.clearDataCache();
      state.tasks = [];
      state.history = [];
    }

    function reconcileActiveUser() {
      const keys = userKeys();
      if (keys.length === 0) {
        state.user = null;
        store.clearUser();
        return;
      }
      if (!state.user || !keys.includes(state.user)) {
        const nextUser = keys[0];
        state.user = nextUser;
        store.setUser(nextUser);
        clearParentSession();
        resetUserDataView();
      }
    }

    function bindUserPopoverHandlers() {
      els.userPopoverList.querySelectorAll('[data-user]').forEach(function (btn) {
        btn.addEventListener('click', onPopoverUserPick);
      });
      const loginSwitchBtn = els.userPopoverList.querySelector('[data-action="switch-login-user"]');
      if (loginSwitchBtn) {
        loginSwitchBtn.addEventListener('click', onLoginSwitchClick);
      }
      const settingsBtn = els.userPopoverList.querySelector('[data-action="open-settings"]');
      if (settingsBtn) settingsBtn.addEventListener('click', onOpenSettingsClick);
    }

    function renderUserPopover() {
      if (state.serverUsers.length === 0) {
        els.userPopoverList.innerHTML = '<li class="user-popover-empty">' + escapeHtml(tr('setup.needUsers')) + '</li>';
        return;
      }
      els.userPopoverList.innerHTML = buildUserPopoverHtml({
        serverUsers: state.serverUsers,
        parentMode: state.parentMode,
        currentUser: state.user,
        tr: tr,
        escapeHtml: escapeHtml
      });
      bindUserPopoverHandlers();
    }

    function onPopoverUserPick(e: Event) {
      const target = e.currentTarget as HTMLElement | null;
      const picked = target?.dataset.user || '';
      void switchUser(picked, { keepParentMode: true, toastKey: 'users.switchedDisplayToast' });
    }

    function onLoginSwitchClick() {
      void openLoginUserSelection();
    }

    function onOpenSettingsClick() {
      closeUserPopover();
      if (deps.openSettings) deps.openSettings();
    }

    function closeUserPopover() {
      els.userPopover.classList.add('hidden');
    }

    function toggleUserPopover() {
      if (state.needsUserSelection || !state.user) return;
      if (els.userPopover.classList.contains('hidden')) {
        renderUserPopover();
        els.userPopover.classList.remove('hidden');
      }
      else closeUserPopover();
    }

    async function openLoginUserSelection() {
      if (openingLoginSelection) return;
      openingLoginSelection = true;
      closeUserPopover();
      try {
        await data.refreshServerConfig();
      } catch (err) {
        actions.toast(err instanceof Error && err.message ? err.message : tr('errors.network'), 'error');
      } finally {
        openingLoginSelection = false;
      }
      showUserSelection(makeLoginUserSelectionOptions(state));
    }

    function bindUserSelectionHandlers() {
      els.userSelectList.querySelectorAll('[data-user-select]').forEach(function (btn) {
        btn.addEventListener('click', onUserSelectClick);
      });
    }

    function updateUserSelectionCloseButtonVisibility(): void {
      els.userSelectCloseBtn.classList.toggle('hidden', !state.userSelectionClosable);
    }

    function showUserSelection(options: {
      closable?: boolean;
      keepSession?: boolean;
      returnState?: LPAppState['selectionReturnState'];
    }) {
      const opts = options || {};
      state.needsUserSelection = true;
      state.userSelectionClosable = !!opts.closable;
      state.selectionReturnState = opts.returnState || null;
      closeUserPopover();
      if (!opts.keepSession) {
        clearParentSession();
      }
      const currentSelection = getCurrentSelection(state);
      els.userSelectList.innerHTML = buildUserSelectionHtml({
        serverUsers: state.serverUsers,
        currentSelection: currentSelection,
        tr: tr,
        escapeHtml: escapeHtml
      });
      bindUserSelectionHandlers();
      updateUserSelectionCloseButtonVisibility();
      els.userSelectScreen.classList.remove('hidden');
      runtime.render();
    }

    function resetUserSelectionState() {
      state.needsUserSelection = false;
      state.userSelectionClosable = false;
      state.selectionReturnState = null;
    }

    function onUserSelectClick(e: Event) {
      const target = e.currentTarget as HTMLElement | null;
      void onUserSelect(target?.dataset.userSelect || '');
    }

    function hideUserSelection() {
      resetUserSelectionState();
      els.userSelectScreen.classList.add('hidden');
      runtime.render();
    }

    function restoreSelectionReturnState(): void {
      if (!state.selectionReturnState) return;
      state.user = state.selectionReturnState.user;
      state.parentMode = state.selectionReturnState.parentMode;
      state.parentPin = state.selectionReturnState.parentPin;
      if (state.user) store.setUser(state.user);
    }

    function closeUserSelectionWithoutChanges() {
      if (!state.userSelectionClosable) return;
      restoreSelectionReturnState();
      hideUserSelection();
    }

    async function onUserSelect(selection: string) {
      const shouldToast = state.userSelectionClosable;
      if (selection === '__parent__') {
        await selectParentUser(shouldToast);
        return;
      }
      await selectChildUser(selection, shouldToast);
    }

    async function selectParentUser(shouldToast: boolean) {
      state.pendingParentSwitchToast = shouldToast;
      ensureSelectedUserForParentMode();
      // Close the user selection immediately so parent switch feels responsive.
      hideUserSelection();
      const autoLoggedIn = await tryAutoLoginParent();
      if (autoLoggedIn) {
        if (shouldToast) actions.toast(tr('users.switchedParentToast'), 'success');
        state.pendingParentSwitchToast = false;
        return;
      }
      openParentModal();
    }

    function ensureSelectedUserForParentMode() {
      if (state.user || state.serverUsers.length === 0) return;
      const nextUser = state.serverUsers[0].key;
      state.user = nextUser;
      store.setUser(nextUser);
    }

    async function selectChildUser(selection: string, shouldToast: boolean) {
      // Close immediately so the tap feels accepted.
      hideUserSelection();
      await switchUser(selection, {
        silent: !shouldToast,
        toastKey: 'users.switchedLoginToast',
        forceExitParentMode: true
      });
    }

    async function switchUser(key: string, options: {
      keepParentMode?: boolean;
      toastKey?: string;
      silent?: boolean;
      forceExitParentMode?: boolean;
    }) {
      if (switchingUser) return;
      switchingUser = true;
      const opts = options || {};
      const forceExitParentMode = !!opts.forceExitParentMode;
      const sameUser = key === state.user;
      if (!canSwitchUser(key, sameUser, forceExitParentMode, state)) {
        closeUserPopover();
        switchingUser = false;
        return;
      }
      closeUserPopover();
      const keepParentMode = shouldKeepParentMode(opts, state);
      if (!sameUser) {
        state.user = key;
        store.setUser(key);
      }
      if (!keepParentMode) {
        clearParentSession();
      }
      resetUserDataView();
      runtime.render();
      if (!opts.silent) {
        actions.toast(tr(opts.toastKey || 'users.switchedToast', { name: labelOf(key) }), 'success');
      }
      try {
        await data.refreshPushSubscriptionRole();
        await data.loadData(true);
      } finally {
        switchingUser = false;
      }
    }

    function clearParentError() {
      els.parentError.classList.add('hidden');
    }

    function focusParentPinSoon() {
      setTimeout(function () { els.parentPin.focus(); }, 50);
    }

    function openParentModal() {
      els.parentPin.value = '';
      clearParentError();
      els.parentModal.classList.remove('hidden');
      focusParentPinSoon();
    }

    async function runSubmitWithBusy(
      button: HTMLElement,
      processingLabel: string,
      submitTask: () => Promise<void>,
      onError: (err: unknown) => void
    ) {
      try {
        await withBusy(button, { label: processingLabel }, submitTask);
      } catch (err) {
        if (typeof onError === 'function') onError(err);
      }
    }

    async function tryAutoLoginParent() {
      if (state.parentMode) return true;
      const savedPin = store.getParentPin();
      if (!savedPin) return false;
      try {
        await data.api('verifyPin', { pin: savedPin });
        setParentSession(savedPin, false);
        await data.refreshPushSubscriptionRole();
        runtime.render();
        return true;
      } catch (err) {
        console.warn('auto parent login failed', err);
        store.clearParentPin();
        clearParentSession();
        return false;
      }
    }

    async function submitParentLogin() {
      if (submittingParentLogin) return;
      const pin = els.parentPin.value;
      if (!pin) {
        showParentError(tr('parent.needPin'));
        return;
      }
      submittingParentLogin = true;
      await runSubmitWithBusy(
        els.parentSubmit,
        tr('parent.checking'),
        async function () {
          await data.api('verifyPin', { pin: pin });
          await onParentLoginSuccess(pin);
        },
        onParentLoginError
      );
      submittingParentLogin = false;
      resetParentSwitchToast();
    }

    function closeParentModal() {
      hideParentModal(true);
    }

    function showParentError(message: string) {
      els.parentError.textContent = message;
      els.parentError.classList.remove('hidden');
    }

    async function onParentLoginSuccess(pin: string) {
      setParentSession(pin, true);
      await data.refreshPushSubscriptionRole();
      hideParentModal(false);
      hideUserSelection();
      runtime.render();
      if (state.pendingParentSwitchToast) {
        actions.toast(tr('users.switchedParentToast'), 'success');
      }
    }

    function onParentLoginError(err: unknown) {
      state.parentPin = null;
      showParentError(err instanceof Error ? err.message : tr('errors.unknown'));
    }

    function hideParentModal(resetToast: boolean) {
      if (resetToast) resetParentSwitchToast();
      els.parentModal.classList.add('hidden');
    }

    function resetParentSwitchToast() {
      state.pendingParentSwitchToast = false;
    }

    const data = window.LESSERPAY_CONTROLLER_DATA.create({
      CONFIG: deps.CONFIG,
      store: store,
      state: state,
      tr: tr,
      runtime: runtime,
      getStatus: deps.getStatus,
      setStatus: deps.setStatus,
      reconcileActiveUser: reconcileActiveUser,
      userKeys: userKeys,
      showUserSelection: showUserSelection,
      openParentModal: openParentModal,
      tryAutoLoginParent: tryAutoLoginParent,
      toast: function (msg: string, kind?: string) { actions.toast(msg, kind); },
      onTasksApproved: function () { actions.celebrateRemoteApprovals(); },
      withBusy: withBusy
    });
    controllerData = data;

    const actions = window.LESSERPAY_CONTROLLER_ACTIONS.create({
      state: state,
      els: els,
      tr: tr,
      api: data.api,
      loadData: data.loadData,
      clearDataCache: data.clearDataCache,
      withBusy: withBusy,
      isParentMode: function () { return state.parentMode; }
    });

    return {
      labelOf: labelOf,
      toggleUserPopover: toggleUserPopover,
      closeUserPopover: closeUserPopover,
      closeUserSelectionWithoutChanges: closeUserSelectionWithoutChanges,
      submitParentLogin: submitParentLogin,
      closeParentModal: closeParentModal,
      openCashoutModal: actions.openCashoutModal,
      submitCashout: actions.submitCashout,
      openBonusModal: actions.openBonusModal,
      submitBonus: actions.submitBonus,
      openTaskUpsertModal: actions.openTaskUpsertModal,
      deleteTaskFromUpsert: actions.deleteTaskFromUpsert,
      submitTaskUpsert: actions.submitTaskUpsert,
      loadData: data.loadData,
      bootstrap: data.bootstrap,
      onTaskAction: actions.onTaskAction,
      enablePush: data.enablePush,
      disablePush: data.disablePush,
      isPushEnabled: data.isPushEnabled,
      isPushSupported: data.isPushSupported,
      pushPermission: data.pushPermission
    };
  }

  window.LESSERPAY_CONTROLLER = { create: create };
})();
