import { Router } from 'express'
import { assinar, iguaisSeguro, tokenAleatorio, verificarAssinatura } from '../lib/crypto.js'
import { definirCookie, limparCookie } from '../lib/cookies.js'
import { HttpError, assincrono } from '../lib/errors.js'

const ESCOPO_CALENDARIO = 'https://www.googleapis.com/auth/calendar.events'

// A autorização do calendário é um fluxo SEPARADO do login: entrar no dashboard não exige conectar o Google Calendar.
// `publico` recebe rotas que precisam de sessão mas não de CSRF (navegação GET do OAuth);
// `protegido` já vem com autenticação + CSRF aplicados pelo app.
export function criarRotasCalendario({ config, repos, google, calendario, limites }) {
  const publico = Router()
  const protegido = Router()
  const cookieOpts = { producao: config.producao }

  publico.get('/conectar', (req, res) => {
    if (!req.usuario) return res.redirect(302, `${config.appUrl}/?erro_login=sessao_expirada`)
    if (!config.google.clientId) throw new HttpError(503, 'google_nao_configurado', 'Google não configurado.')
    const state = tokenAleatorio(24)
    const nonce = tokenAleatorio(24)
    const verificador = tokenAleatorio(48)
    const tx = assinar(
      { tipo: 'calendario', userId: req.usuario.id, state, nonce, verificador, exp: Date.now() + 10 * 60_000 },
      config.sessionSecret
    )
    definirCookie(res, config.cookieOAuth, tx, { ...cookieOpts, maxAgeSeg: 600 })
    res.redirect(
      302,
      google.montarUrlAutorizacao({
        redirectUri: config.google.calendarRedirectUri,
        escopos: config.google.calendarioEscopos, // somente calendar.events (+ openid/email para identificar a conta)
        state,
        nonce,
        desafio: google.gerarPKCE(verificador),
        offline: true,
        loginHint: req.usuario.email
      })
    )
  })

  publico.get(
    '/callback',
    assincrono(async (req, res) => {
      const tx = verificarAssinatura(req.cookies?.[config.cookieOAuth], config.sessionSecret)
      limparCookie(res, config.cookieOAuth, cookieOpts)
      const voltar = (motivo) => res.redirect(302, `${config.appUrl}/agenda.html?calendario=${motivo}`)

      if (!req.usuario) return res.redirect(302, `${config.appUrl}/?erro_login=sessao_expirada`)
      if (!tx || tx.tipo !== 'calendario' || tx.exp < Date.now() || tx.userId !== req.usuario.id) return voltar('sessao_expirada')
      if (req.query.error) return voltar(req.query.error === 'access_denied' ? 'cancelado' : 'falha')
      if (typeof req.query.state !== 'string' || !iguaisSeguro(req.query.state, tx.state)) return voltar('estado_invalido')
      if (typeof req.query.code !== 'string' || req.query.code.length > 2048) return voltar('falha')

      let tokens
      let claims
      try {
        tokens = await google.trocarCodigo({
          code: req.query.code,
          redirectUri: config.google.calendarRedirectUri,
          verificador: tx.verificador
        })
        claims = google.validarIdToken(tokens.id_token, { nonce: tx.nonce })
      } catch {
        return voltar('falha')
      }

      // O usuário pode desmarcar a permissão na tela de consentimento: sem o escopo, não conectamos.
      if (!String(tokens.scope ?? '').split(' ').includes(ESCOPO_CALENDARIO)) return voltar('permissao_negada')
      if (!tokens.refresh_token) return voltar('sem_credencial_offline')

      await calendario.conectar(req.usuario.id, {
        refreshToken: tokens.refresh_token,
        email: claims.email,
        escopos: ESCOPO_CALENDARIO
      })
      voltar('conectado')
    })
  )

  protegido.get(
    '/status',
    assincrono(async (req, res) => {
      res.json(await calendario.status(req.usuario.id))
    })
  )

  protegido.post(
    '/sincronizar',
    limites.sincronizacao,
    assincrono(async (req, res) => {
      const resultado = await calendario.sincronizar(req.usuario.id, {
        fuso: req.usuario.timezone,
        forcar: req.body?.forcar === true
      })
      res.json({ ...resultado, status: await calendario.status(req.usuario.id) })
    })
  )

  protegido.delete(
    '/conexao',
    assincrono(async (req, res) => {
      await calendario.desconectar(req.usuario.id)
      res.status(204).end()
    })
  )

  return { publico, protegido }
}
