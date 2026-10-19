// Atualização usa PATCH (parcial): preserva convidados, local, videochamada etc. que o dashboard não conhece.
// Cliente mínimo do Google (OAuth 2.0 / OIDC e Calendar API v3) usando fetch.
// Sem SDK: menos dependências no pacote da função serverless e fácil de simular nos testes.
import { desafioPKCE } from '../lib/crypto.js'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const CAL_BASE = 'https://www.googleapis.com/calendar/v3'
const EMISSORES = ['https://accounts.google.com', 'accounts.google.com']

export class GoogleError extends Error {
  constructor(status, codigo, mensagem) {
    super(mensagem)
    this.name = 'GoogleError'
    this.status = status
    this.codigo = codigo
  }
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

export function criarClienteGoogle({ config, fetchImpl = globalThis.fetch, atrasos = [250, 1000] }) {
  const { clientId, clientSecret } = config.google

  // Nunca inclui tokens ou segredos na mensagem de erro.
  async function pedir(url, opcoes, { tentarNovamente = false } = {}) {
    let ultimo
    for (let i = 0; i <= (tentarNovamente ? atrasos.length : 0); i++) {
      try {
        const resp = await fetchImpl(url, { ...opcoes, signal: AbortSignal.timeout(9000) })
        if ((resp.status === 429 || resp.status >= 500) && i < atrasos.length && tentarNovamente) {
          await esperar(atrasos[i])
          continue
        }
        return resp
      } catch (erro) {
        ultimo = erro
        if (i < atrasos.length && tentarNovamente) await esperar(atrasos[i])
      }
    }
    throw new GoogleError(0, 'rede', `Falha de rede ao falar com o Google${ultimo?.name ? ` (${ultimo.name})` : ''}.`)
  }

  async function erroDe(resp) {
    let corpo = {}
    try {
      corpo = await resp.json()
    } catch {
      /* corpo vazio */
    }
    const interno = corpo.error
    const codigo = typeof interno === 'string' ? interno : (interno?.errors?.[0]?.reason ?? interno?.status ?? 'erro')
    const msg = typeof interno === 'string' ? (corpo.error_description ?? interno) : (interno?.message ?? 'Erro na API do Google.')
    return new GoogleError(resp.status, codigo, String(msg).slice(0, 200))
  }

  async function tokenEndpoint(parametros) {
    const resp = await pedir(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...parametros })
    })
    if (!resp.ok) throw await erroDe(resp)
    return resp.json()
  }

  async function cal(accessToken, metodo, caminho, { query, corpo, cabecalhos } = {}) {
    const url = new URL(`${CAL_BASE}${caminho}`)
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
    const resp = await pedir(
      url,
      {
        method: metodo,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(corpo ? { 'Content-Type': 'application/json' } : {}),
          ...cabecalhos
        },
        body: corpo ? JSON.stringify(corpo) : undefined
      },
      { tentarNovamente: metodo === 'GET' || metodo === 'DELETE' }
    )
    if (resp.status === 204) return null
    if (!resp.ok) throw await erroDe(resp)
    return resp.json()
  }
  const idCal = (id) => encodeURIComponent(id)

  return {
    gerarPKCE(verificador) {
      return desafioPKCE(verificador)
    },

    montarUrlAutorizacao({ redirectUri, escopos, state, nonce, desafio, offline = false, loginHint }) {
      const p = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: escopos.join(' '),
        state,
        nonce,
        code_challenge: desafio,
        code_challenge_method: 'S256',
        // Offline + consent garantem a entrega do refresh token no fluxo do calendário.
        ...(offline ? { access_type: 'offline', prompt: 'consent' } : { prompt: 'select_account' }),
        // Fixa a conta: sem isso o Google pode usar outra conta já aberta no navegador (ex.: fora da lista de testes).
        ...(loginHint ? { login_hint: loginHint } : {})
      })
      return `${AUTH_URL}?${p}`
    },

    trocarCodigo({ code, redirectUri, verificador }) {
      return tokenEndpoint({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verificador })
    },

    // O id_token vem direto do endpoint de tokens do Google por TLS, então a verificação da assinatura é
    // dispensada pela especificação OIDC (seção 3.1.3.7); validamos emissor, público, validade e nonce.
    validarIdToken(idToken, { nonce }) {
      let c
      try {
        c = JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8'))
      } catch {
        throw new GoogleError(400, 'id_token_invalido', 'id_token malformado.')
      }
      const agora = Math.floor(Date.now() / 1000)
      if (!EMISSORES.includes(c.iss)) throw new GoogleError(400, 'id_token_invalido', 'Emissor inválido.')
      const aud = Array.isArray(c.aud) ? c.aud : [c.aud]
      if (!aud.includes(clientId)) throw new GoogleError(400, 'id_token_invalido', 'Público inválido.')
      if (!c.exp || c.exp + 60 < agora) throw new GoogleError(400, 'id_token_invalido', 'id_token expirado.')
      if (!c.nonce || c.nonce !== nonce) throw new GoogleError(400, 'id_token_invalido', 'Nonce inválido.')
      if (!c.sub) throw new GoogleError(400, 'id_token_invalido', 'Identificador ausente.')
      return c
    },

    async renovarAcesso(refreshToken) {
      const t = await tokenEndpoint({ grant_type: 'refresh_token', refresh_token: refreshToken })
      return t.access_token
    },

    async revogar(token) {
      try {
        await pedir(REVOKE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token })
        })
      } catch {
        /* revogação é melhor-esforço: a credencial local é apagada de qualquer forma */
      }
    },

    calendario: {
      listar: (at, calendarId, query) => cal(at, 'GET', `/calendars/${idCal(calendarId)}/events`, { query }),
      obter: (at, calendarId, id) => cal(at, 'GET', `/calendars/${idCal(calendarId)}/events/${idCal(id)}`),
      inserir: (at, calendarId, evento) => cal(at, 'POST', `/calendars/${idCal(calendarId)}/events`, { corpo: evento }),
      atualizar: (at, calendarId, id, evento, etag) =>
        cal(at, 'PATCH', `/calendars/${idCal(calendarId)}/events/${idCal(id)}`, {
          corpo: evento,
          cabecalhos: etag ? { 'If-Match': etag } : undefined
        }),
      excluir: (at, calendarId, id) => cal(at, 'DELETE', `/calendars/${idCal(calendarId)}/events/${idCal(id)}`)
    }
  }
}
