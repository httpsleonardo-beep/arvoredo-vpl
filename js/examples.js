/* =====================================================================
   examples.js — exercícios prontos
   (inclui o exemplo das planilhas Arvore_de_Decisao_LibreOffice.ods /
    Arvore_de_Decisao_VBA.xlsm e os exercícios dos PDFs da disciplina)
   ===================================================================== */
(function (DT) {
  'use strict';
  const X = {};

  /** Constrói uma árvore a partir de uma especificação aninhada:
   *  { t:'D'|'C'|'T', n: nome do nó, b: ramo, p: prob, v: valor, cf: {...}, k: [filhos] } */
  X.build = function (meta, spec) {
    const t = DT.model.newTree(meta.name);
    Object.assign(t, meta.settings || {});
    t.description = meta.description || '';
    t.nodes = {}; t.nextId = 1;
    function add(s, parent) {
      const id = t.nextId++;
      t.nodes[id] = {
        id, parent, type: s.t || (s.k && s.k.length ? 'D' : 'T'), name: s.n || '', branch: s.b || '',
        prob: s.p == null ? null : s.p, value: s.v || 0, cf: s.cf || null, children: [], collapsed: false
      };
      if (parent != null) t.nodes[parent].children.push(id);
      (s.k || []).forEach(c => add(c, id));
      return id;
    }
    t.rootId = add(spec, null);
    t.name = meta.name;
    return t;
  };

  X.list = [
    {
      key: 'simnao',
      name: 'Investir? Sim ou Não (modelo básico)',
      summary: 'Decisão Sim/Não com cenário favorável (60%) e desfavorável (40%).',
      description: 'Modelo básico: a empresa decide se investe R$ 500 mil. Se investir, o mercado pode ser favorável (60%, retorno de R$ 1.200 mil) ou desfavorável (40%, retorno de R$ 200 mil).',
      settings: { unit: 'R$', scale: 'mil', tma: 10, riskTolerance: 800 },
      spec: {
        t: 'D', n: 'Decisão', b: 'Investir no projeto?', k: [
          { t: 'C', n: 'Mercado', b: 'Sim – investir', v: -500, k: [
            { b: 'Favorável', p: 0.6, v: 1200 },
            { b: 'Desfavorável', p: 0.4, v: 200 }] },
          { b: 'Não – não investir', v: 0 }]
      }
    },
    {
      key: 'expansao',
      name: 'Expansão: fábrica grande × pequena (VPL por fluxo de caixa)',
      summary: 'Gastar mais × gastar menos, com VPL calculado a partir dos fluxos (TMA 12%) e opção de expandir depois.',
      description: 'A empresa avalia ampliar a capacidade. Fábrica GRANDE (gastar mais): investimento de R$ 1.000 mil; fluxos de R$ 500 mil/ano por 5 anos com demanda alta (60%) ou R$ 150 mil/ano com demanda baixa (40%). Fábrica PEQUENA (gastar menos): R$ 400 mil; R$ 200 mil/ano (alta) ou R$ 115 mil/ano (baixa) e, se a demanda for alta, pode expandir no ano 2 (−R$ 500 mil, +R$ 260 mil/ano nos anos 3 a 5). Todos os valores são trazidos a valor presente com TMA de 12% a.a.',
      settings: { unit: 'R$', scale: 'mil', tma: 12, riskTolerance: 1000, budget: 800, maxLoss: 300, maxLossProb: 30 },
      spec: {
        t: 'D', n: 'Estratégia', b: 'Expansão da capacidade produtiva', k: [
          { t: 'C', n: 'Demanda', b: 'Fábrica grande (gastar mais)', cf: { mode: 'fluxos', flows: [-1000], rate: null }, k: [
            { b: 'Demanda alta', p: 0.6, cf: { mode: 'serie', inv: 0, fc: 500, n: 5, start: 1, residual: 0, growth: 0, rate: null } },
            { b: 'Demanda baixa', p: 0.4, cf: { mode: 'serie', inv: 0, fc: 150, n: 5, start: 1, residual: 0, growth: 0, rate: null } }] },
          { t: 'C', n: 'Demanda', b: 'Fábrica pequena (gastar menos)', cf: { mode: 'fluxos', flows: [-400], rate: null }, k: [
            { t: 'D', n: 'Expandir?', b: 'Demanda alta', p: 0.6, cf: { mode: 'serie', inv: 0, fc: 200, n: 5, start: 1, residual: 0, growth: 0, rate: null }, k: [
              { b: 'Expandir no ano 2', cf: { mode: 'fluxos', flows: [0, 0, -500, 260, 260, 260], rate: null } },
              { b: 'Manter pequena', v: 0 }] },
            { b: 'Demanda baixa', p: 0.4, cf: { mode: 'serie', inv: 0, fc: 115, n: 5, start: 1, residual: 0, growth: 0, rate: null } }] },
          { b: 'Não expandir', v: 0 }]
      }
    },
    {
      key: 'produto',
      name: 'Lançamento do novo produto (exemplo das planilhas)',
      summary: 'Mesmo exemplo das planilhas .ods e .xlsm: lançar já ou fazer pesquisa de mercado. VME = 219,63.',
      description: 'Exemplo das planilhas Arvore_de_Decisao_LibreOffice.ods e Arvore_de_Decisao_VBA.xlsm: lançar já (−400) ou fazer uma pesquisa de mercado (−20) antes de decidir. A pesquisa é favorável com 45% de chance. Resultado esperado da árvore: 219,63 (melhor decisão: fazer a pesquisa).',
      settings: { unit: 'u.m.', scale: '', tma: 10, riskTolerance: 500 },
      spec: {
        t: 'D', n: 'Decisão', b: 'Lançamento do novo produto', k: [
          { t: 'C', n: 'Mercado', b: 'Lançar já', v: -400, k: [
            { b: 'Demanda alta', p: 0.3, v: 1200 }, { b: 'Demanda média', p: 0.4, v: 600 }, { b: 'Demanda baixa', p: 0.3, v: 50 }] },
          { t: 'C', n: 'Resultado da pesquisa', b: 'Fazer pesquisa de mercado', v: -20, k: [
            { t: 'D', n: 'Decisão', b: 'Pesquisa favorável', p: 0.45, v: 0, k: [
              { t: 'C', n: 'Mercado', b: 'Lançar', v: -400, k: [
                { b: 'Demanda alta', p: 0.6, v: 1200 }, { b: 'Demanda média', p: 0.35, v: 600 }, { b: 'Demanda baixa', p: 0.05, v: 50 }] },
              { b: 'Não lançar', v: 0 }] },
            { t: 'D', n: 'Decisão', b: 'Pesquisa desfavorável', p: 0.55, v: 0, k: [
              { t: 'C', n: 'Mercado', b: 'Lançar', v: -400, k: [
                { b: 'Demanda alta', p: 0.05, v: 1200 }, { b: 'Demanda média', p: 0.35, v: 600 }, { b: 'Demanda baixa', p: 0.6, v: 50 }] },
              { b: 'Não lançar', v: 0 }] }] },
          { b: 'Não lançar', v: 0 }]
      }
    },
    {
      key: 'tandem',
      name: 'Tandem Bicycles (slide – Risco e análise)',
      summary: 'Preços agressivos × contratar lobista. Valores em $ mil.',
      description: 'A Tandem Bicycles perde vendas para importados. (1) Preços agressivos: redução de $1,3 milhão; 55% de não perder fluxos para importados e 45% de perder $550 mil. (2) Lobista: custo de $800 mil; 75% de êxito (sem perdas) e, se falhar, perda de $2 milhões. Qual estratégia recomendar?',
      settings: { unit: '$', scale: 'mil', tma: 10, riskTolerance: 1500 },
      spec: {
        t: 'D', n: 'Estratégia', b: 'Defesa contra importados', k: [
          { t: 'C', n: 'Importados', b: 'Preços mais agressivos', v: -1300, k: [
            { b: 'Não perde fluxos', p: 0.55, v: 0 }, { b: 'Perde fluxos', p: 0.45, v: -550 }] },
          { t: 'C', n: 'Lobby', b: 'Contratar lobista', v: -800, k: [
            { b: 'Êxito (tarifas)', p: 0.75, v: 0 }, { b: 'Fracasso', p: 0.25, v: -2000 }] }]
      }
    },
    {
      key: 'romans',
      name: "Roman's Machine (slide – Risco e análise)",
      summary: 'Preços agressivos × consultoria. Valores em $ mil.',
      description: "A Roman's Machine perde vendas para importados. (1) Preços agressivos: redução de $1,2 milhão; 45% de não perder fluxos e 55% de perder $330 mil. (2) Consultoria: custo de $950 mil; 65% de êxito e, se falhar, perda de $2,5 milhões. Estruture a árvore e recomende uma estratégia.",
      settings: { unit: '$', scale: 'mil', tma: 10, riskTolerance: 1500 },
      spec: {
        t: 'D', n: 'Estratégia', b: 'Defesa contra importados', k: [
          { t: 'C', n: 'Importados', b: 'Preços mais agressivos', v: -1200, k: [
            { b: 'Não perde fluxos', p: 0.45, v: 0 }, { b: 'Perde fluxos', p: 0.55, v: -330 }] },
          { t: 'C', n: 'Consultoria', b: 'Contratar consultoria', v: -950, k: [
            { b: 'Êxito', p: 0.65, v: 0 }, { b: 'Fracasso', p: 0.35, v: -2500 }] }]
      }
    },
    {
      key: 'loteria',
      name: 'Bilhete de loteria (slide – EMV)',
      summary: 'Manter o bilhete (45% de R$10) ou trocar pagando R$1 (20% de R$25)?',
      description: 'Você tem um bilhete com 45% de chance de ganhar R$ 10,00 (55% de nada). Seu amigo oferece um bilhete com 20% de chance de ganhar R$ 25,00 (80% de nada) por mais R$ 1,00. Trocar ou manter?',
      settings: { unit: 'R$', scale: '', tma: 0, riskTolerance: 20 },
      spec: {
        t: 'D', n: 'Decisão', b: 'Trocar o bilhete?', k: [
          { t: 'C', n: 'Sorteio', b: 'Manter meu bilhete', v: 0, k: [
            { b: 'Ganhar R$ 10', p: 0.45, v: 10 }, { b: 'Não ganhar', p: 0.55, v: 0 }] },
          { t: 'C', n: 'Sorteio', b: 'Trocar (pagar R$ 1)', v: -1, k: [
            { b: 'Ganhar R$ 25', p: 0.2, v: 25 }, { b: 'Não ganhar', p: 0.8, v: 0 }] }]
      }
    },
    {
      key: 'gpc',
      name: 'GPC – produtos A, B ou C (estudo de caso)',
      summary: 'Árvore com várias etapas: atraso na produção, preço alto/baixo e vendas. Valores em $ milhões.',
      description: 'Estudo de caso GPC: C é livre de risco ($1 mi). B: vendas altas $8 mi (38%), médias $4 mi (12%), baixas $0 (50%). A: 5% de chance de atraso; depois decide preço alto ou baixo; com preço alto, P(vendas altas) = 40% sem atraso e 30% com atraso. Com preço baixo o enunciado diz não haver diferença significativa entre vendas altas e baixas — aqui adotamos 50%/50% (altere se o professor indicar outro valor).',
      settings: { unit: '$', scale: 'milhões', tma: 10, riskTolerance: 5, decimals: 4 },
      spec: {
        t: 'D', n: 'Produto', b: 'Qual produto lançar?', k: [
          { t: 'C', n: 'Produção', b: 'Produto A', v: 0, k: [
            { t: 'D', n: 'Preço', b: 'Com atraso', p: 0.05, k: [
              { t: 'C', n: 'Vendas', b: 'Preço alto', k: [{ b: 'Vendas altas', p: 0.3, v: 5 }, { b: 'Vendas baixas', p: 0.7, v: -0.5 }] },
              { t: 'C', n: 'Vendas', b: 'Preço baixo', k: [{ b: 'Vendas altas', p: 0.5, v: 3.5 }, { b: 'Vendas baixas', p: 0.5, v: 1 }] }] },
            { t: 'D', n: 'Preço', b: 'Sem atraso', p: 0.95, k: [
              { t: 'C', n: 'Vendas', b: 'Preço alto', k: [{ b: 'Vendas altas', p: 0.4, v: 8 }, { b: 'Vendas baixas', p: 0.6, v: 0 }] },
              { t: 'C', n: 'Vendas', b: 'Preço baixo', k: [{ b: 'Vendas altas', p: 0.5, v: 4.5 }, { b: 'Vendas baixas', p: 0.5, v: 1.5 }] }] }] },
          { t: 'C', n: 'Vendas', b: 'Produto B', v: 0, k: [
            { b: 'Vendas altas', p: 0.38, v: 8 }, { b: 'Vendas médias', p: 0.12, v: 4 }, { b: 'Vendas baixas', p: 0.5, v: 0 }] },
          { b: 'Produto C (sem risco)', v: 1 }]
      }
    }
  ];

  X.get = function (key) {
    const ex = X.list.find(e => e.key === key);
    if (!ex) return null;
    return X.build(ex, JSON.parse(JSON.stringify(ex.spec)));
  };

  DT.examples = X;
})(window.DT);
