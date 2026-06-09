(function () {
  'use strict';

  function create(options) {
    const tr = options.tr;

    function escapeHtml(value) {
      return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
        return ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;'
        })[ch];
      });
    }

    function parseDate(source) {
      if (!source) return null;
      let date = new Date(String(source).replace(/-/g, '/'));
      if (!Number.isNaN(date.getTime())) return date;
      date = new Date(source);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    function formatDate(source) {
      const date = parseDate(source);
      if (!date) return String(source == null ? '' : source);
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return y + '/' + m + '/' + d;
    }

    function isExpired(source) {
      const date = parseDate(source);
      if (!date) return false;
      date.setHours(0, 0, 0, 0);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return date < today;
    }

    function formatMinutes(mins) {
      const m = Number(mins) || 0;
      if (m <= 0) return '';
      const h = Math.floor(m / 60);
      const r = m % 60;
      if (h > 0 && r > 0) return tr('time.hourAndMinute', { h: h, m: r });
      if (h > 0) return tr('time.hour', { h: h });
      return tr('time.minute', { m: r });
    }

    async function withBusy(targets, options, task) {
      const opts = options || {};
      const nodes = (Array.isArray(targets) ? targets : [targets]).filter(Boolean);
      const states = nodes.map(function (node) {
        return {
          node: node,
          disabled: !!node.disabled,
          ariaBusy: node.getAttribute('aria-busy')
        };
      });
      const labelNode = opts.labelNode || nodes[0] || null;
      const hasLabel = typeof opts.label === 'string';
      const originalLabel = hasLabel && labelNode ? labelNode.textContent : '';

      states.forEach(function (state) {
        state.node.disabled = true;
        state.node.classList.add('is-loading');
        state.node.setAttribute('aria-busy', 'true');
      });
      if (hasLabel && labelNode) labelNode.textContent = opts.label;

      try {
        return await task();
      } finally {
        states.forEach(function (state) {
          state.node.disabled = state.disabled;
          state.node.classList.remove('is-loading');
          if (state.ariaBusy == null) state.node.removeAttribute('aria-busy');
          else state.node.setAttribute('aria-busy', state.ariaBusy);
        });
        if (hasLabel && labelNode) labelNode.textContent = originalLabel;
      }
    }

    return {
      escapeHtml: escapeHtml,
      parseDate: parseDate,
      formatDate: formatDate,
      isExpired: isExpired,
      formatMinutes: formatMinutes,
      withBusy: withBusy
    };
  }

  window.LESSERPAY_UTILS = { create: create };
})();
