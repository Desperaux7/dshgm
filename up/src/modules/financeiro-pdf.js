import { DocumentoPDF, hex } from '../services/pdf.js'

/* Relatório financeiro em PDF (A4, várias páginas).
   Recebe os dados já filtrados pela tela: o que aparece no período e nos filtros é o que sai no documento. */

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const brl = (valor) => moeda.format(valor)

const TIPOS = { income: 'Receita', expense: 'Despesa', saving: 'Guardado' }

const COR = {
  fundo: hex('#0b2a2e'),
  destaque: hex('#5eead4'),
  titulo: hex('#0f1f21'),
  texto: hex('#243436'),
  suave: hex('#6b7f81'),
  linha: hex('#d6e4e2'),
  zebra: hex('#f4f9f8'),
  cartao: hex('#f1f7f6'),
  saldo: hex('#0f766e'),
  entrada: hex('#047857'),
  despesa: hex('#c2374a'),
  guardado: hex('#0e7490')
}

const MARGEM = 40
const RODAPE = 46

const dataBR = (iso) => {
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

function somar(lista, tipo) {
  return lista.filter((t) => t.type === tipo).reduce((total, t) => total + t.amount, 0)
}

/**
 * @param {object} dados
 * @param {Array} dados.periodo      todas as movimentações do período (base do resumo)
 * @param {Array} dados.exibidas     movimentações do período já filtradas por tipo (tabela)
 * @param {string} dados.rotuloPeriodo
 * @param {string} dados.rotuloFiltro
 * @param {number} dados.totalGuardado  guardado acumulado (independente do período)
 * @returns {Blob}
 */
export function gerarRelatorioFinanceiro({ periodo, exibidas, rotuloPeriodo, rotuloFiltro, totalGuardado }) {
  const doc = new DocumentoPDF({ titulo: `Relatório financeiro - ${rotuloPeriodo}` })
  const L = doc.largura
  const A = doc.altura
  const largUtil = L - MARGEM * 2
  const limite = A - RODAPE - 12

  const entradas = somar(periodo, 'income')
  const despesas = somar(periodo, 'expense')
  const guardado = somar(periodo, 'saving')
  const saldo = entradas - despesas - guardado

  let y = 0

  /* ---------- Cabeçalho (primeira página) ---------- */

  doc.novaPagina()
  doc.retangulo(0, 0, L, 104, { preenchimento: COR.fundo })
  doc.retangulo(0, 104, L, 3, { preenchimento: COR.destaque })

  doc.texto('DASHBOARD PESSOAL', MARGEM, 34, { tam: 8, negrito: true, cor: COR.destaque })
  doc.texto('Relatório financeiro', MARGEM, 60, { tam: 22, negrito: true, cor: [255, 255, 255] })
  doc.texto(`Período: ${rotuloPeriodo}`, MARGEM, 82, { tam: 10.5, cor: hex('#bfe9e3') })

  const geradoEm = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  doc.texto('Gerado em', L - MARGEM, 34, { tam: 8, cor: hex('#8fc9c1'), alinhar: 'direita' })
  doc.texto(geradoEm, L - MARGEM, 48, { tam: 10, negrito: true, cor: [255, 255, 255], alinhar: 'direita' })
  doc.texto(`Movimentações: ${rotuloFiltro}`, L - MARGEM, 82, { tam: 10.5, cor: hex('#bfe9e3'), alinhar: 'direita' })

  y = 132

  /* ---------- Resumo ---------- */

  const cartoes = [
    { rotulo: 'Saldo do período', valor: saldo, cor: saldo < 0 ? COR.despesa : COR.saldo },
    { rotulo: 'Total de receitas', valor: entradas, cor: COR.entrada },
    { rotulo: 'Total de despesas', valor: despesas, cor: COR.despesa },
    { rotulo: 'Dinheiro guardado', valor: guardado, cor: COR.guardado }
  ]
  const espaco = 10
  const larguraCartao = (largUtil - espaco * 3) / 4

  cartoes.forEach((c, i) => {
    const x = MARGEM + i * (larguraCartao + espaco)
    doc.retangulo(x, y, larguraCartao, 58, { preenchimento: COR.cartao, borda: COR.linha })
    doc.retangulo(x, y, 3, 58, { preenchimento: c.cor })
    doc.texto(c.rotulo, x + 12, y + 20, { tam: 8.5, cor: COR.suave })

    const texto = brl(c.valor)
    let tam = 14
    while (tam > 8 && doc.medir(texto, { tam, negrito: true }) > larguraCartao - 22) tam -= 0.5
    doc.texto(texto, x + 12, y + 41, { tam, negrito: true, cor: c.cor })
  })
  y += 58 + 14

  const nota = doc.truncar(
    `Saldo = receitas - despesas - dinheiro guardado no período. Total guardado acumulado: ${brl(totalGuardado)}.`,
    largUtil,
    { tam: 8 }
  )
  doc.texto(nota, MARGEM, y, { tam: 8, cor: COR.suave })
  y += 26

  /* ---------- Funções de paginação ---------- */

  function novaPagina() {
    doc.novaPagina()
    y = MARGEM + 6
  }

  function garantir(altura, aoQuebrar) {
    if (y + altura <= limite) return
    novaPagina()
    aoQuebrar?.()
  }

  function titulo(texto, detalhe = '') {
    doc.texto(texto, MARGEM, y, { tam: 12.5, negrito: true, cor: COR.titulo })
    if (detalhe) doc.texto(detalhe, L - MARGEM, y, { tam: 9, cor: COR.suave, alinhar: 'direita' })
    doc.linha(MARGEM, y + 8, L - MARGEM, y + 8, { cor: COR.linha, espessura: 0.8 })
    y += 24
  }

  /* ---------- Despesas por categoria ---------- */

  const porCategoria = new Map()
  periodo
    .filter((t) => t.type === 'expense')
    .forEach((t) => porCategoria.set(t.category, (porCategoria.get(t.category) ?? 0) + t.amount))

  if (porCategoria.size) {
    const linhas = [...porCategoria.entries()].sort((a, b) => b[1] - a[1])
    garantir(24 + Math.min(linhas.length, 3) * 22)
    titulo('Despesas por categoria', `${linhas.length} ${linhas.length === 1 ? 'categoria' : 'categorias'}`)

    const colValor = L - MARGEM
    const colPct = colValor - 100
    const inicioBarra = MARGEM + 150
    const larguraBarra = colPct - inicioBarra - 16

    linhas.forEach(([categoria, valor]) => {
      garantir(22, () => titulo('Despesas por categoria (continuação)'))
      const pct = despesas ? valor / despesas : 0

      doc.texto(doc.truncar(categoria, 140, { tam: 9.5 }), MARGEM, y, { tam: 9.5, cor: COR.texto })
      doc.retangulo(inicioBarra, y - 7, larguraBarra, 7, { preenchimento: COR.zebra })
      if (pct > 0) doc.retangulo(inicioBarra, y - 7, Math.max(larguraBarra * pct, 1.5), 7, { preenchimento: COR.despesa })
      doc.texto(`${Math.round(pct * 100)}%`, colPct, y, { tam: 9, cor: COR.suave, alinhar: 'direita' })
      doc.texto(brl(valor), colValor, y, { tam: 9.5, negrito: true, cor: COR.texto, alinhar: 'direita' })
      y += 22
    })
    y += 10
  }

  /* ---------- Movimentações ---------- */

  const col = {
    data: MARGEM + 8,
    descricao: MARGEM + 76,
    categoria: MARGEM + 296,
    tipo: MARGEM + 388,
    valor: L - MARGEM - 8
  }
  const larguraDescricao = col.categoria - col.descricao - 10
  const larguraCategoria = col.tipo - col.categoria - 10

  function cabecalhoTabela() {
    doc.retangulo(MARGEM, y - 12, largUtil, 20, { preenchimento: COR.fundo })
    const opc = { tam: 8.5, negrito: true, cor: [255, 255, 255] }
    doc.texto('DATA', col.data, y + 1, opc)
    doc.texto('DESCRIÇÃO', col.descricao, y + 1, opc)
    doc.texto('CATEGORIA', col.categoria, y + 1, opc)
    doc.texto('TIPO', col.tipo, y + 1, opc)
    doc.texto('VALOR', col.valor, y + 1, { ...opc, alinhar: 'direita' })
    y += 18
  }

  garantir(24 + 20 + 22)
  titulo('Movimentações', `${exibidas.length} ${exibidas.length === 1 ? 'registro' : 'registros'}`)

  if (exibidas.length === 0) {
    doc.texto('Nenhuma movimentação para os filtros selecionados.', MARGEM, y + 4, { tam: 10, cor: COR.suave })
    y += 30
  } else {
    cabecalhoTabela()

    exibidas.forEach((t, i) => {
      garantir(22, cabecalhoTabela)

      if (i % 2 === 0) doc.retangulo(MARGEM, y - 12, largUtil, 20, { preenchimento: COR.zebra })

      const cor = t.type === 'income' ? COR.entrada : t.type === 'expense' ? COR.despesa : COR.guardado
      const sinal = t.type === 'income' ? '+ ' : t.type === 'expense' ? '- ' : ''

      doc.texto(dataBR(t.date), col.data, y + 1, { tam: 9, cor: COR.texto })
      doc.texto(doc.truncar(t.description, larguraDescricao, { tam: 9 }), col.descricao, y + 1, { tam: 9, cor: COR.titulo })
      doc.texto(doc.truncar(t.category, larguraCategoria, { tam: 9 }), col.categoria, y + 1, { tam: 9, cor: COR.texto })
      doc.texto(TIPOS[t.type] ?? t.type, col.tipo, y + 1, { tam: 9, cor })
      doc.texto(`${sinal}${brl(t.amount)}`, col.valor, y + 1, { tam: 9, negrito: true, cor, alinhar: 'direita' })
      y += 20
    })

    // Totais do que está listado
    garantir(60)
    y += 6
    doc.linha(MARGEM, y - 10, L - MARGEM, y - 10, { cor: COR.linha, espessura: 0.8 })

    const totais = [
      ['Receitas listadas', somar(exibidas, 'income'), COR.entrada],
      ['Despesas listadas', somar(exibidas, 'expense'), COR.despesa],
      ['Guardado listado', somar(exibidas, 'saving'), COR.guardado]
    ].filter(([, valor]) => valor > 0)

    totais.forEach(([rotulo, valor, cor]) => {
      doc.texto(rotulo, col.valor - 120, y + 2, { tam: 9, cor: COR.suave, alinhar: 'direita' })
      doc.texto(brl(valor), col.valor, y + 2, { tam: 9.5, negrito: true, cor, alinhar: 'direita' })
      y += 16
    })
  }

  /* ---------- Rodapé em todas as páginas ---------- */

  const total = doc.total
  for (let p = 1; p <= total; p++) {
    doc.irParaPagina(p)
    doc.linha(MARGEM, A - RODAPE, L - MARGEM, A - RODAPE, { cor: COR.linha })
    doc.texto('Dashboard Pessoal · Relatório financeiro', MARGEM, A - RODAPE + 16, { tam: 8, cor: COR.suave })
    doc.texto(`Página ${p} de ${total}`, L - MARGEM, A - RODAPE + 16, { tam: 8, cor: COR.suave, alinhar: 'direita' })
  }

  return doc.blob()
}

export function nomeArquivoFinanceiro(ano, mes) {
  if (ano === 'all') return 'financeiro-todo-o-periodo.pdf'
  return mes === 'all' ? `financeiro-${ano}.pdf` : `financeiro-${ano}-${mes}.pdf`
}

export function baixarArquivo(blob, nome) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = nome
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
