(function () {
  'use strict';

  function create(deps) {
    const state = deps.state;
    const els = deps.els;
    const tr = deps.tr;
    const sound = window.LESSERPAY_SOUND || { play: function () {} };
    const withBusy = deps.withBusy;

    function flashRow(btn) {
      const row = btn && btn.closest ? btn.closest('.task-item') : null;
      if (!row) return;
      row.classList.remove('is-flash');
      // force reflow so the animation restarts on repeated triggers
      void row.offsetWidth;
      row.classList.add('is-flash');
      setTimeout(function () { row.classList.remove('is-flash'); }, 1000);
    }

    function popBalance() {
      const node = document.querySelector('.balance-number');
      if (node) {
        node.classList.remove('is-pop');
        void node.offsetWidth;
        node.classList.add('is-pop');
        setTimeout(function () { node.classList.remove('is-pop'); }, 800);
      }
      const card = document.querySelector('.balance-card');
      if (card) {
        card.classList.remove('is-glow');
        void card.offsetWidth;
        card.classList.add('is-glow');
        setTimeout(function () { card.classList.remove('is-glow'); }, 1000);
      }
    }

    function cheerLogo() {
      const node = document.querySelector('.app-logo');
      if (!node) return;
      node.classList.remove('is-cheer');
      void node.offsetWidth;
      node.classList.add('is-cheer');
      setTimeout(function () { node.classList.remove('is-cheer'); }, 700);
    }

    function confettiBurst(originEl) {
      if (!originEl) return;
      const rect = originEl.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const layer = document.createElement('div');
      layer.className = 'confetti-burst';
      layer.style.left = cx + 'px';
      layer.style.top = cy + 'px';
      const emojis = ['✨', '🎉', '⭐', '🎊', '💫', '🎈', '🌟', '🐾'];
      const N = 24;
      for (let i = 0; i < N; i++) {
        const span = document.createElement('span');
        span.className = 'confetti-piece';
        span.textContent = emojis[i % emojis.length];
        const angle = (Math.PI * 2 * i) / N + Math.random() * 0.4;
        const dist = 120 + Math.random() * 80;
        span.style.setProperty('--cx', Math.cos(angle) * dist + 'px');
        span.style.setProperty('--cy', Math.sin(angle) * dist + 'px');
        span.style.setProperty('--cr', (Math.random() * 720 - 360) + 'deg');
        span.style.animationDelay = (Math.random() * 80) + 'ms';
        layer.appendChild(span);
      }
      document.body.appendChild(layer);
      setTimeout(function () { layer.remove(); }, 1700);
    }

    function toast(msg, kind) {
      const kindName = kind || '';
      els.toast.textContent = msg;
      els.toast.className = 'toast' + (kindName ? ' toast-' + kindName : '');
      els.toast.classList.remove('hidden');
      clearTimeout(toast._t);
      toast._t = setTimeout(function () {
        els.toast.classList.add('hidden');
      }, 2800);
    }

    function taskButtons(id) {
      return Array.from(document.querySelectorAll('[data-task-id]')).filter(function (node) {
        return node.dataset.taskId === id;
      });
    }

    function setTaskStatusById(id, nextStatus) {
      const targetId = String(id);
      for (let i = 0; i < state.tasks.length; i++) {
        if (String(state.tasks[i].id) === targetId) {
          state.tasks[i].status = nextStatus;
          return;
        }
      }
    }

    async function runTaskAction(btn, id, config) {
      if (!confirm(tr(config.confirmKey))) return;
      try {
        await withBusy(taskButtons(id), { label: tr('tasks.processing'), labelNode: btn }, async function () {
          const payload = { taskId: id };
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
      } catch (err) {
        sound.play('error');
        toast(err.message, 'error');
      }
    }

    async function runModalSubmit(config) {
      try {
        await withBusy(config.submitButton, { label: tr(config.processingKey) }, async function () {
          await deps.api(config.apiAction, config.payload());
          config.onSuccess();
          deps.clearDataCache();
          await deps.loadData(true);
        });
      } catch (err) {
        config.onError(err);
      }
    }

    async function onTaskAction(e) {
      const btn = e.currentTarget;
      const id = btn.dataset.taskId;
      const action = btn.dataset.action;
      if (action === 'apply') {
        await runTaskAction(btn, id, {
          confirmKey: 'tasks.confirmApply',
          apiAction: 'applyTask',
          successStatus: 'Submitted',
          soundKey: 'apply',
          toastKey: 'tasks.toastApplied',
          toastKind: 'success'
        });
        return;
      }
      if (action === 'approve') {
        await runTaskAction(btn, id, {
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
        });
        return;
      }
      if (action === 'reject') {
        await runTaskAction(btn, id, {
          confirmKey: 'tasks.confirmReject',
          apiAction: 'rejectTask',
          requiresPin: true,
          successStatus: 'Returned',
          soundKey: 'reject',
          toastKey: 'tasks.toastRejected'
        });
        return;
      }
      if (action === 'withdraw') {
        await runTaskAction(btn, id, {
          confirmKey: 'tasks.confirmWithdraw',
          apiAction: 'withdrawTask',
          successStatus: 'Pending',
          soundKey: 'reject',
          toastKey: 'tasks.toastWithdrawn'
        });
      }
    }

    function openCashoutModal() {
      const total = state.history.reduce(function (s, h) { return s + (Number(h.points) || 0); }, 0);
      els.cashoutAmount.value = total > 0 ? String(total) : '';
      els.cashoutBalance.textContent = tr('cashout.balance', { total: total.toLocaleString() });
      els.cashoutError.classList.add('hidden');
      els.cashoutModal.classList.remove('hidden');
      setTimeout(function () { els.cashoutAmount.focus(); }, 50);
    }

    async function submitCashout() {
      const amount = parseInt(els.cashoutAmount.value, 10);
      if (!amount || amount <= 0) {
        els.cashoutError.textContent = tr('cashout.invalid');
        els.cashoutError.classList.remove('hidden');
        return;
      }
      const total = state.history.reduce(function (s, h) { return s + (Number(h.points) || 0); }, 0);
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
        onError: function (err) {
          els.cashoutError.textContent = err.message;
          els.cashoutError.classList.remove('hidden');
        }
      });
    }

    function openBonusModal() {
      els.bonusLabel.value = '';
      els.bonusAmount.value = '';
      els.bonusError.classList.add('hidden');
      els.bonusModal.classList.remove('hidden');
      setTimeout(function () { els.bonusLabel.focus(); }, 50);
    }

    async function submitBonus() {
      const label = (els.bonusLabel.value || '').trim();
      const amount = parseInt(els.bonusAmount.value, 10);
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
        onError: function (err) {
          els.bonusError.textContent = err.message;
          els.bonusError.classList.remove('hidden');
        }
      });
    }

    // Fired when loadData detects tasks that flipped Submitted → Approved
    // remotely (i.e. parent approved while the kid's app was elsewhere).
    // Mirrors the local 'approve' button celebration, anchored on the balance
    // since the task row has already been removed from the list.
    function celebrateRemoteApprovals() {
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
