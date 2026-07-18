/// <reference path="./global.d.ts" />

type TaskStatus = LPTaskStatus;
type TaskApiAction = "applyTask" | "approveTask" | "rejectTask" | "withdrawTask" | "createTask" | "updateTask" | "deleteTask";
type ModalApiAction = "cashout" | "grantBonus";
type ApiPayloadValue = string | number | null;
type State = Pick<LPAppState, "parentPin" | "tasks" | "history" | "parentMode" | "user">;
type Elements = Pick<
  LPElements,
  "toast" | "cashoutAmount" | "cashoutMemo" | "cashoutBalance" | "cashoutError" | "cashoutModal" | "cashoutSubmit" | "bonusLabel" | "bonusAmount" | "bonusError" | "bonusModal" | "bonusSubmit" | "taskUpsertModal" | "taskUpsertTitle" | "taskUpsertDesc" | "taskCategorySelect" | "taskCategoryCustom" | "taskTitleInput" | "taskPointsInput" | "taskExpiryInput" | "taskUpsertDelete" | "taskUpsertSubmit" | "taskUpsertError" | "confirmModal" | "confirmMessage" | "confirmCancel" | "confirmOk"
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
  isParentMode: () => boolean;
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

function replaceChar(value: string, from: string, to: string): string {
  let out = '';
  for (const ch of value) {
    out += ch === from ? to : ch;
  }
  return out;
}

function toDateInputValue(source: unknown): string {
  if (!source) return '';
  let raw = '';
  if (typeof source === 'string' || typeof source === 'number' || typeof source === 'boolean') {
    raw = String(source).trim();
  }
  if (!raw) return '';
  const normalized = replaceChar(raw, '/', '-');
  const dateOnly = normalized.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateOnly) ? dateOnly : '';
}

function normalizeExpiryValue(source: string): string {
  const value = (source || '').trim();
  if (!value) return '';
  return replaceChar(value, '-', '/');
}

type TaskUpsertMode = 'create' | 'edit';

function normalizeCategory(value: string): string {
  return (value || '').trim();
}

function escapeOptionValue(value: string): string {
  let out = '';
  for (const ch of value) {
    out += ch === '"' ? '&quot;' : ch;
  }
  return out;
}

function openFormModal(modal: HTMLElement, error: HTMLElement, focusTarget: HTMLElement): void {
  clearError(error);
  modal.classList.remove('hidden');
  focusSoon(focusTarget);
}

function hideFormModal(modal: HTMLElement, error: HTMLElement): void {
  clearError(error);
  modal.classList.add('hidden');
}

(function bootstrap() {
  'use strict';

  function create(deps: ControllerDeps): ControllerApi {
    const state = deps.state;
    const els = deps.els;
    const tr = deps.tr;
    const sound: SoundController = (window.LESSERPAY_SOUND || { play: function () {} });
    const withBusy = deps.withBusy;
    let taskUpsertMode: TaskUpsertMode = 'create';
    let editingTaskId = '';
    let fixedCreateCategory: string | null = null;
    let taskUpsertSubmitting = false;
    let taskDeleteSubmitting = false;
    let cashoutSubmitting = false;
    let bonusSubmitting = false;
    const taskActionInFlight = new Set<string>();
    let confirmResolver: ((answer: boolean) => void) | null = null;

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

    function getTaskById(id: string): LPTask | null {
      const target = String(id);
      for (const task of state.tasks) {
        if (String(task.id) === target) return task;
      }
      return null;
    }

    function listKnownCategories(): string[] {
      const map = new Map<string, true>();
      for (const task of state.tasks) {
        const category = normalizeCategory(String(task.category || ''));
        if (category) map.set(category, true);
      }
      return Array.from(map.keys()).sort(function (a, b) { return a.localeCompare(b, 'ja'); });
    }

    function renderTaskCategoryOptions(selected: string): void {
      const categories = listKnownCategories();
      const options = categories.map(function (category) {
        const isSelected = category === selected;
        const optionValue = escapeOptionValue(category);
        return '<option value="' + optionValue + '"' + (isSelected ? ' selected' : '') + '>' + category + '</option>';
      }).join('');
      const otherSelected = !!selected && !categories.includes(selected);
      els.taskCategorySelect.innerHTML = options +
        '<option value="__other__"' + (otherSelected ? ' selected' : '') + '>' + tr('taskForm.categoryOther') + '</option>';
      if (!selected && categories.length > 0) {
        els.taskCategorySelect.value = categories[0];
      }
      toggleTaskCategoryCustomField(otherSelected);
      if (otherSelected) {
        els.taskCategoryCustom.value = selected;
      } else {
        els.taskCategoryCustom.value = '';
      }
    }

    function toggleTaskCategoryCustomField(show: boolean): void {
      els.taskCategoryCustom.classList.toggle('hidden', !show);
    }

    function selectedTaskCategory(): string {
      if (els.taskCategorySelect.value === '__other__') {
        return normalizeCategory(els.taskCategoryCustom.value);
      }
      return normalizeCategory(els.taskCategorySelect.value);
    }

    function closeTaskUpsertModal(): void {
      els.taskUpsertModal.classList.add('hidden');
      clearError(els.taskUpsertError);
      editingTaskId = '';
      taskUpsertMode = 'create';
    }

    function openTaskUpsertModalWith(initial: { mode: TaskUpsertMode; taskId?: string; category?: string; title?: string; points?: number; expiry?: string; fixedCategory?: string | null }): void {
      taskUpsertMode = initial.mode;
      editingTaskId = initial.taskId || '';
      fixedCreateCategory = initial.fixedCategory || null;
      if (taskUpsertMode === 'edit') {
        els.taskUpsertTitle.textContent = tr('taskForm.titleEdit');
        els.taskUpsertDesc.textContent = tr('taskForm.descEdit');
        els.taskUpsertSubmit.textContent = tr('taskForm.save');
        els.taskUpsertDelete.textContent = tr('taskForm.delete');
        els.taskUpsertDelete.classList.remove('hidden');
      } else if (deps.isParentMode()) {
        els.taskUpsertTitle.textContent = tr('taskForm.titleCreateParent');
        els.taskUpsertDesc.textContent = tr('taskForm.descCreateParent');
        els.taskUpsertSubmit.textContent = tr('taskForm.submit');
        els.taskUpsertDelete.classList.add('hidden');
      } else {
        els.taskUpsertTitle.textContent = tr('taskForm.titleCreateKid');
        els.taskUpsertDesc.textContent = tr('taskForm.descCreateKid');
        els.taskUpsertSubmit.textContent = tr('taskForm.submit');
        els.taskUpsertDelete.classList.add('hidden');
      }
      renderTaskCategoryOptions(initial.category || '');
      const shouldLockCategory = taskUpsertMode === 'create' && !!fixedCreateCategory;
      if (shouldLockCategory) {
        els.taskCategorySelect.value = fixedCreateCategory || '';
        toggleTaskCategoryCustomField(false);
      }
      els.taskCategorySelect.classList.toggle('hidden', shouldLockCategory);
      if (shouldLockCategory) {
        els.taskCategoryCustom.classList.add('hidden');
      }
      els.taskTitleInput.value = initial.title || '';
      els.taskPointsInput.value = initial.points ? String(initial.points) : '';
      els.taskExpiryInput.value = toDateInputValue(initial.expiry || '');
      clearError(els.taskUpsertError);
      els.taskUpsertModal.classList.remove('hidden');
      focusSoon(els.taskTitleInput);
    }

    function openTaskUpsertModal(): void {
      openTaskUpsertModalWith({ mode: 'create', fixedCategory: null });
    }

    function openTaskUpsertByCategory(category: string): void {
      openTaskUpsertModalWith({ mode: 'create', category: category, fixedCategory: category });
    }

    function openTaskUpsertOther(): void {
      const other = tr('tasks.otherGroup');
      openTaskUpsertModalWith({ mode: 'create', category: other, fixedCategory: other });
    }

    function openTaskEditModal(taskId: string): void {
      const task = getTaskById(taskId);
      if (!task) return;
      openTaskUpsertModalWith({
        mode: 'edit',
        taskId: String(task.id),
        category: String(task.category || ''),
        title: String(task.title || ''),
        points: Number(task.completeReward || task.points || 0),
        expiry: String(task.expiry || ''),
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
      const flightKey = id + ':' + config.apiAction;
      if (taskActionInFlight.has(flightKey)) return;
      if (!await askConfirm(tr(config.confirmKey))) return;
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
        toast(getActionErrorMessage(error), 'error');
      } finally {
        taskActionInFlight.delete(flightKey);
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
        throw error;
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

    async function submitTaskUpsert(): Promise<void> {
      if (taskUpsertSubmitting) return;
      const title = (els.taskTitleInput.value || '').trim();
      const points = Number.parseInt(els.taskPointsInput.value, 10);
      const expiry = normalizeExpiryValue(els.taskExpiryInput.value || '');
      const category = fixedCreateCategory || selectedTaskCategory();
      if (!title) {
        failWithError(els.taskUpsertError, tr('taskForm.invalidTitle'));
        return;
      }
      if (!isPositiveNumber(points)) {
        failWithError(els.taskUpsertError, tr('taskForm.invalidPoints'));
        return;
      }
      const payload: Record<string, ApiPayloadValue> = {
        category: category,
        title: title,
        completeReward: points,
        expiry: expiry,
      };
      const isEdit = taskUpsertMode === 'edit' && !!editingTaskId;
      if (isEdit) {
        payload.taskId = editingTaskId;
        payload.pin = state.parentPin;
      } else {
        payload.role = deps.isParentMode() ? 'parent' : 'child';
        if (deps.isParentMode()) payload.pin = state.parentPin;
      }
      taskUpsertSubmitting = true;
      hideFormModal(els.taskUpsertModal, els.taskUpsertError);
      try {
        await withBusy(els.taskUpsertSubmit, { label: tr('taskForm.processing') }, async function () {
          await deps.api(isEdit ? 'updateTask' : 'createTask', payload);
          closeTaskUpsertModal();
          sound.play(isEdit || deps.isParentMode() ? 'approve' : 'apply');
          if (isEdit) {
            toast(tr('tasks.toastUpdated'), 'success');
          } else if (deps.isParentMode()) {
            toast(tr('tasks.toastCreated'), 'success');
          } else {
            toast(tr('tasks.toastRequested'), 'success');
          }
          deps.clearDataCache();
          await deps.loadData(true);
        });
      } catch (error) {
        els.taskUpsertModal.classList.remove('hidden');
        showError(els.taskUpsertError, getActionErrorMessage(error));
      } finally {
        taskUpsertSubmitting = false;
      }
    }

    async function deleteTaskFromUpsert(): Promise<void> {
      if (taskDeleteSubmitting) return;
      if (taskUpsertMode !== 'edit' || !editingTaskId) return;
      if (!await askConfirm(tr('taskForm.confirmDelete'))) return;
      taskDeleteSubmitting = true;
      hideFormModal(els.taskUpsertModal, els.taskUpsertError);
      try {
        await withBusy(els.taskUpsertDelete, { label: tr('taskForm.deleting') }, async function () {
          await deps.api('deleteTask', { taskId: editingTaskId, pin: state.parentPin });
          closeTaskUpsertModal();
          sound.play('reject');
          toast(tr('tasks.toastDeleted'), 'success');
          deps.clearDataCache();
          await deps.loadData(true);
        });
      } catch (error) {
        els.taskUpsertModal.classList.remove('hidden');
        showError(els.taskUpsertError, getActionErrorMessage(error));
      } finally {
        taskDeleteSubmitting = false;
      }
    }

    async function onTaskAction(event: Event): Promise<void> {
      const btn = event.currentTarget as HTMLElement | null;
      if (!btn) return;
      const id = btn.dataset.taskId || '';
      const action = btn.dataset.action as TaskActionKind | 'edit' | undefined;
      if (btn.dataset.action === 'add-category-task') {
        openTaskUpsertByCategory(btn.dataset.category || '');
        return;
      }
      if (btn.dataset.action === 'add-other-task') {
        openTaskUpsertOther();
        return;
      }
      if (!id || !action) return;
      if (action === 'edit') {
        openTaskEditModal(id);
        return;
      }

      await runTaskAction(btn, id, taskActionMap[action]);
    }

    function openCashoutModal(): void {
      const total = getTotalHistoryPoints();
      els.cashoutAmount.value = total > 0 ? String(total) : '';
      els.cashoutMemo.value = '';
      els.cashoutBalance.textContent = tr('cashout.balance', { total: total.toLocaleString() });
      openFormModal(els.cashoutModal, els.cashoutError, els.cashoutAmount);
    }

    function buildCashoutSubmitConfig(amount: number, memo: string): ModalSubmitConfig {
      return makeModalSubmitConfig({
        submitButton: els.cashoutSubmit,
        processingKey: 'cashout.processing',
        apiAction: 'cashout',
        payload: function () { return { amount: amount, memo: memo, pin: state.parentPin }; },
        onSuccess: function () {
          sound.play('cashout');
          celebrateBalance({ toastMessage: tr('cashout.toast', { amount: amount }) });
        },
        onError: buildModalErrorHandler(els.cashoutError)
      });
    }

    async function submitCashout(): Promise<void> {
      if (cashoutSubmitting) return;
      const amount = Number.parseInt(els.cashoutAmount.value, 10);
      const memo = (els.cashoutMemo.value || '').trim();
      if (!isPositiveNumber(amount)) {
        failWithError(els.cashoutError, tr('cashout.invalid'));
        return;
      }
      const total = getTotalHistoryPoints();
      if (amount > total) {
        failWithError(els.cashoutError, tr('cashout.insufficient', { total: total }));
        return;
      }
      if (!await askConfirm(tr('cashout.confirm', { amount: amount }))) return;
      hideFormModal(els.cashoutModal, els.cashoutError);
      cashoutSubmitting = true;
      try {
        await runModalSubmit(buildCashoutSubmitConfig(amount, memo));
      } catch {
        els.cashoutModal.classList.remove('hidden');
      } finally {
        cashoutSubmitting = false;
      }
    }

    function openBonusModal(): void {
      els.bonusLabel.value = '';
      els.bonusAmount.value = '';
      openFormModal(els.bonusModal, els.bonusError, els.bonusAmount);
    }

    function buildBonusSubmitConfig(label: string, amount: number): ModalSubmitConfig {
      return makeModalSubmitConfig({
        submitButton: els.bonusSubmit,
        processingKey: 'bonus.processing',
        apiAction: 'grantBonus',
        payload: function () { return { label: label, amount: amount, pin: state.parentPin }; },
        onSuccess: function () {
          sound.play('approve');
          celebrateBalance({ withLogo: true, toastMessage: tr('bonus.toast', { amount: amount }) });
        },
        onError: buildModalErrorHandler(els.bonusError)
      });
    }

    async function submitBonus(): Promise<void> {
      if (bonusSubmitting) return;
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
      if (!await askConfirm(tr('bonus.confirm', { label: label, amount: amount }))) return;
      hideFormModal(els.bonusModal, els.bonusError);
      bonusSubmitting = true;
      try {
        await runModalSubmit(buildBonusSubmitConfig(label, amount));
      } catch {
        els.bonusModal.classList.remove('hidden');
      } finally {
        bonusSubmitting = false;
      }
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

    els.taskCategorySelect.addEventListener('change', function () {
      const showCustom = els.taskCategorySelect.value === '__other__';
      toggleTaskCategoryCustomField(showCustom);
      if (showCustom) focusSoon(els.taskCategoryCustom);
    });
    setupConfirmHandlers();

    return {
      toast: toast,
      onTaskAction: onTaskAction,
      openCashoutModal: openCashoutModal,
      submitCashout: submitCashout,
      openBonusModal: openBonusModal,
      submitBonus: submitBonus,
      openTaskUpsertModal: openTaskUpsertModal,
      deleteTaskFromUpsert: deleteTaskFromUpsert,
      submitTaskUpsert: submitTaskUpsert,
      celebrateRemoteApprovals: celebrateRemoteApprovals
    };
  }

  window.LESSERPAY_CONTROLLER_ACTIONS = { create: create };
})();
