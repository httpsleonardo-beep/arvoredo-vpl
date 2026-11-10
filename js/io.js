/* Leitura local da aba Dados. As macros não são executadas. */
(function (DT) {
  'use strict';
  const M = DT.model;
  const tags = (el, name) => Array.from(el.getElementsByTagNameNS('*', name));
  const attr = (el, name) => Array.from(el.attributes).find((a) => a.localName === name)?.value;
  const fail = (msg) => {
    throw new Error(msg);
  };
  function validate(tree) {
    if (!tree || !tree.nodes || !tree.nodes[tree.rootId]) fail('O projeto precisa ter um nó raiz.');
    for (const n of Object.values(tree.nodes)) {
      if (
        !n ||
        !Number.isSafeInteger(+n.id) ||
        +n.id < 1 ||
        (n.value != null && !Number.isFinite(+n.value))
      )
        fail('Confira os identificadores e valores dos ramos.');
    }
    const t = M.migrate(tree);
    t.rootId = Number(t.rootId);
    if (!Number.isSafeInteger(t.nextId) || t.nextId >= Number.MAX_SAFE_INTEGER)
      fail('Identificador de nó inválido.');
    const visited = new Set();
    const walk = (id, parent, depth) => {
      const n = t.nodes[id];
      if (depth > 150 || visited.size >= 2000) fail('Use até 2.000 nós e 150 níveis.');
      if (
        !n ||
        visited.has(id) ||
        n.id !== id ||
        n.parent !== parent ||
        !['D', 'C', 'T'].includes(n.type)
      )
        fail('A estrutura contém uma ligação inválida ou circular.');
      visited.add(id);
      if ((n.type === 'T') !== (n.children.length === 0)) fail('Confira o tipo do nó e seus ramos.');
      if (!Number.isFinite(+n.value)) fail('Valor de ramo inválido.');
      n.branch = String(n.branch || 'Sem nome');
      n.name = String(n.name || '');
      if (
        parent !== null &&
        t.nodes[parent].type === 'C' &&
        (n.prob == null || !Number.isFinite(+n.prob) || n.prob < 0 || n.prob > 1)
      )
        fail('Cada cenário precisa de uma probabilidade entre 0% e 100%.');
      if (n.cf) {
        const cf = n.cf;
        if (
          cf.mode === 'serie' &&
          ['fc', 'inv', 'growth', 'residual'].some((k) => cf[k] != null && !Number.isFinite(+cf[k]))
        )
          fail('Valor inválido na série de fluxos.');
        if (
          !['serie', 'fluxos'].includes(cf.mode) ||
          (cf.mode === 'serie' &&
            (!Number.isInteger(+cf.n) ||
              +cf.n < 1 ||
              !Number.isInteger(+cf.start) ||
              +cf.start < 1 ||
              +cf.n + +cf.start > 1001)) ||
          (cf.mode === 'fluxos' &&
            (!Array.isArray(cf.flows) ||
              !cf.flows.length ||
              cf.flows.length > 1001 ||
              !cf.flows.every((x) => Number.isFinite(+x))))
        )
          fail('Fluxos de caixa inválidos.');
        if (cf.rate != null && (!Number.isFinite(+cf.rate) || +cf.rate <= -100))
          fail('Taxa do ramo inválida.');
      }
      n.children.forEach((k) => walk(k, id, depth + 1));
    };
    walk(t.rootId, null, 0);
    if (visited.size !== Object.keys(t.nodes).length) fail('Há nós sem ligação com a raiz.');
    if (!Number.isFinite(+t.tma) || +t.tma <= -100) fail('A TMA precisa ser maior que −100%.');
    if (t.budget != null && (!Number.isFinite(+t.budget) || t.budget < 0)) fail('Orçamento inválido.');
    if (!['ev', 'maximin', 'spend'].includes(t.criterion)) t.criterion = 'ev';
    t.decimals = Math.min(6, Math.max(0, Math.round(+t.decimals || 0)));
    return t;
  }
  async function xml(zip, path) {
    const file = zip.file(path);
    if (!file) fail('Estrutura de planilha incompleta.');
    const doc = new DOMParser().parseFromString(await file.async('string'), 'application/xml');
    if (tags(doc, 'parsererror').length) fail('XML inválido na planilha.');
    return doc;
  }
  async function odsRows(zip) {
    const doc = await xml(zip, 'content.xml');
    const sheet = tags(doc, 'table').find((e) => attr(e, 'name') === 'Dados');
    if (!sheet) fail('A planilha precisa da aba Dados.');
    return tags(sheet, 'table-row').map((row) => {
      const cells = [];
      for (const c of row.children) {
        if (!['table-cell', 'covered-table-cell'].includes(c.localName)) continue;
        const value =
          attr(c, 'value') ??
          tags(c, 'p')
            .map((p) => p.textContent)
            .join(' ');
        const count = Math.min(21 - cells.length, Number(attr(c, 'number-columns-repeated') || 1));
        for (let i = 0; i < count; i++) cells.push(value);
        if (cells.length === 21) break;
      }
      return cells;
    });
  }
  async function excelRows(zip) {
    const wb = await xml(zip, 'xl/workbook.xml');
    const sheet = tags(wb, 'sheet').find((e) => attr(e, 'name') === 'Dados');
    if (!sheet) fail('A planilha precisa da aba Dados.');
    const rels = await xml(zip, 'xl/_rels/workbook.xml.rels');
    const target = tags(rels, 'Relationship')
      .find((e) => attr(e, 'Id') === attr(sheet, 'id'))
      ?.getAttribute('Target');
    if (!target) fail('A aba Dados não foi localizada.');
    const doc = await xml(
      zip,
      new URL(target, 'https://planilha.local/xl/workbook.xml').pathname.slice(1)
    );
    const strings = zip.file('xl/sharedStrings.xml')
      ? tags(await xml(zip, 'xl/sharedStrings.xml'), 'si').map((e) =>
          tags(e, 't')
            .map((v) => v.textContent)
            .join('')
        )
      : [];
    return tags(doc, 'row').map((row) => {
      const cells = [];
      for (const c of tags(row, 'c')) {
        const letters = (attr(c, 'r') || '').match(/^[A-Z]+/)?.[0];
        if (!letters) continue;
        const col = [...letters].reduce((v, l) => v * 26 + l.charCodeAt(0) - 64, 0) - 1;
        const v = tags(c, 'v')[0]?.textContent;
        cells[col] =
          attr(c, 't') === 's'
            ? strings[Number(v)]
            : attr(c, 't') === 'inlineStr'
              ? tags(c, 't')
                  .map((e) => e.textContent)
                  .join('')
              : v;
      }
      return cells;
    });
  }
  function fromRows(rows) {
    if (
      !rows.length ||
      ['ID', 'Pai', 'Tipo', 'NomeNo', 'Ramo', 'Prob', 'Valor'].some((key, i) => rows[0][i] !== key)
    )
      fail('Cabeçalho incompatível na aba Dados.');
    const t = M.newTree();
    t.nodes = {};
    t.unit = 'u.m.';
    t.objective = String(rows[0][20]).toLowerCase() === 'min' ? 'min' : 'max';
    for (const row of rows.slice(1)) {
      if (!row[0]) continue;
      const [raw, parent, type, name, branch, prob, value] = row;
      const id = Number(raw);
      if (!Number.isSafeInteger(id) || id <= 0 || t.nodes[id])
        fail('Identificador inválido ou repetido na aba Dados.');
      t.nodes[id] = {
        id,
        parent: Number(parent) || null,
        type: type === 'F' ? 'T' : type,
        name,
        branch,
        prob: prob == null || prob === '' ? null : Number(prob),
        value: Number(value || 0),
        children: []
      };
      if (!Number.isFinite(t.nodes[id].value)) fail('Valor inválido na aba Dados.');
    }
    const roots = Object.values(t.nodes).filter((n) => n.parent === null);
    if (roots.length !== 1) fail('A planilha precisa de uma única raiz.');
    for (const n of Object.values(t.nodes)) {
      if (n.parent === null) continue;
      if (!t.nodes[n.parent]) fail('Um ramo referencia um pai inexistente.');
      t.nodes[n.parent].children.push(n.id);
    }
    t.rootId = roots[0].id;
    t.name = roots[0].branch || 'Árvore importada';
    return validate(t);
  }
  async function read(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'json') return validate(JSON.parse(await file.text()));
    if (ext === 'csv') return validate(M.fromCSV(await file.text(), file.name));
    if (!['ods', 'xlsx', 'xlsm'].includes(ext))
      fail('Abra um projeto JSON, uma planilha ODS/Excel ou um CSV da aba Dados.');
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    return fromRows(ext === 'ods' ? await odsRows(zip) : await excelRows(zip));
  }
  DT.io = { read, validate };
})(window.DT);
