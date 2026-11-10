/* =====================================================================
   model.js — estrutura de dados da árvore e operações de edição
   Nó: { id, parent, type: 'D'|'C'|'T', name, branch, prob, value, cf, children[], collapsed }
     type  D = decisão (quadrado) | C = chance (círculo) | T = final (triângulo)
     branch = nome do ramo que chega ao nó; prob = probabilidade (se o pai é chance)
     value  = fluxo de caixa / VPL do ramo (somado ao longo do caminho)
     cf     = cálculo opcional do VPL a partir de fluxos de caixa
   ===================================================================== */
(function (DT) {
  'use strict';
  const M = {};

  M.TYPE_NAME = { D: 'Nó de decisão', C: 'Nó de chance', T: 'Nó final' };

  function node(id, parent, type, branch, prob, value) {
    return {
      id, parent, type: type || 'T', name: '', branch: branch || '',
      prob: prob == null ? null : prob, value: value || 0, cf: null, children: [], collapsed: false
    };
  }

  M.newTree = function (name) {
    const t = {
      app: 'arvore-decisao-vpl', version: 1,
      name: name || 'Nova árvore de decisão',
      description: '',
      unit: 'R$', scale: '', decimals: 2,
      objective: 'max',       // max = lucro/VPL ; min = custos
      criterion: 'ev',        // ev | maximax | maximin | ce
      tma: 10,                // taxa mínima de atratividade (% a.a.)
      riskTolerance: 1000,    // R da utilidade exponencial (equivalente certo)
      budget: null,           // orçamento: desembolso máximo permitido
      maxLoss: null,          // perda máxima aceitável (pior caso)
      maxLossProb: null,      // probabilidade máxima de prejuízo (%)
      constraintMode: 'none', // none | budget | all
      tieBreak: 'first',      // first | lessSpend | moreSpend
      autoComplete: true,     // completa automaticamente as probabilidades para 100%
      rootId: 1, nextId: 2,
      nodes: {}
    };
    t.nodes[1] = node(1, null, 'T', t.name, null, 0);
    return t;
  };

  /** Garante campos de versões anteriores / arquivos importados */
  M.migrate = function (t) {
    const base = M.newTree(t.name);
    for (const k in base) if (!(k in t)) t[k] = base[k];
    let maxId = 0;
    for (const k in t.nodes) {
      const n = t.nodes[k];
      n.id = +n.id; n.parent = n.parent == null ? null : +n.parent;
      n.children = (n.children || []).map(Number);
      if (!n.type) n.type = n.children.length ? 'D' : 'T';
      if (n.name == null) n.name = '';
      if (n.branch == null) n.branch = '';
      if (n.value == null || !isFinite(n.value)) n.value = 0;
      if (n.cf === undefined) n.cf = null;
      n.collapsed = !!n.collapsed;
      maxId = Math.max(maxId, n.id);
    }
    t.nextId = Math.max(t.nextId || 0, maxId + 1);
    return t;
  };

  M.TEMPLATES = {
    T: { type: 'T', label: 'Nó final' },
    CSN: { type: 'C', nodeName: 'Chance', kids: [{ b: 'Sim', p: 0.5 }, { b: 'Não', p: 0.5 }], label: 'Chance Sim / Não' },
    D: { type: 'D', nodeName: 'Decisão', kids: [{ b: 'Alternativa 1' }, { b: 'Alternativa 2' }], label: 'Decisão' },
    DSN: { type: 'D', nodeName: 'Decisão', kids: [{ b: 'Sim' }, { b: 'Não' }], label: 'Decisão Sim / Não' },
    C: { type: 'C', nodeName: 'Chance', kids: [{ b: 'Resultado 1', p: 0.5 }, { b: 'Resultado 2', p: 0.5 }], label: 'Chance 50/50' },
    CFD: { type: 'C', nodeName: 'Cenário', kids: [{ b: 'Favorável', p: 0.6 }, { b: 'Desfavorável', p: 0.4 }], label: 'Favorável / Desfavorável' },
    CAMB: { type: 'C', nodeName: 'Demanda', kids: [{ b: 'Demanda alta', p: 0.3 }, { b: 'Demanda média', p: 0.4 }, { b: 'Demanda baixa', p: 0.3 }], label: 'Alta / Média / Baixa' }
  };

  M.newId = function (t) { return t.nextId++; };

  M.addNode = function (t, parentId, type, branch, prob, value) {
    const id = M.newId(t);
    t.nodes[id] = node(id, parentId, type, branch, prob, value);
    if (parentId != null) t.nodes[parentId].children.push(id);
    return id;
  };

  M.descendants = function (t, id, out) {
    out = out || [];
    const n = t.nodes[id];
    if (!n) return out;
    n.children.forEach(k => { out.push(k); M.descendants(t, k, out); });
    return out;
  };

  M.isAncestor = function (t, a, b) { // a é ancestral de b?
    let n = t.nodes[b];
    while (n && n.parent != null) {
      if (n.parent === a) return true;
      n = t.nodes[n.parent];
    }
    return false;
  };

  M.path = function (t, id) {
    const p = [];
    let n = t.nodes[id];
    while (n) { p.unshift(n.id); n = n.parent != null ? t.nodes[n.parent] : null; }
    return p;
  };

  M.depth = function (t, id) { return M.path(t, id).length - 1; };

  M.pathText = function (t, id) {
    return M.path(t, id).map(i => t.nodes[i].branch || '(sem nome)').join(' › ');
  };

  function clearChildren(t, n) {
    M.descendants(t, n.id).forEach(k => delete t.nodes[k]);
    n.children = [];
  }

  /** Aplica um modelo (decisão, chance, final...) a um nó */
  M.applyTemplate = function (t, id, key) {
    const n = t.nodes[id];
    const tpl = M.TEMPLATES[key] || M.TEMPLATES[key[0]];
    if (!n || !tpl) return;
    if (tpl.type === 'T') {
      clearChildren(t, n);
      n.type = 'T'; n.name = '';
      return;
    }
    const old = n.type;
    n.type = tpl.type;
    if (!n.name || n.name === 'Decisão' || n.name === 'Chance' || n.name === 'Cenário' || n.name === 'Demanda' || old === 'T') n.name = tpl.nodeName;
    if (n.children.length === 0) {
      tpl.kids.forEach(k => M.addNode(t, id, 'T', k.b, tpl.type === 'C' ? k.p : null, 0));
    } else if (tpl.type === 'C') {
      const kids = n.children.map(k => t.nodes[k]);
      const missing = kids.some(k => k.prob == null || !isFinite(k.prob));
      if (missing) kids.forEach(k => { k.prob = 1 / kids.length; });
    }
  };

  /** Adiciona um ramo a um nó de decisão/chance; o novo ramo recebe o modelo indicado */
  M.addBranch = function (t, parentId, key) {
    const p = t.nodes[parentId];
    if (!p || p.type === 'T') return null;
    const k = p.children.length + 1;
    const name = p.type === 'D' ? 'Alternativa ' + k : 'Resultado ' + k;
    const id = M.addNode(t, parentId, 'T', name, p.type === 'C' ? 0 : null, 0);
    if (key && key !== 'T') M.applyTemplate(t, id, key);
    return id;
  };

  M.deleteNode = function (t, id) {
    const n = t.nodes[id];
    if (!n) return null;
    if (n.parent == null) { clearChildren(t, n); n.type = 'T'; n.name = ''; return id; }
    const p = t.nodes[n.parent];
    clearChildren(t, n);
    delete t.nodes[id];
    p.children = p.children.filter(k => k !== id);
    if (p.children.length === 0) { p.type = 'T'; p.name = ''; }
    return p.id;
  };

  M.canMove = function (t, id, newParentId) {
    const n = t.nodes[id], np = t.nodes[newParentId];
    if (!n || !np || n.parent == null) return false;
    if (id === newParentId || M.isAncestor(t, id, newParentId)) return false;
    return np.type === 'D' || np.type === 'C';
  };

  /** Move a subárvore `id` para baixo de `newParentId`, na posição `index` (opcional) */
  M.moveNode = function (t, id, newParentId, index) {
    if (!M.canMove(t, id, newParentId)) return false;
    const n = t.nodes[id], op = t.nodes[n.parent], np = t.nodes[newParentId];
    op.children = op.children.filter(k => k !== id);
    if (op.children.length === 0 && op !== np) { op.type = 'T'; op.name = ''; }
    if (index == null || index < 0 || index > np.children.length) np.children.push(id);
    else np.children.splice(index, 0, id);
    n.parent = newParentId;
    if (np.type === 'C' && (n.prob == null || !isFinite(n.prob))) n.prob = 0;
    return true;
  };

  M.cloneSubtree = function (t, id) {
    const n = t.nodes[id];
    if (!n) return null;
    return {
      type: n.type, name: n.name, branch: n.branch, prob: n.prob, value: n.value,
      cf: n.cf ? JSON.parse(JSON.stringify(n.cf)) : null, collapsed: n.collapsed,
      kids: n.children.map(k => M.cloneSubtree(t, k))
    };
  };

  M.pasteSubtree = function (t, clip, parentId, index) {
    const p = t.nodes[parentId];
    if (!clip || !p || p.type === 'T') return null;
    function rec(c, par) {
      const id = M.newId(t);
      const nn = node(id, par, c.type, c.branch, c.prob, c.value);
      nn.name = c.name; nn.cf = c.cf ? JSON.parse(JSON.stringify(c.cf)) : null; nn.collapsed = !!c.collapsed;
      t.nodes[id] = nn;
      (c.kids || []).forEach(k => nn.children.push(rec(k, id)));
      return id;
    }
    const nid = rec(clip, parentId);
    if (index == null || index < 0 || index > p.children.length) p.children.push(nid);
    else p.children.splice(index, 0, nid);
    if (p.type === 'C' && (t.nodes[nid].prob == null)) t.nodes[nid].prob = 0;
    return nid;
  };

  M.duplicate = function (t, id) {
    const n = t.nodes[id];
    if (!n || n.parent == null) return null;
    const clip = M.cloneSubtree(t, id);
    clip.branch = clip.branch + ' (cópia)';
    const p = t.nodes[n.parent];
    if (p.type === 'C') clip.prob = 0;
    return M.pasteSubtree(t, clip, n.parent, p.children.indexOf(id) + 1);
  };

  M.probSum = function (t, id) {
    const n = t.nodes[id];
    return n.children.reduce((s, k) => s + (+t.nodes[k].prob || 0), 0);
  };

  M.normalize = function (t, id) {
    const n = t.nodes[id];
    if (!n || n.type !== 'C' || !n.children.length) return;
    const s = M.probSum(t, id);
    n.children.forEach(k => { const c = t.nodes[k]; c.prob = s > 0 ? (+c.prob || 0) / s : 1 / n.children.length; });
  };

  /** Define a probabilidade de um ramo; se autoComplete, ajusta um irmão para fechar 100% */
  M.setProb = function (t, id, p) {
    const n = t.nodes[id];
    p = Math.max(0, Math.min(1, p));
    n.prob = p;
    if (!t.autoComplete || n.parent == null) return;
    const par = t.nodes[n.parent];
    if (par.type !== 'C') return;
    const sibs = par.children.filter(k => k !== id);
    if (!sibs.length) return;
    if (sibs.length === 1) { t.nodes[sibs[0]].prob = Math.max(0, 1 - p); return; }
    const last = sibs[sibs.length - 1];
    const others = sibs.slice(0, -1).reduce((s, k) => s + (+t.nodes[k].prob || 0), 0);
    const rest = 1 - p - others;
    if (rest >= -1e-9 && rest <= 1 + 1e-9) t.nodes[last].prob = Math.max(0, rest);
  };

  /** Muda a probabilidade e redistribui os irmãos proporcionalmente (usada na sensibilidade) */
  M.setProbProportional = function (t, id, p) {
    const n = t.nodes[id];
    p = Math.max(0, Math.min(1, p));
    const par = t.nodes[n.parent];
    n.prob = p;
    if (!par || par.type !== 'C') return;
    const sibs = par.children.filter(k => k !== id);
    const restOld = sibs.reduce((s, k) => s + (+t.nodes[k].prob || 0), 0);
    sibs.forEach(k => {
      const c = t.nodes[k];
      c.prob = restOld > 0 ? (+c.prob || 0) * (1 - p) / restOld : (1 - p) / sibs.length;
    });
  };

  M.validate = function (t) {
    const w = [];
    for (const k in t.nodes) {
      const n = t.nodes[k];
      if (n.type === 'C' && n.children.length) {
        const s = M.probSum(t, n.id);
        if (Math.abs(s - 1) > 1e-6) w.push({ id: n.id, kind: 'prob', sum: s, msg: `As probabilidades de "${n.branch || n.name}" somam ${DT.fmt.pct(s)}` });
        n.children.forEach(c => { const pr = +t.nodes[c].prob; if (pr < 0 || pr > 1) w.push({ id: c, kind: 'range', msg: `Probabilidade inválida em "${t.nodes[c].branch}"` }); });
      }
    }
    return w;
  };

  /* ---------------- CSV no formato da aba "Dados" das planilhas ---------------- */
  M.toCSV = function (t) {
    const lines = ['ID;Pai;Tipo;NomeNo;Ramo;Prob;Valor'];
    const order = [t.rootId].concat(M.descendants(t, t.rootId));
    const q = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
    order.forEach(id => {
      const n = t.nodes[id];
      lines.push([n.id, n.parent == null ? '' : n.parent, n.type === 'T' ? 'F' : n.type, q(n.name), q(n.branch),
        n.prob == null ? '' : String(n.prob).replace('.', ','), String(n.value).replace('.', ',')].join(';'));
    });
    return '\ufeff' + lines.join('\r\n');
  };

  function splitCSV(line, sep) {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map(s => s.trim());
  }

  M.fromCSV = function (text, name) {
    text = text.replace(/^\ufeff/, '');
    const rows = text.split(/\r?\n/).filter(r => r.trim());
    if (rows.length < 2) throw new Error('CSV vazio.');
    const sep = rows[0].includes(';') ? ';' : rows[0].includes('\t') ? '\t' : ',';
    const head = splitCSV(rows[0], sep).map(h => h.toLowerCase());
    const col = n => head.indexOf(n);
    const ci = { id: col('id'), pai: col('pai'), tipo: col('tipo'), nome: col('nomeno'), ramo: col('ramo'), prob: col('prob'), valor: col('valor') };
    if (ci.id < 0 || ci.pai < 0 || ci.tipo < 0) throw new Error('Cabeçalho esperado: ID;Pai;Tipo;NomeNo;Ramo;Prob;Valor');
    const t = M.newTree(name || 'Árvore importada');
    t.nodes = {};
    const list = [];
    rows.slice(1).forEach(r => {
      const c = splitCSV(r, sep);
      const id = Number(c[ci.id]);
      if (!Number.isSafeInteger(id) || id<=0 || t.nodes[id]) throw new Error('ID inválido ou repetido no CSV.');
      const tipo = (c[ci.tipo] || 'F').toUpperCase()[0];
      const pr = ci.prob >= 0 ? c[ci.prob] : '';
      const numeric = str => /^[-+]?\d+(\.\d+)?$/.test(str) ? Number(str) : DT.fmt.parseNum(str);
      const value = ci.valor>=0 && c[ci.valor] ? numeric(c[ci.valor]) : 0;
      const probability = pr === '' ? null : numeric(pr.replace(/%$/, ''));
      if (!Number.isFinite(value) || (probability!=null && !Number.isFinite(probability))) throw new Error('Valor ou probabilidade inválidos no CSV.');
      const n = node(id, !c[ci.pai] || c[ci.pai]==='0' ? null : Number(c[ci.pai]), tipo === 'F' ? 'T' : tipo,
        ci.ramo >= 0 ? c[ci.ramo] : '', probability, value);
      n.name = ci.nome >= 0 ? c[ci.nome] : '';
      if (n.prob != null && (n.prob > 1 || pr.endsWith('%'))) n.prob = n.prob / 100;
      t.nodes[id] = n; list.push(n);
    });
    let root = null;
    list.forEach(n => {
      if (n.parent == null) { if (root) throw new Error('O CSV tem mais de uma raiz.'); root = n; }
      else if (!t.nodes[n.parent]) throw new Error('Pai inexistente no CSV.');
      else t.nodes[n.parent].children.push(n.id);
    });
    if (!root) throw new Error('Nenhum nó raiz encontrado (Pai vazio).');
    t.rootId = root.id;
    t.name = root.branch || t.name;
    list.forEach(n => { if (n.type !== 'T' && !n.children.length) n.type = 'T'; if (n.type === 'T' && n.children.length) n.type = 'D'; });
    return M.migrate(t);
  };

  DT.model = M;
})(window.DT);
