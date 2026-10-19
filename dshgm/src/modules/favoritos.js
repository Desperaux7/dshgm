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

// Ícone do site (favicon). Se não carregar, mostra a inicial do nome.
export function criarIconeSite(favorito) {
  const caixa = document.createElement('span')
  caixa.className = 'site-icon'
  caixa.setAttribute('aria-hidden', 'true')

  const inicial = favorito.nome.trim().charAt(0).toUpperCase() || '?'
  caixa.textContent = inicial

  const imagem = new Image()
  imagem.alt = ''
  imagem.referrerPolicy = 'no-referrer'
  imagem.decoding = 'async'
  imagem.onload = () => caixa.replaceChildren(imagem)
  imagem.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostDe(favorito.url))}&sz=64`

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
