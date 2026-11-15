import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cliente, criarAmbiente, entrar } from './helpers.js'
import { statusPelaChecklist } from '../server/lib/checklist.js'

let amb, c, outro
beforeAll(async () => {
  amb = await criarAmbiente()
  c = cliente(await entrar(amb.app, { sub: 'check-a' }))
  outro = cliente(await entrar(amb.app, { sub: 'check-b' }))
})
afterAll(() => amb.fechar())

const DIA = '2026-11-14'
const criar = async (itens = ['Pão', 'Leite', 'Café'], extra = {}) =>
  (await c.post('/api/tarefas', { texto: 'Mercado', data: DIA, checklist: itens.map((texto) => ({ texto })), ...extra })).body.tarefa
const marcar = (t, indice, feito = true, dia = DIA) =>
  c.put(`/api/tarefas/${t.id}/checklist/${t.checklist[indice].id}/${dia}`, { feito })

describe('regra da checklist (função pura)', () => {
  it('todos marcados conclui; alguns = andamento; nenhum volta de concluída para pendente', () => {
    expect(statusPelaChecklist('pendente', 3, 3)).toBe('concluida')
    expect(statusPelaChecklist('pendente', 3, 1)).toBe('andamento')
    expect(statusPelaChecklist('concluida', 3, 2)).toBe('andamento')
    expect(statusPelaChecklist('concluida', 3, 0)).toBe('pendente')
    expect(statusPelaChecklist('andamento', 3, 0)).toBe('andamento') // andamento à mão é mantido ao editar
    expect(statusPelaChecklist('andamento', 3, 0, { desmarcou: true })).toBe('pendente')
    expect(statusPelaChecklist('concluida', 0, 0)).toBe('concluida') // sem itens: a checklist não decide
  })
})

describe('checklist dentro da tarefa', () => {
  it('cria a tarefa com itens, na ordem informada, e sem marcações', async () => {
    const t = await criar()
    expect(t.checklist.map((i) => i.texto)).toEqual(['Pão', 'Leite', 'Café'])
    expect(t.checklist.every((i) => i.id && Object.keys(i.feitos).length === 0)).toBe(true)
    expect(t.concluidas).toEqual({})
  })

  it('tarefa sem checklist continua funcionando como antes', async () => {
    const t = (await c.post('/api/tarefas', { texto: 'Simples', data: DIA })).body.tarefa
    expect(t.checklist).toEqual([])
    const r = await c.put(`/api/tarefas/${t.id}/concluidas/${DIA}`, { concluida: true })
    expect(r.body.tarefa.concluidas).toEqual({ [DIA]: true })
  })

  it('marcar itens: primeiro vira em andamento, o último conclui a tarefa', async () => {
    const t = await criar()
    let r = await marcar(t, 0)
    expect(r.status).toBe(200)
    expect(r.body.tarefa.andamento).toEqual({ [DIA]: true })
    expect(r.body.tarefa.concluidas).toEqual({})
    r = await marcar(t, 1)
    expect(r.body.tarefa.concluidas).toEqual({})
    r = await marcar(t, 2)
    expect(r.body.tarefa.concluidas).toEqual({ [DIA]: true })
    expect(r.body.tarefa.andamento).toEqual({})
    expect(r.body.tarefa.checklist.every((i) => i.feitos[DIA] === true)).toBe(true)
  })

  it('desmarcar um item reabre a tarefa; desmarcar todos volta a pendente', async () => {
    const t = await criar(['A', 'B'])
    await marcar(t, 0)
    await marcar(t, 1)
    let r = await marcar(t, 1, false)
    expect(r.body.tarefa.concluidas).toEqual({})
    expect(r.body.tarefa.andamento).toEqual({ [DIA]: true })
    r = await marcar(t, 0, false)
    expect(r.body.tarefa.andamento).toEqual({})
    expect(r.body.tarefa.concluidas).toEqual({})
  })

  it('marcar duas vezes é idempotente', async () => {
    const t = await criar(['A', 'B'])
    await marcar(t, 0)
    const r = await marcar(t, 0)
    expect(r.body.tarefa.checklist[0].feitos).toEqual({ [DIA]: true })
  })

  it('tarefa recorrente: o preenchimento é por dia, sem afetar os outros dias', async () => {
    const t = await criar(['A', 'B'], { tipo: 'recorrente', dias: [0, 1, 2, 3, 4, 5, 6], data: undefined })
    await marcar(t, 0, true, '2026-11-14')
    await marcar(t, 1, true, '2026-11-14')
    const r = await marcar(t, 0, true, '2026-11-15')
    expect(r.body.tarefa.concluidas).toEqual({ '2026-11-14': true })
    expect(r.body.tarefa.andamento).toEqual({ '2026-11-15': true })
  })

  it('editar a checklist preserva marcações dos itens mantidos, cria novos e remove os retirados', async () => {
    const t = await criar(['A', 'B', 'C'])
    await marcar(t, 0)
    const [a, , c3] = t.checklist
    const r = await c.patch(`/api/tarefas/${t.id}`, { checklist: [{ id: c3.id, texto: 'C editado' }, { id: a.id, texto: 'A' }, { texto: 'D novo' }] })
    expect(r.status).toBe(200)
    expect(r.body.tarefa.checklist.map((i) => i.texto)).toEqual(['C editado', 'A', 'D novo'])
    expect(r.body.tarefa.checklist[1].feitos).toEqual({ [DIA]: true }) // A continua marcado
    expect(r.body.tarefa.checklist[0].id).toBe(c3.id)
  })

  it('acrescentar um item a uma tarefa já concluída pelo checklist a reabre (hoje)', async () => {
    const hoje = (await c.post('/api/tarefas', { texto: 'x' })).body.tarefa.data // data de hoje no fuso da conta
    const t = (await c.post('/api/tarefas', { texto: 'Hoje', data: hoje, checklist: [{ texto: 'A' }] })).body.tarefa
    const r1 = await marcar(t, 0, true, hoje)
    expect(r1.body.tarefa.concluidas).toEqual({ [hoje]: true })
    const r2 = await c.patch(`/api/tarefas/${t.id}`, { checklist: [{ id: t.checklist[0].id, texto: 'A' }, { texto: 'B' }] })
    expect(r2.body.tarefa.concluidas).toEqual({})
    expect(r2.body.tarefa.andamento).toEqual({ [hoje]: true })
  })

  it('editar só o texto da tarefa não mexe na checklist', async () => {
    const t = await criar(['A'])
    const r = await c.patch(`/api/tarefas/${t.id}`, { texto: 'Novo nome' })
    expect(r.body.tarefa.checklist.map((i) => i.texto)).toEqual(['A'])
  })

  it('validações: item vazio, item grande demais, itens demais, data inválida', async () => {
    const base = { texto: 'T', data: DIA }
    expect((await c.post('/api/tarefas', { ...base, checklist: [{ texto: '   ' }] })).status).toBe(400)
    expect((await c.post('/api/tarefas', { ...base, checklist: [{ texto: 'a'.repeat(201) }] })).status).toBe(400)
    expect((await c.post('/api/tarefas', { ...base, checklist: Array.from({ length: 31 }, (_, i) => ({ texto: `i${i}` })) })).status).toBe(400)
    const t = await criar(['A'])
    expect((await c.put(`/api/tarefas/${t.id}/checklist/${t.checklist[0].id}/2026-13-40`, { feito: true })).status).toBe(400)
    expect((await c.put(`/api/tarefas/${t.id}/checklist/${t.checklist[0].id}/${DIA}`, { feito: 'sim' })).status).toBe(400)
  })

  it('excluir a tarefa remove a checklist e as marcações', async () => {
    const t = await criar(['A'])
    await marcar(t, 0)
    expect((await c.delete(`/api/tarefas/${t.id}`)).status).toBe(204)
    const itens = await amb.db.query('select id from task_checklist_items where task_id = $1', [t.id])
    expect(itens).toHaveLength(0)
    const feitos = await amb.db.query('select 1 from task_checklist_done where item_id = $1', [t.checklist[0].id])
    expect(feitos).toHaveLength(0)
  })

  it('isolamento: outro usuário não vê, não marca e não altera a checklist', async () => {
    const t = await criar(['Privado'])
    expect((await outro.get('/api/tarefas')).body.tarefas.some((x) => x.id === t.id)).toBe(false)
    expect((await outro.put(`/api/tarefas/${t.id}/checklist/${t.checklist[0].id}/${DIA}`, { feito: true })).status).toBe(404)
    expect((await outro.patch(`/api/tarefas/${t.id}`, { checklist: [] })).status).toBe(404)
    // item de outra tarefa (id válido, mas não pertence à tarefa da URL) também é recusado
    const t2 = await criar(['Outra'])
    expect((await c.put(`/api/tarefas/${t.id}/checklist/${t2.checklist[0].id}/${DIA}`, { feito: true })).status).toBe(404)
    const lida = (await c.get('/api/tarefas')).body.tarefas.find((x) => x.id === t.id)
    expect(lida.checklist[0].feitos).toEqual({})
  })

  it('um id de item que não é da tarefa é ignorado ao editar (não "rouba" item alheio)', async () => {
    const t = await criar(['A'])
    const t2 = await criar(['Do outro'])
    const r = await c.patch(`/api/tarefas/${t.id}`, { checklist: [{ id: t2.checklist[0].id, texto: 'Invasor' }] })
    expect(r.body.tarefa.checklist).toHaveLength(0)
    const intacto = (await c.get('/api/tarefas')).body.tarefas.find((x) => x.id === t2.id)
    expect(intacto.checklist.map((i) => i.texto)).toEqual(['Do outro'])
  })
})
