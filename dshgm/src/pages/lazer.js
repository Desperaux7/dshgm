import '../styles/main.css'
import '../styles/paginas.css'

import { icon } from '../modules/icons.js'
import { iniciarShell, mostrarAviso } from '../modules/shell.js'
import { redimensionarImagem } from '../services/imagens.js'
import { lazerApi } from '../services/lazerApi.js'
import {
  STATUS,
  TIPOS,
  aplicarRegras,
  capaHorizontal,
  carregarItens,
  esquecerCapa,
  statusDe,
  tipoDe,
  urlDaCapa
} from '../modules/lazer.js'

iniciarShell({ pagina: 'lazer' })

const $ = (seletor) => document.querySelector(seletor)

const campoBusca = $('#lib-search')
const seletorOrdem = $('#lib-sort')
const filtrosTipo = $('#lib-types')
const filtrosStatus = $('#lib-status')
const lista = $('#lib-list')

let itens = []
let carregado = false
let erroCarga = ''
let filtroTipo = 'todos'
let filtroStatus = 'todos'
let editando = null

const normalizarTexto = (t) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
const reduzirMovimento = window.matchMedia('(prefers-reduced-motion: reduce)')

const textoErro = (erro) => erro?.message || 'Não foi possível concluir a operação. Tente novamente.'

async function carregar() {
  try {
    itens = await carregarItens()
    carregado = true
    erroCarga = ''
  } catch (falha) {
    erroCarga = `Não foi possível carregar a biblioteca (${textoErro(falha)}).`
  }
  renderizar()
}

/* ---------- Capa ---------- */

function montarCapa(item, caixa) {
  caixa.classList.add('cover')
  caixa.replaceChildren()

  const marcador = document.createElement('span')
  marcador.className = 'cover-placeholder'
  marcador.innerHTML = icon(tipoDe(item.tipo).icone)
  caixa.append(marcador)

  if (!item.capa) return

  urlDaCapa(item).then((url) => {
    if (!url || !caixa.isConnected) return
    const larga = capaHorizontal(item.capa)
    caixa.classList.toggle('is-wide', larga)

    if (larga) {
      const fundo = new Image()
      fundo.className = 'cover-blur'
      fundo.alt = ''
      fundo.src = url
      caixa.append(fundo)
    }

    const img = new Image()
    img.className = 'cover-img'
    img.alt = `Capa de ${item.titulo}`
    img.decoding = 'async'
    img.onload = () => marcador.remove()
    img.src = url
    caixa.append(img)
  })
}

/* ---------- Filtros ---------- */

function criarPilula(texto, ativo, aoClicar) {
  const botao = document.createElement('button')
  botao.type = 'button'
  botao.textContent = texto
  botao.setAttribute('aria-pressed', String(ativo))
  botao.addEventListener('click', aoClicar)
  return botao
}

function renderizarFiltros() {
  const total = (fn) => itens.filter(fn).length

  filtrosTipo.replaceChildren(
    criarPilula(`Tudo · ${itens.length}`, filtroTipo === 'todos', () => ((filtroTipo = 'todos'), renderizar())),
    ...TIPOS.map((t) =>
      criarPilula(`${t.plural} · ${total((i) => i.tipo === t.id)}`, filtroTipo === t.id, () => ((filtroTipo = t.id), renderizar()))
    )
  )

  const doTipo = itens.filter((i) => filtroTipo === 'todos' || i.tipo === filtroTipo)
  filtrosStatus.replaceChildren(
    criarPilula(`Todos · ${doTipo.length}`, filtroStatus === 'todos', () => ((filtroStatus = 'todos'), renderizar())),
    ...[STATUS[1], STATUS[0], STATUS[2]].map((s) =>
      criarPilula(
        `${s.plural} · ${doTipo.filter((i) => i.status === s.id).length}`,
        filtroStatus === s.id,
        () => ((filtroStatus = s.id), renderizar())
      )
    )
  )
}

function filtrar({ ignorarStatus = false } = {}) {
  const termo = normalizarTexto(campoBusca.value.trim())
  return itens
    .filter((i) => filtroTipo === 'todos' || i.tipo === filtroTipo)
    .filter((i) => ignorarStatus || filtroStatus === 'todos' || i.status === filtroStatus)
    .filter((i) => !termo || normalizarTexto(`${i.titulo} ${i.plataforma}`).includes(termo))
}

function ordenar(lista) {
  const copia = [...lista]
  if (seletorOrdem.value === 'titulo') return copia.sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR'))
  return copia.sort((a, b) => b.atualizado - a.atualizado)
}

/* ---------- Cartões ---------- */

// Atualização imediata na tela (mesmas regras do servidor); se a API falhar, recarrega o estado real da conta.
function atualizarItem(id, mudancas, alterado) {
  itens = itens.map((i) =>
    i.id === id ? aplicarRegras({ ...i, ...mudancas, atualizado: Date.now() }, alterado) : i
  )
  renderizar()

  lazerApi.atualizar(id, mudancas).catch(async (falha) => {
    mostrarAviso(textoErro(falha))
    await carregar()
  })
  return true
}

function criarCartao(item) {
  const tipo = tipoDe(item.tipo)

  const cartao = document.createElement('article')
  cartao.className = `lib-card status-${item.status}`

  const capa = document.createElement('button')
  capa.type = 'button'
  capa.className = 'lib-cover'
  capa.setAttribute('aria-label', `Editar ${item.titulo}`)
  capa.addEventListener('click', () => abrirPopup(item))
  montarCapa(item, capa)

  const selo = document.createElement('span')
  selo.className = 'lib-badge'
  selo.innerHTML = icon(tipo.icone)
  selo.title = tipo.nome
  capa.append(selo)

  if (item.tipo === 'jogo' && item.progresso > 0) {
    const trilha = document.createElement('span')
    trilha.className = 'lib-progress-bar'
    trilha.innerHTML = `<i style="width:${item.progresso}%"></i>`
    capa.append(trilha)
  }

  const acoes = document.createElement('div')
  acoes.className = 'item-actions lib-actions'
  const editar = document.createElement('button')
  editar.type = 'button'
  editar.innerHTML = icon('pencil')
  editar.title = 'Editar'
  editar.setAttribute('aria-label', `Editar ${item.titulo}`)
  editar.addEventListener('click', () => abrirPopup(item))
  const remover = document.createElement('button')
  remover.type = 'button'
  remover.className = 'is-danger'
  remover.innerHTML = icon('trash')
  remover.title = 'Excluir'
  remover.setAttribute('aria-label', `Excluir ${item.titulo}`)
  remover.addEventListener('click', () => excluir(item))
  acoes.append(editar, remover)

  const info = document.createElement('div')
  info.className = 'lib-info'

  const titulo = document.createElement('strong')
  titulo.textContent = item.titulo
  titulo.title = item.titulo

  const meta = document.createElement('small')
  const partes = [tipo.nome]
  if (item.plataforma) partes.push(item.plataforma)
  if (item.tipo === 'jogo' && item.status !== 'pendente') partes.push(`${item.progresso}%`)
  meta.textContent = partes.join(' · ')

  info.append(titulo, meta)

  // Progresso rápido: jogos em andamento ajustam direto no cartão.
  if (item.tipo === 'jogo' && item.status === 'andamento') {
    const range = document.createElement('input')
    range.type = 'range'
    range.className = 'range'
    range.min = '0'
    range.max = '100'
    range.step = '5'
    range.value = String(item.progresso)
    range.setAttribute('aria-label', `Progresso de ${item.titulo}`)
    range.addEventListener('input', () => {
      meta.textContent = [...partes.slice(0, -1), `${range.value}%`].join(' · ')
      const barra = capa.querySelector('.lib-progress-bar i')
      if (barra) barra.style.width = `${range.value}%`
    })
    range.addEventListener('change', () => atualizarItem(item.id, { progresso: Number(range.value) }, 'progresso'))
    info.append(range)
  }

  const proxima = {
    pendente: ['Começar', 'andamento'],
    andamento: ['Concluir', 'concluido'],
    concluido: ['Reabrir', 'andamento']
  }[item.status]
  const avancar = document.createElement('button')
  avancar.type = 'button'
  avancar.className = 'lib-advance'
  avancar.textContent = proxima[0]
  avancar.addEventListener('click', () => atualizarItem(item.id, { status: proxima[1] }, 'status'))
  info.append(avancar)

  cartao.append(capa, acoes, info)
  return cartao
}

function mensagemVazia() {
  const caixa = document.createElement('div')
  caixa.className = 'empty-state'
  if (!carregado) {
    caixa.textContent = erroCarga || 'Carregando...'
    if (erroCarga) {
      const tentar = document.createElement('button')
      tentar.type = 'button'
      tentar.className = 'btn btn-sm'
      tentar.textContent = 'Tentar novamente'
      tentar.addEventListener('click', carregar)
      caixa.append(document.createElement('br'), tentar)
    }
  } else if (itens.length === 0) {
    caixa.innerHTML = '<strong>Sua biblioteca está vazia</strong>Adicione jogos, filmes e séries para montar seu backlog.'
    const botao = document.createElement('button')
    botao.type = 'button'
    botao.className = 'btn btn-primary'
    botao.innerHTML = `${icon('plus')}Adicionar o primeiro item`
    botao.addEventListener('click', () => abrirPopup())
    caixa.append(document.createElement('br'), botao)
  } else {
    caixa.innerHTML = '<strong>Nada encontrado</strong>Ajuste a busca ou os filtros para ver outros itens.'
  }
  return caixa
}

function renderizar() {
  renderizarFiltros()
  lista.replaceChildren()

  const visiveis = ordenar(filtrar())
  if (!visiveis.length) {
    lista.append(mensagemVazia())
    return
  }

  STATUS.forEach((status) => {
    const doGrupo = visiveis.filter((i) => i.status === status.id)
    if (!doGrupo.length) return

    const grupo = document.createElement('section')
    grupo.className = 'fav-group'

    const titulo = document.createElement('h2')
    titulo.className = 'fav-group-title'
    titulo.textContent = status.plural
    const total = document.createElement('small')
    total.textContent = `${doGrupo.length} ${doGrupo.length === 1 ? 'item' : 'itens'}`
    titulo.append(total)

    const grade = document.createElement('div')
    grade.className = 'lib-grid'
    grade.append(...doGrupo.map(criarCartao))

    grupo.append(titulo, grade)
    lista.append(grupo)
  })
}

campoBusca.addEventListener('input', renderizar)
campoBusca.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    campoBusca.value = ''
    renderizar()
  }
})
seletorOrdem.addEventListener('change', renderizar)

document.addEventListener('keydown', (e) => {
  const alvo = e.target
  const digitando =
    alvo instanceof HTMLElement && (alvo.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(alvo.tagName))
  if (e.key === '/' && !digitando && !e.ctrlKey && !e.metaKey && !document.querySelector('dialog[open]')) {
    e.preventDefault()
    campoBusca.focus()
  }
})

/* ---------- Pop-up de cadastro e edição ---------- */

const dialogo = $('#lib-dialog')
const form = $('#lib-form')
const campoTitulo = $('#lib-title')
const grupoTipo = $('#lib-type')
const grupoEstado = $('#lib-state')
const blocoProgresso = $('#lib-progress-field')
const campoProgresso = $('#lib-progress')
const saidaProgresso = $('#lib-progress-out')
const campoPlataforma = $('#lib-platform')
const rotuloPlataforma = $('#lib-platform-label')
const erro = $('#lib-error')
const botaoExcluir = $('#lib-delete')
const zonaCapa = $('#lib-cover-drop')
const previaCapa = $('#lib-cover-preview')
const vazioCapa = $('#lib-cover-empty')
const entradaCapa = $('#lib-cover-input')
const removerCapa = $('#lib-cover-remove')

let tipoAtual = 'jogo'
let estadoAtual = 'pendente'
// null = sem mudança | { blob, largura, altura } = nova capa | 'remover'
let capaPendente = null
let previaUrl = null

TIPOS.forEach((t) => {
  const b = document.createElement('button')
  b.type = 'button'
  b.dataset.valor = t.id
  b.innerHTML = `${icon(t.icone)}${t.nome}`
  b.addEventListener('click', () => definirTipo(t.id))
  grupoTipo.append(b)
})
;[STATUS[1], STATUS[0], STATUS[2]].forEach((s) => {
  const b = document.createElement('button')
  b.type = 'button'
  b.dataset.valor = s.id
  b.textContent = s.nome
  b.addEventListener('click', () => definirEstado(s.id))
  grupoEstado.append(b)
})

function marcar(grupo, valor) {
  grupo.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.valor === valor)))
}

function atualizarProgresso(valor) {
  campoProgresso.value = String(valor)
  saidaProgresso.textContent = `${valor}%`
}

function definirTipo(tipo) {
  tipoAtual = tipo
  marcar(grupoTipo, tipo)
  blocoProgresso.hidden = tipo !== 'jogo'
  rotuloPlataforma.textContent = tipo === 'jogo' ? 'Plataforma' : 'Onde assistir'
  campoPlataforma.placeholder = tipoDe(tipo).dica
  if (tipo !== 'jogo') atualizarProgresso(0)
}

function definirEstado(estado) {
  estadoAtual = estado
  marcar(grupoEstado, estado)
  if (tipoAtual !== 'jogo') return
  if (estado === 'concluido') atualizarProgresso(100)
  else if (estado === 'pendente') atualizarProgresso(0)
}

campoProgresso.addEventListener('input', () => {
  const valor = Number(campoProgresso.value)
  atualizarProgresso(valor)
  if (valor >= 100) estadoAtual = 'concluido'
  else if (valor > 0 && estadoAtual !== 'andamento') estadoAtual = 'andamento'
  else if (valor === 0 && estadoAtual === 'concluido') estadoAtual = 'andamento'
  marcar(grupoEstado, estadoAtual)
})

/* Capa: escolher, arrastar e remover */

function mostrarPrevia(url) {
  if (previaUrl && previaUrl.startsWith('blob:') && previaUrl !== url) URL.revokeObjectURL(previaUrl)
  previaUrl = url
  previaCapa.hidden = !url
  vazioCapa.hidden = Boolean(url)
  removerCapa.hidden = !url
  if (url) previaCapa.src = url
  const horizontal = previaCapa.naturalWidth > previaCapa.naturalHeight * 1.2
  zonaCapa.classList.toggle('is-wide', Boolean(url) && horizontal)
}
previaCapa.addEventListener('load', () => zonaCapa.classList.toggle('is-wide', previaCapa.naturalWidth > previaCapa.naturalHeight * 1.2))

// O servidor aceita capas de até 600 KB: tenta qualidade/tamanho decrescentes até caber.
const TENTATIVAS_CAPA = [
  { lado: 920, qualidade: 0.86 },
  { lado: 800, qualidade: 0.74 },
  { lado: 640, qualidade: 0.66 },
  { lado: 480, qualidade: 0.6 }
]
const LIMITE_CAPA = 550 * 1024

async function prepararCapa(arquivo) {
  let ultimo
  for (const { lado, qualidade } of TENTATIVAS_CAPA) {
    ultimo = await redimensionarImagem(arquivo, { largura: lado, altura: lado, modo: 'conter', qualidade })
    if (ultimo.blob.size <= LIMITE_CAPA) return ultimo
  }
  throw new Error('Esta imagem ficou grande demais mesmo reduzida. Escolha outra.')
}

async function receberArquivo(arquivo) {
  if (!arquivo) return
  erro.textContent = ''
  try {
    const resultado = await prepararCapa(arquivo)
    capaPendente = resultado
    mostrarPrevia(URL.createObjectURL(resultado.blob))
  } catch (e) {
    erro.textContent = e.message
  }
}

zonaCapa.addEventListener('click', () => entradaCapa.click())
entradaCapa.addEventListener('change', () => {
  receberArquivo(entradaCapa.files?.[0])
  entradaCapa.value = ''
})
;['dragenter', 'dragover'].forEach((nome) =>
  zonaCapa.addEventListener(nome, (e) => {
    e.preventDefault()
    zonaCapa.classList.add('is-over')
  })
)
;['dragleave', 'drop'].forEach((nome) =>
  zonaCapa.addEventListener(nome, (e) => {
    e.preventDefault()
    zonaCapa.classList.remove('is-over')
  })
)
zonaCapa.addEventListener('drop', (e) => receberArquivo(e.dataTransfer?.files?.[0]))

removerCapa.addEventListener('click', () => {
  capaPendente = 'remover'
  mostrarPrevia(null)
})

async function abrirPopup(item = null) {
  editando = item
  erro.textContent = ''
  capaPendente = null

  $('#lib-dialog-title').textContent = item ? 'Editar item' : 'Adicionar à biblioteca'
  $('#lib-dialog-kicker').textContent = item ? 'EDIÇÃO' : 'NOVO ITEM'
  botaoExcluir.hidden = !item

  campoTitulo.value = item?.titulo ?? ''
  campoPlataforma.value = item?.plataforma ?? ''
  const tipoInicial = item?.tipo ?? (filtroTipo !== 'todos' ? filtroTipo : 'jogo')
  definirTipo(tipoInicial)
  estadoAtual = item?.status ?? 'pendente'
  marcar(grupoEstado, estadoAtual)
  atualizarProgresso(item?.progresso ?? 0)

  mostrarPrevia(null)
  dialogo.showModal()
  campoTitulo.focus()

  if (item?.capa) {
    const url = await urlDaCapa(item)
    if (url && editando?.id === item.id && capaPendente === null) mostrarPrevia(url)
  }
}

const fecharPopup = () => dialogo.close()
dialogo.addEventListener('close', () => {
  if (previaUrl?.startsWith('blob:') && capaPendente && capaPendente !== 'remover') URL.revokeObjectURL(previaUrl)
  previaUrl = null
  editando = null
})

$('#lib-add').addEventListener('click', () => abrirPopup())
$('#lib-cancel').addEventListener('click', fecharPopup)
$('#lib-cancel-x').addEventListener('click', fecharPopup)
dialogo.addEventListener('click', (e) => {
  if (e.target === dialogo) fecharPopup()
})

form.addEventListener('submit', async (e) => {
  e.preventDefault()

  const titulo = campoTitulo.value.trim()
  if (!titulo) {
    erro.textContent = 'Informe o título.'
    campoTitulo.focus()
    return
  }

  // Status e progresso coerentes entre si, como sempre foi no formulário.
  const base = aplicarRegras(
    {
      tipo: tipoAtual,
      titulo,
      plataforma: campoPlataforma.value.trim(),
      status: estadoAtual,
      progresso: tipoAtual === 'jogo' ? Number(campoProgresso.value) : 0
    },
    'progresso'
  )

  const botaoSalvar = form.querySelector('[type="submit"]')
  if (botaoSalvar) botaoSalvar.disabled = true // evita envio duplo enquanto a API responde

  const novo = !editando
  let item
  try {
    item = editando ? await lazerApi.atualizar(editando.id, base) : await lazerApi.criar(base)
  } catch (falha) {
    erro.textContent = textoErro(falha)
    if (botaoSalvar) botaoSalvar.disabled = false
    return
  }

  // A capa vai depois do item (precisa do id da conta). Se falhar, o item já está salvo.
  let avisoCapa = ''
  try {
    if (capaPendente === 'remover') {
      if (item.capa) item = await lazerApi.removerCapa(item.id)
      esquecerCapa(item.id)
    } else if (capaPendente) {
      item = await lazerApi.enviarCapa(item.id, capaPendente.blob, capaPendente)
      esquecerCapa(item.id)
    }
  } catch (falha) {
    avisoCapa = `O item foi salvo, mas a capa não foi enviada: ${textoErro(falha)}`
  }

  itens = novo ? [...itens, item] : itens.map((i) => (i.id === item.id ? item : i))
  if (botaoSalvar) botaoSalvar.disabled = false

  fecharPopup()
  renderizar()
  mostrarAviso(avisoCapa || (novo ? 'Item adicionado' : 'Item atualizado'))
})

async function excluir(item) {
  if (!confirm(`Excluir "${item.titulo}" da biblioteca?`)) return false
  try {
    await lazerApi.excluir(item.id)
  } catch (falha) {
    mostrarAviso(textoErro(falha))
    return false
  }
  itens = itens.filter((i) => i.id !== item.id)
  esquecerCapa(item.id)
  renderizar()
  mostrarAviso('Item excluído')
  return true
}

botaoExcluir.addEventListener('click', async () => {
  if (editando && (await excluir(editando))) fecharPopup()
})

/* ---------- Sorteio ---------- */

const sorteio = $('#draw-dialog')
const sorteioTitulo = $('#draw-title')
const sorteioKicker = $('#draw-kicker')
const sorteioNome = $('#draw-name')
const sorteioMeta = $('#draw-meta')
const sorteioCapa = $('#draw-cover')
const sorteioResultado = $('#draw-result')
const botaoComecar = $('#draw-start')
const botaoDeNovo = $('#draw-again')

let sorteado = null
let animacao = null

// Sorteia entre os pendentes (ou entre os itens da situação escolhida no filtro),
// respeitando o tipo e a busca atuais.
function candidatos() {
  const alvo = filtroStatus === 'todos' ? 'pendente' : filtroStatus
  return filtrar({ ignorarStatus: true }).filter((i) => i.status === alvo)
}

const aleatorio = (n) => {
  const buffer = new Uint32Array(1)
  crypto.getRandomValues(buffer)
  return buffer[0] % n
}

function mostrarSorteado(item, final) {
  const tipo = tipoDe(item.tipo)
  sorteioNome.textContent = item.titulo
  sorteioMeta.textContent = [tipo.nome, item.plataforma].filter(Boolean).join(' · ')
  montarCapa(item, sorteioCapa)
  sorteioResultado.classList.toggle('is-final', final)
}

function sortear() {
  clearInterval(animacao)
  const pool = candidatos()
  const alvo = filtroStatus === 'todos' ? 'pendentes' : statusDe(filtroStatus).plural.toLowerCase()

  if (!pool.length) {
    mostrarAviso(`Nenhum item ${alvo === 'pendentes' ? 'pendente' : 'nessa situação'} com esses filtros`)
    if (sorteio.open) sorteio.close()
    return
  }

  // Evita repetir o mesmo item em sorteios seguidos, quando há alternativa.
  const opcoes = pool.length > 1 && sorteado ? pool.filter((i) => i.id !== sorteado.id) : pool
  const escolhido = opcoes[aleatorio(opcoes.length)]
  sorteado = escolhido

  sorteioKicker.textContent = `SORTEIO · ${pool.length} ${pool.length === 1 ? 'OPÇÃO' : 'OPÇÕES'}`
  sorteioTitulo.textContent = 'O que vai ser hoje?'
  botaoComecar.hidden = escolhido.status === 'andamento'
  botaoComecar.lastChild.textContent = escolhido.status === 'concluido' ? 'Rever' : 'Começar'
  if (!sorteio.open) sorteio.showModal()

  if (reduzirMovimento.matches || pool.length === 1) {
    mostrarSorteado(escolhido, true)
    botaoDeNovo.focus()
    return
  }

  // Embaralha os títulos por um instante antes de revelar o resultado.
  let passos = 0
  botaoDeNovo.disabled = true
  botaoComecar.disabled = true
  animacao = setInterval(() => {
    passos++
    if (passos >= 14) {
      clearInterval(animacao)
      mostrarSorteado(escolhido, true)
      botaoDeNovo.disabled = false
      botaoComecar.disabled = false
      botaoDeNovo.focus()
      return
    }
    mostrarSorteado(pool[aleatorio(pool.length)], false)
  }, 90)
}

$('#lib-draw').addEventListener('click', sortear)
botaoDeNovo.addEventListener('click', sortear)
$('#draw-close-x').addEventListener('click', () => sorteio.close())
sorteio.addEventListener('click', (e) => {
  if (e.target === sorteio) sorteio.close()
})
sorteio.addEventListener('close', () => {
  clearInterval(animacao)
  botaoDeNovo.disabled = false
  botaoComecar.disabled = false
})

botaoComecar.addEventListener('click', () => {
  if (!sorteado) return
  sorteio.close()
  atualizarItem(sorteado.id, { status: 'andamento' }, 'status')
  mostrarAviso(`Boa diversão com "${sorteado.titulo}"`)
})

// Ao voltar para a aba, traz alterações feitas em outro dispositivo ou aba.
document.addEventListener('visibilitychange', async () => {
  if (document.hidden || !carregado) return
  try {
    itens = await carregarItens()
    renderizar()
  } catch {
    /* mantém o que já está na tela */
  }
})

renderizar()
carregar()
