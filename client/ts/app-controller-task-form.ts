/// <reference path="./global.d.ts" />
/**
 * Task create / edit / delete modal flows.
 */
import {
  clearError,
  failWithError,
  focusSoon,
  getActionErrorMessage,
  hideFormModal,
  showError,
  type ApiPayloadValue,
  type WithBusy,
} from './app-modal-helpers';

type TaskApiAction = 'createTask' | 'updateTask' | 'deleteTask';
type TaskUpsertMode = 'create' | 'edit';

export interface TaskFormActionsDeps {
  state: Pick<LPAppState, 'parentPin' | 'tasks'>;
  els: Pick<
    LPElements,
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
  >;
  tr: LPTranslator;
  withBusy: WithBusy;
  api: (action: TaskApiAction, payload: Record<string, ApiPayloadValue>) => Promise<unknown>;
  clearDataCache: () => void;
  loadData: (force: boolean) => Promise<void>;
  isParentMode: () => boolean;
  askConfirm: (message: string) => Promise<boolean>;
  toast: (message: string, kind?: string) => void;
  sound: Pick<LPSoundController, 'play'>;
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

function isPositiveNumber(value: number): boolean {
  return !!value && value > 0;
}

function taskButtons(id: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-task-id]')).filter(function (node) {
    return node.dataset.taskId === id;
  });
}

export function createTaskFormActions(deps: TaskFormActionsDeps) {
  const state = deps.state;
  const els = deps.els;
  const tr = deps.tr;
  const sound = deps.sound;
  const withBusy = deps.withBusy;
  let taskUpsertMode: TaskUpsertMode = 'create';
  let editingTaskId = '';
  let taskUpsertSubmitting = false;
  let taskDeleteSubmitting = false;

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

  function toggleTaskCategoryCustomField(show: boolean): void {
    els.taskCategoryCustom.classList.toggle('hidden', !show);
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

  function syncTaskPointsLocked(): void {
    els.taskPointsInput.disabled = false;
    els.taskPointsInput.setAttribute('aria-disabled', 'false');
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

  function applyTaskUpsertModeUi(isEdit: boolean, isParentCreate: boolean): void {
    let titleKey = 'taskForm.titleCreateKid';
    let descKey = 'taskForm.descCreateKid';
    if (isEdit) {
      titleKey = 'taskForm.titleEdit';
      descKey = 'taskForm.descEdit';
    } else if (isParentCreate) {
      titleKey = 'taskForm.titleCreateParent';
      descKey = 'taskForm.descCreateParent';
    }
    els.taskUpsertTitle.textContent = tr(titleKey);
    els.taskUpsertDesc.textContent = tr(descKey);
    els.taskUpsertSubmit.textContent = tr('taskForm.save');
    els.taskUpsertSaveNew.textContent = tr('taskForm.saveAndNew');
    els.taskUpsertSaveNew.classList.toggle('hidden', isEdit);
    // Deletion is handled from the task tile swipe actions to reduce
    // accidental taps in the edit dialog.
    els.taskUpsertDelete.textContent = tr('taskForm.delete');
    els.taskUpsertDelete.classList.add('hidden');
  }

  function preferredTaskUpsertFocusTarget(): HTMLElement {
    if (!els.taskCategorySelect.classList.contains('hidden')) return els.taskCategorySelect;
    if (!els.taskCategoryCustom.classList.contains('hidden')) return els.taskCategoryCustom;
    return els.taskTitleInput;
  }

  function syncTaskExpiryInputType(forceDate?: boolean): void {
    const hasValue = !!(els.taskExpiryInput.value || '').trim();
    const asDate = !!forceDate || hasValue;
    const nextType = asDate ? 'date' : 'text';
    if (els.taskExpiryInput.type !== nextType) els.taskExpiryInput.type = nextType;
  }

  function openTaskUpsertModalWith(initial: {
    mode: TaskUpsertMode;
    taskId?: string;
    category?: string;
    title?: string;
    points?: number;
    expiry?: string;
    forceOtherCategory?: boolean;
  }): void {
    taskUpsertMode = initial.mode;
    editingTaskId = initial.taskId || '';
    const isEdit = taskUpsertMode === 'edit';
    const isParentCreate = !isEdit && deps.isParentMode();
    applyTaskUpsertModeUi(isEdit, isParentCreate);
    syncTaskPointsLocked();
    renderTaskCategoryOptions(initial.category || '');
    if (taskUpsertMode === 'create' && initial.forceOtherCategory) {
      els.taskCategorySelect.value = '__other__';
      toggleTaskCategoryCustomField(true);
      els.taskCategoryCustom.value = '';
    }
    els.taskCategorySelect.classList.remove('hidden');
    els.taskTitleInput.value = initial.title || '';
    els.taskPointsInput.value = initial.points ? String(initial.points) : '';
    els.taskExpiryInput.value = toDateInputValue(initial.expiry || '');
    syncTaskExpiryInputType();
    clearError(els.taskUpsertError);
    els.taskUpsertModal.classList.remove('hidden');
    focusSoon(preferredTaskUpsertFocusTarget());
  }

  function setupTaskExpiryInputBehavior(): void {
    syncTaskExpiryInputType();
    els.taskExpiryInput.addEventListener('focus', function () {
      syncTaskExpiryInputType(true);
      if (typeof els.taskExpiryInput.showPicker === 'function') {
        try { els.taskExpiryInput.showPicker(); } catch {}
      }
    });
    els.taskExpiryInput.addEventListener('click', function () {
      syncTaskExpiryInputType(true);
    });
    els.taskExpiryInput.addEventListener('blur', function () {
      syncTaskExpiryInputType();
    });
    els.taskExpiryInput.addEventListener('change', function () {
      syncTaskExpiryInputType();
    });
  }

  function keepTaskUpsertOpenAfterCreate(): void {
    clearError(els.taskUpsertError);
    els.taskTitleInput.focus();
    els.taskTitleInput.select();
  }

  function parseTaskUpsertInput(): { title: string; points: number; expiry: string; category: string } | null {
    const title = (els.taskTitleInput.value || '').trim();
    const points = Number.parseInt(els.taskPointsInput.value, 10);
    const expiry = normalizeExpiryValue(els.taskExpiryInput.value || '');
    const category = selectedTaskCategory();
    if (!title) {
      failWithError(els.taskUpsertError, tr('taskForm.invalidTitle'));
      return null;
    }
    if (!category) {
      failWithError(els.taskUpsertError, tr('taskForm.invalidCategory'));
      return null;
    }
    if (!isPositiveNumber(points)) {
      failWithError(els.taskUpsertError, tr('taskForm.invalidPoints'));
      return null;
    }
    return { title: title, points: points, expiry: expiry, category: category };
  }

  function buildTaskUpsertPayload(
    input: { title: string; points: number; expiry: string; category: string },
    isEdit: boolean
  ): Record<string, ApiPayloadValue> {
    const payload: Record<string, ApiPayloadValue> = {
      category: input.category,
      title: input.title,
      completeReward: input.points,
      expiry: input.expiry,
    };
    if (isEdit) {
      payload.taskId = editingTaskId;
      payload.pin = state.parentPin;
      return payload;
    }
    const parentMode = deps.isParentMode();
    payload.role = parentMode ? 'parent' : 'child';
    if (parentMode) payload.pin = state.parentPin;
    return payload;
  }

  function toastTaskUpsertSuccess(isEdit: boolean): void {
    let key = 'tasks.toastRequested';
    if (isEdit) key = 'tasks.toastUpdated';
    else if (deps.isParentMode()) key = 'tasks.toastCreated';
    deps.toast(tr(key), 'success');
  }

  async function submitTaskUpsertCore(keepOpenAfterCreate: boolean): Promise<void> {
    if (taskUpsertSubmitting) return;
    const input = parseTaskUpsertInput();
    if (!input) return;
    const isEdit = taskUpsertMode === 'edit' && !!editingTaskId;
    const payload = buildTaskUpsertPayload(input, isEdit);
    const shouldKeepOpen = !isEdit && keepOpenAfterCreate;
    taskUpsertSubmitting = true;
    if (!shouldKeepOpen) {
      hideFormModal(els.taskUpsertModal, els.taskUpsertError);
    } else {
      clearError(els.taskUpsertError);
    }
    try {
      const submitButton = shouldKeepOpen ? els.taskUpsertSaveNew : els.taskUpsertSubmit;
      await withBusy(submitButton, { label: tr('taskForm.processing') }, async function () {
        await deps.api(isEdit ? 'updateTask' : 'createTask', payload);
        if (!shouldKeepOpen) {
          closeTaskUpsertModal();
        } else {
          keepTaskUpsertOpenAfterCreate();
        }
        sound.play(isEdit || deps.isParentMode() ? 'approve' : 'apply');
        toastTaskUpsertSuccess(isEdit);
        deps.clearDataCache();
        await deps.loadData(true);
      });
    } catch (error) {
      if (!shouldKeepOpen) els.taskUpsertModal.classList.remove('hidden');
      showError(els.taskUpsertError, getActionErrorMessage(error));
    } finally {
      taskUpsertSubmitting = false;
    }
  }

  async function deleteTaskById(taskId: string): Promise<void> {
    if (taskDeleteSubmitting) return;
    if (!taskId) return;
    if (!await deps.askConfirm(tr('taskForm.confirmDelete'))) return;
    taskDeleteSubmitting = true;
    const shouldHideModal = !els.taskUpsertModal.classList.contains('hidden');
    if (shouldHideModal) hideFormModal(els.taskUpsertModal, els.taskUpsertError);
    try {
      await withBusy(taskButtons(taskId), { label: tr('taskForm.deleting') }, async function () {
        await deps.api('deleteTask', { taskId: taskId, pin: state.parentPin });
        closeTaskUpsertModal();
        sound.play('reject');
        deps.toast(tr('tasks.toastDeleted'), 'success');
        deps.clearDataCache();
        await deps.loadData(true);
      });
    } catch (error) {
      if (shouldHideModal) els.taskUpsertModal.classList.remove('hidden');
      showError(els.taskUpsertError, getActionErrorMessage(error));
    } finally {
      taskDeleteSubmitting = false;
    }
  }

  els.taskCategorySelect.addEventListener('change', function () {
    const showCustom = els.taskCategorySelect.value === '__other__';
    toggleTaskCategoryCustomField(showCustom);
    if (showCustom) focusSoon(els.taskCategoryCustom);
  });
  setupTaskExpiryInputBehavior();

  return {
    openTaskUpsertModal: function (): void {
      openTaskUpsertModalWith({ mode: 'create' });
    },
    openTaskUpsertByCategory: function (category: string): void {
      openTaskUpsertModalWith({ mode: 'create', category: category });
    },
    openTaskUpsertOther: function (): void {
      openTaskUpsertModalWith({ mode: 'create', forceOtherCategory: true });
    },
    openTaskEditModal: function (taskId: string): void {
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
    },
    deleteTaskById: deleteTaskById,
    deleteTaskFromUpsert: async function (): Promise<void> {
      if (taskUpsertMode !== 'edit' || !editingTaskId) return;
      await deleteTaskById(editingTaskId);
    },
    submitTaskUpsert: async function (): Promise<void> {
      await submitTaskUpsertCore(false);
    },
    submitTaskUpsertAndNew: async function (): Promise<void> {
      await submitTaskUpsertCore(true);
    }
  };
}
