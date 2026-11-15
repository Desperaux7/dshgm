import { perfil } from '../config.js'
import { lerJSON, salvarJSON } from '../services/storage.js'
import { api } from '../services/api.js'
import { MODOS, cartaoVisivel as cartaoVisivelEm, cartoesDoModo, padraoCartoes } from './modos.js'

export { MODOS, cartoesDoModo }

const CHAVE = 'dashboard-preferencias'
const CHAVE_PENDENTE = 'dashboard-preferencias-pendente'
const CHAVE_NOME = 'dashboard-nome-exibicao'
export const EVENTO = 'preferencias-alteradas'

export const DESTAQUES = [
  { id: 'ciano', nome: 'Ciano', cor: '#5eead4' },
  { id: 'oceano', nome: 'Oceano', cor: '#38bdf8' },
  { id: 'menta', nome: 'Menta', cor: '#34d399' },
  { id: 'ambar', nome: 'Âmbar', cor: '#fbbf24' },
  // Temas de duas cores (a segunda aparece na bolinha de escolha).
  { id: 'vermelho', nome: 'Vermelho e preto', cor: '#ef4444', cor2: '#0a0405' },
  { id: 'dourado', nome: 'Dourado e preto', cor: '#d4af37', cor2: '#0a0805' },
  { id: 'monocromo', nome: 'Preto e branco', cor: '#f5f5f5', cor2: '#050505' },
  { id: 'sakura', nome: 'Sakura (rosa)', cor: '#f9a8c9', cor2: '#fde2ee' }
]

export const PADRAO = {
  modo: 'pessoal', // pessoal | profissional
  nome: '',
  foto: null,
  destaque: 'ciano',
  fundo: 'animado', // animado | estatico | desligado
  densidade: 'confortavel', // confortavel | compacta
  hora24: true,
  inicioSemana: 0, // 0 = domingo, 1 = segunda
  clima: { ativo: true, unidade: 'C', cidade: null }, // cidade: { nome, lat, lon } ou null (localização do navegador)
  cartoes: padraoCartoes('pessoal'),
  cartoesPro: padraoCartoes('profissional')
}

function mesclar(salvas) {
  const s = salvas && typeof salvas === 'object' ? salvas : {}
  return {
    ...PADRAO,
    ...s,
    clima: { ...PADRAO.clima, ...(s.clima ?? {}) },
    modo: MODOS.some((m) => m.id === s.modo) ? s.modo : PADRAO.modo,
    cartoes: { ...PADRAO.cartoes, ...(s.cartoes ?? {}) },
    cartoesPro: { ...PADRAO.cartoesPro, ...(s.cartoesPro ?? {}) }
  }
}

export const modoAtual = () => atuais.modo

export const cartaoVisivel = (id, prefs = atuais) => cartaoVisivelEm(id, prefs)

let atuais = mesclar(lerJSON(CHAVE, null))
let versaoLocal = 0 // muda a cada alteração feita pelo usuário (evita que uma resposta atrasada do servidor a desfaça)

export const lerPreferencias = () => atuais

// Dados da conta Google: usados só como padrão quando o usuário não definiu nome/foto nas preferências.
let externo = { nome: '', foto: null }

export function definirUsuarioExterno({ nome, foto }) {
  externo = { nome: String(nome ?? '').trim().split(/\s+/)[0] ?? '', foto: foto ?? null }
  guardarNomeDaSaudacao()
}

export function nomeExibicao() {
  return atuais.nome.trim() || externo.nome || perfil.nome
}

// Nome para a saudação da página inicial: só o que a conta realmente tem (nunca um nome fixo de outra pessoa).
export function nomeSaudacao() {
  return atuais.nome.trim() || externo.nome || ''
}

// A página inicial lê este valor antes do primeiro desenho (script no index.html), sem esperar o servidor.
function guardarNomeDaSaudacao() {
  try {
    const nome = nomeSaudacao()
    if (nome) localStorage.setItem(CHAVE_NOME, nome)
    else localStorage.removeItem(CHAVE_NOME)
  } catch {
    /* sem armazenamento: a saudação aparece quando a conta responder */
  }
}

export function fotoPerfil() {
  return atuais.foto || externo.foto || perfil.avatar || null
}

/* ---------- Aplicação no documento ---------- */

export function aplicarPreferencias(prefs = atuais) {
  const raiz = document.documentElement
  raiz.dataset.accent = prefs.destaque
  raiz.dataset.aurora = { animado: 'animada', estatico: 'estatica', desligado: 'desligada' }[prefs.fundo] ?? 'animada'
  raiz.dataset.densidade = prefs.densidade
  raiz.dataset.modo = prefs.modo

  document.querySelectorAll('[data-card]').forEach((el) => {
    el.hidden = !cartaoVisivel(el.dataset.card, prefs)
  })
}

/* ---------- Atualização ---------- */

// Aceita um objeto parcial; clima e cartoes são mesclados campo a campo.
export function atualizarPreferencias(parcial) {
  const proximas = mesclar({
    ...atuais,
    ...parcial,
    clima: { ...atuais.clima, ...(parcial.clima ?? {}) },
    cartoes: { ...atuais.cartoes, ...(parcial.cartoes ?? {}) },
    cartoesPro: { ...atuais.cartoesPro, ...(parcial.cartoesPro ?? {}) }
  })

  const salvou = salvarJSON(CHAVE, proximas)
  atuais = proximas
  versaoLocal++
  guardarNomeDaSaudacao()
  aplicarPreferencias(atuais)
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: atuais }))
  agendarEnvio(parcial)
  return salvou
}

export function restaurarPadroes() {
  atuais = mesclar(null)
  versaoLocal++
  salvarJSON(CHAVE, atuais)
  guardarNomeDaSaudacao()
  aplicarPreferencias(atuais)
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: atuais }))
  agendarEnvio(atuais) // sobrescreve também na conta (nome vazio e foto removida)
}

/* ---------- Sincronização com a conta ---------- */

// As alterações valem na hora (cache local) e são enviadas à conta logo depois, agrupadas.
// Se o envio falhar, ficam marcadas como pendentes e são reenviadas no próximo carregamento.
let fila = {}
let temporizador = null

function juntar(base, novo) {
  return {
    ...base,
    ...novo,
    ...(novo.clima || base.clima ? { clima: { ...(base.clima ?? {}), ...(novo.clima ?? {}) } } : {}),
    ...(novo.cartoes || base.cartoes ? { cartoes: { ...(base.cartoes ?? {}), ...(novo.cartoes ?? {}) } } : {}),
    ...(novo.cartoesPro || base.cartoesPro ? { cartoesPro: { ...(base.cartoesPro ?? {}), ...(novo.cartoesPro ?? {}) } } : {})
  }
}

function agendarEnvio(parcial) {
  fila = juntar(fila, parcial)
  try {
    localStorage.setItem(CHAVE_PENDENTE, '1')
  } catch {
    /* sem armazenamento: segue sem marca de pendência */
  }
  clearTimeout(temporizador)
  temporizador = setTimeout(enviarFila, 600)
}

async function enviarFila() {
  const corpo = fila
  fila = {}
  try {
    await api.patch('/preferencias', corpo)
    if (!Object.keys(fila).length) localStorage.removeItem(CHAVE_PENDENTE)
  } catch (erro) {
    fila = juntar(corpo, fila) // mantém para a próxima tentativa
    console.warn('Preferências salvas só neste navegador por enquanto:', erro.message)
  }
}

// Envia na saída da página o que ainda estiver na fila (best effort).
window.addEventListener('pagehide', () => {
  if (!Object.keys(fila).length) return
  clearTimeout(temporizador)
  enviarFila()
})

function aplicarEstado(proximas) {
  atuais = mesclar(proximas)
  salvarJSON(CHAVE, atuais)
  guardarNomeDaSaudacao()
  aplicarPreferencias(atuais)
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: atuais }))
}

// Chamado após o login: reenvia pendências de uma sessão anterior e traz as preferências da conta.
export async function sincronizarComServidor() {
  const versaoInicial = versaoLocal
  const pendente = localStorage.getItem(CHAVE_PENDENTE) !== null
  if (pendente) {
    try {
      await api.patch('/preferencias', atuais)
      localStorage.removeItem(CHAVE_PENDENTE)
    } catch {
      return // sem conexão: continua com o cache local, tenta de novo na próxima vez
    }
  }
  // Depois de enviar pendências, a resposta pré-carregada estaria desatualizada: busca de novo.
  const { preferencias } = await (pendente ? api.getAtual('/preferencias') : api.get('/preferencias'))
  if (versaoLocal !== versaoInicial) return // o usuário mexeu enquanto a resposta vinha: o que ele fez vale mais
  const { foto, ...resto } = preferencias ?? {}
  if (Object.keys(resto).length || foto) aplicarEstado(preferencias)
}

// Várias abas abertas permanecem sincronizadas.
window.addEventListener('storage', (evento) => {
  if (evento.key !== CHAVE) return
  atuais = mesclar(lerJSON(CHAVE, null))
  aplicarPreferencias(atuais)
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: atuais }))
})
