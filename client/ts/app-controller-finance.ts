/// <reference path="./global.d.ts" />
/**
 * Cashout and bonus (parent finance) modal flows.
 */
import { celebrateBalance } from './app-fx';
import {
  buildModalErrorHandler,
  failWithError,
  hideFormModal,
  isPositiveNumber,
  makeModalSubmitConfig,
  openFormModal,
  runModalSubmit,
  type ApiPayloadValue,
  type ModalSubmitConfig,
  type WithBusy,
} from './app-modal-helpers';

type ModalApiAction = 'cashout' | 'grantBonus';

export interface FinanceActionsDeps {
  state: Pick<LPAppState, 'parentPin' | 'history'>;
  els: Pick<
    LPElements,
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
  >;
  tr: LPTranslator;
  withBusy: WithBusy;
  api: (action: ModalApiAction, payload: Record<string, ApiPayloadValue>) => Promise<unknown>;
  clearDataCache: () => void;
  loadData: (force: boolean) => Promise<void>;
  askConfirm: (message: string) => Promise<boolean>;
  toast: (message: string, kind?: string) => void;
  sound: Pick<LPSoundController, 'play'>;
}

export function createFinanceActions(deps: FinanceActionsDeps) {
  const state = deps.state;
  const els = deps.els;
  const tr = deps.tr;
  const sound = deps.sound;
  let cashoutSubmitting = false;
  let bonusSubmitting = false;

  function getTotalHistoryPoints(): number {
    return state.history.reduce(function (sum, history) {
      return sum + (Number(history.points) || 0);
    }, 0);
  }

  function buildCashoutSubmitConfig(amount: number, memo: string): ModalSubmitConfig {
    return makeModalSubmitConfig({
      submitButton: els.cashoutSubmit,
      processingKey: 'cashout.processing',
      apiAction: 'cashout',
      payload: function () { return { amount: amount, memo: memo, pin: state.parentPin }; },
      onSuccess: function () {
        sound.play('cashout');
        celebrateBalance({ toastMessage: tr('cashout.toast', { amount: amount }), toast: deps.toast });
      },
      onError: buildModalErrorHandler(els.cashoutError)
    });
  }

  function buildBonusSubmitConfig(label: string, amount: number): ModalSubmitConfig {
    return makeModalSubmitConfig({
      submitButton: els.bonusSubmit,
      processingKey: 'bonus.processing',
      apiAction: 'grantBonus',
      payload: function () { return { label: label, amount: amount, pin: state.parentPin }; },
      onSuccess: function () {
        sound.play('approve');
        celebrateBalance({ withLogo: true, toastMessage: tr('bonus.toast', { amount: amount }), toast: deps.toast });
      },
      onError: buildModalErrorHandler(els.bonusError)
    });
  }

  return {
    openCashoutModal: function (): void {
      const total = getTotalHistoryPoints();
      els.cashoutAmount.value = total > 0 ? String(total) : '';
      els.cashoutMemo.value = '';
      els.cashoutBalance.textContent = tr('cashout.balance', { total: total.toLocaleString() });
      openFormModal(els.cashoutModal, els.cashoutError, els.cashoutAmount);
    },
    submitCashout: async function (): Promise<void> {
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
      if (!await deps.askConfirm(tr('cashout.confirm', { amount: amount }))) return;
      hideFormModal(els.cashoutModal, els.cashoutError);
      cashoutSubmitting = true;
      try {
        await runModalSubmit(
          deps.withBusy,
          tr,
          deps.api,
          deps.clearDataCache,
          deps.loadData,
          buildCashoutSubmitConfig(amount, memo)
        );
      } catch {
        els.cashoutModal.classList.remove('hidden');
      } finally {
        cashoutSubmitting = false;
      }
    },
    openBonusModal: function (): void {
      els.bonusLabel.value = '';
      els.bonusAmount.value = '';
      openFormModal(els.bonusModal, els.bonusError, els.bonusAmount);
    },
    submitBonus: async function (): Promise<void> {
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
      if (!await deps.askConfirm(tr('bonus.confirm', { label: label, amount: amount }))) return;
      hideFormModal(els.bonusModal, els.bonusError);
      bonusSubmitting = true;
      try {
        await runModalSubmit(
          deps.withBusy,
          tr,
          deps.api,
          deps.clearDataCache,
          deps.loadData,
          buildBonusSubmitConfig(label, amount)
        );
      } catch {
        els.bonusModal.classList.remove('hidden');
      } finally {
        bonusSubmitting = false;
      }
    }
  };
}
