(function () {
  'use strict';

  type I18nDict = Record<string, unknown>;
  type I18nVars = Record<string, string | number>;
  type TranslateFn = (key: string, vars?: I18nVars) => string;

  function applyI18nAttributes(el: HTMLElement, tr: TranslateFn): void {
    Array.from(el.attributes).forEach(function (attr) {
      if (!attr.name.startsWith('data-i18n-attr-')) return;
      const targetAttr = attr.name.slice('data-i18n-attr-'.length);
      el.setAttribute(targetAttr, tr(attr.value));
    });
  }

  function create(strings?: I18nDict): LPI18nApi {
    const dict = strings || {};

    function tr(key: string, vars?: I18nVars): string {
      const value = key.split('.').reduce<unknown>((obj, part) => {
        if (!obj || typeof obj !== 'object') return undefined;
        return (obj as Record<string, unknown>)[part];
      }, dict);
      if (typeof value !== 'string') return key;
      if (!vars) return value;
      return value.replace(/\{(\w+)\}/g, function (_, name) {
        return vars[name] != null ? String(vars[name]) : '';
      });
    }

    function applyI18n(root?: ParentNode): void {
      const targetRoot = root || document;
      targetRoot.querySelectorAll<HTMLElement>('[data-i18n]').forEach(function (el) {
        const key = el.dataset.i18n;
        if (!key) return;
        el.textContent = tr(key);
      });
      targetRoot.querySelectorAll<HTMLElement>('*').forEach(function (el) {
        applyI18nAttributes(el, tr);
      });
    }

    return { tr: tr, applyI18n: applyI18n };
  }

  window.LESSERPAY_I18N = { create: create };
})();
