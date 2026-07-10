type TaskStatus = 'Pending' | 'Submitted' | 'Approved' | 'Returned';
type TaskApiAction = 'applyTask' | 'approveTask' | 'rejectTask' | 'withdrawTask';
type ModalApiAction = 'cashout' | 'grantBonus';

interface Task {
  id: string | number;
  status: TaskStatus;
}

interface HistoryItem {
  points: number | string | null | undefined;
}

interface State {
  parentPin: string;
  tasks: Task[];
  history: HistoryItem[];
}

interface Elements {
  toast: HTMLElement;
  cashoutAmount: HTMLInputElement;
  cashoutBalance: HTMLElement;
  cashoutError: HTMLElement;
  cashoutModal: HTMLElement;
  cashoutSubmit: HTMLElement;
  bonusLabel: HTMLInputElement;
  bonusAmount: HTMLInputElement;
  bonusError: HTMLElement;
  bonusModal: HTMLElement;
  bonusSubmit: HTMLElement;
}

type Translator = (key: string, params?: Record<string, string | number>) => string;
type BusyTarget = HTMLElement | HTMLElement[] | null;
type BusyOptions = { label: string; labelNode?: HTMLElement };
type WithBusy = (target: BusyTarget, options: BusyOptions, action: () => Promise<void>) => Promise<void>;

interface ControllerDeps {
  state: State;
  els: Elements;
  tr: Translator;
  withBusy: WithBusy;
  api: (action: TaskApiAction | ModalApiAction, payload: Record<string, string | number>) => Promise<void>;
  clearDataCache: () => void;
  loadData: (force?: boolean) => Promise<void>;
}

interface SoundController {
  play: (key: string) => void;
}

interface ControllerApi {
  toast: (message: string, kind?: string) => void;
  onTaskAction: (event: Event) => Promise<void>;
  openCashoutModal: () => void;
  submitCashout: () => Promise<void>;
  openBonusModal: () => void;
  submitBonus: () => Promise<void>;
  celebrateRemoteApprovals: () => void;
}

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

interface ModalSubmitConfig {
  submitButton: HTMLElement;
  processingKey: string;
  apiAction: ModalApiAction;
  payload: () => Record<string, string | number>;
  onSuccess: () => void;
  onError: (error: unknown) => void;
}

type ToastFn = ((message: string, kind?: string) => void) & { _t?: ReturnType<typeof setTimeout> };

interface Window {
  LESSERPAY_SOUND?: SoundController;
  LESSERPAY_CONTROLLER_ACTIONS?: { create: (deps: ControllerDeps) => ControllerApi };
}

(function bootstrap() {
  'use strict';

  function create(deps: ControllerDeps): ControllerApi {
    const state = deps.state;
    const els = deps.els;
    const tr = deps.tr;
    const sound: SoundController = window.LESSERPAY_SOUND || { play: function () {} };
    const withBusy = deps.withBusy;

    function getActionErrorMessage(error: unknown): string {
      if (error instanceof Error && error.message) return error.message;
      return 'Unknown error';
    }

    function restartAnimation(node: HTMLElement, className: string, durationMs: number): void {
      node.classList.remove(className);
      // force reflow so the animation restarts on repeated triggers
      void node.offsetWidth;
      node.classList.add(className);
      setTimeout(function () { node.classList.remove(className); }, durationMs);
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
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
        const dist = 120 + Math.random() * 80;
        span.style.setProperty('--cx', Math.cos(angle) * dist + 'px');
        span.style.setProperty('--cy', Math.sin(angle) * dist + 'px');
        span.style.setProperty('--cr', Math.random() * 720 - 360 + 'deg');
        span.style.animationDelay = Math.random() * 80 + 'ms';
        layer.appendChild(span);
      }
      document.body.appendChild(layer);
      setTimeout(function () { layer.remove(); }, 1700);
    }

    const toast: ToastFn = function (message: string, kind?: string): void {
      const kindName = kind || '';
      els.toast.textContent = message;
      els.toast.className = 'toast' + (kindName ? ' toast-' + kindName : '');
      els.toast.classList.remove('hidden');
      if (toast._t) clearTimeout(toast._t);
      toast._t = setTimeout(function () {
        els.toast.classList.add('hidden');
      }, 2800);
    };

    function taskButtons(id: string): HTMLElement[] {
      return Array.from(document.querySelectorAll<HTMLElement>('[data-task-id]')).filter(function (node) {
        return node.dataset.taskId === id;
      });
    }

    function setTaskStatusById(id: string, nextStatus: TaskStatus): void {
      const targetId = String(id);
      for (let i = 0; i < state.tasks.length; i++) {
        if (String(state.tasks[i].id) === targetId) {
          state.tasks[i].status = nextStatus;
          return;
        }
      }
    }

    async function runTaskAction(btn: HTMLElement, id: string, config: TaskActionConfig): Promise<void> {
      if (!confirm(tr(config.confirmKey))) return;
      try {
        await withBusy(taskButtons(id), { label: tr('tasks.processing'), labelNode: btn }, async function () {
          const payload: Record<string, string | number> = { taskId: id };
          if (config.requiresPin) payload.pin = state.parentPin;
          await deps.api(config.apiAction, payload);
          if (config.successStatus) {
            setTaskStatusById(id, config.successStatus);
          }
          sound.play(config.soundKey);
          flashRow(btn);
          if (typeof config.afterSuccess === 'function') config.afterSuccess(btn);
          toast(tr(config.toastKey), config.toastKind);
          deps.clearDataCache();
          await deps.loadData(true);
        });
      } catch (error) {
        sound.play('error');
        toast(getActionErrorMessage(error), 'error');
      }
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
      apply: {
        confirmKey: 'tasks.confirmApply',
        apiAction: 'applyTask',
        successStatus: 'Submitted',
        soundKey: 'apply',
        toastKey: 'tasks.toastApplied',
        toastKind: 'success'
      },
      approve: {
        confirmKey: 'tasks.confirmApprove',
        apiAction: 'approveTask',
        requiresPin: true,
        successStatus: 'Approved',
        soundKey: 'approve',
        toastKey: 'tasks.toastApproved',
        toastKind: 'success',
        afterSuccess: function (targetBtn) {
          confettiBurst(targetBtn);
          cheerLogo();
          popBalance();
        }
      },
      reject: {
        confirmKey: 'tasks.confirmReject',
        apiAction: 'rejectTask',
        requiresPin: true,
        successStatus: 'Returned',
        soundKey: 'reject',
        toastKey: 'tasks.toastRejected'
      },
      withdraw: {
        confirmKey: 'tasks.confirmWithdraw',
        apiAction: 'withdrawTask',
        successStatus: 'Pending',
        soundKey: 'reject',
        toastKey: 'tasks.toastWithdrawn'
      }
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
      els.cashoutError.classList.add('hidden');
      els.cashoutModal.classList.remove('hidden');
      setTimeout(function () { els.cashoutAmount.focus(); }, 50);
    }

    async function submitCashout(): Promise<void> {
      const amount = Number.parseInt(els.cashoutAmount.value, 10);
      if (!amount || amount <= 0) {
        els.cashoutError.textContent = tr('cashout.invalid');
        els.cashoutError.classList.remove('hidden');
        return;
      }
      const total = getTotalHistoryPoints();
      if (amount > total) {
        els.cashoutError.textContent = tr('cashout.insufficient', { total: total });
        els.cashoutError.classList.remove('hidden');
        return;
      }
      if (!confirm(tr('cashout.confirm', { amount: amount }))) return;
      await runModalSubmit({
        submitButton: els.cashoutSubmit,
        processingKey: 'cashout.processing',
        apiAction: 'cashout',
        payload: function () { return { amount: amount, pin: state.parentPin }; },
        onSuccess: function () {
          els.cashoutModal.classList.add('hidden');
          sound.play('cashout');
          confettiBurst(document.querySelector('.balance-number'));
          popBalance();
          toast(tr('cashout.toast', { amount: amount }), 'success');
        },
        onError: function (error) {
          els.cashoutError.textContent = getActionErrorMessage(error);
          els.cashoutError.classList.remove('hidden');
        }
      });
    }

    function openBonusModal(): void {
      els.bonusLabel.value = '';
      els.bonusAmount.value = '';
      els.bonusError.classList.add('hidden');
      els.bonusModal.classList.remove('hidden');
      setTimeout(function () { els.bonusLabel.focus(); }, 50);
    }

    async function submitBonus(): Promise<void> {
      const label = (els.bonusLabel.value || '').trim();
      const amount = Number.parseInt(els.bonusAmount.value, 10);
      if (!label) {
        els.bonusError.textContent = tr('bonus.invalidLabel');
        els.bonusError.classList.remove('hidden');
        return;
      }
      if (!amount || amount <= 0) {
        els.bonusError.textContent = tr('bonus.invalidAmount');
        els.bonusError.classList.remove('hidden');
        return;
      }
      if (!confirm(tr('bonus.confirm', { label: label, amount: amount }))) return;
      await runModalSubmit({
        submitButton: els.bonusSubmit,
        processingKey: 'bonus.processing',
        apiAction: 'grantBonus',
        payload: function () { return { label: label, amount: amount, pin: state.parentPin }; },
        onSuccess: function () {
          els.bonusModal.classList.add('hidden');
          sound.play('approve');
          confettiBurst(document.querySelector('.balance-number'));
          cheerLogo();
          popBalance();
          toast(tr('bonus.toast', { amount: amount }), 'success');
        },
        onError: function (error) {
          els.bonusError.textContent = getActionErrorMessage(error);
          els.bonusError.classList.remove('hidden');
        }
      });
    }

    function getTotalHistoryPoints(): number {
      return state.history.reduce(function (sum, history) {
        return sum + (Number(history.points) || 0);
      }, 0);
    }

    // Fired when loadData detects tasks that flipped Submitted → Approved
    // remotely (i.e. parent approved while the kid's app was elsewhere).
    // Mirrors the local 'approve' button celebration, anchored on the balance
    // since the task row has already been removed from the list.
    function celebrateRemoteApprovals(): void {
      sound.play('approve');
      confettiBurst(document.querySelector('.balance-number'));
      cheerLogo();
      popBalance();
      toast(tr('tasks.toastApproved'), 'success');
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
