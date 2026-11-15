import { Router } from 'express'
import { z } from 'zod'
import { assincrono, conflito, naoEncontrado, requisicaoInvalida } from '../lib/errors.js'
import { uuidDaRota, validar, zTexto, zUrlHttp } from '../lib/validate.js'
import { CATEGORIAS_FIXAS } from '../repositories/favorites.js'

const zBarra = z.enum(['central', 'superior'])

export const zFavorito = z.object({
  nome: zTexto(1, 80),
  url: zUrlHttp,
  categoria: zTexto(1, 40).default('Dia a dia'),
  fixado: z.boolean().default(true),
  // Pasta (opcional): o link dentro de uma pasta sempre aparece na barra da pasta.
  pastaId: z.string().uuid().nullable().default(null),
  barra: zBarra.default('central')
})
const zAtualizar = zFavorito.partial()

const zPasta = z.object({ nome: zTexto(1, 40), barra: zBarra.default('central') })
const zAtualizarPasta = zPasta.partial()
const zRenomearCategoria = z.object({ de: zTexto(1, 40), para: zTexto(1, 40) })

const LIMITE_PASTAS = 40
const ehFixa = (nome) => CATEGORIAS_FIXAS.some((c) => c.toLowerCase() === nome.toLowerCase())

export function criarRotasFavoritos({ repos }) {
  const router = Router()
  const { favoritos } = repos

  // Resolve a pasta escolhida: precisa ser do usuário, e o link herda a barra dela.
  async function resolverPasta(userId, pastaId) {
    const pasta = await favoritos.obterPasta(userId, pastaId)
    if (!pasta) throw requisicaoInvalida('Pasta não encontrada.')
    return pasta
  }

  router.get('/', assincrono(async (req, res) => {
    const [lista, pastas] = await Promise.all([favoritos.listar(req.usuario.id), favoritos.listarPastas(req.usuario.id)])
    res.json({ favoritos: lista, pastas })
  }))

  /* ---------- Categorias (rotas fixas vêm antes de /:id) ---------- */

  router.patch('/categorias', assincrono(async (req, res) => {
    const { de, para } = validar(zRenomearCategoria, req.body)
    if (ehFixa(de)) throw requisicaoInvalida('As categorias padrão não podem ser renomeadas.')
    if (de === para) return res.json({ atualizados: 0 })
    // Mesclar com outra categoria já existente é permitido (os links passam a ela).
    res.json({ atualizados: await favoritos.renomearCategoria(req.usuario.id, de, para) })
  }))

  router.delete('/categorias', assincrono(async (req, res) => {
    const { nome } = validar(z.object({ nome: zTexto(1, 40) }), req.query)
    if (ehFixa(nome)) throw requisicaoInvalida('As categorias padrão não podem ser excluídas.')
    res.json({ movidos: await favoritos.excluirCategoria(req.usuario.id, nome) })
  }))

  /* ---------- Pastas ---------- */

  router.post('/pastas', assincrono(async (req, res) => {
    const c = validar(zPasta, req.body)
    if ((await favoritos.contarPastas(req.usuario.id)) >= LIMITE_PASTAS) throw requisicaoInvalida(`Limite de ${LIMITE_PASTAS} pastas atingido.`)
    if (await favoritos.nomeDePastaEmUso(req.usuario.id, c.nome)) throw conflito('Já existe uma pasta com esse nome.')
    res.status(201).json({ pasta: await favoritos.criarPasta(req.usuario.id, c) })
  }))

  router.patch('/pastas/:id', assincrono(async (req, res) => {
    const id = uuidDaRota(req.params.id)
    const c = validar(zAtualizarPasta, req.body)
    if (c.nome && (await favoritos.nomeDePastaEmUso(req.usuario.id, c.nome, id))) throw conflito('Já existe uma pasta com esse nome.')
    const pasta = await favoritos.atualizarPasta(req.usuario.id, id, c)
    if (!pasta) throw naoEncontrado('Pasta não encontrada.')
    res.json({ pasta })
  }))

  router.delete('/pastas/:id', assincrono(async (req, res) => {
    if (!(await favoritos.excluirPasta(req.usuario.id, uuidDaRota(req.params.id)))) throw naoEncontrado('Pasta não encontrada.')
    res.status(204).end()
  }))

  /* ---------- Links ---------- */

  router.post('/', assincrono(async (req, res) => {
    const dados = validar(zFavorito, req.body)
    if (dados.pastaId) dados.barra = (await resolverPasta(req.usuario.id, dados.pastaId)).barra
    res.status(201).json({ favorito: await favoritos.criar(req.usuario.id, dados) })
  }))

  router.patch('/:id', assincrono(async (req, res) => {
    const id = uuidDaRota(req.params.id)
    const mudancas = validar(zAtualizar, req.body)
    if (mudancas.pastaId) mudancas.barra = (await resolverPasta(req.usuario.id, mudancas.pastaId)).barra
    else if ('barra' in mudancas && !('pastaId' in mudancas)) {
      // Link que já está numa pasta segue a barra da pasta: a barra só muda mudando a pasta.
      const atual = await favoritos.obter(req.usuario.id, id)
      if (atual?.pastaId) delete mudancas.barra
    }
    const f = await favoritos.atualizar(req.usuario.id, id, mudancas)
    if (!f) throw naoEncontrado('Favorito não encontrado.')
    res.json({ favorito: f })
  }))

  router.delete('/:id', assincrono(async (req, res) => {
    if (!(await favoritos.excluir(req.usuario.id, uuidDaRota(req.params.id)))) throw naoEncontrado('Favorito não encontrado.')
    res.status(204).end()
  }))
  return router
}
