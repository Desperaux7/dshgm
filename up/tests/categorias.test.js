import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cliente, criarAmbiente, entrar } from './helpers.js'

let amb, c
beforeAll(async () => {
  amb = await criarAmbiente()
  c = cliente(await entrar(amb.app, { sub: 'categorias' }))
})
afterAll(() => amb.fechar())

describe('categorias próprias das movimentações', () => {
  it('cria, lista e remove; repetir o nome (sem diferenciar maiúsculas) devolve a mesma', async () => {
    const a = await c.post('/api/categorias', { tipo: 'expense', nome: '  Pets ' })
    expect(a.status).toBe(201)
    expect(a.body.categoria).toMatchObject({ tipo: 'expense', nome: 'Pets' })

    const b = await c.post('/api/categorias', { tipo: 'expense', nome: 'pets' })
    expect(b.body.categoria.id).toBe(a.body.categoria.id)

    // O mesmo nome em outro tipo é outra categoria.
    const outroTipo = await c.post('/api/categorias', { tipo: 'income', nome: 'Pets' })
    expect(outroTipo.body.categoria.id).not.toBe(a.body.categoria.id)

    expect((await c.get('/api/categorias')).body.categorias).toHaveLength(2)
    expect((await c.delete(`/api/categorias/${a.body.categoria.id}`)).status).toBe(204)
    expect((await c.get('/api/categorias')).body.categorias).toHaveLength(1)
  })

  it('valida tipo e nome', async () => {
    expect((await c.post('/api/categorias', { tipo: 'outro', nome: 'X' })).status).toBe(400)
    expect((await c.post('/api/categorias', { tipo: 'expense', nome: '   ' })).status).toBe(400)
    expect((await c.post('/api/categorias', { tipo: 'expense', nome: 'x'.repeat(41) })).status).toBe(400)
  })

  it('remover a categoria não altera movimentações já registradas', async () => {
    const cat = (await c.post('/api/categorias', { tipo: 'expense', nome: 'Assinaturas' })).body.categoria
    const t = await c.post('/api/transacoes', { type: 'expense', description: 'Streaming', amount: 39.9, date: '2026-10-10', category: 'Assinaturas' })
    expect(t.status).toBe(201)
    await c.delete(`/api/categorias/${cat.id}`)
    const lista = (await c.get('/api/transacoes')).body
    expect(JSON.stringify(lista)).toContain('Assinaturas')
  })

  it('cada conta vê e apaga só as suas', async () => {
    const cat = (await c.post('/api/categorias', { tipo: 'saving', nome: 'Viagem' })).body.categoria
    const outra = cliente(await entrar(amb.app, { sub: 'categorias-outra' }))
    expect((await outra.get('/api/categorias')).body.categorias).toHaveLength(0)
    expect((await outra.delete(`/api/categorias/${cat.id}`)).status).toBe(404)
  })

  it('limita a quantidade de categorias próprias', async () => {
    const limite = cliente(await entrar(amb.app, { sub: 'categorias-limite' }))
    for (let i = 0; i < 60; i++) await limite.post('/api/categorias', { tipo: 'expense', nome: `Cat ${i}` })
    expect((await limite.post('/api/categorias', { tipo: 'expense', nome: 'Uma a mais' })).status).toBe(400)
  })
})
