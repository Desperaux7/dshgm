import express, { Router } from 'express'
import { z } from 'zod'
import { assincrono, naoEncontrado, requisicaoInvalida } from '../lib/errors.js'
import { uuidDaRota, validar, zTexto } from '../lib/validate.js'

export const zItem = z.object({
  tipo: z.enum(['jogo', 'filme', 'serie']),
  titulo: zTexto(1, 120),
  plataforma: z.string().trim().max(60).default(''),
  status: z.enum(['pendente', 'andamento', 'concluido']).default('pendente'),
  progresso: z.number().int().min(0).max(100).default(0)
})
const zAtualizar = zItem.partial()

// Mesmas regras do front: mantém status e progresso coerentes entre si.
export function aplicarRegras(item, alterado) {
  const p = { ...item }
  if (p.tipo !== 'jogo') p.progresso = 0
  if (alterado === 'status') {
    if (p.status === 'concluido' && p.tipo === 'jogo') p.progresso = 100
    if (p.status === 'pendente') p.progresso = 0
  } else if (alterado === 'progresso' && p.tipo === 'jogo') {
    if (p.progresso >= 100) p.status = 'concluido'
    else if (p.progresso > 0 && p.status !== 'andamento') p.status = 'andamento'
  }
  return p
}

// Confere a assinatura do arquivo: o Content-Type enviado pelo cliente não basta.
function tipoDaImagem(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  return null
}

const zDimensao = z.coerce.number().int().min(1).max(8000)

export function criarRotasLazer({ repos }) {
  const router = Router()
  const { lazer } = repos

  router.get('/', assincrono(async (req, res) => {
    res.json({ itens: await lazer.listar(req.usuario.id) })
  }))

  router.post('/', assincrono(async (req, res) => {
    const dados = aplicarRegras(validar(zItem, req.body), 'status')
    res.status(201).json({ item: await lazer.criar(req.usuario.id, dados) })
  }))

  router.patch('/:id', assincrono(async (req, res) => {
    const id = uuidDaRota(req.params.id)
    const mudancas = validar(zAtualizar, req.body)
    const atual = await lazer.obter(req.usuario.id, id)
    if (!atual) throw naoEncontrado('Item não encontrado.')
    const alterado = 'status' in mudancas ? 'status' : 'progresso' in mudancas ? 'progresso' : null
    const { tipo, titulo, plataforma, status, progresso } = aplicarRegras({ ...atual, ...mudancas }, alterado)
    res.json({ item: await lazer.atualizar(req.usuario.id, id, { tipo, titulo, plataforma, status, progresso }) })
  }))

  router.delete('/:id', assincrono(async (req, res) => {
    if (!(await lazer.excluir(req.usuario.id, uuidDaRota(req.params.id)))) throw naoEncontrado('Item não encontrado.')
    res.status(204).end()
  }))

  /* ---------- Capas ---------- */

  router.put(
    '/:id/capa',
    express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '600kb' }),
    assincrono(async (req, res) => {
      const id = uuidDaRota(req.params.id)
      if (!Buffer.isBuffer(req.body) || !req.body.length) throw requisicaoInvalida('Envie a imagem (JPEG, PNG ou WebP) no corpo.')
      const mime = tipoDaImagem(req.body)
      if (!mime || mime !== req.get('content-type')?.split(';')[0]) throw requisicaoInvalida('Arquivo de imagem inválido.')
      const { largura, altura } = validar(
        z.object({ largura: zDimensao, altura: zDimensao }),
        { largura: req.get('x-largura'), altura: req.get('x-altura') }
      )
      const item = await lazer.salvarCapa(req.usuario.id, id, { mime, base64: req.body.toString('base64'), largura, altura })
      if (!item) throw naoEncontrado('Item não encontrado.')
      res.json({ item })
    })
  )

  router.get('/:id/capa', assincrono(async (req, res) => {
    const capa = await lazer.lerCapa(req.usuario.id, uuidDaRota(req.params.id))
    if (!capa) throw naoEncontrado('Capa não encontrada.')
    res.set({ 'Content-Type': capa.mime, 'Cache-Control': 'private, no-cache' })
    res.send(capa.buffer)
  }))

  router.delete('/:id/capa', assincrono(async (req, res) => {
    const item = await lazer.removerCapa(req.usuario.id, uuidDaRota(req.params.id))
    if (!item) throw naoEncontrado('Item não encontrado.')
    res.json({ item })
  }))

  return router
}
