import { icon } from '../modules/icons.js'
import { criarSeletorCategoria } from '../modules/seletor-categoria.js'
import { cartoesApi } from '../services/cartoesApi.js'
// Mesmas regras de ciclo/parcelas do servidor (módulo puro): a prévia da tela nunca diverge do que será gravado.
import { montarAgenda, paraCentavos } from '../../server/lib/cartoes.js'

/*
  Seção "Cartões de crédito" do Financeiro.

  Regra financeira (a mesma do servidor): a compra é consumo no mês de cada parcela; o fechamento só consolida a
  fatura; o pagamento da fatura é saída de caixa e não cria despesa. O consumo do cartão chega ao resto da tela
  pelo callback `aoAlterar` (o Financeiro recarrega as despesas), e o pagamento nunca vira movimentação.
*/

const STATUS_ROTULOS = {
  aberta: 'Aberta',
  fechada: 'Fechada',
  parcialmente_paga: 'Parcialmente paga',
  paga: 'Paga',
  vencida: 'Vencida'
}
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const TIPOS = {
  compra: { rotulo: 'Compra', botao: 'Registrar compra', titulo: 'Nova compra', valor: 'Valor total (R$)' },
  estorno: { rotulo: 'Estorno', botao: 'Registrar estorno', titulo: 'Novo estorno', valor: 'Valor estornado (R$)' },
  ajuste: { rotulo: 'Ajuste', botao: 'Registrar ajuste', titulo: 'Novo ajuste', valor: 'Valor do ajuste (R$)' }
}

const $ = (seletor) => document.querySelector(seletor)

function el(tag, classe = '', texto) {
  const e = document.createElement(tag)
  if (classe) e.className = classe
  if (texto !== undefined) e.textContent = texto
  return e
}

const mesRotulo = (mesRef) => `${MESES[Number(mesRef.slice(5, 7)) - 1]}/${mesRef.slice(0, 4)}`
const diaMes = (data) => `${data.slice(8, 10)}/${data.slice(5, 7)}`
const novaChave = () => (crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`)

function mensagemDe(erro) {
  return erro?.message || 'Não foi possível concluir a operação. Tente novamente.'
}

export function iniciarCartoes({ categorias, formatarMoeda, formatarData, mostrarAviso, aoAlterar, hoje }) {
  const secao = $('#cartoes')
  if (!secao) return

  const resumoEl = $('#cards-summary')
  const listaEl = $('#cards-list')
  const conteudoEl = $('#cards-content')
  const abas = secao.querySelectorAll('[data-cards-tab]')
  const filtroMes = $('#cards-filter-month')

  let painel = null // { hoje, cartoes, totais }
  let aba = 'faturas'
  let carregando = true
  let erro = ''
  let itens = [] // faturas ou lançamentos, conforme a aba
  const filtros = { cartao: '', status: '' }

  /* ---------- Seletores (menus suspensos no padrão da página) ---------- */

  const selFiltroCartao = $('#cards-filter-card')
  const selFiltroStatus = $('#cards-filter-status')
  selFiltroStatus.replaceChildren(
    new Option('Todos os status', ''),
    ...Object.entries(STATUS_ROTULOS).map(([valor, rotulo]) => new Option(rotulo, valor))
  )
  const menuFiltroCartao = criarSeletorCategoria({
    select: selFiltroCartao,
    iconeDe: (v) => (v ? 'credit-card' : null),
    placeholder: 'Todos os cartões'
  })
  const menuFiltroStatus = criarSeletorCategoria({ select: selFiltroStatus, placeholder: 'Todos os status' })

  /* ---------- Dados ---------- */

  async function carregar() {
    carregando = true
    erro = ''
    renderConteudo()
    try {
      const de = filtroMes.value ? `${filtroMes.value}-01` : ''
      const ate = filtroMes.value ? `${filtroMes.value}-${String(new Date(Number(filtroMes.value.slice(0, 4)), Number(filtroMes.value.slice(5, 7)), 0).getDate()).padStart(2, '0')}` : ''
      const consulta = { cartao: filtros.cartao, status: filtros.status, de, ate }
      const [p, lista] = await Promise.all([
        cartoesApi.painel(),
        aba === 'faturas' ? cartoesApi.faturas(consulta) : cartoesApi.lancamentos(consulta)
      ])
      painel = p
      itens = lista
    } catch (e) {
      erro = `Não foi possível carregar os cartões (${mensagemDe(e)}).`
    }
    carregando = false
    renderTudo()
  }

  // Depois de qualquer escrita: recarrega a seção e avisa o Financeiro (o consumo muda as despesas do mês).
  async function aposAlterar() {
    await carregar()
    aoAlterar?.()
  }

  const cartaoPorId = (id) => painel?.cartoes.find((c) => c.id === id)
  const cartoesAtivos = () => (painel?.cartoes ?? []).filter((c) => c.ativo)

  /* ---------- Renderização ---------- */

  function chipStatus(status) {
    return el('span', `inv-status is-${status}`, STATUS_ROTULOS[status] ?? status)
  }

  function cartaoResumo(titulo, valor, sub, nomeIcone, destaque) {
    const c = el('article', `summary-card${destaque ? ` ${destaque}` : ''}`)
    const topo = el('div', 'summary-top')
    const chip = el('span', 'chip')
    chip.innerHTML = icon(nomeIcone)
    topo.append(el('span', '', titulo), chip)
    c.append(topo, el('strong', '', valor), el('small', '', sub))
    return c
  }

  function renderResumo() {
    resumoEl.replaceChildren()
    if (!painel) return
    const t = painel.totais
    const prox = t.proximoVencimento
    resumoEl.append(
      cartaoResumo(
        'A pagar em faturas',
        formatarMoeda(t.aPagar),
        t.vencidas ? `${t.vencidas} ${t.vencidas === 1 ? 'fatura vencida' : 'faturas vencidas'}` : 'Saldo pendente de todas as faturas',
        'receipt',
        t.vencidas ? 'is-alert' : ''
      ),
      cartaoResumo(
        'Próximo vencimento',
        prox ? formatarData(prox.vencimento) : '—',
        prox ? `${prox.cartaoNome} · ${formatarMoeda(prox.pendente)}` : 'Nenhuma fatura pendente',
        'calendar'
      ),
      cartaoResumo(
        'Limite disponível',
        formatarMoeda(t.disponivel),
        `de ${formatarMoeda(t.limiteTotal)} nos cartões ativos`,
        'credit-card'
      ),
      cartaoResumo('Pago em faturas no mês', formatarMoeda(t.pagoNoMes), 'Saída de caixa, não é nova despesa', 'wallet')
    )
  }

  function tileCartao(c) {
    const usoPct = c.limite > 0 ? Math.min(100, Math.max(0, (c.usado / c.limite) * 100)) : 0
    const fatura = c.faturaAtual

    const tile = el('article', `card-tile${c.ativo ? '' : ' is-inactive'}`)

    const cabeca = el('div', 'card-tile-head')
    const chip = el('span', 'card-tile-icon')
    chip.innerHTML = icon('credit-card')
    const nomes = el('div', 'card-tile-names')
    nomes.append(el('h3', '', c.nome), el('small', '', c.instituicao || 'Sem instituição'))
    cabeca.append(chip, nomes)
    if (!c.ativo) cabeca.append(el('span', 'card-tile-off', 'Inativo'))

    const barra = el('div', `limit-bar${usoPct >= 85 ? ' is-high' : ''}`)
    barra.setAttribute('role', 'img')
    barra.setAttribute('aria-label', `${Math.round(usoPct)}% do limite comprometido`)
    const preenchimento = el('i')
    preenchimento.style.width = `${usoPct}%`
    barra.append(preenchimento)

    const limites = el('div', 'card-tile-limits')
    const disp = el('span')
    disp.append(el('small', '', 'Disponível'), el('strong', c.disponivel < 0 ? 'is-negative' : '', formatarMoeda(c.disponivel)))
    const lim = el('span')
    lim.append(el('small', '', 'Limite'), el('strong', '', formatarMoeda(c.limite)))
    limites.append(disp, lim)

    const atual = el('div', 'card-tile-invoice')
    const textoAtual = el('span')
    textoAtual.append(
      el('small', '', `Fatura ${mesRotulo(fatura.mesRef)} · vence ${diaMes(fatura.vencimento)}`),
      el('strong', '', formatarMoeda(fatura.total))
    )
    atual.append(textoAtual, chipStatus(fatura.status))

    const dias = el('p', 'card-tile-days', `Fecha dia ${c.diaFechamento} · vence dia ${c.diaVencimento}`)

    const acoes = el('div', 'card-tile-actions')
    if (c.ativo) {
      const comprar = el('button', 'btn btn-small', 'Comprar')
      comprar.type = 'button'
      comprar.addEventListener('click', () => abrirCompra({ cartaoId: c.id }))
      acoes.append(comprar)
    }
    if (fatura.id && fatura.pendente > 0) {
      const pagar = el('button', 'btn btn-small', 'Pagar fatura')
      pagar.type = 'button'
      pagar.addEventListener('click', () => abrirPagamento(fatura.id))
      acoes.append(pagar)
    }
    const editar = el('button', 'btn btn-small', 'Editar')
    editar.type = 'button'
    editar.addEventListener('click', () => abrirCartao(c))
    acoes.append(editar)

    tile.append(cabeca, dias, barra, limites, atual, acoes)
    return tile
  }

  function renderCartoes() {
    listaEl.replaceChildren()
    if (!painel) {
      listaEl.append(el('p', 'empty-state', erro || 'Carregando cartões...'))
      return
    }
    if (painel.cartoes.length === 0) {
      const vazio = el('div', 'cards-empty')
      vazio.append(el('p', 'empty-state', 'Nenhum cartão cadastrado. Cadastre o primeiro para registrar compras e acompanhar as faturas.'))
      listaEl.append(vazio)
      return
    }
    listaEl.append(...painel.cartoes.map(tileCartao))
  }

  function linhaFatura(f) {
    const linha = el('article', 'inv-row')
    const chip = el('span', 'inv-icon')
    chip.innerHTML = icon('receipt')

    const info = el('div', 'inv-info')
    info.append(
      el('h3', '', `${f.cartaoNome} · Fatura ${mesRotulo(f.mesRef)}`),
      el('p', '', `Período ${diaMes(f.inicio)} a ${diaMes(f.fechamento)} · vence ${formatarData(f.vencimento)}`)
    )

    const valores = el('div', 'inv-values')
    valores.append(el('strong', '', formatarMoeda(f.total)))
    valores.append(
      el('small', '', f.pendente > 0 ? `Pago ${formatarMoeda(f.pago)} · pendente ${formatarMoeda(f.pendente)}` : `Pago ${formatarMoeda(f.pago)}`)
    )

    const direita = el('div', 'inv-right')
    const acoes = el('div', 'inv-actions')
    const detalhes = el('button', 'btn btn-small', 'Detalhes')
    detalhes.type = 'button'
    detalhes.addEventListener('click', () => abrirFatura(f.id))
    acoes.append(detalhes)
    if (f.pendente > 0) {
      const pagar = el('button', 'btn btn-small btn-primary', 'Pagar')
      pagar.type = 'button'
      pagar.addEventListener('click', () => abrirPagamento(f.id))
      acoes.append(pagar)
    }
    direita.append(chipStatus(f.status), acoes)

    linha.append(chip, info, valores, direita)
    return linha
  }

  function renderFaturas() {
    if (itens.length === 0) {
      conteudoEl.append(el('p', 'empty-state', 'Nenhuma fatura encontrada para esses filtros.'))
      return
    }
    const futuras = itens
      .filter((f) => f.status !== 'paga' || f.fechamento >= painel.hoje)
      .sort((a, b) => a.vencimento.localeCompare(b.vencimento))
    const historico = itens.filter((f) => !futuras.includes(f)).sort((a, b) => b.vencimento.localeCompare(a.vencimento))

    for (const [titulo, lista] of [['Atuais e futuras', futuras], ['Histórico', historico]]) {
      if (!lista.length) continue
      conteudoEl.append(el('p', 'cards-group-title', titulo))
      const grupo = el('div', 'inv-list')
      grupo.append(...lista.map(linhaFatura))
      conteudoEl.append(grupo)
    }
  }

  function linhaLancamento(l, { acoes = true } = {}) {
    const linha = el('article', 'inv-row is-entry')
    const chip = el('span', 'inv-icon')
    chip.innerHTML = icon(l.tipo === 'estorno' ? 'arrow-left' : l.tipo === 'ajuste' ? 'sliders' : 'credit-card')

    const info = el('div', 'inv-info')
    const titulo = l.parcelas > 1 ? `${l.descricao} (${l.numero}/${l.parcelas})` : l.descricao
    const detalhes = [l.categoria, formatarData(l.competencia)]
    if (l.tipo !== 'compra') detalhes.unshift(l.tipo === 'estorno' ? 'Estorno' : 'Ajuste')
    if (acoes) detalhes.push(`${l.cartaoNome} · fatura ${mesRotulo(l.faturaMes)}`)
    info.append(el('h3', '', titulo), el('p', '', detalhes.join(' · ')))

    const valores = el('div', 'inv-values')
    const credito = l.valor < 0
    valores.append(el('strong', credito ? 'is-credit' : '', `${credito ? '+ ' : '− '}${formatarMoeda(Math.abs(l.valor))}`))

    const direita = el('div', 'inv-right')
    if (acoes && l.statusFatura) direita.append(chipStatus(l.statusFatura))
    if (acoes) {
      const botoes = el('div', 'inv-actions')
      const editar = el('button', 'icon-btn', '')
      editar.type = 'button'
      editar.innerHTML = icon('pencil')
      editar.title = 'Editar'
      editar.setAttribute('aria-label', `Editar ${l.descricao}`)
      editar.addEventListener('click', () => abrirCompra({ lancamento: l }))
      const apagar = el('button', 'icon-btn is-danger', '')
      apagar.type = 'button'
      apagar.innerHTML = icon('trash')
      apagar.title = 'Excluir'
      apagar.setAttribute('aria-label', `Excluir ${l.descricao}`)
      apagar.addEventListener('click', () => excluirCompra(l))
      botoes.append(editar, apagar)
      direita.append(botoes)
    }

    linha.append(chip, info, valores, direita)
    return linha
  }

  function renderLancamentos() {
    if (itens.length === 0) {
      conteudoEl.append(el('p', 'empty-state', 'Nenhum lançamento encontrado para esses filtros.'))
      return
    }
    const lista = el('div', 'inv-list')
    lista.append(...itens.map((l) => linhaLancamento(l)))
    conteudoEl.append(lista)
  }

  function renderConteudo() {
    conteudoEl.replaceChildren()
    if (carregando && !painel) {
      conteudoEl.append(el('p', 'empty-state', 'Carregando...'))
      return
    }
    if (erro) {
      conteudoEl.append(el('p', 'empty-state', erro))
      return
    }
    if (aba === 'faturas') renderFaturas()
    else renderLancamentos()
  }

  function renderFiltros() {
    const cartoes = painel?.cartoes ?? []
    selFiltroCartao.replaceChildren(new Option('Todos os cartões', ''), ...cartoes.map((c) => new Option(c.nome, c.id)))
    selFiltroCartao.value = cartoes.some((c) => c.id === filtros.cartao) ? filtros.cartao : ''
    menuFiltroCartao.atualizar()
    selFiltroStatus.value = filtros.status
    menuFiltroStatus.atualizar()
    // Status é uma propriedade da fatura; em "Lançamentos" ele filtra pela fatura de cada parcela.
  }

  function renderTudo() {
    renderResumo()
    renderCartoes()
    renderFiltros()
    renderConteudo()
  }

  /* ---------- Filtros e abas ---------- */

  abas.forEach((botao) =>
    botao.addEventListener('click', () => {
      if (aba === botao.dataset.cardsTab) return
      aba = botao.dataset.cardsTab
      abas.forEach((b) => b.setAttribute('aria-pressed', String(b === botao)))
      carregar()
    })
  )
  selFiltroCartao.addEventListener('change', () => {
    filtros.cartao = selFiltroCartao.value
    carregar()
  })
  selFiltroStatus.addEventListener('change', () => {
    filtros.status = selFiltroStatus.value
    carregar()
  })
  filtroMes.addEventListener('change', carregar)
  $('#cards-filter-clear').addEventListener('click', () => {
    filtros.cartao = ''
    filtros.status = ''
    filtroMes.value = ''
    carregar()
  })

  /* ---------- Cartão (cadastro/edição) ---------- */

  const dlgCartao = $('#card-dialog')
  const formCartao = $('#card-form')
  const erroCartao = $('#card-error')
  const campoNome = $('#card-name')
  const campoInst = $('#card-institution')
  const campoLimite = $('#card-limit')
  const campoFecha = $('#card-closing')
  const campoVence = $('#card-due')
  const btnAlternar = $('#card-toggle')
  let cartaoEditando = null

  function abrirCartao(cartao = null) {
    cartaoEditando = cartao
    erroCartao.textContent = ''
    $('#card-dialog-title').textContent = cartao ? 'Editar cartão' : 'Novo cartão'
    campoNome.value = cartao?.nome ?? ''
    campoInst.value = cartao?.instituicao ?? ''
    campoLimite.value = cartao ? String(cartao.limite) : ''
    campoFecha.value = cartao ? String(cartao.diaFechamento) : ''
    campoVence.value = cartao ? String(cartao.diaVencimento) : ''
    btnAlternar.hidden = !cartao
    if (cartao) {
      btnAlternar.textContent = cartao.ativo ? 'Desativar cartão' : 'Reativar cartão'
      btnAlternar.classList.toggle('btn-danger', cartao.ativo)
    }
    dlgCartao.showModal()
    campoNome.focus()
  }

  const fecharCartao = () => dlgCartao.close()
  $('#card-cancel').addEventListener('click', fecharCartao)
  $('#card-cancel-x').addEventListener('click', fecharCartao)

  formCartao.addEventListener('submit', async (e) => {
    e.preventDefault()
    const dados = {
      nome: campoNome.value.trim(),
      instituicao: campoInst.value.trim(),
      limite: Number(campoLimite.value),
      diaFechamento: Number(campoFecha.value),
      diaVencimento: Number(campoVence.value)
    }
    if (!dados.nome) return (erroCartao.textContent = 'Informe o nome do cartão.')
    if (!(dados.limite > 0)) return (erroCartao.textContent = 'Informe um limite maior que zero.')
    for (const dia of [dados.diaFechamento, dados.diaVencimento]) {
      if (!Number.isInteger(dia) || dia < 1 || dia > 31) return (erroCartao.textContent = 'Os dias devem ficar entre 1 e 31.')
    }

    const enviar = formCartao.querySelector('[type="submit"]')
    enviar.disabled = true
    try {
      if (cartaoEditando) await cartoesApi.atualizarCartao(cartaoEditando.id, dados)
      else await cartoesApi.criarCartao(dados)
    } catch (falha) {
      erroCartao.textContent = mensagemDe(falha)
      return
    } finally {
      enviar.disabled = false
    }
    fecharCartao()
    await aposAlterar()
  })

  btnAlternar.addEventListener('click', async () => {
    if (!cartaoEditando) return
    const desativar = cartaoEditando.ativo
    if (desativar && !confirm(`Desativar "${cartaoEditando.nome}"? O histórico e as faturas em aberto continuam; só não será possível registrar novas compras.`)) return
    btnAlternar.disabled = true
    try {
      await cartoesApi.atualizarCartao(cartaoEditando.id, { ativo: !desativar })
    } catch (falha) {
      erroCartao.textContent = mensagemDe(falha)
      return
    } finally {
      btnAlternar.disabled = false
    }
    fecharCartao()
    await aposAlterar()
  })

  $('#card-new').addEventListener('click', () => abrirCartao())

  /* ---------- Compra / estorno / ajuste ---------- */

  const dlgCompra = $('#purchase-dialog')
  const formCompra = $('#purchase-form')
  const erroCompra = $('#purchase-error')
  const selCartao = $('#purchase-card')
  const selParcelas = $('#purchase-installments')
  const selSentido = $('#purchase-sense')
  const selCategoria = $('#purchase-category')
  const campoDescricao = $('#purchase-description')
  const campoValor = $('#purchase-amount')
  const campoData = $('#purchase-date')
  const previa = $('#purchase-preview')
  const botoesTipo = dlgCompra.querySelectorAll('[data-kind]')
  let tipoCompra = 'compra'
  let compraEditando = null // lançamento sendo editado (a edição vale para a compra inteira)
  let chaveCompra = novaChave()

  const menuCartao = criarSeletorCategoria({
    select: selCartao,
    iconeDe: () => 'credit-card',
    placeholder: 'Escolha um cartão'
  })
  const menuParcelas = criarSeletorCategoria({ select: selParcelas })
  const menuSentido = criarSeletorCategoria({ select: selSentido })

  function preencherCategorias() {
    selCategoria.replaceChildren(...categorias.opcoes().map((n) => new Option(n, n)))
  }
  const menuCategoria = criarSeletorCategoria({
    select: selCategoria,
    iconeDe: categorias.icone,
    corDe: categorias.cor,
    podeRemover: categorias.podeRemover,
    async aoCriar(nome) {
      const final = await categorias.criar(nome)
      preencherCategorias()
      return final
    },
    async aoRemover(nome) {
      await categorias.remover(nome)
      preencherCategorias()
    }
  })

  function preencherCartoesDaCompra(selecionado) {
    const lista = (painel?.cartoes ?? []).filter((c) => c.ativo || c.id === selecionado)
    selCartao.replaceChildren(...lista.map((c) => new Option(c.instituicao ? `${c.nome} · ${c.instituicao}` : c.nome, c.id)))
    if (selecionado && lista.some((c) => c.id === selecionado)) selCartao.value = selecionado
    menuCartao.atualizar()
  }

  function preencherParcelas() {
    const anterior = Number(selParcelas.value) || 1
    const valor = Number(campoValor.value)
    const opcoes = []
    for (let n = 1; n <= 48; n++) {
      const parcela = valor > 0 && valor * 100 >= n ? ` de ${formatarMoeda(Math.floor(paraCentavos(valor) / n) / 100)}` : ''
      opcoes.push(new Option(n === 1 ? `À vista${valor > 0 ? ` · ${formatarMoeda(valor)}` : ''}` : `${n}×${parcela}`, String(n)))
    }
    selParcelas.replaceChildren(...opcoes)
    selParcelas.value = String(anterior)
    menuParcelas.atualizar()
  }

  function atualizarPrevia() {
    previa.textContent = ''
    const cartao = cartaoPorId(selCartao.value)
    const valor = Number(campoValor.value)
    const parcelas = tipoCompra === 'compra' ? Number(selParcelas.value) || 1 : 1
    if (!cartao || !(valor > 0) || !campoData.value || valor * 100 < parcelas) return

    const { itens: parcelasCalc, ciclos } = montarAgenda({
      data: campoData.value,
      totalCentavos: paraCentavos(valor),
      parcelas,
      diaFechamento: cartao.diaFechamento,
      diaVencimento: cartao.diaVencimento
    })
    const primeira = ciclos[0]
    const ultima = parcelasCalc[parcelasCalc.length - 1]
    const partes = [`Entra na fatura de ${mesRotulo(primeira.mesRef)} (fecha ${diaMes(primeira.fechamento)}, vence ${formatarData(primeira.vencimento)}).`]
    if (parcelas > 1) {
      const igual = parcelasCalc[0].centavos === ultima.centavos
      partes.unshift(
        `${parcelas}× de ${formatarMoeda(parcelasCalc[0].centavos / 100)}${igual ? '' : ` (a última de ${formatarMoeda(ultima.centavos / 100)}, com o ajuste de centavos)`}.`
      )
      partes.push(`Última parcela em ${mesRotulo(ultima.mesRef)}.`)
    }
    previa.textContent = partes.join(' ')
  }

  function definirTipoCompra(tipo) {
    tipoCompra = tipo
    botoesTipo.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === tipo)))
    if (!compraEditando) {
      $('#purchase-dialog-title').textContent = TIPOS[tipo].titulo
      $('#purchase-submit').textContent = TIPOS[tipo].botao
    }
    $('#purchase-installments-field').hidden = tipo !== 'compra'
    $('#purchase-sense-field').hidden = tipo !== 'ajuste'
    $('#purchase-amount-label').textContent = TIPOS[tipo].valor
    if (tipo !== 'compra') selParcelas.value = '1'
    menuParcelas.atualizar()
    atualizarPrevia()
  }

  botoesTipo.forEach((b) => b.addEventListener('click', () => definirTipoCompra(b.dataset.kind)))
  campoValor.addEventListener('input', () => {
    preencherParcelas()
    atualizarPrevia()
  })
  ;[campoData, selCartao, selParcelas].forEach((c) => c.addEventListener('change', atualizarPrevia))

  function abrirCompra({ cartaoId, lancamento = null } = {}) {
    if (!lancamento && cartoesAtivos().length === 0) {
      mostrarAviso('Cadastre um cartão ativo antes de registrar compras.')
      return
    }
    compraEditando = lancamento
    chaveCompra = novaChave()
    erroCompra.textContent = ''
    preencherCartoesDaCompra(lancamento?.cartaoId ?? cartaoId ?? cartoesAtivos()[0]?.id)
    preencherCategorias()

    const editar = Boolean(lancamento)
    $('#purchase-dialog-title').textContent = editar ? 'Editar lançamento' : 'Nova compra'
    $('#purchase-submit').textContent = editar ? 'Salvar alterações' : TIPOS.compra.botao
    $('#purchase-edit-note').hidden = !editar

    campoDescricao.value = lancamento?.descricao ?? ''
    campoValor.value = lancamento ? String(Math.abs(lancamento.valorTotal)) : ''
    campoData.value = lancamento?.dataCompra ?? hoje()
    selSentido.value = lancamento && lancamento.valorTotal < 0 ? 'credito' : 'cobranca'
    menuSentido.atualizar()

    selParcelas.value = '1'
    preencherParcelas()
    selParcelas.value = String(lancamento?.parcelas ?? 1)
    if (lancamento?.categoria && ![...selCategoria.options].some((o) => o.value === lancamento.categoria)) {
      selCategoria.append(new Option(lancamento.categoria, lancamento.categoria))
    }
    if (lancamento?.categoria) selCategoria.value = lancamento.categoria
    menuCategoria.atualizar()

    // Tipo não muda na edição (compra continua compra); só o texto e os valores.
    botoesTipo.forEach((b) => (b.disabled = editar && b.dataset.kind !== (lancamento?.tipo ?? 'compra')))
    definirTipoCompra(lancamento?.tipo ?? 'compra')
    dlgCompra.showModal()
    campoDescricao.focus()
  }

  const fecharCompra = () => dlgCompra.close()
  $('#purchase-cancel').addEventListener('click', fecharCompra)
  $('#purchase-cancel-x').addEventListener('click', fecharCompra)
  $('#purchase-new').addEventListener('click', () => abrirCompra())

  formCompra.addEventListener('submit', async (e) => {
    e.preventDefault()
    const valor = Number(campoValor.value)
    const parcelas = tipoCompra === 'compra' ? Number(selParcelas.value) || 1 : 1
    const dados = {
      cartaoId: selCartao.value,
      tipo: tipoCompra,
      descricao: campoDescricao.value.trim(),
      categoria: selCategoria.value,
      valor: Math.round(valor * 100) / 100,
      parcelas,
      data: campoData.value
    }
    if (tipoCompra === 'ajuste') dados.sentido = selSentido.value

    if (!dados.cartaoId) return (erroCompra.textContent = 'Escolha um cartão.')
    if (!dados.descricao) return (erroCompra.textContent = 'Informe a descrição.')
    if (!(valor > 0)) return (erroCompra.textContent = 'Informe um valor maior que zero.')
    if (valor * 100 < parcelas) return (erroCompra.textContent = 'O valor é pequeno demais para esse número de parcelas.')
    if (!dados.data) return (erroCompra.textContent = 'Informe a data.')
    if (!dados.categoria) return (erroCompra.textContent = 'Escolha uma categoria.')

    const enviar = $('#purchase-submit')
    enviar.disabled = true // evita envio duplo; a chave também protege contra repetição no servidor
    try {
      if (compraEditando) {
        // Só texto mudou: não mexe em parcelas nem exige fatura sem pagamentos.
        const o = compraEditando
        const mudouValores =
          dados.cartaoId !== o.cartaoId ||
          dados.valor !== Math.abs(o.valorTotal) ||
          dados.parcelas !== o.parcelas ||
          dados.data !== o.dataCompra ||
          (tipoCompra === 'ajuste' && (dados.sentido === 'credito') !== o.valorTotal < 0)
        await cartoesApi.atualizarCompra(o.compraId, mudouValores ? dados : { descricao: dados.descricao, categoria: dados.categoria })
      } else {
        await cartoesApi.criarCompra({ ...dados, chave: chaveCompra })
      }
    } catch (falha) {
      erroCompra.textContent = mensagemDe(falha)
      return
    } finally {
      enviar.disabled = false
    }
    chaveCompra = novaChave()
    fecharCompra()
    await aposAlterar()
  })

  async function excluirCompra(l) {
    const varias = l.parcelas > 1 ? ` e todas as ${l.parcelas} parcelas` : ''
    if (!confirm(`Excluir "${l.descricao}"${varias}? A fatura é recalculada.`)) return
    try {
      await cartoesApi.excluirCompra(l.compraId)
    } catch (falha) {
      mostrarAviso(mensagemDe(falha))
      return
    }
    await aposAlterar()
  }

  /* ---------- Pagamento de fatura ---------- */

  const dlgPagamento = $('#payment-dialog')
  const formPagamento = $('#payment-form')
  const erroPagamento = $('#payment-error')
  const campoPago = $('#payment-amount')
  const campoDataPag = $('#payment-date')
  let faturaPagando = null
  let chavePagamento = novaChave()

  async function abrirPagamento(faturaId) {
    let dados
    try {
      dados = await cartoesApi.fatura(faturaId)
    } catch (falha) {
      mostrarAviso(mensagemDe(falha))
      return
    }
    const f = dados.fatura
    if (f.pendente <= 0) {
      mostrarAviso('Esta fatura não tem saldo pendente.')
      return
    }
    faturaPagando = f
    chavePagamento = novaChave()
    erroPagamento.textContent = ''

    const resumo = $('#payment-summary')
    resumo.replaceChildren()
    const linhas = [
      ['Fatura', `${f.cartaoNome} · ${mesRotulo(f.mesRef)}`],
      ['Vencimento', formatarData(f.vencimento)],
      ['Total da fatura', formatarMoeda(f.total)],
      ['Já pago', formatarMoeda(f.pago)],
      ['Saldo pendente', formatarMoeda(f.pendente)]
    ]
    for (const [rotulo, valor] of linhas) {
      const linha = el('div')
      linha.append(el('span', '', rotulo), el('strong', rotulo === 'Saldo pendente' ? 'is-accent' : '', valor))
      resumo.append(linha)
    }
    campoPago.value = String(f.pendente)
    campoPago.max = String(f.pendente)
    campoDataPag.value = hoje()
    if (dlgCompra.open) dlgCompra.close()
    if ($('#invoice-dialog').open) $('#invoice-dialog').close()
    dlgPagamento.showModal()
    campoPago.focus()
    campoPago.select()
  }

  const fecharPagamento = () => dlgPagamento.close()
  $('#payment-cancel').addEventListener('click', fecharPagamento)
  $('#payment-cancel-x').addEventListener('click', fecharPagamento)
  $('#payment-full').addEventListener('click', () => {
    if (faturaPagando) campoPago.value = String(faturaPagando.pendente)
  })

  formPagamento.addEventListener('submit', async (e) => {
    e.preventDefault()
    const valor = Math.round(Number(campoPago.value) * 100) / 100
    if (!(valor > 0)) return (erroPagamento.textContent = 'Informe um valor maior que zero.')
    if (valor > faturaPagando.pendente) return (erroPagamento.textContent = `O valor passa do saldo pendente (${formatarMoeda(faturaPagando.pendente)}).`)
    if (!campoDataPag.value) return (erroPagamento.textContent = 'Informe a data do pagamento.')

    const enviar = $('#payment-submit')
    enviar.disabled = true
    try {
      await cartoesApi.pagar({ faturaId: faturaPagando.id, valor, data: campoDataPag.value, chave: chavePagamento })
    } catch (falha) {
      erroPagamento.textContent = mensagemDe(falha)
      return
    } finally {
      enviar.disabled = false
    }
    chavePagamento = novaChave()
    fecharPagamento()
    await aposAlterar()
  })

  /* ---------- Detalhes da fatura ---------- */

  const dlgFatura = $('#invoice-dialog')

  async function abrirFatura(id) {
    let dados
    try {
      dados = await cartoesApi.fatura(id)
    } catch (falha) {
      mostrarAviso(mensagemDe(falha))
      return
    }
    const { fatura: f, lancamentos, pagamentos } = dados
    const corpo = $('#invoice-body')
    corpo.replaceChildren()

    const cabeca = el('div', 'modal-head')
    const titulo = el('div')
    titulo.append(el('p', 'kicker', f.cartaoNome.toUpperCase()))
    const h2 = el('h2', '', `Fatura ${mesRotulo(f.mesRef)}`)
    h2.id = 'invoice-dialog-title'
    titulo.append(h2)
    const fechar = el('button', 'icon-btn')
    fechar.type = 'button'
    fechar.innerHTML = icon('x')
    fechar.setAttribute('aria-label', 'Fechar')
    fechar.addEventListener('click', () => dlgFatura.close())
    cabeca.append(titulo, fechar)

    const stats = el('div', 'invoice-stats')
    for (const [rotulo, valor, destaque] of [
      ['Total', formatarMoeda(f.total)],
      ['Pago', formatarMoeda(f.pago)],
      ['Pendente', formatarMoeda(f.pendente), f.pendente > 0],
      ['Vencimento', formatarData(f.vencimento)]
    ]) {
      const bloco = el('div')
      bloco.append(el('small', '', rotulo), el('strong', destaque ? 'is-accent' : '', valor))
      stats.append(bloco)
    }
    const periodo = el('p', 'modal-hint')
    periodo.append(chipStatus(f.status), ` Período de ${formatarData(f.inicio)} a ${formatarData(f.fechamento)}.`)

    corpo.append(cabeca, periodo, stats)

    corpo.append(el('p', 'cards-group-title', `Lançamentos (${lancamentos.length})`))
    const lista = el('div', 'inv-list')
    if (lancamentos.length === 0) lista.append(el('p', 'empty-state', 'Nenhum lançamento nesta fatura.'))
    else lista.append(...lancamentos.map((l) => linhaLancamento(l, { acoes: false })))
    corpo.append(lista)

    corpo.append(el('p', 'cards-group-title', `Pagamentos (${pagamentos.length})`))
    const listaPag = el('div', 'inv-list')
    if (pagamentos.length === 0) listaPag.append(el('p', 'empty-state', 'Nenhum pagamento registrado.'))
    for (const p of pagamentos) {
      const linha = el('article', 'inv-row is-entry')
      const chip = el('span', 'inv-icon')
      chip.innerHTML = icon('wallet')
      const info = el('div', 'inv-info')
      info.append(el('h3', '', `Pagamento de ${formatarMoeda(p.valor)}`), el('p', '', formatarData(p.data)))
      const direita = el('div', 'inv-right')
      const apagar = el('button', 'icon-btn is-danger')
      apagar.type = 'button'
      apagar.innerHTML = icon('trash')
      apagar.title = 'Excluir pagamento'
      apagar.setAttribute('aria-label', 'Excluir pagamento')
      apagar.addEventListener('click', async () => {
        if (!confirm('Excluir este pagamento? O valor volta para o saldo pendente da fatura.')) return
        try {
          await cartoesApi.excluirPagamento(p.id)
        } catch (falha) {
          mostrarAviso(mensagemDe(falha))
          return
        }
        dlgFatura.close()
        await aposAlterar()
      })
      direita.append(apagar)
      linha.append(chip, info, el('div', 'inv-values'), direita)
      listaPag.append(linha)
    }
    corpo.append(listaPag)

    const acoes = el('div', 'modal-actions')
    acoes.append(el('span', 'spacer'))
    if (f.pendente > 0) {
      const pagar = el('button', 'btn btn-primary', 'Registrar pagamento')
      pagar.type = 'button'
      pagar.addEventListener('click', () => abrirPagamento(f.id))
      acoes.append(pagar)
    }
    const ok = el('button', 'btn', 'Fechar')
    ok.type = 'button'
    ok.addEventListener('click', () => dlgFatura.close())
    acoes.append(ok)
    corpo.append(acoes)

    dlgFatura.setAttribute('aria-labelledby', 'invoice-dialog-title')
    dlgFatura.showModal()
  }

  /* ---------- Início ---------- */

  renderTudo()
  carregar()

  // Ao voltar para a aba, o status das faturas pode ter mudado com a data (fechamento/vencimento).
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !carregando) carregar()
  })

  return { recarregar: carregar }
}
