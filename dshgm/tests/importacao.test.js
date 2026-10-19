import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cliente, criarAmbiente, entrar } from './helpers.js'

let amb
beforeAll(async () => { amb = await criarAmbiente() })
afterAll(() => amb.fechar())

// Dados no formato que o localStorage guardava antes da migração.
const legado = () => ({
  tarefas: [
    { id: 'id-1', texto: 'Estudar', tipo: 'unica', data: '2026-10-20', concluidas: { '2026-10-20': true } },
    { id: 'id-2', texto: 'Academia', tipo: 'recorrente', dias: [1, 3, 5], criada: '2026-09-01', concluidas: { '2026-10-19': true, '2026-10-21': false, 'lixo': true } },
    { id: 'id-3', texto: '', tipo: 'unica' }, // inválida
    { id: 'id-4', texto: 'Sem data' } // data padrão = hoje
  ],
  transacoes: [
    { id: 't1', type: 'income', description: 'Salário', category: 'Salário', amount: 3200.5, date: '2026-10-05' },
    { id: 't2', type: 'expense', description: 'Mercado', category: 'Alimentação', amount: 150.1, date: '2026-10-06' },
    { id: 't3', type: 'expense', description: 'Quebrada', category: 'X', amount: -5, date: '2026-10-06' }, // inválida
    { id: 't4', type: 'saving', description: 'Reserva', category: 'Poupança', amount: 200, date: '2026-10-07' }
  ],
  meta: { nome: 'Viagem', valor: 5000, prazo: '2027-06' },
  favoritos: [
    { id: 'f1', nome: 'GitHub', url: 'https://github.com', categoria: 'Desenvolvimento', fixado: true, criado: 1760000000000 },
    { id: 'f2', nome: 'Ruim', url: 'javascript:alert(1)' }
  ],
  lazer: [
    { id: 'l1', tipo: 'jogo', titulo: 'Hades', plataforma: 'PC', status: 'andamento', progresso: 60, capa: { largura: 300, altura: 400, versao: 1 } },
    { id: 'l2', tipo: 'filme', titulo: 'Filme', status: 'concluido', progresso: 50 }
  ],
  agenda: [
    { id: 'a1', titulo: 'Dentista', data: '2026-10-22', diaInteiro: false, inicio: '14:00', fim: '15:00', categoria: 'saude', notas: '', rec: { tipo: 'nenhuma', dias: [], ate: '' }, excecoes: [] },
    { id: 'a2', titulo: 'Aula', data: '2026-10-19', diaInteiro: false, inicio: 'xx', categoria: 'estudos', rec: { tipo: 'semanal', dias: [1], ate: '' }, excecoes: ['2026-10-26'] },
    { id: 'a3', titulo: 'Inválido', data: '31/12/2026' }
  ],
  preferencias: { nome: 'Gustavo', destaque: 'menta', foto: 'data:image/jpeg;base64,/9j/4AAQ' }
})

describe('migração dos dados locais', () => {
  it('importa tudo, relata rejeitados e devolve o mapa de capas do lazer', async () => {
    const c = cliente(await entrar(amb.app, { sub: 'migra-1' }))
    const r = await c.post('/api/importacao', legado())
    expect(r.status).toBe(200)
    const x = r.body.resultado
    expect(x.tarefas).toMatchObject({ recebidos: 4, importados: 3 })
    expect(x.tarefas.rejeitados).toHaveLength(1)
    expect(x.tarefas.rejeitados[0].indice).toBe(2)
    expect(x.transacoes).toMatchObject({ recebidos: 4, importados: 3 })
    expect(x.favoritos).toMatchObject({ importados: 1 })
    expect(x.favoritos.rejeitados[0].indice).toBe(1)
    expect(x.lazer).toMatchObject({ importados: 2 })
    expect(x.agenda).toMatchObject({ importados: 2 })
    expect(x.meta.estado).toBe('importada')
    expect(x.preferencias.estado).toBe('importadas')
    expect(Object.keys(x.mapaLazer).sort()).toEqual(['l1', 'l2'])

    const tarefas = (await c.get('/api/tarefas')).body.tarefas
    const academia = tarefas.find((t) => t.texto === 'Academia')
    expect(academia).toMatchObject({ dias: [1, 3, 5], criada: '2026-09-01', concluidas: { '2026-10-19': true } })
    expect(tarefas.find((t) => t.texto === 'Estudar').concluidas).toEqual({ '2026-10-20': true })
    expect((await c.get('/api/transacoes/resumo?mes=2026-10')).body.resumo).toMatchObject({ entradas: 3200.5, despesas: 150.1, guardado: 200, saldo: 2850.4 })
    const lazer = (await c.get('/api/lazer')).body.itens
    expect(lazer.find((i) => i.titulo === 'Filme').progresso).toBe(0) // regra: só jogos têm progresso
    const agenda = (await c.get('/api/eventos')).body.eventos
    expect(agenda.find((e) => e.titulo === 'Aula')).toMatchObject({ diaInteiro: true, excecoes: ['2026-10-26'] }) // horário inválido vira dia inteiro
    expect((await c.get('/api/preferencias')).body.preferencias).toMatchObject({ nome: 'Gustavo', destaque: 'menta', foto: 'data:image/jpeg;base64,/9j/4AAQ' })
  })

  it('repetir a importação não duplica nenhum registro', async () => {
    const c = cliente(await entrar(amb.app, { sub: 'migra-2' }))
    const primeira = (await c.post('/api/importacao', legado())).body.resultado
    const segunda = (await c.post('/api/importacao', legado())).body.resultado
    expect(segunda.tarefas.importados).toBe(0)
    expect(segunda.transacoes.importados).toBe(0)
    expect(segunda.favoritos.importados).toBe(0)
    expect(segunda.lazer.importados).toBe(0)
    expect(segunda.agenda.importados).toBe(0)
    expect(segunda.tarefas.jaExistiam).toBe(3)
    expect(segunda.meta.estado).toBe('mantida_do_servidor')
    expect(segunda.preferencias.estado).toBe('mantidas_do_servidor')
    expect(segunda.mapaLazer).toEqual(primeira.mapaLazer) // permite reenviar capas que faltaram
    expect((await c.get('/api/tarefas')).body.tarefas).toHaveLength(3)
    expect((await c.get('/api/transacoes')).body.transacoes).toHaveLength(3)
  })

  it('não sobrescreve dados que o usuário já criou no servidor', async () => {
    const c = cliente(await entrar(amb.app, { sub: 'migra-3' }))
    await c.put('/api/meta', { nome: 'Carro', valor: 100, prazo: '2027-01' })
    await c.patch('/api/preferencias', { nome: 'Já definido' })
    const r = (await c.post('/api/importacao', legado())).body.resultado
    expect(r.meta.estado).toBe('mantida_do_servidor')
    expect(r.preferencias.estado).toBe('mantidas_do_servidor')
    expect((await c.get('/api/meta')).body.meta.nome).toBe('Carro')
    expect((await c.get('/api/preferencias')).body.preferencias.nome).toBe('Já definido')
  })

  it('associa os dados somente à conta autenticada (não vaza para outra)', async () => {
    const a = cliente(await entrar(amb.app, { sub: 'migra-4a' }))
    const b = cliente(await entrar(amb.app, { sub: 'migra-4b' }))
    await a.post('/api/importacao', legado())
    expect((await b.get('/api/tarefas')).body.tarefas).toEqual([])
    // os mesmos ids antigos em outra conta são registros independentes
    const r = (await b.post('/api/importacao', legado())).body.resultado
    expect(r.tarefas.importados).toBe(3)
    expect((await a.get('/api/tarefas')).body.tarefas).toHaveLength(3)
  })

  it('exige login e CSRF, e limita o tamanho do lote', async () => {
    const s = await entrar(amb.app, { sub: 'migra-5' })
    expect((await s.agent.post('/api/importacao').send({})).status).toBe(403)
    const grande = { tarefas: Array.from({ length: 2001 }, (_, i) => ({ id: i, texto: 'x' })) }
    expect((await cliente(s).post('/api/importacao', grande)).status).toBe(400)
  })

  it('horário de término inválido é descartado sem perder o evento', async () => {
    const c = cliente(await entrar(amb.app, { sub: 'migra-7' }))
    const r = await c.post('/api/importacao', { agenda: [{ id: 'z1', titulo: 'Reunião', data: '2026-10-22', diaInteiro: false, inicio: '10:00', fim: '25:99' }] })
    expect(r.body.resultado.agenda).toMatchObject({ importados: 1, rejeitados: [] })
    expect((await c.get('/api/eventos')).body.eventos[0]).toMatchObject({ inicio: '10:00', fim: '' })
  })

  it('foto de perfil grande demais não impede o resto das preferências', async () => {
    const c = cliente(await entrar(amb.app, { sub: 'migra-6' }))
    const r = await c.post('/api/importacao', { preferencias: { nome: 'Ana', foto: 'data:image/jpeg;base64,' + 'a'.repeat(700000) } })
    expect(r.body.resultado.preferencias.estado).toBe('foto_ignorada')
    expect((await c.get('/api/preferencias')).body.preferencias).toMatchObject({ nome: 'Ana', foto: null })
  })
})
