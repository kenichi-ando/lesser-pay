/// <reference path="./global.d.ts" />
(function () {
  'use strict';

  const CONFIG = window.LESSERPAY_CONFIG;
  const SK = CONFIG.STORAGE_KEYS;
  const STRINGS = window.LESSERPAY_STRINGS || {};
  const i18n = window.LESSERPAY_I18N.create(STRINGS);
  const tr = i18n.tr;
  const applyI18n = i18n.applyI18n;
  const store = window.LESSERPAY_STORE.create(SK);
  const utils = window.LESSERPAY_UTILS.create({ tr: tr });
  const escapeHtml = utils.escapeHtml;
  const formatDate = utils.formatDate;
  const isExpired = utils.isExpired;
  const formatMinutes = utils.formatMinutes;
  const withBusy = utils.withBusy;

  let STATUS: LPStatusMap = {};
  const state: LPAppState = {
    user: null,
    serverUsers: [],
    parentMode: false,
    parentPin: null,
    needsUserSelection: false,
    userSelectionClosable: false,
    selectionReturnState: null,
    pendingParentSwitchToast: false,
    pushConfig: { enabled: false, publicKey: '' },
    tasks: [],
    history: [],
    loading: true,
    booted: false,
    activeTab: 'tasks'
  };

  function mustElement<T extends HTMLElement>(id: string): T {
    const node = document.getElementById(id);
    if (!(node instanceof HTMLElement)) throw new Error('Missing element: ' + id);
    return node as T;
  }

  const els: LPElements = {
    userLabel: mustElement('user-label'),
    userPopover: mustElement('user-popover'),
    userPopoverList: mustElement('user-popover-list'),
    userSelectScreen: mustElement('user-select-screen'),
    userSelectList: mustElement('user-select-list'),
    userSelectCloseBtn: mustElement('user-select-close-btn'),
    cashoutBtn: mustElement('cashout-btn'),
    bonusBtn: mustElement('bonus-btn'),
    tabTasks: mustElement('tab-tasks'),
    tabHistory: mustElement('tab-history'),
    tabTasksBadge: mustElement('tab-tasks-badge'),
    panelTasks: mustElement('panel-tasks'),
    panelHistory: mustElement('panel-history'),
    balance: mustElement('balance-amount'),
    tasksList: mustElement('tasks-list'),
    historyList: mustElement('history-list'),
    parentModal: mustElement('parent-modal'),
    parentPin: mustElement<HTMLInputElement>('parent-pin'),
    parentSubmit: mustElement('parent-submit-btn'),
    parentCancel: mustElement('parent-cancel-btn'),
    parentError: mustElement('parent-error'),
    cashoutModal: mustElement('cashout-modal'),
    cashoutAmount: mustElement<HTMLInputElement>('cashout-amount'),
    cashoutSubmit: mustElement('cashout-submit-btn'),
    cashoutCancel: mustElement('cashout-cancel-btn'),
    cashoutError: mustElement('cashout-error'),
    cashoutBalance: mustElement('cashout-balance'),
    bonusModal: mustElement('bonus-modal'),
    bonusLabel: mustElement<HTMLInputElement>('bonus-label'),
    bonusAmount: mustElement<HTMLInputElement>('bonus-amount'),
    bonusSubmit: mustElement('bonus-submit-btn'),
    bonusCancel: mustElement('bonus-cancel-btn'),
    bonusError: mustElement('bonus-error'),
    settingsModal: mustElement('settings-modal'),
    settingsClose: document.getElementById('settings-close-btn'),
    settingsPushRow: document.getElementById('settings-push-row') as HTMLButtonElement | null,
    settingsPushToggle: document.getElementById('settings-push-toggle'),
    settingsSoundRow: document.getElementById('settings-sound-row'),
    settingsSoundToggle: document.getElementById('settings-sound-toggle'),
    pullIndicator: mustElement('pull-indicator'),
    toast: mustElement('toast')
  };

  const runtime: LPRuntime = {
    render: function () {},
    renderTabs: function () {}
  };

  const controller = window.LESSERPAY_CONTROLLER.create({
    CONFIG: CONFIG,
    store: store,
    state: state,
    els: els,
    tr: tr,
    escapeHtml: escapeHtml,
    runtime: runtime,
    withBusy: withBusy,
    getStatus: function () { return STATUS; },
    setStatus: function (status) { STATUS = status; },
    openSettings: function () { openSettingsModal(); }
  });

  const renderer = window.LESSERPAY_RENDER.create({
    state: state,
    els: els,
    tr: tr,
    getStatus: function () { return STATUS; },
    escapeHtml: escapeHtml,
    formatMinutes: formatMinutes,
    formatDate: formatDate,
    isExpired: isExpired,
    onTaskAction: controller.onTaskAction,
    labelOf: controller.labelOf
  });
  runtime.render = renderer.render;
  runtime.renderTabs = renderer.renderTabs;

  function switchTab(tab: string) {
    if (tab !== 'tasks' && tab !== 'history') return;
    if (state.activeTab === tab) return;
    state.activeTab = tab;
    runtime.renderTabs();
  }

  function hideModal(modal: HTMLElement): void {
    modal.classList.add('hidden');
  }

  function isAnyBlockingLayerOpen(): boolean {
    return (
      !els.parentModal.classList.contains('hidden') ||
      !els.cashoutModal.classList.contains('hidden') ||
      !els.bonusModal.classList.contains('hidden') ||
      !els.settingsModal.classList.contains('hidden') ||
      !els.userSelectScreen.classList.contains('hidden')
    );
  }

  function registerTabHandlers(): void {
    els.tabTasks.addEventListener('click', function () { switchTab('tasks'); });
    els.tabHistory.addEventListener('click', function () { switchTab('history'); });
  }

  function registerModalBackdropCloseHandlers(): void {
    [els.parentModal, els.cashoutModal, els.bonusModal, els.settingsModal].forEach(function (m) {
      m.addEventListener('click', function (e) {
        if (e.target !== m) return;
        if (m === els.parentModal) controller.closeParentModal();
        else hideModal(m);
      });
    });
  }

  function registerUserPopoverHandlers(): void {
    els.userLabel.addEventListener('click', function (e) {
      e.stopPropagation();
      controller.toggleUserPopover();
    });
    document.addEventListener('click', function (e) {
      if (els.userPopover.classList.contains('hidden')) return;
      if (!els.userPopover.contains(e.target as Node) && e.target !== els.userLabel) {
        controller.closeUserPopover();
      }
    });
  }

  function registerParentModalHandlers(): void {
    els.userSelectCloseBtn.addEventListener('click', controller.closeUserSelectionWithoutChanges);
    els.parentSubmit.addEventListener('click', controller.submitParentLogin);
    els.parentPin.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') controller.submitParentLogin();
    });
    els.parentCancel.addEventListener('click', controller.closeParentModal);
  }

  function registerCashoutHandlers(): void {
    els.cashoutBtn.addEventListener('click', controller.openCashoutModal);
    els.cashoutSubmit.addEventListener('click', controller.submitCashout);
    els.cashoutCancel.addEventListener('click', function () { hideModal(els.cashoutModal); });
  }

  function registerBonusHandlers(): void {
    els.bonusBtn.addEventListener('click', controller.openBonusModal);
    els.bonusSubmit.addEventListener('click', controller.submitBonus);
    els.bonusCancel.addEventListener('click', function () { hideModal(els.bonusModal); });
  }

  function registerSettingsHandlers(): void {
    if (els.settingsClose) els.settingsClose.addEventListener('click', function () {
      hideModal(els.settingsModal);
    });
    if (els.settingsPushRow) els.settingsPushRow.addEventListener('click', onTogglePush);
    if (els.settingsSoundRow) els.settingsSoundRow.addEventListener('click', onToggleSound);
  }

  function runAppStartupSequence(): void {
    applyI18n();
    controller.bootstrap();
    setupBadgeClear();
    setupSoundUnlock();
    setupPullToRefresh();
    setupServiceWorkerMessages();
  }

  function getSoundController(): LPSoundController | undefined {
    return window.LESSERPAY_SOUND as LPSoundController | undefined;
  }

  function init() {
    registerParentModalHandlers();
    registerCashoutHandlers();
    registerBonusHandlers();
    registerTabHandlers();
    registerUserPopoverHandlers();
    registerModalBackdropCloseHandlers();
    registerSettingsHandlers();
    runAppStartupSequence();
  }

  // ---- Settings ----
  function openSettingsModal() {
    syncSettingsToggles();
    els.settingsModal.classList.remove('hidden');
  }

  function syncSettingsToggles() {
    const pushOn = !!controller.isPushEnabled();
    setToggle(els.settingsPushToggle, pushOn);
    if (els.settingsPushRow) {
      const supported = !!controller.isPushSupported();
      (els.settingsPushRow as HTMLButtonElement).disabled = !supported;
      els.settingsPushRow.style.opacity = supported ? '' : '0.55';
      els.settingsPushRow.style.pointerEvents = supported ? '' : 'none';
    }
    const sound = getSoundController();
    const soundOn = sound ? !sound.isMuted() : true;
    setToggle(els.settingsSoundToggle, soundOn);
  }

  function setToggle(node: HTMLElement | null, isOn: boolean) {
    if (!node) return;
    node.classList.toggle('is-on', !!isOn);
    node.setAttribute('aria-checked', isOn ? 'true' : 'false');
  }

  async function onTogglePush() {
    if (!controller.isPushSupported()) return;
    if (!els.settingsPushRow) return;
    await withBusy(els.settingsPushRow, {}, async function () {
      if (controller.isPushEnabled()) await controller.disablePush();
      else await controller.enablePush();
      syncSettingsToggles();
    });
  }

  function onToggleSound() {
    const sound = getSoundController();
    if (!sound) return;
    const muted = sound.toggleMuted();
    if (!muted) sound.play('toggle');
    syncSettingsToggles();
  }

  // ---- Refresh ----
  let refreshing = false;
  async function triggerRefresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      await controller.loadData(true);
    } finally {
      refreshing = false;
    }
  }

  // ---- Pull-to-refresh ----
  function setupPullToRefresh() {
    if (!els.pullIndicator) return;
    let startY: number | null = null;
    let pulling = false;
    let dy = 0;
    const THRESHOLD = 70;
    const MAX = 110;

    function reset() {
      pulling = false;
      startY = null;
      dy = 0;
      els.pullIndicator.style.top = '';
      els.pullIndicator.style.transform = '';
      els.pullIndicator.classList.remove('is-visible');
    }

    document.addEventListener('touchstart', function (e) {
      if (refreshing) return;
      if (window.scrollY > 0) return;
      if (e.touches?.length !== 1) return;
      // Skip if a modal/user-select is open
      if (isAnyBlockingLayerOpen()) return;
      startY = e.touches[0].clientY;
      pulling = true;
      dy = 0;
    }, { passive: true });

    document.addEventListener('touchmove', function (e) {
      if (!pulling || startY == null) return;
      const y = e.touches[0].clientY;
      dy = y - startY;
      if (dy <= 0) {
        reset();
        return;
      }
      const eased = Math.min(MAX, dy * 0.5);
      const top = -56 + eased;
      els.pullIndicator.style.top = top + 'px';
      els.pullIndicator.style.transform = 'translateX(-50%) rotate(' + (eased * 4) + 'deg)';
      els.pullIndicator.classList.add('is-visible');
    }, { passive: true });

    document.addEventListener('touchend', function () {
      if (!pulling) return;
      const triggered = dy > THRESHOLD * 2; // touchmove halves dy via easing
      if (triggered) {
        els.pullIndicator.style.transform = 'translateX(-50%)';
        els.pullIndicator.classList.add('is-loading');
        triggerRefresh().finally(function () {
          els.pullIndicator.classList.remove('is-loading');
          reset();
        });
      } else {
        reset();
      }
    }, { passive: true });

    document.addEventListener('touchcancel', reset, { passive: true });
  }

  // ---- Service Worker -> client messages (auto-reload on push) ----
  function setupServiceWorkerMessages() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.addEventListener('message', function (e) {
      const data = e.data || {};
      if (data.type === 'reload-data') {
        if (document.visibilityState === 'visible') {
          triggerRefresh();
        }
      }
    });
  }

  function setupSoundUnlock() {
    const sound = getSoundController();
    if (!sound) return;
    const unlockedSound: LPSoundController = sound;
    function unlock() {
      unlockedSound.unlock();
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
    }
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);
  }

  function canClearAppBadge(): boolean {
    return typeof navigator !== 'undefined' && 'clearAppBadge' in navigator;
  }

  function postClearBadgeToServiceWorker(): void {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(function (reg) {
      reg?.active?.postMessage({ type: 'clearBadge' });
    }).catch(function () {});
  }

  function clearBadge() {
    if (canClearAppBadge()) {
      navigator.clearAppBadge().catch(function () {});
    }
    // Reach the service worker even on first load (controller is null until
    // the first navigation through it). serviceWorker.ready resolves with the
    // active registration regardless.
    postClearBadgeToServiceWorker();
  }

  function setupBadgeClear() {
    if (document.visibilityState === 'visible') clearBadge();
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') clearBadge();
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
