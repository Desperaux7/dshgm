import { perfil } from '../config.js'
import { lerJSON, salvarJSON } from '../services/storage.js'

const CHAVE = 'dashboard-preferencias'
export const EVENTO = 'preferencias-alteradas'

export const DESTAQUES = [
  { id: 'ciano', nome: 'Ciano', cor: '#5eead4' },
  { id: 'oceano', nome: 'Oceano', cor: '#38bdf8' },
  { id: 'menta', nome: 'Menta', cor: '#34d399' },
  { id: 'ambar', nome: 'Âmbar', cor: '#fbbf24' }
]

// Cartões da página inicial que podem ser exibidos ou ocultados.
export const CARTOES = [
  { id: 'resumo-tarefas', grupo: 'Indicadores', nome: 'Tarefas pendentes' },
  { id: 'resumo-agenda', grupo: 'Indicadores', nome: 'Próximo compromisso' },
  { id: 'resumo-saldo', grupo: 'Indicadores', nome: 'Saldo do mês' },
  { id: 'painel-agenda', grupo: 'Painéis', nome: 'Agenda' },
  { id: 'painel-tarefas', grupo: 'Painéis', nome: 'Tarefas do dia' },
  { id: 'painel-spotify', grupo: 'Painéis', nome: 'Spotify' },
  { id: 'atalhos', grupo: 'Início', nome: 'Atalhos de favoritos' }
]

export const PADRAO = {
  nome: '',
  foto: null,
  destaque: 'ciano',
  fundo: 'animado', // animado | estatico | desligado
  densidade: 'confortavel', // confortavel | compacta
  hora24: true,
  inicioSemana: 0, // 0 = domingo, 1 = segunda
  clima: { ativo: true, unidade: 'C', cidade: null }, // cidade: { nome, lat, lon } ou null (localização do navegador)
  cartoes: Object.fromEntries(CARTOES.map((c) => [c.id, true]))
}

function mesclar(salvas) {
  const s = salvas && typeof salvas === 'object' ? salvas : {}
  return {
    ...PADRAO,
    ...s,
    clima: { ...PADRAO.clima, ...(s.clima ?? {}) },
    cartoes: { ...PADRAO.cartoes, ...(s.cartoes ?? {}) }
  }
}

let atuais = mesclar(lerJSON(CHAVE, null))

export const lerPreferencias = () => atuais

export function nomeExibicao() {
  return atuais.nome.trim() || perfil.nome
}

export function fotoPerfil() {
  return atuais.foto || perfil.avatar || null
}

/* ---------- Aplicação no documento ---------- */

export function aplicarPreferencias(prefs = atuais) {
  const raiz = document.documentElement
  raiz.dataset.accent = prefs.destaque
  raiz.dataset.aurora = { animado: 'animada', estatico: 'estatica', desligado: 'desligada' }[prefs.fundo] ?? 'animada'
  raiz.dataset.densidade = prefs.densidade

  document.querySelectorAll('[data-card]').forEach((el) => {
    el.hidden = prefs.cartoes[el.dataset.card] === false
  })
}

/* ---------- Atualização ---------- */

// Aceita um objeto parcial; clima e cartoes são mesclados campo a campo.
export function atualizarPreferencias(parcial) {
  const proximas = mesclar({
    ...atuais,
    ...parcial,
    clima: { ...atuais.clima, ...(parcial.clima ?? {}) },
    cartoes: { ...atuais.cartoes, ...(parcial.cartoes ?? {}) }
  })

  const salvou = salvarJSON(CHAVE, proximas)
  atuais = proximas
  aplicarPreferencias(atuais)
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: atuais }))
  return salvou
}

export function restaurarPadroes() {
  try {
    localStorage.removeItem(CHAVE)
  } catch {
    /* sem armazenamento: apenas volta ao padrão na sessão */
  }
  atuais = mesclar(null)
  aplicarPreferencias(atuais)
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: atuais }))
}

// Várias abas abertas permanecem sincronizadas.
window.addEventListener('storage', (evento) => {
  if (evento.key !== CHAVE) return
  atuais = mesclar(lerJSON(CHAVE, null))
  aplicarPreferencias(atuais)
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: atuais }))
})
