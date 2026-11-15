import '../styles/main.css'
import '../styles/paginas.css'

import { icon } from '../modules/icons.js'
import { iniciarShell, mostrarAviso } from '../modules/shell.js'
import {
  CATEGORIAS_PADRAO,
  EVENTO_FAVORITOS,
  abrirCaixaPasta,
  carregarTudo,
  categoriasEm,
  criarIconePasta,
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
const campoPasta = document.querySelector('#fav-folder')
const campoBarra = document.querySelector('#fav-bar')
const blocoBarra = document.querySelector('#fav-bar-field')
const linhaFixado = document.querySelector('#fav-pinned-row')
const notaPasta = document.querySelector('#fav-folder-note')
const areaPastas = document.querySelector('#fav-folders')

const dialogoPasta = document.querySelector('#folder-dialog')
const formPasta = document.querySelector('#folder-form')
const campoNomePasta = document.querySelector('#folder-name')
const campoBarraPasta = document.querySelector('#folder-bar')
const erroPasta = document.querySelector('#folder-error')
const botaoExcluirPasta = document.querySelector('#folder-delete')

const dialogoCategorias = document.querySelector('#cat-dialog')
const listaCategorias = document.querySelector('#cat-list')
const erroCategorias = document.querySelector('#cat-error')

const NOVA = '__nova__'
const SOLTO = '__solto__'
const ROTULO_BARRA = { central: 'Central', superior: 'Superior' }

let favoritos = []
let pastas = []
let editandoPasta = null
let carregado = false
let erroCarga = ''
let categoriaAtiva = 'todas'
let editando = null

const normalizarTexto = (t) =>
  t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

/* ---------- Dados da conta (API) ---------- */

const textoErro = (erro) => erro?.message || 'Não foi possível concluir a operação. Tente novamente.'

// Avisa as barras de atalhos (central e superior) que algo mudou.
const avisarBarras = () => window.dispatchEvent(new CustomEvent(EVENTO_FAVORITOS))

async function carregar() {
  try {
    ;({ favoritos, pastas } = await carregarTudo())
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

  // Onde o link aparece: pasta (quando houver) e barra.
  const pasta = pastas.find((p) => p.id === favorito.pastaId)
  const marcas = document.createElement('span')
  marcas.className = 'fav-tags'
  const dentro = pasta ? `${pasta.nome} · ${ROTULO_BARRA[pasta.barra]}` : favorito.fixado ? `Barra ${ROTULO_BARRA[favorito.barra].toLowerCase()}` : 'Fora das barras'
  marcas.textContent = dentro
  texto.append(marcas)

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

function renderizarPastas() {
  areaPastas.hidden = pastas.length === 0
  areaPastas.replaceChildren()
  if (!pastas.length) return

  const titulo = document.createElement('h2')
  titulo.className = 'fav-group-title'
  titulo.textContent = 'Pastas'
  const grade = document.createElement('div')
  grade.className = 'fav-grid'

  pastas.forEach((pasta) => {
    const links = favoritos.filter((f) => f.pastaId === pasta.id).sort((a, b) => a.criado - b.criado)
    const cartao = document.createElement('article')
    cartao.className = 'fav-card'

    const abrir = document.createElement('button')
    abrir.type = 'button'
    abrir.className = 'fav-link folder-open-btn'
    abrir.setAttribute('aria-haspopup', 'dialog')
    abrir.setAttribute('aria-expanded', 'false')
    const texto = document.createElement('span')
    texto.className = 'fav-text'
    const nome = document.createElement('strong')
    nome.textContent = pasta.nome
    const detalhe = document.createElement('span')
    detalhe.textContent = `${links.length} ${links.length === 1 ? 'link' : 'links'} · barra ${ROTULO_BARRA[pasta.barra].toLowerCase()}`
    texto.append(nome, detalhe)
    abrir.append(criarIconePasta(links), texto)
    abrir.addEventListener('click', () => abrirCaixaPasta(pasta, links, abrir))

    const acoes = document.createElement('div')
    acoes.className = 'item-actions'
    const editar = document.createElement('button')
    editar.type = 'button'
    editar.innerHTML = icon('pencil')
    editar.title = 'Editar pasta'
    editar.setAttribute('aria-label', `Editar pasta ${pasta.nome}`)
    editar.addEventListener('click', () => abrirPopupPasta(pasta))
    acoes.append(editar)

    cartao.append(abrir, acoes)
    grade.append(cartao)
  })
  areaPastas.append(titulo, grade)
}

function renderizar() {
  renderizarFiltros()
  renderizarPastas()

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

function preencherPastas(selecionada) {
  campoPasta.replaceChildren(
    new Option('Solto (fora de pastas)', SOLTO),
    ...pastas.map((p) => new Option(`Pasta: ${p.nome} (${ROTULO_BARRA[p.barra].toLowerCase()})`, p.id))
  )
  campoPasta.value = selecionada && pastas.some((p) => p.id === selecionada) ? selecionada : SOLTO
  atualizarLocal()
}

// Link em pasta herda a barra da pasta: os campos "barra" e "mostrar" só valem para link solto.
function atualizarLocal() {
  const emPasta = campoPasta.value !== SOLTO
  blocoBarra.hidden = emPasta
  linhaFixado.hidden = emPasta
  notaPasta.hidden = !emPasta
}
campoPasta.addEventListener('change', atualizarLocal)

function abrirPopup(favorito = null) {
  editando = favorito
  erro.textContent = ''

  document.querySelector('#fav-dialog-title').textContent = favorito ? 'Editar link' : 'Adicionar link'
  document.querySelector('#fav-dialog-kicker').textContent = favorito ? 'EDIÇÃO' : 'NOVO FAVORITO'
  botaoExcluir.hidden = !favorito

  campoNome.value = favorito?.nome ?? ''
  campoUrl.value = favorito?.url ?? ''
  campoFixado.checked = favorito?.fixado ?? true
  campoBarra.value = favorito?.barra ?? 'central'
  campoNovaCategoria.value = ''
  preencherCategorias(favorito?.categoria)
  preencherPastas(favorito?.pastaId)

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

  const emPasta = campoPasta.value !== SOLTO
  const dados = { nome, url, categoria, pastaId: emPasta ? campoPasta.value : null }
  if (emPasta) {
    dados.fixado = true
  } else {
    dados.fixado = campoFixado.checked
    dados.barra = campoBarra.value
  }
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
  avisarBarras()
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
  avisarBarras()
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
    ;({ favoritos, pastas } = await carregarTudo())
    renderizar()
  } catch {
    /* mantém o que já está na tela */
  }
})

/* ---------- Pastas ---------- */

function abrirPopupPasta(pasta = null) {
  editandoPasta = pasta
  erroPasta.textContent = ''
  document.querySelector('#folder-dialog-title').textContent = pasta ? 'Editar pasta' : 'Criar pasta'
  document.querySelector('#folder-dialog-kicker').textContent = pasta ? 'EDIÇÃO' : 'NOVA PASTA'
  botaoExcluirPasta.hidden = !pasta
  campoNomePasta.value = pasta?.nome ?? ''
  campoBarraPasta.value = pasta?.barra ?? 'central'
  dialogoPasta.showModal()
  campoNomePasta.focus()
}

const fecharPopupPasta = () => dialogoPasta.close()
document.querySelector('#folder-new').addEventListener('click', () => abrirPopupPasta())
document.querySelector('#folder-cancel').addEventListener('click', fecharPopupPasta)
document.querySelector('#folder-cancel-x').addEventListener('click', fecharPopupPasta)
dialogoPasta.addEventListener('click', (e) => {
  if (e.target === dialogoPasta) fecharPopupPasta()
})

formPasta.addEventListener('submit', async (e) => {
  e.preventDefault()
  const nome = campoNomePasta.value.trim()
  if (!nome) {
    erroPasta.textContent = 'Informe um nome para a pasta.'
    campoNomePasta.focus()
    return
  }
  const dados = { nome, barra: campoBarraPasta.value }
  const botao = formPasta.querySelector('[type="submit"]')
  botao.disabled = true
  const nova = !editandoPasta
  try {
    if (editandoPasta) {
      const atualizada = await favoritosApi.atualizarPasta(editandoPasta.id, dados)
      pastas = pastas.map((p) => (p.id === atualizada.id ? atualizada : p))
      // Os links da pasta acompanham a barra dela.
      favoritos = favoritos.map((f) => (f.pastaId === atualizada.id ? { ...f, barra: atualizada.barra } : f))
    } else {
      pastas = [...pastas, await favoritosApi.criarPasta(dados)]
    }
  } catch (falha) {
    erroPasta.textContent = textoErro(falha)
    return
  } finally {
    botao.disabled = false
  }
  fecharPopupPasta()
  renderizar()
  avisarBarras()
  mostrarAviso(nova ? 'Pasta criada' : 'Pasta atualizada')
})

botaoExcluirPasta.addEventListener('click', async () => {
  if (!editandoPasta) return
  if (!confirm(`Excluir a pasta "${editandoPasta.nome}"? Os links dela não serão apagados: ficam soltos.`)) return
  try {
    await favoritosApi.excluirPasta(editandoPasta.id)
  } catch (falha) {
    erroPasta.textContent = textoErro(falha)
    return
  }
  const id = editandoPasta.id
  pastas = pastas.filter((p) => p.id !== id)
  favoritos = favoritos.map((f) => (f.pastaId === id ? { ...f, pastaId: null } : f))
  fecharPopupPasta()
  renderizar()
  avisarBarras()
  mostrarAviso('Pasta excluída')
})

/* ---------- Gerenciar categorias ---------- */

// Só as categorias criadas pelo usuário (as padrão são fixas).
const categoriasProprias = () => categoriasEm(favoritos).filter((c) => !CATEGORIAS_PADRAO.includes(c))

function renderizarCategorias() {
  listaCategorias.replaceChildren()
  const proprias = categoriasProprias()
  if (!proprias.length) {
    const vazio = document.createElement('p')
    vazio.className = 'empty-state'
    vazio.textContent = 'Você ainda não criou categorias. Crie uma ao adicionar um link.'
    listaCategorias.append(vazio)
    return
  }

  proprias.forEach((nome) => {
    const total = favoritos.filter((f) => f.categoria === nome).length
    const linha = document.createElement('div')
    linha.className = 'cat-manage-row'

    const campo = document.createElement('input')
    campo.type = 'text'
    campo.maxLength = 40
    campo.value = nome
    campo.setAttribute('aria-label', `Nome da categoria ${nome}`)

    const contagem = document.createElement('small')
    contagem.textContent = `${total} ${total === 1 ? 'link' : 'links'}`

    const salvar = document.createElement('button')
    salvar.type = 'button'
    salvar.className = 'btn btn-sm'
    salvar.textContent = 'Renomear'
    const renomear = async () => {
      const novo = campo.value.trim()
      if (!novo) {
        erroCategorias.textContent = 'O nome da categoria não pode ficar vazio.'
        return
      }
      if (novo === nome) return
      salvar.disabled = true
      try {
        await favoritosApi.renomearCategoria(nome, novo)
      } catch (falha) {
        erroCategorias.textContent = textoErro(falha)
        salvar.disabled = false
        return
      }
      favoritos = favoritos.map((f) => (f.categoria === nome ? { ...f, categoria: novo } : f))
      if (categoriaAtiva === nome) categoriaAtiva = novo
      erroCategorias.textContent = ''
      renderizar()
      renderizarCategorias()
      mostrarAviso('Categoria renomeada')
    }
    salvar.addEventListener('click', renomear)
    campo.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        renomear()
      }
    })

    const remover = document.createElement('button')
    remover.type = 'button'
    remover.className = 'btn btn-sm btn-danger'
    remover.textContent = 'Excluir'
    remover.addEventListener('click', async () => {
      const aviso = total
        ? `Excluir a categoria "${nome}"? Os ${total} link(s) dela vão para "Dia a dia" (nenhum link é apagado).`
        : `Excluir a categoria "${nome}"?`
      if (!confirm(aviso)) return
      remover.disabled = true
      try {
        await favoritosApi.excluirCategoria(nome)
      } catch (falha) {
        erroCategorias.textContent = textoErro(falha)
        remover.disabled = false
        return
      }
      favoritos = favoritos.map((f) => (f.categoria === nome ? { ...f, categoria: CATEGORIAS_PADRAO[2] } : f))
      erroCategorias.textContent = ''
      renderizar()
      renderizarCategorias()
      mostrarAviso('Categoria excluída')
    })

    linha.append(campo, contagem, salvar, remover)
    listaCategorias.append(linha)
  })
}

document.querySelector('#cat-manage').addEventListener('click', () => {
  erroCategorias.textContent = ''
  renderizarCategorias()
  dialogoCategorias.showModal()
})
const fecharCategorias = () => dialogoCategorias.close()
document.querySelector('#cat-close').addEventListener('click', fecharCategorias)
document.querySelector('#cat-close-x').addEventListener('click', fecharCategorias)
dialogoCategorias.addEventListener('click', (e) => {
  if (e.target === dialogoCategorias) fecharCategorias()
})

renderizar()
carregar()
