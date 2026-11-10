(function (DT) {
  'use strict';
  const { model: M, engine: E, fmt: F, examples: X, io } = DT;
  const $ = (id) => document.getElementById(id);
  const esc = F.esc;
  const labels = { D: 'Decisão', C: 'Chance', T: 'Final' };
  const sessionKey = 'arvoredo.projeto.v1';
  let tree = X.get('simnao'),
    res,
    errors,
    policy;
  let history = [],
    future = [],
    tab = 'compare',
    tool = '',
    zoom = 1,
    autoFit = true;
  let practice = false,
    choices = {},
    drag = null,
    timer;
  const dialog = $('dialog');
  try {
    const saved = localStorage.getItem(sessionKey);
    if (saved) loadTree(io.validate(JSON.parse(saved)));
  } catch {
    notify('O projeto local não pôde ser recuperado. Um exercício foi aberto.');
  }
  function notify(message) {
    $('notice').textContent = message;
    clearTimeout(timer);
    timer = setTimeout(() => {
      $('notice').textContent = '';
    }, 4500);
  }
  function project() {
    return { ...tree, practice, choices };
  }
  function loadTree(next) {
    tree = next;
    practice = next.practice === true;
    choices = {};
    for (const [id, child] of Object.entries(next.choices || {})) {
      if (tree.nodes[id]?.type === 'D' && tree.nodes[id].children.includes(child)) choices[id] = child;
    }
  }
  function remember() {
    try {
      localStorage.setItem(sessionKey, JSON.stringify(project()));
    } catch {
      notify('Use Salvar projeto para guardar as alterações em arquivo.');
    }
  }
  function commit(action, reset = false) {
    const before = JSON.stringify(project());
    choices = {};
    practice = false;
    action();
    history.push(before);
    if (history.length > 50) history.shift();
    future = [];
    tool = '';
    if (reset) autoFit = true;
    render();
    remember();
  }
  function restore(from, to) {
    if (!from.length) return;
    to.push(JSON.stringify(project()));
    loadTree(JSON.parse(from.pop()));
    tool = '';
    autoFit = true;
    render();
    remember();
  }
  function openDialog(title, body) {
    $('dialog-title').textContent = title;
    $('dialog-body').innerHTML = body;
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
  }
  function formDialog(title, body, submit, apply) {
    openDialog(
      title,
      '<form id="form">' +
        body +
        '<div class="form-error" role="alert"></div><div class="actions"><button class="primary" type="submit">' +
        esc(submit) +
        '</button></div></form>'
    );
    $('form').onsubmit = (e) => {
      e.preventDefault();
      try {
        apply(new FormData(e.target));
        dialog.close();
      } catch (err) {
        e.target.querySelector('.form-error').textContent = err.message;
      }
    };
  }
  const num = (v, label) => {
    const n = F.parseNum(v);
    if (!Number.isFinite(n)) throw new Error('Informe um número válido em ' + label + '.');
    return n;
  };
  const field = (label, name, value, opts = '') =>
    '<label>' + label + '<input name="' + name + '" value="' + esc(value) + '" ' + opts + '></label>';
  const money = (x) => F.money(x) + (tree.scale ? ' ' + tree.scale : '');
  const unit = () => [tree.unit, tree.scale].filter(Boolean).join(' ') || 'u.m.';
  const cost = () => tree.objective === 'min';
  const vpe = () => (cost() ? 'Custo presente esperado' : 'VPL esperado');
  const branch = (id) => tree.nodes[id].branch;
  const feasible = () => !errors.length && !res.root.infeasible;
  function render() {
    F.unit = tree.unit;
    F.dec = tree.decimals;
    res = E.evaluate(tree);
    errors = M.validate(tree);
    if (Object.values(res.nodes).some((r) => ![r.ev, r.acc, r.expSpend].every(Number.isFinite)))
      errors.push({ msg: 'Revise os fluxos e a taxa. O cálculo excedeu a faixa numérica.' });
    if (!feasible()) practice = false;
    policy = practice ? E.policy(tree, res, choices) : null;
    $('title').textContent = tree.nodes[tree.rootId].branch || tree.name;
    const count = Object.keys(tree.nodes).length,
      ends = Object.values(tree.nodes).filter((n) => n.type === 'T').length;
    $('node-count').textContent =
      count +
      (count === 1 ? ' nó' : ' nós') +
      ' · ' +
      ends +
      (ends === 1 ? ' resultado final' : ' resultados finais');
    $('statement').hidden = !tree.description;
    $('summary').textContent =
      'Valores em ' +
      unit() +
      ' · TMA de ' +
      F.editNum(tree.tma) +
      '% ao ano' +
      (tree.constraintMode === 'budget' ? ' · Orçamento de ' + money(tree.budget) : '');
    $('profile').options[0].textContent = cost() ? 'Menor custo esperado' : 'Maior VPL esperado';
    $('profile').value = tree.criterion;
    $('undo').disabled = !history.length;
    $('redo').disabled = !future.length;
    $('practice').disabled = !feasible() || !Object.values(tree.nodes).some((n) => n.type === 'D');
    $('practice').textContent = practice ? 'Voltar à recomendação' : 'Testar minha escolha →';
    $('key').textContent = practice ? 'Minha estratégia' : 'Estratégia recomendada';
    draw();
    results();
    details();
    toolsState();
  }
  function toolsState() {
    updateMode();
    document
      .querySelectorAll('[data-template]')
      .forEach((b) => b.classList.toggle('armed', tool === b.dataset.template));
    $('cancel-tool').hidden = !tool;
    $('hint').textContent = tool
      ? 'Clique no nó que receberá a peça.'
      : practice
        ? 'Clique numa alternativa de decisão ou solte o marcador sobre ela. Nos demais nós vale a recomendação.'
        : '';
  }
  function draw() {
    const pos = {},
      width = 164,
      height = 87,
      stepX = 209,
      stepY = 102,
      pad = 20;
    let leaf = 0,
      levels = 0;
    function place(id, depth) {
      const n = tree.nodes[id];
      const ys = n.children.map((k) => place(k, depth + 1));
      const y = ys.length ? (ys[0] + ys[ys.length - 1]) / 2 : pad + leaf++ * stepY;
      pos[id] = { x: pad + depth * stepX, y };
      levels = Math.max(levels, depth);
      return y;
    }
    place(tree.rootId, 0);
    const w = pad * 2 + width + levels * stepX,
      h = pad * 2 + height + (leaf - 1) * stepY;
    const view = $('viewport'),
      scene = $('scene'),
      surface = $('surface');
    if (autoFit)
      zoom = Math.max(0.72, Math.min(1.08, (view.clientWidth - 10) / w, (view.clientHeight - 8) / h));
    surface.style.width = Math.max(view.clientWidth - 2, w * zoom) + 'px';
    surface.style.height = Math.max(view.clientHeight - 2, h * zoom) + 'px';
    scene.style.cssText =
      'width:' +
      w +
      'px;height:' +
      h +
      'px;transform:scale(' +
      zoom +
      ');left:' +
      Math.max(0, (view.clientWidth - w * zoom) / 2 - 1) +
      'px;top:' +
      Math.max(0, (view.clientHeight - h * zoom) / 2 - 1) +
      'px';
    let edges = '',
      nodes = '';
    const on = (id) => feasible() && (practice ? policy.reach[id] > 0 : res.reach[id] > 0);
    for (const n of Object.values(tree.nodes)) {
      const { x, y } = pos[n.id],
        p = tree.nodes[n.parent],
        r = res.nodes[n.id];
      if (p) {
        const a = pos[p.id],
          x1 = a.x + width,
          y1 = a.y + height / 2,
          y2 = y + height / 2,
          m = (x + x1) / 2;
        edges +=
          '<path class="edge ' +
          (on(n.id) ? 'on' : '') +
          '" pathLength="1" d="M' +
          x1 +
          ' ' +
          y1 +
          ' C' +
          m +
          ' ' +
          y1 +
          ' ' +
          m +
          ' ' +
          y2 +
          ' ' +
          x +
          ' ' +
          y2 +
          '"/>';
      }
      const val = policy?.nodes[n.id]?.ev ?? r.ev;
      const value =
        errors.length || (r.infeasible && n.type !== 'T' && !policy?.on[n.id]) ? 'Revisar' : money(val);
      nodes +=
        '<button class="vertex ' +
        (on(n.id) ? 'on ' : '') +
        (p ? '' : 'root') +
        '" data-node="' +
        n.id +
        '" draggable="' +
        (!practice && !!p) +
        '" style="left:' +
        x +
        'px;top:' +
        y +
        'px" title="' +
        esc(M.pathText(tree, n.id) + ' · Clique para ' + (practice ? 'escolher' : 'editar')) +
        '"><span class="node-kind"><i class="shape ' +
        n.type +
        '"></i>' +
        labels[n.type] +
        (p?.type === 'C'
          ? '<em>' +
            F.pct(n.prob, Math.abs(n.prob * 100 - Math.round(n.prob * 100)) < 1e-9 ? 0 : 2) +
            '</em>'
          : '') +
        '</span><strong>' +
        esc(n.branch) +
        '</strong><span class="node-money">' +
        esc(value) +
        '</span></button>';
    }
    scene.innerHTML =
      '<svg width="' + w + '" height="' + h + '" aria-hidden="true">' + edges + '</svg>' + nodes;
    $('scale').textContent = Math.round(zoom * 100) + '%';
    if (autoFit && h * zoom > view.clientHeight)
      view.scrollTop = pos[tree.rootId].y * zoom - view.clientHeight / 2 + (height * zoom) / 2;
  }
  function setZoom(value) {
    autoFit = false;
    zoom = Math.max(0.12, Math.min(2.3, value));
    draw();
  }
  function fit() {
    const s = $('scene'),
      v = $('viewport');
    setZoom(Math.min(1.15, (v.clientWidth - 10) / s.offsetWidth, (v.clientHeight - 8) / s.offsetHeight));
    v.scrollTo(0, 0);
  }
  function results() {
    const box = $('result');
    if (errors.length) {
      box.innerHTML =
        '<p class="alert">' +
        esc(errors.map((e) => e.msg).join('. ')) +
        '. Edite os ramos para recalcular.</p>';
      return;
    }
    if (!feasible()) {
      box.innerHTML =
        '<p class="alert">Nenhuma estratégia atende ao orçamento. Revise o limite ou os desembolsos.</p>';
      return;
    }
    const r = res.root,
      stats = practice ? policy.stats : res.stats;
    const picked = practice ? policy.picks.find((p) => p.dec === tree.rootId)?.choice : r.choice;
    const name =
      picked != null
        ? branch(picked)
        : tree.nodes[tree.rootId].type === 'T'
          ? 'Resultado final'
          : 'Cenários ponderados pelas probabilidades';
    const spend = practice ? policy.root.expSpend : r.expSpend;
    const over =
      practice &&
      tree.constraintMode !== 'none' &&
      tree.budget != null &&
      policy.root.maxSpend > tree.budget + 1e-7;
    const metric = (k, v) => '<dl class="metric"><dt>' + k + '</dt><dd>' + esc(v) + '</dd></dl>';
    const activePicks = practice ? policy.picks.filter((p) => policy.reach[p.dec] > 0) : [];
    const isRecommended = activePicks.every((p) => p.choice === res.nodes[p.dec].choice);
    box.innerHTML =
      '<div class="score"><small>' +
      esc(vpe()) +
      '</small><strong>' +
      esc(money(stats.ev)) +
      '</strong><p>' +
      (practice ? 'Minha escolha' : picked != null ? 'Recomendação' : 'Raiz') +
      ' · <b>' +
      esc(name) +
      '</b></p></div>' +
      metric('Desembolso esperado', money(spend)) +
      metric('Pior resultado', money(cost() ? stats.max : stats.min)) +
      (!cost()
        ? '<dl class="metric"><dt>Probabilidade de prejuízo</dt><dd>' + F.pct(stats.pLoss) +
          '</dd><div class="risk-track" aria-hidden="true"><i style="width:' +
          Math.max(0, Math.min(100, stats.pLoss * 100)) + '%"></i></div></dl>'
        : '') +
      (practice
        ? metric('Esperado da recomendação', money(r.ev)) +
          (over
            ? '<p class="alert">Sua escolha ultrapassa o orçamento.</p>'
            : '<p class="help practice-note">' +
              (!activePicks.some((p) => p.user)
                ? 'Marque um ramo para testar sua estratégia.'
                : isRecommended
                  ? 'Suas escolhas seguem a estratégia recomendada.'
                  : 'Sua estratégia difere da recomendação para o critério atual.') +
              '</p>')
        : '');
  }
  function details() {
    document.querySelector('[data-tab="math"]').textContent = practice
      ? 'Cálculo da recomendação'
      : 'Memória de cálculo';
    document
      .querySelectorAll('[data-tab]')
      .forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    const root = tree.nodes[tree.rootId],
      box = $('detail-content');
    if (errors.length) {
      box.textContent = 'Confira as entradas indicadas no resultado.';
      return;
    }
    const row = (cells, cls = '') =>
      '<tr class="' + cls + '">' + cells.map((c) => '<td>' + c + '</td>').join('') + '</tr>';
    const table = (head, rows) =>
      '<table><thead><tr>' +
      head.map((h) => '<th>' + h + '</th>').join('') +
      '</tr></thead><tbody>' +
      rows.join('') +
      '</tbody></table>';
    if (tab === 'math') {
      box.innerHTML = E.explain(tree, res)
        .map(
          (l) =>
            '<div class="math-row"><b>' +
            esc(l.label) +
            '</b>' +
            esc(l.text) +
            (l.cf ? '<br>' + esc(l.cf) : '') +
            '</div>'
        )
        .join('');
      return;
    }
    if (tab === 'outcomes') {
      if (!feasible()) {
        box.textContent = 'Nenhuma estratégia viável para detalhar.';
        return;
      }
      const dist = (practice ? policy.dist : res.root.dist).filter((d) => d.p > 0);
      box.innerHTML = table(
        [
          'Caminho da estratégia ativa',
          'Probabilidade conjunta',
          'Resultado final (' + esc(unit()) + ')'
        ],
        dist.map((d) =>
          row([
            esc(M.path(tree, d.leaf).slice(1).map(branch).join(' › ') || root.branch),
            F.pct(d.p, 2),
            F.num(d.x)
          ])
        )
      );
      return;
    }
    const ids = root.children.length ? root.children : [root.id];
    const chance = root.type === 'C';
    box.innerHTML = table(
      [
        chance ? 'Cenário' : 'Alternativa',
        vpe() + ' (' + esc(unit()) + ')',
        'Desembolso esperado',
        'Pior resultado',
        chance ? 'Probabilidade' : 'Chance de ' + (cost() ? 'custo positivo' : 'prejuízo')
      ],
      ids.map((id) => {
        const r = res.nodes[id],
          stats = E.stats(r.dist),
          optimal = feasible() && root.type === 'D' && id === res.root.choice;
        return row(
          [
            esc(branch(id)) +
              (optimal
                ? '<span class="pill">Recomendada</span>'
                : r.infeasible
                  ? '<span class="pill">Acima do limite</span>'
                  : ''),
            F.num(r.ev),
            F.num(r.expSpend),
            F.num(cost() ? r.max : r.min),
            F.pct(chance ? tree.nodes[id].prob : cost() ? stats.pGain : stats.pLoss)
          ],
          optimal ? 'pick' : ''
        );
      })
    );
  }
  function settings() {
    const budget = tree.constraintMode === 'none' ? '' : F.editNum(tree.budget);
    formDialog(
      'Configurar árvore',
      field('Título da árvore', 'title', branch(tree.rootId), 'required maxlength="160"') +
        '<div class="grid2">' +
        field('Unidade monetária', 'unit', tree.unit, 'required maxlength="12"') +
        field('Escala (opcional)', 'scale', tree.scale, 'placeholder="mil, milhões…" maxlength="16"') +
        '</div>' +
        field('TMA anual (%)', 'rate', F.editNum(tree.tma), 'required inputmode="decimal"') +
        '<label>Convenção dos valores<select name="objective"><option value="max">VPL · entradas positivas e gastos negativos</option><option value="min" ' +
        (cost() ? 'selected' : '') +
        '>Custos · despesas positivas e economias negativas</option></select></label>' +
        field(
          'Orçamento máximo por caminho (' + esc(unit()) + ')',
          'budget',
          budget,
          'placeholder="Sem limite" inputmode="decimal"'
        ) +
        '<p class="help">O limite considera a soma dos desembolsos em valor presente de cada caminho possível.</p>' +
        '<label>Enunciado<textarea name="desc" rows="3">' +
        esc(tree.description) +
        '</textarea></label>',
      'Aplicar configurações',
      (data) => {
        const rate = num(data.get('rate'), 'TMA'),
          name = data.get('title').trim(),
          unitName = data.get('unit').trim();
        const b = data.get('budget').trim() === '' ? null : num(data.get('budget'), 'orçamento');
        if (!name || !unitName) throw new Error('Preencha o título e a unidade.');
        if (rate <= -100) throw new Error('A TMA precisa ser maior que −100%.');
        if (b != null && b < 0) throw new Error('O orçamento deve ser zero ou positivo.');
        commit(() => {
          tree.name = name;
          tree.nodes[tree.rootId].branch = name;
          tree.unit = unitName;
          tree.scale = data.get('scale').trim();
          tree.tma = rate;
          tree.objective = data.get('objective');
          tree.budget = b;
          tree.constraintMode = b == null ? 'none' : 'budget';
          tree.description = data.get('desc');
        });
      }
    );
  }
  function edit(id) {
    const n = tree.nodes[id],
      p = tree.nodes[n.parent],
      cf = n.cf;
    const prob = p?.type === 'C';
    const siblings = prob ? p.children.length : 0;
    formDialog(
      'Editar ' + labels[n.type].toLowerCase(),
      '<p class="help">' +
        esc(M.pathText(tree, id)) +
        '</p>' +
        field('Nome do ramo', 'branch', n.branch, 'required maxlength="160"') +
        (prob
          ? field(
              'Probabilidade do cenário (%)',
              'prob',
              F.editPct(n.prob),
              'required inputmode="decimal"'
            ) +
            '<p class="help">' +
            (siblings > 1
              ? 'Os demais cenários dividem o percentual restante na proporção atual.'
              : 'Um cenário único tem probabilidade de 100%.') +
            '</p>'
          : '') +
        '<label>Valor do ramo<select name="mode"><option value="value">Valor presente informado</option><option value="flows" ' +
        (cf ? 'selected' : '') +
        '>Calcular pelos fluxos anuais</option></select></label>' +
        '<div id="value-fields">' +
        field(
          'Valor presente (' + esc(unit()) + ')',
          'value',
          F.editNum(n.value),
          'inputmode="decimal"'
        ) +
        '</div>' +
        '<div id="flow-fields"><label>Fluxos do ano 0 em diante (' +
        esc(unit()) +
        ')<textarea name="flows" rows="2" placeholder="-1000; 500; 600">' +
        esc((cf ? E.flowsOf(cf) : [n.value]).map(F.editNum).join('; ')) +
        '</textarea></label>' +
        '<p class="help">Separe os anos por ponto e vírgula. O primeiro valor ocorre hoje. Todos os ramos usam a mesma origem de tempo.</p>' +
        field(
          'Taxa anual do ramo (%)',
          'rate',
          cf?.rate == null ? '' : F.editNum(cf.rate),
          'placeholder="Usar TMA da árvore" inputmode="decimal"'
        ) +
        '</div>' +
        '<p class="help">' +
        (cost()
          ? 'Em exercícios de custos, informe despesas positivas.'
          : 'Informe desembolsos com sinal negativo e recebimentos com sinal positivo.') +
        '</p>',
      'Aplicar e calcular',
      (data) => {
        const name = data.get('branch').trim();
        if (!name) throw new Error('Dê um nome ao ramo.');
        const pr = prob ? num(data.get('prob'), 'probabilidade') / 100 : null;
        if (prob && (pr < 0 || pr > 1 || (siblings === 1 && pr !== 1)))
          throw new Error('Confira a probabilidade do cenário.');
        let cash = null,
          value;
        if (data.get('mode') === 'flows') {
          const flows = data
            .get('flows')
            .trim()
            .split(/[;\n]/)
            .map((v) => num(v, 'fluxos anuais'));
          if (flows.length > 1001) throw new Error('Informe até 1.001 fluxos.');
          const rate = data.get('rate').trim() === '' ? null : num(data.get('rate'), 'taxa do ramo');
          if (rate != null && rate <= -100) throw new Error('A taxa precisa ser maior que −100%.');
          cash = { mode: 'fluxos', flows, rate };
          value = E.npv(flows, E.rateOf(tree, cash));
          if (!Number.isFinite(value)) throw new Error('Confira o horizonte e a taxa do ramo.');
          if (
            cf &&
            data.get('flows') === E.flowsOf(cf).map(F.editNum).join('; ') &&
            rate === (cf.rate ?? null)
          )
            cash = cf;
        } else value = num(data.get('value'), 'valor presente');
        commit(() => {
          n.branch = name;
          if (!p) tree.name = name;
          n.value = value;
          n.cf = cash;
          if (
            prob &&
            (data.get('prob') !== F.editPct(n.prob) || Math.abs(M.probSum(tree, p.id) - 1) > 1e-6)
          )
            M.setProbProportional(tree, id, pr);
        });
      }
    );
    const sync = () => {
      const flow = $('form').elements.mode.value === 'flows';
      $('flow-fields').hidden = !flow;
      $('value-fields').hidden = flow;
    };
    $('form').elements.mode.onchange = sync;
    sync();
    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.innerHTML =
      n.type === 'T'
        ? '<button data-struct="DSN">Criar decisão Sim / Não</button><button data-struct="CSN">Criar chance Sim / Não</button>'
        : '<button data-struct="T">Adicionar ramo final</button>';
    if (p)
      actions.insertAdjacentHTML(
        'beforeend',
        '<button class="danger" id="delete-node">Excluir ramo</button>'
      );
    $('dialog-body').append(actions);
    actions.querySelectorAll('[data-struct]').forEach(
      (b) =>
        (b.onclick = () => {
          if (!$('form').reportValidity()) return;
          $('form').requestSubmit();
          if (!dialog.open) insert(id, b.dataset.struct);
        })
    );
    if (p)
      $('delete-node').onclick = () => {
        if (!confirm('Excluir “' + n.branch + '” e os nós abaixo dele?')) return;
        dialog.close();
        commit(() => {
          M.deleteNode(tree, id);
          if (p.type === 'C') M.normalize(tree, p.id);
        });
      };
  }
  function insert(id, key) {
    if (!M.TEMPLATES[key]) return;
    const n = tree.nodes[id];
    if (n.type === 'T' && key === 'T') {
      tool = '';
      toolsState();
      edit(id);
      return;
    }
    commit(() => {
      if (n.type === 'T') M.applyTemplate(tree, id, key);
      else {
        const newId = M.addBranch(tree, id, key);
        if (n.type === 'C') M.setProbProportional(tree, newId, 1 / n.children.length);
      }
    });
  }
  function pick(id) {
    const n = tree.nodes[id],
      p = tree.nodes[n.parent];
    if (p?.type !== 'D') {
      notify('Marque uma alternativa ligada diretamente a um quadrado de decisão.');
      return;
    }
    choices[p.id] = id;
    render();
    remember();
    if (!policy.on[p.id]) notify('Escolha também o ramo anterior para alcançar esta decisão.');
  }
  function activate(id) {
    if (practice) pick(id);
    else if (tool) insert(id, tool);
    else edit(id);
  }
  $('scene').onclick = (e) => {
    const b = e.target.closest('[data-node]');
    if (b) activate(+b.dataset.node);
  };
  const toolbar = document.querySelector('.toolbar');
  toolbar.insertAdjacentHTML(
    'beforeend',
    '<button id="marker" draggable="true" hidden>⚑ Minha escolha</button>'
  );
  function updateMode() {
    toolbar.querySelectorAll('[data-template], :scope > span').forEach((b) => (b.hidden = practice));
    $('marker').hidden = !practice;
  }
  toolbar.onclick = (e) => {
    const b = e.target.closest('[data-template]');
    if (b) {
      tool = tool === b.dataset.template ? '' : b.dataset.template;
      toolsState();
    }
    if (e.target.id === 'marker') notify('Clique ou arraste o marcador até a alternativa desejada.');
  };
  $('cancel-tool').onclick = () => {
    tool = '';
    toolsState();
  };
  document.addEventListener('dragstart', (e) => {
    const b = e.target.closest('[data-template],[data-node],#marker');
    if (!b) return;
    drag =
      b.id === 'marker'
        ? { pick: true }
        : b.dataset.template
          ? { key: b.dataset.template }
          : { id: +b.dataset.node };
    e.dataTransfer.setData('text/plain', b.textContent);
    e.dataTransfer.effectAllowed = drag.id ? 'move' : 'copy';
  });
  function dropTarget(e) {
    const b = e.target.closest?.('[data-node]');
    if (!drag || !b) return null;
    const id = +b.dataset.node;
    if (drag.id && !M.canMove(tree, drag.id, id)) return null;
    if (drag.pick && tree.nodes[tree.nodes[id].parent]?.type !== 'D') return null;
    return b;
  }
  document.addEventListener('dragover', (e) => {
    const b = dropTarget(e);
    if (b || e.dataTransfer.types.includes('Files')) e.preventDefault();
    document.querySelectorAll('.target').forEach((el) => {
      if (el !== b) el.classList.remove('target');
    });
    if (b) {
      e.dataTransfer.dropEffect = drag.id ? 'move' : 'copy';
      b.classList.add('target');
    }
  });
  document.addEventListener('dragend', () => {
    drag = null;
    document.querySelectorAll('.target').forEach((b) => b.classList.remove('target'));
  });
  document.addEventListener('drop', (e) => {
    if (e.dataTransfer.files.length) {
      e.preventDefault();
      openFile(e.dataTransfer.files[0]);
      return;
    }
    const b = dropTarget(e);
    if (!b) return;
    e.preventDefault();
    const id = +b.dataset.node,
      payload = drag;
    drag = null;
    b.classList.remove('target');
    if (payload.pick) pick(id);
    else if (payload.key) insert(id, payload.key);
    else
      commit(() => {
        const old = tree.nodes[tree.nodes[payload.id].parent],
          dest = tree.nodes[id];
        M.moveNode(tree, payload.id, id);
        if (old.type === 'C') M.normalize(tree, old.id);
        if (dest.type === 'C' && old !== dest)
          M.setProbProportional(tree, payload.id, 1 / dest.children.length);
      });
  });
  async function openFile(file) {
    try {
      const imported = await io.read(file);
      if (dialog.open) dialog.close();
      commit(() => loadTree(imported), true);
      notify('Arquivo aberto · ' + file.name);
    } catch (err) {
      openDialog('Não foi possível abrir o arquivo', '<p class="alert">' + esc(err.message) + '</p>');
    }
  }
  $('open').onclick = () => $('upload').click();
  $('upload').onchange = (e) => {
    const f = e.target.files[0];
    if (f) openFile(f);
    e.target.value = '';
  };
  $('save').onclick = () => {
    const a = document.createElement('a'),
      url = URL.createObjectURL(
        new Blob([JSON.stringify(project(), null, 2)], { type: 'application/json' })
      );
    a.href = url;
    a.download = (tree.name.replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ').trim() || 'arvore') + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  };
  $('library').onclick = () => {
    openDialog(
      'Biblioteca de exercícios',
      X.list
        .map(
          (ex) =>
            '<button class="exercise" data-example="' +
            ex.key +
            '">' +
            esc(ex.name) +
            '<small>' +
            esc(ex.summary) +
            '</small></button>'
        )
        .join('')
    );
    $('dialog-body')
      .querySelectorAll('[data-example]')
      .forEach(
        (b) =>
          (b.onclick = () => {
            dialog.close();
            commit(() => {
              tree = X.get(b.dataset.example);
            }, true);
          })
      );
  };
  $('new').onclick = () =>
    formDialog(
      'Nova árvore',
      field(
        'Pergunta de decisão',
        'title',
        '',
        'required maxlength="160" placeholder="Investir no projeto?"'
      ) +
        '<label>Estrutura inicial<select name="start"><option value="DSN">Decisão Sim / Não</option><option value="CSN">Chance Sim / Não (50% cada)</option><option value="T">Nó final em branco</option></select></label>',
      'Criar árvore',
      (data) => {
        const title = data.get('title').trim();
        if (!title) throw new Error('Dê um título à árvore.');
        commit(() => {
          tree = M.newTree(title);
          M.applyTemplate(tree, tree.rootId, data.get('start'));
        }, true);
      }
    );
  $('settings').onclick = settings;
  $('statement').onclick = () =>
    openDialog('Enunciado do exercício', '<p class="statement">' + esc(tree.description) + '</p>');
  $('profile').onchange = (e) =>
    commit(() => {
      tree.criterion = e.target.value;
    });
  $('practice').onclick = () => {
    practice = !practice;
    tool = '';
    render();
    remember();
  };
  $('close').onclick = () => dialog.close();
  $('undo').onclick = () => restore(history, future);
  $('redo').onclick = () => restore(future, history);
  $('in').onclick = () => setZoom(zoom * 1.2);
  $('out').onclick = () => setZoom(zoom / 1.2);
  $('fit').onclick = fit;
  document.querySelectorAll('[data-tab]').forEach(
    (b) =>
      (b.onclick = () => {
        tab = b.dataset.tab;
        details();
      })
  );
  window.addEventListener('resize', draw);
  document.addEventListener('keydown', (e) => {
    if (dialog.open || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === 'Escape') {
      tool = '';
      toolsState();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) restore(future, history);
      else restore(history, future);
    }
  });
  render();
})(window.DT);
