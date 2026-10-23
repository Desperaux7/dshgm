import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cliente, criarAmbiente, entrar } from './helpers.js'

let amb, c, sessao
beforeAll(async () => {
  amb = await criarAmbiente()
  sessao = await entrar(amb.app, { sub: 'status' })
  c = cliente(sessao)
})
afterAll(() => amb.fechar())

const DIA = '2026-10-22'

describe('status da tarefa (pendente, em andamento, concluída)', () => {
  it('um dia nunca fica em dois estados ao mesmo tempo', async () => {
    const { tarefa } = (await c.post('/api/tarefas', { texto: 'Estudar', data: DIA })).body
    expect(tarefa.andamento).toEqual({})

    let r = await c.put(`/api/tarefas/${tarefa.id}/status/${DIA}`, { status: 'andamento' })
    expect(r.status).toBe(200)
    expect(r.body.tarefa.andamento).toEqual({ [DIA]: true })
    expect(r.body.tarefa.concluidas).toEqual({})

    r = await c.put(`/api/tarefas/${tarefa.id}/status/${DIA}`, { status: 'concluida' })
    expect(r.body.tarefa.andamento).toEqual({})
    expect(r.body.tarefa.concluidas).toEqual({ [DIA]: true })

    r = await c.put(`/api/tarefas/${tarefa.id}/status/${DIA}`, { status: 'pendente' })
    expect(r.body.tarefa.andamento).toEqual({})
    expect(r.body.tarefa.concluidas).toEqual({})
  })

  it('a rota antiga de conclusão continua valendo e desmarcar volta para pendente', async () => {
    const { tarefa } = (await c.post('/api/tarefas', { texto: 'Compat', data: DIA })).body
    await c.put(`/api/tarefas/${tarefa.id}/status/${DIA}`, { status: 'andamento' })
    const r = await c.put(`/api/tarefas/${tarefa.id}/concluidas/${DIA}`, { concluida: false })
    expect(r.body.tarefa.andamento).toEqual({})
    expect(r.body.tarefa.concluidas).toEqual({})
  })

  it('em tarefa recorrente o andamento é por dia', async () => {
    const { tarefa } = (await c.post('/api/tarefas', { texto: 'Treino', tipo: 'recorrente', dias: [1, 4] })).body
    await c.put(`/api/tarefas/${tarefa.id}/status/2026-10-22`, { status: 'andamento' })
    const r = await c.put(`/api/tarefas/${tarefa.id}/status/2026-10-26`, { status: 'concluida' })
    expect(r.body.tarefa.andamento).toEqual({ '2026-10-22': true })
    expect(r.body.tarefa.concluidas).toEqual({ '2026-10-26': true })
  })

  it('valida status e data, e não mexe em tarefa de outra conta', async () => {
    const { tarefa } = (await c.post('/api/tarefas', { texto: 'Minha', data: DIA })).body
    expect((await c.put(`/api/tarefas/${tarefa.id}/status/${DIA}`, { status: 'qualquer' })).status).toBe(400)
    expect((await c.put(`/api/tarefas/${tarefa.id}/status/2026-02-30`, { status: 'andamento' })).status).toBe(400)

    const outra = cliente(await entrar(amb.app, { sub: 'status-outra' }))
    expect((await outra.put(`/api/tarefas/${tarefa.id}/status/${DIA}`, { status: 'andamento' })).status).toBe(404)
    expect((await c.get('/api/tarefas')).body.tarefas.find((t) => t.id === tarefa.id).andamento).toEqual({})
  })

  it('apagar a tarefa apaga o andamento junto', async () => {
    const { tarefa } = (await c.post('/api/tarefas', { texto: 'Temporária', data: DIA })).body
    await c.put(`/api/tarefas/${tarefa.id}/status/${DIA}`, { status: 'andamento' })
    expect((await c.delete(`/api/tarefas/${tarefa.id}`)).status).toBe(204)
    const [r] = await amb.db.query('select count(*)::int as n from task_progress where task_id = $1', [tarefa.id])
    expect(r.n).toBe(0)
  })
})
