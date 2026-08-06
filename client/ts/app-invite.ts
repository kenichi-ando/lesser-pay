/// <reference path="./global.d.ts" />
/**
 * Locked-screen invite code UI (pre-auth bootstrap).
 */

function showInviteError(error: HTMLElement, message: string) {
  error.textContent = message;
  error.classList.remove('hidden');
}

function clearInviteError(error: HTMLElement) {
  error.classList.add('hidden');
}

function scheduleInputFocus(input: HTMLInputElement) {
  setTimeout(function () { input.focus(); }, 50);
}

function closeInviteModal(modal: HTMLElement) {
  modal.classList.add('hidden');
}

function openInviteModal(modal: HTMLElement, input: HTMLInputElement, error: HTMLElement) {
  clearInviteError(error);
  modal.classList.remove('hidden');
  scheduleInputFocus(input);
}

function normalizeInviteCode(value: string) {
  return (value || '').trim().toUpperCase();
}

function getInviteModalElements(modal: HTMLElement): {
  modalTitle: HTMLElement | null;
  modalDesc: HTMLElement | null;
  input: HTMLInputElement | null;
  submit: HTMLButtonElement | null;
  cancel: HTMLButtonElement | null;
  error: HTMLElement | null;
} {
  return {
    modalTitle: modal.querySelector('.modal-title') as HTMLElement | null,
    modalDesc: modal.querySelector('.modal-desc') as HTMLElement | null,
    input: modal.querySelector('#invite-token-input') as HTMLInputElement | null,
    submit: modal.querySelector('#invite-submit-btn') as HTMLButtonElement | null,
    cancel: modal.querySelector('#invite-cancel-btn') as HTMLButtonElement | null,
    error: modal.querySelector('#invite-error') as HTMLElement | null
  };
}

export interface InviteLockDeps {
  CONFIG: Pick<LPConfig, 'API_URL' | 'INVITE_CODE_LENGTH' | 'INVITE_CODE_PATTERN'>;
  store: Pick<LPStoreApi, 'setApiToken'>;
  tr: LPTranslator;
  withBusy: LPWithBusy;
}

export function createInviteLock(deps: InviteLockDeps) {
  const CONFIG = deps.CONFIG;
  const store = deps.store;
  const tr = deps.tr;
  const withBusy = deps.withBusy;

  function isValidInviteCode(value: string) {
    const code = normalizeInviteCode(value);
    return CONFIG.INVITE_CODE_PATTERN.test(code);
  }

  async function redeemInviteCode(code: string): Promise<{ ok: true; apiToken: string } | { ok: false; status: number }> {
    const res = await fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'redeemInvite', code: code })
    });
    let data: { ok?: boolean; apiToken?: string } | null = null;
    try {
      data = await res.json();
    } catch (err) {
      console.warn('redeemInvite response parse failed', err);
    }
    if (!res.ok || !data || !data.ok || typeof data.apiToken !== 'string') {
      return { ok: false, status: res.status };
    }
    return { ok: true, apiToken: data.apiToken };
  }

  async function submitInviteCode(
    code: string,
    submitBtn: HTMLButtonElement,
    error: HTMLElement
  ) {
    await withBusy(submitBtn, { label: tr('locked.submitting') }, async function () {
      const redeemed = await redeemInviteCode(code);
      if (!redeemed.ok) {
        showInviteError(
          error,
          redeemed.status === 401 ? tr('locked.invalidCode') : tr('errors.network') + ' (' + redeemed.status + ')'
        );
        return;
      }
      store.setApiToken(redeemed.apiToken);
      location.reload();
    });
  }

  function applyLockedPanelTexts(
    lockedTitle: HTMLElement,
    lockedDesc: HTMLElement,
    lockedOpen: HTMLButtonElement
  ) {
    lockedTitle.textContent = tr('locked.title');
    lockedDesc.textContent = tr('locked.desc');
    lockedOpen.textContent = tr('locked.openInput');
  }

  function applyInviteModalTexts(
    modalTitle: HTMLElement,
    modalDesc: HTMLElement,
    input: HTMLInputElement,
    cancel: HTMLButtonElement,
    submit: HTMLButtonElement
  ) {
    modalTitle.textContent = tr('locked.openInput');
    modalDesc.textContent = tr('locked.inputLabel', { n: CONFIG.INVITE_CODE_LENGTH });
    input.placeholder = tr('locked.inputPlaceholder');
    cancel.textContent = tr('locked.cancel');
    submit.textContent = tr('locked.submit');
  }

  function createLockedPanelAndModal() {
    const panel = document.createElement('div');
    panel.id = 'app-locked';
    panel.className = 'locked-panel';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'locked-mascot');
    svg.setAttribute('width', '80');
    svg.setAttribute('height', '80');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#lesser-panda');
    svg.appendChild(use);

    const title = document.createElement('h2');
    title.className = 'locked-title';

    const desc = document.createElement('p');
    desc.className = 'locked-desc';

    const openButton = document.createElement('button');
    openButton.id = 'locked-token-open';
    openButton.className = 'btn btn-primary';
    openButton.type = 'button';

    const modal = document.createElement('div');
    modal.id = 'invite-modal';
    modal.className = 'modal hidden';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const modalContent = document.createElement('div');
    modalContent.className = 'modal-content';

    const modalTitle = document.createElement('h3');
    modalTitle.className = 'modal-title';

    const modalDesc = document.createElement('p');
    modalDesc.className = 'modal-desc';

    const input = document.createElement('input');
    input.id = 'invite-token-input';
    input.className = 'modal-input';
    input.type = 'text';
    input.autocomplete = 'off';
    input.autocapitalize = 'characters';
    input.spellcheck = false;
    input.maxLength = CONFIG.INVITE_CODE_LENGTH;
    input.style.textTransform = 'uppercase';

    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    const cancel = document.createElement('button');
    cancel.id = 'invite-cancel-btn';
    cancel.className = 'btn btn-secondary';
    cancel.type = 'button';

    const submit = document.createElement('button');
    submit.id = 'invite-submit-btn';
    submit.className = 'btn btn-primary';
    submit.type = 'button';

    const error = document.createElement('div');
    error.id = 'invite-error';
    error.className = 'modal-error hidden';

    actions.appendChild(cancel);
    actions.appendChild(submit);
    modalContent.appendChild(modalTitle);
    modalContent.appendChild(modalDesc);
    modalContent.appendChild(input);
    modalContent.appendChild(actions);
    modalContent.appendChild(error);
    modal.appendChild(modalContent);

    panel.appendChild(svg);
    panel.appendChild(title);
    panel.appendChild(desc);
    panel.appendChild(openButton);
    document.body.appendChild(panel);
    document.body.appendChild(modal);
  }

  function ensureLockedUiElements(): {
    panel: HTMLElement;
    modal: HTMLElement;
    lockedTitle: HTMLElement;
    lockedDesc: HTMLElement;
    lockedOpen: HTMLButtonElement;
    modalTitle: HTMLElement;
    modalDesc: HTMLElement;
    input: HTMLInputElement;
    submit: HTMLButtonElement;
    cancel: HTMLButtonElement;
    error: HTMLElement;
  } | null {
    if (!document.getElementById('app-locked')) {
      createLockedPanelAndModal();
    }
    const panel = document.getElementById('app-locked') as HTMLElement | null;
    if (!panel) return null;
    const lockedTitle = panel.querySelector('.locked-title') as HTMLElement | null;
    const lockedDesc = panel.querySelector('.locked-desc') as HTMLElement | null;
    const lockedOpen = panel.querySelector('#locked-token-open') as HTMLButtonElement | null;
    const modal = document.getElementById('invite-modal') as HTMLElement | null;
    if (!lockedTitle || !lockedDesc || !lockedOpen || !modal) return null;

    const { modalTitle, modalDesc, input, submit, cancel, error } = getInviteModalElements(modal);
    if (!modalTitle || !modalDesc || !input || !submit || !cancel || !error) return null;
    return {
      panel: panel,
      modal: modal,
      lockedTitle: lockedTitle,
      lockedDesc: lockedDesc,
      lockedOpen: lockedOpen,
      modalTitle: modalTitle,
      modalDesc: modalDesc,
      input: input,
      submit: submit,
      cancel: cancel,
      error: error
    };
  }

  function bindInviteModalHandlers(
    lockedOpen: HTMLButtonElement,
    modal: HTMLElement,
    input: HTMLInputElement,
    submit: HTMLButtonElement,
    cancel: HTMLButtonElement,
    error: HTMLElement
  ) {
    const redeemInvite = async function () {
      const code = normalizeInviteCode(input.value || '');
      if (!code) {
        showInviteError(error, tr('locked.invalid'));
        return;
      }
      if (!isValidInviteCode(code)) {
        showInviteError(error, tr('locked.invalidLength', { n: CONFIG.INVITE_CODE_LENGTH }));
        return;
      }
      try {
        await submitInviteCode(code, submit, error);
      } catch (err) {
        console.warn('redeemInvite request failed', err);
        showInviteError(error, tr('errors.network'));
      }
    };

    lockedOpen.onclick = function () {
      openInviteModal(modal, input, error);
    };
    submit.onclick = redeemInvite;
    cancel.onclick = function () { closeInviteModal(modal); };
    modal.onclick = function (e: MouseEvent) {
      if (e.target === modal) closeInviteModal(modal);
    };
    input.onkeydown = function (e: KeyboardEvent) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      redeemInvite();
    };
    input.oninput = function () { clearInviteError(error); };
  }

  function renderLocked() {
    const main = document.querySelector('.app-main');
    const header = document.querySelector('.app-header');
    if (header) header.classList.add('hidden');
    if (main) main.classList.add('hidden');
    const ui = ensureLockedUiElements();
    if (!ui) return;

    applyLockedPanelTexts(ui.lockedTitle, ui.lockedDesc, ui.lockedOpen);
    applyInviteModalTexts(ui.modalTitle, ui.modalDesc, ui.input, ui.cancel, ui.submit);
    bindInviteModalHandlers(ui.lockedOpen, ui.modal, ui.input, ui.submit, ui.cancel, ui.error);
    ui.panel.classList.remove('hidden');
  }

  return { renderLocked };
}
