import { Router } from 'express'
import { assinar, iguaisSeguro, sha256, tokenAleatorio, verificarAssinatura } from '../lib/crypto.js'
import { definirCookie, limparCookie } from '../lib/cookies.js'
import { HttpError, assincrono, naoAutenticado } from '../lib/errors.js'
import { exigirAutenticacao, protegerCsrf } from '../middleware/sessao.js'

// Só caminhos relativos simples do próprio site (evita redirecionamento aberto).
export function destinoSeguro(valor) {
  if (typeof valor !== 'string' || valor.length > 100) return '/'
  if (!/^\/[A-Za-z0-9._\-/]*$/.test(valor) || valor.startsWith('//') || valor.includes('..')) return '/'
  return valor
}

const usuarioPublico = (u) => ({ id: u.id, nome: u.nome, email: u.email, foto: u.foto ?? null, fuso: u.timezone })

export function criarRotasAuth({ config, repos, google, limites }) {
  const router = Router()
  const cookieOpts = { producao: config.producao }

  router.get('/google/start', limites.autenticacao, (req, res) => {
    if (!config.google.clientId) throw new HttpError(503, 'google_nao_configurado', 'Login Google não configurado.')
    const state = tokenAleatorio(24)
    const nonce = tokenAleatorio(24)
    const verificador = tokenAleatorio(48)
    const tx = assinar(
      { tipo: 'login', state, nonce, verificador, returnTo: destinoSeguro(req.query.returnTo), exp: Date.now() + 10 * 60_000 },
      config.sessionSecret
    )
    definirCookie(res, config.cookieOAuth, tx, { ...cookieOpts, maxAgeSeg: 600 })
    res.redirect(
      302,
      google.montarUrlAutorizacao({
        redirectUri: config.google.loginRedirectUri,
        escopos: config.google.loginEscopos,
        state,
        nonce,
        desafio: google.gerarPKCE(verificador)
      })
    )
  })

  router.get(
    '/google/callback',
    limites.autenticacao,
    assincrono(async (req, res) => {
      const tx = verificarAssinatura(req.cookies?.[config.cookieOAuth], config.sessionSecret)
      limparCookie(res, config.cookieOAuth, cookieOpts)
      const voltar = (motivo) => res.redirect(302, `${config.appUrl}/?erro_login=${motivo}`)

      if (!tx || tx.tipo !== 'login' || tx.exp < Date.now()) return voltar('sessao_expirada')
      if (req.query.error) return voltar(req.query.error === 'access_denied' ? 'cancelado' : 'falha')
      if (typeof req.query.state !== 'string' || !iguaisSeguro(req.query.state, tx.state)) return voltar('estado_invalido')
      if (typeof req.query.code !== 'string' || req.query.code.length > 2048) return voltar('falha')

      let claims
      try {
        const tokens = await google.trocarCodigo({
          code: req.query.code,
          redirectUri: config.google.loginRedirectUri,
          verificador: tx.verificador
        })
        claims = google.validarIdToken(tokens.id_token, { nonce: tx.nonce })
      } catch {
        return voltar('falha')
      }
      if (!claims.email) return voltar('falha')

      // Lista de e-mails permitidos: checada ANTES de criar usuário ou sessão. Exige e-mail verificado pelo Google.
      if (config.emailsPermitidos.size && !(claims.email_verified === true && config.emailsPermitidos.has(claims.email.toLowerCase()))) {
        return voltar('nao_autorizado')
      }

      const usuario = await repos.usuarios.upsertGoogle(
        { sub: claims.sub, email: claims.email, emailVerificado: claims.email_verified, nome: claims.name, foto: claims.picture },
        config.fusoPadrao
      )

      // Sempre uma sessão NOVA após o login (previne fixação); qualquer sessão anterior é encerrada.
      if (req.sessao) await repos.sessoes.remover(req.sessao.idHash)
      if (Math.random() < 0.1) await repos.sessoes.limparExpiradas()
      const sid = tokenAleatorio(32)
      await repos.sessoes.criar({
        userId: usuario.id,
        idHash: sha256(sid),
        csrf: tokenAleatorio(24),
        ociosaSeg: config.sessao.ociosaSeg,
        absolutaSeg: config.sessao.absolutaSeg
      })
      definirCookie(res, config.sessao.cookie, sid, { ...cookieOpts, maxAgeSeg: config.sessao.absolutaSeg })
      res.redirect(302, `${config.appUrl}${tx.returnTo}`)
    })
  )

  router.get('/me', (req, res) => {
    if (!req.usuario) throw naoAutenticado()
    res.json({ usuario: usuarioPublico(req.usuario), csrfToken: req.sessao.csrf })
  })

  router.post(
    '/logout',
    exigirAutenticacao,
    protegerCsrf,
    assincrono(async (req, res) => {
      await repos.sessoes.remover(req.sessao.idHash)
      limparCookie(res, config.sessao.cookie, cookieOpts)
      res.status(204).end()
    })
  )

  return router
}
