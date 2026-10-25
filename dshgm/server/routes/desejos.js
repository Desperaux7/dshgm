import { Router } from 'express'
import { z } from 'zod'
import { assincrono, naoEncontrado, requisicaoInvalida } from '../lib/errors.js'
import { uuidDaRota, validar, zTexto } from '../lib/validate.js'

const LIMITE_ITENS = 500

// Só http e https, sem usuário/senha no endereço (evita javascript:, data:, file: e links com credenciais).
export function urlHttpSegura(texto) {
  try {
    const u = new URL(texto)
    return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password && u.hostname.length > 0
  } catch {
    return false
  }
}

// Opcional: vazio ou ausente vira null.
const urlOpcional = (rotulo) =>
  z.preprocess(
    (v) => (v == null || (typeof v === 'string' && v.trim() === '') ? null : v),
    z.union([
      z.null(),
      z.string().trim().max(2000, `${rotulo}: máximo de 2000 caracteres.`).refine(urlHttpSegura, `${rotulo}: use um endereço http ou https válido.`)
    ])
  )

const zPreco = z
  .number({ invalid_type_error: 'Preço inválido.', required_error: 'Informe o preço.' })
  .finite('Preço inválido.')
  .min(0, 'O preço não pode ser negativo.')
  .max(999999999.99, 'Preço alto demais.')
  .transform((v) => Math.round(v * 100) / 100)

export const zDesejo = z.object({
  nome: zTexto(1, 120),
  descricao: zTexto(0, 500).default(''),
  linkUrl: urlOpcional('Link do produto'),
  imagemUrl: urlOpcional('Imagem'),
  preco: zPreco,
  prioridade: z.enum(['alta', 'media', 'baixa']).default('media'),
  status: z.enum(['desejado', 'comprado']).default('desejado')
})
const zAtualizar = zDesejo.partial()

export function criarRotasDesejos({ repos }) {
  const router = Router()
  const { desejos } = repos

  // Toda resposta que muda a lista traz os totais recalculados a partir do que está gravado.
  const comTotais = async (userId, extra = {}) => ({ ...extra, totais: await desejos.totais(userId) })

  router.get('/', assincrono(async (req, res) => {
    const userId = req.usuario.id
    const [itens, totais] = await Promise.all([desejos.listar(userId), desejos.totais(userId)])
    res.json({ itens, totais })
  }))

  router.post('/', assincrono(async (req, res) => {
    const userId = req.usuario.id
    const dados = validar(zDesejo, req.body)
    if ((await desejos.contar(userId)) >= LIMITE_ITENS) throw requisicaoInvalida(`Limite de ${LIMITE_ITENS} produtos atingido.`)
    const item = await desejos.criar(userId, dados)
    res.status(201).json(await comTotais(userId, { item }))
  }))

  router.patch('/:id', assincrono(async (req, res) => {
    const userId = req.usuario.id
    const item = await desejos.atualizar(userId, uuidDaRota(req.params.id), validar(zAtualizar, req.body))
    if (!item) throw naoEncontrado('Produto não encontrado.')
    res.json(await comTotais(userId, { item }))
  }))

  router.delete('/:id', assincrono(async (req, res) => {
    const userId = req.usuario.id
    if (!(await desejos.excluir(userId, uuidDaRota(req.params.id)))) throw naoEncontrado('Produto não encontrado.')
    res.json(await comTotais(userId))
  }))

  return router
}
