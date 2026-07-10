(function () {
  'use strict';

  interface I18nDict {
    [key: string]: string | I18nDict;
  }
  type I18nVars = Record<string, string | number>;

  interface I18nApi {
    tr: (key: string, vars?: I18nVars) => string;
    applyI18n: (root?: ParentNode) => void;
  }

  function create(strings?: I18nDict): I18nApi {
    const dict = strings || {};

    function tr(key: string, vars?: I18nVars): string {
      const value = key.split('.').reduce<string | I18nDict | undefined>((obj, part) => {
        if (obj == null || typeof obj === 'string') return undefined;
        return obj[part];
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
        const key = el.getAttribute('data-i18n');
        if (!key) return;
        el.textContent = tr(key);
      });
      targetRoot.querySelectorAll<HTMLElement>('*').forEach(function (el) {
        Array.from(el.attributes).forEach(function (attr) {
          if (!attr.name.startsWith('data-i18n-attr-')) return;
          const targetAttr = attr.name.slice('data-i18n-attr-'.length);
          el.setAttribute(targetAttr, tr(attr.value));
        });
      });
    }

    return { tr: tr, applyI18n: applyI18n };
  }

  (window as any).LESSERPAY_I18N = { create: create };
})();
