/* =====================================================================
   engine.js — cálculos financeiros e da árvore
   • VPL de fluxos de caixa (com TMA), TIR e payback descontado
   • Rollback / folding back: chance = Σ p·valor ; decisão = melhor ramo
   • Critérios: VME (neutro), Maximax (otimista), Maximin (pessimista),
     Equivalente Certo (utilidade exponencial com tolerância ao risco R)
   • Restrições do perfil da empresa: orçamento, perda máxima, P(prejuízo)
   • Perfil de risco, sensibilidade, tornado e simulação de Monte Carlo
   ===================================================================== */
(function (DT) {
  'use strict';
  const E = {};
  const M = DT.model;
  const TOL = 1e-9;

  E.CRITERIA = {
    ev: { short: 'VME', name: 'VME – Valor Monetário Esperado (neutro ao risco)' },
    spend: { short: 'Desembolso', name: 'Menor desembolso esperado' },
    maximax: { short: 'Maximax', name: 'Maximax – otimista (melhor cenário)' },
    maximin: { short: 'Maximin', name: 'Maximin – pessimista (pior cenário)' },
    ce: { short: 'EC', name: 'Equivalente Certo – utilidade exponencial (aversão ao risco)' }
  };

  /* ------------------------- fluxos de caixa ------------------------- */
  E.flowsOf = function (cf) {
    if (!cf) return [];
    if (cf.mode === 'serie') {
      const start = Math.max(1, parseInt(cf.start, 10) || 1);
      const n = Math.max(0, parseInt(cf.n, 10) || 0);
      const len = start + n;
      const f = new Array(len).fill(0);
      f[start - 1] -= (+cf.inv || 0);
      const g = (+cf.growth || 0) / 100;
      for (let t = start; t < start + n; t++) f[t] += (+cf.fc || 0) * Math.pow(1 + g, t - start);
      if (n > 0) f[start + n - 1] += (+cf.residual || 0);
      return f;
    }
    return (cf.flows || []).map(x => (isFinite(+x) ? +x : 0));
  };
  E.rateOf = function (tree, cf) {
    const r = cf && cf.rate !== null && cf.rate !== '' && cf.rate !== undefined && isFinite(+cf.rate) ? +cf.rate : +tree.tma;
    return (isFinite(r) ? r : 0) / 100;
  };
  E.npv = function (flows, i) {
    return flows.reduce((s, f, t) => s + f / Math.pow(1 + i, t), 0);
  };
  E.irr = function (flows) {
    if (!flows.length) return NaN;
    const hasNeg = flows.some(f => f < 0), hasPos = flows.some(f => f > 0);
    if (!hasNeg || !hasPos) return NaN;
    let lo = -0.9999, hi = 10;
    let flo = E.npv(flows, lo), fhi = E.npv(flows, hi);
    if (flo * fhi > 0) return NaN;
    for (let k = 0; k < 200; k++) {
      const mid = (lo + hi) / 2, fm = E.npv(flows, mid);
      if (Math.abs(fm) < 1e-10) return mid;
      if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
    }
    return (lo + hi) / 2;
  };
  E.discountedPayback = function (flows, i) {
    let acc = 0;
    for (let t = 0; t < flows.length; t++) {
      const pv = flows[t] / Math.pow(1 + i, t);
      const prev = acc;
      acc += pv;
      if (t > 0 && prev < 0 && acc >= 0) return t - 1 + (-prev / pv);
    }
    return acc >= 0 && flows.length && flows[0] >= 0 ? 0 : NaN;
  };
  /** Atualiza o valor dos ramos calculados por fluxo de caixa */
  E.applyCashFlows = function (tree) {
    for (const k in tree.nodes) {
      const n = tree.nodes[k];
      if (n.cf) n.value = E.npv(E.flowsOf(n.cf), E.rateOf(tree, n.cf));
    }
  };
  /** Desembolso (gasto) em valor presente do ramo = parte negativa dos fluxos */
  E.spendOf = function (tree, n) {
    const sign = tree.objective === 'min' ? 1 : -1;
    if (n.cf) {
      const i = E.rateOf(tree, n.cf);
      return E.flowsOf(n.cf).reduce((s, f, t) => s + Math.max(0, sign * f) / Math.pow(1 + i, t), 0);
    }
    return Math.max(0, sign * (+n.value || 0));
  };

  /* ---------------------------- estatísticas ---------------------------- */
  E.stats = function (dist) {
    let ev = 0, sp = 0, min = Infinity, max = -Infinity, pLoss = 0, pGain = 0;
    dist.forEach(d => {
      ev += d.p * d.x; sp += d.p;
      if (d.p > 0) { if (d.x < min) min = d.x; if (d.x > max) max = d.x; }
      if (d.x < -TOL) pLoss += d.p;
      if (d.x > TOL) pGain += d.p;
    });
    if (min === Infinity) { dist.forEach(d => { min = Math.min(min, d.x); max = Math.max(max, d.x); }); }
    let v = 0;
    dist.forEach(d => { v += d.p * (d.x - ev) * (d.x - ev); });
    const std = Math.sqrt(Math.max(0, v));
    return { ev, std, var: v, min, max, pLoss, pGain, sumP: sp, cv: Math.abs(ev) > TOL ? std / Math.abs(ev) : NaN };
  };
  E.mergeDist = function (dist) {
    const m = new Map();
    dist.forEach(d => {
      const key = Math.round(d.x * 1e6) / 1e6;
      m.set(key, (m.get(key) || 0) + d.p);
    });
    return Array.from(m.entries()).map(([x, p]) => ({ x, p })).sort((a, b) => a.x - b.x);
  };
  function lse(arr) { // log Σ exp(a_i)
    if (!arr.length) return -Infinity;
    const m = Math.max.apply(null, arr);
    if (!isFinite(m)) return m;
    return m + Math.log(arr.reduce((s, a) => s + Math.exp(a - m), 0));
  }

  /* ------------------------------ rollback ------------------------------ */
  /**
   * Avalia a árvore inteira.
   * ov (opcional) sobrescreve: criterion, objective, R, budget, maxLoss, maxLossProb, constraintMode, tieBreak
   */
  E.evaluate = function (tree, ov) {
    const o = Object.assign({
      criterion: tree.criterion, objective: tree.objective, R: tree.riskTolerance,
      budget: tree.budget, maxLoss: tree.maxLoss, maxLossProb: tree.maxLossProb,
      constraintMode: tree.constraintMode, tieBreak: tree.tieBreak
    }, ov || {});
    E.applyCashFlows(tree);
    const s = o.objective === 'min' ? -1 : 1;
    const R = Math.max(1e-9, Math.abs(+o.R || 1));
    const valid = v => v !== null && v !== undefined && v !== '' && isFinite(+v);
    const useBudget = o.constraintMode !== 'none' && valid(o.budget);
    const useLoss = o.constraintMode === 'all' && valid(o.maxLoss);
    const useLP = o.constraintMode === 'all' && valid(o.maxLossProb);
    const out = {};
    const warnings = [];

    function critT(r) { // valor do critério no espaço "quanto maior, melhor"
      switch (o.criterion) {
        case 'spend': return -r.expSpend;
        case 'maximax': return s === 1 ? r.max : -r.min;
        case 'maximin': return s === 1 ? r.min : -r.max;
        case 'ce': return -R * r.lse;
        default: return s * r.ev;
      }
    }

    function solve(id, acc, accSp, depth) {
      const n = tree.nodes[id];
      const v = +n.value || 0;
      acc += v;
      accSp += E.spendOf(tree, n);
      const kids = n.type === 'T' ? [] : n.children.filter(k => tree.nodes[k]);
      let r;
      if (!kids.length) {
        r = { type: 'T', ev: acc, min: acc, max: acc, lse: -(s * acc) / R, expSpend: accSp, maxSpend: accSp, dist: [{ x: acc, p: 1, leaf: id }], payoff: acc };
      } else if (n.type === 'C') {
        const rs = kids.map(k => solve(k, acc, accSp, depth + 1));
        const ps = kids.map(k => +tree.nodes[k].prob || 0);
        const sum = ps.reduce((a, b) => a + b, 0);
        if (Math.abs(sum - 1) > 1e-6) warnings.push({ kind: 'prob', id, sum });
        let ev = 0, es = 0, ms = -Infinity, mn = Infinity, mx = -Infinity;
        const terms = [], dist = [];
        const any = ps.some(p => p > 0);
        rs.forEach((ri, i) => {
          const p = ps[i];
          ev += p * ri.ev; es += p * ri.expSpend;
          if (p > 0 || !any) {
            ms = Math.max(ms, ri.maxSpend); mn = Math.min(mn, ri.min); mx = Math.max(mx, ri.max);
            if (p > 0) terms.push(Math.log(p) + ri.lse);
          }
          ri.dist.forEach(d => dist.push({ x: d.x, p: d.p * p, leaf: d.leaf }));
        });
        r = { type: 'C', ev, min: mn, max: mx, lse: terms.length ? lse(terms) : -(s * ev) / R, expSpend: es, maxSpend: ms, dist, probSum: sum, infeasible: rs.some((ri,i) => ps[i] > 0 && ri.infeasible) };
      } else { // decisão
        const rs = kids.map(k => solve(k, acc, accSp, depth + 1));
        const info = rs.map((ri, i) => {
          const st = E.stats(ri.dist);
          const reasons = [];
          if (ri.infeasible) reasons.push('downstream');
          if (useBudget && ri.maxSpend > +o.budget + 1e-7) reasons.push('budget');
          if (useLoss && st.min < -Math.abs(+o.maxLoss) - 1e-7) reasons.push('loss');
          if (useLP && st.pLoss > (+o.maxLossProb) / 100 + 1e-7) reasons.push('lossprob');
          return { i, id: kids[i], reasons, crit: critT(ri), spend: ri.expSpend };
        });
        let cand = info.filter(x => !x.reasons.length);
        let infeasible = false;
        if (!cand.length) { cand = info; infeasible = true; warnings.push({ kind: 'infeasible', id }); }
        let best = cand[0];
        cand.forEach(c => {
          if (c === best) return;
          const tol = Number.EPSILON * 16 * Math.max(1, Math.abs(c.crit), Math.abs(best.crit));
          if (c.crit > best.crit + tol) best = c;
          else if (Math.abs(c.crit - best.crit) <= tol) {
            if (o.criterion === 'spend' && s * rs[c.i].ev > s * rs[best.i].ev + TOL) best = c;
            if (o.tieBreak === 'lessSpend' && c.spend < best.spend - 1e-9) best = c;
            if (o.tieBreak === 'moreSpend' && c.spend > best.spend + 1e-9) best = c;
          }
        });
        const ch = rs[best.i];
        const feas = {};
        info.forEach(x => { feas[x.id] = x.reasons; });
        r = { type: 'D', ev: ch.ev, min: ch.min, max: ch.max, lse: ch.lse, expSpend: ch.expSpend, maxSpend: ch.maxSpend, dist: ch.dist, choice: kids[best.i], infeasible, feas };
      }
      r.acc = acc;
      r.branchValue = v;
      r.spend = E.spendOf(tree, n);
      r.critT = critT(r);
      r.crit = o.criterion === 'spend' ? r.expSpend : s * r.critT;
      if (useBudget && r.maxSpend > +o.budget + 1e-7) r.infeasible = true;
      out[id] = r;
      return r;
    }

    const root = solve(tree.rootId, 0, 0, 0);

    // probabilidade de chegar a cada nó seguindo a política ótima + caminho ótimo
    const reach = {}, opt = {};
    (function walk(id, p, onOpt) {
      reach[id] = p; opt[id] = onOpt;
      const n = tree.nodes[id];
      if (n.type === 'T' || !n.children.length) return;
      n.children.forEach(k => {
        if (n.type === 'C') walk(k, p * (+tree.nodes[k].prob || 0), onOpt);
        else walk(k, k === out[id].choice ? p : 0, onOpt && k === out[id].choice);
      });
    })(tree.rootId, 1, true);

    return { o, s, R, nodes: out, root, reach, opt, warnings, stats: E.stats(root.dist) };
  };

  /** Avalia uma política qualquer (escolhas do usuário); decisões sem escolha usam a ótima */
  E.policy = function (tree, res, choices) {
    choices = choices || {};
    const dist = [], reach = {}, on = {}, picks = [], nodes = {};
    function walk(id, acc, p, spend) {
      const n = tree.nodes[id];
      acc += +n.value || 0;
      spend += E.spendOf(tree, n);
      reach[id] = p; on[id] = true;
      let result;
      if (n.type === 'T' || !n.children.length) {
        dist.push({ x: acc, p, leaf: id });
        result = { ev: acc, expSpend: spend, maxSpend: spend };
      } else if (n.type === 'C') {
        result = { ev: 0, expSpend: 0, maxSpend: 0 };
        for (const k of n.children) {
          const probability = +tree.nodes[k].prob || 0;
          const child = walk(k, acc, p * probability, spend);
          result.ev += probability * child.ev;
          result.expSpend += probability * child.expSpend;
          if (probability > 0) result.maxSpend = Math.max(result.maxSpend, child.maxSpend);
        }
      } else {
        let c = choices[id];
        if (c == null || n.children.indexOf(c) < 0) c = res.nodes[id].choice;
        picks.push({ dec: id, choice: c, user: choices[id] != null && n.children.indexOf(choices[id]) >= 0 });
        result = walk(c, acc, p, spend);
      }
      nodes[id] = result;
      return result;
    }
    const root = walk(tree.rootId, 0, 1, 0);
    return { dist, reach, on, picks, nodes, root, stats: E.stats(dist) };
  };

  /* --------------------------- explicação --------------------------- */
  /** Memória de cálculo em ordem de folding back (das folhas para a raiz) */
  E.explain = function (tree, res) {
    const F = DT.fmt;
    const lines = [];
    const crit = res.o.criterion;
    const show = x => (x < 0 ? '(' + F.num(x) + ')' : F.num(x));
    (function post(id) {
      const n = tree.nodes[id];
      if (n.type !== 'T' && n.children.length) n.children.forEach(post);
      const r = res.nodes[id];
      const label = n.type === 'T' ? (n.branch || 'Final') : (n.name || n.branch || '');
      let text;
      if (n.type === 'T' || !n.children.length) {
        const path = M.path(tree, id).map(i => +tree.nodes[i].value || 0).filter((v, i, a) => Math.abs(v) > 1e-12 || a.length === 1);
        text = `Resultado = ${path.length ? path.map(show).join(' + ') : '0'} = ${F.num(r.payoff)}`;
      } else if (n.type === 'C') {
        const parts = n.children.map(k => `${F.editPct(+tree.nodes[k].prob || 0)}% × ${show(res.nodes[k].ev)}`);
        text = `VME = ${parts.join(' + ')} = ${F.num(r.ev)}`;
        if (crit === 'maximax') text += ` | Maximax = ${F.num(r.crit)}`;
        if (crit === 'maximin') text += ` | Maximin = ${F.num(r.crit)}`;
        if (crit === 'ce') text += ` | EC = ${F.num(r.crit)}`;
        if (crit === 'spend') text += ' | Desembolso = ' + n.children.map(k => F.editPct(tree.nodes[k].prob) + '% × ' + show(res.nodes[k].expSpend)).join(' + ') + ' = ' + F.num(r.expSpend);
        if (Math.abs((r.probSum || 1) - 1) > 1e-6) text += `  ⚠ probabilidades somam ${F.pct(r.probSum)}`;
      } else {
        const fn = res.s === 1 && crit !== 'spend' ? 'máx' : 'mín';
        const parts = n.children.map(k => show(res.nodes[k].crit) + (r.feas[k] && r.feas[k].length ? '✗' : ''));
        const chosen = tree.nodes[r.choice];
        text = r.infeasible ? 'Nenhum ramo atende aos limites.' : `${E.CRITERIA[crit].short} = ${fn}(${parts.join('; ')}) = ${F.num(r.crit)} → escolher "${chosen.branch}"`;
      }
      let cf = '';
      if (n.cf) {
        const fl = E.flowsOf(n.cf), i = E.rateOf(tree, n.cf);
        const terms = fl.map((f, t) => (Math.abs(f) < 1e-12 ? null : (t === 0 ? show(f) : `${show(f)}/(1+${F.num(i * 100, 1)}%)^${t}`))).filter(Boolean);
        cf = `VPL do ramo "${n.branch}" = ${terms.join(' + ') || '0'} = ${F.num(n.value)}`;
      }
      lines.push({ id, type: n.type === 'T' || !n.children.length ? 'T' : n.type, label, text, cf, depth: M.depth(tree, id) });
    })(tree.rootId);
    return lines;
  };

  /* --------------------------- sensibilidade --------------------------- */
  function clone(tree) { return JSON.parse(JSON.stringify(tree)); }

  E.applyParam = function (t, param, x) {
    const n = t.nodes[param.id];
    if (!n) return;
    if (param.field === 'prob') M.setProbProportional(t, param.id, x);
    else if (param.field === 'tma') t.tma = x;
    else { n.cf = null; n.value = x; }
  };

  /** Varia um parâmetro e devolve o valor (critério) de cada alternativa da raiz */
  E.sensitivity = function (tree, param, from, to, steps, ov) {
    steps = Math.max(2, Math.min(200, steps | 0));
    const root = tree.nodes[tree.rootId];
    const alts = root.type === 'D' ? root.children.slice() : [];
    const xs = [], total = [], choice = [], series = alts.map(id => ({ id, name: root.type === 'D' ? tree.nodes[id].branch : '', ys: [] }));
    for (let k = 0; k <= steps; k++) {
      const x = from + (to - from) * k / steps;
      const t = clone(tree);
      E.applyParam(t, param, x);
      const r = E.evaluate(t, ov);
      xs.push(x);
      total.push(r.root.crit);
      choice.push(r.root.choice != null ? r.root.choice : null);
      series.forEach(s => s.ys.push(r.nodes[s.id].crit));
    }
    const switches = [];
    for (let k = 1; k < xs.length; k++) {
      if (choice[k] !== choice[k - 1]) switches.push({ x: (xs[k] + xs[k - 1]) / 2, from: choice[k - 1], to: choice[k] });
    }
    return { xs, total, choice, series, switches };
  };

  /** Gráfico de tornado: variação de ±pct em cada valor e probabilidade */
  E.tornado = function (tree, pct, ov, limit) {
    const base = E.evaluate(clone(tree), ov).root.crit;
    const items = [];
    for (const k in tree.nodes) {
      const n = tree.nodes[k];
      const id = n.id;
      const v = +n.value || 0;
      if (Math.abs(v) > 1e-12) {
        const lo = clone(tree), hi = clone(tree);
        E.applyParam(lo, { id, field: 'value' }, v * (1 - pct));
        E.applyParam(hi, { id, field: 'value' }, v * (1 + pct));
        const a = E.evaluate(lo, ov).root.crit, b = E.evaluate(hi, ov).root.crit;
        items.push({ label: 'Valor: ' + (n.branch || n.name), id, field: 'value', lo: a, hi: b, swing: Math.abs(b - a) });
      }
      const par = n.parent != null ? tree.nodes[n.parent] : null;
      if (par && par.type === 'C' && par.children.length > 1 && (+n.prob || 0) > 0) {
        const p = +n.prob;
        const lo = clone(tree), hi = clone(tree);
        E.applyParam(lo, { id, field: 'prob' }, Math.max(0, p * (1 - pct)));
        E.applyParam(hi, { id, field: 'prob' }, Math.min(1, p * (1 + pct)));
        const a = E.evaluate(lo, ov).root.crit, b = E.evaluate(hi, ov).root.crit;
        items.push({ label: 'Prob.: ' + n.branch + ' (' + (par.branch || par.name) + ')', id, field: 'prob', lo: a, hi: b, swing: Math.abs(b - a) });
      }
    }
    items.sort((a, b) => b.swing - a.swing);
    return { base, items: items.filter(i => i.swing > 1e-9).slice(0, limit || 12) };
  };

  /* ---------------------------- Monte Carlo ---------------------------- */
  E.simulate = function (dist, N) {
    const sum = dist.reduce((s, d) => s + d.p, 0) || 1;
    const cum = [];
    let c = 0;
    dist.forEach(d => { c += d.p / sum; cum.push(c); });
    const samples = new Float64Array(N);
    const running = [];
    let acc = 0;
    const every = Math.max(1, Math.floor(N / 300));
    for (let i = 0; i < N; i++) {
      const u = Math.random();
      let lo = 0, hi = cum.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < u) lo = m + 1; else hi = m; }
      const x = dist[lo].x;
      samples[i] = x; acc += x;
      if ((i + 1) % every === 0 || i === N - 1) running.push([i + 1, acc / (i + 1)]);
    }
    const mean = acc / N;
    let v = 0, loss = 0;
    for (let i = 0; i < N; i++) { v += (samples[i] - mean) ** 2; if (samples[i] < 0) loss++; }
    return { samples, running, mean, std: Math.sqrt(v / Math.max(1, N - 1)), pLoss: loss / N, N };
  };

  DT.engine = E;
})(window.DT);
