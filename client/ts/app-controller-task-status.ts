/// <reference path="./global.d.ts" />
/**
 * Task status transitions: apply / approve / reject / withdraw.
 */
import { celebrateBalance, confettiBurst, flashRow } from './app-fx';
import { getActionErrorMessage, type ApiPayloadValue, type WithBusy } from './app-modal-helpers';

type TaskStatus = LPTaskStatus;
type TaskApiAction = 'applyTask' | 'approveTask' | 'rejectTask' | 'withdrawTask';
type TaskActionKind = 'apply' | 'approve' | 'reject' | 'withdraw';

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

type TaskActionConfigBase = Omit<TaskActionConfig, 'confirmKey' | 'toastKey'> & {
  confirmKeySuffix: 'Apply' | 'Approve' | 'Reject' | 'Withdraw';
  toastKeyName: 'Applied' | 'Approved' | 'Rejected' | 'Withdrawn';
};

export interface TaskStatusActionsDeps {
  state: Pick<LPAppState, 'parentPin' | 'tasks'>;
  tr: LPTranslator;
  withBusy: WithBusy;
  api: (action: TaskApiAction, payload: Record<string, ApiPayloadValue>) => Promise<unknown>;
  clearDataCache: () => void;
  loadData: (force: boolean) => Promise<void>;
  askConfirm: (message: string) => Promise<boolean>;
  toast: (message: string, kind?: string) => void;
  sound: Pick<LPSoundController, 'play'>;
}

function taskButtons(id: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-task-id]')).filter(function (node) {
    return node.dataset.taskId === id;
  });
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

export function createTaskStatusActions(deps: TaskStatusActionsDeps) {
  const state = deps.state;
  const tr = deps.tr;
  const sound = deps.sound;
  const withBusy = deps.withBusy;
  const taskActionInFlight = new Set<string>();

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
    deps.toast(tr(config.toastKey), config.toastKind);
  }

  async function executeTaskActionRequest(id: string, config: TaskActionConfig): Promise<void> {
    const payload: Record<string, ApiPayloadValue> = { taskId: id };
    if (config.requiresPin) payload.pin = state.parentPin;
    await deps.api(config.apiAction, payload);
  }

  async function runTaskAction(btn: HTMLElement, id: string, config: TaskActionConfig): Promise<void> {
    const flightKey = id + ':' + config.apiAction;
    if (taskActionInFlight.has(flightKey)) return;
    if (!await deps.askConfirm(tr(config.confirmKey))) return;
    taskActionInFlight.add(flightKey);
    try {
      await withBusy(taskButtons(id), { label: tr('tasks.processing'), labelNode: btn }, async function () {
        await executeTaskActionRequest(id, config);
        applyTaskActionSuccess(id, btn, config);
        deps.clearDataCache();
        await deps.loadData(true);
      });
    } catch (error) {
      sound.play('error');
      deps.toast(getActionErrorMessage(error), 'error');
    } finally {
      taskActionInFlight.delete(flightKey);
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

  return {
    runTaskAction: async function (btn: HTMLElement, id: string, action: TaskActionKind): Promise<void> {
      await runTaskAction(btn, id, taskActionMap[action]);
    },
    celebrateRemoteApprovals: function (): void {
      sound.play('approve');
      celebrateBalance({ withLogo: true, toastMessage: tr('tasks.toastApproved'), toast: deps.toast });
    },
    isStatusAction: function (action: string): action is TaskActionKind {
      return action === 'apply' || action === 'approve' || action === 'reject' || action === 'withdraw';
    }
  };
}
