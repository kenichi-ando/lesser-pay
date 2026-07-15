(function () {
  'use strict';

  function create(deps: LPControllerDeps): LPControllerApi {
    const store = deps.store;
    const state = deps.state;
    const els = deps.els;
    const tr = deps.tr;
    const escapeHtml = deps.escapeHtml;
    const runtime = deps.runtime;
    const withBusy = deps.withBusy;
    let controllerData: LPControllerDataApi | null = null;

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
      store.setParentMode(true);
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

    function buildUserPopoverChildItems(): string {
      if (!state.parentMode) return '';
      return state.serverUsers.map(function (_ref) {
        const key = _ref.key;
        const label = _ref.label;
        const isCurrent = key === state.user;
        return '\n<li class="user-popover-item ' + (isCurrent ? 'is-current' : '') + '">\n' +
          '  <button class="user-popover-pick" type="button" data-user="' + escapeHtml(key) + '">\n' +
          '    <span class="user-popover-mark">' + (isCurrent ? '✓' : '') + '</span>\n' +
          '    <span class="user-popover-name">' + escapeHtml(label) + '</span>\n' +
          '  </button>\n' +
          '</li>\n';
      }).join('');
    }

    function buildUserPopoverHtml(): string {
      const childItems = buildUserPopoverChildItems();
      const header = state.parentMode
        ? '<li class="user-popover-group-title">' + escapeHtml(tr('users.childSwitchTitle')) + '</li>'
        : '';
      const divider = state.parentMode ? '<li class="user-popover-divider" aria-hidden="true"></li>' : '';
      return header + childItems + divider +
        '<li class="user-popover-item">' +
        '  <button class="user-popover-pick user-popover-login-switch" type="button" data-action="switch-login-user">' +
        '    <span class="user-popover-name">👤 ' + escapeHtml(tr('users.loginSwitch')) + '</span>' +
        '  </button>' +
        '</li>' +
        '<li class="user-popover-item">' +
        '  <button class="user-popover-pick user-popover-settings" type="button" data-action="open-settings">' +
        '    <span class="user-popover-name">⚙️ ' + escapeHtml(tr('settings.open')) + '</span>' +
        '  </button>' +
        '</li>';
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
      els.userPopoverList.innerHTML = buildUserPopoverHtml();
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
      closeUserPopover();
      try {
        await data.refreshServerConfig();
      } catch (err) {
        actions.toast(err instanceof Error && err.message ? err.message : tr('errors.network'), 'error');
      }
      showUserSelection(makeLoginUserSelectionOptions());
    }

    function buildUserSelectionHtml(currentSelection: string | null): string {
      const users = state.serverUsers.map(function (_ref2) {
        const key = _ref2.key;
        const label = _ref2.label;
        const currentClass = key === currentSelection ? ' is-current' : '';
        return '<button class="user-select-btn' + currentClass + '" type="button" data-user-select="' + escapeHtml(key) + '">' +
          '<span class="user-select-icon" aria-hidden="true">🐾</span>' +
          '<span>' + escapeHtml(label) + '</span></button>';
      }).join('');
      const parentCurrentClass = currentSelection === '__parent__' ? ' is-current' : '';
      const parentBtn = '<button class="user-select-btn is-parent' + parentCurrentClass + '" type="button" data-user-select="__parent__">' +
        '<span class="user-select-key" aria-hidden="true">🔑</span>' +
        '<span>' + escapeHtml(tr('userSelect.parent')) + '</span></button>';
      return users + parentBtn;
    }

    function bindUserSelectionHandlers() {
      els.userSelectList.querySelectorAll('[data-user-select]').forEach(function (btn) {
        btn.addEventListener('click', onUserSelectClick);
      });
    }

    function getCurrentSelection(): string | null {
      return state.parentMode ? '__parent__' : state.user;
    }

    function updateUserSelectionCloseButtonVisibility(): void {
      els.userSelectCloseBtn.classList.toggle('hidden', !state.userSelectionClosable);
    }

    function makeLoginUserSelectionOptions(): {
      closable: boolean;
      keepSession: boolean;
      returnState: LPAppState['selectionReturnState'];
    } {
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
      const currentSelection = getCurrentSelection();
      els.userSelectList.innerHTML = buildUserSelectionHtml(currentSelection);
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
      const autoLoggedIn = await tryAutoLoginParent();
      if (autoLoggedIn) {
        hideUserSelection();
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
      await switchUser(selection, {
        silent: !shouldToast,
        toastKey: 'users.switchedLoginToast',
        forceExitParentMode: true
      });
      hideUserSelection();
    }

    async function switchUser(key: string, options: {
      keepParentMode?: boolean;
      toastKey?: string;
      silent?: boolean;
      forceExitParentMode?: boolean;
    }) {
      const opts = options || {};
      const forceExitParentMode = !!opts.forceExitParentMode;
      const sameUser = key === state.user;
      if (!canSwitchUser(key, sameUser, forceExitParentMode)) {
        closeUserPopover();
        return;
      }
      closeUserPopover();
      const keepParentMode = shouldKeepParentMode(opts);
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
      await data.loadData(true);
    }

    function canSwitchUser(key: string, sameUser: boolean, forceExitParentMode: boolean) {
      if (!key) return false;
      if (!sameUser) return true;
      return forceExitParentMode && state.parentMode;
    }

    function shouldKeepParentMode(options: {
      keepParentMode?: boolean;
    }) {
      return !!options.keepParentMode && state.parentMode && !!state.parentPin;
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
      const pin = els.parentPin.value;
      if (!pin) {
        showParentError(tr('parent.needPin'));
        return;
      }
      await runSubmitWithBusy(
        els.parentSubmit,
        tr('parent.checking'),
        async function () {
          await data.api('verifyPin', { pin: pin });
          await onParentLoginSuccess(pin);
        },
        onParentLoginError
      );
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
      withBusy: withBusy
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
