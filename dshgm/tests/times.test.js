import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cliente, criarAmbiente, entrar } from './helpers.js'

let amb, c, outro
beforeAll(async () => {
  amb = await criarAmbiente()
  c = cliente(await entrar(amb.app, { sub: 'times-a' }))
  outro = cliente(await entrar(amb.app, { sub: 'times-b' }))
})
afterAll(() => amb.fechar())

const time = async (nome = 'Relacionamento', setor = 'Atendimento', cli = c) => (await cli.post('/api/times', { nome, setor })).body.time
const colab = async (t, extra = {}, cli = c) => (await cli.post(`/api/times/${t.id}/colaboradores`, { nome: 'Ana', cargo: 'Analista', ...extra })).body.colaborador

describe('times', () => {
  it('cria time com nome e setor, edita e lista', async () => {
    const r = await c.post('/api/times', { nome: '  Relacionamento ', setor: 'Atendimento' })
    expect(r.status).toBe(201)
    expect(r.body.time).toMatchObject({ nome: 'Relacionamento', setor: 'Atendimento', subtimes: [], colaboradores: [] })
    const ed = await c.patch(`/api/times/${r.body.time.id}`, { setor: 'Pós-venda' })
    expect(ed.body.time).toMatchObject({ nome: 'Relacionamento', setor: 'Pós-venda' })
    expect((await c.get('/api/times')).body.times.some((t) => t.id === r.body.time.id)).toBe(true)
  })

  it('valida nome obrigatório e tamanho', async () => {
    expect((await c.post('/api/times', { nome: '   ' })).status).toBe(400)
    expect((await c.post('/api/times', { nome: 'a'.repeat(81) })).status).toBe(400)
    expect((await c.post('/api/times', { nome: 'Sem setor' })).body.time.setor).toBe('')
  })

  it('subtimes: criar, renomear, não repetir nome no mesmo time', async () => {
    const t = await time('Subs')
    const s = (await c.post(`/api/times/${t.id}/subtimes`, { nome: 'Cobrança' })).body.subtime
    expect(s).toMatchObject({ nome: 'Cobrança', timeId: t.id })
    expect((await c.post(`/api/times/${t.id}/subtimes`, { nome: 'cobrança' })).status).toBe(409)
    expect((await c.patch(`/api/times/subtimes/${s.id}`, { nome: 'Suporte' })).body.subtime.nome).toBe('Suporte')
    const t2 = await time('Outro time')
    expect((await c.post(`/api/times/${t2.id}/subtimes`, { nome: 'Suporte' })).status).toBe(201) // outro time: pode
    const lido = (await c.get('/api/times')).body.times.find((x) => x.id === t.id)
    expect(lido.subtimes.map((x) => x.nome)).toEqual(['Suporte'])
  })

  it('colaborador: nome, cargo, pontos fortes, pontos de melhoria, eventos e perfil', async () => {
    const t = await time('Completo')
    const r = await c.post(`/api/times/${t.id}/colaboradores`, {
      nome: 'Bruno',
      cargo: 'Analista de suporte',
      pontosFortes: ['Empatia', 'Agilidade'],
      pontosMelhoria: [{ texto: 'Registro de atendimentos', evidencia: 'Protocolo 2026-0045' }],
      eventos: [{ tipo: 'feedback', texto: 'Feedback positivo sobre o atendimento', data: '2026-11-10' }],
      perfil: 'Reservado, mas colabora bem.'
    })
    expect(r.status).toBe(201)
    expect(r.body.colaborador).toMatchObject({
      nome: 'Bruno',
      cargo: 'Analista de suporte',
      subtimeId: null,
      pontosFortes: ['Empatia', 'Agilidade'],
      perfil: 'Reservado, mas colabora bem.'
    })
    const [melhoria] = r.body.colaborador.pontosMelhoria
    expect(melhoria).toMatchObject({ texto: 'Registro de atendimentos', evidencia: 'Protocolo 2026-0045', desenvolvido: false, desenvolvidoEm: null })
    expect(melhoria.id).toBeTruthy()
    expect(r.body.colaborador.eventos[0]).toMatchObject({ tipo: 'feedback', data: '2026-11-10' })
    const lido = (await c.get('/api/times')).body.times.find((x) => x.id === t.id)
    expect(lido.colaboradores).toHaveLength(1)
  })

  it('ponto de melhoria EXIGE evidência', async () => {
    const t = await time('Evidência')
    const sem = await c.post(`/api/times/${t.id}/colaboradores`, { nome: 'Carla', pontosMelhoria: [{ texto: 'Pontualidade' }] })
    expect(sem.status).toBe(400)
    const vazia = await c.post(`/api/times/${t.id}/colaboradores`, { nome: 'Carla', pontosMelhoria: [{ texto: 'Pontualidade', evidencia: '   ' }] })
    expect(vazia.status).toBe(400)
    const c1 = await colab(t, { nome: 'Carla' })
    const edit = await c.patch(`/api/times/colaboradores/${c1.id}`, { pontosMelhoria: [{ texto: 'Pontualidade', evidencia: '' }] })
    expect(edit.status).toBe(400)
    // nada foi salvo pela tentativa inválida
    expect((await c.get('/api/times')).body.times.find((x) => x.id === t.id).colaboradores[0].pontosMelhoria).toEqual([])
  })

  it('marcar "desenvolvido" registra a data; desmarcar limpa; id do item é preservado', async () => {
    const t = await time('Desenvolvido')
    const col = await colab(t, { pontosMelhoria: [{ texto: 'Comunicação', evidencia: 'Protocolo 77' }] })
    const [item] = col.pontosMelhoria
    let r = await c.patch(`/api/times/colaboradores/${col.id}`, { pontosMelhoria: [{ ...item, desenvolvido: true }] })
    const feito = r.body.colaborador.pontosMelhoria[0]
    expect(feito).toMatchObject({ id: item.id, desenvolvido: true })
    expect(feito.desenvolvidoEm).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    r = await c.patch(`/api/times/colaboradores/${col.id}`, { pontosMelhoria: [{ ...feito, desenvolvido: false }] })
    expect(r.body.colaborador.pontosMelhoria[0]).toMatchObject({ id: item.id, desenvolvido: false, desenvolvidoEm: null })
  })

  it('colocar o colaborador num subtime e tirar dele; subtime de outro time é recusado', async () => {
    const t = await time('Divisão')
    const sub = (await c.post(`/api/times/${t.id}/subtimes`, { nome: 'SAC' })).body.subtime
    const col = await colab(t, { subtimeId: sub.id })
    expect(col.subtimeId).toBe(sub.id)
    const sem = await c.patch(`/api/times/colaboradores/${col.id}`, { subtimeId: null })
    expect(sem.body.colaborador.subtimeId).toBeNull()
    const t2 = await time('Outro')
    const subOutro = (await c.post(`/api/times/${t2.id}/subtimes`, { nome: 'X' })).body.subtime
    expect((await c.patch(`/api/times/colaboradores/${col.id}`, { subtimeId: subOutro.id })).status).toBe(400)
    expect((await c.post(`/api/times/${t.id}/colaboradores`, { nome: 'Z', subtimeId: subOutro.id })).status).toBe(400)
  })

  it('excluir subtime mantém as pessoas no time, sem subtime', async () => {
    const t = await time('Sem perder gente')
    const sub = (await c.post(`/api/times/${t.id}/subtimes`, { nome: 'Cobrança' })).body.subtime
    const col = await colab(t, { subtimeId: sub.id })
    expect((await c.delete(`/api/times/subtimes/${sub.id}`)).status).toBe(204)
    const lido = (await c.get('/api/times')).body.times.find((x) => x.id === t.id)
    expect(lido.subtimes).toEqual([])
    expect(lido.colaboradores.find((x) => x.id === col.id)).toMatchObject({ subtimeId: null })
  })

  it('editar o cartão preserva o que não foi enviado e excluir remove só aquele colaborador', async () => {
    const t = await time('Edição')
    const a = await colab(t, { nome: 'Ana', pontosFortes: ['Organização'], perfil: 'Notas' })
    const b = await colab(t, { nome: 'Beto' })
    const r = await c.patch(`/api/times/colaboradores/${a.id}`, { cargo: 'Líder' })
    expect(r.body.colaborador).toMatchObject({ nome: 'Ana', cargo: 'Líder', pontosFortes: ['Organização'], perfil: 'Notas' })
    expect((await c.delete(`/api/times/colaboradores/${a.id}`)).status).toBe(204)
    const lido = (await c.get('/api/times')).body.times.find((x) => x.id === t.id)
    expect(lido.colaboradores.map((x) => x.id)).toEqual([b.id])
    expect((await c.delete(`/api/times/colaboradores/${a.id}`)).status).toBe(404)
  })

  it('excluir o time remove subtimes e colaboradores dele', async () => {
    const t = await time('Efêmero')
    const sub = (await c.post(`/api/times/${t.id}/subtimes`, { nome: 'S' })).body.subtime
    const col = await colab(t, { subtimeId: sub.id })
    expect((await c.delete(`/api/times/${t.id}`)).status).toBe(204)
    expect(await amb.db.query('select 1 from team_members where id = $1', [col.id])).toHaveLength(0)
    expect(await amb.db.query('select 1 from team_subteams where id = $1', [sub.id])).toHaveLength(0)
  })

  it('eventos: tipo restrito, data válida, texto obrigatório', async () => {
    const t = await time('Eventos')
    const ev = (extra) => ({ tipo: 'reuniao', texto: 'Alinhamento mensal', data: '2026-11-12', ...extra })
    expect((await colab(t, { eventos: [ev()] })).eventos[0]).toMatchObject({ tipo: 'reuniao' })
    for (const ruim of [ev({ tipo: 'fofoca' }), ev({ data: '2026-02-30' }), ev({ texto: ' ' })]) {
      expect((await c.post(`/api/times/${t.id}/colaboradores`, { nome: 'X', eventos: [ruim] })).status).toBe(400)
    }
  })

  it('limites: pontos fortes (30) e texto do perfil', async () => {
    const t = await time('Limites')
    const muitos = Array.from({ length: 31 }, (_, i) => `ponto ${i}`)
    expect((await c.post(`/api/times/${t.id}/colaboradores`, { nome: 'X', pontosFortes: muitos })).status).toBe(400)
    expect((await c.post(`/api/times/${t.id}/colaboradores`, { nome: 'X', perfil: 'a'.repeat(4001) })).status).toBe(400)
  })

  it('isolamento: nada do time de outro usuário é visível ou alterável', async () => {
    const t = await time('Confidencial')
    const col = await colab(t, { nome: 'Pessoa', perfil: 'sigilo' })
    expect((await outro.get('/api/times')).body.times.some((x) => x.id === t.id)).toBe(false)
    expect((await outro.patch(`/api/times/${t.id}`, { nome: 'X' })).status).toBe(404)
    expect((await outro.delete(`/api/times/${t.id}`)).status).toBe(404)
    expect((await outro.post(`/api/times/${t.id}/colaboradores`, { nome: 'Intruso' })).status).toBe(404)
    expect((await outro.post(`/api/times/${t.id}/subtimes`, { nome: 'Intruso' })).status).toBe(404)
    expect((await outro.patch(`/api/times/colaboradores/${col.id}`, { perfil: 'hackeado' })).status).toBe(404)
    expect((await outro.delete(`/api/times/colaboradores/${col.id}`)).status).toBe(404)
    const lido = (await c.get('/api/times')).body.times.find((x) => x.id === t.id)
    expect(lido.colaboradores[0].perfil).toBe('sigilo')
  })

  it('exige login', async () => {
    const { default: request } = await import('supertest')
    expect((await request(amb.app).get('/api/times')).status).toBe(401)
  })
})
