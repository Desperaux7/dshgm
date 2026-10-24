import { assincrono, naoAutenticado, proibido } from '../lib/errors.js'
import { iguaisSeguro, sha256 } from '../lib/crypto.js'
import { lerCookies, limparCookie } from '../lib/cookies.js'

const FORMATO_SID = /^[A-Za-z0-9_-]{20,100}$/
const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS'])

// Resolve a sessão a partir do cookie. O servidor só guarda o hash do identificador.
export function carregarSessao({ config, repos }) {
  return assincrono(async (req, res, next) => {
    req.cookies = lerCookies(req.headers.cookie)
    const sid = req.cookies[config.sessao.cookie]
    if (sid && FORMATO_SID.test(sid)) {
      const idHash = sha256(sid)
      let s = await repos.sessoes.buscar(idHash)
      if (s && config.emailsPermitidos.size && !config.emailsPermitidos.has(String(s.email).toLowerCase())) {
        await repos.sessoes.remover(idHash) // e-mail removido da lista: a sessão deixa de valer
        s = null
      }
      if (s) {
        req.usuario = { id: s.id, email: s.email, nome: s.name, foto: s.picture_url, timezone: s.timezone }
        req.sessao = { idHash, csrf: s.csrf_token }
        if (s.ocioso_seg > 300) await repos.sessoes.renovar(idHash, config.sessao.ociosaSeg)
      } else {
        limparCookie(res, config.sessao.cookie, { producao: config.producao })
      }
    }
    next()
  })
}

export const exigirAutenticacao = (req, _res, next) => (req.usuario ? next() : next(naoAutenticado()))

// Token CSRF vinculado à sessão (padrão "synchronizer token"), enviado no cabeçalho X-CSRF-Token.
export function protegerCsrf(req, _res, next) {
  if (METODOS_SEGUROS.has(req.method)) return next()
  const enviado = req.get('x-csrf-token')
  if (!enviado || !req.sessao || !iguaisSeguro(enviado, req.sessao.csrf)) {
    return next(proibido('Token CSRF ausente ou inválido. Recarregue a página.'))
  }
  next()
}

// Defesa adicional: requisições de escrita vindas de outra origem são recusadas.
export function verificarOrigem(config) {
  return (req, _res, next) => {
    if (METODOS_SEGUROS.has(req.method)) return next()
    const origem = req.get('origin')
    if (origem && !config.origensPermitidas.has(origem)) return next(proibido('Origem não permitida.'))
    next()
  }
}
