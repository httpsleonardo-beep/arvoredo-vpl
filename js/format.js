/* =====================================================================
   format.js — formatação e leitura de números no padrão brasileiro
   ===================================================================== */
window.DT = window.DT || {};
(function (DT) {
  'use strict';
  const F = {};
  const cache = {};
  function nf(d) {
    return cache[d] || (cache[d] = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));
  }
  const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

  F.dec = 2;      // casas decimais (configurável na árvore)
  F.unit = '';    // prefixo monetário (R$, US$...)

  F.num = function (x, d) {
    if (x == null || !isFinite(x)) return '—';
    const v = Math.abs(x) < 1e-10 ? 0 : x;
    return nf(d == null ? F.dec : d).format(v);
  };
  F.money = function (x, d) {
    const s = F.num(x, d);
    return F.unit && s !== '—' ? F.unit + ' ' + s : s;
  };
  F.short = function (x) {
    if (!isFinite(x)) return '—';
    if (Math.abs(x) < 1000) return nf(Math.abs(x) < 10 && x % 1 ? 1 : 0).format(x);
    return compact.format(x);
  };
  F.pct = function (p, d) {
    if (p == null || !isFinite(p)) return '—';
    return nf(d == null ? 1 : d).format(p * 100) + '%';
  };

  /** Lê número digitado: aceita "1.200,50", "1200.5", "-400", "(300)", "R$ 1.000" */
  F.parseNum = function (str) {
    if (typeof str === 'number') return str;
    let s = String(str == null ? '' : str).trim().replace(/\s/g, '').replace(/^(R\$|US\$|\$|€)/i, '');
    if (!s) return NaN;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/^(R\$|US\$|\$|€)/i, '');
    if (s[0] === '−') s = '-' + s.slice(1);
    const hasC = s.includes(','), hasD = s.includes('.');
    if (hasC && hasD) {
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (hasC) {
      s = (s.match(/,/g).length > 1) ? s.replace(/,/g, '') : s.replace(',', '.');
    } else if (hasD && /^[-+]?\d{1,3}(\.\d{3})+$/.test(s)) {
      s = s.replace(/\./g, '');
    }
    if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return NaN;
    const v = parseFloat(s);
    return neg ? -v : v;
  };

  /** Lê probabilidade: "60", "60%", "0,6" (fração) → 0.6 */
  F.parsePct = function (str) {
    const raw = String(str == null ? '' : str).trim();
    if (!raw) return NaN;
    const hasPct = raw.includes('%');
    const v = F.parseNum(raw.replace('%', ''));
    if (!isFinite(v)) return NaN;
    if (!hasPct && /[.,]/.test(raw) && Math.abs(v) <= 1) return v;
    return v / 100;
  };

  F.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  };
  F.trunc = function (s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  };
  /** número para campo de edição (sem separador de milhar) */
  F.editNum = function (x) {
    if (x == null || !isFinite(x)) return '';
    const r = Math.round(x * 1e6) / 1e6;
    return String(r).replace('.', ',');
  };
  F.editPct = function (p) {
    if (p == null || !isFinite(p)) return '';
    const r = Math.round(p * 100 * 1e4) / 1e4;
    return String(r).replace('.', ',');
  };

  DT.fmt = F;
})(window.DT);
