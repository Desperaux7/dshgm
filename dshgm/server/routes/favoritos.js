import { Router } from 'express'
import { z } from 'zod'
import { assincrono, naoEncontrado } from '../lib/errors.js'
import { uuidDaRota, validar, zTexto, zUrlHttp } from '../lib/validate.js'

export const zFavorito = z.object({
  nome: zTexto(1, 80),
  url: zUrlHttp,
  categoria: zTexto(1, 40).default('Dia a dia'),
  fixado: z.boolean().default(true)
})
const zAtualizar = zFavorito.partial()

export function criarRotasFavoritos({ repos }) {
  const router = Router()
  const { favoritos } = repos

  router.get('/', assincrono(async (req, res) => {
    res.json({ favoritos: await favoritos.listar(req.usuario.id) })
  }))
  router.post('/', assincrono(async (req, res) => {
    res.status(201).json({ favorito: await favoritos.criar(req.usuario.id, validar(zFavorito, req.body)) })
  }))
  router.patch('/:id', assincrono(async (req, res) => {
    const f = await favoritos.atualizar(req.usuario.id, uuidDaRota(req.params.id), validar(zAtualizar, req.body))
    if (!f) throw naoEncontrado('Favorito não encontrado.')
    res.json({ favorito: f })
  }))
  router.delete('/:id', assincrono(async (req, res) => {
    if (!(await favoritos.excluir(req.usuario.id, uuidDaRota(req.params.id)))) throw naoEncontrado('Favorito não encontrado.')
    res.status(204).end()
  }))
  return router
}
