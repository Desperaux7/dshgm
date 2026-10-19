import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cliente, conectarCalendario, criarAmbiente, entrar, sincronizar } from './helpers.js'

let amb, c, sessao
beforeAll(async () => {
  amb = await criarAmbiente()
  sessao = await entrar(amb.app, { sub: 'tarefas' })
  c = cliente(sessao)
})
afterAll(() => amb.fechar())

describe('tarefas', () => {
  it('cria tarefa única com data padrão e lista', async () => {
    const r = await c.post('/api/tarefas', { texto: '  Comprar pão  ' })
    expect(r.status).toBe(201)
    expect(r.body.tarefa).toMatchObject({ texto: 'Comprar pão', tipo: 'unica', dias: [], concluidas: {} })
    expect(r.body.tarefa.data).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect((await c.get('/api/tarefas')).body.tarefas).toHaveLength(1)
  })

  it('cria recorrente com dias normalizados e exige ao menos um dia', async () => {
    const ok = await c.post('/api/tarefas', { texto: 'Academia', tipo: 'recorrente', dias: [5, 1, 1, 3] })
    expect(ok.body.tarefa).toMatchObject({ tipo: 'recorrente', dias: [1, 3, 5], data: null })
    const sem = await c.post('/api/tarefas', { texto: 'Sem dias', tipo: 'recorrente', dias: [] })
    expect(sem.status).toBe(400)
  })

  it('valida entrada (dia 7, data inválida, texto vazio ou enorme)', async () => {
    expect((await c.post('/api/tarefas', { texto: 'x', tipo: 'recorrente', dias: [7] })).status).toBe(400)
    expect((await c.post('/api/tarefas', { texto: 'x', data: '2026-02-30' })).status).toBe(400)
    expect((await c.post('/api/tarefas', { texto: '   ' })).status).toBe(400)
    expect((await c.post('/api/tarefas', { texto: 'a'.repeat(301) })).status).toBe(400)
  })

  it('edita texto e converte tipo', async () => {
    const t = (await c.post('/api/tarefas', { texto: 'Original' })).body.tarefa
    const e1 = await c.patch(`/api/tarefas/${t.id}`, { texto: 'Editada' })
    expect(e1.body.tarefa.texto).toBe('Editada')
    const e2 = await c.patch(`/api/tarefas/${t.id}`, { tipo: 'recorrente', dias: [2] })
    expect(e2.body.tarefa).toMatchObject({ tipo: 'recorrente', dias: [2], data: null })
    expect((await c.patch(`/api/tarefas/${t.id}`, { dias: [] })).status).toBe(400)
  })

  it('permite redefinir o início de uma recorrente ao convertê-la (campo criada)', async () => {
    const t = (await c.post('/api/tarefas', { texto: 'Conv', criada: '2026-01-01' })).body.tarefa
    const r = await c.patch(`/api/tarefas/${t.id}`, { tipo: 'recorrente', dias: [1], criada: '2026-10-20' })
    expect(r.body.tarefa).toMatchObject({ tipo: 'recorrente', criada: '2026-10-20' })
    expect((await c.patch(`/api/tarefas/${t.id}`, { criada: 'ontem' })).status).toBe(400)
  })

  it('marca e desmarca a conclusão por dia, sem afetar outros dias', async () => {
    const t = (await c.post('/api/tarefas', { texto: 'Diária', tipo: 'recorrente', dias: [0, 1, 2, 3, 4, 5, 6] })).body.tarefa
    await c.put(`/api/tarefas/${t.id}/concluidas/2026-10-19`, { concluida: true })
    const r = await c.put(`/api/tarefas/${t.id}/concluidas/2026-10-20`, { concluida: true })
    expect(r.body.tarefa.concluidas).toEqual({ '2026-10-19': true, '2026-10-20': true })
    const d = await c.put(`/api/tarefas/${t.id}/concluidas/2026-10-19`, { concluida: false })
    expect(d.body.tarefa.concluidas).toEqual({ '2026-10-20': true })
    expect((await c.put(`/api/tarefas/${t.id}/concluidas/2026-13-40`, { concluida: true })).status).toBe(400)
  })

  it('marcar duas vezes é idempotente', async () => {
    const t = (await c.post('/api/tarefas', { texto: 'Idem' })).body.tarefa
    await c.put(`/api/tarefas/${t.id}/concluidas/2026-10-20`, { concluida: true })
    const r = await c.put(`/api/tarefas/${t.id}/concluidas/2026-10-20`, { concluida: true })
    expect(r.status).toBe(200)
  })

  it('exclui a tarefa e suas conclusões', async () => {
    const t = (await c.post('/api/tarefas', { texto: 'Apagar' })).body.tarefa
    await c.put(`/api/tarefas/${t.id}/concluidas/2026-10-20`, { concluida: true })
    expect((await c.delete(`/api/tarefas/${t.id}`)).status).toBe(204)
    expect((await c.delete(`/api/tarefas/${t.id}`)).status).toBe(404)
    const restos = await amb.db.query('select 1 from task_completions where task_id = $1', [t.id])
    expect(restos).toHaveLength(0)
  })
})

describe('tarefas NÃO são eventos do calendário', () => {
  it('criar, editar e concluir tarefas nunca cria eventos, nem localmente nem no Google', async () => {
    const calendario = await conectarCalendario(amb.app, sessao)
    expect(calendario.headers.location).toContain('calendario=conectado')

    const t = (await c.post('/api/tarefas', { texto: 'Reunião?', tipo: 'recorrente', dias: [1, 2] })).body.tarefa
    await c.patch(`/api/tarefas/${t.id}`, { texto: 'Reunião!' })
    await c.put(`/api/tarefas/${t.id}/concluidas/2026-10-19`, { concluida: true })
    await sincronizar(c)

    expect((await c.get('/api/eventos')).body.eventos).toEqual([])
    expect(amb.google.todos('tarefas')).toEqual([])
    const [{ n }] = await amb.db.query('select count(*)::int as n from events')
    expect(n).toBe(0)
  })

  it('eventos e tarefas são tabelas independentes (sem chave entre elas)', async () => {
    const fks = await amb.db.query(
      `select conrelid::regclass::text as tabela, confrelid::regclass::text as referencia
         from pg_constraint where contype = 'f' and conrelid::regclass::text in ('tasks','events')`
    )
    expect(fks.every((f) => f.referencia === 'users')).toBe(true)
  })
})
