import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cliente, criarAmbiente, entrar } from './helpers.js'

let amb, a, b, sb, ids
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)])

beforeAll(async () => {
  amb = await criarAmbiente()
  a = cliente(await entrar(amb.app, { sub: 'usuario-a' }))
  sb = await entrar(amb.app, { sub: 'usuario-b' })
  b = cliente(sb)
  ids = {
    tarefa: (await a.post('/api/tarefas', { texto: 'Tarefa de A' })).body.tarefa.id,
    transacao: (await a.post('/api/transacoes', { type: 'income', description: 'Salário', category: 'Salário', amount: 5000, date: '2026-10-05' })).body.transacao.id,
    favorito: (await a.post('/api/favoritos', { nome: 'Site', url: 'https://exemplo.com' })).body.favorito.id,
    lazer: (await a.post('/api/lazer', { tipo: 'jogo', titulo: 'Jogo de A' })).body.item.id,
    evento: (await a.post('/api/eventos', { titulo: 'Evento de A', data: '2026-10-20' })).body.evento.id
  }
  await a.put('/api/meta', { nome: 'Viagem', valor: 1000, prazo: '2027-01' })
  await a.patch('/api/preferencias', { nome: 'Alice' })
})
afterAll(() => amb.fechar())

describe('isolamento entre usuários', () => {
  it('B não enxerga nenhum dado de A nas listagens', async () => {
    expect((await b.get('/api/tarefas')).body.tarefas).toEqual([])
    expect((await b.get('/api/transacoes')).body.transacoes).toEqual([])
    expect((await b.get('/api/favoritos')).body.favoritos).toEqual([])
    expect((await b.get('/api/lazer')).body.itens).toEqual([])
    expect((await b.get('/api/eventos')).body.eventos).toEqual([])
    expect((await b.get('/api/meta')).body.meta).toBeNull()
    expect((await b.get('/api/preferencias')).body.preferencias.nome).toBeUndefined()
    expect((await b.get('/api/transacoes/resumo?mes=2026-10')).body.resumo.entradas).toBe(0)
  })

  it('B não consegue alterar nem excluir registros de A (404)', async () => {
    const alvos = [
      ['patch', `/api/tarefas/${ids.tarefa}`, { texto: 'invadido' }],
      ['delete', `/api/tarefas/${ids.tarefa}`],
      ['put', `/api/tarefas/${ids.tarefa}/concluidas/2026-10-20`, { concluida: true }],
      ['patch', `/api/transacoes/${ids.transacao}`, { amount: 1 }],
      ['delete', `/api/transacoes/${ids.transacao}`],
      ['patch', `/api/favoritos/${ids.favorito}`, { nome: 'x' }],
      ['delete', `/api/favoritos/${ids.favorito}`],
      ['patch', `/api/lazer/${ids.lazer}`, { titulo: 'x' }],
      ['delete', `/api/lazer/${ids.lazer}`],
      ['patch', `/api/eventos/${ids.evento}`, { titulo: 'x' }],
      ['delete', `/api/eventos/${ids.evento}`]
    ]
    for (const [metodo, url, corpo] of alvos) {
      const r = await b[metodo](url, corpo)
      expect(r.status, `${metodo} ${url}`).toBe(404)
    }
  })

  it('os registros de A continuam intactos depois das tentativas de B', async () => {
    expect((await a.get('/api/tarefas')).body.tarefas[0].texto).toBe('Tarefa de A')
    expect((await a.get('/api/transacoes')).body.transacoes[0].amount).toBe(5000)
    expect((await a.get('/api/favoritos')).body.favoritos).toHaveLength(1)
    expect((await a.get('/api/lazer')).body.itens[0].titulo).toBe('Jogo de A')
    expect((await a.get('/api/eventos')).body.eventos[0].titulo).toBe('Evento de A')
  })

  it('B não envia nem lê capa de item de A', async () => {
    const put = await sb.agent
      .put(`/api/lazer/${ids.lazer}/capa`)
      .set('X-CSRF-Token', sb.csrf).set('Content-Type', 'image/jpeg').set('X-Largura', '10').set('X-Altura', '10').send(JPEG)
    expect(put.status).toBe(404)
    expect((await b.get(`/api/lazer/${ids.lazer}/capa`)).status).toBe(404)
  })

  it('ignora user_id/owner enviado pelo cliente no corpo', async () => {
    const dono = await amb.db.query("select id from users where google_sub = 'usuario-a'")
    const r = await b.post('/api/tarefas', { texto: 'de B', user_id: dono[0].id, userId: dono[0].id })
    expect(r.status).toBe(201)
    expect((await a.get('/api/tarefas')).body.tarefas.map((t) => t.texto)).toEqual(['Tarefa de A'])
    expect((await b.get('/api/tarefas')).body.tarefas.map((t) => t.texto)).toEqual(['de B'])
  })

  it('ids que não são UUID retornam 404 (sem erro de banco)', async () => {
    expect((await b.delete('/api/tarefas/1%20or%201=1')).status).toBe(404)
    expect((await b.get('/api/lazer/abc/capa')).status).toBe(404)
  })
})
