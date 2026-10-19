import { Router } from 'express'
import { z } from 'zod'
import { assincrono, naoEncontrado } from '../lib/errors.js'
import { formatarNoFuso } from '../lib/dates.js'
import { uuidDaRota, validar, zData, zTexto, zValor } from '../lib/validate.js'

const zTipo = z.enum(['expense', 'income', 'saving'])
const zCriar = z.object({ type: zTipo, description: zTexto(1, 200), category: zTexto(1, 60), amount: zValor, date: zData })
const zAtualizar = zCriar.partial()
const zMes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês inválido (use AAAA-MM).')
const zConsulta = z.object({
  de: zData.optional(),
  ate: zData.optional(),
  limite: z.coerce.number().int().min(1).max(5000).default(2000),
  offset: z.coerce.number().int().min(0).default(0)
})
export const zMeta = z.object({
  nome: z.string().trim().max(80).default(''),
  valor: zValor,
  prazo: zMes
})

export function criarRotasTransacoes({ repos }) {
  const router = Router()
  const { transacoes } = repos

  router.get('/', assincrono(async (req, res) => {
    const filtros = validar(zConsulta, req.query)
    res.json({ transacoes: await transacoes.listar(req.usuario.id, filtros) })
  }))

  // Saldo e totais calculados no banco, com aritmética exata (numeric).
  router.get('/resumo', assincrono(async (req, res) => {
    const mes = req.query.mes
      ? validar(z.object({ mes: zMes }), req.query).mes
      : formatarNoFuso(new Date(), req.usuario.timezone).data.slice(0, 7)
    res.json({ resumo: await transacoes.resumo(req.usuario.id, mes) })
  }))

  router.post('/', assincrono(async (req, res) => {
    const t = await transacoes.criar(req.usuario.id, validar(zCriar, req.body))
    res.status(201).json({ transacao: t })
  }))

  router.patch('/:id', assincrono(async (req, res) => {
    const t = await transacoes.atualizar(req.usuario.id, uuidDaRota(req.params.id), validar(zAtualizar, req.body))
    if (!t) throw naoEncontrado('Movimentação não encontrada.')
    res.json({ transacao: t })
  }))

  router.delete('/:id', assincrono(async (req, res) => {
    if (!(await transacoes.excluir(req.usuario.id, uuidDaRota(req.params.id)))) throw naoEncontrado('Movimentação não encontrada.')
    res.status(204).end()
  }))

  return router
}

export function criarRotasMeta({ repos }) {
  const router = Router()
  const { transacoes } = repos

  router.get('/', assincrono(async (req, res) => {
    res.json({ meta: await transacoes.obterMeta(req.usuario.id) })
  }))
  router.put('/', assincrono(async (req, res) => {
    res.json({ meta: await transacoes.salvarMeta(req.usuario.id, validar(zMeta, req.body)) })
  }))
  router.delete('/', assincrono(async (req, res) => {
    await transacoes.removerMeta(req.usuario.id)
    res.status(204).end()
  }))
  return router
}
