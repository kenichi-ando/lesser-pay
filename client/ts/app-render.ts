/// <reference path="./global.d.ts" />
(function () {
  'use strict';
  const SWIPE_INTENT_PX = 12;
  const SWIPE_TRIGGER_PX = 24;

  function sumHistoryPoints(history: LPHistoryItem[]): number {
    return history.reduce(function (sum, h) { return sum + (Number(h.points) || 0); }, 0);
  }

function compareTextJa(a: string, b: string): number {
  return a.localeCompare(b, 'ja');
}

function taskSortKeyText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function compareTaskByTitleThenId(a: LPTask, b: LPTask): number {
  const byTitle = compareTextJa(taskSortKeyText(a.title), taskSortKeyText(b.title));
  if (byTitle !== 0) return byTitle;
  return compareTextJa(taskSortKeyText(a.id), taskSortKeyText(b.id));
}

function dayStart(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function daysUntilDate(source: unknown, parseDate: LPRendererDeps['parseDate']): number | null {
  const parsed = parseDate(source);
  if (!parsed) return null;
  const target = dayStart(parsed).getTime();
  const today = dayStart(new Date()).getTime();
  return Math.floor((target - today) / (24 * 60 * 60 * 1000));
}

  function statusClassOf(task: LPTask, status: ReturnType<LPRendererDeps['getStatus']>): string {
    if (task.status === status.SUBMITTED) return 'status-applied';
    if (task.status === status.REQUESTED) return 'status-requested';
    if (task.status === status.APPROVED) return 'status-approved';
    if (task.status === status.RETURNED) return 'status-returned';
    return 'status-pending';
  }

  function expiryLabelOf(
    task: LPTask,
    tr: LPTranslator,
    formatDate: LPRendererDeps['formatDate'],
    parseDate: LPRendererDeps['parseDate']
  ): string {
    if (!task.expiry) return '';
    const daysUntil = daysUntilDate(task.expiry, parseDate);
    let suffix = '';
    if (daysUntil != null) {
      if (daysUntil < 0) suffix = ' 🚨';
      else if (daysUntil <= 3) suffix = ' ⚠️';
    }
    return tr('tasks.expiryLabel', { date: formatDate(task.expiry) }) + suffix;
  }

  function taskActionHtmlOf(
    task: LPTask,
    state: Pick<LPAppState, 'parentMode'>,
    status: ReturnType<LPRendererDeps['getStatus']>,
    tr: LPTranslator,
    escapeHtml: LPRendererDeps['escapeHtml']
  ): string {
    if (state.parentMode && task.status === status.SUBMITTED) {
      return '\n        <div class="task-action-group">\n' +
        '          <button class="task-btn approve-btn" data-task-id="' + escapeHtml(task.id) + '" data-action="approve">' + escapeHtml(tr('tasks.approve')) + '</button>\n' +
        '          <button class="task-btn reject-btn" data-task-id="' + escapeHtml(task.id) + '" data-action="reject">' + escapeHtml(tr('tasks.reject')) + '</button>\n' +
        '        </div>\n      ';
    }
    if (state.parentMode && task.status === status.REQUESTED) {
      return '\n        <div class="task-action-group">\n' +
        '          <button class="task-btn approve-btn" data-task-id="' + escapeHtml(task.id) + '" data-action="approve">' + escapeHtml(tr('tasks.approve')) + '</button>\n' +
        '          <button class="task-btn reject-btn" data-task-id="' + escapeHtml(task.id) + '" data-action="reject">' + escapeHtml(tr('tasks.reject')) + '</button>\n' +
        '        </div>\n      ';
    }
    if (state.parentMode && (task.status === status.PENDING || task.status === status.RETURNED)) return '';
    if (task.status === status.PENDING) {
      return '<button class="task-btn" data-task-id="' + escapeHtml(task.id) + '" data-action="apply">' + escapeHtml(tr('tasks.apply')) + '</button>';
    }
    if (task.status === status.RETURNED) {
      return '<button class="task-btn resubmit-btn" data-task-id="' + escapeHtml(task.id) + '" data-action="apply">' + escapeHtml(tr('tasks.resubmit')) + '</button>';
    }
    if (task.status === status.SUBMITTED) {
      return '<button class="task-btn withdraw-btn" data-task-id="' + escapeHtml(task.id) + '" data-action="withdraw" aria-label="' + escapeHtml(tr('tasks.withdraw')) + '">' + escapeHtml(tr('tasks.appliedBadge')) + '</button>';
    }
    if (task.status === status.REQUESTED) {
      return '<span class="task-status-badge">' + escapeHtml(tr('tasks.requestedBadge')) + '</span>';
    }
    if (task.status === status.APPROVED) {
      return '<span class="task-status-badge">' + escapeHtml(tr('tasks.approvedBadge')) + '</span>';
    }
    return '';
  }

  function pendingCountOf(items: LPTask[], status: ReturnType<LPRendererDeps['getStatus']>): number {
    return items.filter(function (t) { return t.status === status.SUBMITTED || t.status === status.REQUESTED; }).length;
  }

  function taskGroupHtml(
    key: string,
    items: LPTask[],
    context: {
      status: ReturnType<LPRendererDeps['getStatus']>;
      state: Pick<LPAppState, 'parentMode'>;
      tr: LPTranslator;
      escapeHtml: LPRendererDeps['escapeHtml'];
    },
    taskItemHtml: (task: LPTask) => string
  ): string {
    const pendingCount = pendingCountOf(items, context.status);
    const pendingBadge = pendingCount > 0 ? '<span class="task-group-badge">' + context.escapeHtml(context.tr('tasks.pendingCount', { n: pendingCount })) + '</span>' : '';
    const addBtn = '<button class="task-group-add-btn" data-action="add-category-task" data-category="' + context.escapeHtml(key) + '" aria-label="' + context.escapeHtml(context.tr('tasks.addInCategory')) + '" title="' + context.escapeHtml(context.tr('tasks.addInCategory')) + '">＋</button>';
    return '\n        <div class="task-group">\n' +
      '          <div class="task-group-head">\n' +
      '            <h3 class="task-group-title">' + context.escapeHtml(key) + pendingBadge + '</h3>\n' +
      '            ' + addBtn + '\n' +
      '          </div>\n' +
      '          <div class="task-group-items">\n' +
      '            ' + items.map(taskItemHtml).join('') + '\n' +
      '          </div>\n' +
      '        </div>\n      ';
  }

  type TaskSwipeState = {
    openTaskId: string;
    pointerId: number | null;
    startX: number;
    startY: number;
    startOpenSide: 'edit' | 'delete' | '';
    moved: boolean;
    targetItem: HTMLElement | null;
  };

  function bindSwipeHandlersForItem(options: {
    item: HTMLElement;
    taskId: string;
    coarsePointer: boolean;
    swipeState: TaskSwipeState;
    closeAllSwipeItems: (exceptTaskId: string) => void;
  }): void {
    const item = options.item;
    const taskId = options.taskId;
    const coarsePointer = options.coarsePointer;
    const swipeState = options.swipeState;
    const closeAllSwipeItems = options.closeAllSwipeItems;

    function closeSwipeItem(): void {
      item.classList.remove('is-actions-open', 'is-edit-open', 'is-delete-open');
      if (swipeState.openTaskId === taskId) swipeState.openTaskId = '';
    }

    function openEdit(): void {
      closeAllSwipeItems(taskId);
      item.classList.add('is-actions-open', 'is-edit-open');
      item.classList.remove('is-delete-open');
      swipeState.openTaskId = taskId;
    }

    function openDelete(): void {
      closeAllSwipeItems(taskId);
      item.classList.add('is-actions-open', 'is-delete-open');
      item.classList.remove('is-edit-open');
      swipeState.openTaskId = taskId;
    }

    function applyHorizontalSwipe(dx: number): void {
      if (swipeState.startOpenSide === 'edit') {
        if (dx < -SWIPE_TRIGGER_PX) closeSwipeItem();
        return;
      }
      if (swipeState.startOpenSide === 'delete') {
        if (dx > SWIPE_TRIGGER_PX) closeSwipeItem();
        return;
      }
      if (dx > SWIPE_TRIGGER_PX) {
        openEdit();
        return;
      }
      if (dx < -SWIPE_TRIGGER_PX) openDelete();
    }

    function handlePointerDown(event: PointerEvent): void {
      if (!coarsePointer) return;
      if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
      swipeState.pointerId = event.pointerId;
      swipeState.startX = event.clientX;
      swipeState.startY = event.clientY;
      if (item.classList.contains('is-edit-open')) {
        swipeState.startOpenSide = 'edit';
      } else if (item.classList.contains('is-delete-open')) {
        swipeState.startOpenSide = 'delete';
      } else {
        swipeState.startOpenSide = '';
      }
      swipeState.moved = false;
      swipeState.targetItem = item;
    }

    function handlePointerMove(event: PointerEvent): void {
      if (!coarsePointer) return;
      if (swipeState.pointerId !== event.pointerId || swipeState.targetItem !== item) return;
      const dx = event.clientX - swipeState.startX;
      const dy = event.clientY - swipeState.startY;
      if (Math.abs(dx) < SWIPE_INTENT_PX && Math.abs(dy) < SWIPE_INTENT_PX) return;
      swipeState.moved = true;
      if (Math.abs(dy) > Math.abs(dx)) return;
      applyHorizontalSwipe(dx);
    }

    function handlePointerUp(event: PointerEvent): void {
      if (!coarsePointer) return;
      if (swipeState.pointerId !== event.pointerId || swipeState.targetItem !== item) return;
      const target = event.target as Element | null;
      if (target?.closest('.task-swipe-actions')) {
        // Keep actions open while tapping edit/delete buttons.
        swipeState.pointerId = null;
        swipeState.startOpenSide = '';
        swipeState.targetItem = null;
        return;
      }
      const dx = event.clientX - swipeState.startX;
      const shouldClose = swipeState.openTaskId === taskId && (!swipeState.moved || (dx > -SWIPE_TRIGGER_PX && dx < SWIPE_TRIGGER_PX));
      if (shouldClose) {
        closeSwipeItem();
      }
      swipeState.pointerId = null;
      swipeState.startOpenSide = '';
      swipeState.targetItem = null;
    }

    item.addEventListener('pointerdown', handlePointerDown, { passive: true });
    item.addEventListener('pointermove', handlePointerMove, { passive: true });
    item.addEventListener('pointerup', handlePointerUp, { passive: true });
  }

  function create(deps: LPRendererDeps): LPRendererApi {
    const state = deps.state;
    const els = deps.els;
    const tr = deps.tr;
    const getStatus = deps.getStatus;
    const escapeHtml = deps.escapeHtml;
    const formatDate = deps.formatDate;
    const parseDate = deps.parseDate;
    const onTaskAction = deps.onTaskAction;
    const swipeState: TaskSwipeState = {
      openTaskId: '',
      pointerId: null as number | null,
      startX: 0,
      startY: 0,
      startOpenSide: '' as 'edit' | 'delete' | '',
      moved: false,
      targetItem: null as HTMLElement | null
    };
    let swipeDocumentBound = false;

    function formatRewards(task: LPTask) {
      const sub = Number(task.submitReward) || 0;
      const com = Number(task.completeReward) || Number(task.points) || 0;
      const showSub = sub > 0;
      if (showSub && com > 0) {
        return '<span class="task-points">' + escapeHtml(tr('tasks.rewardBoth', {
          submit: sub.toLocaleString(),
          complete: com.toLocaleString()
        })) + '</span>';
      }
      if (com > 0) {
        return '<span class="task-points">' + escapeHtml(tr('tasks.rewardCompleteOnly', {
          complete: com.toLocaleString()
        })) + '</span>';
      }
      if (showSub) {
        return '<span class="task-points">' + escapeHtml(tr('tasks.rewardSubmitOnly', {
          submit: sub.toLocaleString()
        })) + '</span>';
      }
      return '';
    }

    function taskItemHtml(task: LPTask) {
      const status = getStatus();
      const statusClass = statusClassOf(task, status);
      const expiryLabel = expiryLabelOf(task, tr, formatDate, parseDate);
      const actionHtml = taskActionHtmlOf(task, state, status, tr, escapeHtml);
      const requestHint = state.parentMode && task.status === status.REQUESTED
        ? '<span class="task-request-hint">' + escapeHtml(tr('tasks.requestHint')) + '</span>'
        : '';
      const canInlineEdit = state.parentMode;
      const hasInlineActions = canInlineEdit;
      const inlineActions = hasInlineActions
        ? '\n          <div class="task-edge-hover-zone is-left" aria-hidden="true"></div>\n' +
          '          <div class="task-edge-hover-zone is-right" aria-hidden="true"></div>\n' +
          '          <div class="task-swipe-actions" aria-label="' + escapeHtml(tr('tasks.edit')) + ' / ' + escapeHtml(tr('taskForm.delete')) + '">\n' +
          '            <button class="task-swipe-btn is-edit" data-task-id="' + escapeHtml(task.id) + '" data-action="edit" aria-label="' + escapeHtml(tr('tasks.edit')) + '" title="' + escapeHtml(tr('tasks.edit')) + '">✏️</button>\n' +
          '            <button class="task-swipe-btn is-delete" data-task-id="' + escapeHtml(task.id) + '" data-action="delete" aria-label="' + escapeHtml(tr('taskForm.delete')) + '" title="' + escapeHtml(tr('taskForm.delete')) + '">🗑️</button>\n' +
          '          </div>\n'
        : '';

      const parentLayoutClass = state.parentMode ? ' parent-layout' : '';
      return '\n      <div class="task-item ' + statusClass + parentLayoutClass + (hasInlineActions ? ' has-inline-actions' : '') + '" data-task-item-id="' + escapeHtml(task.id) + '">\n' +
        inlineActions +
        '        <div class="task-main">\n' +
        '          <div class="task-info">\n' +
        '          <div class="task-title">' + escapeHtml(task.title) + ' ' + requestHint + '</div>\n' +
        '          <div class="task-footer">\n' +
        '            ' + formatRewards(task) + '\n' +
        '            ' + (expiryLabel ? '<span>' + expiryLabel + '</span>' : '') + '\n' +
        '          </div>\n' +
        '          </div>\n' +
        '          <div class="task-action">' + actionHtml + '</div>\n' +
        '        </div>\n' +
        '      </div>\n    ';
    }

    function closeAllSwipeItems(exceptTaskId: string): void {
      els.tasksList.querySelectorAll<HTMLElement>('.task-item.has-inline-actions.is-actions-open').forEach(function (item) {
        if ((item.dataset.taskItemId || '') === exceptTaskId) return;
        item.classList.remove('is-actions-open', 'is-edit-open', 'is-delete-open');
      });
      if (!exceptTaskId) swipeState.openTaskId = '';
    }

    function setupTaskSwipeInteractions(): void {
      const coarsePointer = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
      els.tasksList.querySelectorAll<HTMLElement>('.task-item.has-inline-actions').forEach(function (item) {
        const taskId = item.dataset.taskItemId || '';
        if (!taskId) return;
        bindSwipeHandlersForItem({
          item: item,
          taskId: taskId,
          coarsePointer: coarsePointer,
          swipeState: swipeState,
          closeAllSwipeItems: closeAllSwipeItems
        });
      });

      if (!coarsePointer) return;
      if (!swipeDocumentBound) {
        document.addEventListener('pointerdown', function (event) {
          const target = event.target as Node | null;
          if (!target) return;
          if (els.tasksList.contains(target)) return;
          closeAllSwipeItems('');
        });
        swipeDocumentBound = true;
      }
    }

    function renderTabs() {
      const status = getStatus();
      const tab = state.activeTab;
      els.tabTasks.classList.toggle('is-active', tab === 'tasks');
      els.tabHistory.classList.toggle('is-active', tab === 'history');
      els.tabTasks.setAttribute('aria-selected', tab === 'tasks' ? 'true' : 'false');
      els.tabHistory.setAttribute('aria-selected', tab === 'history' ? 'true' : 'false');
      els.panelTasks.classList.toggle('hidden', tab !== 'tasks');
      els.panelHistory.classList.toggle('hidden', tab !== 'history');

      const targetStatus = state.parentMode ? status.SUBMITTED : status.RETURNED;
      const actionCount = state.tasks.filter(function (t) {
        if (state.parentMode) return t.status === status.SUBMITTED || t.status === status.REQUESTED;
        return t.status === targetStatus;
      }).length;
      if (actionCount > 0) {
        els.tabTasksBadge.textContent = String(actionCount);
        els.tabTasksBadge.classList.remove('hidden');
      } else {
        els.tabTasksBadge.classList.add('hidden');
      }
    }

    function renderBalance() {
      const total = sumHistoryPoints(state.history);
      els.balance.textContent = total.toLocaleString();
    }

    function renderTasks() {
      const status = getStatus();
      const addOtherButton = '<div class="tasks-bottom-actions"><button class="task-add-other-btn" data-action="add-other-task">' + escapeHtml(tr('tasks.addOther')) + '</button></div>';
      if (state.loading && state.tasks.length === 0) {
        els.tasksList.innerHTML = '<div class="empty-state is-loading">' + escapeHtml(tr('tasks.loading')) + '</div>' + addOtherButton;
        els.tasksList.querySelectorAll('[data-action="add-other-task"]').forEach(function (btn) {
          btn.addEventListener('click', onTaskAction);
        });
        return;
      }
      const visible = state.tasks;
      if (visible.length === 0) {
        els.tasksList.innerHTML = '<div class="empty-state">' + escapeHtml(tr('tasks.empty')) + '</div>' + addOtherButton;
        els.tasksList.querySelectorAll('[data-action="add-other-task"]').forEach(function (btn) {
          btn.addEventListener('click', onTaskAction);
        });
        return;
      }

      const groups = new Map<string, LPTask[]>();
      visible.forEach(function (t) {
        const key = t.category || tr('tasks.otherGroup');
        if (!groups.has(key)) groups.set(key, []);
        const bucket = groups.get(key);
        if (bucket) bucket.push(t);
      });

      const categoryNearestExpiryDays = new Map<string, number>();
      for (const key of groups.keys()) {
        const items = groups.get(key) || [];
        if (items.length === 0) {
          categoryNearestExpiryDays.set(key, Infinity);
          continue;
        }
        let nearestDays = Infinity;
        for (const item of items) {
          const daysUntil = daysUntilDate(item.expiry, parseDate);
          if (daysUntil == null) continue;
          if (daysUntil < nearestDays) nearestDays = daysUntil;
        }
        categoryNearestExpiryDays.set(key, nearestDays);
      }
      const categoryKeys = Array.from(groups.keys()).sort(function (a, b) {
        const byNearestExpiry = (categoryNearestExpiryDays.get(a) || Infinity) - (categoryNearestExpiryDays.get(b) || Infinity);
        if (byNearestExpiry !== 0) return byNearestExpiry;
        return compareTextJa(a, b);
      });
      const groupsHtml = categoryKeys.map(function (key) {
        const items = (groups.get(key) || []).slice().sort(compareTaskByTitleThenId);
        return taskGroupHtml(key, items, {
          status: status,
          state: state,
          tr: tr,
          escapeHtml: escapeHtml
        }, taskItemHtml);
      }).join('');
      els.tasksList.innerHTML = groupsHtml + addOtherButton;

      els.tasksList.querySelectorAll('[data-task-id]').forEach(function (btn) {
        btn.addEventListener('click', onTaskAction);
      });
      els.tasksList.querySelectorAll('[data-action="add-category-task"],[data-action="add-other-task"]').forEach(function (btn) {
        btn.addEventListener('click', onTaskAction);
      });
      setupTaskSwipeInteractions();
    }

    function renderHistory() {
      if (state.loading && state.history.length === 0) {
        els.historyList.innerHTML = '<div class="empty-state is-loading">' + escapeHtml(tr('history.loading')) + '</div>';
        return;
      }
      if (state.history.length === 0) {
        els.historyList.innerHTML = '<div class="empty-state">' + escapeHtml(tr('history.empty')) + '</div>';
        return;
      }
      const sorted = state.history.slice().sort(function (a, b) {
        return (b.date || '').localeCompare(a.date || '');
      });
      const display = sorted.slice(0, 100);
      els.historyList.innerHTML = display.map(function (h) {
        const pts = Number(h.points) || 0;
        const sign = pts >= 0 ? '+' : '';
        const cls = pts >= 0 ? 'positive' : 'negative';
        return '\n        <div class="history-item">\n' +
          '          <div class="history-info">\n' +
          '            <div class="history-content">' + escapeHtml(h.content || '') + '</div>\n' +
          '            <div class="history-date">' + escapeHtml(h.date || '') + '</div>\n' +
          '          </div>\n' +
          '          <div class="history-points ' + cls + '">' + sign + pts.toLocaleString() + '</div>\n' +
          '        </div>\n      ';
      }).join('');
    }

    function render() {
      const total = sumHistoryPoints(state.history);
      // Hide both action buttons until the first data load completes — otherwise
      // the bonus button (no balance gate) renders immediately while cashout
      // (gated on total > 0) only appears after the network round-trip.
      const balanceReady = !(state.loading && state.history.length === 0);
      els.cashoutBtn.classList.toggle('hidden', !state.parentMode || !balanceReady || total <= 0);
      els.bonusBtn.classList.toggle('hidden', !state.parentMode || !balanceReady);
      els.taskUpsertOpenBtn.classList.add('hidden');
      if (state.user && !state.needsUserSelection) {
        const name = deps.labelOf(state.user);
        const key = state.parentMode ? 'header.currentParent' : 'header.currentKid';
        els.userLabel.textContent = tr(key, { name: name });
        els.userLabel.classList.add('is-switchable');
        els.userLabel.classList.remove('hidden');
        document.title = state.parentMode
          ? tr('app.docTitleParent')
          : tr('app.docTitleKid', { name: name });
      } else {
        els.userLabel.classList.remove('is-switchable');
        els.userLabel.classList.add('hidden');
        document.title = tr('app.title');
      }
      renderBalance();
      renderTasks();
      renderHistory();
      renderTabs();
    }

    return {
      render: render,
      renderTabs: renderTabs,
      renderBalance: renderBalance,
      renderTasks: renderTasks,
      renderHistory: renderHistory
    };
  }

  window.LESSERPAY_RENDER = { create: create };
})();
