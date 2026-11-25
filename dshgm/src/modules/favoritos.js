import { icon } from './icons.js'
import { escaparHTML } from '../services/storage.js'
import { favoritosApi } from '../services/favoritosApi.js'

export const CATEGORIAS_PADRAO = ['Estudos', 'Desenvolvimento', 'Dia a dia', 'Games']
// Quantos itens (links soltos + pastas) cabem em cada barra.
export const LIMITE_BARRA = { central: 8, superior: 5 }
export const EVENTO_FAVORITOS = 'favoritos-alterados'

/*
  Modelo de favorito:
  { id, nome, url, categoria, fixado, pastaId, barra, criado }
    fixado: link solto aparece na barra escolhida. Link dentro de pasta aparece com a pasta (e herda a barra dela).
    barra: 'central' (abaixo da pesquisa) | 'superior' (canto superior direito).
  Modelo de pasta: { id, nome, barra, criado }
*/

// Favoritos da conta (o servidor devolve o modelo já normalizado).
export const carregarFavoritos = () => favoritosApi.listar()
export const carregarTudo = () => favoritosApi.listarTudo()

// O que uma barra mostra, na ordem de criação: pastas da barra + links soltos fixados nela.
export function itensDaBarra(favoritos, pastas, barra) {
  const itens = [
    ...pastas.filter((p) => p.barra === barra).map((pasta) => ({
      tipo: 'pasta',
      pasta,
      links: favoritos.filter((f) => f.pastaId === pasta.id).sort((a, b) => a.criado - b.criado),
      criado: pasta.criado
    })),
    ...favoritos.filter((f) => !f.pastaId && f.fixado && f.barra === barra).map((link) => ({ tipo: 'link', link, criado: link.criado }))
  ]
  return itens.sort((a, b) => a.criado - b.criado)
}

// Aceita "exemplo.com" e completa com https://. Só permite http e https.
export function normalizarURL(texto) {
  const limpo = String(texto ?? '').trim()
  if (!limpo || /\s/.test(limpo)) return null

  const comEsquema = /^[a-z][a-z\d+.-]*:\/\//i.test(limpo) ? limpo : `https://${limpo}`
  try {
    const url = new URL(comEsquema)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null
    return url.href
  } catch {
    return null
  }
}

export function hostDe(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function categoriasEm(lista) {
  const extras = [...new Set(lista.map((f) => f.categoria))]
    .filter((c) => !CATEGORIAS_PADRAO.includes(c))
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
  return [...CATEGORIAS_PADRAO, ...extras]
}

/* ---------- Ícones dos sites ---------- */

// Nenhum serviço de favicon conhece todos os sites, então cada site passa por uma sequência de fontes:
// 1) DuckDuckGo, 2) o próprio site (/favicon.ico), 3) Google. Cada fonte é tentada primeiro com o endereço
// exato e depois com o domínio principal (ex.: "app.exemplo.com" -> "exemplo.com"). Se nada servir, fica a inicial.
const FONTES_ICONE = [
  { id: 'ddg', url: (h) => `https://icons.duckduckgo.com/ip3/${encodeURIComponent(h)}.ico` },
  { id: 'site', url: (h) => `https://${h}/favicon.ico` },
  // O Google responde com um globo genérico de 16 px quando não conhece o site: esse resultado é recusado.
  { id: 'google', url: (h) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(h)}&sz=64`, recusarMinusculo: true }
]
const SUFIXOS_GENERICOS = new Set(['com', 'org', 'net', 'gov', 'edu', 'co', 'ac', 'mil'])
const CHAVE_ICONES = 'dashboard-favicons'
const LIMITE_CACHE_ICONES = 150

// Domínio principal aproximado, sem lista pública de sufixos: só remove o primeiro rótulo quando sobra um
// domínio plausível (evita transformar "empresa.com.br" em "com.br").
export function dominioPrincipal(host) {
  const partes = host.split('.')
  if (partes.length < 3) return null
  const resto = partes.slice(1)
  if (SUFIXOS_GENERICOS.has(resto[0])) return null
  return resto.join('.')
}

function lerCacheIcones() {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_ICONES)) ?? {}
  } catch {
    return {}
  }
}

function lembrarIcone(host, url) {
  try {
    const cache = lerCacheIcones()
    delete cache[host]
    cache[host] = url // reinsere no fim: os mais usados ficam
    const chaves = Object.keys(cache)
    for (const antiga of chaves.slice(0, Math.max(0, chaves.length - LIMITE_CACHE_ICONES))) delete cache[antiga]
    localStorage.setItem(CHAVE_ICONES, JSON.stringify(cache))
  } catch {
    /* sem armazenamento: o ícone só não fica em cache */
  }
}

function esquecerIcone(host) {
  try {
    const cache = lerCacheIcones()
    if (!(host in cache)) return
    delete cache[host]
    localStorage.setItem(CHAVE_ICONES, JSON.stringify(cache))
  } catch {
    /* ignora */
  }
}

function carregarImagem(url, { recusarMinusculo = false } = {}) {
  return new Promise((resolver) => {
    const imagem = new Image()
    imagem.alt = ''
    imagem.referrerPolicy = 'no-referrer'
    imagem.decoding = 'async'
    const limite = setTimeout(() => resolver(null), 6000)
    imagem.onload = () => {
      clearTimeout(limite)
      const minusculo = imagem.naturalWidth <= 16 && imagem.naturalHeight <= 16
      resolver(imagem.naturalWidth === 0 || (recusarMinusculo && minusculo) ? null : imagem)
    }
    imagem.onerror = () => {
      clearTimeout(limite)
      resolver(null)
    }
    imagem.src = url
  })
}

async function buscarIcone(host) {
  const candidatos = [host, dominioPrincipal(host)].filter(Boolean)
  for (const fonte of FONTES_ICONE) {
    for (const candidato of candidatos) {
      const url = fonte.url(candidato)
      const imagem = await carregarImagem(url, fonte)
      if (imagem) return { url, imagem }
    }
  }
  return null
}

const buscasEmAndamento = new Map() // host -> Promise: vários cartões do mesmo site fazem uma busca só

function iconeDoSite(host) {
  if (!buscasEmAndamento.has(host)) {
    const busca = buscarIcone(host).finally(() => buscasEmAndamento.delete(host))
    buscasEmAndamento.set(host, busca)
  }
  return buscasEmAndamento.get(host)
}

// Ícone do site (favicon). Enquanto carrega, ou se nenhuma fonte tiver o ícone, mostra a inicial do nome.
export function criarIconeSite(favorito) {
  const caixa = document.createElement('span')
  caixa.className = 'site-icon'
  caixa.setAttribute('aria-hidden', 'true')
  caixa.textContent = favorito.nome.trim().charAt(0).toUpperCase() || '?'

  const host = hostDe(favorito.url)

  function mostrar(url) {
    const imagem = new Image()
    imagem.alt = ''
    imagem.referrerPolicy = 'no-referrer'
    imagem.decoding = 'async'
    imagem.onload = () => caixa.replaceChildren(imagem)
    imagem.onerror = () => {
      // O ícone guardado deixou de funcionar (site mudou): descarta e procura de novo.
      esquecerIcone(host)
      procurar()
    }
    imagem.src = url
  }

  function procurar() {
    iconeDoSite(host).then((achado) => {
      if (!achado) return
      lembrarIcone(host, achado.url)
      caixa.replaceChildren(achado.imagem.cloneNode())
    })
  }

  const guardado = lerCacheIcones()[host]
  if (guardado) mostrar(guardado)
  else procurar()

  return caixa
}

/* ---------- Pastas e barras ---------- */

function avisar(texto, duracao = 3600) {
  if (typeof document === 'undefined') return
  const toast = document.querySelector('#toast')
  if (!toast) return
  toast.textContent = texto
  toast.classList.add('is-visible')
  clearTimeout(avisar.timer)
  avisar.timer = setTimeout(() => toast.classList.remove('is-visible'), duracao)
}

// Abre todos os links, um por guia. O navegador só deixa abrir mais de uma guia por clique se o site tiver
// permissão para pop-ups: sem ela, só a primeira abre e o restante é bloqueado. Por isso o retorno diz quantas
// foram bloqueadas, e o aviso explica como liberar.
export function abrirTodos(links) {
  let bloqueados = 0
  links.forEach((link) => {
    const aba = window.open(link.url, '_blank')
    if (aba) {
      try {
        aba.opener = null // a nova guia não controla esta
      } catch {
        /* sem acesso: segue */
      }
    } else {
      bloqueados++
    }
  })
  if (bloqueados) {
    avisar(
      `O navegador bloqueou ${bloqueados} ${bloqueados === 1 ? 'guia' : 'guias'}. Clique no ícone de pop-up bloqueado na barra de endereço, permita pop-ups para este site e use "Abrir todos" de novo.`,
      9000
    )
  } else if (links.length > 1) {
    avisar(`${links.length} links abertos`)
  }
  return bloqueados
}

// Ícone de pasta: grade com até 4 ícones pequenos (como as pastas de aplicativos do Android).
export function criarIconePasta(links) {
  const caixa = document.createElement('span')
  caixa.className = 'folder-icon'
  caixa.setAttribute('aria-hidden', 'true')
  const mostrados = links.slice(0, 4)
  mostrados.forEach((link) => caixa.append(criarIconeSite(link)))
  if (!mostrados.length) caixa.classList.add('is-empty')
  return caixa
}

let caixaAberta = null

export function fecharCaixaPasta() {
  if (!caixaAberta) return
  caixaAberta.caixa.remove()
  caixaAberta.gatilho.setAttribute('aria-expanded', 'false')
  caixaAberta = null
}

// Pequena caixa com os links da pasta e o botão "Abrir todos".
export function abrirCaixaPasta(pasta, links, gatilho) {
  const reabrir = caixaAberta?.gatilho === gatilho
  fecharCaixaPasta()
  if (reabrir) return

  const caixa = document.createElement('div')
  caixa.className = 'folder-pop'
  caixa.setAttribute('role', 'dialog')
  caixa.setAttribute('aria-label', `Pasta ${pasta.nome}`)

  const topo = document.createElement('div')
  topo.className = 'folder-pop-head'
  const titulo = document.createElement('strong')
  titulo.textContent = pasta.nome
  const todos = document.createElement('button')
  todos.type = 'button'
  todos.className = 'btn btn-sm'
  todos.innerHTML = icon('external')
  todos.append('Abrir todos')
  todos.disabled = links.length === 0
  todos.addEventListener('click', () => abrirTodos(links))
  topo.append(titulo, todos)

  const lista = document.createElement('div')
  lista.className = 'folder-pop-list'
  if (!links.length) {
    const vazio = document.createElement('p')
    vazio.className = 'folder-pop-empty'
    vazio.textContent = 'Pasta vazia. Adicione links pela central de favoritos.'
    lista.append(vazio)
  }
  links.forEach((link) => {
    const a = document.createElement('a')
    a.className = 'folder-pop-item'
    a.href = link.url
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.title = `${link.nome} · ${hostDe(link.url)}`
    const nome = document.createElement('span')
    nome.textContent = link.nome
    a.append(criarIconeSite(link), nome)
    lista.append(a)
  })

  caixa.append(topo, lista)
  document.body.append(caixa)
  gatilho.setAttribute('aria-expanded', 'true')
  caixaAberta = { caixa, gatilho }

  // Posição: abaixo do gatilho, sem sair da tela.
  const r = gatilho.getBoundingClientRect()
  const largura = caixa.offsetWidth
  const esquerda = Math.min(Math.max(8, r.left + r.width / 2 - largura / 2), window.innerWidth - largura - 8)
  caixa.style.left = `${esquerda}px`
  caixa.style.top = `${Math.min(r.bottom + 8, window.innerHeight - caixa.offsetHeight - 8)}px`
}

// (protegido: este módulo também é importado em testes, fora do navegador)
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    if (caixaAberta && !caixaAberta.caixa.contains(e.target) && !caixaAberta.gatilho.contains(e.target)) fecharCaixaPasta()
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') fecharCaixaPasta()
  })
  window.addEventListener('resize', fecharCaixaPasta)
}

function criarAtalhoLink(link, classe) {
  const a = document.createElement('a')
  a.className = classe
  a.href = link.url
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  a.title = `${link.nome} · ${hostDe(link.url)}`
  const nome = document.createElement('span')
  nome.textContent = link.nome
  a.append(criarIconeSite(link), nome)
  return a
}

function criarAtalhoPasta(item, classe) {
  const botao = document.createElement('button')
  botao.type = 'button'
  botao.className = `${classe} is-folder`
  botao.title = `${item.pasta.nome} · ${item.links.length} ${item.links.length === 1 ? 'link' : 'links'}`
  botao.setAttribute('aria-haspopup', 'dialog')
  botao.setAttribute('aria-expanded', 'false')
  const nome = document.createElement('span')
  nome.textContent = item.pasta.nome
  botao.append(criarIconePasta(item.links), nome)
  botao.addEventListener('click', () => abrirCaixaPasta(item.pasta, item.links, botao))
  return botao
}

/* ---------- Barras de atalhos ---------- */

// Barra central (página inicial, abaixo da pesquisa) e barra superior (canto superior direito, em todas as páginas).
// Só existem no modo pessoal. Um único carregamento alimenta as duas.
export function iniciarBarrasFavoritos() {
  const central = document.querySelector('#shortcuts')
  const superior = document.querySelector('#top-shortcuts')
  const grupoSuperior = document.querySelector('#top-favs')
  if (!central && !superior) return

  let favoritos = []
  let pastas = []
  let carregado = false
  let carregando = false

 const noModoPessoal = () => true

  function renderizar() {
    fecharCaixaPasta()

    if (central) {
      const itens = itensDaBarra(favoritos, pastas, 'central').slice(0, LIMITE_BARRA.central)
      central.replaceChildren(
        ...itens.map((item) => (item.tipo === 'pasta' ? criarAtalhoPasta(item, 'shortcut') : criarAtalhoLink(item.link, 'shortcut')))
      )
      if (!itens.length) {
        // Sem nada na barra: convida a adicionar (o botão "Todos" fica no canto superior).
        const mais = document.createElement('a')
        mais.className = 'shortcut shortcut-more'
        mais.href = 'favoritos.html'
        mais.innerHTML = `<span class="site-icon">${icon('plus')}</span>`
        const texto = document.createElement('span')
        texto.textContent = 'Adicionar'
        mais.append(texto)
        central.append(mais)
      }
    }

    if (superior) {
      const itens = itensDaBarra(favoritos, pastas, 'superior').slice(0, LIMITE_BARRA.superior)
      superior.replaceChildren(
        ...itens.map((item) => (item.tipo === 'pasta' ? criarAtalhoPasta(item, 'top-shortcut') : criarAtalhoLink(item.link, 'top-shortcut')))
      )
    }
    if (grupoSuperior) grupoSuperior.hidden = !noModoPessoal()
  }

  async function carregar() {
    if (carregando || !noModoPessoal()) return
    carregando = true
    try {
      ;({ favoritos, pastas } = await carregarTudo())
      carregado = true
    } catch {
      /* sem resposta: mostra o que já havia (ou só o convite para adicionar) */
    } finally {
      carregando = false
    }
    renderizar()
  }

  renderizar()
  carregar()

  // Ao voltar para a aba, traz alterações feitas em outro dispositivo ou aba.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && carregado) carregar()
  })
  // Alterações feitas na central de favoritos (mesma aba).
  window.addEventListener(EVENTO_FAVORITOS, carregar)
  // Trocar de modo: no profissional as barras somem; ao voltar ao pessoal, carrega se ainda não tinha.
  window.addEventListener('preferencias-alteradas', () => {
    if (grupoSuperior) grupoSuperior.hidden = !noModoPessoal()
    if (!carregado) carregar()
  })
}

// Compatibilidade: a página inicial chamava iniciarAtalhos(). As barras agora são iniciadas pelo shell.
export function iniciarAtalhos() {}

export { escaparHTML }
