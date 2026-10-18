import { icon } from './icons.js'
import { lerJSON, salvarJSON, escaparHTML } from '../services/storage.js'

const CHAVE = 'dashboard-favoritos'

export const CATEGORIAS_PADRAO = ['Estudos', 'Desenvolvimento', 'Dia a dia', 'Games']
const LIMITE_ATALHOS = 8

/*
  Modelo de favorito:
  { id, nome, url, categoria, fixado, criado }
  fixado: aparece nos atalhos da página inicial.
*/

function normalizar(bruto) {
  if (!bruto || typeof bruto.url !== 'string' || typeof bruto.nome !== 'string') return null
  return {
    id: bruto.id ?? crypto.randomUUID(),
    nome: bruto.nome,
    url: bruto.url,
    categoria: typeof bruto.categoria === 'string' && bruto.categoria ? bruto.categoria : 'Dia a dia',
    fixado: bruto.fixado !== false,
    criado: Number(bruto.criado) || Date.now()
  }
}

export function carregarFavoritos() {
  const dados = lerJSON(CHAVE, [])
  return Array.isArray(dados) ? dados.map(normalizar).filter(Boolean) : []
}

export const salvarFavoritos = (lista) => salvarJSON(CHAVE, lista)
export const CHAVE_FAVORITOS = CHAVE

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

  function renderizar() {
    const lista = carregarFavoritos()
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

  renderizar()
  window.addEventListener('storage', (e) => {
    if (e.key === CHAVE) renderizar()
  })
}

export { escaparHTML }
