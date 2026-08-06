/// <reference path="./global.d.ts" />
/**
 * Shared modal/form helpers used by task form and finance actions.
 */

export function getActionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Unknown error';
}

export function showError(node: HTMLElement, message: string): void {
  node.textContent = message;
  node.classList.remove('hidden');
}

export function clearError(node: HTMLElement): void {
  node.classList.add('hidden');
}

export function focusSoon(node: HTMLElement): void {
  setTimeout(function () { node.focus(); }, 50);
}

export function failWithError(node: HTMLElement, message: string): false {
  showError(node, message);
  return false;
}

export function buildModalErrorHandler(node: HTMLElement): (error: unknown) => void {
  return function (error: unknown): void {
    showError(node, getActionErrorMessage(error));
  };
}

export function isPositiveNumber(value: number): boolean {
  return !!value && value > 0;
}

export function openFormModal(modal: HTMLElement, error: HTMLElement, focusTarget: HTMLElement): void {
  clearError(error);
  modal.classList.remove('hidden');
  focusSoon(focusTarget);
}

export function hideFormModal(modal: HTMLElement, error: HTMLElement): void {
  clearError(error);
  modal.classList.add('hidden');
}

export type ModalApiAction = 'cashout' | 'grantBonus';
export type ApiPayloadValue = string | number | null;

export interface ModalSubmitConfig {
  submitButton: HTMLElement;
  processingKey: string;
  apiAction: ModalApiAction;
  payload: () => Record<string, ApiPayloadValue>;
  onSuccess: () => void;
  onError: (error: unknown) => void;
}

export function makeModalSubmitConfig(base: ModalSubmitConfig): ModalSubmitConfig {
  return {
    submitButton: base.submitButton,
    processingKey: base.processingKey,
    apiAction: base.apiAction,
    payload: base.payload,
    onSuccess: base.onSuccess,
    onError: base.onError
  };
}

export type WithBusy = (
  target: LPBusyTarget,
  options: { label: string; labelNode?: HTMLElement },
  action: () => Promise<void>
) => Promise<void>;

export async function runModalSubmit(
  withBusy: WithBusy,
  tr: LPTranslator,
  api: (action: ModalApiAction, payload: Record<string, ApiPayloadValue>) => Promise<unknown>,
  clearDataCache: () => void,
  loadData: (force: boolean) => Promise<void>,
  config: ModalSubmitConfig
): Promise<void> {
  try {
    await withBusy(config.submitButton, { label: tr(config.processingKey) }, async function () {
      await api(config.apiAction, config.payload());
      config.onSuccess();
      clearDataCache();
      await loadData(true);
    });
  } catch (error) {
    config.onError(error);
    throw error;
  }
}
