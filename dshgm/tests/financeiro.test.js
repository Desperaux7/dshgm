import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cliente, criarAmbiente, entrar } from './helpers.js'

let amb, c
beforeAll(async () => {
  amb = await criarAmbiente()
  c = cliente(await entrar(amb.app, { sub: 'fin' }))
})
afterAll(() => amb.fechar())

const mov = (type, amount, date = '2026-10-10', extra = {}) => ({ type, description: `${type} ${amount}`, category: 'Geral', amount, date, ...extra })

describe('financeiro', () => {
  it('cria, edita, lista e exclui movimentações', async () => {
    const t = (await c.post('/api/transacoes', mov('expense', 25.5, '2026-10-02'))).body.transacao
    expect(t).toMatchObject({ type: 'expense', amount: 25.5, date: '2026-10-02' })
    const e = await c.patch(`/api/transacoes/${t.id}`, { amount: 30, description: 'Mercado' })
    expect(e.body.transacao).toMatchObject({ amount: 30, description: 'Mercado' })
    expect((await c.get('/api/transacoes')).body.transacoes).toHaveLength(1)
    expect((await c.delete(`/api/transacoes/${t.id}`)).status).toBe(204)
    expect((await c.get('/api/transacoes')).body.transacoes).toHaveLength(0)
  })

  it('rejeita valores e tipos inválidos', async () => {
    for (const ruim of [mov('expense', 0), mov('expense', -5), mov('lixo', 5), mov('expense', 5, '2026-02-31'), { ...mov('expense', 5), amount: '5' }, { ...mov('expense', 5), description: '' }]) {
      expect((await c.post('/api/transacoes', ruim)).status).toBe(400)
    }
  })

  it('arredonda para 2 casas sem erro de ponto flutuante', async () => {
    const r = await c.post('/api/transacoes', mov('income', 10.005 + 0.1))
    expect(Number.isInteger(Math.round(r.body.transacao.amount * 100))).toBe(true)
    await amb.db.query('delete from transactions')
  })

  it('saldo = entradas − despesas − guardado, com soma exata (0,1 + 0,2)', async () => {
    await c.post('/api/transacoes', mov('income', 1000.1))
    await c.post('/api/transacoes', mov('expense', 0.1))
    await c.post('/api/transacoes', mov('expense', 0.2))
    await c.post('/api/transacoes', mov('saving', 100))
    await c.post('/api/transacoes', mov('expense', 999, '2026-09-30')) // outro mês
    await c.post('/api/transacoes', mov('saving', 50, '2026-09-15'))
    const { resumo } = (await c.get('/api/transacoes/resumo?mes=2026-10')).body
    expect(resumo).toMatchObject({ mes: '2026-10', entradas: 1000.1, despesas: 0.3, guardado: 100, saldo: 899.8, totalGuardado: 150 })
    const set = (await c.get('/api/transacoes/resumo?mes=2026-09')).body.resumo
    expect(set).toMatchObject({ despesas: 999, guardado: 50, saldo: -1049 })
  })

  it('o resumo do dashboard bate com a soma das movimentações listadas', async () => {
    const lista = (await c.get('/api/transacoes?de=2026-10-01&ate=2026-10-31')).body.transacoes
    const soma = lista.reduce((s, t) => s + (t.type === 'income' ? t.amount : -t.amount), 0)
    const { resumo } = (await c.get('/api/transacoes/resumo?mes=2026-10')).body
    expect(Math.round(soma * 100) / 100).toBe(resumo.saldo)
  })

  it('filtra por período e pagina', async () => {
    expect((await c.get('/api/transacoes?de=2026-09-01&ate=2026-09-30')).body.transacoes).toHaveLength(2)
    expect((await c.get('/api/transacoes?limite=2')).body.transacoes).toHaveLength(2)
    expect((await c.get('/api/transacoes?limite=2&offset=4')).body.transacoes).toHaveLength(2)
    expect((await c.get('/api/transacoes?limite=99999')).status).toBe(400)
    expect((await c.get('/api/transacoes/resumo?mes=2026-13')).status).toBe(400)
  })

  it('meta de gastos: salva, lê, valida e remove', async () => {
    expect((await c.get('/api/meta')).body.meta).toBeNull()
    expect((await c.put('/api/meta', { nome: 'Viagem', valor: 3500.5, prazo: '2027-03' })).status).toBe(200)
    expect((await c.get('/api/meta')).body.meta).toEqual({ nome: 'Viagem', valor: 3500.5, prazo: '2027-03' })
    expect((await c.put('/api/meta', { valor: 0, prazo: '2027-03' })).status).toBe(400)
    expect((await c.put('/api/meta', { valor: 10, prazo: '03/2027' })).status).toBe(400)
    expect((await c.delete('/api/meta')).status).toBe(204)
    expect((await c.get('/api/meta')).body.meta).toBeNull()
  })
})
