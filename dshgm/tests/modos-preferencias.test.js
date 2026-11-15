import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cliente, criarAmbiente, entrar } from './helpers.js'

let amb, c
beforeAll(async () => {
  amb = await criarAmbiente()
  c = cliente(await entrar(amb.app, { sub: 'modos' }))
})
afterAll(() => amb.fechar())

describe('preferências: modo pessoal/profissional e novas cores', () => {
  it('salva o modo e os cartões de cada modo separadamente', async () => {
    await c.patch('/api/preferencias', { cartoes: { 'painel-spotify': false } })
    const r = await c.patch('/api/preferencias', { modo: 'profissional', cartoesPro: { 'painel-times': false } })
    expect(r.status).toBe(200)
    expect(r.body.preferencias).toMatchObject({
      modo: 'profissional',
      cartoes: { 'painel-spotify': false },
      cartoesPro: { 'painel-times': false }
    })
    // alterar um cartão de um modo não apaga os do outro
    const r2 = await c.patch('/api/preferencias', { cartoesPro: { 'resumo-times': false } })
    expect(r2.body.preferencias.cartoesPro).toEqual({ 'painel-times': false, 'resumo-times': false })
    expect(r2.body.preferencias.cartoes).toEqual({ 'painel-spotify': false })
  })

  it('recusa modo inválido', async () => {
    expect((await c.patch('/api/preferencias', { modo: 'ferias' })).status).toBe(400)
  })

  it('aceita as novas cores e as antigas; recusa cor desconhecida', async () => {
    for (const destaque of ['ciano', 'oceano', 'menta', 'ambar', 'vermelho', 'dourado', 'monocromo', 'sakura']) {
      const r = await c.patch('/api/preferencias', { destaque })
      expect(r.status, destaque).toBe(200)
      expect(r.body.preferencias.destaque).toBe(destaque)
    }
    expect((await c.patch('/api/preferencias', { destaque: 'neon' })).status).toBe(400)
  })

  it('contas antigas (sem modo) continuam válidas', async () => {
    const outro = cliente(await entrar(amb.app, { sub: 'modos-antigo' }))
    const r = await outro.get('/api/preferencias')
    expect(r.status).toBe(200)
    expect(r.body.preferencias.modo).toBeUndefined() // o front assume "pessoal"
  })
})
