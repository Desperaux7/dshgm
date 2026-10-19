import '../styles/main.css'
import '../styles/paginas.css'

import { icon } from '../modules/icons.js'
import { iniciarShell, mostrarAviso } from '../modules/shell.js'
import {
  CATEGORIAS_PADRAO,
  carregarFavoritos,
  categoriasEm,
  criarIconeSite,
  hostDe,
  normalizarURL
} from '../modules/favoritos.js'
import { favoritosApi } from '../services/favoritosApi.js'

iniciarShell({ pagina: 'favoritos' })

const campoBusca = document.querySelector('#fav-search')
const filtros = document.querySelector('#fav-filters')
const lista = document.querySelector('#fav-list')

const dialogo = document.querySelector('#fav-dialog')
const form = document.querySelector('#fav-form')
const campoNome = document.querySelector('#fav-name')
const campoUrl = document.querySelector('#fav-url')
const campoCategoria = document.querySelector('#fav-category')
const blocoNovaCategoria = document.querySelector('#fav-new-category-field')
const campoNovaCategoria = document.querySelector('#fav-new-category')
const campoFixado = document.querySelector('#fav-pinned')
const erro = document.querySelector('#fav-error')
const botaoExcluir = document.querySelector('#fav-delete')

const NOVA = '__nova__'

let favoritos = []
let carregado = false
let erroCarga = ''
let categoriaAtiva = 'todas'
let editando = null

const normalizarTexto = (t) =>
  t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

/* ---------- Dados da conta (API) ---------- */

const textoErro = (erro) => erro?.message || 'Não foi possível concluir a operação. Tente novamente.'

async function carregar() {
  try {
    favoritos = await carregarFavoritos()
    carregado = true
    erroCarga = ''
  } catch (falha) {
    erroCarga = `Não foi possível carregar os favoritos (${textoErro(falha)}).`
  }
  renderizar()
}

/* ---------- Renderização ---------- */

function renderizarFiltros() {
  const categorias = categoriasEm(favoritos)
  if (categoriaAtiva !== 'todas' && !categorias.includes(categoriaAtiva)) categoriaAtiva = 'todas'

  const itens = [{ id: 'todas', texto: 'Todas', total: favoritos.length }].concat(
    categorias.map((c) => ({ id: c, texto: c, total: favoritos.filter((f) => f.categoria === c).length }))
  )

  filtros.replaceChildren(
    ...itens.map((item) => {
      const botao = document.createElement('button')
      botao.type = 'button'
      botao.textContent = `${item.texto} · ${item.total}`
      botao.setAttribute('aria-pressed', String(item.id === categoriaAtiva))
      botao.addEventListener('click', () => {
        categoriaAtiva = item.id
        renderizar()
      })
      return botao
    })
  )
}

function criarCartao(favorito) {
  const cartao = document.createElement('article')
  cartao.className = 'fav-card'

  const link = document.createElement('a')
  link.className = 'fav-link'
  link.href = favorito.url
  link.target = '_blank'
  link.rel = 'noopener noreferrer'

  const texto = document.createElement('span')
  texto.className = 'fav-text'
  const nome = document.createElement('strong')
  nome.textContent = favorito.nome
  const host = document.createElement('span')
  host.textContent = hostDe(favorito.url)
  texto.append(nome, host)
  link.append(criarIconeSite(favorito), texto)

  const acoes = document.createElement('div')
  acoes.className = 'item-actions'

  const editar = document.createElement('button')
  editar.type = 'button'
  editar.innerHTML = icon('pencil')
  editar.title = 'Editar'
  editar.setAttribute('aria-label', `Editar ${favorito.nome}`)
  editar.addEventListener('click', () => abrirPopup(favorito))

  const remover = document.createElement('button')
  remover.type = 'button'
  remover.className = 'is-danger'
  remover.innerHTML = icon('trash')
  remover.title = 'Excluir'
  remover.setAttribute('aria-label', `Excluir ${favorito.nome}`)
  remover.addEventListener('click', () => {
    excluir(favorito)
  })

  acoes.append(editar, remover)
  cartao.append(link, acoes)
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
  } else if (favoritos.length === 0) {
    caixa.innerHTML = '<strong>Nenhum favorito ainda</strong>Salve seus sites mais usados para abri-los em um clique.'
    const botao = document.createElement('button')
    botao.type = 'button'
    botao.className = 'btn btn-primary'
    botao.innerHTML = `${icon('plus')}Adicionar o primeiro link`
    botao.addEventListener('click', () => abrirPopup())
    caixa.append(document.createElement('br'), botao)
  } else {
    caixa.innerHTML = '<strong>Nada encontrado</strong>Tente outra busca ou escolha outra categoria.'
  }
  return caixa
}

function renderizar() {
  renderizarFiltros()

  const termo = normalizarTexto(campoBusca.value.trim())
  const visiveis = favoritos
    .filter((f) => categoriaAtiva === 'todas' || f.categoria === categoriaAtiva)
    .filter(
      (f) =>
        !termo ||
        normalizarTexto(`${f.nome} ${hostDe(f.url)} ${f.categoria}`).includes(termo)
    )
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))

  lista.replaceChildren()

  if (visiveis.length === 0) {
    lista.append(mensagemVazia())
    return
  }

  // Agrupa por categoria, na ordem das categorias.
  categoriasEm(favoritos).forEach((categoria) => {
    const doGrupo = visiveis.filter((f) => f.categoria === categoria)
    if (!doGrupo.length) return

    const grupo = document.createElement('section')
    grupo.className = 'fav-group'

    const titulo = document.createElement('h2')
    titulo.className = 'fav-group-title'
    titulo.textContent = categoria
    const total = document.createElement('small')
    total.textContent = `${doGrupo.length} ${doGrupo.length === 1 ? 'link' : 'links'}`
    titulo.append(total)

    const grade = document.createElement('div')
    grade.className = 'fav-grid'
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

// "/" foca a busca, como na pesquisa do Google da página inicial.
document.addEventListener('keydown', (e) => {
  const alvo = e.target
  const digitando =
    alvo instanceof HTMLElement && (alvo.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(alvo.tagName))
  if (e.key === '/' && !digitando && !e.ctrlKey && !e.metaKey && !document.querySelector('dialog[open]')) {
    e.preventDefault()
    campoBusca.focus()
  }
})

/* ---------- Pop-up ---------- */

function preencherCategorias(selecionada) {
  const categorias = categoriasEm(favoritos)
  if (selecionada && !categorias.includes(selecionada)) categorias.push(selecionada)

  campoCategoria.replaceChildren(
    ...categorias.map((c) => new Option(c, c)),
    new Option('+ Nova categoria...', NOVA)
  )
  campoCategoria.value = selecionada ?? (categoriaAtiva !== 'todas' ? categoriaAtiva : CATEGORIAS_PADRAO[0])
  atualizarNovaCategoria()
}

function atualizarNovaCategoria() {
  blocoNovaCategoria.hidden = campoCategoria.value !== NOVA
  if (!blocoNovaCategoria.hidden) campoNovaCategoria.focus()
}

campoCategoria.addEventListener('change', atualizarNovaCategoria)

function abrirPopup(favorito = null) {
  editando = favorito
  erro.textContent = ''

  document.querySelector('#fav-dialog-title').textContent = favorito ? 'Editar link' : 'Adicionar link'
  document.querySelector('#fav-dialog-kicker').textContent = favorito ? 'EDIÇÃO' : 'NOVO FAVORITO'
  botaoExcluir.hidden = !favorito

  campoNome.value = favorito?.nome ?? ''
  campoUrl.value = favorito?.url ?? ''
  campoFixado.checked = favorito?.fixado ?? true
  campoNovaCategoria.value = ''
  preencherCategorias(favorito?.categoria)

  dialogo.showModal()
  campoNome.focus()
}

const fecharPopup = () => dialogo.close()

document.querySelector('#fav-add').addEventListener('click', () => abrirPopup())
document.querySelector('#fav-cancel').addEventListener('click', fecharPopup)
document.querySelector('#fav-cancel-x').addEventListener('click', fecharPopup)
dialogo.addEventListener('click', (e) => {
  if (e.target === dialogo) fecharPopup()
})

form.addEventListener('submit', async (e) => {
  e.preventDefault()

  const nome = campoNome.value.trim()
  const url = normalizarURL(campoUrl.value)
  const categoria =
    campoCategoria.value === NOVA ? campoNovaCategoria.value.trim() : campoCategoria.value

  if (!nome) {
    erro.textContent = 'Informe um nome para o link.'
    campoNome.focus()
    return
  }
  if (!url) {
    erro.textContent = 'Informe um endereço válido, como exemplo.com.br.'
    campoUrl.focus()
    return
  }
  if (!categoria) {
    erro.textContent = 'Informe o nome da nova categoria.'
    campoNovaCategoria.focus()
    return
  }

  const dados = { nome, url, categoria, fixado: campoFixado.checked }
  const botaoSalvar = form.querySelector('[type="submit"]')
  if (botaoSalvar) botaoSalvar.disabled = true // evita envio duplo enquanto a API responde

  const novo = !editando
  try {
    if (editando) {
      const atualizado = await favoritosApi.atualizar(editando.id, dados)
      favoritos = favoritos.map((f) => (f.id === editando.id ? atualizado : f))
    } else {
      favoritos = [...favoritos, await favoritosApi.criar(dados)]
    }
  } catch (falha) {
    erro.textContent = textoErro(falha)
    return
  } finally {
    if (botaoSalvar) botaoSalvar.disabled = false
  }

  fecharPopup()
  if (categoriaAtiva !== 'todas') categoriaAtiva = categoria
  renderizar()
  mostrarAviso(novo ? 'Link adicionado' : 'Link atualizado')
})

async function excluir(favorito) {
  if (!confirm(`Excluir "${favorito.nome}" dos favoritos?`)) return false
  try {
    await favoritosApi.excluir(favorito.id)
  } catch (falha) {
    mostrarAviso(textoErro(falha))
    return false
  }
  favoritos = favoritos.filter((f) => f.id !== favorito.id)
  renderizar()
  mostrarAviso('Link excluído')
  return true
}

botaoExcluir.addEventListener('click', async () => {
  if (editando && (await excluir(editando))) fecharPopup()
})

// Ao voltar para a aba, traz alterações feitas em outro dispositivo ou aba.
document.addEventListener('visibilitychange', async () => {
  if (document.hidden || !carregado) return
  try {
    favoritos = await carregarFavoritos()
    renderizar()
  } catch {
    /* mantém o que já está na tela */
  }
})

renderizar()
carregar()
