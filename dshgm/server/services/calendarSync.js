// Sincronização bidirecional com o Google Calendar.
//
// Estratégia (compatível com serverless, sem processo permanente):
//  - Sincroniza ao abrir o dashboard (POST /api/calendar/sync, no máximo 1x a cada 30 s),
//    após cada alteração local (envio imediato) e por um agendador do Netlify (a cada 15 min).
//  - NÃO é instantâneo: alterações feitas no Google aparecem na próxima sincronização.
//  - Google -> local: listagem incremental com syncToken; 410 (token expirado) dispara ressincronização completa.
//  - Local -> Google: id determinístico (uuid sem hífens) torna o reenvio idempotente (409 = já existe).
//  - Conflitos: vence a alteração mais recente (updated). Exclusão no Google prevalece sobre edição local.
import { descriptografar, criptografar } from '../lib/crypto.js'
import { formatarNoFuso } from '../lib/dates.js'
import { paraApi } from '../repositories/events.js'
import { GoogleError } from './google.js'
import { deGoogle, diaOriginal, googleIdDe, paraGoogle } from './eventMapping.js'

const JANELA_INICIAL_DIAS = 90
const TRANSITORIOS = (e) => !e.status || e.status === 429 || e.status >= 500

export function criarServicoCalendario({ repos, google, config, agora = () => new Date() }) {
  const { eventos, calendario } = repos
  const chave = config.tokenEncryptionKey

  async function tokenDeAcesso(userId, conexao) {
    let refresh
    try {
      refresh = descriptografar(conexao.refresh_token_enc, chave)
    } catch {
      await calendario.definirStatus(userId, 'error', 'Credencial ilegível. Reconecte o Google Calendar.')
      throw new GoogleError(0, 'credencial_ilegivel', 'Credencial ilegível.')
    }
    try {
      return await google.renovarAcesso(refresh)
    } catch (erro) {
      if (erro instanceof GoogleError && erro.codigo === 'invalid_grant') {
        await calendario.definirStatus(userId, 'revoked', 'O acesso ao Google Calendar foi revogado. Reconecte.')
      }
      throw erro
    }
  }

  /* ---------- Local -> Google ---------- */

  async function atualizarRemoto(ctx, googleId, corpo, etag) {
    return google.calendario.atualizar(ctx.acesso, ctx.calId, googleId, { ...corpo, id: googleId }, etag)
  }

  async function aplicarRemoto(userId, ctx, g, linha) {
    const dados = deGoogle(g, ctx.fuso)
    if (!dados) return
    await eventos.aplicarDoGoogle(userId, linha.id, dados, {
      etag: g.etag,
      atualizadoEm: g.updated,
      naoSuportada: dados.naoSuportada
    })
  }

  async function resolverConflito(userId, ctx, linha, googleId, corpo) {
    const remoto = await google.calendario.obter(ctx.acesso, ctx.calId, googleId)
    if (remoto.status === 'cancelled') {
      await eventos.excluirDefinitivo(userId, linha.id)
      return 'removido_no_google'
    }
    if (new Date(remoto.updated) > new Date(linha.updated_at)) {
      await aplicarRemoto(userId, ctx, remoto, linha) // o Google é mais recente: vence
      return 'remoto_venceu'
    }
    const resp = await atualizarRemoto(ctx, googleId, corpo, remoto.etag)
    await eventos.marcarSincronizado(userId, linha.id, { googleId, etag: resp.etag, atualizadoEm: resp.updated })
    return 'local_venceu'
  }

  async function enviarUm(userId, linha, ctx) {
    if (linha.sync_state === 'pending_delete' || linha.excluido) {
      if (linha.google_event_id && linha.google_etag) {
        try {
          await google.calendario.excluir(ctx.acesso, ctx.calId, linha.google_event_id)
        } catch (e) {
          if (e.status !== 404 && e.status !== 410) throw e
        }
      }
      await eventos.excluirDefinitivo(userId, linha.id)
      return 'excluido'
    }
    // Recorrência que o dashboard não representa: somente leitura, para nunca sobrescrever a regra original.
    if (linha.unsupported_recurrence) return 'somente_leitura'

    const modelo = paraApi(linha)
    const googleId = linha.google_event_id ?? googleIdDe(linha.id)
    let resp

    if (linha.google_etag) {
      const corpo = paraGoogle(modelo, ctx.fuso)
      try {
        resp = await atualizarRemoto(ctx, googleId, corpo, linha.google_etag)
      } catch (e) {
        if (e.status === 412) return resolverConflito(userId, ctx, linha, googleId, corpo)
        if (e.status === 404 || e.status === 410) {
          await eventos.excluirDefinitivo(userId, linha.id)
          return 'removido_no_google'
        }
        throw e
      }
    } else {
      const corpo = paraGoogle(modelo, ctx.fuso, { novo: true })
      try {
        resp = await google.calendario.inserir(ctx.acesso, ctx.calId, { ...corpo, id: googleId })
      } catch (e) {
        if (e.status !== 409) throw e
        // Já existe (reenvio após falha, ou reconexão): reaproveita em vez de duplicar.
        const existente = await google.calendario.obter(ctx.acesso, ctx.calId, googleId)
        const { reminders, ...parcial } = corpo
        resp = await atualizarRemoto(ctx, googleId, existente.status === 'cancelled' ? { ...parcial, status: 'confirmed' } : parcial, existente.etag)
      }
    }
    await eventos.marcarSincronizado(userId, linha.id, { googleId, etag: resp.etag, atualizadoEm: resp.updated })
    return 'enviado'
  }

  async function enviarPendentes(userId, ctx, resumo) {
    for (const linha of await eventos.pendentes(userId)) {
      try {
        const r = await enviarUm(userId, linha, ctx)
        if (r === 'excluido') resumo.excluidosNoGoogle++
        else if (r === 'enviado' || r === 'local_venceu') resumo.enviados++
      } catch (e) {
        if (e instanceof GoogleError && (e.status === 401 || e.codigo === 'invalid_grant')) throw e
        resumo.erros++
        // Falhas temporárias continuam "pending" e são repetidas na próxima sincronização.
        await eventos.marcarErro(userId, linha.id, e.message, TRANSITORIOS(e) ? 'pending' : 'error')
      }
    }
  }

  /* ---------- Google -> Local ---------- */

  async function processarItem(userId, ctx, g, resumo, vistos) {
    if (g.recurringEventId) {
      if (g.status === 'cancelled') {
        const dia = diaOriginal(g, ctx.fuso)
        if (dia) await eventos.acrescentarExcecao(userId, g.recurringEventId, dia)
        resumo.excecoes++
      } else {
        resumo.instanciasAlteradasIgnoradas++ // o dashboard não representa uma ocorrência isolada alterada
      }
      return
    }
    if (g.status === 'cancelled') {
      await eventos.excluirPorGoogleId(userId, g.id)
      resumo.removidos++
      return
    }

    const dados = deGoogle(g, ctx.fuso)
    if (!dados) {
      resumo.ignorados++
      return
    }
    vistos.add(g.id)

    const local = await eventos.porGoogleId(userId, g.id)
    if (!local) {
      await eventos.inserirDoGoogle(userId, dados, { googleId: g.id, etag: g.etag, atualizadoEm: g.updated, naoSuportada: dados.naoSuportada })
      resumo.criados++
      return
    }
    if (local.google_etag && local.google_etag === g.etag) return // eco da nossa própria alteração
    if (local.sync_state === 'pending_delete' || local.excluido) return

    const alteracaoLocalPendente = ['pending', 'error', 'local'].includes(local.sync_state)
    if (alteracaoLocalPendente && new Date(local.updated_at) > new Date(g.updated)) {
      await eventos.atualizarEtag(userId, local.id, g.etag) // a edição local é mais recente: será enviada
      return
    }
    await eventos.aplicarDoGoogle(userId, local.id, dados, { etag: g.etag, atualizadoEm: g.updated, naoSuportada: dados.naoSuportada })
    resumo.atualizados++
  }

  async function puxar(userId, ctx, conexao, resumo) {
    let syncToken = conexao.sync_token
    const desde = new Date(agora().getTime() - JANELA_INICIAL_DIAS * 86400000)

    for (let tentativa = 0; tentativa < 2; tentativa++) {
      const completo = !syncToken
      const itens = []
      let pageToken
      let proximoToken
      try {
        do {
          const query = syncToken
            ? { syncToken, pageToken, maxResults: 250 }
            : { timeMin: desde.toISOString(), pageToken, maxResults: 250, singleEvents: false }
          const r = await google.calendario.listar(ctx.acesso, ctx.calId, query)
          itens.push(...(r.items ?? []))
          pageToken = r.nextPageToken
          proximoToken = r.nextSyncToken ?? proximoToken
        } while (pageToken)
      } catch (e) {
        if (e.status === 410 && syncToken) {
          // Cursor expirado: descarta e refaz a sincronização completa (uma única vez).
          await calendario.limparSyncToken(userId)
          syncToken = null
          resumo.ressincronizacaoCompleta = true
          continue
        }
        throw e
      }

      // Eventos-mestre antes das instâncias, para as exceções encontrarem o mestre.
      itens.sort((a, b) => Number(Boolean(a.recurringEventId)) - Number(Boolean(b.recurringEventId)))
      const vistos = new Set()
      for (const g of itens) await processarItem(userId, ctx, g, resumo, vistos)

      if (completo) {
        const dataMinima = formatarNoFuso(desde, ctx.fuso).data
        resumo.removidos += await eventos.reconciliarAusentes(userId, [...vistos], dataMinima)
      }
      return proximoToken
    }
    throw new GoogleError(410, 'sync_token_expirado', 'Não foi possível reiniciar a sincronização.')
  }

  /* ---------- API do serviço ---------- */

  async function sincronizar(userId, { fuso, forcar = false }) {
    const conexao = await calendario.obter(userId)
    if (!conexao || conexao.status !== 'connected') return { estado: 'desconectado' }
    if (!forcar && conexao.segundos_desde_sync !== null && conexao.segundos_desde_sync < 30) {
      return { estado: 'recente' }
    }
    if (!(await calendario.adquirirTrava(userId))) return { estado: 'em_andamento' }

    const resumo = {
      criados: 0, atualizados: 0, removidos: 0, excecoes: 0, ignorados: 0,
      instanciasAlteradasIgnoradas: 0, enviados: 0, excluidosNoGoogle: 0, erros: 0, ressincronizacaoCompleta: false
    }
    try {
      const ctx = { acesso: await tokenDeAcesso(userId, conexao), calId: conexao.calendar_id, fuso }
      const proximoToken = await puxar(userId, ctx, conexao, resumo)
      await enviarPendentes(userId, ctx, resumo)
      await calendario.registrarSync(userId, { syncToken: proximoToken, erro: resumo.erros ? `${resumo.erros} evento(s) não sincronizado(s).` : null })
      return { estado: 'ok', resumo }
    } catch (e) {
      const mensagem = e instanceof GoogleError ? e.message : 'Falha inesperada na sincronização.'
      await calendario.registrarSync(userId, { erro: mensagem })
      return { estado: 'erro', mensagem, resumo }
    } finally {
      await calendario.liberarTrava(userId)
    }
  }

  // Envio imediato após uma alteração local. Se falhar, o evento fica "pending" e sai na próxima sincronização.
  async function enviarAgora(userId, eventoId, fuso) {
    const conexao = await calendario.obter(userId)
    if (!conexao || conexao.status !== 'connected') return 'local'
    const linha = await eventos.bruto(userId, eventoId)
    if (!linha) return 'excluido'
    try {
      const ctx = { acesso: await tokenDeAcesso(userId, conexao), calId: conexao.calendar_id, fuso }
      await enviarUm(userId, linha, ctx)
    } catch (e) {
      await eventos.marcarErro(userId, eventoId, e.message, TRANSITORIOS(e) ? 'pending' : 'error').catch(() => {})
    }
    const depois = await eventos.bruto(userId, eventoId)
    return depois?.sync_state ?? 'excluido'
  }

  return {
    sincronizar,
    enviarAgora,

    async estadoParaNovoEvento(userId) {
      const c = await calendario.obter(userId)
      return c?.status === 'connected' ? 'pending' : 'local'
    },

    async conectar(userId, { refreshToken, email, escopos }) {
      await calendario.conectar(userId, {
        email,
        refreshTokenCriptografado: criptografar(refreshToken, chave),
        escopos
      })
    },

    async desconectar(userId) {
      const c = await calendario.obter(userId)
      if (c) {
        try {
          await google.revogar(descriptografar(c.refresh_token_enc, chave))
        } catch {
          /* credencial ilegível: apenas remove */
        }
      }
      await calendario.remover(userId)
      await eventos.desvincularTodos(userId)
    },

    async status(userId) {
      const c = await calendario.obter(userId)
      if (!c) return { conectado: false }
      return {
        conectado: c.status === 'connected',
        estado: c.status,
        email: c.google_email,
        ultimaSincronizacao: c.last_sync_at,
        erro: c.last_error,
        eventosPorEstado: await eventos.contarPorEstado(userId),
        janelaInicialDias: JANELA_INICIAL_DIAS
      }
    },

    // Usado pelo agendador do Netlify (sem sessão de usuário).
    async sincronizarTodos({ limite = 25, tempoMaxMs = 20000 } = {}) {
      const inicio = Date.now()
      const resultados = []
      for (const c of await calendario.conectadosParaAgendador(limite)) {
        if (Date.now() - inicio > tempoMaxMs) break
        const r = await sincronizar(c.user_id, { fuso: c.timezone, forcar: true })
        resultados.push(r.estado)
      }
      return resultados
    }
  }
}
