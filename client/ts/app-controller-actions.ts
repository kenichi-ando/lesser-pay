/// <reference path="./global.d.ts" />

type TaskStatus = LPTaskStatus;
type TaskApiAction = "applyTask" | "approveTask" | "rejectTask" | "withdrawTask";
type ModalApiAction = "cashout" | "grantBonus";
type ApiPayloadValue = string | number | null;
type State = Pick<LPAppState, "parentPin" | "tasks" | "history">;
type Elements = Pick<
  LPElements,
  "toast" | "cashoutAmount" | "cashoutBalance" | "cashoutError" | "cashoutModal" | "cashoutSubmit" | "bonusLabel" | "bonusAmount" | "bonusError" | "bonusModal" | "bonusSubmit"
>;
type Translator = LPTranslator;
type BusyTarget = LPBusyTarget;
type BusyOptions = { label: string; labelNode?: HTMLElement };
type WithBusy = (target: BusyTarget, options: BusyOptions, action: () => Promise<void>) => Promise<void>;

interface ControllerDeps {
  state: State;
  els: Elements;
  tr: Translator;
  withBusy: WithBusy;
  api: (action: TaskApiAction | ModalApiAction, payload: Record<string, ApiPayloadValue>) => Promise<unknown>;
  clearDataCache: () => void;
  loadData: (force: boolean) => Promise<void>;
}

type SoundController = Pick<LPSoundController, "play">;
type ControllerApi = LPControllerActionsApi;

interface TaskActionConfig {
  confirmKey: string;
  apiAction: TaskApiAction;
  requiresPin?: boolean;
  successStatus?: TaskStatus;
  soundKey: string;
  toastKey: string;
  toastKind?: string;
  afterSuccess?: (button: HTMLElement) => void;
}

type TaskActionKind = 'apply' | 'approve' | 'reject' | 'withdraw';
type TaskActionConfigBase = Omit<TaskActionConfig, 'confirmKey' | 'toastKey'> & {
  confirmKeySuffix: 'Apply' | 'Approve' | 'Reject' | 'Withdraw';
  toastKeyName: 'Applied' | 'Approved' | 'Rejected' | 'Withdrawn';
};

interface ModalSubmitConfig {
  submitButton: HTMLElement;
  processingKey: string;
  apiAction: ModalApiAction;
  payload: () => Record<string, ApiPayloadValue>;
  onSuccess: () => void;
  onError: (error: unknown) => void;
}

type ToastFn = ((message: string, kind?: string) => void) & { _t?: ReturnType<typeof setTimeout> };

function getActionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Unknown error';
}

function restartAnimation(node: HTMLElement, className: string, durationMs: number): void {
  node.classList.remove(className);
  // force reflow so the animation restarts on repeated triggers
  node.getBoundingClientRect();
  node.classList.add(className);
  setTimeout(function () { node.classList.remove(className); }, durationMs);
}

function taskButtons(id: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-task-id]')).filter(function (node) {
    return node.dataset.taskId === id;
  });
}

function randomUnit(): number {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] / 0x100000000;
}

function flashRow(btn: HTMLElement | null): void {
  const row = btn?.closest('.task-item');
  if (!(row instanceof HTMLElement)) return;
  restartAnimation(row, 'is-flash', 1000);
}

function popBalance(): void {
  const node = document.querySelector<HTMLElement>('.balance-number');
  if (node) {
    restartAnimation(node, 'is-pop', 800);
  }
  const card = document.querySelector<HTMLElement>('.balance-card');
  if (card) {
    restartAnimation(card, 'is-glow', 1000);
  }
}

function cheerLogo(): void {
  const node = document.querySelector<HTMLElement>('.app-logo');
  if (!node) return;
  restartAnimation(node, 'is-cheer', 700);
}

function confettiBurst(originEl: Element | null): void {
  if (!originEl) return;
  const rect = originEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const layer = document.createElement('div');
  layer.className = 'confetti-burst';
  layer.style.left = cx + 'px';
  layer.style.top = cy + 'px';
  const emojis = ['✨', '🎉', '⭐', '🎊', '💫', '🎈', '🌟', '🐾'];
  const count = 24;
  for (let i = 0; i < count; i++) {
    const span = document.createElement('span');
    span.className = 'confetti-piece';
    span.textContent = emojis[i % emojis.length];
    const angle = (Math.PI * 2 * i) / count + randomUnit() * 0.4;
    const dist = 120 + randomUnit() * 80;
    span.style.setProperty('--cx', Math.cos(angle) * dist + 'px');
    span.style.setProperty('--cy', Math.sin(angle) * dist + 'px');
    span.style.setProperty('--cr', randomUnit() * 720 - 360 + 'deg');
    span.style.animationDelay = randomUnit() * 80 + 'ms';
    layer.appendChild(span);
  }
  document.body.appendChild(layer);
  setTimeout(function () { layer.remove(); }, 1700);
}

function showError(node: HTMLElement, message: string): void {
  node.textContent = message;
  node.classList.remove('hidden');
}

function clearError(node: HTMLElement): void {
  node.classList.add('hidden');
}

function focusSoon(node: HTMLElement): void {
  setTimeout(function () { node.focus(); }, 50);
}

function failWithError(node: HTMLElement, message: string): false {
  showError(node, message);
  return false;
}

function buildModalErrorHandler(node: HTMLElement): (error: unknown) => void {
  return function (error: unknown): void {
    showError(node, getActionErrorMessage(error));
  };
}

function makeModalSubmitConfig(base: ModalSubmitConfig): ModalSubmitConfig {
  return {
    submitButton: base.submitButton,
    processingKey: base.processingKey,
    apiAction: base.apiAction,
    payload: base.payload,
    onSuccess: base.onSuccess,
    onError: base.onError
  };
}

function isPositiveNumber(value: number): boolean {
  return !!value && value > 0;
}

function openFormModal(modal: HTMLElement, error: HTMLElement, focusTarget: HTMLElement): void {
  clearError(error);
  modal.classList.remove('hidden');
  focusSoon(focusTarget);
}

(function bootstrap() {
  'use strict';

  function create(deps: ControllerDeps): ControllerApi {
    const state = deps.state;
    const els = deps.els;
    const tr = deps.tr;
    const sound: SoundController = (window.LESSERPAY_SOUND || { play: function () {} });
    const withBusy = deps.withBusy;

    const toast: ToastFn = function (message: string, kind = ''): void {
      const kindName = kind;
      els.toast.textContent = message;
      els.toast.className = 'toast' + (kindName ? ' toast-' + kindName : '');
      els.toast.classList.remove('hidden');
      if (toast._t) clearTimeout(toast._t);
      toast._t = setTimeout(function () {
        els.toast.classList.add('hidden');
      }, 2800);
    };

    function setTaskStatusById(id: string, nextStatus: TaskStatus): void {
      const targetId = String(id);
      for (const task of state.tasks) {
        if (String(task.id) === targetId) {
          task.status = nextStatus;
          return;
        }
      }
    }

    function applyTaskActionSuccess(id: string, btn: HTMLElement, config: TaskActionConfig): void {
      if (config.successStatus) {
        setTaskStatusById(id, config.successStatus);
      }
      sound.play(config.soundKey);
      flashRow(btn);
      if (typeof config.afterSuccess === 'function') config.afterSuccess(btn);
      toast(tr(config.toastKey), config.toastKind);
    }

    async function executeTaskActionRequest(id: string, config: TaskActionConfig): Promise<void> {
      const payload: Record<string, ApiPayloadValue> = { taskId: id };
      if (config.requiresPin) payload.pin = state.parentPin;
      await deps.api(config.apiAction, payload);
    }

    async function runTaskAction(btn: HTMLElement, id: string, config: TaskActionConfig): Promise<void> {
      if (!confirm(tr(config.confirmKey))) return;
      try {
        await withBusy(taskButtons(id), { label: tr('tasks.processing'), labelNode: btn }, async function () {
          await executeTaskActionRequest(id, config);
          applyTaskActionSuccess(id, btn, config);
          deps.clearDataCache();
          await deps.loadData(true);
        });
      } catch (error) {
        sound.play('error');
        toast(getActionErrorMessage(error), 'error');
      }
    }

    function makeTaskActionConfig(base: TaskActionConfigBase): TaskActionConfig {
      return {
        confirmKey: 'tasks.confirm' + base.confirmKeySuffix,
        toastKey: 'tasks.toast' + base.toastKeyName,
        apiAction: base.apiAction,
        soundKey: base.soundKey,
        requiresPin: base.requiresPin,
        successStatus: base.successStatus,
        toastKind: base.toastKind,
        afterSuccess: base.afterSuccess
      };
    }

    async function runModalSubmit(config: ModalSubmitConfig): Promise<void> {
      try {
        await withBusy(config.submitButton, { label: tr(config.processingKey) }, async function () {
          await deps.api(config.apiAction, config.payload());
          config.onSuccess();
          deps.clearDataCache();
          await deps.loadData(true);
        });
      } catch (error) {
        config.onError(error);
      }
    }

    const taskActionMap: Record<TaskActionKind, TaskActionConfig> = {
      apply: makeTaskActionConfig({
        confirmKeySuffix: 'Apply',
        toastKeyName: 'Applied',
        apiAction: 'applyTask',
        successStatus: 'Submitted',
        soundKey: 'apply',
        toastKind: 'success'
      }),
      approve: makeTaskActionConfig({
        confirmKeySuffix: 'Approve',
        toastKeyName: 'Approved',
        apiAction: 'approveTask',
        requiresPin: true,
        successStatus: 'Approved',
        soundKey: 'approve',
        toastKind: 'success',
        afterSuccess: function (targetBtn) {
          confettiBurst(targetBtn);
          celebrateBalance({ withLogo: true });
        }
      }),
      reject: makeTaskActionConfig({
        confirmKeySuffix: 'Reject',
        toastKeyName: 'Rejected',
        apiAction: 'rejectTask',
        requiresPin: true,
        successStatus: 'Returned',
        soundKey: 'reject'
      }),
      withdraw: makeTaskActionConfig({
        confirmKeySuffix: 'Withdraw',
        toastKeyName: 'Withdrawn',
        apiAction: 'withdrawTask',
        successStatus: 'Pending',
        soundKey: 'reject'
      })
    };

    async function onTaskAction(event: Event): Promise<void> {
      const btn = event.currentTarget as HTMLElement | null;
      if (!btn) return;
      const id = btn.dataset.taskId || '';
      const action = btn.dataset.action as TaskActionKind | undefined;
      if (!id || !action) return;

      await runTaskAction(btn, id, taskActionMap[action]);
    }

    function openCashoutModal(): void {
      const total = getTotalHistoryPoints();
      els.cashoutAmount.value = total > 0 ? String(total) : '';
      els.cashoutBalance.textContent = tr('cashout.balance', { total: total.toLocaleString() });
      openFormModal(els.cashoutModal, els.cashoutError, els.cashoutAmount);
    }

    function buildCashoutSubmitConfig(amount: number): ModalSubmitConfig {
      return makeModalSubmitConfig({
        submitButton: els.cashoutSubmit,
        processingKey: 'cashout.processing',
        apiAction: 'cashout',
        payload: function () { return { amount: amount, pin: state.parentPin }; },
        onSuccess: function () {
          els.cashoutModal.classList.add('hidden');
          sound.play('cashout');
          celebrateBalance({ toastMessage: tr('cashout.toast', { amount: amount }) });
        },
        onError: buildModalErrorHandler(els.cashoutError)
      });
    }

    async function submitCashout(): Promise<void> {
      const amount = Number.parseInt(els.cashoutAmount.value, 10);
      if (!isPositiveNumber(amount)) {
        failWithError(els.cashoutError, tr('cashout.invalid'));
        return;
      }
      const total = getTotalHistoryPoints();
      if (amount > total) {
        failWithError(els.cashoutError, tr('cashout.insufficient', { total: total }));
        return;
      }
      if (!confirm(tr('cashout.confirm', { amount: amount }))) return;
      await runModalSubmit(buildCashoutSubmitConfig(amount));
    }

    function openBonusModal(): void {
      els.bonusLabel.value = '';
      els.bonusAmount.value = '';
      openFormModal(els.bonusModal, els.bonusError, els.bonusLabel);
    }

    function buildBonusSubmitConfig(label: string, amount: number): ModalSubmitConfig {
      return makeModalSubmitConfig({
        submitButton: els.bonusSubmit,
        processingKey: 'bonus.processing',
        apiAction: 'grantBonus',
        payload: function () { return { label: label, amount: amount, pin: state.parentPin }; },
        onSuccess: function () {
          els.bonusModal.classList.add('hidden');
          sound.play('approve');
          celebrateBalance({ withLogo: true, toastMessage: tr('bonus.toast', { amount: amount }) });
        },
        onError: buildModalErrorHandler(els.bonusError)
      });
    }

    async function submitBonus(): Promise<void> {
      const label = (els.bonusLabel.value || '').trim();
      const amount = Number.parseInt(els.bonusAmount.value, 10);
      if (!label) {
        failWithError(els.bonusError, tr('bonus.invalidLabel'));
        return;
      }
      if (!isPositiveNumber(amount)) {
        failWithError(els.bonusError, tr('bonus.invalidAmount'));
        return;
      }
      if (!confirm(tr('bonus.confirm', { label: label, amount: amount }))) return;
      await runModalSubmit(buildBonusSubmitConfig(label, amount));
    }

    function getTotalHistoryPoints(): number {
      return state.history.reduce(function (sum, history) {
        return sum + (Number(history.points) || 0);
      }, 0);
    }

    function celebrateBalance(opts: { withLogo?: boolean; toastMessage?: string }): void {
      if (opts.withLogo) cheerLogo();
      confettiBurst(document.querySelector('.balance-number'));
      popBalance();
      if (opts.toastMessage) toast(opts.toastMessage, 'success');
    }

    // Fired when loadData detects tasks that flipped Submitted → Approved
    // remotely (i.e. parent approved while the kid's app was elsewhere).
    // Mirrors the local 'approve' button celebration, anchored on the balance
    // since the task row has already been removed from the list.
    function celebrateRemoteApprovals(): void {
      sound.play('approve');
      celebrateBalance({ withLogo: true, toastMessage: tr('tasks.toastApproved') });
    }

    return {
      toast: toast,
      onTaskAction: onTaskAction,
      openCashoutModal: openCashoutModal,
      submitCashout: submitCashout,
      openBonusModal: openBonusModal,
      submitBonus: submitBonus,
      celebrateRemoteApprovals: celebrateRemoteApprovals
    };
  }

  window.LESSERPAY_CONTROLLER_ACTIONS = { create: create };
})();
