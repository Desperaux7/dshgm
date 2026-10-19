import { Router } from 'express'
import { z } from 'zod'
import { assincrono } from '../lib/errors.js'
import { formatarNoFuso } from '../lib/dates.js'
import { validar, zData, zTexto, zUrlHttp, dataValida } from '../lib/validate.js'
import { zValor } from '../lib/validate.js'
import { zMeta } from './transacoes.js'
import { zEvento } from './eventos.js'
import { aplicarRegras, zItem } from './lazer.js'
import { zFavorito } from './favoritos.js'
import { zPreferencias } from './perfil.js'

// Migração dos dados do localStorage para a conta autenticada.
// - Idempotente: cada registro carrega o id antigo (client_id); repetir a importação não duplica.
// - Tolerante: um registro inválido é relatado em `rejeitados` e não derruba os demais.
// - Nunca sobrescreve dados que já existem no servidor (preferências e meta só entram se não houver).

const zId = z.union([z.string().min(1).max(100), z.number()]).transform(String)

const zTarefaLegada = z.object({
  id: zId,
  texto: zTexto(1, 300),
  tipo: z.enum(['unica', 'recorrente']).default('unica'),
  data: zData.optional().nullable(),
  dias: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  criada: zData.optional().nullable(),
  concluidas: z.record(z.string(), z.any()).optional().nullable()
})
const zTransacaoLegada = z.object({
  id: zId,
  type: z.enum(['expense', 'income', 'saving']),
  description: zTexto(1, 200),
  category: zTexto(1, 60),
  amount: zValor,
  date: zData
})
const zFavoritoLegado = zFavorito.extend({ id: zId, url: zUrlHttp, criado: z.number().optional() })
const zLazerLegado = zItem.extend({ id: zId, criado: z.number().optional(), atualizado: z.number().optional() })
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/
const zEventoLegado = z.preprocess((bruto) => {
  if (!bruto || typeof bruto !== 'object') return bruto
  // Mesmo critério do front: horário de início inválido vira evento de dia inteiro (e os horários são descartados).
  if (bruto.diaInteiro === false && !HORA.test(bruto.inicio ?? '')) return { ...bruto, diaInteiro: true, inicio: '', fim: '' }
  // Horário de término inválido é descartado, sem perder o evento.
  if (bruto.diaInteiro === false && bruto.fim && !HORA.test(bruto.fim)) return { ...bruto, fim: '' }
  return bruto
}, zEvento.and(z.object({ id: zId })))

const zCorpo = z.object({
  tarefas: z.array(z.unknown()).max(2000).default([]),
  transacoes: z.array(z.unknown()).max(5000).default([]),
  favoritos: z.array(z.unknown()).max(1000).default([]),
  lazer: z.array(z.unknown()).max(1000).default([]),
  agenda: z.array(z.unknown()).max(3000).default([]),
  meta: z.unknown().optional(),
  preferencias: z.unknown().optional()
})

function validarLote(lista, schema, mapear) {
  const itens = []
  const rejeitados = []
  lista.forEach((bruto, indice) => {
    const r = schema.safeParse(bruto)
    if (!r.success) {
      rejeitados.push({ indice, motivo: r.error.issues[0] ? `${r.error.issues[0].path.join('.') || 'registro'}: ${r.error.issues[0].message}` : 'inválido' })
    } else {
      itens.push(mapear(r.data))
    }
  })
  return { itens, rejeitados }
}

const secao = (recebidosTotal, rejeitados, r) => ({
  recebidos: recebidosTotal,
  importados: r.importados,
  jaExistiam: Math.max(0, recebidosTotal - rejeitados.length - r.importados),
  rejeitados
})

export function criarRotasImportacao({ repos, calendario, limites }) {
  const router = Router()

  router.post('/', limites.importacao, assincrono(async (req, res) => {
    const corpo = validar(zCorpo, req.body)
    const userId = req.usuario.id
    const hoje = formatarNoFuso(new Date(), req.usuario.timezone).data
    const resultado = {}

    // Tarefas
    const t = validarLote(corpo.tarefas, zTarefaLegada, (x) => ({
      client_id: x.id,
      texto: x.texto,
      tipo: x.tipo,
      data: x.tipo === 'unica' ? (x.data ?? hoje) : null,
      dias: x.tipo === 'recorrente' ? [...new Set(x.dias)] : [],
      criada: x.criada ?? hoje,
      concluidas: Object.entries(x.concluidas ?? {}).filter(([d, v]) => v === true && dataValida(d)).map(([d]) => d)
    }))
    resultado.tarefas = secao(corpo.tarefas.length, t.rejeitados, await repos.tarefas.importar(userId, t.itens))

    // Financeiro
    const f = validarLote(corpo.transacoes, zTransacaoLegada, (x) => ({ client_id: x.id, type: x.type, description: x.description, category: x.category, amount: x.amount, date: x.date }))
    resultado.transacoes = secao(corpo.transacoes.length, f.rejeitados, await repos.transacoes.importar(userId, f.itens))

    // Meta: só entra se o servidor ainda não tiver uma
    if (corpo.meta) {
      const m = zMeta.safeParse(corpo.meta)
      if (!m.success) resultado.meta = { estado: 'rejeitada', motivo: m.error.issues[0]?.message ?? 'inválida' }
      else resultado.meta = { estado: (await repos.transacoes.importarMeta(userId, m.data)) ? 'importada' : 'mantida_do_servidor' }
    }

    // Favoritos
    const fav = validarLote(corpo.favoritos, zFavoritoLegado, (x) => ({ client_id: x.id, nome: x.nome, url: x.url, categoria: x.categoria, fixado: x.fixado, criado: x.criado ?? null }))
    resultado.favoritos = secao(corpo.favoritos.length, fav.rejeitados, await repos.favoritos.importar(userId, fav.itens))

    // Lazer (as capas são enviadas depois, uma a uma, usando `mapaLazer`)
    const l = validarLote(corpo.lazer, zLazerLegado, (x) => {
      const i = aplicarRegras(x, null)
      return { client_id: x.id, tipo: i.tipo, titulo: i.titulo, plataforma: i.plataforma, status: i.status, progresso: i.progresso, criado: x.criado ?? null, atualizado: x.atualizado ?? null }
    })
    const rl = await repos.lazer.importar(userId, l.itens)
    resultado.lazer = secao(corpo.lazer.length, l.rejeitados, rl)
    resultado.mapaLazer = rl.mapa

    // Agenda
    const estado = await calendario.estadoParaNovoEvento(userId)
    const a = validarLote(corpo.agenda, zEventoLegado, (x) => ({
      client_id: x.id, titulo: x.titulo, data: x.data, dia_inteiro: x.diaInteiro, inicio: x.inicio, fim: x.fim,
      categoria: x.categoria, notas: x.notas, rec_tipo: x.rec.tipo, rec_dias: x.rec.dias, rec_ate: x.rec.ate || null, excecoes: x.excecoes
    }))
    resultado.agenda = secao(corpo.agenda.length, a.rejeitados, await repos.eventos.importar(userId, a.itens, estado))

    // Preferências e foto: só se o servidor ainda não tiver preferências
    if (corpo.preferencias) {
      const p = zPreferencias.safeParse(corpo.preferencias)
      if (!p.success) {
        // foto grande demais não deve impedir o restante das preferências
        const { foto: _f, ...semFoto } = corpo.preferencias ?? {}
        const p2 = zPreferencias.safeParse(semFoto)
        resultado.preferencias = p2.success ? await salvarPreferencias(repos, userId, p2.data, 'foto_ignorada') : { estado: 'rejeitadas' }
      } else {
        resultado.preferencias = await salvarPreferencias(repos, userId, p.data, 'importadas')
      }
    }

    // Registro de auditoria só com contagens (sem conteúdo pessoal)
    await repos.usuarios.registrarImportacao(userId, {
      tarefas: resultado.tarefas.importados, transacoes: resultado.transacoes.importados,
      favoritos: resultado.favoritos.importados, lazer: resultado.lazer.importados, agenda: resultado.agenda.importados
    })
    res.json({ resultado })
  }))

  return router
}

async function salvarPreferencias(repos, userId, dados, estadoOk) {
  if (await repos.preferencias.obter(userId)) return { estado: 'mantidas_do_servidor' }
  const { foto, ...resto } = dados
  await repos.preferencias.salvar(userId, resto, foto === undefined ? undefined : foto)
  return { estado: estadoOk }
}
