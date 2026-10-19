// Cliente da API do DSHGM. Mesma origem (cookie de sessão HttpOnly); o token CSRF vem de /api/auth/me.
// Os módulos usam este cliente no lugar do localStorage (migração gradual, Fase 4).

export class ApiError extends Error {
  constructor(status, codigo, mensagem, detalhes) {
    super(mensagem)
    this.name = 'ApiError'
    this.status = status
    this.codigo = codigo
    this.detalhes = detalhes
  }
}

export const EVENTO_SESSAO_EXPIRADA = 'dshgm:sessao-expirada'

let csrfToken = null
let usuarioAtual = null

async function requisitar(metodo, caminho, corpo, { cabecalhos = {}, bruto = false, aoExpirar = true } = {}) {
  const opcoes = { method: metodo, credentials: 'same-origin', headers: { Accept: 'application/json', ...cabecalhos } }
  if (metodo !== 'GET' && csrfToken) opcoes.headers['X-CSRF-Token'] = csrfToken
  if (corpo !== undefined) {
    if (bruto) opcoes.body = corpo
    else {
      opcoes.headers['Content-Type'] = 'application/json'
      opcoes.body = JSON.stringify(corpo)
    }
  }

  let resp
  try {
    resp = await fetch(`/api${caminho}`, opcoes)
  } catch {
    throw new ApiError(0, 'sem_conexao', 'Sem conexão com o servidor.')
  }

  if (resp.status === 204) return null
  const dados = resp.headers.get('content-type')?.includes('application/json') ? await resp.json() : null
  if (!resp.ok) {
    const e = dados?.erro ?? {}
    if (resp.status === 401 && aoExpirar) window.dispatchEvent(new CustomEvent(EVENTO_SESSAO_EXPIRADA))
    const detalhe = e.detalhes?.[0]
    const complemento = detalhe ? ` (${detalhe.campo ? `${detalhe.campo}: ` : ''}${detalhe.mensagem})` : ''
    throw new ApiError(resp.status, e.codigo ?? 'erro', `${e.mensagem ?? 'Erro inesperado.'}${complemento}`, e.detalhes)
  }
  return dados
}

export const api = {
  get: (c) => requisitar('GET', c),
  post: (c, corpo = {}) => requisitar('POST', c, corpo),
  patch: (c, corpo) => requisitar('PATCH', c, corpo),
  put: (c, corpo = {}) => requisitar('PUT', c, corpo),
  delete: (c) => requisitar('DELETE', c),
  enviarImagem: (c, blob, { largura, altura }) =>
    requisitar('PUT', c, blob, { bruto: true, cabecalhos: { 'Content-Type': blob.type, 'X-Largura': String(largura), 'X-Altura': String(altura) } })
}

// Retorna o usuário logado ou null (sem disparar o aviso de sessão expirada).
export async function carregarSessao() {
  try {
    const { usuario, csrfToken: token } = await requisitar('GET', '/auth/me', undefined, { aoExpirar: false })
    csrfToken = token
    usuarioAtual = usuario
    return usuario
  } catch (erro) {
    if (erro.status === 401) {
      csrfToken = null
      usuarioAtual = null
      return null
    }
    throw erro
  }
}

export const usuarioLogado = () => usuarioAtual

export function entrarComGoogle(destino = window.location.pathname) {
  window.location.assign(`/api/auth/google/start?returnTo=${encodeURIComponent(destino)}`)
}

export async function sair() {
  await requisitar('POST', '/auth/logout', {})
  csrfToken = null
  usuarioAtual = null
}
