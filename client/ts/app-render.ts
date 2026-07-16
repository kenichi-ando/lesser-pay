/// <reference path="./global.d.ts" />
(function () {
  'use strict';

  function sumHistoryPoints(history: LPHistoryItem[]): number {
    return history.reduce(function (sum, h) { return sum + (Number(h.points) || 0); }, 0);
  }

  function statusClassOf(task: LPTask, status: ReturnType<LPRendererDeps['getStatus']>): string {
    if (task.status === status.SUBMITTED) return 'status-applied';
    if (task.status === status.APPROVED) return 'status-approved';
    if (task.status === status.RETURNED) return 'status-returned';
    return 'status-pending';
  }

  function expiryLabelOf(
    task: LPTask,
    tr: LPTranslator,
    formatDate: LPRendererDeps['formatDate'],
    isExpired: LPRendererDeps['isExpired']
  ): string {
    if (!task.expiry) return '';
    const expired = isExpired(task.expiry);
    return tr('tasks.expiryLabel', { date: formatDate(task.expiry) }) + (expired ? ' ⚠️' : '');
  }

  function taskActionHtmlOf(
    task: LPTask,
    state: Pick<LPAppState, 'parentMode'>,
    status: ReturnType<LPRendererDeps['getStatus']>,
    tr: LPTranslator,
    escapeHtml: LPRendererDeps['escapeHtml'],
    expired: boolean
  ): string {
    if (state.parentMode && task.status === status.SUBMITTED) {
      return '\n        <div class="task-action-group">\n' +
        '          <button class="task-btn approve-btn" data-task-id="' + escapeHtml(task.id) + '" data-action="approve">' + escapeHtml(tr('tasks.approve')) + '</button>\n' +
        '          <button class="task-btn reject-btn" data-task-id="' + escapeHtml(task.id) + '" data-action="reject">' + escapeHtml(tr('tasks.reject')) + '</button>\n' +
        '        </div>\n      ';
    }
    if (state.parentMode && (task.status === status.PENDING || task.status === status.RETURNED)) return '';
    if (task.status === status.PENDING) {
      return '<button class="task-btn" data-task-id="' + escapeHtml(task.id) + '" data-action="apply" ' + (expired ? 'disabled' : '') + '>' + escapeHtml(tr('tasks.apply')) + '</button>';
    }
    if (task.status === status.RETURNED) {
      return '<button class="task-btn resubmit-btn" data-task-id="' + escapeHtml(task.id) + '" data-action="apply" ' + (expired ? 'disabled' : '') + '>' + escapeHtml(tr('tasks.resubmit')) + '</button>';
    }
    if (task.status === status.SUBMITTED) {
      return '<button class="task-btn withdraw-btn" data-task-id="' + escapeHtml(task.id) + '" data-action="withdraw" aria-label="' + escapeHtml(tr('tasks.withdraw')) + '">' + escapeHtml(tr('tasks.appliedBadge')) + '</button>';
    }
    if (task.status === status.APPROVED) {
      return '<span class="task-status-badge">' + escapeHtml(tr('tasks.approvedBadge')) + '</span>';
    }
    return '';
  }

  function pendingCountOf(items: LPTask[], status: ReturnType<LPRendererDeps['getStatus']>): number {
    return items.filter(function (t) { return t.status === status.SUBMITTED; }).length;
  }

  function totalMinutesOf(items: LPTask[], status: ReturnType<LPRendererDeps['getStatus']>): number {
    return items
      .filter(function (t) { return t.status !== status.APPROVED && t.status !== status.SUBMITTED; })
      .reduce(function (sum, t) { return sum + (Number(t.minutes) || 0); }, 0);
  }

  function taskGroupHtml(
    key: string,
    items: LPTask[],
    status: ReturnType<LPRendererDeps['getStatus']>,
    tr: LPTranslator,
    escapeHtml: LPRendererDeps['escapeHtml'],
    formatMinutes: LPRendererDeps['formatMinutes'],
    taskItemHtml: (task: LPTask) => string
  ): string {
    const pendingCount = pendingCountOf(items, status);
    const pendingBadge = pendingCount > 0 ? '<span class="task-group-badge">' + escapeHtml(tr('tasks.pendingCount', { n: pendingCount })) + '</span>' : '';
    const totalMinutes = totalMinutesOf(items, status);
    const timeBadge = totalMinutes > 0 ? '<span class="task-group-time">⏱ ' + escapeHtml(formatMinutes(totalMinutes)) + '</span>' : '';
    return '\n        <div class="task-group">\n' +
      '          <h3 class="task-group-title">' + escapeHtml(key) + timeBadge + pendingBadge + '</h3>\n' +
      '          <div class="task-group-items">\n' +
      '            ' + items.map(taskItemHtml).join('') + '\n' +
      '          </div>\n' +
      '        </div>\n      ';
  }

  function create(deps: LPRendererDeps): LPRendererApi {
    const state = deps.state;
    const els = deps.els;
    const tr = deps.tr;
    const getStatus = deps.getStatus;
    const escapeHtml = deps.escapeHtml;
    const formatMinutes = deps.formatMinutes;
    const formatDate = deps.formatDate;
    const isExpired = deps.isExpired;
    const onTaskAction = deps.onTaskAction;

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
      const expired = isExpired(task.expiry);
      const expiryLabel = expiryLabelOf(task, tr, formatDate, isExpired);
      const actionHtml = taskActionHtmlOf(task, state, status, tr, escapeHtml, expired);

      return '\n      <div class="task-item ' + statusClass + '">\n' +
        '        <div class="task-info">\n' +
        '          <div class="task-title">' + escapeHtml(task.title) + '</div>\n' +
        '          <div class="task-footer">\n' +
        '            ' + formatRewards(task) + '\n' +
        '            ' + (task.minutes ? '<span class="task-minutes">⏱ ' + escapeHtml(formatMinutes(task.minutes)) + '</span>' : '') + '\n' +
        '            ' + (expiryLabel ? '<span>' + expiryLabel + '</span>' : '') + '\n' +
        '          </div>\n' +
        '        </div>\n' +
        '        <div class="task-action">' + actionHtml + '</div>\n' +
        '      </div>\n    ';
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
      const actionCount = state.tasks.filter(function (t) { return t.status === targetStatus; }).length;
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
      if (state.loading && state.tasks.length === 0) {
        els.tasksList.innerHTML = '<div class="empty-state is-loading">' + escapeHtml(tr('tasks.loading')) + '</div>';
        return;
      }
      const visible = state.tasks;
      if (visible.length === 0) {
        els.tasksList.innerHTML = '<div class="empty-state">' + escapeHtml(tr('tasks.empty')) + '</div>';
        return;
      }

      const groups = new Map<string, LPTask[]>();
      visible.forEach(function (t) {
        const key = t.category || tr('tasks.otherGroup');
        if (!groups.has(key)) groups.set(key, []);
        const bucket = groups.get(key);
        if (bucket) bucket.push(t);
      });

      const sortedKeys = Array.from(groups.keys());
      els.tasksList.innerHTML = sortedKeys.map(function (key) {
        const items = groups.get(key) || [];
        return taskGroupHtml(key, items, status, tr, escapeHtml, formatMinutes, taskItemHtml);
      }).join('');

      els.tasksList.querySelectorAll('[data-task-id]').forEach(function (btn) {
        btn.addEventListener('click', onTaskAction);
      });
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
