import { icon } from '../modules/icons.js'
import { iniciarShell, mostrarAviso } from '../modules/shell.js'
import { desejosApi } from '../services/desejosApi.js'
import {
  PRIORIDADES,
  STATUS,
  calcularTotais,
  filtrar,
  formatarBRL,
  ordenar,
  prioridadeDe,
  validarProduto
} from '../modules/desejos.js'

iniciarShell({ pagina: 'desejos' })

const $ = (seletor) => document.querySelector(seletor)
const el = (tag, classe = '', texto) => {
  const e = document.createElement(tag)
  if (classe) e.className = classe
  if (texto !== undefined) e.textContent = texto
  return e
}
const textoErro = (erro) => erro?.message || 'Não foi possível concluir a operação. Tente novamente.'
const dataBR = (ms) => new Date(ms).toLocaleDateString('pt-BR')

let itens = []
let totais = calcularTotais([])
let carregado = false
let erroCarga = ''
const filtros = { prioridade: 'todas', status: 'todos' }

const listaEl = $('#wish-list')

/* ---------- Carga ---------- */

async function carregar() {
  erroCarga = ''
  renderizar()
  try {
    const dados = await desejosApi.listar()
    itens = ordenar(dados.itens)
    totais = dados.totais
    carregado = true
  } catch (falha) {
    erroCarga = `Não foi possível carregar a lista (${textoErro(falha)}).`
  }
  renderizar()
}

/* ---------- Resumo ---------- */

function renderTotais() {
  $('#wish-sum-desired').textContent = formatarBRL(totais.valorDesejado)
  $('#wish-sum-bought').textContent = formatarBRL(totais.valorComprado)
  $('#wish-sum-total').textContent = formatarBRL(totais.valorTotal)
  $('#wish-sum-count').textContent = String(totais.quantidade)
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`
  $('#wish-sum-desired-note').textContent = plural(totais.desejados, 'item ainda não comprado', 'itens ainda não comprados')
  $('#wish-sum-bought-note').textContent = plural(totais.comprados, 'item já adquirido', 'itens já adquiridos')
}

/* ---------- Filtros ---------- */

function renderFiltros() {
  const montar = (alvo, opcoes, chave) => {
    alvo.replaceChildren(
      ...opcoes.map(([id, rotulo]) => {
        const b = el('button', '', rotulo)
        b.type = 'button'
        b.setAttribute('aria-pressed', String(filtros[chave] === id))
        b.addEventListener('click', () => {
          filtros[chave] = id
          renderizar()
        })
        return b
      })
    )
  }
  montar($('#wish-filter-priority'), [['todas', 'Todas as prioridades'], ...PRIORIDADES.map((p) => [p.id, p.nome])], 'prioridade')
  montar($('#wish-filter-status'), [['todos', 'Todos'], ['desejado', 'Desejados'], ['comprado', 'Comprados']], 'status')
}

/* ---------- Cards ---------- */

function criarImagem(item) {
  const caixa = el('div', 'wish-image')
  const marcador = el('span', 'wish-placeholder')
  marcador.innerHTML = icon('gift')
  caixa.append(marcador)

  if (item.imagemUrl) {
    const img = new Image()
    img.alt = ''
    img.loading = 'lazy'
    img.decoding = 'async'
    img.referrerPolicy = 'no-referrer'
    // Imagem indisponível: fica o marcador do tema, sem ícone de imagem quebrada.
    img.addEventListener('load', () => caixa.replaceChildren(img))
    img.src = item.imagemUrl
  }
  return caixa
}

function criarCard(item) {
  const comprado = item.status === 'comprado'
  const prioridade = prioridadeDe(item.prioridade)

  const card = el('article', `wish-card${comprado ? ' is-bought' : ''} priority-${prioridade.id}`)

  const topo = el('div', 'wish-image-wrap')
  topo.append(criarImagem(item))

  const faixa = el('div', 'wish-badges')
  const prio = el('span', `wish-priority is-${prioridade.id}`)
  prio.append(el('i'), document.createTextNode(`Prioridade ${prioridade.nome.toLowerCase()}`))
  faixa.append(prio)
  if (comprado) {
    const tag = el('span', 'wish-bought-tag')
    tag.innerHTML = `${icon('check')}<span>Comprado</span>`
    faixa.append(tag)
  }
  topo.append(faixa)

  const acoes = el('div', 'wish-card-actions')
  const editar = el('button', 'icon-btn')
  editar.type = 'button'
  editar.innerHTML = icon('pencil')
  editar.title = 'Editar'
  editar.setAttribute('aria-label', `Editar ${item.nome}`)
  editar.addEventListener('click', () => abrirDialogo(item))
  const apagar = el('button', 'icon-btn is-danger')
  apagar.type = 'button'
  apagar.innerHTML = icon('trash')
  apagar.title = 'Excluir'
  apagar.setAttribute('aria-label', `Excluir ${item.nome}`)
  apagar.addEventListener('click', () => confirmarExclusao(item))
  acoes.append(editar, apagar)
  topo.append(acoes)

  const corpo = el('div', 'wish-body')
  const titulo = el('h3', 'wish-name')
  titulo.title = item.nome
  titulo.textContent = item.nome
  corpo.append(titulo)
  if (item.descricao) corpo.append(el('p', 'wish-description', item.descricao))

  const preco = el('strong', 'wish-price', formatarBRL(item.preco))
  const linha = el('div', 'wish-price-row')
  linha.append(preco, el('small', '', 'preço médio'))
  corpo.append(linha)
  if (comprado && item.compradoEm) corpo.append(el('small', 'wish-bought-date', `Comprado em ${dataBR(item.compradoEm)}`))

  const rodape = el('div', 'wish-footer')
  // O link só existe quando foi cadastrado: nada de botão vazio nem espaço reservado.
  if (item.linkUrl) {
    const ver = el('a', 'wish-link')
    ver.href = item.linkUrl
    ver.target = '_blank'
    ver.rel = 'noopener noreferrer'
    ver.setAttribute('aria-label', `Ver ${item.nome} na loja (abre em nova aba)`)
    ver.innerHTML = `${icon('external')}<span>Ver produto</span>`
    rodape.append(ver)
  }
  const comprar = el('button', `wish-buy${comprado ? ' is-undo' : ''}`)
  comprar.type = 'button'
  comprar.innerHTML = comprado ? `${icon('arrow-left')}<span>Desfazer compra</span>` : `${icon('check')}<span>Marcar como comprado</span>`
  comprar.addEventListener('click', () => alternarCompra(item, comprar))
  rodape.append(comprar)

  card.append(topo, corpo, rodape)
  return card
}

function renderLista() {
  listaEl.replaceChildren()

  if (erroCarga) {
    const caixa = el('div', 'wish-state is-error')
    caixa.append(el('strong', '', 'Algo deu errado'), el('p', '', erroCarga))
    const tentar = el('button', 'btn', 'Tentar novamente')
    tentar.type = 'button'
    tentar.addEventListener('click', carregar)
    caixa.append(tentar)
    listaEl.append(caixa)
    return
  }

  if (!carregado) {
    listaEl.append(el('p', 'wish-state', 'Carregando sua lista...'))
    return
  }

  if (itens.length === 0) {
    const caixa = el('div', 'wish-state is-empty')
    const marca = el('span', 'wish-empty-icon')
    marca.innerHTML = icon('gift')
    caixa.append(marca, el('strong', '', 'Sua lista de desejos está vazia'), el('p', '', 'Cadastre o primeiro produto para acompanhar preço, prioridade e o que já foi comprado.'))
    const adicionar = el('button', 'btn btn-primary', 'Adicionar o primeiro produto')
    adicionar.type = 'button'
    adicionar.addEventListener('click', () => abrirDialogo())
    caixa.append(adicionar)
    listaEl.append(caixa)
    return
  }

  const visiveis = filtrar(itens, filtros)
  if (visiveis.length === 0) {
    const caixa = el('div', 'wish-state')
    caixa.append(el('strong', '', 'Nenhum produto com esses filtros'))
    const limpar = el('button', 'btn', 'Limpar filtros')
    limpar.type = 'button'
    limpar.addEventListener('click', () => {
      filtros.prioridade = 'todas'
      filtros.status = 'todos'
      renderizar()
    })
    caixa.append(limpar)
    listaEl.append(caixa)
    return
  }

  const grade = el('div', 'wish-grid')
  grade.append(...visiveis.map(criarCard))
  listaEl.append(grade)
}

function renderizar() {
  renderTotais()
  renderFiltros()
  renderLista()
}

/* ---------- Compra / desfazer ---------- */

async function alternarCompra(item, botao) {
  const novo = item.status === 'comprado' ? 'desejado' : 'comprado'
  const anterior = itens
  const anteriorTotais = totais

  // Resposta imediata na tela; o servidor confirma os totais oficiais logo depois.
  itens = ordenar(itens.map((i) => (i.id === item.id ? { ...i, status: novo, compradoEm: novo === 'comprado' ? Date.now() : null } : i)))
  totais = calcularTotais(itens)
  renderizar()
  botao.disabled = true

  try {
    const r = await desejosApi.atualizar(item.id, { status: novo })
    itens = ordenar(itens.map((i) => (i.id === item.id ? r.item : i)))
    totais = r.totais
    renderizar()
    mostrarAviso(novo === 'comprado' ? 'Marcado como comprado.' : 'Compra desfeita.')
  } catch (falha) {
    itens = anterior
    totais = anteriorTotais
    renderizar()
    mostrarAviso(textoErro(falha))
  }
}

/* ---------- Exclusão ---------- */

const dlgConfirmar = $('#wish-confirm')
let itemParaExcluir = null

function confirmarExclusao(item) {
  itemParaExcluir = item
  $('#wish-confirm-text').textContent = `"${item.nome}" será removido da lista de forma definitiva. Para guardar o histórico sem excluir, use "Marcar como comprado".`
  dlgConfirmar.showModal()
  $('#wish-confirm-cancel').focus()
}

$('#wish-confirm-cancel').addEventListener('click', () => dlgConfirmar.close())
$('#wish-confirm-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const item = itemParaExcluir
  if (!item) return
  const botao = $('#wish-confirm-ok')
  botao.disabled = true
  try {
    const r = await desejosApi.excluir(item.id)
    itens = itens.filter((i) => i.id !== item.id)
    totais = r.totais
    dlgConfirmar.close()
    renderizar()
    mostrarAviso('Produto excluído.')
  } catch (falha) {
    dlgConfirmar.close()
    mostrarAviso(textoErro(falha))
  } finally {
    botao.disabled = false
    itemParaExcluir = null
  }
})

/* ---------- Cadastro e edição ---------- */

const dlg = $('#wish-dialog')
const form = $('#wish-form')
const campos = {
  nome: $('#wish-name'),
  preco: $('#wish-price'),
  descricao: $('#wish-description'),
  linkUrl: $('#wish-link'),
  imagemUrl: $('#wish-image-url')
}
const erroDe = { nome: $('#wish-name-error'), preco: $('#wish-price-error'), descricao: $('#wish-description-error'), linkUrl: $('#wish-link-error'), imagemUrl: $('#wish-image-url-error') }
const erroGeral = $('#wish-error')
const previa = $('#wish-image-preview')
const previaVazia = $('#wish-image-empty')
const previaCaixa = $('#wish-image-box')
const previaNota = $('#wish-image-note')
let editando = null
let prioridadeAtual = 'media'
let statusAtual = 'desejado'

function montarSeg(alvo, opcoes, atual, aoEscolher) {
  alvo.replaceChildren(
    ...opcoes.map((o) => {
      const b = el('button', `wish-seg-btn${o.classe ? ` ${o.classe}` : ''}`, o.nome)
      b.type = 'button'
      b.dataset.valor = o.id
      b.setAttribute('aria-pressed', String(o.id === atual))
      b.addEventListener('click', () => {
        aoEscolher(o.id)
        alvo.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)))
      })
      return b
    })
  )
}

function montarSegmentados() {
  montarSeg(
    $('#wish-priority'),
    PRIORIDADES.map((p) => ({ ...p, classe: `is-${p.id}` })),
    prioridadeAtual,
    (v) => (prioridadeAtual = v)
  )
  montarSeg($('#wish-status'), STATUS, statusAtual, (v) => (statusAtual = v))
}

// Pré-visualização da imagem antes de salvar. Falha de carregamento não impede o cadastro (alguns sites bloqueiam
// o uso externo da imagem); só avisamos para o usuário conferir o endereço.
let tokenPrevia = 0
let temporizadorPrevia
function atualizarPrevia() {
  clearTimeout(temporizadorPrevia)
  const url = campos.imagemUrl.value.trim()
  const meu = ++tokenPrevia
  previa.hidden = true
  previaVazia.hidden = false
  previaCaixa.classList.remove('is-error')
  previaNota.textContent = ''
  if (!url) return

  const { erros } = validarProduto({ nome: 'x', preco: 0, prioridade: 'media', status: 'desejado', imagemUrl: url })
  if (erros.imagemUrl) {
    previaCaixa.classList.add('is-error')
    previaNota.textContent = erros.imagemUrl
    return
  }
  previaNota.textContent = 'Carregando pré-visualização...'
  temporizadorPrevia = setTimeout(() => {
    const teste = new Image()
    teste.referrerPolicy = 'no-referrer'
    teste.onload = () => {
      if (meu !== tokenPrevia) return
      previa.src = url
      previa.hidden = false
      previaVazia.hidden = true
      previaNota.textContent = ''
    }
    teste.onerror = () => {
      if (meu !== tokenPrevia) return
      previaCaixa.classList.add('is-error')
      previaNota.textContent = 'Não foi possível carregar essa imagem. Confira o endereço; você ainda pode salvar.'
    }
    teste.src = url
  }, 350)
}

function limparErros() {
  erroGeral.textContent = ''
  for (const e of Object.values(erroDe)) e.textContent = ''
  for (const c of Object.values(campos)) c.removeAttribute('aria-invalid')
}

function mostrarErros(erros) {
  for (const [campo, msg] of Object.entries(erros)) {
    if (erroDe[campo]) {
      erroDe[campo].textContent = msg
      campos[campo].setAttribute('aria-invalid', 'true')
    } else {
      erroGeral.textContent = msg
    }
  }
  const primeiro = Object.keys(erros).find((c) => campos[c])
  if (primeiro) campos[primeiro].focus()
}

function abrirDialogo(item = null) {
  editando = item
  limparErros()
  $('#wish-dialog-kicker').textContent = item ? 'EDITAR PRODUTO' : 'NOVO PRODUTO'
  $('#wish-dialog-title').textContent = item ? 'Editar produto' : 'Adicionar à lista'
  campos.nome.value = item?.nome ?? ''
  campos.preco.value = item ? String(item.preco).replace('.', ',') : ''
  campos.descricao.value = item?.descricao ?? ''
  campos.linkUrl.value = item?.linkUrl ?? ''
  campos.imagemUrl.value = item?.imagemUrl ?? ''
  prioridadeAtual = item?.prioridade ?? 'media'
  statusAtual = item?.status ?? 'desejado'
  montarSegmentados()
  atualizarPrevia()
  dlg.showModal()
  campos.nome.focus()
}

campos.imagemUrl.addEventListener('input', atualizarPrevia)
$('#wish-add').addEventListener('click', () => abrirDialogo())
$('#wish-cancel').addEventListener('click', () => dlg.close())
$('#wish-cancel-x').addEventListener('click', () => dlg.close())

form.addEventListener('submit', async (e) => {
  e.preventDefault()
  limparErros()
  const { dados, erros } = validarProduto({
    nome: campos.nome.value,
    descricao: campos.descricao.value,
    linkUrl: campos.linkUrl.value,
    imagemUrl: campos.imagemUrl.value,
    preco: campos.preco.value,
    prioridade: prioridadeAtual,
    status: statusAtual
  })
  if (Object.keys(erros).length) return mostrarErros(erros)

  const enviar = $('#wish-submit')
  enviar.disabled = true
  try {
    const r = editando ? await desejosApi.atualizar(editando.id, dados) : await desejosApi.criar(dados)
    itens = ordenar(editando ? itens.map((i) => (i.id === editando.id ? r.item : i)) : [...itens, r.item])
    totais = r.totais
    dlg.close()
    renderizar()
    mostrarAviso(editando ? 'Produto atualizado.' : 'Produto adicionado à lista.')
  } catch (falha) {
    // Erros de validação do servidor chegam por campo; os demais aparecem no rodapé do formulário.
    const porCampo = {}
    for (const d of falha?.detalhes ?? []) if (d.campo && campos[d.campo] && !porCampo[d.campo]) porCampo[d.campo] = d.mensagem
    if (Object.keys(porCampo).length) mostrarErros(porCampo)
    else erroGeral.textContent = textoErro(falha)
  } finally {
    enviar.disabled = false
  }
})

carregar()
