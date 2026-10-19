import { Router } from 'express'
import { z } from 'zod'
import { assincrono, naoEncontrado, requisicaoInvalida } from '../lib/errors.js'
import { formatarNoFuso } from '../lib/dates.js'
import { uuidDaRota, validar, zData, zDiasSemana, zTexto, dataValida } from '../lib/validate.js'

const zCriar = z.object({
  texto: zTexto(1, 300),
  tipo: z.enum(['unica', 'recorrente']).default('unica'),
  data: zData.optional(),
  dias: zDiasSemana.optional(),
  criada: zData.optional()
})
const zAtualizar = z
  .object({ texto: zTexto(1, 300), tipo: z.enum(['unica', 'recorrente']), data: zData, dias: zDiasSemana, criada: zData })
  .partial()
const zConclusao = z.object({ concluida: z.boolean() })

const hojeDe = (usuario) => formatarNoFuso(new Date(), usuario.timezone).data

// Tarefas são independentes de eventos: nada aqui cria, altera ou lê eventos do calendário.
export function criarRotasTarefas({ repos }) {
  const router = Router()
  const { tarefas } = repos

  router.get('/', assincrono(async (req, res) => {
    res.json({ tarefas: await tarefas.listar(req.usuario.id) })
  }))

  router.post('/', assincrono(async (req, res) => {
    const c = validar(zCriar, req.body)
    const hoje = hojeDe(req.usuario)
    if (c.tipo === 'recorrente' && !c.dias?.length) throw requisicaoInvalida('Escolha ao menos um dia da semana.')
    const tarefa = await tarefas.criar(req.usuario.id, {
      texto: c.texto,
      tipo: c.tipo,
      data: c.tipo === 'unica' ? (c.data ?? hoje) : null,
      dias: c.tipo === 'recorrente' ? c.dias : [],
      criada: c.criada ?? hoje
    })
    res.status(201).json({ tarefa })
  }))

  router.patch('/:id', assincrono(async (req, res) => {
    const id = uuidDaRota(req.params.id)
    const mudancas = validar(zAtualizar, req.body)
    const atual = await tarefas.obter(req.usuario.id, id)
    if (!atual) throw naoEncontrado('Tarefa não encontrada.')

    const tipo = mudancas.tipo ?? atual.tipo
    const dias = mudancas.dias ?? atual.dias
    if (tipo === 'recorrente' && !dias.length) throw requisicaoInvalida('Escolha ao menos um dia da semana.')

    const campos = { tipo }
    if ('texto' in mudancas) campos.texto = mudancas.texto
    if ('criada' in mudancas) campos.criada = mudancas.criada
    campos.dias = tipo === 'recorrente' ? dias : []
    campos.data = tipo === 'unica' ? (mudancas.data ?? atual.data ?? hojeDe(req.usuario)) : null
    res.json({ tarefa: await tarefas.atualizar(req.usuario.id, id, campos) })
  }))

  router.delete('/:id', assincrono(async (req, res) => {
    if (!(await tarefas.excluir(req.usuario.id, uuidDaRota(req.params.id)))) throw naoEncontrado('Tarefa não encontrada.')
    res.status(204).end()
  }))

  // Conclusão controlada dia a dia (essencial para tarefas recorrentes).
  router.put('/:id/concluidas/:dia', assincrono(async (req, res) => {
    const id = uuidDaRota(req.params.id)
    if (!dataValida(req.params.dia)) throw requisicaoInvalida('Data inválida.')
    const { concluida } = validar(zConclusao, req.body)
    if (!(await tarefas.definirConclusao(req.usuario.id, id, req.params.dia, concluida))) throw naoEncontrado('Tarefa não encontrada.')
    res.json({ tarefa: await tarefas.obter(req.usuario.id, id) })
  }))

  return router
}
