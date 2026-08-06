/// <reference path="./global.d.ts" />
/**
 * Controller actions facade: confirm dialog + toast + feature modules.
 */
import { createFinanceActions } from './app-controller-finance';
import { createTaskFormActions } from './app-controller-task-form';
import { createTaskStatusActions } from './app-controller-task-status';
import type { ApiPayloadValue, WithBusy } from './app-modal-helpers';

type TaskApiAction =
  | 'applyTask'
  | 'approveTask'
  | 'rejectTask'
  | 'withdrawTask'
  | 'createTask'
  | 'updateTask'
  | 'deleteTask';
type ModalApiAction = 'cashout' | 'grantBonus';
type State = Pick<LPAppState, 'parentPin' | 'tasks' | 'history' | 'parentMode' | 'user'>;
type Elements = Pick<
  LPElements,
  | 'toast'
  | 'cashoutAmount'
  | 'cashoutMemo'
  | 'cashoutBalance'
  | 'cashoutError'
  | 'cashoutModal'
  | 'cashoutSubmit'
  | 'bonusLabel'
  | 'bonusAmount'
  | 'bonusError'
  | 'bonusModal'
  | 'bonusSubmit'
  | 'taskUpsertModal'
  | 'taskUpsertTitle'
  | 'taskUpsertDesc'
  | 'taskCategorySelect'
  | 'taskCategoryCustom'
  | 'taskTitleInput'
  | 'taskPointsInput'
  | 'taskExpiryInput'
  | 'taskUpsertDelete'
  | 'taskUpsertSaveNew'
  | 'taskUpsertSubmit'
  | 'taskUpsertError'
  | 'confirmModal'
  | 'confirmMessage'
  | 'confirmCancel'
  | 'confirmOk'
>;

interface ControllerDeps {
  state: State;
  els: Elements;
  tr: LPTranslator;
  withBusy: WithBusy;
  api: (action: TaskApiAction | ModalApiAction, payload: Record<string, ApiPayloadValue>) => Promise<unknown>;
  clearDataCache: () => void;
  loadData: (force: boolean) => Promise<void>;
  isParentMode: () => boolean;
}

type ToastFn = ((message: string, kind?: string) => void) & { _t?: ReturnType<typeof setTimeout> };

(function bootstrap() {
  'use strict';

  function create(deps: ControllerDeps): LPControllerActionsApi {
    const els = deps.els;
    const tr = deps.tr;
    const sound: Pick<LPSoundController, 'play'> = window.LESSERPAY_SOUND || { play: function () {} };
    let confirmResolver: ((answer: boolean) => void) | null = null;

    function settleConfirm(answer: boolean): void {
      const resolver = confirmResolver;
      confirmResolver = null;
      els.confirmModal.classList.add('hidden');
      if (resolver) resolver(answer);
    }

    function askConfirm(message: string): Promise<boolean> {
      if (confirmResolver) return Promise.resolve(false);
      els.confirmMessage.textContent = message;
      els.confirmModal.classList.remove('hidden');
      return new Promise(function (resolve) {
        confirmResolver = resolve;
      });
    }

    function setupConfirmHandlers(): void {
      els.confirmCancel.textContent = tr('confirm.no');
      els.confirmOk.textContent = tr('confirm.yes');
      els.confirmCancel.addEventListener('click', function () { settleConfirm(false); });
      els.confirmOk.addEventListener('click', function () { settleConfirm(true); });
      els.confirmModal.addEventListener('click', function (event) {
        if (event.target === els.confirmModal) settleConfirm(false);
      });
      document.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape') return;
        if (els.confirmModal.classList.contains('hidden')) return;
        settleConfirm(false);
      });
    }

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

    const shared = {
      tr: tr,
      withBusy: deps.withBusy,
      clearDataCache: deps.clearDataCache,
      loadData: deps.loadData,
      askConfirm: askConfirm,
      toast: toast,
      sound: sound,
    };

    const taskStatus = createTaskStatusActions({
      ...shared,
      state: deps.state,
      api: deps.api,
    });

    const taskForm = createTaskFormActions({
      ...shared,
      state: deps.state,
      els: deps.els,
      api: deps.api,
      isParentMode: deps.isParentMode,
    });

    const finance = createFinanceActions({
      ...shared,
      state: deps.state,
      els: deps.els,
      api: deps.api,
    });

    async function onTaskAction(event: Event): Promise<void> {
      const btn = event.currentTarget as HTMLElement | null;
      if (!btn) return;
      const id = btn.dataset.taskId || '';
      const action = btn.dataset.action;
      if (btn.dataset.action === 'add-category-task') {
        taskForm.openTaskUpsertByCategory(btn.dataset.category || '');
        return;
      }
      if (btn.dataset.action === 'add-other-task') {
        taskForm.openTaskUpsertOther();
        return;
      }
      if (!id || !action) return;
      if (action === 'edit') {
        taskForm.openTaskEditModal(id);
        return;
      }
      if (action === 'delete') {
        await taskForm.deleteTaskById(id);
        return;
      }
      if (taskStatus.isStatusAction(action)) {
        await taskStatus.runTaskAction(btn, id, action);
      }
    }

    setupConfirmHandlers();

    return {
      toast: toast,
      onTaskAction: onTaskAction,
      openCashoutModal: finance.openCashoutModal,
      submitCashout: finance.submitCashout,
      openBonusModal: finance.openBonusModal,
      submitBonus: finance.submitBonus,
      openTaskUpsertModal: taskForm.openTaskUpsertModal,
      deleteTaskFromUpsert: taskForm.deleteTaskFromUpsert,
      submitTaskUpsert: taskForm.submitTaskUpsert,
      submitTaskUpsertAndNew: taskForm.submitTaskUpsertAndNew,
      celebrateRemoteApprovals: taskStatus.celebrateRemoteApprovals
    };
  }

  window.LESSERPAY_CONTROLLER_ACTIONS = { create: create };
})();
