import { Router } from 'express'
import { z } from 'zod'
import { assincrono } from '../lib/errors.js'
import { fusoValido } from '../lib/dates.js'
import { validar } from '../lib/validate.js'

const zPreferencias = z
  .object({
    nome: z.string().trim().max(40),
    destaque: z.enum(['ciano', 'oceano', 'menta', 'ambar']),
    fundo: z.enum(['animado', 'estatico', 'desligado']),
    densidade: z.enum(['confortavel', 'compacta']),
    hora24: z.boolean(),
    inicioSemana: z.union([z.literal(0), z.literal(1)]),
    clima: z
      .object({
        ativo: z.boolean(),
        unidade: z.enum(['C', 'F']),
        cidade: z
          .object({ nome: z.string().trim().min(1).max(100), lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) })
          .nullable()
      })
      .partial(),
    cartoes: z
      .record(z.string().regex(/^[a-z0-9-]{1,40}$/), z.boolean())
      .refine((o) => Object.keys(o).length <= 30, 'Cartões demais.'),
    // Foto de perfil já reduzida pelo navegador (data URL).
    foto: z.string().startsWith('data:image/').max(600000).nullable()
  })
  .partial()

export { zPreferencias }

export function combinar(atual, novo) {
  const { foto: _foto, ...resto } = novo
  return {
    ...atual,
    ...resto,
    clima: { ...(atual.clima ?? {}), ...(resto.clima ?? {}) },
    cartoes: { ...(atual.cartoes ?? {}), ...(resto.cartoes ?? {}) }
  }
}

const resposta = (linha) => ({ preferencias: { ...(linha?.data ?? {}), foto: linha?.photo ?? null } })

export function criarRotasPerfil({ repos }) {
  const router = Router()

  router.get(
    '/preferencias',
    assincrono(async (req, res) => {
      res.json(resposta(await repos.preferencias.obter(req.usuario.id)))
    })
  )

  router.patch(
    '/preferencias',
    assincrono(async (req, res) => {
      const corpo = validar(zPreferencias, req.body)
      const atual = await repos.preferencias.obter(req.usuario.id)
      const dados = combinar(atual?.data ?? {}, corpo)
      const salvo = await repos.preferencias.salvar(req.usuario.id, dados, 'foto' in corpo ? corpo.foto : undefined)
      res.json(resposta(salvo))
    })
  )

  router.put(
    '/fuso',
    assincrono(async (req, res) => {
      const { fuso } = validar(z.object({ fuso: z.string().refine(fusoValido, 'Fuso horário inválido.') }), req.body)
      await repos.usuarios.definirFuso(req.usuario.id, fuso)
      res.json({ fuso })
    })
  )

  return router
}
