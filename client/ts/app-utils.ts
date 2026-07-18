/// <reference path="./global.d.ts" />

type UtilsTranslator = LPTranslator;
type UtilsBusyElement = HTMLElement;
type UtilsBusyNode = UtilsBusyElement | null | undefined;
type UtilsBusyTargets = UtilsBusyNode | UtilsBusyNode[];

interface UtilsBusyOptions {
  label?: string;
  labelNode?: HTMLElement | null;
}

function consumeUtilsError(_error: unknown): void {
  if (_error === undefined) return;
}

function replaceHyphenWithSlash(value: string): string {
  let out = '';
  for (const ch of value) {
    out += ch === '-' ? '/' : ch;
  }
  return out;
}

function unknownToText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'bigint' || typeof value === 'symbol') {
    return String(value);
  }
  if (value instanceof Date) return String(value);
  try {
    const json = JSON.stringify(value);
    return json ?? '';
  } catch (err) {
    consumeUtilsError(err);
    return '';
  }
}

function escapeHtmlText(value: unknown): string {
  return unknownToText(value).replace(/[&<>"']/g, function (ch) {
    const escaped: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return escaped[ch] || ch;
  });
}

function parseDateValue(source: unknown): Date | null {
  if (!source) return null;
  if (source instanceof Date || typeof source === 'number') {
    const dateFromValue = new Date(source);
    return Number.isNaN(dateFromValue.getTime()) ? null : dateFromValue;
  }
  if (typeof source !== 'string') return null;
  const normalized = replaceHyphenWithSlash(source);
  const normalizedDate = new Date(normalized);
  if (!Number.isNaN(normalizedDate.getTime())) return normalizedDate;
  const fallbackDate = new Date(source);
  return Number.isNaN(fallbackDate.getTime()) ? null : fallbackDate;
}

async function withBusyState<T>(targets: UtilsBusyTargets, task: () => Promise<T>, options: UtilsBusyOptions = {}): Promise<T> {
  const opts = options;
  const nodes = (Array.isArray(targets) ? targets : [targets]).filter(
    (node): node is UtilsBusyElement => Boolean(node)
  );
  const states = nodes.map(function (node) {
    return {
      node: node,
      disabled: (node as HTMLButtonElement).disabled,
      ariaBusy: node.getAttribute('aria-busy')
    };
  });
  const labelNode = opts.labelNode || nodes[0] || null;
  const hasLabel = typeof opts.label === 'string';
  const originalLabel = hasLabel && labelNode ? labelNode.textContent : '';

  states.forEach(function (state) {
    if ('disabled' in (state.node as object)) {
      (state.node as HTMLButtonElement).disabled = true;
    }
    state.node.classList.add('is-loading');
    state.node.setAttribute('aria-busy', 'true');
  });
  if (hasLabel && labelNode) labelNode.textContent = opts.label || '';

  try {
    return await task();
  } finally {
    states.forEach(function (state) {
      if ('disabled' in (state.node as object)) {
        (state.node as HTMLButtonElement).disabled = state.disabled;
      }
      state.node.classList.remove('is-loading');
      if (state.ariaBusy == null) state.node.removeAttribute('aria-busy');
      else state.node.setAttribute('aria-busy', state.ariaBusy);
    });
    if (hasLabel && labelNode) labelNode.textContent = originalLabel;
  }
}

(function () {
  'use strict';

  function create(_options: { tr: UtilsTranslator }): LPUtilsApi {

    function formatDate(source: unknown): string {
      const date = parseDateValue(source);
      if (!date) return unknownToText(source);
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      const today = new Date();
      const sameYear = date.getFullYear() === today.getFullYear();
      // Show a kid-friendly short form by default.
      if (sameYear) return m + '/' + d;
      return date.getFullYear() + '/' + m + '/' + d;
    }

    function isExpired(source: unknown): boolean {
      const date = parseDateValue(source);
      if (!date) return false;
      date.setHours(0, 0, 0, 0);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return date < today;
    }

    return {
      escapeHtml: escapeHtmlText,
      parseDate: parseDateValue,
      formatDate: formatDate,
      isExpired: isExpired,
      withBusy: function <T>(targets: UtilsBusyTargets, options: UtilsBusyOptions | undefined, task: () => Promise<T>) {
        return withBusyState(targets, task, options || {});
      }
    };
  }

  window.LESSERPAY_UTILS = { create: create };
})();
