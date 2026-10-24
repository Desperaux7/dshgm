import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { cliente, conectarCalendario, criarAmbiente, entrar, sincronizar } from './helpers.js'
import { googleIdDe } from '../server/services/eventMapping.js'

let amb
beforeAll(async () => { amb = await criarAmbiente() })
afterAll(() => amb.fechar())

const TZ = 'America/Sao_Paulo'
const espera = (ms) => new Promise((r) => setTimeout(r, ms))
let contador = 0

// Usuário novo, logado e (opcionalmente) com o calendário conectado.
async function novo({ conectar = true } = {}) {
  const sub = `cal-${++contador}`
  const sessao = await entrar(amb.app, { sub })
  const c = cliente(sessao)
  if (conectar) await conectarCalendario(amb.app, sessao)
  return { sub, sessao, c }
}
const remoto = (id, titulo, data = '2026-10-22', hora = '10:00') => ({
  id, summary: titulo,
  start: { dateTime: `${data}T${hora}:00-03:00`, timeZone: TZ },
  end: { dateTime: `${data}T11:00:00-03:00`, timeZone: TZ }
})
const evento = (extra = {}) => ({ titulo: 'Consulta', data: '2026-10-22', diaInteiro: false, inicio: '09:00', fim: '10:00', categoria: 'saude', ...extra })

describe('conexão com o Google Calendar', () => {
  it('o login funciona sem conectar o calendário (autorizações independentes)', async () => {
    const { c } = await novo({ conectar: false })
    expect((await c.get('/api/calendario/status')).body).toEqual({ conectado: false })
    expect((await c.post('/api/eventos', evento())).body.evento.sincronizacao.estado).toBe('local')
  })

  it('solicita somente o escopo calendar.events (fluxo separado, offline, PKCE)', async () => {
    const { sessao } = await novo({ conectar: false })
    const r = await sessao.agent.get('/api/calendario/conectar')
    const u = new URL(r.headers.location)
    expect(u.searchParams.get('login_hint')).toBe(sessao.usuario.email) // mantém a mesma conta do login
    expect(u.searchParams.get('scope')).toBe('openid email https://www.googleapis.com/auth/calendar.events')
    expect(u.searchParams.get('access_type')).toBe('offline')
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('redirect_uri')).toContain('/api/calendario/callback')
  })

  it('conecta, guarda o refresh token criptografado e nunca o expõe', async () => {
    const { sub, c } = await novo()
    const st = (await c.get('/api/calendario/status')).body
    expect(st).toMatchObject({ conectado: true, estado: 'connected', email: `${sub}@exemplo.test` })
    expect(JSON.stringify(st)).not.toContain('rt:')
    const [linha] = await amb.db.query('select refresh_token_enc from calendar_connections c join users u on u.id = c.user_id where u.google_sub = $1', [sub])
    expect(linha.refresh_token_enc.startsWith('v1.')).toBe(true)
    expect(linha.refresh_token_enc).not.toContain(`rt:${sub}`)
  })

  it('não conecta se o usuário não concedeu a permissão de calendário', async () => {
    const { sessao, c } = await novo({ conectar: false })
    const r = await conectarCalendario(amb.app, sessao, { semPermissao: true })
    expect(r.headers.location).toContain('calendario=permissao_negada')
    expect((await c.get('/api/calendario/status')).body.conectado).toBe(false)
  })

  it('o callback do calendário exige a sessão de login', async () => {
    const r = await request(amb.app).get('/api/calendario/callback').query({ code: 'a|b@c.test|n', state: 's' })
    expect(r.headers.location).toContain('erro_login=sessao_expirada')
  })

  it('sincronizar e desconectar exigem CSRF', async () => {
    const { sessao } = await novo()
    expect((await sessao.agent.post('/api/calendario/sincronizar').send({})).status).toBe(403)
    expect((await sessao.agent.delete('/api/calendario/conexao')).status).toBe(403)
  })

  it('desconectar revoga a credencial, apaga o vínculo e mantém os eventos locais', async () => {
    const { sub, c } = await novo()
    await c.post('/api/eventos', evento())
    expect((await c.delete('/api/calendario/conexao')).status).toBe(204)
    expect(amb.google.tokensRevogadosPeloApp).toContain(`rt:${sub}`)
    expect((await c.get('/api/calendario/status')).body.conectado).toBe(false)
    const eventos = (await c.get('/api/eventos')).body.eventos
    expect(eventos).toHaveLength(1)
    expect(eventos[0].sincronizacao.estado).toBe('local')
  })

  it('acesso revogado no Google: sincronização falha com clareza e o app continua usável', async () => {
    const { sub, c } = await novo()
    amb.google.revogarAcesso(sub)
    const r = await sincronizar(c)
    expect(r.estado).toBe('erro')
    expect(r.status).toMatchObject({ conectado: false, estado: 'revoked' })
    expect((await c.post('/api/eventos', evento())).status).toBe(201)
  })
})

describe('dashboard -> Google', () => {
  it('um evento criado no dashboard aparece no Google (id determinístico, lembretes nativos)', async () => {
    const { sub, c } = await novo()
    const e = (await c.post('/api/eventos', evento({ titulo: 'Dentista', notas: 'Levar exames' }))).body.evento
    expect(e.sincronizacao.estado).toBe('synced')
    const no = amb.google.eventos(sub)
    expect(no).toHaveLength(1)
    expect(no[0]).toMatchObject({
      id: googleIdDe(e.id), summary: 'Dentista', description: 'Levar exames',
      start: { dateTime: '2026-10-22T09:00:00', timeZone: TZ }, end: { dateTime: '2026-10-22T10:00:00', timeZone: TZ },
      reminders: { useDefault: true }
    })
  })

  it('edições e exclusões no dashboard chegam ao Google', async () => {
    const { sub, c } = await novo()
    const e = (await c.post('/api/eventos', evento())).body.evento
    await c.patch(`/api/eventos/${e.id}`, { titulo: 'Consulta remarcada', inicio: '11:00', fim: '12:00' })
    expect(amb.google.eventos(sub)[0]).toMatchObject({ summary: 'Consulta remarcada', start: { dateTime: '2026-10-22T11:00:00' } })
    expect((await c.delete(`/api/eventos/${e.id}`)).status).toBe(204)
    expect(amb.google.eventos(sub)).toHaveLength(0)
    expect((await c.get('/api/eventos')).body.eventos).toEqual([])
    expect(await amb.db.query('select 1 from events where id = $1', [e.id])).toHaveLength(0)
  })

  it('recorrência semanal com exceções vira RRULE/EXDATE', async () => {
    const { sub, c } = await novo()
    await c.post('/api/eventos', evento({ titulo: 'Aula', data: '2026-10-19', rec: { tipo: 'semanal', dias: [1, 3], ate: '2026-12-18' }, excecoes: ['2026-10-26'] }))
    const [g] = amb.google.eventos(sub)
    expect(g.recurrence[0]).toMatch(/^RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=\d{8}T\d{6}Z$/)
    expect(g.recurrence[1]).toBe(`EXDATE;TZID=${TZ}:20261026T090000`)
  })

  it('eventos de dia inteiro usam date (fim exclusivo)', async () => {
    const { sub, c } = await novo()
    await c.post('/api/eventos', { titulo: 'Feriado', data: '2026-11-02' })
    expect(amb.google.eventos(sub)[0]).toMatchObject({ start: { date: '2026-11-02' }, end: { date: '2026-11-03' } })
  })

  it('sem conexão, nada é enviado ao Google', async () => {
    const { c } = await novo({ conectar: false })
    const antes = amb.google.chamadas.length
    await c.post('/api/eventos', evento())
    expect(amb.google.chamadas.slice(antes).filter((x) => x.includes('/calendar/'))).toEqual([])
  })
})

describe('Google -> dashboard', () => {
  it('importa eventos criados no Google Calendar', async () => {
    const { sub, c } = await novo()
    amb.google.criarRemoto(sub, remoto('evremoto1', 'Reunião no Google'))
    const r = await sincronizar(c)
    expect(r.estado).toBe('ok')
    expect(r.resumo.criados).toBe(1)
    const [e] = (await c.get('/api/eventos')).body.eventos
    expect(e).toMatchObject({ titulo: 'Reunião no Google', data: '2026-10-22', diaInteiro: false, inicio: '10:00', fim: '11:00', sincronizacao: { estado: 'synced' } })
  })

  it('reflete alterações e exclusões feitas no Google (sincronização incremental)', async () => {
    const { sub, c } = await novo()
    amb.google.criarRemoto(sub, remoto('evremoto2', 'Original'))
    await sincronizar(c)
    amb.google.alterarRemoto(sub, 'evremoto2', { summary: 'Alterado no Google', description: 'nova nota' })
    const r2 = await sincronizar(c)
    expect(r2.resumo.atualizados).toBe(1)
    expect((await c.get('/api/eventos')).body.eventos[0]).toMatchObject({ titulo: 'Alterado no Google', notas: 'nova nota' })
    amb.google.apagarRemoto(sub, 'evremoto2')
    await sincronizar(c)
    expect((await c.get('/api/eventos')).body.eventos).toEqual([])
  })

  it('importa dia inteiro e converte horários para o fuso do usuário', async () => {
    const { sub, c } = await novo()
    amb.google.criarRemoto(sub, { id: 'evdia', summary: 'Dia livre', start: { date: '2026-12-24' }, end: { date: '2026-12-25' } })
    amb.google.criarRemoto(sub, { id: 'evutc', summary: 'Em UTC', start: { dateTime: '2026-10-22T13:30:00Z' }, end: { dateTime: '2026-10-22T14:30:00Z' } })
    await sincronizar(c)
    const eventos = (await c.get('/api/eventos')).body.eventos
    expect(eventos.find((e) => e.titulo === 'Dia livre')).toMatchObject({ diaInteiro: true, data: '2026-12-24' })
    expect(eventos.find((e) => e.titulo === 'Em UTC')).toMatchObject({ inicio: '10:30', fim: '11:30' })
  })

  it('importa recorrência e ocorrências canceladas como exceções', async () => {
    const { sub, c } = await novo()
    amb.google.criarRemoto(sub, { ...remoto('evrec', 'Yoga', '2026-10-19', '18:00'), recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE', 'EXDATE;TZID=America/Sao_Paulo:20261021T180000'] })
    await sincronizar(c)
    amb.google.criarRemoto(sub, { id: 'evrec_20261026', recurringEventId: 'evrec', status: 'cancelled', originalStartTime: { dateTime: '2026-10-26T18:00:00-03:00', timeZone: TZ }, start: {}, end: {} })
    await sincronizar(c)
    expect((await c.get('/api/eventos')).body.eventos[0]).toMatchObject({
      titulo: 'Yoga', rec: { tipo: 'semanal', dias: [1, 3], ate: '' }, excecoes: ['2026-10-21', '2026-10-26']
    })
  })

  it('recorrência que o dashboard não representa fica somente leitura e não é sobrescrita', async () => {
    const { sub, c } = await novo()
    amb.google.criarRemoto(sub, { ...remoto('evcomplexo', 'Primeira segunda'), recurrence: ['RRULE:FREQ=MONTHLY;BYDAY=1MO'] })
    await sincronizar(c)
    const [e] = (await c.get('/api/eventos')).body.eventos
    expect(e.sincronizacao).toMatchObject({ somenteLeitura: true, estado: 'readonly' })
    expect((await c.patch(`/api/eventos/${e.id}`, { titulo: 'x' })).status).toBe(409)
    await sincronizar(c)
    expect(amb.google.eventos(sub)[0].recurrence).toEqual(['RRULE:FREQ=MONTHLY;BYDAY=1MO'])
  })

  it('ignora eventos que não são compromissos comuns (aniversários etc.)', async () => {
    const { sub, c } = await novo()
    amb.google.criarRemoto(sub, { id: 'evniver', summary: 'Aniversário', eventType: 'birthday', start: { date: '2026-10-30' }, end: { date: '2026-10-31' } })
    expect((await sincronizar(c)).resumo.ignorados).toBe(1)
    expect((await c.get('/api/eventos')).body.eventos).toEqual([])
  })
})

describe('idempotência, duplicidade e recuperação de falhas', () => {
  it('sincronizar várias vezes nunca duplica eventos', async () => {
    const { sub, c } = await novo()
    await c.post('/api/eventos', evento({ titulo: 'A' }))
    await c.post('/api/eventos', evento({ titulo: 'B' }))
    amb.google.criarRemoto(sub, remoto('evremotoX', 'C'))
    for (let i = 0; i < 3; i++) await sincronizar(c)
    expect(amb.google.eventos(sub)).toHaveLength(3)
    expect((await c.get('/api/eventos')).body.eventos).toHaveLength(3)
  })

  it('o primeiro sync não é refeito dentro de 30 s, a menos que forçado', async () => {
    const { c } = await novo()
    expect((await c.post('/api/calendario/sincronizar', {})).body.estado).toBe('ok')
    expect((await c.post('/api/calendario/sincronizar', {})).body.estado).toBe('recente')
    expect((await c.post('/api/calendario/sincronizar', { forcar: true })).body.estado).toBe('ok')
  })

  it('falha temporária do Google (503): o evento fica pendente e é enviado depois, sem duplicar', async () => {
    const { sub, c } = await novo()
    amb.google.falharProximas('POST', 503, 1)
    const e = (await c.post('/api/eventos', evento())).body.evento
    expect(e.sincronizacao.estado).toBe('pending')
    expect(amb.google.eventos(sub)).toHaveLength(0)
    const r = await sincronizar(c)
    expect(r.resumo.enviados).toBe(1)
    expect(amb.google.eventos(sub)).toHaveLength(1)
    expect((await c.get('/api/eventos')).body.eventos[0].sincronizacao.estado).toBe('synced')
  })

  it('falha permanente (400) marca erro com mensagem, e uma nova tentativa recupera', async () => {
    const { c } = await novo()
    amb.google.falharProximas('POST', 400, 1)
    const e = (await c.post('/api/eventos', evento())).body.evento
    expect(e.sincronizacao.estado).toBe('error')
    expect(e.sincronizacao.erro).toBeTruthy()
    await sincronizar(c)
    expect((await c.get('/api/eventos')).body.eventos[0].sincronizacao).toMatchObject({ estado: 'synced', erro: null })
  })

  it('reenvio após resposta perdida (409 no Google) adota o evento existente em vez de duplicar', async () => {
    const { sub, c } = await novo()
    amb.google.falharProximas('POST', 503, 1)
    const e = (await c.post('/api/eventos', evento({ titulo: 'Perdido' }))).body.evento
    // o Google chegou a gravar, mas o app não recebeu a resposta:
    amb.google.criarRemoto(sub, { id: googleIdDe(e.id), summary: 'Perdido', start: { dateTime: '2026-10-22T09:00:00', timeZone: TZ }, end: { dateTime: '2026-10-22T10:00:00', timeZone: TZ } })
    await sincronizar(c)
    expect(amb.google.eventos(sub)).toHaveLength(1)
    const lista = (await c.get('/api/eventos')).body.eventos
    expect(lista).toHaveLength(1)
    expect(lista[0].sincronizacao.estado).toBe('synced')
  })

  it('cursor de sincronização expirado (410) dispara ressincronização completa sem duplicar', async () => {
    const { sub, c } = await novo()
    await c.post('/api/eventos', evento({ titulo: 'Local' }))
    amb.google.criarRemoto(sub, remoto('evantes', 'Antes'))
    await sincronizar(c)
    amb.google.expirarSyncTokens()
    amb.google.criarRemoto(sub, remoto('evdepois', 'Depois'))
    const r = await sincronizar(c)
    expect(r.estado).toBe('ok')
    expect(r.resumo.ressincronizacaoCompleta).toBe(true)
    expect((await c.get('/api/eventos')).body.eventos.map((e) => e.titulo).sort()).toEqual(['Antes', 'Depois', 'Local'])
  })

  it('conflito: edição local mais recente vence e é enviada ao Google', async () => {
    const { sub, c } = await novo()
    const e = (await c.post('/api/eventos', evento({ titulo: 'Base' }))).body.evento
    amb.google.alterarRemoto(sub, googleIdDe(e.id), { summary: 'Mudou no Google' })
    await espera(25)
    await c.patch(`/api/eventos/${e.id}`, { titulo: 'Mudou no dashboard' })
    expect(amb.google.eventos(sub)[0].summary).toBe('Mudou no dashboard')
    expect((await c.get('/api/eventos')).body.eventos[0].titulo).toBe('Mudou no dashboard')
  })

  it('conflito: alteração mais recente no Google vence uma edição local pendente', async () => {
    const { sub, c } = await novo()
    const e = (await c.post('/api/eventos', evento({ titulo: 'Base' }))).body.evento
    amb.google.falharProximas('PATCH', 503, 1)
    await c.patch(`/api/eventos/${e.id}`, { titulo: 'Edição local' }) // fica pendente
    await espera(25)
    amb.google.alterarRemoto(sub, googleIdDe(e.id), { summary: 'Edição no Google (mais recente)' })
    await sincronizar(c)
    expect((await c.get('/api/eventos')).body.eventos[0]).toMatchObject({ titulo: 'Edição no Google (mais recente)', sincronizacao: { estado: 'synced' } })
  })

  it('exclusão local pendente é concluída na próxima sincronização', async () => {
    const { sub, c } = await novo()
    const e = (await c.post('/api/eventos', evento())).body.evento
    amb.google.falharProximas('DELETE', 503, 5)
    expect((await c.delete(`/api/eventos/${e.id}`)).status).toBe(204)
    expect((await c.get('/api/eventos')).body.eventos).toEqual([]) // some da interface imediatamente
    expect(amb.google.eventos(sub)).toHaveLength(1)
    amb.google.limparFalhas()
    await sincronizar(c)
    expect(amb.google.eventos(sub)).toHaveLength(0)
    expect(await amb.db.query('select 1 from events where id = $1', [e.id])).toHaveLength(0)
  })

  it('evento apagado no Google enquanto desconectado some ao reconectar', async () => {
    const { sub, sessao, c } = await novo()
    const e = (await c.post('/api/eventos', evento())).body.evento
    await c.delete('/api/calendario/conexao')
    amb.google.apagarRemoto(sub, googleIdDe(e.id))
    await conectarCalendario(amb.app, sessao)
    await sincronizar(c)
    expect((await c.get('/api/eventos')).body.eventos).toEqual([])
  })

  it('eventos criados offline (sem conexão) sobem ao conectar, sem duplicar na reconexão', async () => {
    const { sub, sessao, c } = await novo({ conectar: false })
    await c.post('/api/eventos', evento({ titulo: 'Feito antes' }))
    await conectarCalendario(amb.app, sessao)
    await sincronizar(c)
    expect(amb.google.eventos(sub)).toHaveLength(1)
    await c.delete('/api/calendario/conexao')
    await conectarCalendario(amb.app, sessao)
    await sincronizar(c)
    expect(amb.google.eventos(sub)).toHaveLength(1)
    expect((await c.get('/api/eventos')).body.eventos).toHaveLength(1)
  })
})

describe('isolamento do calendário e agendador', () => {
  it('eventos de um usuário nunca vão ao calendário de outro', async () => {
    const a = await novo()
    const b = await novo()
    await a.c.post('/api/eventos', evento({ titulo: 'Só da A' }))
    await sincronizar(b.c)
    expect(amb.google.eventos(b.sub)).toHaveLength(0)
    expect((await b.c.get('/api/eventos')).body.eventos).toEqual([])
  })

  it('o agendador sincroniza as contas conectadas', async () => {
    const a = await novo()
    amb.google.criarRemoto(a.sub, remoto('evagendador', 'Pelo agendador'))
    const estados = await amb.calendario.sincronizarTodos()
    expect(estados.length).toBeGreaterThanOrEqual(1)
    expect((await a.c.get('/api/eventos')).body.eventos.map((e) => e.titulo)).toContain('Pelo agendador')
  })

  it('o estado de conexão informa contagem por situação de sincronização', async () => {
    const { c } = await novo()
    await c.post('/api/eventos', evento())
    const st = (await c.get('/api/calendario/status')).body
    expect(st.eventosPorEstado).toEqual({ synced: 1 })
    expect(st.janelaInicialDias).toBe(90)
  })
})
