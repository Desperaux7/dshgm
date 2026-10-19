import { Router } from 'express'
import { z } from 'zod'
import { assincrono, conflito, naoEncontrado } from '../lib/errors.js'
import { uuidDaRota, validar, zData, zDiasSemana, zHora, zTexto } from '../lib/validate.js'
import { CATEGORIAS } from '../services/eventMapping.js'

const zRec = z.object({
  tipo: z.enum(['nenhuma', 'diaria', 'semanal', 'mensal', 'anual']).default('nenhuma'),
  dias: zDiasSemana.default([]),
  ate: z.union([zData, z.literal('')]).default('')
})

export const zEvento = z
  .object({
    titulo: zTexto(1, 200),
    data: zData,
    diaInteiro: z.boolean().default(true),
    inicio: z.union([zHora, z.literal('')]).default(''),
    fim: z.union([zHora, z.literal('')]).default(''),
    categoria: z.enum(CATEGORIAS).default('pessoal'),
    notas: z.string().max(4000).default(''),
    rec: zRec.default({}),
    excecoes: z.array(zData).max(500).default([])
  })
  .superRefine((e, ctx) => {
    if (!e.diaInteiro && !e.inicio) ctx.addIssue({ code: 'custom', path: ['inicio'], message: 'Informe o horário de início.' })
    if (e.rec.ate && e.rec.ate < e.data) ctx.addIssue({ code: 'custom', path: ['rec', 'ate'], message: 'O fim da repetição não pode ser anterior ao evento.' })
  })
  .transform((e) => ({
    ...e,
    inicio: e.diaInteiro ? '' : e.inicio,
    fim: e.diaInteiro ? '' : e.fim,
    rec: { ...e.rec, dias: e.rec.tipo === 'semanal' ? e.rec.dias : [], ate: e.rec.tipo === 'nenhuma' ? '' : e.rec.ate },
    excecoes: e.rec.tipo === 'nenhuma' ? [] : [...new Set(e.excecoes)].sort()
  }))

// Campos que o cliente pode alterar (qualquer subconjunto).
const zParcial = z
  .object({
    titulo: z.any(), data: z.any(), diaInteiro: z.any(), inicio: z.any(), fim: z.any(),
    categoria: z.any(), notas: z.any(), rec: z.object({ tipo: z.any(), dias: z.any(), ate: z.any() }).partial(), excecoes: z.any()
  })
  .partial()

const SOMENTE_LEITURA =
  'Este evento tem uma recorrência do Google Calendar que o dashboard não consegue representar. Edite-o no Google Calendar.'

// Eventos são independentes das tarefas. A propagação ao Google nunca bloqueia a gravação local:
// se falhar, o evento fica "pending" e é reenviado na próxima sincronização.
export function criarRotasEventos({ repos, calendario }) {
  const router = Router()
  const { eventos } = repos

  router.get('/', assincrono(async (req, res) => {
    res.json({ eventos: await eventos.listar(req.usuario.id) })
  }))

  router.post('/', assincrono(async (req, res) => {
    const dados = validar(zEvento, req.body)
    const estado = await calendario.estadoParaNovoEvento(req.usuario.id)
    const criado = await eventos.criar(req.usuario.id, dados, estado)
    await calendario.enviarAgora(req.usuario.id, criado.id, req.usuario.timezone)
    res.status(201).json({ evento: await eventos.obter(req.usuario.id, criado.id) })
  }))

  router.patch('/:id', assincrono(async (req, res) => {
    const id = uuidDaRota(req.params.id)
    const bruto = await eventos.bruto(req.usuario.id, id)
    if (!bruto || bruto.excluido) throw naoEncontrado('Evento não encontrado.')
    if (bruto.unsupported_recurrence) throw conflito(SOMENTE_LEITURA)

    const mudancas = validar(zParcial, req.body)
    const atual = await eventos.obter(req.usuario.id, id)
    const { sincronizacao: _s, id: _i, ...base } = atual
    const dados = validar(zEvento, { ...base, ...mudancas, rec: { ...base.rec, ...(mudancas.rec ?? {}) } })

    const estado = await calendario.estadoParaNovoEvento(req.usuario.id)
    await eventos.atualizar(req.usuario.id, id, dados, estado)
    await calendario.enviarAgora(req.usuario.id, id, req.usuario.timezone)
    res.json({ evento: await eventos.obter(req.usuario.id, id) })
  }))

  router.delete('/:id', assincrono(async (req, res) => {
    const id = uuidDaRota(req.params.id)
    const bruto = await eventos.bruto(req.usuario.id, id)
    if (!bruto || bruto.excluido) throw naoEncontrado('Evento não encontrado.')

    const estado = await calendario.estadoParaNovoEvento(req.usuario.id)
    if (bruto.google_etag && estado === 'pending') {
      // Existe no Google: marca para exclusão e propaga (se falhar, a próxima sincronização conclui).
      await eventos.marcarParaExclusao(req.usuario.id, id)
      await calendario.enviarAgora(req.usuario.id, id, req.usuario.timezone)
    } else {
      await eventos.excluirDefinitivo(req.usuario.id, id)
    }
    res.status(204).end()
  }))

  return router
}
