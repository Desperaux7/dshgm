import { icon } from './icons.js'
import { escaparHTML } from '../services/storage.js'
import { favoritosApi } from '../services/favoritosApi.js'

export const CATEGORIAS_PADRAO = ['Estudos', 'Desenvolvimento', 'Dia a dia', 'Games']
const LIMITE_ATALHOS = 8

/*
  Modelo de favorito:
  { id, nome, url, categoria, fixado, criado }
  fixado: aparece nos atalhos da página inicial.
*/

// Favoritos da conta (o servidor devolve o modelo já normalizado).
export const carregarFavoritos = () => favoritosApi.listar()

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

/* ---------- Atalhos na página inicial ---------- */

export function iniciarAtalhos() {
  const raiz = document.querySelector('#shortcuts')
  if (!raiz) return

  let favoritos = []

  function renderizar() {
    const lista = favoritos
      .filter((f) => f.fixado)
      .sort((a, b) => a.criado - b.criado)
    const visiveis = lista.slice(0, LIMITE_ATALHOS)

    raiz.replaceChildren()

    visiveis.forEach((favorito) => {
      const link = document.createElement('a')
      link.className = 'shortcut'
      link.href = favorito.url
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      link.title = `${favorito.nome} · ${hostDe(favorito.url)}`

      const nome = document.createElement('span')
      nome.textContent = favorito.nome

      link.append(criarIconeSite(favorito), nome)
      raiz.append(link)
    })

    const mais = document.createElement('a')
    mais.className = 'shortcut shortcut-more'
    mais.href = 'favoritos.html'
    mais.innerHTML = `<span class="site-icon">${icon(visiveis.length ? 'bookmark' : 'plus')}</span>`
    const textoMais = document.createElement('span')
    textoMais.textContent = visiveis.length ? 'Todos' : 'Adicionar'
    mais.append(textoMais)
    raiz.append(mais)
  }

  async function carregar() {
    try {
      favoritos = await carregarFavoritos()
    } catch {
      /* sem resposta: mostra só o atalho "Adicionar" */
    }
    renderizar()
  }

  carregar()
  // Ao voltar para a aba, traz alterações feitas em outro dispositivo ou aba.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) carregar()
  })
}

export { escaparHTML }
