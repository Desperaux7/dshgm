import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import { assincrono, conflito, naoEncontrado, requisicaoInvalida } from '../lib/errors.js'
import { formatarNoFuso } from '../lib/dates.js'
import { uuidDaRota, validar, zData, zTexto } from '../lib/validate.js'

const LIMITE_TIMES = 50
const LIMITE_COLABORADORES = 500
const LIMITE_LISTA = 30
const LIMITE_EVENTOS = 100

// Texto opcional: pode vir vazio (guardado como "").
const zOpcional = (max) =>
  z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().max(max, `Máximo de ${max} caracteres.`))
    .refine((s) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s), 'Caracteres inválidos.')

const zId = z.string().uuid().nullish()

// Ponto de melhoria exige EVIDÊNCIA (ex.: número de um protocolo). Pode ser marcado como desenvolvido.
const zPontoMelhoria = z.object({
  id: zId,
  texto: zTexto(1, 200),
  evidencia: z
    .string({ required_error: 'Informe a evidência (ex.: protocolo).' })
    .transform((s) => s.trim())
    .pipe(z.string().min(1, 'Informe a evidência (ex.: protocolo).').max(500, 'Máximo de 500 caracteres.')),
  desenvolvido: z.boolean().default(false),
  desenvolvidoEm: zData.nullish()
})
const zEvento = z.object({
  id: zId,
  tipo: z.enum(['feedback', 'reuniao', 'outro']).default('outro'),
  texto: zTexto(1, 1000),
  data: zData
})

const zColaborador = z.object({
  nome: zTexto(1, 100),
  cargo: zOpcional(100).default(''),
  subtimeId: z.string().uuid().nullable().default(null),
  pontosFortes: z.array(zTexto(1, 150)).max(LIMITE_LISTA).default([]),
  pontosMelhoria: z.array(zPontoMelhoria).max(LIMITE_LISTA).default([]),
  eventos: z.array(zEvento).max(LIMITE_EVENTOS).default([]),
  perfil: zOpcional(4000).default('')
})
const zAtualizarColaborador = zColaborador.partial()
const zTime = z.object({ nome: zTexto(1, 80), setor: zOpcional(80).default('') })
const zAtualizarTime = zTime.partial()
const zSubtime = z.object({ nome: zTexto(1, 80) })

// Cada item recebe um id (se veio sem) e, ao marcar "desenvolvido", a data em que isso aconteceu.
function prepararPontos(pontos, hoje) {
  return pontos.map((p) => ({
    id: p.id ?? randomUUID(),
    texto: p.texto,
    evidencia: p.evidencia,
    desenvolvido: p.desenvolvido,
    desenvolvidoEm: p.desenvolvido ? (p.desenvolvidoEm ?? hoje) : null
  }))
}
const prepararEventos = (eventos) => eventos.map((e) => ({ id: e.id ?? randomUUID(), tipo: e.tipo, texto: e.texto, data: e.data }))

export function criarRotasTimes({ repos }) {
  const router = Router()
  const { times } = repos
  const hojeDe = (usuario) => formatarNoFuso(new Date(), usuario.timezone).data

  // Subtime precisa existir e ser do mesmo time do colaborador.
  async function validarSubtime(userId, timeId, subtimeId) {
    if (!subtimeId) return
    const sub = await times.obterSubtime(userId, subtimeId)
    if (!sub || sub.timeId !== timeId) throw requisicaoInvalida('Subtime inválido para este time.')
  }

  router.get('/', assincrono(async (req, res) => {
    res.json({ times: await times.listar(req.usuario.id) })
  }))

  /* ---------- Times ---------- */

  router.post('/', assincrono(async (req, res) => {
    const c = validar(zTime, req.body)
    if ((await times.contarTimes(req.usuario.id)) >= LIMITE_TIMES) throw requisicaoInvalida(`Limite de ${LIMITE_TIMES} times atingido.`)
    res.status(201).json({ time: await times.criarTime(req.usuario.id, c) })
  }))

  // Rotas com segmento fixo (subtimes/colaboradores) vêm antes das que usam apenas :id.
  router.patch('/subtimes/:id', assincrono(async (req, res) => {
    const id = uuidDaRota(req.params.id)
    const { nome } = validar(zSubtime, req.body)
    const atual = await times.obterSubtime(req.usuario.id, id)
    if (!atual) throw naoEncontrado('Subtime não encontrado.')
    if (await times.nomeDeSubtimeEmUso(req.usuario.id, atual.timeId, nome, id)) throw conflito('Já existe um subtime com esse nome neste time.')
    res.json({ subtime: await times.atualizarSubtime(req.usuario.id, id, nome) })
  }))

  router.delete('/subtimes/:id', assincrono(async (req, res) => {
    if (!(await times.excluirSubtime(req.usuario.id, uuidDaRota(req.params.id)))) throw naoEncontrado('Subtime não encontrado.')
    res.status(204).end()
  }))

  router.patch('/colaboradores/:id', assincrono(async (req, res) => {
    const id = uuidDaRota(req.params.id)
    const mudancas = validar(zAtualizarColaborador, req.body)
    const atual = await times.obterColaborador(req.usuario.id, id)
    if (!atual) throw naoEncontrado('Colaborador não encontrado.')
    await validarSubtime(req.usuario.id, atual.timeId, mudancas.subtimeId)
    if (mudancas.pontosMelhoria) mudancas.pontosMelhoria = prepararPontos(mudancas.pontosMelhoria, hojeDe(req.usuario))
    if (mudancas.eventos) mudancas.eventos = prepararEventos(mudancas.eventos)
    res.json({ colaborador: await times.atualizarColaborador(req.usuario.id, id, mudancas) })
  }))

  router.delete('/colaboradores/:id', assincrono(async (req, res) => {
    if (!(await times.excluirColaborador(req.usuario.id, uuidDaRota(req.params.id)))) throw naoEncontrado('Colaborador não encontrado.')
    res.status(204).end()
  }))

  router.patch('/:id', assincrono(async (req, res) => {
    const time = await times.atualizarTime(req.usuario.id, uuidDaRota(req.params.id), validar(zAtualizarTime, req.body))
    if (!time) throw naoEncontrado('Time não encontrado.')
    res.json({ time })
  }))

  router.delete('/:id', assincrono(async (req, res) => {
    if (!(await times.excluirTime(req.usuario.id, uuidDaRota(req.params.id)))) throw naoEncontrado('Time não encontrado.')
    res.status(204).end()
  }))

  /* ---------- Subtimes e colaboradores de um time ---------- */

  router.post('/:id/subtimes', assincrono(async (req, res) => {
    const timeId = uuidDaRota(req.params.id)
    const { nome } = validar(zSubtime, req.body)
    if (!(await times.obterTime(req.usuario.id, timeId))) throw naoEncontrado('Time não encontrado.')
    if (await times.nomeDeSubtimeEmUso(req.usuario.id, timeId, nome)) throw conflito('Já existe um subtime com esse nome neste time.')
    res.status(201).json({ subtime: await times.criarSubtime(req.usuario.id, timeId, nome) })
  }))

  router.post('/:id/colaboradores', assincrono(async (req, res) => {
    const timeId = uuidDaRota(req.params.id)
    const c = validar(zColaborador, req.body)
    if (!(await times.obterTime(req.usuario.id, timeId))) throw naoEncontrado('Time não encontrado.')
    if ((await times.contarColaboradores(req.usuario.id)) >= LIMITE_COLABORADORES) throw requisicaoInvalida(`Limite de ${LIMITE_COLABORADORES} colaboradores atingido.`)
    await validarSubtime(req.usuario.id, timeId, c.subtimeId)
    const colaborador = await times.criarColaborador(req.usuario.id, timeId, {
      ...c,
      pontosMelhoria: prepararPontos(c.pontosMelhoria, hojeDe(req.usuario)),
      eventos: prepararEventos(c.eventos)
    })
    res.status(201).json({ colaborador })
  }))

  return router
}
